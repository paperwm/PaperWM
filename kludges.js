/**
  Some of Gnome Shell's default behavior is really sub-optimal when using
  paperWM. Other features are simply not possible to implement without monkey
  patching. This is a collection of monkey patches and preferences which works
  around these problems and facilitates new features.
 */

var Extension;
if (imports.misc.extensionUtils.extensions) {
    Extension = imports.misc.extensionUtils.extensions["paperwm@hedning:matrix.org"];
} else {
    Extension = imports.ui.main.extensionManager.lookup("paperwm@hedning:matrix.org");
}


var Meta = imports.gi.Meta;
var Main = imports.ui.main;
var Mainloop = imports.mainloop;
var Workspace = imports.ui.workspace;
var WindowManager = imports.ui.windowManager;
var Shell = imports.gi.Shell;
var utils = Extension.imports.utils;

var Convenience = Extension.imports.convenience;
var Scratch = Extension.imports.scratch;
var Tiling = Extension.imports.tiling;
var settings = Convenience.getSettings();
var Clutter = imports.gi.Clutter;
let St = imports.gi.St;

function overrideHotCorners() {
    for (let corner of Main.layoutManager.hotCorners) {
        if (!corner)
            continue;

        corner._toggleOverview = function() {};

        corner._pressureBarrier._trigger = function() {};
    }
}

if (!global.display.get_monitor_scale) {
    // `get_monitor_scale` first appeared in 3.31.92. Polyfill a fallback for 3.28
    global.display.constructor.prototype.get_monitor_scale = () => 1.0;
}

if (!global.display.get_monitor_neighbor_index) {
    // `get_monitor_neighbor_index` polyfill a fallback for 3.28
    global.display.constructor.prototype.get_monitor_neighbor_index = function(...args) {
        return global.screen.get_monitor_neighbor_index(...args);
    }
}

// polyfill for 3.28
Meta.DisplayDirection = Meta.ScreenDirection;

if (!St.Settings) {
    // `St.Settings` doesn't exist in 3.28 - polyfill:
    let Gtk = imports.gi.Gtk;
    let gtkSettings = Gtk.Settings.get_default();
    let polyfillSettings = new (class PolyfillStSettings {
        get enable_animations() {
            return gtkSettings.gtk_enable_animations;
        }
        set enable_animations(value) {
            gtkSettings.gtk_enable_animations = value;
        }
    })();

    St.Settings = {
        get: function() { return polyfillSettings; } // ASSUMTION: no need to call get_default each time
    };
}

if (!Clutter.Actor.prototype.set) {
    // `set` doesn't exist in 3.28 - polyfill:
    Clutter.Actor.prototype.set = function(params) {
        Object.assign(this, params);
    }
}

// Polyfill gnome-3.34 transition API, taken from gnome-shell/js/ui/environment.js
const version = imports.misc.config.PACKAGE_VERSION.split('.');
if (version[0] >= 3 && version[1] < 34) {
    function _makeEaseCallback(params, cleanup) {
        let onComplete = params.onComplete;
        delete params.onComplete;

        let onStopped = params.onStopped;
        delete params.onStopped;

        return isFinished => {
            cleanup();

            if (onStopped)
                onStopped(isFinished);
            if (onComplete && isFinished)
                onComplete();
        };
    }

    let enable_unredirect = () => Meta.enable_unredirect_for_display(global.display);
    let disable_unredirect = () => Meta.disable_unredirect_for_display(global.display);;
    // This is different in 3.28
    if (version[0] >= 3 && version[1] < 30) {
        enable_unredirect = () => Meta.enable_unredirect_for_screen(global.screen);
        disable_unredirect = () => Meta.disable_unredirect_for_screen(global.screen);;
    }

    function _easeActor(actor, params) {
        actor.save_easing_state();

        if (params.duration != undefined)
            actor.set_easing_duration(params.duration);
        delete params.duration;

        if (params.delay != undefined)
            actor.set_easing_delay(params.delay);
        delete params.delay;

        if (params.mode != undefined)
            actor.set_easing_mode(params.mode);
        delete params.mode;

        disable_unredirect();

        let callback = _makeEaseCallback(params, enable_unredirect);

        // cancel overwritten transitions
        let animatedProps = Object.keys(params).map(p => p.replace('_', '-', 'g'));
        animatedProps.forEach(p => actor.remove_transition(p));

        actor.set(params);
        actor.restore_easing_state();

        let transition = animatedProps.map(p => actor.get_transition(p))
            .find(t => t !== null);

        if (transition)
            transition.connect('stopped', (t, finished) => callback(finished));
        else
            callback(true);
    }

    // adjustAnimationTime:
    // @msecs: time in milliseconds
    //
    // Adjust @msecs to account for St's enable-animations
    // and slow-down-factor settings
    function adjustAnimationTime(msecs) {
        let settings = St.Settings.get();

        if (!settings.enable_animations)
            return 1;
        // settings.slow_down_factor is new in 3.34
        return St.get_slow_down_factor() * msecs;
    }

    let origSetEasingDuration = Clutter.Actor.prototype.set_easing_duration;
    Clutter.Actor.prototype.set_easing_duration = function(msecs) {
        origSetEasingDuration.call(this, adjustAnimationTime(msecs));
    };
    let origSetEasingDelay = Clutter.Actor.prototype.set_easing_delay;
    Clutter.Actor.prototype.set_easing_delay = function(msecs) {
        origSetEasingDelay.call(this, adjustAnimationTime(msecs));
    };

    Clutter.Actor.prototype.ease = function(props, easingParams) {
        _easeActor(this, props, easingParams);
    };
}

