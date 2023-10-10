/**
  Some of Gnome Shell's default behavior is really sub-optimal when using
  paperWM. Other features are simply not possible to implement without monkey
  patching. This is a collection of monkey patches and preferences which works
  around these problems and facilitates new features.
 */

const ExtensionUtils = imports.misc.extensionUtils;
const Extension = ExtensionUtils.getCurrentExtension();
const Utils = Extension.imports.utils;
const Tiling = Extension.imports.tiling;
const Scratch = Extension.imports.scratch;

const { Meta, Gio, Shell } = imports.gi;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const Workspace = imports.ui.workspace;
const WorkspaceThumbnail = imports.ui.workspaceThumbnail;
const WorkspaceAnimation = imports.ui.workspaceAnimation;
const WindowPreview = imports.ui.windowPreview;
const WindowManager = imports.ui.windowManager;
const Params = imports.misc.params;

let savedProps, signals;
let gsettings, mutterSettings;
let pillSwipeTimer;
function enable() {
    savedProps = new Map();
    gsettings = ExtensionUtils.getSettings();
    mutterSettings = new Gio.Settings({ schema_id: 'org.gnome.mutter' });
    signals = new Utils.Signals();
    setupSwipeTrackers();
    setupOverrides();
    enableOverrides();
    setupRuntimeDisables();
    setupActions();
}

function disable() {
    disableOverrides();
    restoreRuntimeDisables();
    actions.forEach(a => global.stage.add_action(a));
    actions = null;

    signals.destroy();
    signals = null;

    savedProps = null;
    swipeTrackers = null;
    gsettings = null;
    mutterSettings = null;
    Utils.timeout_remove(pillSwipeTimer);
    pillSwipeTimer = null;
    actions = null;
}

