/*
  Application functionality, like global new window actions etc.
 */

var Shell = imports.gi.Shell;
var Tracker = Shell.WindowTracker.get_default();

function newGnomeTerminal(metaWindow, app) {
    if (app.get_id() !== "org.gnome.Terminal.desktop") {
        return false;
    }

    /* Note: this action activation is _not_ bound to the window - instead it
       relies on the window being active when called. 

       If the new window doesn't start in the same directory it's probably
       because 'vte.sh' haven't been sourced by the shell in this terminal */
    app.action_group.activate_action(
        "win.new-terminal", new imports.gi.GLib.Variant("(ss)", ["window", "current"]));
    return true;
}

function defaultHandler(metaWindow, app) {
    if (!app.can_open_new_window()) {
        return false;
    }

    let workspaceId = metaWindow.get_workspace().workspace_index;
    app.open_new_window(workspaceId);
    return true;
}

// Handlers are called in turn until one returns true
var customHandlers = [newGnomeTerminal, defaultHandler];

function newWindow(metaWindow) {
    metaWindow = metaWindow || global.display.focus_window;
    let app = Tracker.get_window_app(metaWindow);
    for (let i = 0; i < customHandlers.length; i++) {
        if (customHandlers[i](metaWindow, app)) {
            break;
        }
    }
}
