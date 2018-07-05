var Extension = imports.misc.extensionUtils.extensions['paperwm@hedning:matrix.org'];
var Me = Extension.imports.keybindings;
var Gdk = imports.gi.Gdk;
var Gtk = imports.gi.Gtk;
var Meta = imports.gi.Meta;

var Utils = Extension.imports.utils;
var Main = imports.ui.main;
var Shell = imports.gi.Shell;

var convenience = Extension.imports.convenience;
var signals = new Utils.Signals();

var Navigator = Extension.imports.navigator;

/*
    Keep track of some mappings mutter doesn't do/expose
    - action-name -> action-id mapping
    - action-id   -> action mapping
    - action      -> handler
*/
var paperActions = {
    actions: [],
    nameMap: {},
    unregisterSchemaless(actionId) {
        const i = this.actions.findIndex(a => a.id === actionId);
        if (i < 0) {
            log("Tried to remove un registered action", actionId);
            return;
        }
        delete this.nameMap[this.actions[i].name];
        this.actions.splice(i, 1);
    },
    registerSchemaless(actionId, actionName, handler) {
        let action = {
            id: actionId, name: actionName, handler
        }
        this.actions.push(action);
        this.nameMap[actionName] = action;
    },
    register: function(actionName, handler, metaKeyBindingFlags) {
        let id = registerMutterAction(actionName,
                                        handler,
                                        metaKeyBindingFlags);
        // If the id is NONE the action is already registered
        if (id === Meta.KeyBindingAction.NONE)
            return null;

        let action = { id: id
                        , name: actionName
                        , handler: handler
                        };
        this.actions.push(action);
        this.nameMap[actionName] = action;
        return action;
    },
    idOf: function(name) {
        let action = this.byName(name);
        if (action) {
            return action.id;
        } else {
            return Meta.KeyBindingAction.NONE;
        }
    },
    byName: function(name) {
        return this.nameMap[name];
    },
    byId: function(mutterId) {
        return this.actions.find(action => action.id == mutterId);
    }
};

/**
 * Register a key-bindable action (from our own schema) in mutter.
 *
 * Return the assigned numeric id.
 *
 * NB: use `Meta.keybindings_set_custom_handler` to re-assign the handler.
 */
function registerMutterAction(action_name, handler, flags) {
    flags = flags || Meta.KeyBindingFlags.NONE;

    let settings = convenience.getSettings('org.gnome.Shell.Extensions.PaperWM.Keybindings')

    return Main.wm.addKeybinding(action_name,
                                 settings, flags,
                                 Shell.ActionMode.NORMAL,
                                 handler);
}


var actionIdMap = {}; // actionID -> handler
var keycomboMap = {}
var actions = [];

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

function bindkey(keystr, handler, options={}) {
    let { opensNavigator, activeInNavigator, name } = options;
    if (opensNavigator)
        activeInNavigator = true;

    let keycombo = keystrToKeycombo(keystr);
    let boundAction = keycomboMap[keycombo]
    if (boundAction) {
        log("Rebinding", keystr);
        unbindkey(boundAction.id)
    }
    handler = Utils.as_key_handler(handler)

    let actionId = global.display.grab_accelerator(keystr);
    if (actionId === Meta.KeyBindingAction.NONE) {
        // Failed to grab. Binding probably already taken.
        log("Failed to grab")
        return null;
    }
    let actionName = Meta.external_binding_name_for_action(actionId);

    let action = {
        id: actionId,
        combo: keycombo,
        name: actionName,
        handler: opensNavigator
            ? openNavigatorHandler(actionName, keystr)
            : handler,
        options: options,
    };

    Main.wm.allowKeybinding(actionName, Shell.ActionMode.ALL);
    actionIdMap[actionId] = action;
    keycomboMap[keycombo] = action;

    if (activeInNavigator) {
        paperActions.registerSchemaless(actionId, actionName, handler);
    }

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
    if (!action) {
        log("Attempted to unbind unbound keystr/action", actionIdOrKeystr);
        return null;
    }

    delete keycomboMap[action.combo];
    delete actionIdMap[action.id];
    if (action.options.navigator) {
        paperActions.unregisterSchemaless(action.id);
    }
    
    return global.display.ungrab_accelerator(actionId);
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
        log("user.js keybinding activated", actionId, action.handler);
        action.handler(display, null, global.display.focus_window);
    }
}

function enable() {
    signals.connect(
        global.display,
        'accelerator-activated',
        Utils.dynamic_function_ref(handleAccelerator.name, Me)
    );
}

function disable() {
    signals.destroy();
}
