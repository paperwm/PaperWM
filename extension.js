var Extension = imports.misc.extensionUtils.extensions['paperwm@hedning:matrix.org'];
var convenience = Extension.imports.convenience;

var modules = [
    Extension.imports.tiling, Extension.imports.scratch,
    Extension.imports.liveAltTab, Extension.imports.utils,
    Extension.imports.stackoverlay, Extension.imports.app,
    Extension.imports.kludges, Extension.imports.topbar,
    Extension.imports.navigator, Extension.imports.settings,
    Extension.imports.keybindings,
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

var Keybindings = Extension.imports.keybindings;

function registerPaperAction(actionName, handler, flags) {
    let settings = convenience.getSettings('org.gnome.Shell.Extensions.PaperWM.Keybindings');
    Keybindings.registerAction(
        actionName,
        handler,
        {settings: settings, mutterFlags: flags, activeInNavigator: true})
}

function init() {
    SESSIONID += "#";
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

    let dynamic_function_ref = utils.dynamic_function_ref;
    let as_key_handler = utils.as_key_handler;

    let liveAltTab = dynamic_function_ref('liveAltTab', LiveAltTab);
    let previewNavigate = dynamic_function_ref("preview_navigate", Navigator);

    registerPaperAction('live-alt-tab',
                          liveAltTab);
    registerPaperAction('live-alt-tab-backward',
                          liveAltTab,
                          Meta.KeyBindingFlags.IS_REVERSED);

    registerPaperAction('previous-workspace', previewNavigate);
    registerPaperAction('previous-workspace-backward', previewNavigate);

    registerPaperAction('move-previous-workspace', previewNavigate);
    registerPaperAction('move-previous-workspace-backward', previewNavigate);

    registerPaperAction("switch-next", previewNavigate);
    registerPaperAction("switch-previous", previewNavigate);

    registerPaperAction("switch-first", Tiling.activateFirstWindow);
    registerPaperAction("switch-last", Tiling.activateLastWindow);

    registerPaperAction("switch-right", previewNavigate);
    registerPaperAction("switch-left", previewNavigate);
    registerPaperAction("switch-up", previewNavigate);
    registerPaperAction("switch-down", previewNavigate);

    registerPaperAction("move-left", previewNavigate);
    registerPaperAction("move-right", previewNavigate);
    registerPaperAction("move-up", previewNavigate);
    registerPaperAction("move-down", previewNavigate);

    registerPaperAction("toggle-scratch-layer",
                        dynamic_function_ref("toggleScratch",
                                             Scratch));

    registerPaperAction("toggle-scratch",
                        utils.as_key_handler("toggle",
                                             Scratch),
                        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction("develop-set-globals",
                        dynamic_function_ref("setDevGlobals",
                                             utils));

    registerPaperAction("cycle-width",
                        as_key_handler("cycleWindowWidth",
                                       Tiling),
                        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction("center-horizontally",
                        as_key_handler("centerWindowHorizontally",
                                       Tiling),
                        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction("tile-visible",
                        as_key_handler("tileVisible",
                                       Tiling),
                        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction('new-window',
                        as_key_handler('newWindow',
                                       App),
                        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction('close-window',
                        as_key_handler(
                            (metaWindow) =>
                                metaWindow.delete(global.get_current_time())),
                        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction('slurp-in',
                        as_key_handler('slurp',
                                       Tiling),
                        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction('barf-out',
                        as_key_handler('barf',
                                       Tiling),
                        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction('toggle-maximize-width',
                        as_key_handler("toggleMaximizeHorizontally",
                                       Tiling),
                        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction('paper-toggle-fullscreen',
                        as_key_handler(
                            (metaWindow) => {
                                if (metaWindow.fullscreen)
                                    metaWindow.unmake_fullscreen();
                                else
                                    metaWindow.make_fullscreen();
                            }), Meta.KeyBindingFlags.PER_WINDOW);

    initUserConfig();
}

function setKeybinding(name, func) {
    Main.wm.setCustomKeybindingHandler(name, Shell.ActionMode.NORMAL, func);
}

function enable() {
    let settings = new Gio.Settings({ schema_id: "org.gnome.desktop.wm.keybindings"});

    setKeybinding('switch-applications', // <Super>Tab
                  Keybindings.byMutterName('live-alt-tab').handler);
    setKeybinding('switch-applications-backward',
                  Keybindings.byMutterName('live-alt-tab-backward').handler);

    setKeybinding('switch-group', // <Super>Above_tab
                  Keybindings.byMutterName('previous-workspace').handler);
    setKeybinding('switch-group-backward',
                  Keybindings.byMutterName('previous-workspace-backward').handler);
    setKeybinding('switch-to-workspace-down', // <Super>Page_Down
                  Keybindings.byMutterName('previous-workspace').handler);

    setKeybinding('switch-to-workspace-up', // <Super>Page_Up
                  Keybindings.byMutterName('previous-workspace-backward').handler);

    setKeybinding('maximize', // <Super>Up
                  Keybindings.byMutterName('switch-up').handler);
    setKeybinding('unmaximize', // <Super>Down
                  Keybindings.byMutterName('switch-down').handler);

    setKeybinding('focus-active-notification', // `<Super>N`
                  Keybindings.byMutterName('new-window').handler);

    setKeybinding('restore-shortcuts', // `<Super>Escape`
                  Keybindings.byMutterName('toggle-scratch-layer').handler);

    setKeybinding('toggle-tiled-right', // <Super>Right
                  Keybindings.byMutterName('switch-right').handler);

    setKeybinding('toggle-tiled-left', // <Super>Left
                  Keybindings.byMutterName('switch-left').handler);


    setKeybinding('switch-to-workspace-1', // <Super>Home
                  Keybindings.byMutterName('switch-first').handler);
    setKeybinding('switch-to-workspace-last', // <Super>End
                  Keybindings.byMutterName('switch-last').handler);

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

    if (!enabled)
        return;
    log(`disable ${SESSIONID}`);

    modules.forEach(m => m.disable && m.disable());

    enabled = false;
}


function getConfigDir() {
    return Gio.file_new_for_path(GLib.getenv('HOME') + '/.config/paperwm');
}

function hasUserConfigFile() {
    return getConfigDir().get_child("user.js").query_exists(null);
}

function installConfig() {
    try {
        utils.debug("#rc", "Installing config");
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

        const settings = convenience.getSettings();
        settings.set_boolean("has-installed-config-template", true);

    } catch(e) {
        errorNotification("PaperWM", "Failed to install user config", e.stack);
        utils.debug("#rc", "Install failed", e.message);
    }
}

function errorWrappedModule(module) {
    function safeCall(method) {
        try {
            utils.debug("#rc", `calling ${method}`);
            module[method].call(module);
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
    imports.misc.util.spawn(["sh", "-c", `echo -En ${quoted} | gedit --new-window -`]);
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
