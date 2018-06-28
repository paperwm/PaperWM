var Extension = imports.misc.extensionUtils.extensions['paperwm@hedning:matrix.org']
var Clutter = imports.gi.Clutter;
var Tweener = imports.ui.tweener;
var Lang = imports.lang;
var St = imports.gi.St;
var Pango = imports.gi.Pango;

var Tiling = Extension.imports.tiling;
var utils = Extension.imports.utils;
var debug = utils.debug;

var prefs = Extension.imports.prefs.prefs;

var MINIMAP_SCALE = 0.15;

function calcOffset(metaWindow) {
    let buffer = metaWindow.get_buffer_rect();
    let frame = metaWindow.get_frame_rect();
    let x_offset = frame.x - buffer.x;
    let y_offset = frame.y - buffer.y;
    return [x_offset, y_offset];
}

var WindowCloneLayout = new Lang.Class({
    Name: 'PaperWindowCloneLayout',
    Extends: Clutter.LayoutManager,

    _init: function(minimap) {
        this.parent();
        this.minimap = minimap;
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

        box.set_origin(((inputRect.x - frame.x)*MINIMAP_SCALE),
                       (inputRect.y - frame.y)*MINIMAP_SCALE);
        box.set_size(inputRect.width*MINIMAP_SCALE,
                     inputRect.height*MINIMAP_SCALE - prefs.window_gap);

        return box;
    },

    vfunc_get_preferred_height: function(container, forWidth) {
        let frame = container.get_first_child().meta_window.get_frame_rect();
        return [MINIMAP_SCALE*frame.height,
                MINIMAP_SCALE*frame.height - prefs.window_gap];
    },

    vfunc_get_preferred_width: function(container, forHeight) {
        let frame = container.get_first_child().meta_window.get_frame_rect();
        return [MINIMAP_SCALE*frame.width, MINIMAP_SCALE*frame.width];
    },

    vfunc_allocate: function(container, box, flags) {
        let child = container.first_child;
        let realWindow = child.source;
        if (!realWindow)
            return;

        child.allocate(this._makeBoxForWindow(realWindow.meta_window),
                       flags);
        this.minimap.layout();
    }
});

class Minimap {
    constructor(space) {
        this.space = space;
        let actor = new St.Widget({name: 'minimap-background',
                                    style_class: 'switcher-list'});
        this.actor = actor;
        actor.height = space.height*0.20;

        let highlight = new St.Widget({name: 'minimap-highlight',
                                       style_class: 'item-box'});
        highlight.add_style_pseudo_class('selected');
        this.highlight = highlight;
        let label = new St.Label();
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.label = label;;

        let clip = new St.Widget({name: 'container-clip'});
        this.clip = clip;
        let container = new St.Widget({name: 'minimap-container'});
        this.container = container;
        container.height = Math.round(space.height*MINIMAP_SCALE) - prefs.window_gap;

        actor.add_actor(highlight);
        actor.add_actor(label);
        actor.add_actor(clip);
        clip.add_actor(container);
        clip.set_position(12 + prefs.window_gap, 15 + 10);
        highlight.y = clip.y - 10;
        this.signals = [
            space.connect('select', this.select.bind(this)),
            space.connect('window-added', this.addWindow.bind(this)),
            space.connect('window-removed', this.removeWindow.bind(this)),
            space.connect('swapped', this.swapped.bind(this)),
        ];
    }

    addWindow(space, metaWindow, index, row) {
        let clone = this.createClone(metaWindow);
        if (row !== undefined && this.clones[index]) {
            let column = this.clones[index];
            column.splice(row, 0, clone);
        } else {
            row = row || 0;
            this.clones.splice(index, 0, [clone]);
        }
        this.container.add_actor(clone);
    }

    removeWindow(space, metaWindow, index, row) {
        let clone = this.clones[index][row];
        let column = this.clones[index];
        column.splice(row, 1);
        if (column.length === 0)
            this.clones.splice(index, 1);
        this.container.remove_child(clone);
    }

    swapped(space, index, targetIndex, row, targetRow) {
        let column = this.clones[index];
        utils.swap(column, row, targetRow);
        utils.swap(this.clones, index, targetIndex);
        this.layout();
    }

    show() {
        this.space.actor.add_actor(this.actor);
        this.clones = this.createClones();
        this.restack();
        this.layout(false);
    }

    createClones() {
        return this.space.map(column =>
                              column.map(this.createClone.bind(this)));
    }

    createClone(mw) {
        let windowActor = mw.get_compositor_private();
        let clone = new Clutter.Clone({ source: windowActor });
        let container = new Clutter.Actor({
            layout_manager: new WindowCloneLayout(this),
            name: "window-clone-container"
        });
        clone.meta_window = mw;
        container.meta_window = mw;
        container.add_actor(clone);
        return container;
    }

    layout(animate = true) {
        let cloneSpace = this.clones;

        function propagate_forward(i, leftEdge, gap) {
            if(i < 0 || i >= cloneSpace.length)
                return;
            let column = cloneSpace[i];
            let w = Math.max(...column.map(c => c.width));
            let x = leftEdge;
            let y = 0;
            column.forEach(c => {
                c.set_position(x, y);
                y += c.height;
            });
            propagate_forward(i+1, Math.round(x + w + gap), gap);
        }

        propagate_forward(0, 0, prefs.window_gap);
        this.clip.width = Math.min(this.container.width,
                                    this.space.width - this.clip.x*2);
        this.actor.width = this.clip.width + this.clip.x*2;
        this.clip.set_clip(0, 0, this.clip.width, this.clip.height);
        this.label.set_style(`max-width: ${this.clip.width}px;`);
        this.actor.set_position(
            Math.floor((this.space.monitor.width - this.actor.width)/2),
            Math.floor((this.space.monitor.height - this.actor.height)/2));
        this.select();
    }

    restack() {
        this.container.remove_all_children();
        let clones = this.clones;

        clones.reduce((ws, column) => ws.concat(column), [])
            .forEach(c => this.container.add_actor(c));
    }

    select() {
        let position = this.space.positionOf();
        if (!position)
            return;
        let [index, row] = position;
        let clip = this.clip;
        let container = this.container;
        let highlight = this.highlight;
        let label = this.label;
        let selected = this.clones[index][row];
        if (!selected)
            return;

        label.text = selected.meta_window.title;

        if (selected.x + selected.width + container.x > clip.width) {
            // Align right edge of selected with the clip
            container.x = clip.width - (selected.x + selected.width)
            container.x -= 500; // margin
        }
        if (selected.x + container.x < 0) {
            // Align left edge of selected with the clip
            container.x = -selected.x
            container.x += 500; // margin
        }

        if (container.x + container.width < clip.width)
            container.x = clip.width - container.width;

        if (container.x > 0)
            container.x = 0;

        let gap = prefs.window_gap;
        highlight.x = Math.round(
            clip.x + container.x + selected.x - gap/2);
        highlight.y = Math.round(
            clip.y + selected.y - 10);
        highlight.set_size(Math.round(selected.width + gap),
                           Math.round(selected.height + prefs.window_gap));

        let x = highlight.x
            + (highlight.width - label.width)/2;
        if (x + label.width > clip.x + clip.width)
            x = clip.x + clip.width - label.width + 5;
        if (x < 0)
            x = clip.x - 5;

        label.set_position(
            Math.round(x),
            clip.y + Math.round(clip.height + 20));

        this.actor.height = this.label.y + this.label.height + 12;
    }

    destroy() {
        this.actor.destroy();
        this.signals.forEach(id => this.space.disconnect(id));
    }
}
