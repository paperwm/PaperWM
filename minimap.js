var Extension = imports.misc.extensionUtils.extensions['paperwm@hedning:matrix.org']
var Clutter = imports.gi.Clutter;
var Tweener = Extension.imports.utils.tweener;
var Main = imports.ui.main;
var Lang = imports.lang;
var St = imports.gi.St;
var Pango = imports.gi.Pango;

var Tiling = Extension.imports.tiling;
var utils = Extension.imports.utils;
var debug = utils.debug;

var prefs = Extension.imports.settings.prefs;

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

class Minimap extends Array {
    constructor(space, monitor) {
        super();
        this.space = space;
        this.monitor = monitor;
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
        clip.set_position(12 + prefs.window_gap, 12 + Math.round(1.5*prefs.window_gap));
        highlight.y = clip.y - 10;
        Main.uiGroup.add_actor(this.actor);
        this.actor.opacity = 0;
        this.createClones();

        this.signals = new utils.Signals();
        this.signals.connect(space, 'select', this.select.bind(this));
        this.signals.connect(space, 'window-added', this.addWindow.bind(this));
        this.signals.connect(space, 'window-removed', this.removeWindow.bind(this));
        this.signals.connect(space, 'swapped', this.swapped.bind(this));
        this.signals.connect(space, 'full-layout', this.reset.bind(this));

        this.layout();
    }

    static get [Symbol.species]() { return Array; }

    reset() {
        this.splice(0,this.length).forEach(c => c.forEach(x => x.destroy()))
        this.createClones()
        this.layout();
    }

    addWindow(space, metaWindow, index, row) {
        let clone = this.createClone(metaWindow);
        if (row !== undefined && this[index]) {
            let column = this[index];
            column.splice(row, 0, clone);
        } else {
            row = row || 0;
            this.splice(index, 0, [clone]);
        }
        this.layout();
    }

    removeWindow(space, metaWindow, index, row) {
        let clone = this[index][row];
        let column = this[index];
        column.splice(row, 1);
        if (column.length === 0)
            this.splice(index, 1);
        this.container.remove_child(clone);
        this.layout();
    }

    swapped(space, index, targetIndex, row, targetRow) {
        let column = this[index];
        utils.swap(this, index, targetIndex);
        utils.swap(column, row, targetRow);
        this.layout();
    }

    show(animate) {
        if (this.destroyed)
            return;
        let time = animate ? 0.25 : 0;
        this.actor.show();
        Tweener.addTween(this.actor,
                         {opacity: 255, time, mode: Clutter.AnimationMode.EASE_OUT_EXPO});
    }

    hide(animate) {
        if (this.destroyed)
            return;
        let time = animate ? 0.25 : 0;
        Tweener.addTween(this.actor,
                         {opacity: 0, time, mode: Clutter.AnimationMode.EASE_OUT_EXPO,
                          onComplete: () => this.actor.hide() });
    }

    createClones() {
        for (let column of this.space) {
            this.push(column.map(this.createClone.bind(this)));
        }
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
        this.container.add_actor(container);
        return container;
    }

    layout() {
        if (this.destroyed)
            return;
        let gap = prefs.window_gap;
        let x = 0;
        for (let column of this) {
            let y = 0, w = 0;
            for (let c of column) {
                c.set_position(x, y);
                w = Math.max(w, c.width);
                y += c.height;
            }
            x += w + gap;
        }

        this.clip.width = Math.min(this.container.width,
                                   this.monitor.width - this.clip.x*2 - 24);
        this.actor.width = this.clip.width + this.clip.x*2;
        this.clip.set_clip(0, 0, this.clip.width, this.clip.height);
        this.label.set_style(`max-width: ${this.clip.width}px;`);
        this.actor.set_position(
            this.monitor.x + Math.floor((this.monitor.width - this.actor.width)/2),
            this.monitor.y + Math.floor((this.monitor.height - this.actor.height)/2));
        this.select();
    }

    select() {
        let position = this.space.positionOf();
        let highlight = this.highlight;
        if (!position) {
            this.highlight.hide();
            return;
        }
        let [index, row] = position;
        if (!(index in this && row in this[index]))
            return;
        highlight.show();
        let clip = this.clip;
        let container = this.container;
        let label = this.label;
        let selected = this[index][row];
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
            clip.y + selected.y - prefs.window_gap);
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
        if (this.destroyed)
            return;
        this.destroyed = true;
        this.signals.destroy();
        this.splice(0,this.length);
        this.actor.destroy();
        this.actor = null;
    }
}
