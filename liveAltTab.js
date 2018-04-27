var Extension = imports.misc.extensionUtils.extensions['paperwm@hedning:matrix.org'];
var Clutter = imports.gi.Clutter;
var Lang = imports.lang;
var Meta = imports.gi.Meta;
var AltTab = imports.ui.altTab;
var Main = imports.ui.main;

var Scratch = Extension.imports.scratch;
var Tiling = Extension.imports.tiling;
var utils = Extension.imports.utils;
var debug = utils.debug;

var LiveAltTab = Lang.Class({
    Name: 'LiveAltTab',
    Extends: AltTab.WindowSwitcherPopup,

    _getWindowList: function () {
        let tabList = global.display.get_tab_list(Meta.TabList.NORMAL_ALL,
                                                  global.screen.get_active_workspace());

        this._block = Main.wm._blockAnimations;
        Main.wm._blockAnimations = true;

        if (Scratch.isScratchActive()) {
            return Scratch.getScratchWindows();
        } else {
            return tabList;
        }
    },

    _keyPressHandler: function(keysym, action) {
        // After the first super-tab the action we get is apparently
        // SWITCH_APPLICATIONS so we need to case on those too.
        let paperActions = Extension.imports.extension.paperActions;
        switch(action) {
        case Meta.KeyBindingAction.SWITCH_APPLICATIONS:
            action = Meta.KeyBindingAction.SWITCH_WINDOWS;
            break;
        case Meta.KeyBindingAction.SWITCH_APPLICATIONS_BACKWARD:
            action = Meta.KeyBindingAction.SWITCH_WINDOWS_BACKWARD;
            break;
        case paperActions.idOf('live-alt-tab'):
            action = Meta.KeyBindingAction.SWITCH_WINDOWS;
            break;
            ;;
        case paperActions.idOf('live-alt-tab-backward'):
            action = Meta.KeyBindingAction.SWITCH_WINDOWS_BACKWARD;
            break;
            ;;
        }
        return this.parent(keysym, action)
    },

    _select: function(num) {

        let from = this._switcherList.windows[this._selectedIndex];
        let to = this._switcherList.windows[num];

        this.clone && this.clone.destroy();
        // Show pseudo focused scratch windows
        if (Scratch.isScratchWindow(to)) {
            let actor = to.get_compositor_private();
            let clone = new Clutter.Clone({source: actor});
            clone.position = actor.position;
            this.clone = clone;
            Main.uiGroup.add_child(clone);
            // Raise the switcherpopup to the top
            Main.uiGroup.set_child_above_sibling(this.actor, clone);
        }

        let space = Tiling.spaces.spaceOfWindow(to);
        Tiling.ensureViewport(to, space);
        this._selectedIndex = num;
        this._switcherList.highlight(num);
    },

    _finish: function() {
        this.parent();
        this.was_accepted = true;
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
        Main.wm._blockAnimations = this._block;
        if(!this.was_accepted) {
            // Select the starting window
            this._select(0);
        }
        this.clone && this.clone.destroy();
        this.parent();
    }
})

function liveAltTab(display, screen, meta_window, binding) {
    let tabPopup = new LiveAltTab();
    tabPopup.show(binding.is_reversed(), binding.get_name(), binding.get_mask());
}
