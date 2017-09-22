const Meta = imports.gi.Meta;

toggleScratch = function() {
    let workspace = global.screen.get_active_workspace()
    let windows = global.display.get_tab_list(Meta.TabList.NORMAL, workspace)
        .filter(function(meta_window) {
            return meta_window.is_on_all_workspaces();
        });

    let isSomeShown = windows.reduce(function(shown, meta_window) {
        return shown || !meta_window.minimized;
    }, false)

    if (isSomeShown) {
        windows.map(function(meta_window) {
            meta_window.minimize();
        })
    } else {
        windows.map(function(meta_window) {
            meta_window.unminimize();
            meta_window.make_above();
        })
        windows[0].activate(global.get_current_time())
    }
}
