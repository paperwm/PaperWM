import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { Utils, Tiling, Keybindings, Topbar, Scratch, Minimap } from './imports.js';

/**
  Navigation and previewing functionality.

  This is a somewhat messy tangle of functionality relying on
  `SwitcherPopup.SwitcherPopup` when we really should just take full control.
 */

const { signals: Signals } = imports;
const display = global.display;

export let navigating; // exported
let grab, dispatcher, signals;
export function enable() {
    navigating = false;

    /**
     * Stop navigation before before/after overview. Avoids a corner-case issue
     * in multimonitors where workspaces can get snapped to another monitor.
     */
    signals = new Utils.Signals();
    signals.connect(Main.overview, 'showing', () => {
        finishNavigation();
    });
    signals.connect(Main.overview, 'hidden', () => {
        finishNavigation();
    });
}

export function disable() {
    navigating = false;
    grab = null;
    dispatcher = null;
    signals.destroy();
    signals = null;
    index = null;
}

export function dec2bin(dec) {
    return (dec >>> 0).toString(2);
}

const modMask =
    Clutter.ModifierType.SUPER_MASK |
    Clutter.ModifierType.HYPER_MASK |
    Clutter.ModifierType.META_MASK |
    Clutter.ModifierType.CONTROL_MASK |
    Clutter.ModifierType.MOD1_MASK |
    // Clutter.ModifierType.MOD2_MASK | uhmm, for some reason this is triggered on keygrab
    Clutter.ModifierType.MOD3_MASK |
    Clutter.ModifierType.MOD4_MASK |
    Clutter.ModifierType.MOD5_MASK;
export function getModLock(mods) {
    return mods & modMask;
}

/**
   Handle catching keyevents and dispatching actions

   Adapted from SwitcherPopup, without any visual handling.
 */
class ActionDispatcher {
    /** @type {import('@gi-types/clutter10').GrabState} */
    mode;

    constructor() {
        console.debug("#dispatch", "created");
        this.signals = new Utils.Signals();
        this.actor = Tiling.spaces.spaceContainer;
        this.actor.set_flags(Clutter.ActorFlags.REACTIVE);
        this.navigator = getNavigator();

        if (grab) {
            console.debug("#dispatch", "already in grab");
            return;
        }

        // grab = stage.grab(this.actor)
        grab = Main.pushModal(this.actor);
        // We expect at least a keyboard grab here
        if ((grab.get_seat_state() & Clutter.GrabState.KEYBOARD) === 0) {
            console.error("Failed to grab modal");
            throw new Error('Could not grab modal');
        }

        this.signals.connect(this.actor, 'key-press-event', this._keyPressEvent.bind(this));
        this.signals.connect(this.actor, 'key-release-event', this._keyReleaseEvent.bind(this));

        this._noModsTimeoutId = null;
        this._doActionTimeout = null;
    }

    show(backward, binding, mask) {
        this._modifierMask = getModLock(mask);
        this.navigator = getNavigator();
        Topbar.fixTopBar();
        let actionId = Keybindings.idOf(binding);
        if (actionId === Meta.KeyBindingAction.NONE) {
            try {
                // Check for built-in actions
                actionId = Meta.prefs_get_keybinding_action(binding);
            } catch (e) {
                console.debug("Couldn't resolve action name");
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
        Utils.timeout_remove(this._noModsTimeoutId);
        this._noModsTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            0, () => {
                this._finish(global.get_current_time());
                this._noModsTimeoutId = null;
                return false; // stops timeout recurrence
            });
    }

    _keyPressEvent(actor, event) {
        if (!this._modifierMask) {
            this._modifierMask = getModLock(event.get_state());
        }
        let keysym = event.get_key_symbol();
        let action = global.display.get_keybinding_action(event.get_key_code(), event.get_state());

        // Popping the modal on keypress doesn't work properly, as the release
        // event will leak to the active window. To work around this we initate
        // visual destruction on key-press and signal to the release handler
        // that we should destroy the dispactcher too
        // https://github.com/paperwm/PaperWM/issues/70
        if (keysym === Clutter.KEY_Escape) {
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

            if (state === 0)
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
        const nav = getNavigator();

        if (mutterActionId === Meta.KeyBindingAction.MINIMIZE) {
            metaWindow.minimize();
        } else if (action && action.options.activeInNavigator) {
            // action is performed while navigator is open (e.g. switch-left)
            if (!metaWindow && (action.options.mutterFlags & Meta.KeyBindingFlags.PER_WINDOW)) {
                return;
            }

            if (!Tiling.inGrab && action.options.opensMinimap) {
                nav.showMinimap(space);
            }
            action.handler(metaWindow, space, { navigator: this.navigator });
            if (space !== Tiling.spaces.selectedSpace) {
                this.navigator.minimaps.forEach(m => typeof m === 'number'
                    ? Utils.timeout_remove(m) : m.hide());
            }
            if (Tiling.inGrab && !Tiling.inGrab.dnd && Tiling.inGrab.window) {
                Tiling.inGrab.beginDnD();
            }
        } else if (action) {
            // closes navigator and action is performed afterwards
            // (e.g. switch-monitor-left)
            this._resetNoModsTimeout();
            this._doActionTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 0, () => {
                action.handler(metaWindow, space);
                this._doActionTimeout = null;
                return false; // on return false destroys timeout
            });
        }
    }

    _finish(timestamp) {
        let nav = getNavigator();
        nav.accept();
        !this._destroy && nav.destroy();
        dismissDispatcher(Clutter.GrabState.KEYBOARD);
        let space = Tiling.spaces.selectedSpace;
        let metaWindow = space.selectedWindow;
        if (metaWindow) {
            if (!metaWindow.appears_focused) {
                space.setSelectionInactive();
            }
        }
    }

    destroy() {
        Utils.timeout_remove(this._noModsTimeoutId);
        this._noModsTimeoutId = null;
        Utils.timeout_remove(this._doActionTimeout);
        this._doActionTimeout = null;

        try {
            if (grab) {
                Main.popModal(grab);
                grab = null;
            }
        } catch (e) {
            console.debug("Failed to release grab: ", e);
        }

        this.actor.unset_flags(Clutter.ActorFlags.REACTIVE);
        this.signals.destroy();
        this.signals = null;
        // We have already destroyed the navigator
        getNavigator().destroy();
        dispatcher = null;
    }
}

let index = 0;
export let navigator;
class NavigatorClass {
    constructor() {
        console.debug("#navigator", "nav created");
        navigating = true;

        this.was_accepted = false;
        this.index = index++;

        this._block = Main.wm._blockAnimations;
        Main.wm._blockAnimations = true;
        // Meta.disable_unredirect_for_screen(screen);
        this.space = Tiling.spaces.activeSpace;

        this._startWindow = this.space.selectedWindow;
        this.from = this.space;
        this.monitor = this.space.monitor;
        this.monitor.clickOverlay.hide();
        this.minimaps = new Map();

        Topbar.fixTopBar();

        Scratch.animateWindows();
        this.space.startAnimate();
    }

