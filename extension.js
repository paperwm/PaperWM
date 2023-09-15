import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as Navigator from './navigator.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';

import { Extension, dir } from 'resource:///org/gnome/shell/extensions/extension.js';

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

     - Patches is used for monkey patching gnome shell behavior which simply
       doesn't fit paperwm.

     - topbar adds the workspace name to the topbar and styles it.

     - gestures is responsible for 3-finger swiping (only works in wayland).

     Notes of ordering:
        - several modules import settings, so settings should be before them;
          - settings.js should not depend on other paperwm modules;
 */
const modules = [
    'utils', 'settings',
    'gestures', 'keybindings', 'liveAltTab', 'navigator', 'stackoverlay', 'scratch',
    'workspace', 'tiling', 'topbar', // these have `enable` dependency order
    'patches', 'app', // these have `enable` dependency order
];

export default class PaperWM extends Extension {
    #firstEnable = true;
    #userStylesheet = null;

    /**
     Tell the modules to run enable or disable.
    */
    run(method, reverse = false) {
        // reverse order an array (useful for controlling execution order)
        let arr = reverse ? [...modules].reverse() : modules;
        for (let name of arr) {
        // Bail if there's an error in our own modules
            if (!this.safeCall(name, method)) {
                return false;
            }
        }

        /*
        // run 'user.js' methods (if it exists)
        if (this.hasUserConfigFile()) {
        // if enable method, call 'init' for backwards compat and then enable
            if (method === 'enable') {
                if (this.#firstEnable) {
                    this.safeCall('user', 'init');
                }
                this.safeCall('user', 'enable');
            }
            else {
                this.safeCall('user', method);
            }
        }
        */

        return true;
    }

    safeCall(name, method) {
        try {
            let module = Extension.imports[name];
            if (module && module[method]) {
                console.debug("#paperwm", `${method} ${name}`);
            }
            module && module[method] && module[method].call(module, errorNotification);
            return true;
        } catch (e) {
            console.error("#paperwm", `${name} failed ${method}`);
            console.error(`JS ERROR: ${e}\n${e.stack}`);
            this.errorNotification(
                "PaperWM",
                `Error occured in ${name} @${method}:\n\n${e.message}`,
                e.stack);
            return false;
        }
    }

    enable() {
        console.log(`#PaperWM enabled`);

        // 45 SearchPath doesn't exist in 45...
        // this.enableUserConfig();
        this.enableUserStylesheet();

        if (this.run('enable')) {
            this.#firstEnable = false;
        }
    }

    /**
 * Prepares PaperWM for disable across modules.
 */
    prepareForDisable() {
    /**
     * Finish any navigation (e.g. workspace switch view).
     * Can put PaperWM in a breakable state of lock/disable
     * while navigating.
     */
        Navigator.finishNavigation();
    }

    disable() {
        console.log('#PaperWM disabled');
        this.prepareForDisable();
        this.run('disable', true);

        this.disableUserStylesheet();
        this.safeCall('user', 'disable');
    }

    getConfigDir() {
        return Gio.file_new_for_path(`${GLib.get_user_config_dir()}/paperwm`);
    }

    configDirExists() {
        return this.getConfigDir().query_exists(null);
    }

    hasUserConfigFile() {
        return this.getConfigDir().get_child("user.js").query_exists(null);
    }

    /**
     * Update the metadata.json in user config dir to always keep it up to date.
     * We copy metadata.json to the config directory so gnome-shell-mode
     * knows which extension the files belong to (ideally we'd symlink, but
     * that trips up the importer: Extension.imports.<complete> in
     * gnome-shell-mode crashes gnome-shell..)
     */
    updateUserConfigMetadata() {
        if (!this.configDirExists()) {
            return;
        }

        try {
            const configDir = this.getConfigDir();
            const metadata = dir.get_child("metadata.json");
            metadata.copy(configDir.get_child("metadata.json"), Gio.FileCopyFlags.OVERWRITE, null, null);
        } catch (error) {
            console.error('PaperWM', `could not update user config metadata.json: ${error}`);
        }
    }

    /* TODO: figure out something here
    fmuellner:
    > you can't
    > as I said, it's part of gjs legacy imports
    > you'll have to do something like const userMod = await import(${this.getConfigDir()}/user.js)

    installConfig() {
        const configDir = this.getConfigDir();
        // if user config folder doesn't exist, create it
        if (!this.configDirExists()) {
            configDir.make_directory_with_parents(null);
        }

        // Copy the user.js template to the config directory
        const user = dir.get_child("config/user.js");
        user.copy(configDir.get_child("user.js"), Gio.FileCopyFlags.NONE, null, null);
    }
    */

    /*
    enableUserConfig() {
        if (!this.configDirExists()) {
            try {
                this.installConfig();

                const configDir = this.getConfigDir().get_path();
                const notification = this.notify("PaperWM", `Installed user configuration in ${configDir}`);
                notification.connect('activated', () => {
                    Util.spawn(["nautilus", configDir]);
                    notification.destroy();
                });
            } catch (e) {
                this.errorNotification("PaperWM", `Failed to install user config: ${e.message}`, e.stack);
                console.error("PaperWM", "User config install failed", e.message);
            }
        }

        this.updateUserConfigMetadata();

        // add to searchpath if user has config file and action user.js
        if (this.hasUserConfigFile()) {
            let SearchPath = Extension.imports.searchPath;
            let path = this.getConfigDir().get_path();
            if (!SearchPath.includes(path)) {
                SearchPath.push(path);
            }
        }
    }
    */

    /**
     * Reloads user.css styles (if user.css present in ~/.config/paperwm).
     */
    enableUserStylesheet() {
        this.#userStylesheet = this.getConfigDir().get_child("user.css");
        if (this.#userStylesheet.query_exists(null)) {
            let themeContext = St.ThemeContext.get_for_stage(global.stage);
            themeContext.get_theme().load_stylesheet(this.#userStylesheet);
        }
    }

    /**
     * Unloads user.css styles (if user.css present in ~/.config/paperwm).
     */
    disableUserStylesheet() {
        let themeContext = St.ThemeContext.get_for_stage(global.stage);
        themeContext.get_theme().unload_stylesheet(this.#userStylesheet);
        this.#userStylesheet = null;
    }

    /**
     * Our own version of imports.ui.main.notify allowing more control over the
     * notification
     */
    notify(msg, details, params) {
        let source = new MessageTray.SystemNotificationSource();
        // note-to-self: the source is automatically destroyed when all its
        // notifications are removed.
        Main.messageTray.add(source);
        let notification = new MessageTray.Notification(source, msg, details, params);
        notification.setResident(true); // Usually more annoying that the notification disappear than not
        source.showNotification(notification);
        return notification;
    }

    spawnPager(content) {
        const quoted = GLib.shell_quote(content);
        Util.spawn(["sh", "-c", `echo -En ${quoted} | gedit --new-window -`]);
    }

    /**
     * Show an notification opening a the full message in dedicated window upon
     * activation
     */
    errorNotification(title, message, fullMessage) {
        const notification = this.notify(title, message);
        notification.connect('activated', () => {
            this.spawnPager([title, message, "", fullMessage].join("\n"));
            notification.destroy();
        });
    }
}
