var ExtensionUtils = imports.misc.extensionUtils;
var Extension = ExtensionUtils.getCurrentExtension();
var {St} = imports.gi;
var Util = imports.misc.util;
var MessageTray = imports.ui.messageTray;

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
    'settings', 'tiling', 'navigator', 'keybindings', 'scratch', 'liveAltTab', 'utils',
    'stackoverlay', 'app', 'kludges', 'topbar', 'gestures',
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
        let module = Extension.imports[name];
        if (module && module[method]) {
            log("#paperwm", `${method} ${name}`);
        }
        module && module[method] && module[method].call(module, errorNotification);
        return true;
    } catch(e) {
        log("#paperwm", `${name} failed ${method}`);
        log(`JS ERROR: ${e}\n${e.stack}`);
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
var enabled = false;
let lastDisabledTime = 0; // init (epoch ms)

/**
 * Runs once on extension init().
 * Not run on PaperWM modules, but if a user has a `user.js` module defined
 * in `~/.config/paperwm/` then this will run it's `user.js` init().
 */
function init() {
    initUserConfig();
    run('init');
}

function enable() {
    log(`#paperwm enable ${SESSIONID}`);
    if (enabled) {
        log('enable called without calling disable');
        return;
    }

    SESSIONID += "#";
    Extension = imports.misc.extensionUtils.getCurrentExtension();
    warnAboutGnomeShellVersionCompatibility();

    enableUserStylesheet();
    updateUserConfigMetadata();

    if (run('enable')) {
        enabled = true;
    }
}

function disable() {
    log(`#paperwm disable ${SESSIONID}`);
    /**
     * The below acts as a guard against multiple disable -> enable -> disable
     * calls that can caused by gnome during unlocking.  This rapid enable/disable
     * cycle can cause mutter (and other) issues since paperwm hasn't had sufficient 
     * time to destroy/clean-up signals, actors, etc. before the next enable/disable 
     * cycle begins.  The below guard forces at least 500 milliseconds before a 
     * subsequent disable can be called.
     */
    if (Math.abs(Date.now() - lastDisabledTime) <= 500) {
        log('disable has just been called');
        return;
    }
    if (!enabled) {
        log('disable called without calling enable');
        return;
    }

    if (run('disable')) {
        enabled = false;
        lastDisabledTime = Date.now();
    }

    disableUserStylesheet();
    Extension = null;
}

var Gio = imports.gi.Gio;
var GLib = imports.gi.GLib;
var Main = imports.ui.main;
var Config = imports.misc.config;

// Checks gnome shell version compatibility and warns the user when running on
// and unsupported version.
function warnAboutGnomeShellVersionCompatibility() {
    const gnomeShellVersion = Config.PACKAGE_VERSION;
    const supportedVersions = Extension.metadata["shell-version"];
    for (const version of supportedVersions) {
        if (gnomeShellVersion.startsWith(version)) {
            return;
        }
    }

    // did not find a supported version
    log("#paperwm", `WARNING: Running on unsupported version of gnome shell (${gnomeShellVersion})`);
    log("#paperwm", `Supported versions: ${supportedVersions}`);
    const msg = `Running on unsupported version of gnome shell (${gnomeShellVersion}).
Supported versions: ${supportedVersions}.
Click for more information.`;

    const notification = notify("PaperWM Warning", msg);
    notification.connect('activated', () => {
        Util.spawn(["xdg-open", "https://github.com/paperwm/PaperWM/wiki/Warning:-Running-on-unsupported-version-of-gnome-shell"]);
        notification.destroy();
    });
}

function getConfigDir() {
    return Gio.file_new_for_path(GLib.get_user_config_dir() + '/paperwm');
}

function configDirExists() {
    return getConfigDir().query_exists(null);
}

function hasUserConfigFile() {
    return getConfigDir().get_child("user.js").query_exists(null);
}

/**
 * Update the metadata.json in user config dir to always keep it up to date.
 * We copy metadata.json to the config directory so gnome-shell-mode
 * knows which extension the files belong to (ideally we'd symlink, but
 * that trips up the importer: Extension.imports.<complete> in
 * gnome-shell-mode crashes gnome-shell..)
 */
function updateUserConfigMetadata() {
    if (!configDirExists()) {
        return;
    }

    try {
        const configDir = getConfigDir();
        const metadata = Extension.dir.get_child("metadata.json");
        metadata.copy(configDir.get_child("metadata.json"), Gio.FileCopyFlags.OVERWRITE, null, null);
    } catch (error) {
        log('PaperWM', `could not update user config metadata.json: ${error}`);
    }
}

function installConfig() {
    const configDir = getConfigDir();
    // if user config folder doesn't exist, create it
    if (!configDirExists()) {
        configDir.make_directory_with_parents(null);
    }

    updateUserConfigMetadata();

    // Copy the user.js template to the config directory
    const user = Extension.dir.get_child("config/user.js");
    user.copy(configDir.get_child("user.js"), Gio.FileCopyFlags.NONE, null, null);
}

function initUserConfig() {
    if (!configDirExists()) {
        try {
            installConfig();

            const configDir = getConfigDir().get_path();
            const notification = notify("PaperWM", `Installed user configuration in ${configDir}`);
            notification.connect('activated', () => {
                Util.spawn(["nautilus", configDir]);
                notification.destroy();
            });
        } catch (e) {
            errorNotification("PaperWM", `Failed to install user config: ${e.message}`, e.stack);
            log("PaperWM", "User config install failed", e.message);
        }
    }

    if (hasUserConfigFile()) {
        Extension.imports.searchPath.push(getConfigDir().get_path());
    }
}

/**
 * Reloads user.css styles (if user.css present in ~/.config/paperwm).
 */
var userStylesheet;
function enableUserStylesheet() {
    userStylesheet = getConfigDir().get_child("user.css");
    if (userStylesheet.query_exists(null)) {
        let themeContext = St.ThemeContext.get_for_stage(global.stage);
        themeContext.get_theme().load_stylesheet(userStylesheet);
    }
}

/**
 * Unloads user.css styles (if user.css present in ~/.config/paperwm).
 */
function disableUserStylesheet() {
    let themeContext = St.ThemeContext.get_for_stage(global.stage);
    themeContext.get_theme().unload_stylesheet(userStylesheet);
    userStylesheet = null;
}

/**
 * Our own version of imports.ui.main.notify allowing more control over the
 * notification
 */
function notify(msg, details, params) {
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
    Util.spawn(["sh", "-c", `echo -En ${quoted} | gedit --new-window -`]);
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
