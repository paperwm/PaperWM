/*
  Navigation and previewing functionality.
 */

const Extension = imports.misc.extensionUtils.extensions['paperwm@hedning:matrix.org'];
const SwitcherPopup = imports.ui.switcherPopup;
const WindowManager = imports.ui.windowManager;
const Lang = imports.lang;
const Meta = imports.gi.Meta;
const Main = imports.ui.main;
const Clutter = imports.gi.Clutter;
const Tweener = imports.ui.tweener;

const Minimap = Extension.imports.minimap;
const Tiling = Extension.imports.tiling;
const utils = Extension.imports.utils;
const debug = utils.debug;

var PreviewedWindowNavigator = new Lang.Class({
    Name: 'PreviewedWindowNavigator',
    Extends: SwitcherPopup.SwitcherPopup,

    _init: function() {
        this.parent();

        this._switcherList = new Minimap.MultiMap(true);
        this.space = this._switcherList.getSelected().space;

        this._switcherList.onlyShowSelected();

        // HACK: workaround to enable moving from empty workspace. See check in
        // SwitcherPopup.show
        this._items = [1];

        this._selectedIndex = this.space.selectedIndex();
        // debug('#preview', 'Init', this.space[this._selectedIndex].title, this._selectedIndex);
    },

    _next: function() {
        return Math.min(this.space.length-1, this._selectedIndex+1)
    },
    _previous: function() {
        return Math.max(0, this._selectedIndex-1)
    },

    _initialSelection: function(backward, actionName) {
        let paperActions = Extension.imports.extension.paperActions;
        let actionId = paperActions.idOf(actionName);
        if(actionId === Meta.KeyBindingAction.NONE) {
            try {
                // Check for built-in actions
                actionId = Meta.prefs_get_keybinding_action(actionName);
            } catch(e) {
                debug("Couldn't resolve action name");
                return;
            }
        }

        this._doAction(actionId);
    },

    _reorder: function (index, targetIndex) {
        function swapArray(array, i, j) {
            let temp = array[i];
            array[i] = array[j];
            array[j] = temp;
        }

        swapArray(this.space, index, targetIndex);

        let metaWindow = this.space[targetIndex];
        let newX = Tiling.ensure_viewport(this.space, metaWindow, true);

        this._selectedIndex = targetIndex;

        this._switcherList.getSelected().reorder(index, targetIndex, newX);
        this._switcherList.highlight(targetIndex);
    },

    selectSpace: function(direction, move) {
        if (Main.panel.statusArea.appMenu)
            Main.panel.statusArea.appMenu.container.hide();

        let multimap = this._switcherList;
        multimap.showAll();
        let from = multimap.selectedIndex;
        let to;
        if (direction === Meta.MotionDirection.DOWN)
            to = from + 1;
        else
            to = from - 1;
        if (to < 0 || to >= multimap.minimaps.length) {
            this._select(this.space.selectedIndex());
            return true;
        }
        let oldMap = multimap.getSelected();
        let newMap = multimap.setSelected(to);
        Main.wm._previewWorkspaceDone();

        if (move) {
            let selectedWindow = this.space.selectedWindow;
            Main.wm._movingWindow = selectedWindow;
            selectedWindow.change_workspace(newMap.space.workspace);
            oldMap.refresh();
            newMap.refresh();
            oldMap.fold();
            newMap.space.selectedWindow = selectedWindow;
            newMap.space.moving = false;
        }

        // This will crash gnome-shell if one of the workspaces have been removed
        Main.wm._previewWorkspace(oldMap.space.workspace,
                                  newMap.space.workspace);
        this.space = newMap.space;
        this._select(this.space.selectedIndex());
    },

    _doAction: function(mutterActionId) {
        let paperActions = Extension.imports.extension.paperActions;
        if (mutterActionId === paperActions.idOf("switch-next")) {
            this._select(this._next());
            return true;
        } else if (mutterActionId === paperActions.idOf("switch-previous")) {
            this._select(this._previous());
            return true;
        } else if (mutterActionId === paperActions.idOf("move-left")) {
            this._reorder(this._selectedIndex, this._previous());
            return true;
        } else if (mutterActionId === paperActions.idOf("move-right")) {
            this._reorder(this._selectedIndex, this._next());
            return true;
        } else if (mutterActionId
                   === paperActions.idOf('previous-workspace-backward')) {
            this.selectSpace(Meta.MotionDirection.UP);
            return true;
        } else if (mutterActionId === paperActions.idOf('previous-workspace')) {
            this.selectSpace(Meta.MotionDirection.DOWN);
            return true;
        } else if (mutterActionId
                   === paperActions.idOf('move-previous-workspace')) {
            this.selectSpace(Meta.MotionDirection.DOWN, true);
            return true;
        } else if (mutterActionId
                   === paperActions.idOf('move-previous-workspace-backward')) {
            this.selectSpace(Meta.MotionDirection.UP, true);
            return true;
        } else {
            let action = paperActions.byId(mutterActionId);
            if (action && action.name !== 'toggle-scratch-layer') {
                let metaWindow = this.space[this._selectedIndex];
                action.handler(null, null, metaWindow);
                let minimap = this._switcherList.getSelected();
                minimap.layout();
                minimap.sync(metaWindow.destinationX);
                this._switcherList.highlight(this._selectedIndex);
                return true;
            }
        }

        return false;
    },

    _keyPressHandler: function(keysym, action) {
        if (this._doAction(action)) {
            return Clutter.EVENT_STOP;
        } else {
            return Clutter.EVENT_PROPAGATE;
        }
    },

    _select: function(index) {
        // debug('#preview', 'Select', this.space[index].title, index);
        let metaWindow = this.space[index];
        if (metaWindow) {
            this.space.selectedWindow = metaWindow;
            let newX = Tiling.ensure_viewport(this.space, metaWindow);
            if (newX !== undefined) {
                this._switcherList.getSelected().sync(newX);
            }
        }
        this._selectedIndex = index;
        this._switcherList.highlight(index);
    },

    destroy: function() {
        this.parent();
    },

    _finish: function(timestamp) {
        this.was_accepted = true;
        if (this.space.length === 0) {
            this.space.workspace.activate(global.get_current_time());
        } else {
            Main.activateWindow(this.space[this._selectedIndex]);
            debug('#preview', 'Finish', this.space[this._selectedIndex].title, this._selectedIndex);
        }
        // Finish workspace preview _after_ activate, that way the new animation
        // triggered by activate gets killed immediately
        Main.wm._previewWorkspaceDone();
        this.parent(timestamp);
    },

    _itemEnteredHandler: function() {
        // The item-enter (mouse hover) event is triggered even after a item is
        // accepted. This can cause _select to run on the item below the pointer
        // ensuring the wrong window.
        if(!this.was_accepted) {
            this.parent.apply(this, arguments);
        }
    },

    _onDestroy: function() {
        if (Main.panel.statusArea.appMenu)
            Main.panel.statusArea.appMenu.container.show();
        debug('#preview', 'onDestroy', this.was_accepted);
        Main.wm._previewWorkspaceDone();
        if(!this.was_accepted) {
            debug('#preview', 'Abort', global.display.focus_window.title);
            let focus = global.display.focus_window;
            if (focus.get_workspace() !== this.space.workspace) {
                Main.wm._previewWorkspace(this.space.workspace, focus.get_workspace(),
                    () => Main.wm._previewWorkspaceDone()
                );
            }
            Tiling.ensure_viewport(Tiling.spaces.spaceOfWindow(focus), focus);
        }
        this.parent();
    }
});

