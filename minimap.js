Clutter = imports.gi.Clutter;
Tweener = imports.ui.tweener;
Lang = imports.lang;
St = imports.gi.St;
Workspace = imports.ui.workspace;
Meta = imports.gi.Meta;

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

WindowCloneLayout = new Lang.Class({
    Name: 'PaperWindowCloneLayout',
    Extends: Clutter.LayoutManager,

    _init: function() {
        this.parent();
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

        box.set_origin((inputRect.x - frame.x),
                       (inputRect.y - frame.y));
        box.set_size(inputRect.width, inputRect.height);

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

function Minimap(space)  {
    let viewport = new Clutter.Actor({ name: "minimap-viewport" });
    viewport.space = space;

    function updateClones() {
        viewport.clones = space.map((mw) => {
            let windowActor = mw.get_compositor_private()
            let clone = new Clutter.Clone({ source: windowActor });
            let container = new Clutter.Actor({ layout_manager: new WindowCloneLayout(),
                                                name: "window-clone-container"
                                              });
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

    let minimapActor = new Clutter.Actor({ name: "minimap-container"} );

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

    viewport.fold = function (around, animate = true) {
        around = around || space.indexOf(space.selectedWindow);
        if (around < 0) {
            return;
        }

        let time = 0;
        if (animate) {
            time = 0.25;
        }

        this.restack(around);
        let clones = viewport.clones;

        let maxProtrusion = 500;
        for (let i=0; i < around; i++) {
            let clone = clones[i];
            clone.set_pivot_point(0, 0.5);
            if (clone.x + minimapActor.x <= -maxProtrusion) {
                Tweener.addTween(clone, {x: -minimapActor.x - maxProtrusion
                                         , scale_x: 0.9
                                         , scale_y: 0.9
                                         , transition: "easeInOutQuad"
                                         , time: time});
            }
        }
        for (let i=clones.length-1; i>around; i--) {
            let clone = clones[i];
            clone.set_pivot_point(1, 0.5);
            if (clone.x + clone.width + minimapActor.x >= primary.width + maxProtrusion) {
                Tweener.addTween(clone, {x: -minimapActor.x + primary.width + maxProtrusion - clone.width
                                         , scale_x: 0.9
                                         , scale_y: 0.9
                                         , transition: "easeInOutQuad"
                                         , time: time});
            }
        }
    }

    viewport.unfold = function (animate = true) {
        viewport.layout(viewport.clones, animate);
    }

    viewport.toggle = function() {
        if (!viewport.visible) {
            viewport.refresh();
        }
        viewport.visible = !viewport.visible;
    }

    viewport.refresh = function() {
        updateClones();
        let selectedIndex = space.selectedIndex();
        if(selectedIndex > -1) {
            viewport.restack(selectedIndex);
            viewport.layout(viewport.clones, false);
        }
    }

    viewport.layout = function(actors, animate = true) {
        function tweenTo(actor, x) {
            // let [dx, dy] = calcOffset(actor.meta_window);
            // actor.set_pivot_point(0, 0);
            let time = 0;
            if (animate) {
                time = 0.25;
            }
            Tweener.addTween(actor, { x: x
                                        , scale_x: 1
                                        , scale_y: 1
                                        , time: time
                                        , transition: "easeInOutQuad"});
        }

        function propagate_forward(i, leftEdge, gap) {
            if(i < 0 || i >= actors.length)
                return;
            let actor = actors[i];
            let w = actor.width;
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

    return viewport;
}


MultiMap = new Lang.Class({
    Name: 'MultiMap',

    _init: function(mru) {
        this.actor = new St.Widget({ name: "multimap-viewport" });
        this.container = new St.BoxLayout({ name: "multimap-container" });
        this.actor.add_actor(this.container);
        this.container.set_vertical(true)
        this.container.remove_all_children()
        this.minimaps = [];

        if (mru) {
            let seen = {};
            let i = 0;
            global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null)
                .forEach(metaWindow => {
                    let workspace = metaWindow.get_workspace();
                    if (!seen[workspace]) {
                        debug('add workspace');
                        this.addSpace(spaces[workspace.workspace_index], i)
                        seen[workspace] = true;
                        i++;
                    }
                });

            let workspaces = global.screen.get_n_workspaces();
            for (let j=0; j < workspaces; j++) {
                let workspace = global.screen.get_workspace_by_index(j);
                if (!seen[workspace]) {
                    debug('add workspace');
                    this.addSpace(spaces[workspace.workspace_index], i)
                    i++;
                    seen[workspace] = true;
                }
            }
        } else {
            spaces.forEach((s, i) => {
                this.addSpace(s, i);
            })
        }
        this.rowHeight = this.container.first_child.height;
        this.actor.height = this.rowHeight;
        this.actor.width = this.container.first_child.width;

        this.selectedIndex = 0;
        let minimap = this.setSelected(this.selectedIndex, false);
        this.windows = minimap.space;
        let chrome = new St.Widget();
        this.actor.add_child(chrome);
        chrome.set_size(this.actor.width + 2*4, this.actor.height + 2*4);
        chrome.set_position(-4, -4);
        chrome.set_style('border: 4px #215d9c; border-radius: 8px;');
    },


    addSpace: function(s, i) {
        let wrapper = new St.Widget({ name: "minimap-wrapper-"+i });
        s.minimap.reparent(wrapper);
        this.container.add_child(wrapper);
        s.minimap.visible = true;
        s.minimap.refresh();
        s.minimap.fold(undefined, false);
        wrapper.width = Math.ceil(s.minimap.width * s.minimap.scale_x);
        wrapper.height = Math.ceil(s.minimap.height * s.minimap.scale_y);
        this.minimaps.push(s.minimap);
    },

    setSelected: function(i, animate = true) {
        if (i >= this.container.get_children().length ||
            i < 0) {
            return;
        }
        if (i !== this.selectedIndex) {
            this.minimaps[this.selectedIndex].fold(undefined, animate);
        }

        this.selectedIndex = i;
        let time = 0;
        if (animate)
            time = 0.25;
        Tweener.addTween(this.container, { y: -i*this.rowHeight, time: time, transition: 'easeInOutQuad' });
        this.minimaps[this.selectedIndex].unfold(animate);
        return this.minimaps[this.selectedIndex];
    },

    getSelected: function() {
        return this.minimaps[this.selectedIndex];
    },

    onlyShowSelected: function() {
        this.container.get_children().forEach((wrapper, i) => {
            if (i !== this.selectedIndex) {
                wrapper.hide();
            }
        });
        this.container.y = 0;
    },

    showAll: function() {
        this.container.get_children().forEach((wrapper, i) => {
            wrapper.show();
        });
        this.setSelected(this.selectedIndex, false);
    }
})

const Signals = imports.signals;
Signals.addSignalMethods(MultiMap.prototype);
