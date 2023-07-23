/**
  Navigation and previewing functionality.

  This is a somewhat messy tangle of functionality relying on
  `SwitcherPopup.SwitcherPopup` when we really should just take full control.
 */

const Module = imports.misc.extensionUtils.getCurrentExtension().imports.module;
const Minimap = Module.Extension.imports.minimap;

const Meta = imports.gi.Meta;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
/** @type {import('@gi-types/clutter10')} */
const Clutter = imports.gi.Clutter;
const Signals = imports.signals;

const display = global.display;
const stage = global.stage;

var workspaceManager = global.workspace_manager;

var scale = 0.9;
var navigating = false;
var grab = null;

/** @type {ActionDispatcher} */
var dispatcher = null

function dec2bin(dec) {
    return (dec >>> 0).toString(2);
}

const modMask = Clutter.ModifierType.SUPER_MASK |
    Clutter.ModifierType.HYPER_MASK |
    Clutter.ModifierType.META_MASK |
    Clutter.ModifierType.CONTROL_MASK |
    Clutter.ModifierType.MOD1_MASK |
    // Clutter.ModifierType.MOD2_MASK | uhmm, for some reason this is triggered on keygrab
    Clutter.ModifierType.MOD3_MASK |
    Clutter.ModifierType.MOD4_MASK |
    Clutter.ModifierType.MOD5_MASK

function getModLock(mods) {
    return mods & modMask
}

/**
   Handle catching keyevents and dispatching actions

   Adapted from SwitcherPopup, without any visual handling.
 */
class ActionDispatcher {
    /**@type {import('@gi-types/clutter10').GrabState} */
    mode;

    constructor() {
        Module.Utils().debug("#dispatch", "created")
        this.signals = Module.Signals();
        this.actor = Module.Tiling().spaces.spaceContainer;
        this.actor.set_flags(Clutter.ActorFlags.REACTIVE);
        this.navigator = getNavigator();

        if (grab) {
            Module.Utils().debug("#dispatch", "already in grab")
            return;
        }

        // grab = stage.grab(this.actor)
        grab = Main.pushModal(this.actor)
        // We expect at least a keyboard grab here
        if ((grab.get_seat_state() & Clutter.GrabState.KEYBOARD) === 0) {
            console.error("Failed to grab modal");
            throw new Error('Could not grab modal')
        }

        this.signals.connect(this.actor, 'key-press-event', this._keyPressEvent.bind(this))
        this.signals.connect(this.actor, 'key-release-event', this._keyReleaseEvent.bind(this))

        this._noModsTimeoutId = null;
        this._doActionTimeout = null;
    }

