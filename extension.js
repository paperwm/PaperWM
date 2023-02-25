const { St } = imports.gi;

// polyfill workspace_manager that was introduced in 3.30 (must happen before modules are imported)
if (!global.workspace_manager) {
    global.workspace_manager = global.screen;
}

/**
   The currently used modules
     - tiling is the main module, responsible for tiling and workspaces

     - navigator is used to initiate a discrete navigation.
       Focus is only switched when the navigation is done.

     - keybindings is a utility wrapper around mutters keybinding facilities.

     - scratch is used to manage floating windows, or scratch windows.

     - liveAltTab is a simple altTab implementiation with live previews.

     - stackoverlay is somewhat kludgy. It makes clicking on the left or right
       edge of the screen always activate the partially (or sometimes wholly)
       concealed window at the edges.

     - app creates new windows based on the current application. It's possible
       to create custom new window handlers.

     - kludges is used for monkey patching gnome shell behavior which simply
       doesn't fit paperwm.

     - topbar adds the workspace name to the topbar and styles it.

     - gestures is responsible for 3-finger swiping (only works in wayland).
 */
var modules = [
    'tiling', 'navigator', 'keybindings', 'scratch', 'liveAltTab', 'utils',
    'stackoverlay', 'app', 'kludges', 'topbar', 'settings','gestures'
];

/**
  Tell the modules to run init, enable or disable
 */
function run(method) {
    for (let name of modules) {
        // Bail if there's an error in our own modules
        if (!safeCall(name, method))
            return false;
    }

    if (hasUserConfigFile()) {
        safeCall('user', method);
    }

    return true;
}

function safeCall(name, method) {
    try {
        print("#paperwm", `${method} ${name}`);
        let module = Extension.imports[name];
        module && module[method] && module[method].call(module, errorNotification);
        return true;
    } catch(e) {
        print("#paperwm", `${name} failed ${method}`);
        print(`JS ERROR: ${e}\n${e.stack}`);
        errorNotification(
            "PaperWM",
            `Error occured in ${name} @${method}:\n\n${e.message}`,
            e.stack);
        return false;
    }
}

var SESSIONID = ""+(new Date().getTime());

/**
 * The extension sometimes go through multiple init -> enable -> disable
 * cycles. So we need to keep track of whether we're initialized..
 */
var initRun;
var enabled = false;

var Extension, convenience;
function init() {
    SESSIONID += "#";
    log(`#paperwm init: ${SESSIONID}`);

    // var Gio = imports.gi.Gio;
    // let extfile = Gio.file_new_for_path( Extension.imports.extension.__file__);
    Extension = imports.misc.extensionUtils.getCurrentExtension();
    convenience = Extension.imports.convenience;

    checkGnomeShellVersionCompatibility();

    if(initRun) {
        log(`#startup Reinitialized against our will! Skip adding bindings again to not cause trouble.`);
        return;
    }

    initUserConfig();

    if (run('init'))
        initRun = true;
}

function enable() {
    log(`#paperwm enable ${SESSIONID}`);
    if (enabled) {
        log('enable called without calling disable');
        return;
    }

    if (run('enable'))
        enabled = true;
}

function disable() {
    log(`#paperwm disable ${SESSIONID}`);
    if (!enabled) {
        log('disable called without calling enable');
        return;
    }

    if (run('disable'))
        enabled = false;
}


var Gio = imports.gi.Gio;
var GLib = imports.gi.GLib;
var Main = imports.ui.main;
var Config = imports.misc.config;

function checkGnomeShellVersionCompatibility() {
    const gnomeShellVersion = Config.PACKAGE_VERSION;
    const supportedVersions = Extension.metadata["shell-version"];
    for (const version of supportedVersions) {
        if (gnomeShellVersion.startsWith(version)) {
            return;
        }
    }

    // did not find a supported version
    print("#paperwm", `WARNING: Running on unsupported version of gnome shell (${gnomeShellVersion})`);
    print("#paperwm", `WARNING: Supported versions: ${supportedVersions}`);
    const msg = `Running on unsupported version of gnome shell (${gnomeShellVersion}).
Supported versions: ${supportedVersions}.
Please upgrade/downgrade your gnome shell to a supported version or upgrade/downgrade PaperWM.`;
    errorNotification("PaperWM warning", msg);
}

function getConfigDir() {
    return Gio.file_new_for_path(GLib.get_user_config_dir() + '/paperwm');
}

function hasUserConfigFile() {
    return getConfigDir().get_child("user.js").query_exists(null);
}

function installConfig() {
    print("#rc", "Installing config");
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
}

function initUserConfig() {
    const paperSettings = convenience.getSettings();

    if (!paperSettings.get_boolean("has-installed-config-template")
        && !hasUserConfigFile())
    {
        try {
            installConfig();

            const configDir = getConfigDir().get_path();
            const notification = notify("PaperWM", `Installed user configuration in ${configDir}`);
            notification.connect('activated', () => {
                imports.misc.util.spawn(["nautilus", configDir]);
                notification.destroy();
            });
        } catch(e) {
            errorNotification("PaperWM",
                              `Failed to install user config: ${e.message}`, e.stack);
            print("#rc", "Install failed", e.message);
        }

    }

    if (hasUserConfigFile()) {
        Extension.imports.searchPath.push(getConfigDir().get_path());
    }

    let userStylesheet = getConfigDir().get_child("user.css");
    if (userStylesheet.query_exists(null)) {
        let themeContext = St.ThemeContext.get_for_stage(global.stage);
        themeContext.get_theme().load_stylesheet(userStylesheet);
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
    source.showNotification(notification);
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
