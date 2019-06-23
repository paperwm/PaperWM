/**
  Some of Gnome Shell's default behavior is really sub-optimal when using
  paperWM. This is a collection of monkey patches and preferences which works
  around these problems.
 */

var Extension = imports.misc.extensionUtils.extensions['paperwm@hedning:matrix.org'];

var Meta = imports.gi.Meta;
var Main = imports.ui.main;
var Mainloop = imports.mainloop;
var Workspace = imports.ui.workspace;
var Shell = imports.gi.Shell;
var utils = Extension.imports.utils;

var Convenience = Extension.imports.convenience;
var Scratch = Extension.imports.scratch;
var Tiling = Extension.imports.tiling;
var settings = Convenience.getSettings();
var Clutter = imports.gi.Clutter;

function overrideHotCorners() {
    for (let corner of Main.layoutManager.hotCorners) {
        if (!corner)
            continue;

        corner._toggleOverview = function() {};

        corner._pressureBarrier._trigger = function() {};
    }
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
    if (space.indexOf(this.metaWindow) === -1) {
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

var savedMethods;
function saveMethod(obj, name) {
    let method = obj[name];
    let methods = savedMethods.get(obj);
    if (!methods) {
        methods = {};
        savedMethods.set(obj, methods);
    }
    methods[name] = method;
}

function getMethod(obj, name) {
    let methods = savedMethods.get(obj);
    return methods[name];
}


function overrideMethod(obj, name, method) {
    if (!getMethod(obj, name))
        saveMethod(obj, name);
    obj[name] = method;
}

function restoreMethod(obj, name) {
    let method = getMethod(obj, name);
    if (method)
        obj[name] = method;
}

var signals;
function init() {
    savedMethods = new Map();
    saveMethod(imports.ui.messageTray.MessageTray.prototype, '_updateState');
    saveMethod(imports.ui.windowManager.WindowManager.prototype, '_prepareWorkspaceSwitch');
    saveMethod(Workspace.Workspace.prototype, '_isOverviewWindow');
    saveMethod(Workspace.WindowClone.prototype, 'getOriginalPosition');
    saveMethod(Workspace.Workspace.prototype, '_realRecalculateWindowPositions');
    saveMethod(Workspace.UnalignedLayoutStrategy.prototype, '_sortRow');
    saveMethod(imports.ui.windowManager.WorkspaceTracker.prototype, '_checkWorkspaces');

    signals = new utils.Signals();
}

function enable() {

    signals.connect(settings, 'changed::override-hot-corner',
                    disableHotcorners);
    disableHotcorners();


    function onlyScratchInOverview() {
        let obj = Workspace.Workspace.prototype;
        let name = '_isOverviewWindow';
        if (settings.get_boolean('only-scratch-in-overview')) {
            overrideMethod(obj, name, (win) => {
                let metaWindow = win.meta_window;
                return Scratch.isScratchWindow(metaWindow) && !metaWindow.skip_taskbar;
            });
        } else {
            restoreMethod(obj, name);
        }
    }
    signals.connect(settings, 'changed::only-scratch-in-overview',
                    onlyScratchInOverview);
    onlyScratchInOverview();

    /* The «native» workspace animation can be now (3.30) be disabled as it
       calls out of the function bound to the `switch-workspace` signal.
     */
    imports.ui.windowManager.WindowManager.prototype._prepareWorkspaceSwitch =
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

    imports.ui.windowManager.WorkspaceTracker.prototype._checkWorkspaces = function () {
        let workspaceManager = global.workspace_manager;
        let i;
        let emptyWorkspaces = [];

        if (!Meta.prefs_get_dynamic_workspaces()) {
            this._checkWorkspacesId = 0;
            return false;
        }

        // Update workspaces only if Dynamic Workspace Management has not been paused by some other function
        if (this._pauseWorkspaceCheck)
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
    for (let [obj, methods] of savedMethods) {
        for (let name in methods) {
            restoreMethod(obj, name);
        }
    }

    signals.destroy();
    Main.layoutManager._updateHotCorners();
}
