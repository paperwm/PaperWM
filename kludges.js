/**
  Some of Gnome Shell's default behavior is really sub-optimal when using
  paperWM. Other features are simply not possible to implement without monkey
  patching. This is a collection of monkey patches and preferences which works
  around these problems and facilitates new features.
 */

var ExtensionUtils = imports.misc.extensionUtils;
var Extension = ExtensionUtils.getCurrentExtension();
var Meta = imports.gi.Meta;
var Gio = imports.gi.Gio;
var Main = imports.ui.main;
var Mainloop = imports.mainloop;
var Workspace = imports.ui.workspace;
var WindowManager = imports.ui.windowManager;
var WorkspaceAnimation = imports.ui.workspaceAnimation;
var Shell = imports.gi.Shell;
var utils = Extension.imports.utils;
var Params = imports.misc.params;

var Scratch = Extension.imports.scratch;
var Tiling = Extension.imports.tiling;
var Clutter = imports.gi.Clutter;

// Workspace.WindowClone.getOriginalPosition
// Get the correct positions of tiled windows when animating to/from the overview
function getOriginalPosition() {
    let c = this.metaWindow.clone;
    let space = Tiling.spaces.spaceOfWindow(this.metaWindow);
    if (!space || space.indexOf(this.metaWindow) === -1) {
        return [this._boundingBox.x, this._boundingBox.y];
    }
    let [x, y] = [space.monitor.x + space.targetX + c.targetX, space.monitor.y + c.y];
    return [x, y];
}

var savedProps;
savedProps = savedProps || new Map();

function registerOverrideProp(obj, name, override) {
    if (!obj)
        return;

    let saved = getSavedProp(obj, name) || obj[name];
    let props = savedProps.get(obj);
    if (!props) {
        props = {};
        savedProps.set(obj, props);
    }
    props[name] = {
        saved,
        override,
    };
}

function registerOverridePrototype(obj, name, override) {
    if (!obj)
        return;

    registerOverrideProp(obj.prototype, name, override);
}

function makeFallback(obj, method, ...args) {
    let fallback = getSavedPrototype(obj, method);
    return fallback.bind(...args);
}

function overrideWithFallback(obj, method, body) {
    registerOverridePrototype(
        obj, method, function(...args) {
            let fallback = makeFallback(obj, method, this, ...args);
            body(fallback, this, ...args);
        }
    );
}

function getSavedProp(obj, name) {
    let props = savedProps.get(obj);
    if (!props)
        return undefined;
    let prop = props[name];
    if (!prop)
        return undefined;
    return prop.saved;
}

function getSavedPrototype(obj, name) {
    return getSavedProp(obj.prototype, name);
}

function disableOverride(obj, name) {
    obj[name] = getSavedProp(obj, name);
}

function enableOverride(obj, name) {
    let props = savedProps.get(obj);
    let override = props[name].override;
    if (override !== undefined) {
        obj[name] = override;
    }
}

/**
 * Sets up PaperWM overrides (needed for operations).  These overrides are registered and restored
 * on PaperWM disable.
 */
