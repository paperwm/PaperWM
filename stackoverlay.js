import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PointerWatcher from 'resource:///org/gnome/shell/ui/pointerWatcher.js';

import { Settings, Utils, Tiling, Grab, Scratch } from './imports.js';

/*
  The stack overlay decorates the top stacked window with its icon and
  captures mouse input such that a mouse click only _activates_ the
  window. A very limited portion of the window is visible and due to
  the animation the button-up event will be triggered at an
  unpredictable position

  See #10
*/

/*
  Parent of the overlay?

  Most natural parent is the window actor, but then the overlay
  becomes visible in the clones too.

  Since the stacked windows doesn't really move it's not a big problem
  that the overlay doesn't track the window. The main challenge with
  using a different parent becomes controlling the "z-index".

  If I understand clutter correctly that can only be done by managing
  the order of the scene graph nodes. Descendants of node A will thus
  always be drawn in the same plane compared to a non-descendants.

  The overlay thus have to be parented to `global.window_group`. One
  would think that was ok, but unfortunately mutter keeps syncing the
  window_group with the window stacking and in the process destroy the
  stacking of any non-window actors.

  Adding a "clutter restack" to the `MetaScreen` `restacked` signal
  seems keep the stacking in sync (without entering into infinite
  restack loops)
*/

let pointerWatch, previewPointerWatcher;
export function enable(_extension) {

}

export function disable() {
    previewPointerWatcher?.remove();
    previewPointerWatcher = null;
    disableMultimonitorSupport();
}

/**
 * Checks for multiple monitors and if so, then enables multimonitor
 * support in PaperWM.
 */
export function multimonitorSupport() {
    // if only one monitor, return
    if (Tiling.spaces.monitors?.size > 1) {
        enableMultimonitorSupport();
    }
    else {
        disableMultimonitorSupport();
    }
}

export function enableMultimonitorSupport() {
    pointerWatch = PointerWatcher.getPointerWatcher().addWatch(100,
        () => {
            // if overview return
            if (Main.overview.visible) {
                return;
            }

            const monitor = Utils.monitorAtCurrentPoint();
            const space = Tiling.spaces.monitors.get(monitor);

            // same space
            if (space === Tiling.spaces.activeSpace) {
                return;
            }

            // check if in the midst of a window resize action
            if (Tiling.inGrab &&
                Tiling.inGrab instanceof Grab.ResizeGrab) {
                const window = global.display?.focus_window;
                if (window) {
                    Scratch.makeScratch(window);
                }
                return;
            }

            // if drag/grabbing window, do simple activate
            if (Tiling.inGrab) {
                space?.activate(false, false);
                return;
            }

            const selected = space?.selectedWindow;
            space?.activateWithFocus(selected, false, false);
        });
    console.debug('paperwm multimonitor support is ENABLED');
}

export function disableMultimonitorSupport() {
    pointerWatch?.remove();
    pointerWatch = null;
    console.debug('paperwm multimonitor support is DISABLED');
}

export function createAppIcon(metaWindow, size) {
    let tracker = Shell.WindowTracker.get_default();
    let app = tracker.get_window_app(metaWindow);
    let appIcon = app ? app.create_icon_texture(size)
        : new St.Icon({
            icon_name: 'icon-missing',
            icon_size: size,
        });
    appIcon.x_expand = appIcon.y_expand = true;
    appIcon.x_align = appIcon.y_align = Clutter.ActorAlign.END;

    return appIcon;
}

export class ClickOverlay {
    constructor(monitor, onlyOnPrimary) {
        this.monitor = monitor;
        this.onlyOnPrimary = onlyOnPrimary;
        this.left = new StackOverlay(Meta.MotionDirection.LEFT, monitor);
        this.right = new StackOverlay(Meta.MotionDirection.RIGHT, monitor);
    }

    reset() {
        this.left.setTarget(null);
        this.right.setTarget(null);
    }

    hide() {
        this.left.overlay.hide();
        this.right.overlay.hide();
    }

    show() {
        if (Main.overview.visible)
            return;
        this.left.overlay.show();
        this.right.overlay.show();
    }

    destroy() {
        for (let overlay of [this.left, this.right]) {
            let actor = overlay.overlay;
            overlay.signals.destroy();
            overlay.signals = null;
            if (overlay.clone) {
                overlay.clone.destroy();
                overlay.clone = null;
            }
            actor.destroy();
        }
    }
}

