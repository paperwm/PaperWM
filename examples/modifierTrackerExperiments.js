var Extension = imports.misc.extensionUtils.extensions['paperwm@hedning:matrix.org'];
var Utils = Extension.imports.utils;
var Me = Extension.imports.examples.modifierTrackerExperiments;
var ModifierTracker = Extension.imports.modifierTracker;

var Tiling = Extension.imports.tiling;
var Mainloop = imports.mainloop;
var Tweener = imports.ui.tweener;

var source = null;
var scale = 1;

function startZoom() {
    source = Mainloop.timeout_add(350, () => {
        log("Zoom!")
        let space = Tiling.spaces.spaceOfWindow(global.display.focus_window)
        const zoomed = space.actor;
        space.visible.forEach(w => {
            w.get_compositor_private().hide();
            w.clone.show();
        })
        zoomed.show()
        zoomed.set_pivot_point(0.5,0.5)
        // scale *= 0.99;
        scale = 0.8
        Tweener.addTween(zoomed, {
            transition: 'easeInOutQuad',
            scale_x: scale,
            scale_y: scale,
            time: 0.500
        })
        // zoomed.set_scale(scale, scale);
        // zoomed.set_pivot_point(space.selectedWindow.clone.x/zoomed.width, 0.5)
        // startZoom();

    })
}

function resetZoom() {
    let space = Tiling.spaces.spaceOfWindow(global.display.focus_window)
    Mainloop.source_remove(source)
    const zoomed = space.actor;
    Tweener.removeTweens(zoomed)
    Tweener.addTween(zoomed, {
        transition: 'easeInOutQuad',
        scale_x: 1,
        scale_y: 1,
        time: 0.250,
        onComplete: () => {
            space.visible.forEach(w => {
                w.get_compositor_private().show();
                w.clone.hide();
            })
            Tiling.ensureViewport(space.selectedWindow, space, true)
        }
    })
    // zoomed.set_scale(1,1)
    scale = 1.0;
}

var signals = new Utils.Signals();

// for fun and giggles
function enable() {
    signals.connect(ModifierTracker, 'modifier-down', Utils.dynamic_function_ref("startZoom", Me))
    signals.connect(ModifierTracker, 'modifier-up', Utils.dynamic_function_ref("resetZoom", Me))
}

function disable() {
    signals.destroy();
}
