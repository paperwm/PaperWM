var Extension = imports.misc.extensionUtils.extensions['paperwm@hedning:matrix.org'];
var Me = Extension.imports.keybindings;
var Gdk = imports.gi.Gdk;
var Gtk = imports.gi.Gtk;
var Meta = imports.gi.Meta;

var Utils = Extension.imports.utils;
var Main = imports.ui.main;
var Shell = imports.gi.Shell;

var convenience = Extension.imports.convenience;

var Navigator = Extension.imports.navigator;

var signals, actions, nameMap, actionIdMap, keycomboMap;
function init() {
    signals = new Utils.Signals();
    actions = [];
    nameMap = {};     // mutter keybinding action name -> action
    actionIdMap = {}; // actionID   -> action
    keycomboMap = {}; // keycombo   -> action
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
    return actions.find(action => action.id == mutterId);
}

/**
 * NB: handler interface not stabilized: atm. its the same as mutter keyhandler
 * interface, but we'll change that in the future
 *
 * handler: function(ignored, ignored, metaWindow) -> ignored
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
        keyHandler = opensNavigator ? Navigator.preview_navigate : handler;
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

    enableAction(action); // sets `action.id`

    actions.push(action);
    if (actionName)
        nameMap[actionName] = action;
    if (action.id)
        actionIdMap[action.id] = action;

    return action;
}

/**
 * Bind a key to an action (possibly creating a new action)
 */
function bindkey(keystr, actionName=null, handler=null, options=null) {
    let action = actionName && actions.find(a => a.name === actionName);

    if (!action) {
        action = registerAction(actionName, Utils.as_key_handler(handler), options);
    } else {
        // Maybe nicer to simply update the action?
        Utils.assert(!handler && !options, "Action already registered, rebind instead",
                     actionName);
    }

    Utils.assert(!action.settings,
                 "Can only bind schemaless actions - change action's settings instead",
                 actionName);

    let keycombo = keystrToKeycombo(keystr);
    let boundAction = keycomboMap[keycombo]
    if (boundAction) {
        log("Rebinding", keystr, "to", actionName, "from", boundAction.name);
        unbindkey(boundAction.id)
    }

    let actionId = global.display.grab_accelerator(keystr);
    if (actionId === Meta.KeyBindingAction.NONE) {
        // Failed to grab. Binding probably already taken.
        log("Failed to grab")
        return null;
    }

    let mutterName = Meta.external_binding_name_for_action(actionId);

    action.id = actionId;
    action.mutterName = mutterName;

    if (action.options.opensNavigator) {
        action.keyHandler = openNavigatorHandler(mutterName, keystr);
    } else {
        action.keyHandler = Utils.as_key_handler(handler);
    }

    Main.wm.allowKeybinding(action.mutterName, Shell.ActionMode.ALL);

    nameMap[mutterName] = action;
    actionIdMap[actionId] = action;
    keycomboMap[keycombo] = action;

    return actionId;
}

function unbindkey(actionIdOrKeystr) {
    let actionId;
    if (typeof(actionId) === "string") {
        const action = keycomboMap[keystrToKeycombo(actionIdOrKeystr)];
        actionId = action && action.id
    } else {
        actionId = actionIdOrKeystr;
    }

    const action = actionIdMap[actionId];
    Utils.assert(!action.settings,
                 "Can not unbind schema-actions",
                 action.name, actionIdOrKeystr);

    if (!action) {
        log("Attempted to unbind unbound keystr/action", actionIdOrKeystr);
        return null;
    }

    if (!action.name) {
        // anonymous action -> remove the action too
        delete keycomboMap[action.combo];
        delete actionIdMap[action.id];
        delete nameMap[action.mutterName];
    }

    return global.display.ungrab_accelerator(actionId);
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

/**
 * Two keystrings can represent the same key combination
 */
function keystrToKeycombo(keystr) {
    // ASSUMPTION: Gtk parses accelerators mostly the same as mutter
    let [key, mask] = Gtk.accelerator_parse(keystr);
    return `${key}|${mask}`; // Since js doesn't have a mapable tuple type
}

function openNavigatorHandler(actionName, keystr) {
    const mask = rawMaskOfKeystr(keystr) & 0xff;

    const dummyEvent = {
        get_name: () => actionName,
        get_mask: () => mask,
        is_reversed: () => false,
    }
    return function(display, screen, metaWindow) {
        return Navigator.preview_navigate(
            display, screen, metaWindow, dummyEvent);
    }
}

function getBoundActionId(keystr) {
    let [dontcare, keycodes, mask] =
        Gtk.accelerator_parse_with_keycode(keystr);
    if(keycodes.length > 1) {
        throw new Error("Multiple keycodes " + keycodes + " " + keystr);
    }
    const rawMask = devirtualizeMask(mask);
    return global.display.get_keybinding_action(keycodes[0], rawMask);
}

function handleAccelerator(display, actionId, deviceId, timestamp) {
    const action = actionIdMap[actionId];
    if (action) {
        Utils.debug("#keybindings", "Schemaless keybinding activated",
                    actionId, action.name);
        action.keyHandler(display, null, global.display.focus_window);
    }
}


function disableAction(action) {
    if (action.options.settings) {
        Main.wm.removeKeybinding(action.mutterName);
        action.id = Meta.KeyBindingAction.NONE;
    } else {
        // Should only be called in disable/enable - schemaless actions are
        // disabled/enabled by other means
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

        if (actionId !== Meta.KeyBindingAction.NONE)
            action.id = actionId;
        else
            Utils.warn("Could not enable action", action.name);

    } else {
        // Should only be called in disable/enable - schemaless actions are
        // disabled/enabled by other means
    }
}

function enable() {
    signals.connect(
        global.display,
        'accelerator-activated',
        Utils.dynamic_function_ref(handleAccelerator.name, Me)
    );
    actions.forEach(enableAction);
}

function disable() {
    signals.destroy();
    actions.forEach(disableAction);
}
