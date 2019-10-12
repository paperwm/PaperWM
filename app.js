/*
  Application functionality, like global new window actions etc.
 */

var Extension;
if (imports.misc.extensionUtils.extensions) {
    Extension = imports.misc.extensionUtils.extensions["paperwm@hedning:matrix.org"];
} else {
    Extension = imports.ui.main.extensionManager.lookup("paperwm@hedning:matrix.org");
}

var GLib = imports.gi.GLib
var Gio = imports.gi.Gio;
var Tiling = Extension.imports.tiling

var Shell = imports.gi.Shell;
var Tracker = Shell.WindowTracker.get_default();

var CouldNotLaunch = Symbol();

function launchFromWorkspaceDir(app, workspace) {
    let space = Tiling.spaces.get(workspace);
    let dir = space.settings.get_string("directory");
    let cmd = app.app_info.get_commandline();
    if (!cmd || dir == '') {
        throw CouldNotLaunch;
    }

    if (dir[0] == "~") {
        dir = GLib.getenv("HOME") + dir.slice(1);
    }

    // TODO: substitute correct values according to https://specifications.freedesktop.org/desktop-entry-spec/desktop-entry-spec-latest.html#exec-variables
    cmd = cmd.replace(/%./g, "");
    let [success, cmdArgs] = GLib.shell_parse_argv(cmd);
    if (!success) {
        print("launchFromWorkspaceDir:", "Could not parse command line", cmd);
        throw CouldNotLaunch;
    }
    GLib.spawn_async(dir, cmdArgs, GLib.get_environ(), GLib.SpawnFlags.SEARCH_PATH, null);
}

function newGnomeTerminal(metaWindow, app) {
    /* Note: this action activation is _not_ bound to the window - instead it
       relies on the window being active when called.

       If the new window doesn't start in the same directory it's probably
       because 'vte.sh' haven't been sourced by the shell in this terminal */
    app.action_group.activate_action(
        "win.new-terminal", new imports.gi.GLib.Variant("(ss)", ["window", "current"]));
}

function defaultHandler(metaWindow, app) {
    if (!app.can_open_new_window()) {
        return false;
    }

    let workspaceId = metaWindow.get_workspace().workspace_index;
    app.open_new_window(workspaceId);
    return true;
}

function startFromWorkspaceDirHandler(metaWindow, app) {
    return launchFromWorkspaceDir(app, metaWindow.get_workspace());
}

// Lookup table for custom handlers, keys being the app id
var customHandlers = { 'org.gnome.Terminal.desktop': newGnomeTerminal };

function newWindow(metaWindow) {
    metaWindow = metaWindow || global.display.focus_window;
    let app = Tracker.get_window_app(metaWindow);
    let handler = customHandlers[app.get_id()];
    if (handler)
        handler(metaWindow, app);
    else
        defaultHandler(metaWindow, app);
}
