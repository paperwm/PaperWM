import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {
    Settings, Utils, Tiling, Navigator,
    App, Scratch, LiveAltTab
} from './imports.js';

const Seat = Clutter.get_default_backend().get_default_seat();
const display = global.display;

const KEYBINDINGS_KEY = 'org.gnome.shell.extensions.paperwm.keybindings';

let keybindSettings;
export function enable(extension) {
    // restore previous keybinds (in case failed to restore last time, e.g. gnome crash etc)
    Settings.updateOverrides();

    keybindSettings = extension.getSettings(KEYBINDINGS_KEY);
    setupActions(keybindSettings);
    signals.connect(display, 'accelerator-activated', (display, actionId, deviceId, timestamp) => {
        handleAccelerator(display, actionId, deviceId, timestamp);
    });
    actions.forEach(enableAction);
    Settings.overrideConflicts();

    let schemas = [...Settings.getConflictSettings(), extension.getSettings(KEYBINDINGS_KEY)];
    schemas.forEach(schema => {
        signals.connect(schema, 'changed', (settings, key) => {
            const numConflicts = Settings.conflictKeyChanged(settings, key);
            if (numConflicts > 0) {
                Main.notify(
                    `PaperWM: overriding '${key}' keybind`,
                    `this Gnome Keybind will be restored when PaperWM is disabled`);
            }
        });
    });
}

export function disable() {
    signals.destroy();
    signals = null;
    actions.forEach(disableAction);
    Settings.restoreConflicts();

    keybindSettings = null;
    actions = null;
    nameMap = null;
    actionIdMap = null;
    keycomboMap = null;
}

export function registerPaperAction(actionName, handler, flags) {
    registerAction(
        actionName,
        handler,
        { settings: keybindSettings, mutterFlags: flags, activeInNavigator: true });
}

export function registerNavigatorAction(name, handler) {
    registerAction(
        name,
        handler,
        { settings: keybindSettings, opensNavigator: true });
}

export function registerMinimapAction(name, handler) {
    registerAction(
        name,
        handler,
        {
            settings: keybindSettings,
            opensNavigator: true,
            opensMinimap: true,
            mutterFlags: Meta.KeyBindingFlags.PER_WINDOW,
        }
    );
}


