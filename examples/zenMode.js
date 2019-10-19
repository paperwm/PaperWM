var Extension;
if (imports.misc.extensionUtils.extensions) {
    Extension = imports.misc.extensionUtils.extensions["paperwm@hedning:matrix.org"];
} else {
    Extension = imports.ui.main.extensionManager.lookup("paperwm@hedning:matrix.org");
}

var Me = Extension.imports.examples.zenMode;

var Meta = imports.gi.Meta;
var Clutter = imports.gi.Clutter;
var St = imports.gi.St;
var Tweener = imports.ui.tweener;
var Main = imports.ui.main;
var Gdk = imports.gi.Gdk;
var Gtk = imports.gi.Gtk;
var Shell = imports.gi.Shell;
var GLib = imports.gi.GLib;
var Gio = imports.gi.Gio;

var Tiling = Extension.imports.tiling;
var Utils = Extension.imports.utils;

var signals = new Utils.Signals()

/*
  Poor mans zen mode
  - Fade the other windows out instead of "pushing them out of the way"
  - Select a random background image (independent of workspace) and fade this in
  - Make the clones semi-transparent to reveal state when navigating
  - No handling of focus change atm. (stay in zen-mode? exit zen mode? disable navigation altogether?)
*/


function selectRandomBackground(dir) {
    // Cache list? (and refresh in background on each invocation)
    dir = "/home/ole/adhoc/wallpapers"
    let dirPath = Gio.File.new_for_path(dir)
    let files = dirPath.enumerate_children("standard::name", Gio.FileQueryInfoFlags.NONE, null)
    let backgroundPaths = [];
    let backgroundPath = null;
    while (backgroundPath = files.next_file(null)) {
        backgroundPaths.push(
            dirPath.get_child(backgroundPath.get_name())
        );
    }
    return backgroundPaths[Math.floor(Math.random() * backgroundPaths.length)];
}

function crossFade(a, b, time=1, callback=null) {
    // a and b should be siblings
    let p = a.get_parent().get_children();
    // print(a.opacity, b.opacity, p.indexOf(a), p.indexOf(b))
    b.opacity = 255;
    Tweener.addTween(a, {
        opacity: 0, time: time, transition: 'linear',
        onComplete: () => {
            a.lower_bottom()
            callback && callback()
        }
    })
    // Tweener.addTween(b, { opacity: 255, time: time, onComplete: () => a.lower_bottom() })
}

function toggleZen(metaWindow) {
    let set = !metaWindow._zen;

    let space = Tiling.spaces.spaceOfWindow(metaWindow);

    let f = metaWindow.get_frame_rect()
    let workArea = Main.layoutManager.getWorkAreaForMonitor(space.monitor.index);
    // FIXME: use targetX to determine if the window is centered
    let isCentered = Math.abs((f.x + f.width/2) - (workArea.x + workArea.width/2)) < 5
    if (!isCentered && set) {
        Tiling.centerWindowHorizontally(metaWindow)
        return
    }

    let targetOpacity = set ? 0 : 255
    let navigateOpacity = set ? 80 : 255
    let selectedOpacity = 180
    // let windowFadeTime = 0.5
    // let crossFadeTime = 1
    let windowFadeTime = 0.4
    let crossFadeTime = 0.2

    if (set) {
        space._zenWindow = metaWindow;

        let prevSelect = null;
        signals.connect(space, 'select', () => {
            // Too abrupt transition
            if (prevSelect && prevSelect !== metaWindow) {
                prevSelect.clone.opacity = navigateOpacity
            }
            if (space.selectedWindow !== metaWindow) {
                space.selectedWindow.clone.opacity = selectedOpacity
            }
            prevSelect = space.selectedWindow
        })
    } else {
        space._zenWindow = null
        signals.disconnect(space);
    }

    metaWindow._zen = !metaWindow._zen

    const BackgroundStyle = imports.gi.GDesktopEnums.BackgroundStyle;
    let style = BackgroundStyle.CENTERED;

    if (!space.zenBackground) {
        /// One-time init
        // Could also simply use the gnome-shell background - ie. make the space background transparent
        // But that would look funny in the space stack navigation(?)
        // And a fresh workspace sparks the creativity! ^^
        let meta_display = global.screen ? 
            { meta_screen: global.screen } :
            { meta_display: global.display };
        let metaBackground = new Meta.Background(meta_display);

        let zenBackground = new Meta.BackgroundActor(
            Object.assign({
                monitor: 0, background: metaBackground,
                reactive: true // Disable the background menu
            }, meta_display)
        );
        space.background.get_parent().add_actor(zenBackground)
        space.zenBackground = zenBackground
        zenBackground.lower_bottom()

        let background = selectRandomBackground();
        space.zenBackground.background.set_file(background, style);
    }

    let completed = false;
    function onComplete() {
        if (completed)
            return;

        if (set) {
            crossFade(space.background, space.zenBackground, crossFadeTime)
        } else {
            crossFade(space.zenBackground, space.background, crossFadeTime, () => {
                Meta.later_add(Meta.LaterType.IDLE, () => {
                    // Some images seems to cause laggy animation (large images - load and scale probably)
                    // Change background proactively to avoid this problem 
                    print("Changing zen background")
                    let background = selectRandomBackground();
                    // Some images seems to cause laggy animation. (too slow loading? yeah, combined with rescale time)
                    space.zenBackground.background.set_file(background, style);
                })
            })
        }
        completed = true;
    }
    onComplete()

    let onlyWindow = true;
    for (let col of space) {
        for (let mw of col) {
            if (mw !== metaWindow) {
                onlyWindow = false;
                let actor = mw.get_compositor_private()
                let options = {
                    opacity: targetOpacity,
                    time: windowFadeTime,
                    transition: 'linear',
                    onComplete: onComplete,
                }
                Tweener.addTween(actor, options)
                Tweener.addTween(mw.clone, {opacity: set ? 70 : 255, time: windowFadeTime, transition: 'linear', onComplete: onComplete})
            }
        }
    }
    if (onlyWindow) {
        onComplete()
    }
}

function activate() {
    Extension.imports.keybindings.bindkey(
        "<Super>l", "toggle-zen-mode", Utils.dynamic_function_ref(toggleZen.name, Me),
        { activeInNavigator: true }
    );
}