// Workspace.Workspace._realRecalculateWindowPositions
// Sort tiled windows in the correct order
function _realRecalculateWindowPositions(flags) {
    if (this._repositionWindowsId > 0) {
        Mainloop.source_remove(this._repositionWindowsId);
        this._repositionWindowsId = 0;
    }

    let clones = this._windows.slice();
    if (clones.length == 0)
        return;

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
}

// Workspace.WindowClone.getOriginalPosition
// Get the correct positions of tiled windows when animating to/from the overview
function getOriginalPosition() {
    let c = this.metaWindow.clone;
    let space = Tiling.spaces.spaceOfWindow(this.metaWindow);
    if (!space || space.indexOf(this.metaWindow) === -1) {
        return [this._boundingBox.x, this._boundingBox.y];
    }
    let [x, y] = [ space.monitor.x + space.targetX + c.targetX, space.monitor.y + c.y];
    return [x, y];
}

function disableHotcorners() {
    let override = settings.get_boolean("override-hot-corner");
    if (override) {
        overrideHotCorners();
        signals.connect(Main.layoutManager,
                        'hot-corners-changed',
                        overrideHotCorners);
    } else {
        signals.disconnect(Main.layoutManager);
        Main.layoutManager._updateHotCorners();
    }
}

var savedProps;
savedProps = savedProps || new Map();

function registerOverrideProp(obj, name, override) {
    let saved = getSavedProp(obj, name) || obj[name];
    let props = savedProps.get(obj);
    if (!props) {
        props = {};
        savedProps.set(obj, props);
    }
    props[name] = {
        saved,
        override
    };
}

