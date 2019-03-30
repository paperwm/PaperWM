/**
  Navigation and previewing functionality.

  This is a somewhat messy tangle of functionality relying on
  `SwitcherPopup.SwitcherPopup` when we really should just take full control.
 */

var Extension = imports.misc.extensionUtils.extensions['paperwm@hedning:matrix.org'];
var SwitcherPopup = imports.ui.switcherPopup;
var Meta = imports.gi.Meta;
var Main = imports.ui.main;
var Mainloop = imports.mainloop;
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

var workspaceManager = global.workspace_manager;
var display = global.display;

var scale = 0.9;
var navigating = false;

/**
   Handle catching keyevents and dispatching actions

   Adapted from SwitcherPopup
 */
var ActionDispatcher = class {
    constructor() {
        this.actor = new Clutter.Actor();
        Main.uiGroup.add_actor(this.actor);
        if (!Main.pushModal(this.actor)) {
            // Probably someone else has a pointer grab, try again with keyboard only
            if (!Main.pushModal(this.actor, {
                options: Meta.ModalOptions.POINTER_ALREADY_GRABBED
            })) throw new Error('Could not grap a modal');;
        }

        this.actor.connect('key-press-event', this._keyPressEvent.bind(this));
        this.actor.connect('key-release-event', this._keyReleaseEvent.bind(this));

    }

    show(backward, binding, mask) {
        this._modifierMask = SwitcherPopup.primaryModifier(mask);
        this.navigator = getNavigator();
        let actionId = Keybindings.idOf(binding);
        if(actionId === Meta.KeyBindingAction.NONE) {
            try {
                // Check for built-in actions
                actionId = Meta.prefs_get_keybinding_action(binding);
            } catch(e) {
                debug("Couldn't resolve action name");
                return;
            }
        }

        this._doAction(actionId);
    }

    _keyPressEvent(actor, event) {
        let keysym = event.get_key_symbol();
        let action = global.display.get_keybinding_action(event.get_key_code(), event.get_state());

        if (this._keyPressHandler(keysym, action) != Clutter.EVENT_PROPAGATE)
            return Clutter.EVENT_STOP;

        // Popping the modal on keypress doesn't work properly, as the release
        // event will leak to the active window. To work around this we initate
        // visual destruction on key-press and signal to the release handler
        // that we should destroy the dispactcher too
        // https://github.com/paperwm/PaperWM/issues/70
        if (keysym == Clutter.Escape || keysym == Clutter.Tab) {
            this.navigator.destroy();
            this._destroy = true;
        }

        return Clutter.EVENT_STOP;
    }

    _keyReleaseEvent(actor, event) {
        let keysym = event.get_key_symbol();
        if (this._destroy) {
            this.destroy();
        }

        if (this._modifierMask) {
            let [x, y, mods] = global.get_pointer();
            let state = mods & this._modifierMask;

            if (state == 0)
                this._finish(event.get_time());
        }

        return Clutter.EVENT_STOP;
    }


    _keyPressHandler(keysym, action) {
        if (keysym !== Clutter.KEY_Escape && this._doAction(action)) {
            return Clutter.EVENT_STOP;
        } else {
            return Clutter.EVENT_PROPAGATE;
        }
    }

    _doAction(mutterActionId) {

        let action = Keybindings.byId(mutterActionId);
        let space = Tiling.spaces.selectedSpace;
        let metaWindow = space.selectedWindow;

        if (action && action.options.activeInNavigator) {
            if (action.options.opensMinimap) {
                this.navigator._showMinimap(space);
            }
            action.handler(metaWindow, space, {navigator: this.navigator});
            if (space !== Tiling.spaces.selectedSpace) {
                this.navigator.minimaps.forEach(m => typeof(m) === 'number' ?
                                                Mainloop.source_remove(m) : m.hide());
            }
            return true;
        } else if (mutterActionId == Meta.KeyBindingAction.MINIMIZE) {
            metaWindow.minimize();
        }

        return false;
    }

    _finish(timestamp) {
        debug('#preview', 'finish');
        this.navigator.accept();
        this.destroy();
    }

    destroy() {
        Main.popModal(this.actor);
        this.actor.destroy();
        !this._destroy && this.navigator.destroy();
    }
}

var navigator;
var Navigator = class Navigator {
    constructor() {
        navigating = true;
        this._block = Main.wm._blockAnimations;
        Main.wm._blockAnimations = true;
        // Meta.disable_unredirect_for_screen(screen);

        this.space = Tiling.spaces.spaceOf(workspaceManager.get_active_workspace());

        this._startWindow = this.space.selectedWindow;
        this.from = this.space;
        this.monitor = this.space.monitor;
        this.monitor.clickOverlay.hide();
        this.minimaps = new Map();

        TopBar.show();
        let selected = this.space.selectedWindow;
        if (selected &&
            (selected.fullscreen ||
             selected.get_maximized() === Meta.MaximizeFlags.BOTH)) {
            Tiling.animateDown(selected);
        }

        this.space.startAnimate();
    }

    _showMinimap(space) {
        let minimap = this.minimaps.get(space);
        if (!minimap) {
            let minimapId = Mainloop.timeout_add(200, () => {
                minimap = new Minimap.Minimap(space, this.monitor);
                space.startAnimate();
                minimap.show(false);
                this.minimaps.set(space, minimap);
            });
            this.minimaps.set(space, minimapId);
        } else {
            typeof(minimap) !== 'number' && minimap.show();
        }
    }

    accept() {
        this.was_accepted = true;
    }

    finish() {
        this.accept();
        this.destroy();
    }

    destroy() {
        this.minimaps.forEach(m => {
            if (typeof(m) === 'number')
                Mainloop.source_remove(m);
            else
                m.destroy();
        });

        if (Main.panel.statusArea.appMenu)
            Main.panel.statusArea.appMenu.container.show();

        let force = Tiling.inPreview;
        navigating = false;

        if (force) {
            this.space.monitor.clickOverlay.hide();
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
        if (selected &&
            (!force ||
             !(display.focus_window && display.focus_window.is_on_all_workspaces())) ) {

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

        if (selected && selected.fullscreen) {
            TopBar.hide();
        } else {
            TopBar.show();
        }

        Main.wm._blockAnimations = this._block;

        this.emit('destroy', this.was_accepted);
        navigator = false;
    }
}
Signals.addSignalMethods(Navigator.prototype);

function getNavigator() {
    if (navigator)
        return navigator;

    navigator = new Navigator();
    return navigator;
}

function preview_navigate(meta_window, space, {display, screen, binding}) {
    let tabPopup = new ActionDispatcher();
    tabPopup.show(binding.is_reversed(), binding.get_name(), binding.get_mask());
}