function registerOverrideProp(obj, name, override, warn = true) {
    if (!obj)
        return;

    let saved = getSavedProp(obj, name) ?? obj[name];
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

    // check if method for prototype exists - throwing warning if not
    const exists = obj?.prototype?.[name];
    if (!exists) {
        console.warn(`#PaperWM: attempt to override prototype for '${name}' failed: is null or undefined`);
    }

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
    registerOverridePrototype(WorkspaceAnimation.WorkspaceAnimationController, 'animateSwitch',
        // WorkspaceAnimation.WorkspaceAnimationController.animateSwitch
        // Disable the workspace switching animation in Gnome 40+
        function (_from, _to, _direction, onComplete) {
            // if using PaperWM workspace switch animation, just do complete here
            if (Tiling.inPreview || Tiling.spaces.space_activate_animate) {
                onComplete();
            }
            else {
                const saved = getSavedPrototype(WorkspaceAnimation.WorkspaceAnimationController, 'animateSwitch');
                saved.call(this, _from, _to, _direction, onComplete);
            }

            // ensure swipeTrackers are disabled after this
            pillSwipeTimer = Mainloop.timeout_add(500, () => {
                swipeTrackers.forEach(t => t.enabled = false);
                pillSwipeTimer = null;
                return false; // on return false destroys timeout
            });
        });

    registerOverridePrototype(WorkspaceAnimation.WorkspaceAnimationController, '_prepareWorkspaceSwitch',
        function (workspaceIndices) {
            const saved = getSavedPrototype(WorkspaceAnimation.WorkspaceAnimationController, '_prepareWorkspaceSwitch');
            // hide selection during workspace switch
            Tiling.spaces.forEach(s => s.hideSelection());
            saved.call(this, workspaceIndices);
        });

    registerOverridePrototype(WorkspaceAnimation.WorkspaceAnimationController, '_finishWorkspaceSwitch',
        function (switchData) {
            const saved = getSavedPrototype(WorkspaceAnimation.WorkspaceAnimationController, '_finishWorkspaceSwitch');
            // ensure selection is shown after workspaces swtching
            Tiling.spaces.forEach(s => s.showSelection());
            saved.call(this, switchData);
        });

    registerOverridePrototype(WindowManager.WorkspaceTracker, '_checkWorkspaces', _checkWorkspaces);

    if (WindowManager.TouchpadWorkspaceSwitchAction) // disable 4-finger swipe
        registerOverridePrototype(WindowManager.TouchpadWorkspaceSwitchAction, '_checkActivated', () => false);

    // disable swipe gesture trackers
    swipeTrackers.forEach(t => {
        registerOverrideProp(t, "enabled", false);
    });

    registerOverridePrototype(Workspace.UnalignedLayoutStrategy, '_sortRow', row => row);
    registerOverridePrototype(Workspace.UnalignedLayoutStrategy, 'computeLayout', computeLayout40);
    registerOverridePrototype(Workspace.Workspace, '_isOverviewWindow', win => {
        win = win.meta_window ?? win; // should be metawindow, but get if not
        // upstream (gnome value result - whta it would have done)
        const saved = getSavedPrototype(Workspace.Workspace, '_isOverviewWindow');
        const upstreamValue = saved?.call(this, win) ?? !win.skip_taskbar;

        if (Scratch.isScratchWindow(win)) {
            if (gsettings.get_boolean('only-scratch-in-overview')) {
                return upstreamValue;
            }

            if (gsettings.get_boolean('disable-scratch-in-overview')) {
                return false;
            }
        }

        // if here then not scratch
        if (gsettings.get_boolean('only-scratch-in-overview')) {
            return false;
        }

        return upstreamValue;
    });

    const checkScratch = (metaWindow, metaWorkspace) => {
        if (Scratch.isScratchWindow(metaWindow)) {
            // check workspace match
            return metaWorkspace === metaWindow?.get_workspace();
        }

        return false;
    };
    registerOverridePrototype(Workspace.Workspace, '_isMyWindow', function(window) {
        if (checkScratch(window, this.metaWorkspace)) {
            return true;
        }

        const space = Tiling.spaces.spaceOf(this.metaWorkspace);
        const onSpace = space.indexOf(window) >= 0;
        const onMonitor = this._monitor === space.monitor;
        return onSpace && onMonitor;
    });
    registerOverridePrototype(WorkspaceThumbnail.WorkspaceThumbnail, '_isMyWindow', function(actor) {
        const window = actor.meta_window;
        if (checkScratch(window, this.metaWorkspace)) {
            return true;
        }

        const space = Tiling.spaces.spaceOf(this.metaWorkspace);
        const onSpace = space.indexOf(window) >= 0;
        const onMonitor = this.monitorIndex === space.monitor.index;
        return onSpace && onMonitor;
    });

    /**
     * Resolve issue where window that is set to minimise-on-close should be removed
     * from tiling (stick) before closing.  See https://github.com/paperwm/PaperWM/issues/608.
     */
    registerOverridePrototype(WindowPreview.WindowPreview, '_deleteAll', function() {
        const windows = this.window_container.layout_manager.get_windows();

        // Delete all windows, starting from the bottom-most (most-modal) one
        for (const window of windows.reverse()) {
            window.stick();
            window.delete(global.get_current_time());
        }

        this._closeRequested = true;
    });

    /**
     * Always show workspace thumbnails in overview if more than one workspace.
     * See original function at:
     * https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/gnome-44/js/ui/workspaceThumbnail.js#L690
     */
    registerOverridePrototype(WorkspaceThumbnail.ThumbnailsBox, '_updateShouldShow',
        function () {
            const { nWorkspaces } = global.workspace_manager;
            const shouldShow = nWorkspaces > 1;

            if (this._shouldShow === shouldShow)
                return;

            this._shouldShow = shouldShow;
            this.notify('should-show');
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

/**
 * Saves the original setting value (boolean) to restore on disable.
 * We save a backup of the user's setting to PaperWM settings (schema)
 * for safety (in case gnome terminates etc.).  This ensures original
 * user settings will be restored on next PaperWM disable.
 * @param key
 */
let runtimeDisables = [];
function saveRuntimeDisable(schemaSettings, key, disableValue) {
    try {
        let origValue = schemaSettings.get_boolean(key);
        schemaSettings.set_boolean(key, disableValue);

        // save a backup copy to PaperWM settings (for restore)
        let pkey = `restore-${key}`;

        /**
         * Now if paperwm settings has restore values, it means
         * that they weren't previously restore properly (since on
         * successful restore we clear the values).
         */
        if (gsettings.get_string(pkey) === '') {
            gsettings.set_string(pkey, origValue.toString());
        }

        // we want to restore from PaperWM back settings (safer)
        let restore = () => {
            let value = gsettings.get_string(pkey);
            // if value is empty, do nothing
            if (value === '') {
                return;
            }

            let bvalue = value === 'true';
            schemaSettings.set_boolean(key, bvalue);

            // after restore, empty papermw saved value
            gsettings.set_string(pkey, '');
        };

        runtimeDisables.push(restore);
    } catch (e) {
        console.error(e);
    }
}

/**
 * PaperWM disables certain behaviours during runtime.
 * The user original settings are saved to PaperWM's settings (schema) for restoring
 * purposes (we save to PaperWM's setting just in gnome terminates before PaperWM can
 * restore the original user settings).  These settings are then restored on disable().
 */
function setupRuntimeDisables() {
    saveRuntimeDisable(mutterSettings, 'attach-modal-dialogs', false);
    saveRuntimeDisable(mutterSettings, 'workspaces-only-on-primary', false);
    saveRuntimeDisable(mutterSettings, 'edge-tiling', false);
}

/**
 * Restores the runtime settings that were disabled when
 * PaperWM was enabled.
 */
function restoreRuntimeDisables() {
    if (Main.sessionMode.isLocked) {
        return;
    }
    runtimeDisables.forEach(restore => {
        try {
            restore();
        } catch (e) {
            console.error(e);
        }
    });
}

/**
 * Swipetrackers that should be disabled.  Locations of swipetrackers may
 * move from gnome version to gnome version.  Next to the swipe tracker locations
 * below are the gnome versions when they were first (or last) seen.
 */
var swipeTrackers; // exported
function setupSwipeTrackers() {
    swipeTrackers = [
        Main?.overview?._swipeTracker, // gnome 40+
        Main?.overview?._overview?._controls?._workspacesDisplay?._swipeTracker, // gnome 40+
        Main?.wm?._workspaceAnimation?._swipeTracker, // gnome 40+
        Main?.wm?._swipeTracker, // gnome 38 (and below)
    ].filter(t => typeof t !== 'undefined');
}

let actions;
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
    // sorting needs to be done here to address moved windows
    sortedWindows.sort(sortWindows);

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
            if (this._keepSameRow(row, window, width, idealRowWidth) || (i === numRows - 1)) {
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
             (lastRemoved.get_window_type() === Meta.WindowType.SPLASHSCREEN ||
              lastRemoved.get_window_type() === Meta.WindowType.DIALOG ||
              lastRemoved.get_window_type() === Meta.WindowType.MODAL_DIALOG)) ||
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

    /**
     * Set minimum workspaces to be max of num_monitors+1.
     * This ensures that we have at least one workspace at the end.
     */
    let minimum = Main.layoutManager.monitors.length + 1;
    // Make sure we have a minimum number of spaces
    for (i = 0; i < minimum; i++) {
        if (i >= emptyWorkspaces.length) {
            workspaceManager.append_new_workspace(false, global.get_current_time());
            emptyWorkspaces.push(true);
        }
    }

    // If we don't have an empty workspace at the end, add one
    if (!emptyWorkspaces[emptyWorkspaces.length - 1]) {
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
    if (Tiling?.spaces?.monitors) {
        for (let [monitor, space] of Tiling.spaces.monitors) {
            emptyWorkspaces[space.workspace.index()] = false;
        }
    }

    // Delete empty workspaces except for the last one; do it from the end
    // to avoid index changes
    for (i = lastIndex; i >= 0; i--) {
        if (emptyWorkspaces[i] && i != lastEmptyIndex) {
            workspaceManager.remove_workspace(this._workspaces[i]
                , global.get_current_time());
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
