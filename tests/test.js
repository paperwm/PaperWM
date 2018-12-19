var uuid = "paperwm@hedning:matrix.org";
var Extension = imports.misc.extensionUtils.extensions[uuid];
var Tiling = Extension.imports.tiling;
var Navigator = Extension.imports.navigator;
var Utils = Extension.imports.utils;

var GLib = imports.gi.GLib;
var Signals = imports.signals;
var Gio = imports.gi.Gio;
var Main = imports.ui.main;
var Meta = imports.gi.Meta;
var Misc = imports.misc;
var St = imports.gi.St;

var display = global.display;

var ExtensionSystem = imports.ui.extensionSystem;

var settings = Extension.imports.convenience.getSettings();

var gsettings = new Gio.Settings({schema_id: 'org.gnome.shell'});
var wmsettings = new Gio.Settings({schema_id: 'org.gnome.desktop.wm.preferences'});
var overrides = new Gio.Settings({schema_id: 'org.gnome.shell.overrides'});

function enable () {
    Main.layoutManager.connect('startup-complete', () => {
        next();
    });
}

function connectOnce(obj, signal, callback) {
    let id = obj.connect(signal, function () {
        obj.disconnect(id);
        callback.apply(window, arguments);
    });
}


/**
   Run @prog and run callback on space::window-added
 */
function openTiledWindow(prog, callback) {
    connectOnce(display, 'window-created', (display, metaWindow) => {
        let space = Tiling.spaces.spaceOfWindow(metaWindow);
        connectOnce(space, 'window-added', callback);
    });
    Misc.util.spawnApp(prog);
}

function assert(condition, message, ...dump) {
    if (!condition) {
        throw new Error(message + "\n", dump);
    }
}

var currentTest = 0;
function next() {
    if (currentTest < tests.length) {
        let test = tests[currentTest];
        log(`-- Testing ${test.name}`);
        test();
    }
    currentTest += 1;
}

var tests = [
    function fullscreenReactive() {
        openTiledWindow(['tilix'], (space, metaWindow) => {
            let id = metaWindow.connect('notify::fullscreen', (metaWindow) => {
                if (!metaWindow.fullscreen)
                    return;
                metaWindow.disconnect(id);
                connectOnce(space, 'move-done', () => {
                    let actor = metaWindow.get_compositor_private();
                    assert(actor.visible, `Fullscreen window isn't reactive`);
                    assert(!metaWindow.clone.visible, `clone is visible`);
                    metaWindow.delete(global.get_current_time());
                    next();
                });
            });
            metaWindow.make_fullscreen();
        });
    },
    function removeWindow() {
        openTiledWindow(['tilix'], (space, metaWindow) => {
            connectOnce(space, 'window-removed', (space, metaWindow) => {
                connectOnce(space, 'move-done', () => {
                    assert(space.indexOf(metaWindow) === -1, `window wasn't removed`);
                    assert(metaWindow.get_compositor_private().visible, `actor isn't visible`);
                    metaWindow.delete(global.get_current_time());
                    next();
                });
            });
            space.removeWindow(metaWindow);
        });
    },
    function reload() {
        openTiledWindow(['tilix'], (space, metaWindow) => {
            ExtensionSystem.reloadExtension(Extension);
            Extension = imports.misc.extensionUtils.extensions[uuid];
            assert(Extension.state === ExtensionSystem.ExtensionState.ENABLED,
                   `extension didn't reload`);
            // We've build a new space
            assert(Tiling.spaces.selectedSpace !== space, `didn't get a new space`);
            space = Tiling.spaces.selectedSpace;
            assert(space.selectedWindow === metaWindow, `tiled window didn't reattach`);
            metaWindow.delete(global.get_current_time());
            next();
        });
    },
];