function setupOverrides() {
    // prepare for PaperWM workspace switching
    registerOverridePrototype(WindowManager.WindowManager, '_prepareWorkspaceSwitch', function (from, to, direction) {
        if (this._switchData)
            return;

        let switchData = {};
        this._switchData = switchData;
        switchData.movingWindowBin = new Clutter.Actor();
        switchData.windows = [];
        switchData.surroundings = {};
        switchData.gestureActivated = false;
        switchData.inProgress = false;

        switchData.container = new Clutter.Actor();
    });

    registerOverridePrototype(WorkspaceAnimation.WorkspaceAnimationController, 'animateSwitch',
        // WorkspaceAnimation.WorkspaceAnimationController.animateSwitch
        // Disable the workspace switching animation in Gnome 40+
        function (_from, _to, _direction, onComplete) {
            onComplete();
        });

    registerOverridePrototype(Workspace.Workspace, '_isOverviewWindow');
    if (Workspace.WindowClone)
        registerOverridePrototype(Workspace.WindowClone, 'getOriginalPosition', getOriginalPosition);

    // Workspace.Workspace._realRecalculateWindowPositions
    // Sort tiled windows in the correct order
    registerOverridePrototype(Workspace.Workspace, '_realRecalculateWindowPositions',
        function (flags) {
            if (this._repositionWindowsId > 0) {
                Mainloop.source_remove(this._repositionWindowsId);
                this._repositionWindowsId = 0;
            }

            let clones = this._windows.slice();
            if (clones.length === 0) {
                return;
            }

            let space = Tiling.spaces.spaceOf(this.metaWorkspace);
            if (space) {
                clones.sort((a, b) => {
                    let aw = a.metaWindow;
                    let bw = b.metaWindow;
                    let ia = space.indexOf(aw);
                    let ib = space.indexOf(bw);
                    if (ia === -1 && ib === -1) {
                        return a.metaWindow.get_stable_sequence() - b.metaWindow.get_stable_sequence();
                    }
                    if (ia === -1) {
                        return -1;
                    }
                    if (ib === -1) {
                        return 1;
                    }
                    return ia - ib;
                });
            } else {
                clones.sort((a, b) => {
                    return a.metaWindow.get_stable_sequence() - b.metaWindow.get_stable_sequence();
                });
            }

            if (this._reservedSlot)
                clones.push(this._reservedSlot);

            this._currentLayout = this._computeLayout(clones);
            this._updateWindowPositions(flags);
        });

    registerOverridePrototype(Workspace.UnalignedLayoutStrategy, '_sortRow', row => row);

    registerOverridePrototype(WindowManager.WorkspaceTracker, '_checkWorkspaces', _checkWorkspaces);

    if (WindowManager.TouchpadWorkspaceSwitchAction) // disable 4-finger swipe
        registerOverridePrototype(WindowManager.TouchpadWorkspaceSwitchAction, '_checkActivated', () => false);

    // Work around https://gitlab.gnome.org/GNOME/gnome-shell/issues/1884
    if (!WindowManager.WindowManager.prototype._removeEffect) {
        registerOverridePrototype(WindowManager.WindowManager, '_mapWindowOverwrite',
            function (shellwm, actor) {
                if (this._mapping.delete(actor)) {
                    shellwm.completed_map(actor);
                }
            });
    }

    let layout = computeLayout40;
    registerOverridePrototype(Workspace.UnalignedLayoutStrategy, 'computeLayout', layout)

    // disable swipe gesture trackers
    swipeTrackers.forEach(t => {
        registerOverrideProp(t, "enabled", false);
    });

    registerOverridePrototype(Workspace.Workspace, '_isOverviewWindow', win => {
        let metaWindow = win.meta_window || win;
        if (settings.get_boolean('only-scratch-in-overview'))
            return Scratch.isScratchWindow(metaWindow) && !metaWindow.skip_taskbar;
        if (settings.get_boolean('disable-scratch-in-overview'))
            return !Scratch.isScratchWindow(metaWindow) && !metaWindow.skip_taskbar;
    });
}

/**
 * Enables any registered overrides.
 */
function enableOverrides() {
    for (let [obj, props] of savedProps) {
        for (let name in props) {
            enableOverride(obj, name);
        }
    }
}

function disableOverrides() {
    for (let [obj, props] of savedProps) {
        for (let name in props) {
            obj[name] = props[name].saved;
        }
    }
}

function restoreMethod(obj, name) {
    let method = getMethod(obj, name);
    if (method)
        obj[name] = method;
}

/**
 * Saves the original setting value (boolean) to restore
 * on disable.
 * @param key
 */
let runtimeDisables = [];
function saveRuntimeDisable(settings, key, disableValue) {
    try {
        let origValue = settings.get_boolean(key);
        settings.set_boolean(key, disableValue);
        runtimeDisables.push(() => settings.set_boolean(key, origValue));
    } catch (e) {
        log(e);
    }
}

/**
 * PaperWM disables certain behaviours while running.
 * These behaviours are then restored on PaperWM disable().
 */
function setupRuntimeDisables() {
    saveRuntimeDisable(mutterSettings, 'attach-modal-dialogs', false);
    saveRuntimeDisable(mutterSettings, 'workspaces-only-on-primary', false);
    saveRuntimeDisable(mutterSettings, 'edge-tiling', false);

    /**
     * PaperWM disables hotcorner (if set in PaperWM options) by
     * disconnecting the hot corner logic.
     */
    let setupHotCornersDisable = () => {
        if (settings.get_boolean("override-hot-corner")) {
            let overrideHotCorners = () => {
                for (let corner of Main.layoutManager.hotCorners) {
                    if (!corner)
                        continue;

                    corner._toggleOverview = function () { };
                    corner._pressureBarrier._trigger = function () { };
                }
            };
            overrideHotCorners();
            signals.connect(Main.layoutManager, 'hot-corners-changed',
                overrideHotCorners);
        } else {
            signals.disconnect(Main.layoutManager);
            Main.layoutManager._updateHotCorners();
        }
    };
    setupHotCornersDisable();
    signals.connect(settings, 'changed::override-hot-corner', setupHotCornersDisable);
}

/**
 * Restores gnome hot corner(s) user preference.
 */
