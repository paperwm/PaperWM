Clutter = imports.gi.Clutter;
Tweener = imports.ui.tweener;
Lang = imports.lang;

mm = null;

layout = function(actors) {
    function calcOffset(metaWindow) {
        let buffer = metaWindow.get_buffer_rect();
        let frame = metaWindow.get_frame_rect();
        let x_offset = frame.x - buffer.x;
        let y_offset = frame.y - buffer.y;
        return [x_offset, y_offset];
    }

    function tweenTo(actor, x) {
        let [dx, dy] = calcOffset(actor.meta_window);
        Tweener.addTween(actor, { x: x - dx, time: 0.25, transition: "easeInOutQuad"});
    }

    function propagate_forward(i, leftEdge, gap) {
        if(i < 0 || i >= actors.length)
            return;
        let actor = actors[i];
        let w = actor.meta_window.get_frame_rect().width;
        let x = leftEdge;

        tweenTo(actor, x);

        propagate_forward(i+1, x + w + gap, gap);
    }

    propagate_forward(0, 0, window_gap);
}

allocationChanged = function allocationChanged(actor, propertySpec) {
    layout(mm.minimap.get_children());
}

createMinimap = function(workspace) {
    let space = spaces[workspace.index()].slice();
    let clones = space.map((mw) => {
        let windowActor = mw.get_compositor_private()
        let clone = new Clutter.Clone({ source: windowActor });
        clone.meta_window = mw;
        windowActor.connect("notify::allocation",
                            dynamic_function_ref("allocationChanged"));
        return clone;
    });
    let minimapActor = new Clutter.Actor();
    let viewport = new Clutter.Actor();
    clones.forEach(clone => {
        minimapActor.add_actor(clone);
    })
    viewport.set_scale(0.4, 0.4);
    viewport.height = primary.height;
    viewport.width = primary.width;
    viewport.add_actor(minimapActor);
    viewport.set_background_color(Clutter.Color.get_static(3))
    viewport.hide();
    return {viewport: viewport, minimap: minimapActor};
}

minimapSyncFn = function(originX) {
    Tweener.addTween(mm.minimap, { x: originX, time: 0.25, transition: 'easeInOutQuad' });
}

toggleMinimap = function() {
    if (!mm) {
        mm = createMinimap(global.screen.get_active_workspace());
        layout(mm.minimap.get_children());
        global.stage.add_actor(mm.viewport)
        mm.viewport.x = (primary.width - mm.viewport.get_transformed_size()[0])/2;
    }
    mm.viewport.visible = !mm.viewport.visible;
}

// bg=Main.layoutManager._backgroundGroup.get_children()[0]
// bgc= new Clutter.Clone({source:bg})

