const ExtensionUtils = imports.misc.extensionUtils;
const Extension = ExtensionUtils.getCurrentExtension();
const Navigator = Extension.imports.navigator;
const { Gio, GLib, St } = imports.gi;
const Util = imports.misc.util;
const MessageTray = imports.ui.messageTray;
const Main = imports.ui.main;

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

     Notes of ordering:
        - several modules import settings, so settings should be before them;
          - settings.js shouldn't depend on other modules (e.g with `imports` at the top).
 */
const modules = [
    'settings', 'keybindings', 'gestures', 'navigator', 'workspace', 'tiling', 'scratch',
    'liveAltTab', 'stackoverlay', 'app', 'topbar', 'kludges',
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
    return true;
}

function safeCall(name, method) {
    try {
        let module = Extension.imports[name];
        if (module && module[method]) {
            console.debug("#paperwm", `${method} ${name}`);
        }
        module && module[method] && module[method].call(module, errorNotification);
        return true;
    } catch(e) {
        console.error("#paperwm", `${name} failed ${method}`);
        console.error(`JS ERROR: ${e}\n${e.stack}`);
        errorNotification(
            "PaperWM",
            `Error occured in ${name} @${method}:\n\n${e.message}`,
            e.stack);
        return false;
    }
}

let firstEnable = true;
function enable() {
    console.log(`#PaperWM enabled`);

    enableUserConfig();
    enableUserStylesheet();

    if (run('enable')) {
        firstEnable = false;
    }
}

/**
 * Prepares PaperWM for disable across modules.
 */
function prepareForDisable() {
    /**
     * Finish any navigation (e.g. workspace switch view).
     * Can put PaperWM in a breakable state of lock/disable
     * while navigating.
     */
    Navigator.finishNavigation();
}

function disable() {
    console.log('#PaperWM disabled');
    prepareForDisable();
    run('disable');

    disableUserStylesheet();
    safeCall('user', 'disable');
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
        console.error('PaperWM', `could not update user config metadata.json: ${error}`);
    }
}

function installConfig() {
    const configDir = getConfigDir();
    // if user config folder doesn't exist, create it
    if (!configDirExists()) {
        configDir.make_directory_with_parents(null);
    }

    // Copy the user.js template to the config directory
    const user = Extension.dir.get_child("config/user.js");
    user.copy(configDir.get_child("user.js"), Gio.FileCopyFlags.NONE, null, null);
}

function enableUserConfig() {
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
            console.error("PaperWM", "User config install failed", e.message);
        }
    }

    updateUserConfigMetadata();

    // add to searchpath if user has config file and action user.js
    if (hasUserConfigFile()) {
        let SearchPath = Extension.imports.searchPath;
        let path = getConfigDir().get_path();
        if (!SearchPath.includes(path)) {
            SearchPath.push(path);
        }

        // run user.js routines
        if (firstEnable) {
            safeCall('user', 'init');
        }

        safeCall('user', 'enable');
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
