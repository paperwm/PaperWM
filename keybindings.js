var Extension = imports.misc.extensionUtils.extensions['paperwm@hedning:matrix.org'];
var Me = Extension.imports.keybindings;
var Gdk = imports.gi.Gdk;
var Gtk = imports.gi.Gtk;
var Gio = imports.gi.Gio;
var Meta = imports.gi.Meta;

var Utils = Extension.imports.utils;
var Main = imports.ui.main;
var Shell = imports.gi.Shell;

var convenience = Extension.imports.convenience;
var Settings = Extension.imports.settings;
var keystrToKeycombo = Settings.keystrToKeycombo;

var Navigator = Extension.imports.navigator;

var screen = global.screen;
var display = global.display;

var KEYBINDINGS_KEY = 'org.gnome.Shell.Extensions.PaperWM.Keybindings';

var signals, actions, nameMap, actionIdMap, keycomboMap, overrides, conflictSettings;
function init() {
    signals = new Utils.Signals();
    actions = [];
    nameMap = {};     // mutter keybinding action name -> action
    actionIdMap = {}; // actionID   -> action
    keycomboMap = {}; // keycombo   -> action
    overrides = [];   // action names that have been given a custom handler
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

/**
 * Adapts an paperwm action handler to mutter's keybinding handler signature
 */
function asKeyHandler(actionHandler) {
    return (display, screen, mw, binding) => {
        return actionHandler(mw, null, {display, screen, binding});   
    }
}

/**
 * handler: function(metaWindow, space, {binding, display, screen}) -> ignored
 */
function registerAction(actionName, handler, options) {
    options = Object.assign({}, options);

    if (options.opensNavigator)
        options.activeInNavigator = true;

    let {
        settings,
        mutterFlags, // Only relevant for "schema-actions"
        // The navigator should open when the action is invoked (through a keybinding?)
        opensNavigator,
        activeInNavigator, // The action makes sense when the navigator is open
        activeInScratch,
    } = options;

    let mutterName, keyHandler;
    if (settings) {
        Utils.assert(actionName, "Schema action must have a name");
        mutterName = actionName;
        keyHandler = opensNavigator
            ? asKeyHandler(Navigator.preview_navigate)
            : asKeyHandler(handler)
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
function bindkey(keystr, actionName=null, handler=null, options=null) {
    Utils.assert(!options.settings,
                 "Can only bind schemaless actions - change action's settings instead",
                 actionName);

    let action = actionName && actions.find(a => a.name === actionName);
    let keycombo = keystrToKeycombo(keystr);

    if (!action) {
        action = registerAction(actionName, handler, options);
    } else {
        let boundAction = keycomboMap[keycombo];
        if (boundAction != action) {
            log("Rebinding", keystr, "to", actionName, "from", boundAction.name);
            disableAction(boundAction)
        }

        disableAction(action);

        action.handler = handler;
        action.options = options;
    }

    action.keystr = keystr;
    action.keycombo = keycombo;

    enableAction(action);

    return action.id;
}

function unbindkey(actionIdOrKeystr) {
    let actionId;
    if (typeof(actionId) === "string") {
        const action = keycomboMap[keystrToKeycombo(actionIdOrKeystr)];
        actionId = action && action.id
    } else {
        actionId = actionIdOrKeystr;
    }

    disableAction(actionIdMap[actionId]);
}

function devirtualizeMask(gdkVirtualMask) {
    const keymap = Gdk.Keymap.get_default();
    let [success, rawMask] = keymap.map_virtual_modifiers(gdkVirtualMask);
    if (!success)
        throw new Error("Couldn't devirtualize mask " + gdkVirtualMask);
    return rawMask;
}

function rawMaskOfKeystr(keystr) {
    let [dontcare, keycodes, mask] =
        Gtk.accelerator_parse_with_keycode(keystr);
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
        return Navigator.preview_navigate(
            metaWindow, null, {screen, display, binding});
    }
}

function getBoundActionId(keystr) {
    let [dontcare, keycodes, mask] =
        Gtk.accelerator_parse_with_keycode(keystr);
    if(keycodes.length > 1) {
        throw new Error("Multiple keycodes " + keycodes + " " + keystr);
    }
    const rawMask = devirtualizeMask(mask);
    return display.get_keybinding_action(keycodes[0], rawMask);
}

function handleAccelerator(display, actionId, deviceId, timestamp) {
    const action = actionIdMap[actionId];
    if (action) {
        Utils.debug("#keybindings", "Schemaless keybinding activated",
                    actionId, action.name);
        action.keyHandler(display, null, display.focus_window);
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
        return; // Already enabled (happens on enable right after init)

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
        } else
            Utils.warn("Could not enable action", action.name);

    } else {
        if (keycomboMap[action.keycombo]) {
            Utils.assert("Other action bound to", action.keystr, keycomboMap[action.keycombo].name)
            return;
        }

        let actionId = display.grab_accelerator(action.keystr);
        if (actionId === Meta.KeyBindingAction.NONE) {
            log("Failed to grab. Binding probably already taken");
            return;
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
    for (let conflict of Settings.findConflicts()) {
        let {name, conflicts} = conflict;
        let action = byMutterName(name);
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
                Shell.ActionMode.NORMAL |
                    Shell.ActionMode.OVERVIEW,
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
            const viewSelector = Main.overview._controls.viewSelector;
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
    let schemas = [...Settings.conflictSettings,
                   convenience.getSettings(KEYBINDINGS_KEY)];
    schemas.forEach(schema => {
        signals.connect(schema, 'changed', resolveConflicts);
    });

    signals.connect(
        display,
        'accelerator-activated',
        Utils.dynamic_function_ref(handleAccelerator.name, Me)
    );
    actions.forEach(enableAction);
    resolveConflicts(schemas);
}

function disable() {
    signals.destroy();
    actions.forEach(disableAction);
    resetConflicts();
}
