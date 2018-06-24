var Extension = imports.misc.extensionUtils.getCurrentExtension();
var convenience = Extension.imports.convenience;

var modules = [
    Extension.imports.tiling, Extension.imports.scratch,
    Extension.imports.liveAltTab, Extension.imports.utils,
    Extension.imports.stackoverlay, Extension.imports.app,
    Extension.imports.kludges, Extension.imports.topbar,
    Extension.imports.navigator, Extension.imports.prefs
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
/**
 * The extension sometimes go through multiple init -> enable -> disable
 * cycles. So we need to keep track of whether we're initialized..
 */
let initRun;
let enabled = false;

window.PaperWM = Extension;

var wmSettings;
var shellSettings;
var paperSettings;
var paperActions;
function init() {
    SESSIONID += "#"
    log(`init: ${SESSIONID}`);

    if(initRun) {
        log(`#startup Reinitialized against our will! Skip adding bindings again to not cause trouble.`);
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

    paperActions.register("switch-right",
                          dynamic_function_ref("preview_navigate",
                                               Navigator));
    paperActions.register("switch-left",
                          dynamic_function_ref("preview_navigate",
                                               Navigator),
                          Meta.KeyBindingFlags.IS_REVERSED);
    paperActions.register("switch-up",
                          dynamic_function_ref("preview_navigate",
                                               Navigator));
    paperActions.register("switch-down",
                          dynamic_function_ref("preview_navigate",
                                               Navigator),
                          Meta.KeyBindingFlags.IS_REVERSED);

    paperActions.register("move-left",
                          dynamic_function_ref("preview_navigate",
                                               Navigator));
    paperActions.register("move-right",
                          dynamic_function_ref("preview_navigate",
                                               Navigator));
    paperActions.register("move-up",
                          dynamic_function_ref("preview_navigate",
                                               Navigator));
    paperActions.register("move-down",
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

    paperActions.register("center-horizontally",
                          as_key_handler("centerWindowHorizontally",
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

    paperActions.register('close-window',
                          as_key_handler(
                              (metaWindow) =>
                                  metaWindow.delete(global.get_current_time())),
                          Meta.KeyBindingFlags.PER_WINDOW);


    initUserConfig();
}

function setKeybinding(name, func) {
    Main.wm.setCustomKeybindingHandler(name, Shell.ActionMode.NORMAL, func);
}

let nWorkspacesSignal;
let workspaceRemovedSignal;
let windowCreatedSignal;
function enable() {
    let settings = new Gio.Settings({ schema_id: "org.gnome.desktop.wm.keybindings"});

    settings.set_strv("maximize-horizontally", ['<super>f'])

    settings.set_strv("toggle-fullscreen", ['<super><shift>f']);

    setKeybinding('switch-applications', // <Super>Tab
                  utils.dynamic_function_ref('liveAltTab',
                                             LiveAltTab));
    setKeybinding('switch-applications-backward',
                  utils.dynamic_function_ref('liveAltTab',
                                             LiveAltTab));
    setKeybinding('switch-group', // <Super>Above_tab
                          utils.dynamic_function_ref("preview_navigate",
                                                     Navigator));
    setKeybinding('switch-group-backward',
                          utils.dynamic_function_ref("preview_navigate",
                                                     Navigator));
    setKeybinding('maximize', // <Super>Up
                  utils.dynamic_function_ref("preview_navigate",
                                             Navigator));
    setKeybinding('unmaximize', // <Super>Down
                  utils.dynamic_function_ref("preview_navigate",
                                             Navigator));

    setKeybinding('switch-to-workspace-down', // <Super>Page_Down
                  utils.dynamic_function_ref("preview_navigate",
                                             Navigator));

    setKeybinding('switch-to-workspace-up', // <Super>Page_Up
                  utils.dynamic_function_ref("preview_navigate",
                                             Navigator));

    setKeybinding('focus-active-notification', // `<Super>N`
                  utils.as_key_handler('newWindow', App));

    setKeybinding('restore-shortcuts', // `<Super>Escape`
                  utils.dynamic_function_ref("toggleScratch",
                                             Scratch));

    setKeybinding('toggle-tiled-right', // <Super>Right
                  utils.dynamic_function_ref('preview_navigate', Navigator));

    setKeybinding('toggle-tiled-left', // <Super>Left
                  utils.dynamic_function_ref('preview_navigate', Navigator));


    setKeybinding('switch-to-workspace-1', // <Super>Home
                  Tiling.activateFirstWindow);
    setKeybinding('switch-to-workspace-last', // <Super>End
                  Tiling.activateLastWindow);

    paperActions.actions.forEach(a => {
        setKeybinding(a.name, a.handler);
    });

    // Only enable modules after disable have been run
    if (enabled) {
        log('enable called without calling disable');
        return;
    }
    log(`enabled ${SESSIONID}`);

    modules.forEach(m => m.enable && m.enable());

    enabled = true;
}

function disable() {
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

    Meta.keybindings_set_custom_handler('toggle-tiled-left', null);
    Meta.keybindings_set_custom_handler('toggle-tiled-right', null);
    Meta.keybindings_set_custom_handler('maximize', null);
    Meta.keybindings_set_custom_handler('unmaximize', null);
    Meta.keybindings_set_custom_handler('restore-shortcuts', null);
    Meta.keybindings_set_custom_handler('switch-to-workspace-1', null);
    Meta.keybindings_set_custom_handler('switch-to-workspace-last', null);
    Meta.keybindings_set_custom_handler('switch-to-workspace-down', null);
    Meta.keybindings_set_custom_handler('switch-to-workspace-up', null);

    paperActions.actions.forEach(a => {
        setKeybinding(a.name, () => {});
    });

    if (!enabled)
        return;
    log(`disable ${SESSIONID}`);

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


function getConfigDir() {
    return Gio.file_new_for_path(GLib.getenv('HOME') + '/.config/paperwm');
}

function hasUserConfigFile() {
    return getConfigDir().get_child("user.js").query_exists(null);
}

function installConfig() {
    try {
        utils.debug("#rc", "Installing config")
        const configDir = getConfigDir();
        configDir.make_directory_with_parents(null);

        // We copy metadata.json to the config directory so gnome-shell-mode
        // know which extension the files belong to (ideally we'd symlink, but
        // that trips up the importer: Extension.imports.<complete> in
        // gnome-shell-mode crashes gnome-shell..)
        const metadata = Extension.dir.get_child("metadata.json");
        metadata.copy(configDir.get_child("metadata.json"), Gio.FileCopyFlags.NONE, null, null);

        // Copy the user.js template to the config directory
        const user = Extension.dir.get_child("examples/user.js");
        user.copy(configDir.get_child("user.js"), Gio.FileCopyFlags.NONE, null, null);

        const settings = convenience.getSettings()
        settings.set_boolean("has-installed-config-template", true);

    } catch(e) {
        utils.debug("#rc", "Install failed", e.message);
    }
}

function errorWrappedModule(module) {
    function safeCall(method) {
        try {
            utils.debug("#rc", `calling ${method}`);
            module[method].call(module)
        } catch(e) {
            utils.debug("#rc", `${method} failed`, e.message);
            utils.print_stacktrace(e);
            errorNotification("PaperWM",
                `Error occured in user.js@${method}:\n\n${e.message}`,
                e.stack
            );
        }
    }
    return {
        init: () => {
            safeCall("init");
        },
        enable: () => {
            safeCall("enable");
        },
        disable: () => {
            safeCall("disable");
        }
    };
}

function initUserConfig() {
    const paperSettings = convenience.getSettings();

    if (!paperSettings.get_boolean("has-installed-config-template")) {
        installConfig();
        const configDir = getConfigDir().get_path();
        const notification = notify("PaperWM", `Installed user configuration in ${configDir}`);
        notification.connect('activated', () => {
            imports.misc.util.spawn(["nautilus", configDir]);
            notification.destroy();
        });
    }

    if (hasUserConfigFile()) {
        Extension.imports.searchPath.push(getConfigDir().get_path());
        try {
            utils.debug("#rc", "Loading config file");
            const userModule = errorWrappedModule(Extension.imports.user);
            modules.push(userModule);
            userModule.init();
        } catch(e) {
            utils.debug("#rc", "Loading config failed", e.message);
            utils.print_stacktrace(e);
            errorNotification("PaperWM", `Loading user.js failed:\n\n${e.message}`, e.stack);
            return;
        }
    }
}

/**
 * Our own version of imports.ui.main.notify allowing more control over the
 * notification 
 */
function notify(msg, details, params) {
    const MessageTray = imports.ui.messageTray;
    let source = new MessageTray.SystemNotificationSource();
    // note-to-self: the source is automatically destroyed when all its
    // notifications are removed.
    Main.messageTray.add(source);
    let notification = new MessageTray.Notification(source, msg, details, params);
    notification.setResident(true); // Usually more annoying that the notification disappear than not
    source.notify(notification);
    return notification;
}

function spawnPager(content) {
    const quoted = GLib.shell_quote(content);
    imports.misc.util.spawn(["sh", "-c", `echo -En ${quoted} | gedit --new-window -`])
}

/**
 * Show an notification opening a the full message in dedicated window upon
 * activation
 */
function errorNotification(title, message, fullMessage) {
    const notification = notify(title, message);
    notification.connect('activated', () => {
        spawnPager([title, message, "", fullMessage].join("\n"));
        notification.destroy();
    });
}
