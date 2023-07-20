const Module = imports.misc.extensionUtils.getCurrentExtension().imports.module;
const keystrToKeycombo = Module.Extension.imports.settings.keystrToKeycombo;

const Clutter = imports.gi.Clutter;
const Seat = Clutter.get_default_backend().get_default_seat();
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;
const Main = imports.ui.main;
const display = global.display;


var KEYBINDINGS_KEY = 'org.gnome.shell.extensions.paperwm.keybindings';

function registerPaperAction(actionName, handler, flags) {
    let settings = Module.ExtensionUtils.getSettings(KEYBINDINGS_KEY);
    registerAction(
        actionName,
        handler,
        {settings: settings, mutterFlags: flags, activeInNavigator: true});
}

function registerNavigatorAction(name, handler) {
    let settings = Module.ExtensionUtils.getSettings(KEYBINDINGS_KEY);
    registerAction(
        name,
        handler,
        {settings: settings, opensNavigator: true});
}

function registerMinimapAction(name, handler) {
    let settings = Module.ExtensionUtils.getSettings(KEYBINDINGS_KEY);
    registerAction(
        name,
        handler,
        {
            settings: settings,
            opensNavigator: true,
            opensMinimap: true,
            mutterFlags: Meta.KeyBindingFlags.PER_WINDOW,
        }
    );
}