let signals, actions, nameMap, actionIdMap, keycomboMap;
export function setupActions(settings) {
    signals = new Utils.Signals();
    actions = [];
    nameMap = {};     // mutter keybinding action name -> action
    actionIdMap = {}; // actionID   -> action
    keycomboMap = {}; // keycombo   -> action

    /* Initialize keybindings */
    registerAction('live-alt-tab', LiveAltTab.liveAltTab, { settings });
    registerAction('live-alt-tab-backward', LiveAltTab.liveAltTab,
        { settings, mutterFlags: Meta.KeyBindingFlags.IS_REVERSED });

    registerAction('live-alt-tab-scratch', LiveAltTab.liveAltTabScratch, { settings });
    registerAction('live-alt-tab-scratch-backward', LiveAltTab.liveAltTabScratch,
        { settings, mutterFlags: Meta.KeyBindingFlags.IS_REVERSED });

    registerAction('move-monitor-right', () => {
        Tiling.spaces.switchMonitor(Meta.DisplayDirection.RIGHT, true);
    }, { settings });
    registerAction('move-monitor-left', () => {
        Tiling.spaces.switchMonitor(Meta.DisplayDirection.LEFT, true);
    }, { settings });
    registerAction('move-monitor-above', () => {
        Tiling.spaces.switchMonitor(Meta.DisplayDirection.UP, true);
    }, { settings });
    registerAction('move-monitor-below', () => {
        Tiling.spaces.switchMonitor(Meta.DisplayDirection.DOWN, true);
    }, { settings });

    registerAction('switch-monitor-right', () => {
        Tiling.spaces.switchMonitor(Meta.DisplayDirection.RIGHT, false);
    }, { settings });
    registerAction('switch-monitor-left', () => {
        Tiling.spaces.switchMonitor(Meta.DisplayDirection.LEFT, false);
    }, { settings });
    registerAction('switch-monitor-above', () => {
        Tiling.spaces.switchMonitor(Meta.DisplayDirection.UP, false);
    }, { settings });
    registerAction('switch-monitor-below', () => {
        Tiling.spaces.switchMonitor(Meta.DisplayDirection.DOWN, false);
    }, { settings });

    registerAction('swap-monitor-right', () => {
        Tiling.spaces.swapMonitor(Meta.DisplayDirection.RIGHT, Meta.DisplayDirection.LEFT);
    }, { settings });
    registerAction('swap-monitor-left', () => {
        Tiling.spaces.swapMonitor(Meta.DisplayDirection.LEFT, Meta.DisplayDirection.RIGHT);
    }, { settings });
    registerAction('swap-monitor-above', () => {
        Tiling.spaces.swapMonitor(Meta.DisplayDirection.UP, Meta.DisplayDirection.DOWN);
    }, { settings });
    registerAction('swap-monitor-below', () => {
        Tiling.spaces.swapMonitor(Meta.DisplayDirection.DOWN, Meta.DisplayDirection.UP);
    }, { settings });

    registerNavigatorAction('previous-workspace', Tiling.selectPreviousSpace);
    registerNavigatorAction('previous-workspace-backward', Tiling.selectPreviousSpaceBackwards);

    registerNavigatorAction('move-previous-workspace', Tiling.movePreviousSpace);
    registerNavigatorAction('move-previous-workspace-backward', Tiling.movePreviousSpaceBackwards);

    registerNavigatorAction('switch-down-workspace', (mw, space) => {
        Tiling.selectDownSpace(mw, space, false);
    });
    registerNavigatorAction('switch-up-workspace', (mw, space) => {
        Tiling.selectUpSpace(mw, space, false);
    });
    registerNavigatorAction('switch-down-workspace-from-all-monitors', (mw, space) => {
        Tiling.selectDownSpace(mw, space, true);
    });
    registerNavigatorAction('switch-up-workspace-from-all-monitors', (mw, space) => {
        Tiling.selectUpSpace(mw, space, true);
    });

    registerNavigatorAction('move-down-workspace', Tiling.moveDownSpace);
    registerNavigatorAction('move-up-workspace', Tiling.moveUpSpace);

    registerNavigatorAction('take-window', Tiling.takeWindow);

    registerMinimapAction("switch-next", (mw, space) => space.switchLinear(1, false));
    registerMinimapAction("switch-previous", (mw, space) => space.switchLinear(-1, false));
    registerMinimapAction("switch-next-loop", (mw, space) => space.switchLinear(1, true));
    registerMinimapAction("switch-previous-loop", (mw, space) => space.switchLinear(-1, true));

    registerMinimapAction("switch-right", (mw, space) => space.switchRight(false));
    registerMinimapAction("switch-left", (mw, space) => space.switchLeft(false));
    registerMinimapAction("switch-up", (mw, space) => space.switchUp(false));
    registerMinimapAction("switch-down", (mw, space) => space.switchDown(false));

    registerMinimapAction("switch-right-loop", (mw, space) => space.switchRight(true));
    registerMinimapAction("switch-left-loop", (mw, space) => space.switchLeft(true));
    registerMinimapAction("switch-up-loop", (mw, space) => space.switchUp(true));
    registerMinimapAction("switch-down-loop", (mw, space) => space.switchDown(true));

    registerMinimapAction("switch-first", Tiling.activateFirstWindow);
    registerMinimapAction("switch-last", Tiling.activateLastWindow);

    registerMinimapAction("switch-global-right", (mw, space) => space.switchGlobalRight());
    registerMinimapAction("switch-global-left", (mw, space) => space.switchGlobalLeft());
    registerMinimapAction("switch-global-up", (mw, space) => space.switchGlobalUp());
    registerMinimapAction("switch-global-down", (mw, space) => space.switchGlobalDown());

    registerMinimapAction("move-left",
        (mw, space) => space.swap(Meta.MotionDirection.LEFT));
    registerMinimapAction("move-right",
        (mw, space) => space.swap(Meta.MotionDirection.RIGHT));
    registerMinimapAction("move-up",
        (mw, space) => space.swap(Meta.MotionDirection.UP));
    registerMinimapAction("move-down",
        (mw, space) => space.swap(Meta.MotionDirection.DOWN));

    registerPaperAction("toggle-scratch-window",
        Scratch.toggleScratchWindow);

    registerPaperAction("toggle-scratch-layer",
        Scratch.toggleScratch);

    registerPaperAction("toggle-scratch",
        Scratch.toggle,
        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction("activate-window-under-cursor",
        Tiling.activateWindowUnderCursor);

    registerPaperAction("switch-focus-mode",
        Tiling.switchToNextFocusMode);

    registerPaperAction("resize-h-inc",
        Tiling.resizeHInc,
        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction("resize-h-dec",
        Tiling.resizeHDec,
        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction("resize-w-inc",
        Tiling.resizeWInc,
        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction("resize-w-dec",
        Tiling.resizeWDec,
        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction("cycle-width",
        Tiling.cycleWindowWidth,
        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction("cycle-width-backwards",
        Tiling.cycleWindowWidthBackwards,
        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction("cycle-height",
        Tiling.cycleWindowHeight,
        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction("cycle-height-backwards",
        Tiling.cycleWindowHeightBackwards,
        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction("center-horizontally",
        Tiling.centerWindowHorizontally,
        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction('new-window',
        App.duplicateWindow,
        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction('close-window',
        metaWindow => metaWindow.delete(global.get_current_time()),
        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction('slurp-in',
        Tiling.slurp,
        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction('barf-out',
        Tiling.barf,
        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction('toggle-maximize-width',
        Tiling.toggleMaximizeHorizontally,
        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction('paper-toggle-fullscreen',
        metaWindow => {
            if (metaWindow.fullscreen) {
                metaWindow.unmake_fullscreen();
            }
            else {
                metaWindow.make_fullscreen();
            }
            Tiling.resizeHandler(metaWindow);
        }, Meta.KeyBindingFlags.PER_WINDOW);
}

export function idOf(mutterName) {
    let action = byMutterName(mutterName);
    if (action) {
        return action.id;
    } else {
        return Meta.KeyBindingAction.NONE;
    }
}

export function byMutterName(name) {
    return nameMap[name];
}

export function byId(mutterId) {
    return actionIdMap[mutterId];
}

export function asKeyHandler(actionHandler) {
    return (display, mw, binding) => actionHandler(mw, Tiling.spaces.selectedSpace, { display, binding });
}

export function impliedOptions(options) {
    options = options = Object.assign({ mutterFlags: Meta.KeyBindingFlags.NONE }, options);

    if (options.opensMinimap)
        options.opensNavigator = true;

    if (options.opensNavigator)
        options.activeInNavigator = true;

    return options;
}

/**
 * handler: function(metaWindow, space, {binding, display, screen}) -> ignored
 * options: {
 *   opensMinimap:      true|false Start navigation and open the minimap
 *   opensNavigator:    true|false Start navigation (eg. Esc will restore selected space and window)
 *   activeInNavigator: true|false Action is available during navigation
 *   ...
 * }
 */
export function registerAction(actionName, handler, options) {
    options = impliedOptions(options);

    let {
        settings,
        opensNavigator,
    } = options;

    let mutterName, keyHandler;
    if (settings) {
        Utils.assert(actionName, "Schema action must have a name");
        mutterName = actionName;
        keyHandler = opensNavigator
            ? asKeyHandler(Navigator.preview_navigate)
            : asKeyHandler(handler);
    } else {
        // actionId, mutterName and keyHandler will be set if/when the action is bound
    }

    let action = {
        id: Meta.KeyBindingAction.NONE,
        name: actionName,
        mutterName,
        keyHandler,
        handler,
        options,
    };

    actions.push(action);
    if (actionName)
        nameMap[actionName] = action;

    return action;
}

/**
 * Bind a key to an action (possibly creating a new action)
 */
export function bindkey(keystr, actionName = null, handler = null, options = {}) {
    Utils.assert(!options.settings,
        "Can only bind schemaless actions - change action's settings instead",
        actionName);

    let action = actionName && actions.find(a => a.name === actionName);
    let keycombo = Settings.keystrToKeycombo(keystr);

    if (!action) {
        action = registerAction(actionName, handler, options);
    } else {
        let boundAction = keycomboMap[keycombo];
        if (boundAction && boundAction !== action) {
            console.debug("Rebinding", keystr, "to", actionName, "from", boundAction?.name);
            disableAction(boundAction);
        }

        disableAction(action);

        action.handler = handler;
        action.options = impliedOptions(options);
    }

    action.keystr = keystr;
    action.keycombo = keycombo;

    if (enableAction(action) === Meta.KeyBindingAction.NONE) {
        // Keybinding failed: try to supply a useful error message
        let message;
        let boundAction = keycomboMap[keycombo];
        if (boundAction) {
            message = `${keystr} already bound to paperwm action: ${boundAction.name}`;
        } else {
            let boundId = getBoundActionId(keystr);
            if (boundId !== Meta.KeyBindingAction.NONE) {
                let builtInAction =
                    Object.entries(Meta.KeyBindingAction).find(([name, id]) => id === boundId);
                if (builtInAction) {
                    message = `${keystr} already bound to built-in action: ${builtInAction[0]}`;
                } else {
                    message = `${keystr} already bound to unknown action with id: ${boundId}`;
                }
            }
        }

        if (!message) {
            message = "Usually caused by the binding already being taken, but could not identify which action";
        }

        Main.notify(
            "PaperWM (user.js): Could not enable keybinding",
            `Tried to bind ${keystr} to ${actionName}\n${message}`);
    }

    return action.id;
}

export function unbindkey(actionIdOrKeystr) {
    let actionId;
    if (typeof  actionIdOrKeystr === "string") {
        const action = keycomboMap[Settings.keystrToKeycombo(actionIdOrKeystr)];
        actionId = action && action.id;
    } else {
        actionId = actionIdOrKeystr;
    }

    disableAction(actionIdMap[actionId]);
}

export function devirtualizeMask(gdkVirtualMask) {
    const keymap = Seat.get_keymap();
    let [success, rawMask] = keymap.map_virtual_modifiers(gdkVirtualMask);
    if (!success)
        throw new Error(`Couldn't devirtualize mask ${gdkVirtualMask}`);
    return rawMask;
}

export function rawMaskOfKeystr(keystr) {
    let [dontcare, keycodes, mask] = Settings.accelerator_parse(keystr);
    return devirtualizeMask(mask);
}

export function openNavigatorHandler(actionName, keystr) {
    const mask = rawMaskOfKeystr(keystr) & 0xff;

    const binding = {
        get_name: () => actionName,
        get_mask: () => mask,
        is_reversed: () => false,
    };
    return function(display, screen, metaWindow) {
        return Navigator.preview_navigate(
            metaWindow, null, { screen, display, binding });
    };
}

export function getBoundActionId(keystr) {
    let [dontcare, keycodes, mask] = Settings.accelerator_parse(keystr);
    if (keycodes.length > 1) {
        throw new Error(`Multiple keycodes ${keycodes} ${keystr}`);
    }
    const rawMask = devirtualizeMask(mask);
    return display.get_keybinding_action(keycodes[0], rawMask);
}

export function handleAccelerator(display, actionId, deviceId, timestamp) {
    const action = actionIdMap[actionId];
    if (action) {
        console.debug("#keybindings", "Schemaless keybinding activated",
            actionId, action.name);
        action.keyHandler(display, display.focus_window);
    }
}

export function disableAction(action) {
    if (action.id === Meta.KeyBindingAction.NONE) {
        return;
    }

    const oldId = action.id;
    if (action.options.settings) {
        Main.wm.removeKeybinding(action.mutterName);
        action.id = Meta.KeyBindingAction.NONE;
        delete actionIdMap[oldId];
    } else {
        display.ungrab_accelerator(action.id);
        action.id = Meta.KeyBindingAction.NONE;

        delete nameMap[action.mutterName];
        delete actionIdMap[oldId];
        delete keycomboMap[action.keycombo];

        action.mutterName = undefined;
    }
}

export function enableAction(action) {
    if (action.id !== Meta.KeyBindingAction.NONE)
        return action.id; // Already enabled (happens on enable right after init)

    if (action.options.settings) {
        let actionId = Main.wm.addKeybinding(
            action.mutterName,
            action.options.settings,
            action.options.mutterFlags || Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL,
            action.keyHandler);

        if (actionId !== Meta.KeyBindingAction.NONE) {
            action.id = actionId;
            actionIdMap[actionId] = action;
        } else {
            console.warn("Could not enable action", action.name);
        }
    } else {
        if (keycomboMap[action.keycombo]) {
            console.warn("Other action bound to", action.keystr, keycomboMap[action.keycombo].name);
            return Meta.KeyBindingAction.NONE;
        }

        let actionId = Utils.grab_accelerator(action.keystr);
        if (actionId === Meta.KeyBindingAction.NONE) {
            console.warn("Failed to grab. Binding probably already taken");
            return Meta.KeyBindingAction.NONE;
        }

        let mutterName = Meta.external_binding_name_for_action(actionId);

        action.id = actionId;
        action.mutterName = mutterName;

        actionIdMap[actionId] = action;
        keycomboMap[action.keycombo] = action;
        nameMap[mutterName] = action;

        if (action.options.opensNavigator) {
            action.keyHandler = openNavigatorHandler(mutterName, action.keystr);
        } else {
            action.keyHandler = asKeyHandler(action.handler);
        }

        Main.wm.allowKeybinding(action.mutterName, Shell.ActionMode.ALL);

        return action.id;
    }
}