    show(backward, binding, mask) {
        this._modifierMask = getModLock(mask);
        this.navigator = getNavigator();
        Module.TopBar().fixTopBar();
        let actionId = Module.Keybindings().idOf(binding);
        if (actionId === Meta.KeyBindingAction.NONE) {
            try {
                // Check for built-in actions
                actionId = Meta.prefs_get_keybinding_action(binding);
            } catch(e) {
                Module.Utils().debug("Couldn't resolve action name");
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
        Module.Utils().timeout_remove(this._noModsTimeoutId);
        this._noModsTimeoutId = Mainloop.timeout_add(
            0, () => {
                this._finish(global.get_current_time());
                this._noModsTimeoutId = null;
                return false; // stops timeout recurrence
            });
    }

    _keyPressEvent(actor, event) {
        if (!this._modifierMask) {
            this._modifierMask = getModLock(event.get_state())
        }
        let keysym = event.get_key_symbol();
        let action = global.display.get_keybinding_action(event.get_key_code(), event.get_state());

        // Popping the modal on keypress doesn't work properly, as the release
        // event will leak to the active window. To work around this we initate
        // visual destruction on key-press and signal to the release handler
        // that we should destroy the dispactcher too
        // https://github.com/paperwm/PaperWM/issues/70
        if (keysym == Clutter.KEY_Escape) {
            this._destroy = true;
            getNavigator().accept();
            getNavigator().destroy();
            return Clutter.EVENT_STOP;
        }

        this._doAction(action);

        return Clutter.EVENT_STOP;
    }

    _keyReleaseEvent(actor, event) {
        if (this._destroy) {
            dismissDispatcher(Clutter.GrabState.KEYBOARD);
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
        let action = Module.Keybindings().byId(mutterActionId);
        let space = Module.Tiling().spaces.selectedSpace;
        let metaWindow = space.selectedWindow;
        const nav = getNavigator();

        if (mutterActionId == Meta.KeyBindingAction.MINIMIZE) {
            metaWindow.minimize();
        } else if (action && action.options.activeInNavigator) {
            // action is performed while navigator is open (e.g. switch-left)
            if (!metaWindow && (action.options.mutterFlags & Meta.KeyBindingFlags.PER_WINDOW)) {
                return;
            }

            if (!Module.Tiling().inGrab && action.options.opensMinimap) {
                nav._showMinimap(space);
            }
            action.handler(metaWindow, space, {navigator: this.navigator});
            if (space !== Module.Tiling().spaces.selectedSpace) {
                this.navigator.minimaps.forEach(m => typeof m === 'number'
                    ? Mainloop.source_remove(m) : m.hide());
            }
            if (Module.Tiling().inGrab && !Module.Tiling().inGrab.dnd && Module.Tiling().inGrab.window) {
                Module.Tiling().inGrab.beginDnD();
            }
        } else if (action) {
            // closes navigator and action is performed afterwards
            // (e.g. switch-monitor-left)
            this._resetNoModsTimeout();
            this._doActionTimeout = Mainloop.timeout_add(0, () => {
                action.handler(metaWindow, space);
                return false; // on return false destroys timeout
            });
        }
    }

    _finish(timestamp) {
        let nav = getNavigator();
        nav.accept();
        !this._destroy && nav.destroy();
        dismissDispatcher(Clutter.GrabState.KEYBOARD);
        let space = Module.Tiling().spaces.selectedSpace;
        let metaWindow = space.selectedWindow;
        if (metaWindow) {
            if (!metaWindow.appears_focused) {
                space.setSelectionInactive();
            }
        }
    }

    destroy() {
        Module.Utils().timeout_remove(this._noModsTimeoutId);
        Module.Utils().timeout_remove(this._doActionTimeout);
        this._noModsTimeoutId = null;
        this._doActionTimeout = null;

        try {
            if (grab) {
                Main.popModal(grab);
                grab = null;
            }
        } catch (e) {
            Module.Utils().debug("Failed to release grab: ", e);
        }

        this.actor.unset_flags(Clutter.ActorFlags.REACTIVE);
        this.signals.destroy();
        // We have already destroyed the navigator
        getNavigator().destroy();
        dispatcher = null;
    }
}

var index = 0;
var navigator;
class NavigatorClass {
    constructor() {
        Module.Utils().debug("#navigator", "nav created");
        navigating = true;

        this.was_accepted = false;
        this.index = index++;

        this._block = Main.wm._blockAnimations;
        Main.wm._blockAnimations = true;
        // Meta.disable_unredirect_for_screen(screen);
        this.space = Module.Tiling().spaces.getActiveSpace();

        this._startWindow = this.space.selectedWindow;
        this.from = this.space;
        this.monitor = this.space.monitor;
        this.monitor.clickOverlay.hide();
        this.minimaps = new Map();

        Module.TopBar().fixTopBar();

        Module.Scratch().animateWindows();
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
                return false; // on return false destroys timeout
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

        if (Module.Tiling().inGrab && !Module.Tiling().inGrab.dnd) {
            Module.Tiling().inGrab.beginDnD();
        }

        if (Main.panel.statusArea.appMenu)
            Main.panel.statusArea.appMenu.container.show();

        let force = Module.Tiling().inPreview;
        navigating = false;

        if (force) {
            this.space.monitor.clickOverlay.hide();
        }

        this.space = space || Module.Tiling().spaces.selectedSpace;

        let from = this.from;
        let selected = this.space.selectedWindow;
        if (!this.was_accepted) {
            // Abort the navigation
            this.space = from;
            if (this.startWindow && this._startWindow.get_compositor_private())
                selected = this._startWindow;
            else
                selected = display.focus_window;
        }

        let visible = [];
        for (let monitor of Main.layoutManager.monitors) {
            visible.push(Module.Tiling().spaces.monitors.get(monitor));
            if (monitor === this.monitor)
                continue;
            monitor.clickOverlay.activate();
        }

        if (!visible.includes(space) && this.monitor !== this.space.monitor) {
            this.space.setMonitor(this.monitor, true);
        }

        const workspaceId = this.space.workspace.index();
        const fromId = from.workspace.index();
        if (this.space === from) {
            // Animate the selected space into full view - normally this
            // happens on workspace switch, but activating the same workspace
            // again doesn't trigger a switch signal
            if (force) {
                Module.Tiling().spaces.switchWorkspace(null, workspaceId, workspaceId);
            }
        } else {
            if (Module.Tiling().inGrab && Module.Tiling().inGrab.window) {
                this.space.workspace.activate_with_focus(Module.Tiling().inGrab.window, global.get_current_time());
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

        if (selected && !Module.Tiling().inGrab) {
            let hasFocus = selected && selected.has_focus();
            selected.foreach_transient(mw => hasFocus = mw.has_focus() || hasFocus);
            if (hasFocus) {
                Module.Tiling().focus_handler(selected);
            } else {
                Main.activateWindow(selected);
            }
        }
        if (selected && Module.Tiling().inGrab && !this.was_accepted) {
            Module.Tiling().focus_handler(selected);
        }

        if (!Module.Tiling().inGrab)
            Module.Scratch().showWindows();

        Module.TopBar().fixTopBar();

        Main.wm._blockAnimations = this._block;
        this.space.moveDone();

        this.emit('destroy', this.was_accepted);
        navigator = false;
    }
}
var Navigator = NavigatorClass;
Signals.addSignalMethods(Navigator.prototype);

function getNavigator() {
    if (navigator)
        return navigator;

    navigator = new Navigator();
    return navigator;
}

/**
 *
 * @param {import('@gi-types/clutter10').GrabState} mode 
 * @returns {ActionDispatcher}
 */
function getActionDispatcher(mode) {
    if (dispatcher) {
        dispatcher.mode |= mode
        return dispatcher
    }
    dispatcher = new ActionDispatcher()
    return getActionDispatcher(mode)
}

/**
 *
 * @param {import('@gi-types/clutter10').GrabState} mode 
 */
function dismissDispatcher(mode) {
    if (!dispatcher) {
        return;
    }

    dispatcher.mode ^= mode;
    if (dispatcher.mode === Clutter.GrabState.NONE) {
        dispatcher.destroy();
    }
}

function preview_navigate(meta_window, space, {display, screen, binding}) {
    let tabPopup = getActionDispatcher(Clutter.GrabState.KEYBOARD);
    tabPopup.show(binding.is_reversed(), binding.get_name(), binding.get_mask());
}
