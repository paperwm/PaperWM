const ExtensionUtils = imports.misc.extensionUtils;
const Extension = ExtensionUtils.getCurrentExtension();
const Settings = Extension.imports.settings;
const Utils = Extension.imports.utils;
const Tiling = Extension.imports.tiling;
const Navigator = Extension.imports.navigator;
const App = Extension.imports.app;
const Scratch = Extension.imports.scratch;
const LiveAltTab = Extension.imports.liveAltTab;

const { Clutter, Meta, Shell } = imports.gi;
const Seat = Clutter.get_default_backend().get_default_seat();
const Main = imports.ui.main;
const display = global.display;

let KEYBINDINGS_KEY = 'org.gnome.shell.extensions.paperwm.keybindings';

function registerPaperAction(actionName, handler, flags) {
    let settings = ExtensionUtils.getSettings(KEYBINDINGS_KEY);
    registerAction(
        actionName,
        handler,
        { settings, mutterFlags: flags, activeInNavigator: true });
}

function registerNavigatorAction(name, handler) {
    let settings = ExtensionUtils.getSettings(KEYBINDINGS_KEY);
    registerAction(
        name,
        handler,
        { settings, opensNavigator: true });
}

function registerMinimapAction(name, handler) {
    let settings = ExtensionUtils.getSettings(KEYBINDINGS_KEY);
    registerAction(
        name,
        handler,
        {
            settings,
            opensNavigator: true,
            opensMinimap: true,
            mutterFlags: Meta.KeyBindingFlags.PER_WINDOW,
        }
    );
}