export class StackOverlay {
    constructor(direction, monitor) {
        this.SHOW_DELAY = 100;

        this._direction = direction;

        const overlay = new Clutter.Actor({
            reactive: true,
            name: "stack-overlay",
        });

        // Uncomment to debug the overlays
        // overlay.background_color = Utils.color_from_string('green')[1];
        // overlay.opacity = 100;

        this.monitor = monitor;
        const panelBox = Main.layoutManager.panelBox;
        overlay.y = monitor.y + panelBox.height + Settings.prefs.vertical_margin;
        overlay.height = this.monitor.height - panelBox.height - Settings.prefs.vertical_margin;
        overlay.width = Tiling.stack_margin;

        this.signals = new Utils.Signals();

        // preview timeouts
        this.triggerPreviewTimeout = null;
        this.showPreviewTimeout = null;
        this.activatePreviewTimeout = null;

        this.signals.connect(overlay, 'button-press-event', () => {
            if (!Settings.prefs.edge_preview_enable) {
                return;
            }

            if (!Settings.prefs.edge_preview_click_enable) {
                return;
            }

            this._activateTarget();
        });

        this.signals.connect(overlay, 'enter-event', () => this.triggerPreview());
        this.signals.connect(overlay, 'leave-event', () => this.removePreview());

        global.window_group.add_child(overlay);
        Main.layoutManager.trackChrome(overlay);

        this.overlay = overlay;
        this.setTarget(null);
    }