function preview_navigate(display, screen, meta_window, binding) {
    let tabPopup = new PreviewedWindowNavigator();
    tabPopup.show(binding.is_reversed(), binding.get_name(), binding.get_mask())
}


var TopBar = Extension.imports.topbar;
WindowManager.WindowManager.prototype._previewWorkspace = function(from, to, callback) {

    TopBar.updateWorkspaceIndicator(to.index());

    let windows = global.get_window_actors();

    let xDest = 0, yDest = global.screen_height;

    let switchData = {};
    this._switchData = switchData;
    switchData.inGroup = new Clutter.Actor();
    switchData.outGroup = new Clutter.Actor();
    switchData.movingWindowBin = new Clutter.Actor();
    switchData.windows = [];

    let wgroup = global.window_group;
    wgroup.add_actor(switchData.inGroup);
    wgroup.add_actor(switchData.outGroup);
    wgroup.add_actor(switchData.movingWindowBin);

    for (let i = 0; i < windows.length; i++) {
        let actor = windows[i];
        let window = actor.get_meta_window();

        if (!window.showing_on_its_workspace())
            continue;

        if (window.is_on_all_workspaces())
            continue;

        let record = { window: actor,
                       parent: actor.get_parent() };

        if (this._movingWindow && window == this._movingWindow) {
            switchData.movingWindow = record;
            switchData.windows.push(switchData.movingWindow);
            actor.reparent(switchData.movingWindowBin);
        } else if (window.get_workspace() == from) {
            switchData.windows.push(record);
            actor.reparent(switchData.outGroup);
        } else if (window.get_workspace() == to) {
            switchData.windows.push(record);
            actor.reparent(switchData.inGroup);
            actor.show();
        }
    }

    switchData.inGroup.set_position(-xDest, global.screen_height);
    switchData.inGroup.raise_top();

    switchData.movingWindowBin.raise_top();

    Tweener.addTween(switchData.outGroup,
                     { x: xDest,
                       y: yDest,
                       time: 0.25,
                       transition: 'easeInOutQuad',
                     });
    Tweener.addTween(switchData.inGroup,
                     { x: 0,
                       y: 0,
                       time: 0.25,
                       transition: 'easeInOutQuad',
                       onComplete: callback,
                     });
}

WindowManager.WindowManager.prototype._previewWorkspaceDone = function() {
    let switchData = this._switchData;
    if (!switchData)
        return;
    this._switchData = null;

    for (let i = 0; i < switchData.windows.length; i++) {
        let w = switchData.windows[i];
        if (w.window.is_destroyed()) // Window gone
            continue;
        if (w.window.get_parent() == switchData.outGroup) {
            w.window.reparent(w.parent);
            w.window.hide();
        } else
            w.window.reparent(w.parent);
    }
    Tweener.removeTweens(switchData.inGroup);
    Tweener.removeTweens(switchData.outGroup);
    switchData.inGroup.destroy();
    switchData.outGroup.destroy();
    switchData.movingWindowBin.destroy();

    if (this._movingWindow)
        this._movingWindow = null;
}