var signals, actions, nameMap, actionIdMap, keycomboMap, overrides;
function setupActions() {
    signals = Module.Signals();
    actions = [];
    nameMap = {};     // mutter keybinding action name -> action
    actionIdMap = {}; // actionID   -> action
    keycomboMap = {}; // keycombo   -> action
    overrides = [];   // action names that have been given a custom handler

    /* Initialize keybindings */
    let dynamic_function_ref = Module.Utils().dynamic_function_ref;
    let liveAltTab = dynamic_function_ref('liveAltTab', Module.LiveAltTab());

    let settings = Module.ExtensionUtils.getSettings(KEYBINDINGS_KEY);
    registerAction('live-alt-tab',
        liveAltTab, { settings });
    registerAction('live-alt-tab-backward',
        liveAltTab,
        {settings, mutterFlags: Meta.KeyBindingFlags.IS_REVERSED});

    registerAction('switch-monitor-right', () => {
        Module.Tiling().spaces.switchMonitor(Meta.DisplayDirection.RIGHT, false);
    }, {settings});
    registerAction('switch-monitor-left', () => {
        Module.Tiling().spaces.switchMonitor(Meta.DisplayDirection.LEFT, false);
    }, {settings});
    registerAction('switch-monitor-above', () => {
        Module.Tiling().spaces.switchMonitor(Meta.DisplayDirection.UP, false);
    }, {settings});
    registerAction('switch-monitor-below', () => {
        Module.Tiling().spaces.switchMonitor(Meta.DisplayDirection.DOWN, false);
    }, {settings});

    registerAction('move-monitor-right', () => {
        Module.Tiling().spaces.switchMonitor(Meta.DisplayDirection.RIGHT, true);
    }, {settings});
    registerAction('move-monitor-left', () => {
        Module.Tiling().spaces.switchMonitor(Meta.DisplayDirection.LEFT, true);
    }, {settings});
    registerAction('move-monitor-above', () => {
        Module.Tiling().spaces.switchMonitor(Meta.DisplayDirection.UP, true);
    }, {settings});
    registerAction('move-monitor-below', () => {
        Module.Tiling().spaces.switchMonitor(Meta.DisplayDirection.DOWN, true);
    }, {settings});

    registerNavigatorAction('previous-workspace', Module.Tiling().selectPreviousSpace);
    registerNavigatorAction('previous-workspace-backward', Module.Tiling().selectPreviousSpaceBackwards);

    registerNavigatorAction('move-previous-workspace', Module.Tiling().movePreviousSpace);
    registerNavigatorAction('move-previous-workspace-backward', Module.Tiling().movePreviousSpaceBackwards);

    registerNavigatorAction('switch-down-workspace', Module.Tiling().selectDownSpace);
    registerNavigatorAction('switch-up-workspace', Module.Tiling().selectUpSpace);

    registerNavigatorAction('move-down-workspace', Module.Tiling().moveDownSpace);
    registerNavigatorAction('move-up-workspace', Module.Tiling().moveUpSpace);

    registerNavigatorAction('take-window', Module.Tiling().takeWindow);

    registerMinimapAction("switch-next", (mw, space) => space.switchLinear(1));
    registerMinimapAction("switch-previous", (mw, space) => space.switchLinear(-1));

    registerMinimapAction("switch-first", Module.Tiling().activateFirstWindow);
    registerMinimapAction("switch-last", Module.Tiling().activateLastWindow);

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
            Module.Scratch()));

    registerPaperAction("toggle-scratch-layer",
        dynamic_function_ref("toggleScratch",
            Module.Scratch()));

    registerPaperAction("toggle-scratch",
        dynamic_function_ref("toggle",
            Module.Scratch()),
        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction("switch-focus-mode",
        dynamic_function_ref("switchToNextFocusMode",
            Module.Tiling()));

    registerPaperAction("develop-set-globals",
        dynamic_function_ref("setDevGlobals",
            Module.Utils()));

    registerPaperAction("resize-h-inc",
        dynamic_function_ref("resizeHInc",
            Module.Tiling()),
        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction("resize-h-dec",
        dynamic_function_ref("resizeHDec",
            Module.Tiling()),
        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction("resize-w-inc",
        dynamic_function_ref("resizeWInc",
            Module.Tiling()),
        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction("resize-w-dec",
        dynamic_function_ref("resizeWDec",
            Module.Tiling()),
        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction("cycle-width",
        dynamic_function_ref("cycleWindowWidth",
            Module.Tiling()),
        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction("cycle-height",
        dynamic_function_ref("cycleWindowHeight",
            Module.Tiling()),
        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction("center-horizontally",
        dynamic_function_ref("centerWindowHorizontally",
            Module.Tiling()),
        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction('new-window',
        dynamic_function_ref('duplicateWindow',
            Module.App()),
        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction('close-window',
        (metaWindow) =>
            metaWindow.delete(global.get_current_time()),
        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction('slurp-in',
        dynamic_function_ref('slurp',
            Module.Tiling()),
        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction('barf-out',
        dynamic_function_ref('barf',
            Module.Tiling()),
        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction('toggle-maximize-width',
        dynamic_function_ref("toggleMaximizeHorizontally",
            Module.Tiling()),
        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction('paper-toggle-fullscreen',
        (metaWindow) => {
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
    return (display, mw, binding) => actionHandler(mw, Module.Tiling().spaces.selectedSpace, {display, binding});
}

function impliedOptions(options) {
    options = options = Object.assign({mutterFlags: Meta.KeyBindingFlags.NONE}, options);

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
        Module.Utils().assert(actionName, "Schema action must have a name");
        mutterName = actionName;
        keyHandler = opensNavigator
            ? asKeyHandler(Module.Navigator().preview_navigate)
            : asKeyHandler(handler);
    } else {
        // actionId, mutterName and keyHandler will be set if/when the action is bound
    }

    let action = {
        id: Meta.KeyBindingAction.NONE,
        name: actionName,
        mutterName: mutterName,
        keyHandler: keyHandler,
        handler: handler,
        options: options,
    };

    actions.push(action);
    if (actionName)
        nameMap[actionName] = action;

    return action;
}

/**
 * Bind a key to an action (possibly creating a new action)
 */
function bindkey(keystr, actionName=null, handler=null, options={}) {
    Module.Utils().assert(!options.settings,
        "Can only bind schemaless actions - change action's settings instead",
        actionName);

    let action = actionName && actions.find(a => a.name === actionName);
    let keycombo = keystrToKeycombo(keystr);

    if (!action) {
        action = registerAction(actionName, handler, options);
    } else {
        let boundAction = keycomboMap[keycombo];
        if (boundAction && boundAction != action) {
            console.debug("Rebinding", keystr, "to", actionName, "from", boundAction.name);
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

        ExtensionModule.errorNotification(
            "PaperWM (user.js): Could not enable keybinding",
            `Tried to bind ${keystr} to ${actionName}\n${message}`);
    }

    return action.id;
}

function unbindkey(actionIdOrKeystr) {
    let actionId;
    if (typeof(actionIdOrKeystr) === "string") {
        const action = keycomboMap[keystrToKeycombo(actionIdOrKeystr)];
        actionId = action && action.id;
    } else {
        actionId = actionIdOrKeystr;
    }

    disableAction(actionIdMap[actionId]);
}

function devirtualizeMask(gdkVirtualMask) {
    const keymap = Seat.get_keymap();
    let [success, rawMask] = keymap.map_virtual_modifiers(gdkVirtualMask);
    if (!success)
        throw new Error("Couldn't devirtualize mask " + gdkVirtualMask);
    return rawMask;
}

function rawMaskOfKeystr(keystr) {
    let [dontcare, keycodes, mask] = Module.Settings().accelerator_parse(keystr);
    return devirtualizeMask(mask);
}

function openNavigatorHandler(actionName, keystr) {
    const mask = rawMaskOfKeystr(keystr) & 0xff;

    const binding = {
        get_name: () => actionName,
        get_mask: () => mask,
        is_reversed: () => false,
    }
    return function(display, screen, metaWindow) {
        return Module.Navigator().preview_navigate(
            metaWindow, null, {screen, display, binding});
    }
}

function getActionIdByActionName(actionName) {
    // HACK!!
    try {
        return Meta.prefs_get_keybinding_action(actionName);
    } catch(e) {
        try {
            return parseInt(e.message.split(" ")[0]);
        } catch(e2) {
            console.error("Could not find actionId for", actionName);
            return Meta.KeyBindingAction.NONE;
        }
    }
}

function getBoundActionId(keystr) {
    let [dontcare, keycodes, mask] = Module.Settings().accelerator_parse(keystr);
    if (keycodes.length > 1) {
        throw new Error("Multiple keycodes " + keycodes + " " + keystr);
    }
    const rawMask = devirtualizeMask(mask);
    return display.get_keybinding_action(keycodes[0], rawMask);
}

function handleAccelerator(display, actionId, deviceId, timestamp) {
    const action = actionIdMap[actionId];
    if (action) {
        Module.Utils().debug("#keybindings", "Schemaless keybinding activated",
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
        display.ungrab_accelerator(action.id)
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

        let actionId;
        if (display.grab_accelerator.length > 1) {
            actionId = display.grab_accelerator(action.keystr, Meta.KeyBindingFlags.NONE);
        } else  {
            // gnome-shell 3.2x
            actionId = display.grab_accelerator(action.keystr);
        }

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

function getActionId(mutterName) {
    let id;
    try {
        id = Meta.prefs_get_keybinding_action(mutterName);
    } catch (e) {
        // This is a pretty ugly hack to extract any action id
        // When the mutterName isn't a builtin it throws, exposing the id in the
        // message.

        // The error message starts off with the action id, so we just strip
        // everything after that.
        id = Number.parseInt(e.message.replace(/ .*$/, ''));
        if (!Number.isInteger(id))
            throw Error(`${id} is not an integer, broken hack`);
    }
    return id;
}

function overrideAction(mutterName, action) {
    let id = getActionId(mutterName);
    Main.wm.setCustomKeybindingHandler(mutterName, Shell.ActionMode.NORMAL,
        action.keyHandler);
    if (id === Meta.KeyBindingAction.NONE)
        return;
    actionIdMap[id] = action;
}

function resolveConflicts() {
    resetConflicts();
    for (let conflict of Module.Settings().findConflicts()) {
        let {name, conflicts} = conflict;
        let action = byMutterName(name);
        // Actionless key, can happen with updated schema without restart
        if (!action)
            continue;
        conflicts.forEach(c => overrideAction(c, action));
        overrides.push(conflict);
    }
}

function resetConflicts() {
    let names = overrides.reduce((sum, add) => sum.concat(add.conflicts), []);
    for (let name of names) {
        let id = getActionId(name);
        delete actionIdMap[id];
        // Bultin mutter actions can be reset by setting their custom handler to
        // null. However gnome-shell often sets a custom handler of its own,
        // which means we most often can't rely on that
        if (name.startsWith('switch-to-workspace-') ||
            name.startsWith('move-to-workspace-')) {
            Main.wm.setCustomKeybindingHandler(
                name,
                Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
                Main.wm._showWorkspaceSwitcher.bind(Main.wm));
            continue;
        }
        switch (name) {
        case 'cycle-group': case 'cycle-group-backwards':
        case 'cycle-windows': case 'cycle-windows-backwards':
        case 'switch-applications': case 'switch-applications-backward':
        case 'switch-group': case 'switch-group-backward':
            Main.wm.setCustomKeybindingHandler(
                name, Shell.ActionMode.NORMAL,
                Main.wm._startSwitcher.bind(Main.wm));
            break;
        case 'switch-panels': case 'switch-panels-backwards':
            Main.wm.setCustomKeybindingHandler(
                name,
                Shell.ActionMode.NORMAL |
                    Shell.ActionMode.OVERVIEW |
                    Shell.ActionMode.LOCK_SCREEN |
                    Shell.ActionMode.UNLOCK_SCREEN |
                    Shell.ActionMode.LOGIN_SCREEN,
                Main.wm._startA11ySwitcher.bind(Main.wm));
            break;
        case 'switch-monitor':
            Main.wm.setCustomKeybindingHandler(
                name,
                Shell.ActionMode.NORMAL |
                    Shell.ActionMode.OVERVIEW,
                Main.wm._startSwitcher.bind(Main.wm));
            break;
        case 'focus-active-notification':
            Main.wm.setCustomKeybindingHandler(
                name,
                Shell.ActionMode.NORMAL |
                    Shell.ActionMode.OVERVIEW,
                Main.messageTray._expandActiveNotification.bind(Main.messageTray));
            break;
        case 'pause-resume-tweens':
            Main.wm.setCustomKeybindingHandler(
                name,
                Shell.ActionMode.NORMAL |
                    Shell.ActionMode.OVERVIEW |
                    Shell.ActionMode.POPUP,
                Main.wm._toggleCalendar.bind(Main.wm));
            break;
        case 'open-application-menu':
            Main.wm.setCustomKeybindingHandler(
                name,
                Shell.ActionMode.NORMAL |
                    Shell.ActionMode.POPUP,
                Main.wm._toggleAppMenu.bind(Main.wm));
            break;
        case 'toggle-message-tray':
            Main.wm.setCustomKeybindingHandler(
                name,
                Shell.ActionMode.NORMAL |
                    Shell.ActionMode.OVERVIEW |
                    Shell.ActionMode.POPUP,
                Main.wm._toggleCalendar.bind(Main.wm));
            break;
        case  'toggle-application-view':
            // overview._controls: Backward compatibility for 3.34 and below:
            const viewSelector = (Main.overview._overview._controls || Main.overview.viewSelector || Main.overview._controls.viewSelector);

            Main.wm.setCustomKeybindingHandler(
                name,
                Shell.ActionMode.NORMAL |
                    Shell.ActionMode.OVERVIEW,
                viewSelector._toggleAppsPage.bind(viewSelector));
            break;
        case 'toggle-overview':
            Main.wm.setCustomKeybindingHandler(
                name,
                Shell.ActionMode.NORMAL |
                    Shell.ActionMode.OVERVIEW,
                Main.overview.toggle.bind(Main.overview));
            break;
        case 'switch-input-source':
        case 'switch-input-source-backward':
            const inputSourceIndicator = Main.inputMethod._inputSourceManager;
            Main.wm.setCustomKeybindingHandler(
                name,
                Shell.ActionMode.ALL,
                inputSourceIndicator._switchInputSource.bind(inputSourceIndicator));
            break;
        case 'panel-main-menu':
            const sessionMode = Main.sessionMode;
            const overview = Main.overview;
            Main.wm.setCustomKeybindingHandler(
                name,
                Shell.ActionMode.NORMAL |
                    Shell.ActionMode.OVERVIEW,
                sessionMode.hasOverview ? overview.toggle.bind(overview) : null);
            break;
        case 'panel-run-dialog':
            Main.wm.setCustomKeybindingHandler(
                name,
                Shell.ActionMode.NORMAL |
                    Shell.ActionMode.OVERVIEW,
                Main.sessionMode.hasRunDialog ? Main.openRunDialog : null);
            break;
        default:
            Meta.keybindings_set_custom_handler(name, null);
        }
    };
    overrides = [];
}

function enable() {
    setupActions();
    let schemas = [...Module.Settings().getConflictSettings(),
        Module.ExtensionUtils.getSettings(KEYBINDINGS_KEY)];
    schemas.forEach(schema => {
        signals.connect(schema, 'changed', resolveConflicts);
    });

    signals.connect(
        display,
        'accelerator-activated',
        Module.Utils().dynamic_function_ref(handleAccelerator.name, this)
    );
    actions.forEach(enableAction);
    resolveConflicts(schemas);
}

function disable() {
    signals.destroy();
    actions.forEach(disableAction);
    resetConflicts();

    actions = null;
    nameMap = null;
    actionIdMap = null;
    keycomboMap = null;
    overrides = null;
}
