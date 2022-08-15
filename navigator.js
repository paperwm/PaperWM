/**
  Navigation and previewing functionality.

  This is a somewhat messy tangle of functionality relying on
  `SwitcherPopup.SwitcherPopup` when we really should just take full control.
 */

var Extension;
if (imports.misc.extensionUtils.extensions) {
    Extension = imports.misc.extensionUtils.extensions["paperwm@hedning:matrix.org"];
} else {
    Extension = imports.ui.main.extensionManager.lookup("paperwm@hedning:matrix.org");
}

var SwitcherPopup = imports.ui.switcherPopup;
var Meta = imports.gi.Meta;
var Main = imports.ui.main;
var Mainloop = imports.mainloop;
var GLib = imports.gi.GLib;
var Clutter = imports.gi.Clutter;
var Tweener = Extension.imports.utils.tweener;
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
var grab = false;

/**
   Handle catching keyevents and dispatching actions

   Adapted from SwitcherPopup, without any visual handling.
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
        grab = true;

        this.actor.connect('key-press-event', this._keyPressEvent.bind(this));
        this.actor.connect('key-release-event', this._keyReleaseEvent.bind(this));

        this._noModsTimeoutId = 0;
    }

    show(backward, binding, mask) {
        this._modifierMask = SwitcherPopup.primaryModifier(mask);
        this.navigator = getNavigator();
        TopBar.fixTopBar();
        let actionId = Keybindings.idOf(binding);
        if(actionId === Meta.KeyBindingAction.NONE) {
            try {
                // Check for built-in actions
                actionId = Meta.prefs_get_keybinding_action(binding);
            } catch(e) {
                debug("Couldn't resolve action name");
                return false;
            }
        }

        this._doAction(actionId);

        // There's a race condition; if the user released Alt before
        // we got the grab, then we won't be notified. (See
        // https://bugzilla.gnome.org/show_bug.cgi?id=596695 for
        // details.) So we check now. (straight from SwitcherPopup)
        if (this._modifierMask) {
            let [x, y, mods] = global.get_pointer();
            if (!(mods & this._modifierMask)) {
                this._finish(global.get_current_time());
                return false;
            }
        } else {
            this._resetNoModsTimeout();
        }

        return true;
    }

    _resetNoModsTimeout() {
        if (this._noModsTimeoutId != 0)
            Mainloop.source_remove(this._noModsTimeoutId);

        this._noModsTimeoutId = Mainloop.timeout_add(0,
                                                     () => {
                                                         this._finish(global.get_current_time());
                                                         this._noModsTimeoutId = 0;
                                                         return GLib.SOURCE_REMOVE;
                                                     });
    }

    _keyPressEvent(actor, event) {
        let keysym = event.get_key_symbol();
        let action = global.display.get_keybinding_action(event.get_key_code(), event.get_state());

        // Popping the modal on keypress doesn't work properly, as the release
        // event will leak to the active window. To work around this we initate
        // visual destruction on key-press and signal to the release handler
        // that we should destroy the dispactcher too
        // https://github.com/paperwm/PaperWM/issues/70
        if (keysym == Clutter.KEY_Escape) {
            this.navigator.destroy();
            this._destroy = true;
            return Clutter.EVENT_STOP;
        }

        this._doAction(action);

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
        } else {
            this._resetNoModsTimeout();
        }

        return Clutter.EVENT_STOP;
    }

    _doAction(mutterActionId) {

        let action = Keybindings.byId(mutterActionId);
        let space = Tiling.spaces.selectedSpace;
        let metaWindow = space.selectedWindow;

        if (action && action.options.activeInNavigator) {
            if (!metaWindow && (action.options.mutterFlags & Meta.KeyBindingFlags.PER_WINDOW)) {
                return;
            }

            if (!Tiling.inGrab && action.options.opensMinimap) {
                this.navigator._showMinimap(space);
            }
            action.handler(metaWindow, space, {navigator: this.navigator});
            if (space !== Tiling.spaces.selectedSpace) {
                this.navigator.minimaps.forEach(m => typeof(m) === 'number' ?
                                                Mainloop.source_remove(m) : m.hide());
            }
            if (Tiling.inGrab && !Tiling.inGrab.dnd && Tiling.inGrab.window) {
                Tiling.inGrab.beginDnD();
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
        grab = false;
        if (this._noModsTimeoutId != 0)
            Mainloop.source_remove(this._noModsTimeoutId);
        Main.popModal(this.actor);
        this.actor.destroy();
        this.actor = null;
        // We have already destroyed the navigator
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

        TopBar.fixTopBar();

        Scratch.animateWindows();
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

    finish(space, focus) {
        if (grab)
            return;
        this.accept();
        this.destroy(space, focus);
    }

    destroy(space, focus) {
        this.minimaps.forEach(m => {
            if (typeof(m) === 'number')
                Mainloop.source_remove(m);
            else
                m.destroy();
        });

        if (Tiling.inGrab && !Tiling.inGrab.dnd) {
            Tiling.inGrab.beginDnD()
        }

        if (Main.panel.statusArea.appMenu)
            Main.panel.statusArea.appMenu.container.show();

        let force = Tiling.inPreview;
        navigating = false;

        if (force) {
            this.space.monitor.clickOverlay.hide();
        }

        this.space = space || Tiling.spaces.selectedSpace;

        let from = this.from;
        let selected = this.space.selectedWindow;
        if(!this.was_accepted) {
            // Abort the navigation
            this.space = from;
            if (this.startWindow && this._startWindow.get_compositor_private())
                selected = this._startWindow;
            else
                selected = display.focus_window;
        }

        let visible = [];
        for (let monitor of Main.layoutManager.monitors) {
            visible.push( Tiling.spaces.monitors.get(monitor));
            if (monitor === this.monitor)
                continue;
            monitor.clickOverlay.activate();
        }

        if (!visible.includes(space) && this.monitor !== this.space.monitor) {
            this.space.setMonitor(this.monitor, true);
        }

        if (this.space === from) {
            // Animate the selected space into full view - normally this
            // happens on workspace switch, but activating the same workspace
            // again doesn't trigger a switch signal
            if (force) {
                const workspaceId = this.space.workspace.index();
                Tiling.spaces.switchWorkspace(null, workspaceId, workspaceId);
            }
        } else {
            if (Tiling.inGrab && Tiling.inGrab.window) {
                this.space.workspace.activate_with_focus(Tiling.inGrab.window, global.get_current_time());
            } else {
                this.space.workspace.activate(global.get_current_time());
            }
        }

        selected = this.space.indexOf(selected) !== -1 ? selected :
                   this.space.selectedWindow;

        let curFocus = display.focus_window;
        if (force && curFocus && curFocus.is_on_all_workspaces())
            selected = curFocus;

        if (focus)
            selected = focus;

        if (selected && !Tiling.inGrab) {
            let hasFocus = selected && selected.has_focus();
            selected.foreach_transient(mw => hasFocus = mw.has_focus() || hasFocus);
            if (hasFocus) {
                Tiling.focus_handler(selected)
            } else {
                Main.activateWindow(selected);
            }
        }
        if (selected && Tiling.inGrab && !this.was_accepted) {
            Tiling.focus_handler(selected)
        }

        if (!Tiling.inGrab)
            Scratch.showWindows();

        TopBar.fixTopBar();

        Main.wm._blockAnimations = this._block;
        this.space.moveDone();

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
