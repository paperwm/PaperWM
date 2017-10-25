
const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const Meta = imports.gi.Meta;
const AltTab = imports.ui.altTab;
const Main = imports.ui.main;
let WindowManager = imports.ui.windowManager;
const Extension = imports.misc.extensionUtils.getCurrentExtension();
const Scratch = Extension.imports.scratch;

WindowManager.WindowManager.prototype._previewWorkspace = function(from, to, direction) {

    let windows = global.get_window_actors();

    /* @direction is the direction that the "camera" moves, so the
     * screen contents have to move one screen's worth in the
     * opposite direction.
     */
    let xDest = 0, yDest = 0;

    if (direction == Meta.MotionDirection.UP ||
        direction == Meta.MotionDirection.UP_LEFT ||
        direction == Meta.MotionDirection.UP_RIGHT)
        yDest = global.screen_height;
    else if (direction == Meta.MotionDirection.DOWN ||
             direction == Meta.MotionDirection.DOWN_LEFT ||
             direction == Meta.MotionDirection.DOWN_RIGHT)
        yDest = -global.screen_height;

    if (direction == Meta.MotionDirection.LEFT ||
        direction == Meta.MotionDirection.UP_LEFT ||
        direction == Meta.MotionDirection.DOWN_LEFT)
        xDest = global.screen_width;
    else if (direction == Meta.MotionDirection.RIGHT ||
             direction == Meta.MotionDirection.UP_RIGHT ||
             direction == Meta.MotionDirection.DOWN_RIGHT)
        xDest = -global.screen_width;

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
        } else if (window.get_workspace().index() == from) {
            switchData.windows.push(record);
            actor.reparent(switchData.outGroup);
        } else if (window.get_workspace().index() == to) {
            switchData.windows.push(record);
            actor.reparent(switchData.inGroup);
            actor.show();
        }
    }

    switchData.inGroup.set_position(-xDest, -yDest);
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
                       transition: 'easeInOutQuad'
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

LiveAltTab = Lang.Class({
    Name: 'LiveAltTab',
    Extends: AltTab.WindowSwitcherPopup,

    _getWindowList: function () {
        let tabList = global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null);
        if (Scratch.isScratchActive()) {
            // Force scratch windows on top as a poor mans substitute for the
            // scratch layer actually changing the MRU list
            let scratchWindows = Scratch.getScratchWindows();
            let normalWindows = tabList.filter(mw => !Scratch.isScratchWindow(mw))
            return scratchWindows.concat(normalWindows);
        } else {
            return tabList;
        }
    },

    _keyPressHandler: function(keysym, action) {
        switch(action) {
        case Meta.KeyBindingAction.SWITCH_APPLICATIONS:
            action = Meta.KeyBindingAction.SWITCH_WINDOWS;
            break;
        case Meta.KeyBindingAction.SWITCH_APPLICATIONS_BACKWARD:
            action = Meta.KeyBindingAction.SWITCH_WINDOWS_BACKWARD;
            break;
        }
        return this.parent(keysym, action)
    },

    _select: function(num) {

        if (this.switchedWorkspace) {
            Main.wm._previewWorkspaceDone(global.window_manager);
            this.switchedWorkspace = false;
        }

        let from = this._switcherList.windows[this._selectedIndex];
        let to = this._switcherList.windows[num];

        let fromIndex = from.get_workspace().workspace_index;
        let toIndex = to.get_workspace().workspace_index;
        if (toIndex !== fromIndex) {
            let direction = fromIndex < toIndex ? Meta.MotionDirection.DOWN : Meta.MotionDirection.UP;
            Main.wm._previewWorkspace(from.get_workspace().workspace_index,
                                      to.get_workspace().workspace_index,
                                      direction)
            this.switchedWorkspace = true;
        }

        let space = spaces.spaceOfWindow(to);
        ensure_viewport(space, to);
        this._selectedIndex = num;
        this._switcherList.highlight(num);
    },

    _finish: function() {
        this.parent();

        this.was_accepted = true;
        Main.wm._previewWorkspaceDone(global.window_manager);
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
        debug('#preview', 'onDestroy', this.was_accepted);
        if(!this.was_accepted) {
            // Select the starting window
            this._select(0);
            Main.wm._previewWorkspaceDone(global.window_manager);
        }
        this.parent();
    }
})


liveAltTab = (display, screen, meta_window, binding) => {
    let tabPopup = new LiveAltTab();
    tabPopup.show(binding.is_reversed(), binding.get_name(), binding.get_mask());
}
