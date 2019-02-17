var Extension = imports.misc.extensionUtils.extensions['paperwm@hedning:matrix.org'];
var Clutter = imports.gi.Clutter;
var Lang = imports.lang;
var Meta = imports.gi.Meta;
var AltTab = imports.ui.altTab;
var Main = imports.ui.main;
var Tweener = imports.ui.tweener;

var Scratch = Extension.imports.scratch;
var Tiling = Extension.imports.tiling;
var Keybindings = Extension.imports.keybindings;
var utils = Extension.imports.utils;
var debug = utils.debug;

var prefs = Extension.imports.settings.prefs;

var LiveAltTab = Lang.Class({
    Name: 'LiveAltTab',
    Extends: AltTab.WindowSwitcherPopup,

    _getWindowList: function () {
        let tabList = global.display.get_tab_list(
            Meta.TabList.NORMAL_ALL,
            global.workspace_manager.get_active_workspace())
            .filter(w => !Scratch.isScratchWindow(w));

        let scratch = Scratch.getScratchWindows();

        if (Scratch.isScratchActive()) {
            return scratch.concat(tabList);
        } else {
            // Access scratch windows in mru order with shift-super-tab
            return tabList.concat(scratch.reverse());
        }
    },

    _initialSelection: function(backward, actionName) {
        this._block = Main.wm._blockAnimations;
        Main.wm._blockAnimations = true;
        this.space = Tiling.spaces.selectedSpace;
        this.space.startAnimate();

        let monitor = Tiling.spaces.selectedSpace;
        let workArea = Main.layoutManager.getWorkAreaForMonitor(monitor.index);
        let fog = new Clutter.Actor({x: workArea.x, y: workArea.y,
                                     width: workArea.width, height: workArea.height,
                                     opacity: 0
                                    });

        this.blur = new Clutter.BlurEffect();
        this.space.cloneContainer.add_effect(this.blur);
        this.space.setSelectionInactive();
        fog.background_color = Clutter.color_from_string("black")[1];
        Tweener.addTween(fog, {
            time: prefs.animation_time,
            transition: 'easeInOutQuad',
            opacity: 100,
        });

        Main.uiGroup.insert_child_above(fog, global.window_group);
        this.fog = fog;

        this.parent(backward, actionName);
    },

    _keyPressHandler: function(keysym, mutterActionId) {
        if (keysym === Clutter.KEY_Escape)
            return Clutter.EVENT_PROPAGATE;
        // After the first super-tab the mutterActionId we get is apparently
        // SWITCH_APPLICATIONS so we need to case on those too.
        switch(mutterActionId) {
        case Meta.KeyBindingAction.SWITCH_APPLICATIONS:
            mutterActionId = Meta.KeyBindingAction.SWITCH_WINDOWS;
            break;
        case Meta.KeyBindingAction.SWITCH_APPLICATIONS_BACKWARD:
            mutterActionId = Meta.KeyBindingAction.SWITCH_WINDOWS_BACKWARD;
            break;
        case Keybindings.idOf('live-alt-tab'):
            mutterActionId = Meta.KeyBindingAction.SWITCH_WINDOWS;
            break;
            ;;
        case Keybindings.idOf('live-alt-tab-backward'):
            mutterActionId = Meta.KeyBindingAction.SWITCH_WINDOWS_BACKWARD;
            break;
            ;;
        }
        let action = Keybindings.byId(mutterActionId);
        if (action && action.options.activeInNavigator) {
            let space = Tiling.spaces.selectedSpace;
            let metaWindow = space.selectedWindow;
            action.handler(metaWindow, space);
            return true;
        }
        return this.parent(keysym, mutterActionId);
    },

    _select: function(num) {

        let from = this._switcherList.windows[this._selectedIndex];
        let to = this._switcherList.windows[num];

        this.clone && this.clone.destroy();

        let actor = to.get_compositor_private();
        let frame = to.get_frame_rect();
        let clone = new Clutter.Clone({source: actor});
        clone.position = actor.position;

            let space = Tiling.spaces.spaceOfWindow(to);
        if (space.indexOf(to) !== -1) {
            let x = Tiling.ensuredX(to, space) + space.monitor.x;
        clone.x = x + space.monitor.x ;
        clone.x -= frame.x - actor.x;
        }

        this.clone = clone;
        Main.uiGroup.insert_child_above(clone, this.fog);

        // Tiling.ensureViewport(to, space);
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
        Tweener.addTween(this.fog, {
            time: prefs.animation_time,
            opacity: 0,
            transition: 'easeInOutQuad',
            onComplete: () => {
                this.fog.destroy();
                this.space.cloneContainer.remove_effect(this.blur);
                this.clone && this.clone.destroy();
            }
        });
        let to = this._switcherList.windows[this._selectedIndex];
        this.parent();
        Tiling.focus_handler(to);
    }
})

function liveAltTab(meta_window, space, {display, screen, binding}) {
    let tabPopup = new LiveAltTab();
    tabPopup.show(binding.is_reversed(), binding.get_name(), binding.get_mask());
}
