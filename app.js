/*
  Application functionality, like global new window actions etc.
 */

const Shell = imports.gi.Shell;
const Tracker = Shell.WindowTracker.get_default();

function newWindow(metaWindow) {
    metaWindow = metaWindow || global.display.focus_window;
    let app = Tracker.get_window_app(metaWindow);
    if (app.can_open_new_window()) {
        let workspaceId = metaWindow.get_workspace().workspace_index;
        app.open_new_window(workspaceId);
    }

}