    showMinimap(space) {
        let minimap = this.minimaps.get(space);
        if (!minimap) {
            let minimapId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                minimap = new Minimap.Minimap(space, this.monitor);
                space.startAnimate();
                minimap.show(false);
                this.minimaps.set(space, minimap);
                return false; // on return false destroys timeout
            });
            this.minimaps.set(space, minimapId);
        } else {
            typeof minimap !== 'number' && minimap.show();
        }
    }

    accept() {
        this.was_accepted = true;
    }

    finish(force = false) {
        if (!force && grab) {
            return;
        }

        this.accept();
        this.destroy();
    }

    destroy() {
        this.minimaps.forEach(m => {
            if (typeof  m === 'number') {
                Utils.timeout_remove(m);
            }
            else {
                m.destroy();
            }
        });

        if (Tiling.inGrab && !Tiling.inGrab.dnd) {
            Tiling.inGrab?.beginDnD();
        }

        if (Main.panel.statusArea.appMenu)
            Main.panel.statusArea.appMenu.container.show();

        let force = Tiling.inPreview;
        navigating = false;

        if (force) {
            this?.space?.monitor?.clickOverlay.hide();
        }

        let space = Tiling.spaces.selectedSpace;
        this.space = space;

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
            visible.push(Tiling.spaces.monitors.get(monitor));
        }

        if (!visible.includes(space) && this.monitor !== this.space.monitor) {
            this.space.setMonitor(this.monitor, true);
        }

        const workspaceId = this.space.workspace.index();
        if (this.space === from) {
            // Animate the selected space into full view - normally this
            // happens on workspace switch, but activating the same workspace
            // again doesn't trigger a switch signal
            if (force) {
                Tiling.spaces.switchWorkspace(null, workspaceId, workspaceId, force);
            }
        } else if (Tiling.inGrab && Tiling.inGrab.window) {
            this.space.activateWithFocus(Tiling.inGrab.window, false, true);
        } else {
            this.space.activate(false, true);
        }

        selected = this.space.indexOf(selected) !== -1 ? selected
            : this.space.selectedWindow;

        let curFocus = display.focus_window;
        if (force && curFocus && curFocus.is_on_all_workspaces()) {
            selected = curFocus;
        }

        if (selected && !Tiling.inGrab) {
            let hasFocus = selected && selected.has_focus();
            selected.foreach_transient(mw => hasFocus = mw.has_focus() || hasFocus);
            if (hasFocus) {
                Tiling.focus_handler(selected);
            } else {
                Main.activateWindow(selected);
            }
        }
        if (selected && Tiling.inGrab && !this.was_accepted) {
            Tiling.focus_handler(selected);
        }

        if (!Tiling.inGrab)
            Scratch.showWindows();

        Topbar.fixTopBar();

        Main.wm._blockAnimations = this._block;
        this.space.moveDone();

        this.emit('destroy', this.was_accepted);
        navigator = false;
    }
}
export let Navigator = NavigatorClass;
Signals.addSignalMethods(Navigator.prototype);

export function getNavigator() {
    if (navigator)
        return navigator;

    navigator = new Navigator();
    return navigator;
}

/**
 * Finishes navigation if navigator exists.
 * Useful to call before disabling other modules.
 */
export function finishNavigation(force = true) {
    if (navigator) {
        navigator.finish(force);
    }
}

/**
 *
 * @param {import('@gi-types/clutter10').GrabState} mode
 * @returns {ActionDispatcher}
 */
export function getActionDispatcher(mode) {
    if (dispatcher) {
        dispatcher.mode |= mode;
        return dispatcher;
    }
    dispatcher = new ActionDispatcher();
    return getActionDispatcher(mode);
}

/**
 * Fishes current dispatcher (if any).
 */
export function finishDispatching() {
    dispatcher?._finish(global.get_current_time());
}

/**
 *
 * @param {import('@gi-types/clutter10').GrabState} mode
 */
export function dismissDispatcher(mode) {
    if (!dispatcher) {
        return;
    }

    dispatcher.mode ^= mode;
    if (dispatcher.mode === Clutter.GrabState.NONE) {
        dispatcher.destroy();
    }
}

export function preview_navigate(meta_window, space, { display, screen, binding }) {
    let tabPopup = getActionDispatcher(Clutter.GrabState.KEYBOARD);
    tabPopup.show(binding.is_reversed(), binding.get_name(), binding.get_mask());
}
