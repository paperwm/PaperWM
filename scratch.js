var Extension = imports.misc.extensionUtils.extensions['paperwm@hedning:matrix.org'];
var Meta = imports.gi.Meta;
var Main = imports.ui.main;

var TopBar = Extension.imports.topbar;
var Tiling = Extension.imports.tiling;
var utils = Extension.imports.utils;
var debug = utils.debug;
var float;


function focusMonitor() {
    if (global.display.focus_window) {
        return Main.layoutManager.monitors[global.display.focus_window.get_monitor()]
    } else {
        return Main.layoutManager.primaryMonitor;
    }
}

function makeScratch(metaWindow) {
    metaWindow[float] = true;
    metaWindow.make_above();
    metaWindow.stick();

    if (!metaWindow.minimized)
        Tiling.showWindow(metaWindow);

    let monitor = focusMonitor();
    if (monitor.clickOverlay)
        monitor.clickOverlay.hide();
}

function unmakeScratch(metaWindow) {
    metaWindow[float] = false;
    metaWindow.unmake_above();
    metaWindow.unstick();
}

function toggle(metaWindow) {
    if (isScratchWindow(metaWindow)) {
        unmakeScratch(metaWindow);
        hide();
    } else {
        makeScratch(metaWindow);

        if (metaWindow.has_focus) {
            let space = Tiling.spaces.get(global.workspace_manager.get_active_workspace());
            space.setSelectionInactive();
        }
    }
}

function isScratchWindow(metaWindow) {
    return metaWindow && metaWindow[float];
}

/** Return scratch windows in MRU order */
function getScratchWindows() {
    return global.display.get_tab_list(Meta.TabList.NORMAL, null)
        .filter(isScratchWindow);
}

function isScratchActive() {
    return getScratchWindows().some(metaWindow => !metaWindow.minimized);
}

function toggleScratch() {
    if (isScratchActive())
        hide();
    else
        show();
}

function toggleScratchWindow() {
    if (isScratchActive())
        hide();
    else
        show(true);
}

function show(top) {
    let windows = getScratchWindows();
    if (windows.length === 0) {
        return;
    }
    if (top)
        windows = windows.slice(0,1);

    TopBar.show();

    windows.slice().reverse()
        .map(function(meta_window) {
            meta_window.unminimize();
            meta_window.make_above();
            meta_window.get_compositor_private().show();
    });
    windows[0].activate(global.get_current_time());

    let monitor = focusMonitor();
    if (monitor.clickOverlay)
        monitor.clickOverlay.hide();
}

function hide() {
    let windows = getScratchWindows();
    windows.map(function(meta_window) {
        meta_window.minimize();
    });
}

// Monkey patch the alt-space menu
var Lang = imports.lang;
var PopupMenu = imports.ui.popupMenu;
var WindowMenu = imports.ui.windowMenu;
var originalBuildMenu = WindowMenu.WindowMenu.prototype._buildMenu;

function init() {
    float = Symbol();
}

function enable() {
    WindowMenu.WindowMenu.prototype._buildMenu =
        function (window) {
            let item;
            item = this.addAction(_('Scratch'), () => {
                toggle(window);
            });
            if (isScratchWindow(window))
                item.setOrnament(PopupMenu.Ornament.CHECK);

            originalBuildMenu.call(this, window);
        };
}

function disable() {
    WindowMenu.WindowMenu.prototype._buildMenu = originalBuildMenu;
}
