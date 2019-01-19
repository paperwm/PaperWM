/*
  Application functionality, like global new window actions etc.
 */

var Shell = imports.gi.Shell;
var Tracker = Shell.WindowTracker.get_default();

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
