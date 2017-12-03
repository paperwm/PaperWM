const Extension = imports.misc.extensionUtils.extensions['paperwm@hedning:matrix.org']
const Meta = imports.gi.Meta;
const utils = Extension.imports.utils;
const debug = utils.debug;

function isScratchWindow(metaWindow) {
    return metaWindow.is_on_all_workspaces();
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
        windows.map(function(meta_window) {
            meta_window.unminimize();
            meta_window.make_above();
        })
        windows[0].activate(global.get_current_time())
    }
}
