var Extension = imports.misc.extensionUtils.extensions['paperwm@hedning:matrix.org'];
var convenience = Extension.imports.convenience;

// polyfill workspace_manager that was introduced in 3.30
if (!global.workspace_manager) {
    global.workspace_manager = global.screen;
}

var modules = [
    Extension.imports.tiling, Extension.imports.scratch,
    Extension.imports.liveAltTab, Extension.imports.utils,
    Extension.imports.stackoverlay, Extension.imports.app,
    Extension.imports.kludges, Extension.imports.topbar,
    Extension.imports.navigator, Extension.imports.settings,
    Extension.imports.keybindings, Extension.imports.gestures
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

function registerNavigatorAction(name, handler) {
    let settings = convenience.getSettings('org.gnome.Shell.Extensions.PaperWM.Keybindings');
    Keybindings.registerAction(
        name,
        handler,
        {settings: settings, opensNavigator: true})
}

function registerMinimapAction(name, handler) {
    let settings = convenience.getSettings('org.gnome.Shell.Extensions.PaperWM.Keybindings');
    Keybindings.registerAction(
        name,
        handler,
        {settings: settings, opensNavigator: true, opensMinimap: true});
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

    paperSettings = convenience.getSettings();

    let dynamic_function_ref = utils.dynamic_function_ref;

    let liveAltTab = dynamic_function_ref('liveAltTab', LiveAltTab);
    let previewNavigate = dynamic_function_ref("preview_navigate", Navigator);

    registerPaperAction('live-alt-tab',
                          liveAltTab);
    registerPaperAction('live-alt-tab-backward',
                          liveAltTab,
                          Meta.KeyBindingFlags.IS_REVERSED);

    registerNavigatorAction('previous-workspace', Tiling.selectPreviousSpace);
    registerNavigatorAction('previous-workspace-backward',
                            Tiling.selectPreviousSpaceBackwards);

    registerNavigatorAction('move-previous-workspace', Tiling.movePreviousSpace);
    registerNavigatorAction('move-previous-workspace-backward',
                            Tiling.movePreviousSpaceBackwards);

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

    registerPaperAction("toggle-scratch-layer",
                        dynamic_function_ref("toggleScratch",
                                             Scratch));

    registerPaperAction("toggle-scratch",
                        dynamic_function_ref("toggle",
                                             Scratch),
                        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction("develop-set-globals",
                        dynamic_function_ref("setDevGlobals",
                                             utils));

    registerPaperAction("cycle-width",
                        dynamic_function_ref("cycleWindowWidth",
                                       Tiling),
                        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction("center-horizontally",
                        dynamic_function_ref("centerWindowHorizontally",
                                       Tiling),
                        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction("tile-visible",
                        dynamic_function_ref("tileVisible",
                                       Tiling),
                        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction('new-window',
                        dynamic_function_ref('newWindow',
                                       App),
                        Meta.KeyBindingFlags.PER_WINDOW);

    registerPaperAction('close-window',
                        (metaWindow) =>
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
                            (metaWindow) => {
                                if (metaWindow.fullscreen)
                                    metaWindow.unmake_fullscreen();
                                else
                                    metaWindow.make_fullscreen();
                            }, Meta.KeyBindingFlags.PER_WINDOW);

    initUserConfig();
}

function enable() {
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