let signals, actions, nameMap, actionIdMap, keycomboMap;
function setupActions() {
    signals = new Utils.Signals();
    actions = [];
    nameMap = {};     // mutter keybinding action name -> action
    actionIdMap = {}; // actionID   -> action
    keycomboMap = {}; // keycombo   -> action

    /* Initialize keybindings */
    let dynamic_function_ref = Utils.dynamic_function_ref;
    let liveAltTab = dynamic_function_ref('liveAltTab', LiveAltTab);

    let settings = ExtensionUtils.getSettings(KEYBINDINGS_KEY);
    registerAction('live-alt-tab',
        liveAltTab, { settings });
    registerAction('live-alt-tab-backward',
        liveAltTab,
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

    registerNavigatorAction('switch-down-workspace', Tiling.selectDownSpace);
    registerNavigatorAction('switch-up-workspace', Tiling.selectUpSpace);

    registerNavigatorAction('move-down-workspace', Tiling.moveDownSpace);
    registerNavigatorAction('move-up-workspace', Tiling.moveUpSpace);

    registerNavigatorAction('take-window', Tiling.takeWindow);

    registerMinimapAction("switch-next", (mw, space) => space.switchLinear(1));
    registerMinimapAction("switch-previous", (mw, space) => space.switchLinear(-1));

    registerMinimapAction("switch-first", Tiling.activateFirstWindow);
    registerMinimapAction("switch-last", Tiling.activateLastWindow);

    registerMinimapAction("switch-right", (mw, space) => space.switchRight());
    registerMinimapAction("switch-left", (mw, space) => space.switchLeft());
    registerMinimapAction("switch-up", (mw, space) => space.switchUp());
    registerMinimapAction("switch-down", (mw, space) => space.switchDown());

    registerMinimapAction("move-left",
        (mw, space) => space.swap(Meta.MotionDirection.LEFT));
    registerMinimapAction("move-right",
        (mw, space) => space.swap(Meta.MotionDirection.RIGHT));
    registerMinimapAction("move-up",
        (mw, space) => space.swap(Meta.MotionDirection.UP));
    registerMinimapAction("move-down",
        (mw, space) => space.swap(Meta.MotionDirection.DOWN));

    registerPaperAction("toggle-scratch-window",
        dynamic_function_ref("toggleScratchWindow",
            Scratch));

    registerPaperAction("toggle-scratch-layer",
        dynamic_function_ref("toggleScratch",
            Scratch));

    registerPaperAction("toggle-scratch",
        dynamic_function_ref("toggle",
            Scratch),
        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction("switch-focus-mode",
        dynamic_function_ref("switchToNextFocusMode",
            Tiling));

    registerPaperAction("resize-h-inc",
        dynamic_function_ref("resizeHInc",
            Tiling),
        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction("resize-h-dec",
        dynamic_function_ref("resizeHDec",
            Tiling),
        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction("resize-w-inc",
        dynamic_function_ref("resizeWInc",
            Tiling),
        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction("resize-w-dec",
        dynamic_function_ref("resizeWDec",
            Tiling),
        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction("cycle-width",
        dynamic_function_ref("cycleWindowWidth",
            Tiling),
        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction("cycle-width-backwards",
        dynamic_function_ref("cycleWindowWidthBackwards",
            Tiling),
        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction("cycle-height",
        dynamic_function_ref("cycleWindowHeight",
            Tiling),
        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction("cycle-height-backwards",
        dynamic_function_ref("cycleWindowHeightBackwards",
            Tiling),
        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction("center-horizontally",
        dynamic_function_ref("centerWindowHorizontally",
            Tiling),
        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction('new-window',
        dynamic_function_ref('duplicateWindow', App),
        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction('close-window',
        metaWindow =>
            metaWindow.delete(global.get_current_time()),
        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction('slurp-in',
        dynamic_function_ref('slurp',
            Tiling),
        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction('barf-out',
        dynamic_function_ref('barf',
            Tiling),
        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction('toggle-maximize-width',
        dynamic_function_ref("toggleMaximizeHorizontally",
            Tiling),
        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction('paper-toggle-fullscreen',
        metaWindow => {
            if (metaWindow.fullscreen)
                metaWindow.unmake_fullscreen();
            else
                metaWindow.make_fullscreen();
        }, Meta.KeyBindingFlags.PER_WINDOW);
}

function idOf(mutterName) {
    let action = this.byMutterName(mutterName);
    if (action) {
        return action.id;
    } else {
        return Meta.KeyBindingAction.NONE;
    }
}

function byMutterName(name) {
    return nameMap[name];
}

function byId(mutterId) {
    return actionIdMap[mutterId];
}

function asKeyHandler(actionHandler) {
    return (display, mw, binding) => actionHandler(mw, Tiling.spaces.selectedSpace, { display, binding });
}

function impliedOptions(options) {
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
function registerAction(actionName, handler, options) {
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

function devirtualizeMask(gdkVirtualMask) {
    const keymap = Seat.get_keymap();
    let [success, rawMask] = keymap.map_virtual_modifiers(gdkVirtualMask);
    if (!success)
        throw new Error(`Couldn't devirtualize mask ${gdkVirtualMask}`);
    return rawMask;
}

function rawMaskOfKeystr(keystr) {
    let [dontcare, keycodes, mask] = Settings.accelerator_parse(keystr);
    const test = Settings.accelerator_mask(keystr);
    console.log(`actual:${mask} vs. test:${test}`);
    return devirtualizeMask(mask);
}

function openNavigatorHandler(actionName, keystr) {
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

function handleAccelerator(display, actionId, deviceId, timestamp) {
    const action = actionIdMap[actionId];
    if (action) {
        Utils.debug("#keybindings", "Schemaless keybinding activated",
            actionId, action.name);
        if (global.screen) {
            action.keyHandler(display, null, display.focus_window);
        } else {
            action.keyHandler(display, display.focus_window);
        }
    }
}

function disableAction(action) {
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

function enableAction(action) {
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

function enable() {
    // restore previous keybinds (in case failed to restore last time, e.g. gnome crash etc)
    Settings.updateOverrides();

    setupActions();
    signals.connect(display,
        'accelerator-activated',
        Utils.dynamic_function_ref(handleAccelerator.name, this)
    );
    actions.forEach(enableAction);
    Settings.overrideConflicts();

    let schemas = [...Settings.getConflictSettings(), ExtensionUtils.getSettings(KEYBINDINGS_KEY)];
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

function disable() {
    signals.destroy();
    signals = null;
    actions.forEach(disableAction);
    Settings.restoreConflicts();

    actions = null;
    nameMap = null;
    actionIdMap = null;
    keycomboMap = null;
}
