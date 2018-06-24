var Extension = imports.misc.extensionUtils.extensions['paperwm@hedning:matrix.org'];
var Meta = imports.gi.Meta;
var Main = imports.ui.main;

var TopBar = Extension.imports.topbar;
var utils = Extension.imports.utils;
var debug = utils.debug;
var float;


function focusMonitor() {
    return Main.layoutManager.monitors[global.display.focus_window.get_monitor()]
}

function makeScratch(metaWindow) {
    metaWindow[float] = true;
    metaWindow.make_above();
    metaWindow.stick();
    metaWindow.clone.hide();
    metaWindow.get_compositor_private().show();

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

function show() {
    let windows = getScratchWindows();
    if (windows.length === 0) {
        return;
    }

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
