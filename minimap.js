Clutter = imports.gi.Clutter;
Tweener = imports.ui.tweener;
Lang = imports.lang;
St = imports.gi.St;
Workspace = imports.ui.workspace;

calcOffset = function(metaWindow) {
    let buffer = metaWindow.get_buffer_rect();
    let frame = metaWindow.get_frame_rect();
    let x_offset = frame.x - buffer.x;
    let y_offset = frame.y - buffer.y;
    return [x_offset, y_offset];
}

allocationChanged = function allocationChanged(actor, propertySpec) {
    this.layout(this.clones);
}

const notifySignal = Symbol();

var WindowCloneLayout = new Lang.Class({
    Name: 'WindowCloneLayout2',
    Extends: Clutter.LayoutManager,

    _init: function(boundingBox) {
        this.parent();

        this._boundingBox = boundingBox;
    },

    get boundingBox() {
        return this._boundingBox;
    },

    set boundingBox(b) {
        this._boundingBox = b;
        this.layout_changed();
    },

    _makeBoxForWindow: function(window) {
        // We need to adjust the position of the actor because of the
        // consequences of invisible borders -- in reality, the texture
        // has an extra set of "padding" around it that we need to trim
        // down.

        // The outer rect (from which we compute the bounding box)
        // paradoxically is the smaller rectangle, containing the positions
        // of the visible frame. The input rect contains everything,
        // including the invisible border padding.
        let inputRect = window.get_buffer_rect();
        let frame = window.get_frame_rect();

        let box = new Clutter.ActorBox();

        box.set_origin(-(inputRect.x - frame.x),
                       -(inputRect.y - frame.y));
        box.set_size(frame.width, frame.height);
        // debug("box", box.get_x(), box.get_y(), box.get_width(), box.get_height())

        return box;
    },

    vfunc_get_preferred_height: function(container, forWidth) {
        let frame = container.get_first_child().meta_window.get_frame_rect();
        return [frame.height, frame.height];
    },

    vfunc_get_preferred_width: function(container, forHeight) {
        let frame = container.get_first_child().meta_window.get_frame_rect();
        return [frame.width, frame.width];
    },

    vfunc_allocate: function(container, box, flags) {
        container.get_children().forEach(Lang.bind(this, function (child) {
            let realWindow;
            // if (child == container._delegate._windowClone)
            //     realWindow = container._delegate.realWindow;
            // else
                realWindow = child.source;

            child.allocate(this._makeBoxForWindow(realWindow.meta_window),
                           flags);
        }));
    }
});


function Minimap(space) {
    let viewport = new Clutter.Actor();
    viewport.space = space;

    function updateClones() {
        viewport.clones = space.map((mw) => {
            let windowActor = mw.get_compositor_private()
            let clone = new Clutter.Clone({ source: windowActor });
            let container = new St.Widget({ layout_manager: new WindowCloneLayout() });
            clone.meta_window = mw;
            if (windowActor[notifySignal]) {
                windowActor.disconnect(windowActor[notifySignal]);
            }
            windowActor[notifySignal] = windowActor.connect("notify::allocation",
                                                            Lang.bind(viewport, dynamic_function_ref("allocationChanged")));

            container.add_actor(clone);
            // let [x_offset, y_offset] = calcOffset(clone.meta_window);
            // clone.set_position(-x_offset, -y_offset);
            return container;
        });

    }

    let minimapActor = new Clutter.Actor();

    viewport.restack = function (around) {
        minimapActor.remove_all_children();
        let clones = viewport.clones;

        for (let i=0; i < around; i++) {
            minimapActor.add_actor(clones[i]);
        }
        for (let i=clones.length-1; i>around; i--) {
            minimapActor.add_actor(clones[i]);
        }
        minimapActor.add_actor(clones[around]);
    };

    viewport.fold = function (around) {
        around = around || space.indexOf(space.selectedWindow);
        this.restack(around);
        let clones = viewport.clones;

        let maxProtrusion = 500;
        for (let i=0; i < around; i++) {
            let clone = clones[i];
            if (clone.x + minimapActor.x <= -maxProtrusion) {
                Tweener.addTween(clone, {x: -minimapActor.x - maxProtrusion
                                         , scale_x: 0.9
                                         , scale_y: 0.9
                                         , transition: "easeInOutQuad"
                                         , time: 0.25});
            }
        }
        for (let i=clones.length-1; i>around; i--) {
            let clone = clones[i];
            if (clone.x + clone.width + minimapActor.x >= primary.width + maxProtrusion) {
                Tweener.addTween(clone, {x: -minimapActor.x + primary.width + maxProtrusion - clone.width
                                         , scale_x: 0.9
                                         , scale_y: 0.9
                                         , transition: "easeInOutQuad"
                                         , time: 0.25});
            }
        }
    }

    viewport.unfold = function () {
        viewport.layout(viewport.clones);
    }

    viewport.toggle = function() {
        if (!viewport.visible) {
            updateClones();
            let selectedIndex = space.selectedIndex();
            viewport.restack(selectedIndex);
            viewport.layout(viewport.clones);
            viewport.clones[selectedIndex].set_style_class_name("paper-mm-selected-window");
        }
        viewport.visible = !viewport.visible;
    }

    viewport.layout = function(actors) {
        function tweenTo(actor, x) {
            // let [dx, dy] = calcOffset(actor.meta_window);
            // actor.set_pivot_point(0, 0);
            Tweener.addTween(actor, { x: x
                                        , scale_x: 1
                                        , scale_y: 1
                                        , time: 0.25
                                        , transition: "easeInOutQuad"});
        }

        function propagate_forward(i, leftEdge, gap) {
            if(i < 0 || i >= actors.length)
                return;
            let actor = actors[i];
            let w = actor.get_first_child().meta_window.get_frame_rect().width;
            let x = leftEdge;

            tweenTo(actor, x);

            propagate_forward(i+1, x + w + gap, gap);
        }

        propagate_forward(0, 0, window_gap);
    }

    viewport.sync = function(originX) {
        Tweener.addTween(minimapActor, { x: originX, time: 0.25, transition: 'easeInOutQuad' });
    }

    viewport.clones = [];
    viewport.set_scale(0.1, 0.1);
    viewport.height = primary.height;
    viewport.width = primary.width;
    viewport.add_actor(minimapActor);
    viewport.set_background_color(Clutter.Color.get_static(3))
    viewport.hide();

    viewport.layout(viewport.clones);
    global.stage.add_actor(viewport)
    viewport.x = (primary.width - viewport.get_transformed_size()[0])/2;

    return viewport;
}

// bg=Main.layoutManager._backgroundGroup.get_children()[0]
// bgc= new Clutter.Clone({source:bg})


