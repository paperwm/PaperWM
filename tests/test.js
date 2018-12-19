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

function visible(metaWindow) {
    let actor = metaWindow.get_compositor_private();
    let clone = metaWindow.clone;
    return actor.visible && !clone.visible;
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
    function insertWindow() {
        let signals = new Utils.Signals();
        let windows = 0;
        let space = Tiling.spaces.selectedSpace;
        signals.connect(space, 'window-added', (space, metaWindow) => {
            log(`length: ${space.length}`);
            let first = space[0][0];
            if (space.length === 3) {
                let third = space[2][0];
                connectOnce(third, 'focus', () => {
                    connectOnce(first, 'focus', () => {
                        connectOnce(space, 'move-done', () => {
                            Misc.util.spawnApp(['xterm']);
                        });
                    });
                    Main.activateWindow(first);
                });
            }
            if (space.length < 4)
                return;
            assert(visible(first),
                   `first window not immediately visible`);
            assert(!visible(metaWindow), `insert animation broken`);

            space.getWindows().forEach(w => {
                w.delete(global.get_current_time());
            });
            signals.destroy();
            next();
        });
        Misc.util.spawnApp(['xterm']);
        Misc.util.spawnApp(['xterm']);
        Misc.util.spawnApp(['xterm']);
    },
    function fullscreenReactive() {
        openTiledWindow(['tilix'], (space, metaWindow) => {
            assert(metaWindow === space.selectedWindow, `first window isn't selected`);
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
    function visibleDialog() {
        let nav = Navigator.getNavigator();
        var Shell = imports.gi.Shell;
        var Tracker = Shell.WindowTracker.get_default();
        openTiledWindow(['tilix'], (space, metaWindow) => {
            connectOnce(display, 'window-created', (display, about) => {
                let actor = about.get_compositor_private();
                connectOnce(actor, 'show', (actor) => {
                    assert(actor.visible && !about.clone.visible, `dialog isn't visible`);
                    about.delete(global.get_current_time());
                    metaWindow.delete(global.get_current_time());
                    nav.finish();
                    next();
                });
            });
            let app = Tracker.get_window_app(metaWindow);
            app.action_group.activate_action('app.about', null);
        });
    },
    function selectSpace() {
        let spaces = Tiling.spaces;
        let oldSpace = spaces.selectedSpace;
        spaces.selectSpace(Meta.MotionDirection.DOWN);
        let space = spaces.selectedSpace;
        assert(space !== oldSpace, `select space din't change space`);
        connectOnce(space, 'move-done', () => {
            let visible = new Map();
            for (let [monitor, space] of spaces.monitors) {
                visible.set(space, true);
            }
            spaces.forEach(s => {
                if (!visible.get(s))
                    assert(!s.actor.visible, `hidden space is visible`);
            });
            next();
        });
        Navigator.getNavigator().finish();
    },
];
