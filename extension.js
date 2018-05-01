var Extension = imports.misc.extensionUtils.getCurrentExtension();
var convenience = Extension.imports.convenience;

var modules = [
    Extension.imports.tiling, Extension.imports.scratch,
    Extension.imports.liveAltTab, Extension.imports.utils,
    Extension.imports.stackoverlay, Extension.imports.app,
    Extension.imports.kludges, Extension.imports.topbar,
    Extension.imports.navigator
];
var [ Tiling, Scratch, LiveAltTab,
        utils, StackOverlay,
        App, Kludges, TopBar,
        Navigator
      ] = modules;

var debug = utils.debug;

var Gio = imports.gi.Gio;
var GLib = imports.gi.GLib;
var Meta = imports.gi.Meta;
var Main = imports.ui.main;
var Shell = imports.gi.Shell;
var Lang = imports.lang;

let SESSIONID = ""+(new Date().getTime());
// The extension sometimes go through multiple init -> enable -> disable cycles..
// Keep track of the count here.
let initRun;
let enabled = false;

window.PaperWM = Extension;

var wmSettings;
var shellSettings;
var paperSettings;
var paperActions;
function init() {
    SESSIONID += "#"
    debug('init', SESSIONID);

    if(initRun) {
        debug("#startup",
              "Reinitialized against our will! Skip adding bindings again to not cause trouble. ('disable()' isn't fully implemented yet)")
        return;
    }
    initRun = true;

    modules.forEach(m => m.init && m.init());

    wmSettings =
        new Gio.Settings({ schema_id: "org.gnome.desktop.wm.keybindings"});

    shellSettings = new Gio.Settings({ schema_id: "org.gnome.shell.keybindings"});
    paperSettings = convenience.getSettings();

    /*
      Keep track of some mappings mutter doesn't do/expose
      - action-name -> action-id mapping
      - action-id   -> action mapping
      - action      -> handler
    */
    paperActions = {
        actions: [],
        nameMap: {},
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

    let dynamic_function_ref = utils.dynamic_function_ref;
    let as_key_handler = utils.as_key_handler;

    // Or use "toggle-maximize"?
    Meta.keybindings_set_custom_handler("maximize-horizontally",
                                        as_key_handler("toggleMaximizeHorizontally",
                                                       Tiling));

    paperActions.register('live-alt-tab',
                          dynamic_function_ref('liveAltTab',
                                               LiveAltTab))
    paperActions.register('live-alt-tab-backward',
                          dynamic_function_ref('liveAltTab',
                                               LiveAltTab),
                          Meta.KeyBindingFlags.IS_REVERSED);

    paperActions.register('previous-workspace',
                          dynamic_function_ref("preview_navigate",
                                               Navigator));
    paperActions.register('previous-workspace-backward',
                          dynamic_function_ref("preview_navigate",
                                               Navigator));
    paperActions.register('move-previous-workspace',
                          dynamic_function_ref("preview_navigate",
                                               Navigator));
    paperActions.register('move-previous-workspace-backward',
                          dynamic_function_ref("preview_navigate",
                                               Navigator));
    paperActions.register("switch-next",
                          dynamic_function_ref("preview_navigate",
                                               Navigator));
    paperActions.register("switch-previous",
                          dynamic_function_ref("preview_navigate",
                                               Navigator),
                          Meta.KeyBindingFlags.IS_REVERSED);

    paperActions.register("move-left",
                          dynamic_function_ref("preview_navigate",
                                               Navigator));
    paperActions.register("move-right",
                          dynamic_function_ref("preview_navigate",
                                               Navigator));
    paperActions.register("toggle-scratch-layer",
                          dynamic_function_ref("toggleScratch",
                                               Scratch));

    paperActions.register("toggle-scratch",
                          utils.as_key_handler("toggle",
                                               Scratch),
                          Meta.KeyBindingFlags.PER_WINDOW);

    paperActions.register("develop-set-globals",
                          dynamic_function_ref("setDevGlobals",
                                               utils));

    paperActions.register("cycle-width",
                          as_key_handler("cycleWindowWidth",
                                         Tiling),
                          Meta.KeyBindingFlags.PER_WINDOW);
    paperActions.register("tile-visible",
                          as_key_handler("tileVisible",
                                         Tiling),
                          Meta.KeyBindingFlags.PER_WINDOW);

    paperActions.register('new-window',
                          as_key_handler('newWindow',
                                         App),
                          Meta.KeyBindingFlags.PER_WINDOW);
}

let originalBindings = new Map();
function killKeybinding (key, settings) {
    settings = settings
        || new Gio.Settings({ schema_id: "org.gnome.desktop.wm.keybindings"});
    if (!originalBindings.get(settings))
        originalBindings.set(settings, {});
    let store = originalBindings.get(settings);
    store[key] = settings.get_user_value(key);
    settings.set_strv(key, []);
}

function restoreKeybindings() {
    for (let [settings, store] of originalBindings) {
        for (let key in store) {
            // Reset the key to its default value
            settings.reset(key);
            let userValue = store[key];
            if (userValue) {
                settings.set_strv(key, userValue.unpack());
            }
        }
    }
}

function setKeybinding(name, func) {
    Main.wm.setCustomKeybindingHandler(name, Shell.ActionMode.NORMAL, func);
}

let nWorkspacesSignal;
let workspaceRemovedSignal;
let windowCreatedSignal;
function enable() {
    // Only enable after disable have been run
    if (enabled)
        return;

    modules.forEach(m => m.enable && m.enable());

    debug('enable', SESSIONID);

    // Restore settings if we've reloaded
    // restoreKeybindings(paperSettings);

    let settings = new Gio.Settings({ schema_id: "org.gnome.desktop.wm.keybindings"});

    settings.set_strv("close", ['<super>c'])
    settings.set_strv("maximize-horizontally", ['<super>f'])
    settings.set_strv("toggle-fullscreen", ['<super><shift>f']);

    setKeybinding('switch-applications',
                  utils.dynamic_function_ref('liveAltTab',
                                             LiveAltTab));
    setKeybinding('switch-applications-backward',
                  utils.dynamic_function_ref('liveAltTab',
                                             LiveAltTab));
    setKeybinding('switch-group',
                          utils.dynamic_function_ref("preview_navigate",
                                                     Navigator));
    setKeybinding('switch-group-backward',
                          utils.dynamic_function_ref("preview_navigate",
                                                     Navigator));

    setKeybinding('focus-active-notification', // `<Super>N`
                  utils.as_key_handler('newWindow', App));
    // Switched to '<super>escape' in 3.28
    killKeybinding('restore-shortcuts',
                   new Gio.Settings({ schema_id: "org.gnome.mutter.wayland.keybindings"}));

    enabled = true;

    loadRcFile();
}

function disable() {
    if (!enabled)
        return;
    debug("disable", SESSIONID);
    // Disconnect focus and reset scale and pivot

    setKeybinding('switch-applications',
                  Main.wm._startSwitcher.bind(Main.wm));
    setKeybinding('switch-applications-backward',
                  Main.wm._startSwitcher.bind(Main.wm));
    setKeybinding('switch-group',
                  Main.wm._startSwitcher.bind(Main.wm));
    setKeybinding('switch-group-backward',
                  Main.wm._startSwitcher.bind(Main.wm));

    Main.wm.setCustomKeybindingHandler('focus-active-notification',
                                       Shell.ActionMode.NORMAL |
                                       Shell.ActionMode.OVERVIEW,
                                       Main.messageTray._expandActiveNotification.bind(Main.messageTray));

    modules.forEach(m => m.disable && m.disable());

    enabled = false;
}

/**
 * Register a key-bindable action (from our own schema) in mutter.
 *
 * Return the assigned numeric id.
 *
 * NB: use `Meta.keybindings_set_custom_handler` to re-assign the handler.
 */
function registerMutterAction(action_name, handler, flags) {
    // Ripped from https://github.com/negesti/gnome-shell-extensions-negesti 
    // Handles multiple gnome-shell versions
    flags = flags || Meta.KeyBindingFlags.NONE;

    if (Main.wm.addKeybinding && Shell.ActionMode){ // introduced in 3.16
        return Main.wm.addKeybinding(action_name,
                                     convenience.getSettings(), flags,
                                     Shell.ActionMode.NORMAL,
                                     handler
                                    );
    } else if (Main.wm.addKeybinding && Shell.KeyBindingMode) { // introduced in 3.7.5
        // Shell.KeyBindingMode.NORMAL | Shell.KeyBindingMode.MESSAGE_TRAY,
        return Main.wm.addKeybinding(action_name,
                                     convenience.getSettings(), flags,
                                     Shell.KeyBindingMode.NORMAL,
                                     handler
                                    );
    } else {
        return global.display.add_keybinding(
            action_name,
            convenience.getSettings(),
            flags,
            handler
        );
    }
}

function loadRcFile() {
    try {
        // https://github.com/coolwanglu/gnome-shell-extension-rc/blob/master/extension.js
        // But since we want to be sure that our extension is loaded at the time 
        // we load our own. 
        //
        // Note that `imports.misc.extensionUtils.getCurrentExtension();` works
        // inside the rc file
        const rcpath = GLib.getenv('HOME') + '/.config/' + "paperwm-rc.js"
        if (GLib.file_test(rcpath, GLib.FileTest.IS_REGULAR)) {
            const [success, rcCodeBytes] = GLib.file_get_contents(rcpath);
            if (success) {
                debug("Loading rcfile:", rcpath)
                eval(rcCodeBytes.toString());
            } else {
                debug("Failed to read rcfile");
            }
        }
    } catch(e) {
        debug("rcfile error", e.message, e.stack);
    }
}
