const Extension = imports.misc.extensionUtils.extensions['paperwm@hedning:matrix.org']
const Meta = imports.gi.Meta;
const utils = Extension.imports.utils;
const debug = utils.debug;
let float;

function makeScratch(metaWindow) {
    metaWindow[float] = true;
    metaWindow.make_above();
    metaWindow.stick();
}

function unmakeScratch(metaWindow) {
    metaWindow[float] = false;
    metaWindow.unmake_above();
    metaWindow.unstick();
}

function toggle(metaWindow) {
    if (isScratchWindow(metaWindow)) {
        unmakeScratch(metaWindow);
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
    let windows = getScratchWindows();
    let isSomeShown = isScratchActive();

    if (isSomeShown) {
        windows.map(function(meta_window) {
            meta_window.minimize();
            meta_window.unmake_above();
        })
    } else {
        windows.reverse();
        windows.map(function(meta_window) {
            meta_window.unminimize();
            meta_window.make_above();
        })
        windows[windows.length-1].activate(global.get_current_time());
    }
}

// Monkey patch the alt-space menu
const Lang = imports.lang;
const PopupMenu = imports.ui.popupMenu;
const WindowMenu = imports.ui.windowMenu;
const originalBuildMenu = WindowMenu.WindowMenu.prototype._buildMenu;

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
