import Clutter from 'gi://Clutter';
import St from 'gi://St';
import Pango from 'gi://Pango';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { Settings, Utils, Lib } from './imports.js';
import { Easer } from './utils.js';

export function calcOffset(metaWindow) {
    let buffer = metaWindow.get_buffer_rect();
    let frame = metaWindow.get_frame_rect();
    let x_offset = frame.x - buffer.x;
    let y_offset = frame.y - buffer.y;
    return [x_offset, y_offset];
}

export class Minimap extends Array {
    constructor(space, monitor) {
        super();
        this.space = space;
        this.monitor = monitor;
        let actor = new St.Widget({
            name: 'minimap',
            style_class: 'paperwm-minimap switcher-list',
        });
        this.actor = actor;
        actor.height = space.height * 0.20;

        let highlight = new St.Widget({
            name: 'minimap-selection',
            style_class: 'paperwm-minimap-selection item-box',
        });
        highlight.add_style_pseudo_class('selected');
        this.highlight = highlight;
        let label = new St.Label({ style_class: 'paperwm-minimap-label' });
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.label = label;

        let clip = new St.Widget({ name: 'container-clip' });
        this.clip = clip;
        let container = new St.Widget({ name: 'minimap-container' });
        this.container = container;

        actor.add_child(highlight);
        actor.add_child(label);
        actor.add_child(clip);
        clip.add_child(container);
        clip.set_position(12 + Settings.prefs.window_gap, 12 + Math.round(1.5 * Settings.prefs.window_gap));
        highlight.y = clip.y - 10;
        Main.uiGroup.add_child(this.actor);
        this.actor.opacity = 0;
        this.createClones();

        this.signals = new Utils.Signals();
        this.signals.connect(space, 'select', this.select.bind(this));
        this.signals.connect(space, 'window-added', this.addWindow.bind(this));
        this.signals.connect(space, 'window-removed', this.removeWindow.bind(this));
        this.signals.connect(space, 'layout', this.layout.bind(this));
        this.signals.connect(space, 'swapped', this.swapped.bind(this));
        this.signals.connect(space, 'full-layout', this.reset.bind(this));

        this.layout();
    }

    static get [Symbol.species]() { return Array; }

    reset() {
        this.splice(0, this.length).forEach(c => c.forEach(x => x.destroy()));
        this.createClones();
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
        Lib.swap(this, index, targetIndex);
        Lib.swap(column, row, targetRow);
        this.layout();
    }

    show(animate) {
        if (this.destroyed)
            return;

        // if minimap_scale preference is 0, then don't show
        if (Settings.prefs.minimap_scale <= 0) {
            return;
        }

        this.layout();
        let time = animate ? Settings.prefs.animation_time : 0;
        this.actor.show();
        Easer.addEase(this.actor,
            { opacity: 255, time, mode: Clutter.AnimationMode.EASE_OUT_EXPO });
    }

    hide(animate) {
        if (this.destroyed)
            return;
        let time = animate ? Settings.prefs.animation_time : 0;
        Easer.addEase(this.actor,
            {
                opacity: 0, time, mode: Clutter.AnimationMode.EASE_OUT_EXPO,
                onComplete: () => this.actor.hide(),
            });
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
            // layout_manager: new WindowCloneLayout(this),
            name: "window-clone-container",
        });
        clone.meta_window = mw;
        container.clone = clone;
        container.meta_window = mw;
        container.add_child(clone);
        this.container.add_child(container);
        return container;
    }

    _allocateClone(container) {
        let clone = container.clone;
        let meta_window = clone.meta_window;
        let buffer = meta_window.get_buffer_rect();
        let frame = meta_window.get_frame_rect();
        let scale = Settings.prefs.minimap_scale;
        clone.set_size(buffer.width * scale, buffer.height * scale - Settings.prefs.window_gap);
        clone.set_position((buffer.x - frame.x) * scale, (buffer.y - frame.y) * scale);
        container.set_size(frame.width * scale, frame.height * scale);
    }

    layout() {
        if (this.destroyed)
            return;
        let gap = Settings.prefs.window_gap;
        let x = 0;
        for (let column of this) {
            let y = 0, w = 0;
            for (let c of column) {
                c.set_position(x, y);
                this._allocateClone(c);
                w = Math.max(w, c.width);
                y += c.height;
            }
            x += w + gap;
        }

        this.clip.width = Math.min(this.container.width,
            this.monitor.width - this.clip.x * 2 - 24);
        this.actor.width = this.clip.width + this.clip.x * 2;
        this.clip.set_clip(0, 0, this.clip.width, this.clip.height);
        this.label.set_style(`max-width: ${this.clip.width}px;`);
        this.actor.set_position(
            this.monitor.x + Math.floor((this.monitor.width - this.actor.width) / 2),
            this.monitor.y + Math.floor((this.monitor.height - this.actor.height) / 2));
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
            container.x = clip.width - (selected.x + selected.width);
            container.x -= 500; // margin
        }
        if (selected.x + container.x < 0) {
            // Align left edge of selected with the clip
            container.x = -selected.x;
            container.x += 500; // margin
        }

        if (container.x + container.width < clip.width)
            container.x = clip.width - container.width;

        if (container.x > 0)
            container.x = 0;

        let gap = Settings.prefs.window_gap;
        highlight.x = Math.round(
            clip.x + container.x + selected.x - gap / 2);
        highlight.y = Math.round(
            clip.y + selected.y - Settings.prefs.window_gap);
        highlight.set_size(Math.round(selected.width + gap),
            Math.round(Math.min(selected.height, this.clip.height + gap) + gap));

        let x = highlight.x + (highlight.width - label.width) / 2;
        if (x + label.width > clip.x + clip.width)
            x = clip.x + clip.width - label.width + 5;
        if (x < 0)
            x = clip.x - 5;

        label.set_position(Math.round(x), this.clip.y + this.clip.height + 8);
        this.actor.height = this.clip.y + this.clip.height + 40;
    }

    destroy() {
        if (this.destroyed)
            return;
        this.destroyed = true;
        this.signals.destroy();
        this.signals = null;
        this.splice(0, this.length);
        this.actor.destroy();
        this.actor = null;
    }
};
