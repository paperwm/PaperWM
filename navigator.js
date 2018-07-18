/**
  Navigation and previewing functionality.

  This is a somewhat messy tangle of functionality relying on
  `SwitcherPopup.SwitcherPopup` when we really should just take full control.
 */

var Extension = imports.misc.extensionUtils.extensions['paperwm@hedning:matrix.org'];
var SwitcherPopup = imports.ui.switcherPopup;
var Lang = imports.lang;
var Meta = imports.gi.Meta;
var Main = imports.ui.main;
var Clutter = imports.gi.Clutter;
var Tweener = imports.ui.tweener;
var Signals = imports.signals;

var TopBar = Extension.imports.topbar;
var Scratch = Extension.imports.scratch;
var Minimap = Extension.imports.minimap;
var Tiling = Extension.imports.tiling;
var Keybindings = Extension.imports.keybindings;
var utils = Extension.imports.utils;
var debug = utils.debug;

var prefs = Extension.imports.settings.prefs;

var screen = global.screen;
var display = global.display;

var scale = 0.9;
var navigating = false;
var workspaceMru = false;

// Dummy class to satisfy `SwitcherPopup.SwitcherPopup`
class SwitcherList {
    constructor() {
        this.actor = new Clutter.Actor();
    }
}
Signals.addSignalMethods(SwitcherList.prototype);

var PreviewedWindowNavigator = new Lang.Class({
    Name: 'PreviewedWindowNavigator',
    Extends: SwitcherPopup.SwitcherPopup,

    _yPositions: [0.95, 0.10, 0.035, 0.01],

    _init: function() {
        // Do the absolute minimal here, as `parent.show` is buggy and can
        // return early making cleanup hard. We do most initialization in
        // `_initialSelection` instead.

        // HACK: workaround to enable moving from empty workspace. See check in
        // SwitcherPopup.show
        this.parent([1]);
        this._switcherList = new SwitcherList();
        debug('#preview', 'init', this._switcherList);

    },

    _initialSelection: function(backward, actionName) {
        debug('#preview', '_initialSelection');
        TopBar.show();

        navigating = true;
        this._block = Main.wm._blockAnimations;
        Main.wm._blockAnimations = true;
        Meta.disable_unredirect_for_screen(screen);

        this.space = Tiling.spaces.spaceOf(screen.get_active_workspace());

        this._startWindow = this.space.selectedWindow;
        this.from = this.space;
        this.monitor = this.space.monitor;
        this.minimaps = new Map();

        this.space.startAnimate();

        let actionId = Keybindings.idOf(actionName);
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

    _doAction: function(mutterActionId) {

        let action = Keybindings.byId(mutterActionId);
        if (action && action.options.activeInNavigator) {
            let space = Tiling.spaces.selectedSpace;
            let metaWindow = space.selectedWindow;
            if (action.options.opensMinimap) {
                this._showMinimap(space);
            }
            action.handler(metaWindow, space);
            if (space !== Tiling.spaces.selectedSpace) {
                this.minimaps.forEach(m => m.hide());
            }
            return true;
        }

        return false;
    },

    _keyPressHandler: function(keysym, action) {
        if (keysym !== Clutter.KEY_Escape && this._doAction(action)) {
            return Clutter.EVENT_STOP;
        } else {
            return Clutter.EVENT_PROPAGATE;
        }
    },

    _showMinimap(space) {
        let minimap = this.minimaps.get(space);
        if (!minimap) {
            minimap = new Minimap.Minimap(space, this.monitor);
            this.minimaps.set(space, minimap);
            space.startAnimate();
            minimap.show(true);
        } else {
            minimap.show();
        }
    },

    _select: function(position) {
        // debug('#preview', 'Select', this.space[index][0].title, index);
        if (!position)
            return;
        let metaWindow = this.space.getWindow(...position);
        if (metaWindow) {
            this._showMinimap();
            Tiling.ensureViewport(metaWindow, this.space);
        }
    },

    _finish: function(timestamp) {
        debug('#preview', 'finish');
        this.was_accepted = true;
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

    destroy: function() {
        debug('#preview', 'destroy', this.space.actor);

        this.minimaps.forEach(m => m.destroy());

        if (Main.panel.statusArea.appMenu)
            Main.panel.statusArea.appMenu.container.show();
        if (workspaceMru)
            this.space.monitor.clickOverlay.hide();

        let force = Tiling.spaces._inPreview;
        navigating = false; workspaceMru = false;

        if (force) {
            this.space = Tiling.spaces.selectedSpace;
        }

        let from = this.from;
        if(!this.was_accepted) {
            // Abort the navigation
            this.space = from;
            if (this.startWindow && this._startWindow.get_compositor_private())
                this.space.selectedWindow = this._startWindow;
            else
                this.space.selectedWindow = display.focus_window;
        }

        if (this.monitor !== this.space.monitor) {
            this.space.setMonitor(this.monitor, true);
        }

        for (let monitor of Main.layoutManager.monitors) {
            if (monitor === this.monitor || !monitor.clickOverlay)
                continue;
            monitor.clickOverlay.activate();
        }

        if (this.space === from && force) {
            // Animate the selected space into full view - normally this
            // happens on workspace switch, but activating the same workspace
            // again doesn't trigger a switch signal
            Tiling.spaces.animateToSpace(this.space);
        }

        let selected = this.space.selectedWindow;
        if (selected && !Scratch.isScratchActive()) {
            if (selected !== display.focus_window) {
                Main.activateWindow(selected);
            } else {
                // Typically on cancel - the `focus` signal won't run
                // automatically, so we run it manually
                Tiling.focus_handler(selected);
            }
            debug('#preview', 'Finish', selected.title);
        } else {
            this.space.workspace.activate(global.get_current_time());
        }

        if (this._moving) {
            Scratch.unmakeScratch(this._moving);
        }

        if (selected && selected.fullscreen) {
            TopBar.hide();
        } else {
            TopBar.show();
        }

        Main.wm._blockAnimations = this._block;

        this.actor.hide(); // Prevents finalized crap
        this.parent();
    }
});

function preview_navigate(meta_window, space, {display, screen, binding}) {
    let tabPopup = new PreviewedWindowNavigator();
    tabPopup.show(binding.is_reversed(), binding.get_name(), binding.get_mask());
}