function restoreRuntimeDisables() {
    /**
     * Calling `Main.layoutManager._updateHotCorners();` causes
     * gnome to restore the original user hot corner preference.
     */
    Main.layoutManager._updateHotCorners();

    runtimeDisables.forEach(d => {
        try {
            d();
        } catch (e) {
            log(e);
        }
    });
}

/**
 * Swipetrackers that should be disabled.  Locations of swipetrackers may
 * move from gnome version to gnome version.  Next to the swipe tracker locations
 * below are the gnome versions when they were first (or last) seen.
 */
var swipeTrackers;
function setupSwipeTrackers() {
    swipeTrackers = [
        Main?.overview?._swipeTracker, // gnome 40+
        Main?.overview?._overview?._controls?._workspacesDisplay?._swipeTracker, // gnome 40+
        Main?.wm?._workspaceAnimation?._swipeTracker, // gnome 40+
        Main?.wm?._swipeTracker, // gnome 38 (and below)
    ].filter(t => typeof t !== 'undefined');
}

var signals;
function setupSignals() {
    signals = new utils.Signals();

    /**
     * Swipetrackers are reset by gnome during overview, once exits overview
     * ensure swipe trackers are reset.
     */
    signals.connect(Main.overview, 'hidden', () => {
        swipeTrackers.forEach(t => {
            t.enabled = false;
        });
    });

    function scratchInOverview() {
        let onlyScratch = settings.get_boolean('only-scratch-in-overview');
        let disableScratch = settings.get_boolean('disable-scratch-in-overview');
        if (onlyScratch || disableScratch) {
            enableOverride(Workspace.Workspace.prototype, '_isOverviewWindow');
        } else {
            disableOverride(Workspace.Workspace.prototype, '_isOverviewWindow');
        }
    }
    signals.connect(settings, 'changed::only-scratch-in-overview', scratchInOverview);
    signals.connect(settings, 'changed::disable-scratch-in-overview', scratchInOverview);
    scratchInOverview();
}

var actions;
function setupActions() {
    /*
     * Some actions work rather poorly.
     * In particular the 3-finger hold + tap can randomly activate a minimized
     * window when tapping after a 3-finger swipe
     */
    actions = global.stage.get_actions().filter(a => {
        switch (a.constructor) {
        case WindowManager.AppSwitchAction:
            return true;
        }
    });
    actions.forEach(a => global.stage.remove_action(a));
}

var settings, wmSettings, mutterSettings;
function enable() {
    settings = ExtensionUtils.getSettings();
    wmSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.wm.preferences'});
    mutterSettings = new Gio.Settings({schema_id: 'org.gnome.mutter'});
    setupSwipeTrackers();
    setupOverrides();
    enableOverrides();
    setupSignals();
    setupRuntimeDisables();
    setupActions();
}

function disable() {
    disableOverrides();
    actions.forEach(a => global.stage.add_action(a));

    signals.destroy();
    signals = null;

    /**
     * Call restore runtime disables AFTER signal disconnect, otherwise
     * change might execute a re-enable of behaviour.
     */
    restoreRuntimeDisables();
    swipeTrackers = null;
    settings = null;
    wmSettings = null;
    mutterSettings = null;
    actions = null;
}

function sortWindows(a, b) {
    let aw = a.metaWindow;
    let bw = b.metaWindow;
    let spaceA = Tiling.spaces.spaceOfWindow(aw);
    let spaceB = Tiling.spaces.spaceOfWindow(bw);
    let ia = spaceA.indexOf(aw);
    let ib = spaceB.indexOf(bw);
    if (ia === -1 && ib === -1) {
        return a.metaWindow.get_stable_sequence() - b.metaWindow.get_stable_sequence();
    }
    if (ia === -1) {
        return -1;
    }
    if (ib === -1) {
        return 1;
    }
    return ia - ib;
}

function computeLayout40(windows, layoutParams) {
    layoutParams = Params.parse(layoutParams, {
        numRows: 0,
    });

    if (layoutParams.numRows === 0)
        throw new Error(`${this.constructor.name}: No numRows given in layout params`);

    let numRows = layoutParams.numRows;

    let rows = [];
    let totalWidth = 0;
    for (let i = 0; i < windows.length; i++) {
        let window = windows[i];
        let s = this._computeWindowScale(window);
        totalWidth += window.boundingBox.width * s;
    }

    let idealRowWidth = totalWidth / numRows;

    let sortedWindows = windows.slice();
    // addWindow should have made sure we're already sorted.
    // sortedWindows.sort(sortWindows);

    let windowIdx = 0;
    for (let i = 0; i < numRows; i++) {
        let row = this._newRow();
        rows.push(row);

        for (; windowIdx < sortedWindows.length; windowIdx++) {
            let window = sortedWindows[windowIdx];
            let s = this._computeWindowScale(window);
            let width = window.boundingBox.width * s;
            let height = window.boundingBox.height * s;
            row.fullHeight = Math.max(row.fullHeight, height);

            // either new width is < idealWidth or new width is nearer from idealWidth then oldWidth
            if (this._keepSameRow(row, window, width, idealRowWidth) || (i == numRows - 1)) {
                row.windows.push(window);
                row.fullWidth += width;
            } else {
                break;
            }
        }
    }

    let gridHeight = 0;
    let maxRow;
    for (let i = 0; i < numRows; i++) {
        let row = rows[i];
        this._sortRow(row);

        if (!maxRow || row.fullWidth > maxRow.fullWidth)
            maxRow = row;
        gridHeight += row.fullHeight;
    }

    return {
        numRows,
        rows,
        maxColumns: maxRow.windows.length,
        gridWidth: maxRow.fullWidth,
        gridHeight,
    };
}

