Clutter = imports.gi.Clutter;
Tweener = imports.ui.tweener;
Lang = imports.lang;

if (window.mm) {
    mm.viewport.destroy();
}

mm = null;

calcOffset = function(metaWindow) {
    let buffer = metaWindow.get_buffer_rect();
    let frame = metaWindow.get_frame_rect();
    let x_offset = frame.x - buffer.x;
    let y_offset = frame.y - buffer.y;
    return [x_offset, y_offset];
}

layout = function(actors) {

    function tweenTo(actor, x) {
        let [dx, dy] = calcOffset(actor.meta_window);
        // actor.set_pivot_point(0, 0);
        Tweener.addTween(actor, { x: x - dx
                                  , scale_x: 1
                                  , scale_y: 1
                                  , time: 0.25
                                  , transition: "easeInOutQuad"});
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
    layout(mm.viewport.clones);
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

    viewport.restack = function (around) {
        minimapActor.remove_all_children();

        for (let i=0; i < around; i++) {
            print(clones[i])
            minimapActor.add_actor(clones[i]);
        }
        for (let i=clones.length-1; i>around; i--) {
            print(clones[i])
            minimapActor.add_actor(clones[i]);
        }
        minimapActor.add_actor(clones[around]);
    };

    viewport.fold = function (around) {
        this.restack(around);

        let maxProtrusion = 500;
        for (let i=0; i < around; i++) {
            let clone = clones[i];
            let [x_offset, y_offset] = calcOffset(clone.meta_window);
            clone.set_pivot_point(x_offset/clone.width, 0.5);
            if (clone.x + minimapActor.x - x_offset <= -maxProtrusion) {
                Tweener.addTween(clone, {x: -minimapActor.x - maxProtrusion - x_offset
                                         , scale_x: 0.9
                                         , scale_y: 0.9
                                         , transition: "easeInOutQuad"
                                         , time: 0.25});
            }
        }
        for (let i=clones.length-1; i>around; i--) {
            let clone = clones[i];
            let [x_offset, y_offset] = calcOffset(clone.meta_window);
            clone.set_pivot_point(1 - x_offset/clone.width, 0.5);
            if (clone.x - x_offset + clone.width + minimapActor.x >= primary.width + maxProtrusion) {
                Tweener.addTween(clone, {x: -minimapActor.x + primary.width + maxProtrusion - clone.width - x_offset
                                         , scale_x: 0.9
                                         , scale_y: 0.9
                                         , transition: "easeInOutQuad"
                                         , time: 0.25});
            }
        }
    }

    viewport.unfold = function () {
        layout(clones);
    }

    viewport.clones = clones;
    viewport.set_scale(0.1, 0.1);
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
        layout(mm.viewport.clones);
        global.stage.add_actor(mm.viewport)
        mm.viewport.x = (primary.width - mm.viewport.get_transformed_size()[0])/2;
    }
    mm.viewport.visible = !mm.viewport.visible;
}

// bg=Main.layoutManager._backgroundGroup.get_children()[0]
// bgc= new Clutter.Clone({source:bg})