    _activateTarget() {
        Main.activateWindow(this.target);
        // remove/cleanup the previous preview
        this.removePreview();

        // if pointer is still at edge (within 2px), trigger preview
        this.triggerPreviewTimeout = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            (Settings.prefs.animation_time * 1000) + 50,
            () => {
                if (this._pointerIsAtEdge()) {
                    this.triggerPreview(true);
                }

                this.triggerPreviewTimeout = null;
                return false; // on return false destroys timeout
            });
    }

    /**
     * Returns true if pointer x position is at monitor edge.
     * @returns Boolean
     */
    _pointerIsAtEdge() {
        const [x] = global.get_pointer();
        switch (this._direction) {
        case Meta.MotionDirection.LEFT:
            if (
                x >= this.monitor.x &&
                x <= this.monitor.x + 2
            ) {
                return true;
            }
            break;
        case Meta.MotionDirection.RIGHT:
            if (
                x <= this.monitor.x + this.monitor.width &&
                x >= this.monitor.x + this.monitor.width - 2
            ) {
                return true;
            }
            break;
        }

        return false;
    }

    /**
     * Triggers edge window preview.
     * @param {Boolean} postActivatePreview: true if an auto preview after previous activation
     * @returns
     */
    triggerPreview(postActivatePreview = false) {
        if (!Settings.prefs.edge_preview_enable) {
            return;
        }

        if (this.showPreviewTimeout) {
            return;
        }

        if (!this.target) {
            return;
        }

        // create pointerwatcher to ensure preview is removed
        previewPointerWatcher?.remove();
        previewPointerWatcher = PointerWatcher.getPointerWatcher().addWatch(200, () => {
            if (!this._pointerIsAtEdge()) {
                this.removePreview();
                previewPointerWatcher?.remove();
                previewPointerWatcher = null;
            }
        });

        this.showPreviewTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this.SHOW_DELAY, () => {
            this.removePreview();
            this.showPreview();
            this.showPreviewTimeout = null;

            // activate preview on timeout
            if (Settings.prefs.edge_preview_timeout_enable) {
                // if no continual activation
                if (postActivatePreview &&
                    !Settings.prefs.edge_preview_timeout_continual) {
                    // check have a target
                    if (!this.target) {
                        return;
                    }

                    // push pointer back
                    let [, py] = global.get_pointer();
                    const offset = 3;
                    let x;
                    switch (this._direction) {
                    case Meta.MotionDirection.LEFT:
                        x = this.monitor.x + offset;
                        break;
                    case Meta.MotionDirection.RIGHT:
                        x = this.monitor.x + this.monitor.width - offset;
                        break;
                    }
                    Utils.warpPointer(
                        x,
                        py,
                        false
                    );
                    return;
                }

                this.activatePreviewTimeout = GLib.timeout_add(
                    GLib.PRIORITY_DEFAULT,
                    Settings.prefs.edge_preview_timeout, () => {
                        // check if still at edge
                        if (this._pointerIsAtEdge()) {
                            this._activateTarget();
                        }
                    });
            }

            return false; // on return false destroys timeout
        });
    }

    removePreview() {
        if (this.showPreviewTimeout) {
            Utils.timeout_remove(this.showPreviewTimeout);
            this.showPreviewTimeout = null;
        }

        if (this.clone) {
            this.clone.destroy();
            this.clone = null;
        }
    }

    /**
     * Shows the window preview in from the side it was triggered on.
     */
    showPreview() {
        // only show if have valid scale
        const scale = Settings.prefs.edge_preview_scale;
        if (scale <= 0) {
            return;
        }

        // don't show if window grabbed
        if (Grab.grabbed) {
            return;
        }

        /**
         * if timeout is enabled, only show if valid timeout (e.g. if SHOW_DELAY <= timeout,
         * then won't see the preview anyway).
         */
        if (Settings.prefs.edge_preview_timeout_enable &&
            Settings.prefs.edge_preview_timeout <= this.SHOW_DELAY
        ) {
            return;
        }

        let [x, y] = global.get_pointer();
        const actor = this.target.get_compositor_private();
        const clone = new Clutter.Clone({ source: actor });
        this.clone = clone;

        // Remove any window clips, and show the metaWindow.clone's
        actor.remove_clip();
        Tiling.animateWindow(this.target);

        // set clone parameters
        clone.opacity = 255 * 0.95;

        clone.set_scale(scale, scale);
        Main.uiGroup.add_child(clone);

        const monitor = this.monitor;
        const scaleWidth = scale * clone.width;
        const scaleHeight = scale * clone.height;
        if (this._direction === Meta.MotionDirection.RIGHT) {
            x = monitor.x + monitor.width - scaleWidth;
        }
        else {
            x = monitor.x;
        }

        // calculate y position - center of mouse
        y -= (scale * clone.height) / 2;

        // bound to remain within view
        const workArea = this.getWorkArea();
        y = Math.max(y, workArea.y);
        y = Math.min(y, workArea.y + workArea.height - scaleHeight);

        clone.set_position(x, y);
    }

    setTarget(space, index) {
        this.removePreview();

        let bail = () => {
            this.target = null;
            this.overlay.width = 0;
            return false;
        };

        if (space === null || Tiling.inPreview) {
            // No target. Eg. if we're at the left- or right-most window
            return bail();
        }

        let mru = global.display.get_tab_list(Meta.TabList.NORMAL_ALL,
            space.workspace);
        let column = space[index];
        column = column.flat(1);
        this.target = mru.filter(w => column.includes(w))[0];
        let metaWindow = this.target;
        if (!metaWindow)
            return;

        let overlay = this.overlay;
        overlay.y = this.monitor.y + Main.layoutManager.panelBox.height + Settings.prefs.vertical_margin;

        // Assume the resize edge is at least this big (empirically found..)
        const minResizeEdge = 8;

        if (this._direction === Meta.MotionDirection.LEFT) {
            let column = space[space.indexOf(metaWindow) + 1];
            column = column.flat(1);
            let neighbour = column &&
                global.display.sort_windows_by_stacking(column).reverse()[0];

            if (!neighbour)
                return bail(); // Should normally have a neighbour. Bail!

            let width = neighbour.clone.targetX + space.targetX - minResizeEdge;
            if (space.isPlaceable(metaWindow) || Meta.is_wayland_compositor())
                width = Math.min(width, 1);
            overlay.x = this.monitor.x;
            overlay.width = Math.max(width, 1);
            Utils.actor_raise(overlay, neighbour.get_compositor_private());
        } else {
            let index = Utils.findColumnIndexOfWindow(space, metaWindow);
            let column = space[index];
            column = column.flat(1);
            let neighbour = column &&
                global.display.sort_windows_by_stacking(column).reverse()[0];
            if (!neighbour)
                return bail(); // Should normally have a neighbour. Bail!

            let frame = neighbour.get_frame_rect();
            frame.x = neighbour.clone.targetX + space.targetX;
            let width = this.monitor.width - (frame.x + frame.width) - minResizeEdge;
            if (space.isPlaceable(metaWindow) || Meta.is_wayland_compositor())
                width = 1;
            width = Math.max(width, 1);
            overlay.x = this.monitor.x + this.monitor.width - width;
            overlay.width = width;
            Utils.actor_raise(overlay, neighbour.get_compositor_private());
        }

        if (space.selectedWindow.fullscreen || space.selectedWindow.maximized_vertically)
            overlay.hide();
        else
            overlay.show();

        return true;
    }

    destroy() {
        Utils.timeout_remove(this.triggerPreviewTimeout);
        this.triggerPreviewTimeout = null;

        Utils.timeout_remove(this.showPreviewTimeout);
        this.showPreviewTimeout = null;

        Utils.timeout_remove(this.activatePreviewTimeout);
        this.activatePreviewTimeout = null;

        this.signals.destroy();
        this.signals = null;
        this.removePreview();

        Main.layoutManager.untrackChrome(this.overlay);
        this.overlay.destroy();
    }

    /**
     * Convenience method to return WorkArea for current monitor.
     * @returns WorkArea
     */
    getWorkArea() {
        return Main.layoutManager.getWorkAreaForMonitor(this.monitor.index);
    }
}