function _checkWorkspaces() {
    let workspaceManager = global.workspace_manager;
    let i;
    let emptyWorkspaces = [];

    if (!Meta.prefs_get_dynamic_workspaces()) {
        this._checkWorkspacesId = 0;
        return false;
    }

    // Update workspaces only if Dynamic Workspace Management has not been paused by some other function
    if (this._pauseWorkspaceCheck || Tiling.inPreview)
        return true;

    for (i = 0; i < this._workspaces.length; i++) {
        let lastRemoved = this._workspaces[i]._lastRemovedWindow;
        if ((lastRemoved &&
             (lastRemoved.get_window_type() == Meta.WindowType.SPLASHSCREEN ||
              lastRemoved.get_window_type() == Meta.WindowType.DIALOG ||
              lastRemoved.get_window_type() == Meta.WindowType.MODAL_DIALOG)) ||
            this._workspaces[i]._keepAliveId)
            emptyWorkspaces[i] = false;
        else
            emptyWorkspaces[i] = true;
    }

    let sequences = Shell.WindowTracker.get_default().get_startup_sequences();
    for (i = 0; i < sequences.length; i++) {
        let index = sequences[i].get_workspace();
        if (index >= 0 && index <= workspaceManager.n_workspaces)
            emptyWorkspaces[index] = false;
    }

    let windows = global.get_window_actors();
    for (i = 0; i < windows.length; i++) {
        let actor = windows[i];
        let win = actor.get_meta_window();

        if (win.is_on_all_workspaces())
            continue;

        let workspaceIndex = win.get_workspace().index();
        emptyWorkspaces[workspaceIndex] = false;
    }

    let minimum = wmSettings.get_int('num-workspaces');
    // Make sure we have a minimum number of spaces
    for (i = 0; i < Math.max(Main.layoutManager.monitors.length, minimum); i++) {
        if (i >= emptyWorkspaces.length) {
            workspaceManager.append_new_workspace(false, global.get_current_time());
            emptyWorkspaces.push(true);
        }
    }

    // If we don't have an empty workspace at the end, add one
    if (!emptyWorkspaces[emptyWorkspaces.length -1]) {
        workspaceManager.append_new_workspace(false, global.get_current_time());
        emptyWorkspaces.push(true);
    }

    let lastIndex = emptyWorkspaces.length - 1;
    let lastEmptyIndex = emptyWorkspaces.lastIndexOf(false) + 1;
    let activeWorkspaceIndex = workspaceManager.get_active_workspace_index();

    // Keep the active workspace
    emptyWorkspaces[activeWorkspaceIndex] = false;

    // Keep a minimum number of spaces
    for (i = 0; i < Math.max(Main.layoutManager.monitors.length, minimum); i++) {
        emptyWorkspaces[i] = false;
    }

    // Keep visible spaces
    for (let [monitor, space] of Tiling.spaces.monitors) {
        emptyWorkspaces[space.workspace.index()] = false;
    }

    // Delete empty workspaces except for the last one; do it from the end
    // to avoid index changes
    for (i = lastIndex; i >= 0; i--) {
        if (emptyWorkspaces[i] && i != lastEmptyIndex) {
            workspaceManager.remove_workspace(this._workspaces[i], global.get_current_time());
        }
    }

    this._checkWorkspacesId = 0;
    return false;
}

function addWindow(window, metaWindow) {
    if (this._windows.has(window))
        return;

    this._windows.set(window, {
        metaWindow,
        sizeChangedId: metaWindow.connect('size-changed', () => {
            this._layout = null;
            this.layout_changed();
        }),
        destroyId: window.connect('destroy', () =>
            this.removeWindow(window)),
        currentTransition: null,
    });

    this._sortedWindows.push(window);
    this._sortedWindows.sort(sortWindows);

    this._syncOverlay(window);
    this._container.add_child(window);

    this._layout = null;
    this.layout_changed();
}
