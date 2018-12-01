var Extension = imports.misc.extensionUtils.extensions['paperwm@hedning:matrix.org'];
var convenience = Extension.imports.convenience;
var utils = Extension.imports.utils;

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

var Gio = imports.gi.Gio;
var GLib = imports.gi.GLib;
var Main = imports.ui.main;

var SESSIONID = ""+(new Date().getTime());
/**
 * The extension sometimes go through multiple init -> enable -> disable
 * cycles. So we need to keep track of whether we're initialized..
 */
var initRun;
var enabled = false;

function run(method) {
    for (let module of modules) {
        // Bail if there's an error in our own modules
        if (!safeCall(module.__moduleName__, method))
            return false;
    }

    if (hasUserConfigFile()) {
        safeCall('user', method);
    }

    return true;
}

function safeCall(name, method) {
    try {
        utils.debug("#paperwm", `${method} ${name}`);
        let module = Extension.imports[name];
        module && module[method] && module[method].call(module);
        return true;
    } catch(e) {
        utils.debug("#paperwm", `${method} failed`, e.message);
        utils.print_stacktrace(e);
        errorNotification(
            "PaperWM",
            `Error occured in ${name} @${method}:\n\n${e.message}`,
            e.stack);
        return false;
    }
}

function init() {
    SESSIONID += "#";
    log(`#paperwm init: ${SESSIONID}`);

    if(initRun) {
        log(`#startup Reinitialized against our will! Skip adding bindings again to not cause trouble.`);
        return;
    }

    initUserConfig();

    if (run('init'))
        initRun = true;
}

function enable() {
    log(`#paerwm enable ${SESSIONID}`);
    if (enabled) {
        log('enable called without calling disable');
        return;
    }

    if (run('enable'))
    enabled = true;
}

function disable() {
    log(`#paerwm enable ${SESSIONID}`);
    if (!enabled) {
        log('disable called without calling enable');
        return;
    }

    if (run('disable'))
        enabled = false;
}


function getConfigDir() {
    return Gio.file_new_for_path(GLib.get_user_config_dir() + '/paperwm');
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