function registerOverridePrototype(obj, name, override) {
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

var signals;
function init() {
    registerOverridePrototype(imports.ui.messageTray.MessageTray, '_updateState');
    registerOverridePrototype(WindowManager.WindowManager, '_prepareWorkspaceSwitch');
    registerOverridePrototype(Workspace.Workspace, '_isOverviewWindow');
    registerOverridePrototype(Workspace.WindowClone, 'getOriginalPosition');
    registerOverridePrototype(Workspace.Workspace, '_realRecalculateWindowPositions');
    registerOverridePrototype(Workspace.UnalignedLayoutStrategy, '_sortRow');
    registerOverridePrototype(WindowManager.WorkspaceTracker, '_checkWorkspaces');
    registerOverridePrototype(WindowManager.TouchpadWorkspaceSwitchAction, '_checkActivated');

    if (version[1] > 32)
        registerOverridePrototype(Workspace.UnalignedLayoutStrategy, 'computeLayout', computeLayout);

    // Kill pinch gestures as they work pretty bad (especially when 3-finger swiping)
    registerOverrideProp(imports.ui.viewSelector, "PINCH_GESTURE_THRESHOLD", 0);

    registerOverridePrototype(Workspace.Workspace, '_isOverviewWindow', (win) => {
        let metaWindow = win.meta_window;
        return Scratch.isScratchWindow(metaWindow) && !metaWindow.skip_taskbar;
    });

    signals = new utils.Signals();
}

function enable() {
    enableOverrides();

    signals.connect(settings, 'changed::override-hot-corner',
                    disableHotcorners);
    disableHotcorners();

    function onlyScratchInOverview() {
        if (settings.get_boolean('only-scratch-in-overview')) {
            enableOverride(Workspace.Workspace.prototype, '_isOverviewWindow');
        } else {
            disableOverride(Workspace.Workspace.prototype, '_isOverviewWindow');
        }
    }
    signals.connect(settings, 'changed::only-scratch-in-overview',
                    onlyScratchInOverview);
    onlyScratchInOverview();


    // Disable switching the workspace after 4 finger swipe.
    WindowManager.TouchpadWorkspaceSwitchAction.prototype._checkActivated = () => false;
    /* The «native» workspace animation can be now (3.30) be disabled as it
       calls out of the function bound to the `switch-workspace` signal.
     */
    WindowManager.WindowManager.prototype._prepareWorkspaceSwitch =
        function (from, to, direction) {
            if (this._switchData)
                return;

            let wgroup = global.window_group;
            let windows = global.get_window_actors();
            let switchData = {};

            this._switchData = switchData;
            switchData.movingWindowBin = new Clutter.Actor();
            switchData.windows = [];
            switchData.surroundings = {};
            switchData.gestureActivated = false;
            switchData.inProgress = false;

            switchData.container = new Clutter.Actor();

        };

    Workspace.WindowClone.prototype.getOriginalPosition = getOriginalPosition;
    Workspace.Workspace.prototype._realRecalculateWindowPositions = _realRecalculateWindowPositions;
    // Prevent any extra sorting of the overview
    Workspace.UnalignedLayoutStrategy.prototype._sortRow = (row) => row;


    // Don't hide notifications when there's fullscreen windows in the workspace.
    // Fullscreen windows aren't special in paperWM and might not even be
    // visible, so hiding notifications makes no sense.
    with (imports.ui.messageTray) {
        MessageTray.prototype._updateState
            = function () {
                let hasMonitor = Main.layoutManager.primaryMonitor != null;
                this.actor.visible = !this._bannerBlocked && hasMonitor && this._banner != null;
                if (this._bannerBlocked || !hasMonitor)
                    return;

                // If our state changes caused _updateState to be called,
                // just exit now to prevent reentrancy issues.
                if (this._updatingState)
                    return;

                this._updatingState = true;

                // Filter out acknowledged notifications.
                let changed = false;
                this._notificationQueue = this._notificationQueue.filter(function(n) {
                    changed = changed || n.acknowledged;
                    return !n.acknowledged;
                });

                if (changed)
                    this.emit('queue-changed');

                let hasNotifications = Main.sessionMode.hasNotifications;

                if (this._notificationState == State.HIDDEN) {
                    let nextNotification = this._notificationQueue[0] || null;
                    if (hasNotifications && nextNotification) {
                        // Monkeypatch here
                        let limited = this._busy;
                        let showNextNotification = (!limited || nextNotification.forFeedback || nextNotification.urgency == Urgency.CRITICAL);
                        if (showNextNotification)
                            this._showNotification();
                    }
                } else if (this._notificationState == State.SHOWN) {
                    let expired = (this._userActiveWhileNotificationShown &&
                                   this._notificationTimeoutId == 0 &&
                                   this._notification.urgency != Urgency.CRITICAL &&
                                   !this._banner.focused &&
                                   !this._pointerInNotification) || this._notificationExpired;
                    let mustClose = (this._notificationRemoved || !hasNotifications || expired);

                    if (mustClose) {
                        let animate = hasNotifications && !this._notificationRemoved;
                        this._hideNotification(animate);
                    } else if (this._pointerInNotification && !this._banner.expanded) {
                        this._expandBanner(false);
                    } else if (this._pointerInNotification) {
                        this._ensureBannerFocused();
                    }
                }

                this._updatingState = false;

                // Clean transient variables that are used to communicate actions
                // to updateState()
                this._notificationExpired = false;
            };
    }

    WindowManager.WorkspaceTracker.prototype._checkWorkspaces = function () {
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

        // If we don't have an empty workspace at the end, add one
        if (!emptyWorkspaces[emptyWorkspaces.length -1]) {
            workspaceManager.append_new_workspace(false, global.get_current_time());
            emptyWorkspaces.push(true);
        }

        let lastIndex = emptyWorkspaces.length - 1;
        let lastEmptyIndex = emptyWorkspaces.lastIndexOf(false) + 1;
        let activeWorkspaceIndex = workspaceManager.get_active_workspace_index();
        emptyWorkspaces[activeWorkspaceIndex] = false;

        // Delete empty workspaces except for the last one; do it from the end
        // to avoid index changes
        for (i = lastIndex; i >= 0; i--) {
            if (workspaceManager.n_workspaces <= Main.layoutManager.monitors.length + 1)
                break;
            if (emptyWorkspaces[i] && i != lastEmptyIndex) {
                let space = Tiling.spaces.spaceOf(this._workspaces[i]);
                let visibleSpace = Tiling.spaces.monitors.get(space.monitor);
                // Never remove visible spaces
                if (space !== visibleSpace) {
                    workspaceManager.remove_workspace(this._workspaces[i], global.get_current_time());
                }
            }
        }

        this._checkWorkspacesId = 0;
        return false;
    };
}

function disable() {
    disableOverrides();

    signals.destroy();
    Main.layoutManager._updateHotCorners();
}

// 3.32 overivew layout
function computeLayout(windows, layout) {
    let numRows = layout.numRows;

    let rows = [];
    let totalWidth = 0;
    for (let i = 0; i < windows.length; i++) {
        let window = windows[i];
        let s = this._computeWindowScale(window);
        totalWidth += window.width * s;
    }

    let idealRowWidth = totalWidth / numRows;
    let windowIdx = 0;
    for (let i = 0; i < numRows; i++) {
        let col = 0;
        let row = this._newRow();
        rows.push(row);

        for (; windowIdx < windows.length; windowIdx++) {
            let window = windows[windowIdx];
            let s = this._computeWindowScale(window);
            let width = window.width * s;
            let height = window.height * s;
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

    layout.rows = rows;
    layout.maxColumns = maxRow.windows.length;
    layout.gridWidth = maxRow.fullWidth;
    layout.gridHeight = gridHeight;
}
