const ExtensionUtils = imports.misc.extensionUtils;
const Extension = ExtensionUtils.getCurrentExtension();
const Settings = Extension.imports.settings;
const Utils = Extension.imports.utils;
const Grab = Extension.imports.grab;
const Tiling = Extension.imports.tiling;
const Navigator = Extension.imports.navigator;

const { Clutter, Shell, Meta, St } = imports.gi;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const Layout = imports.ui.layout;
const PointerWatcher = imports.ui.pointerWatcher;


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

let pointerWatch;
function disable() {
    disableMultimonitorDragDropSupport();
}

/**
 * Checks for multiple monitors and if so, then enables multimonitor
 * drag/drop support in PaperWM.
 */
function multimonitorDragDropSupport() {
    // if only one monitor, return
    if (Tiling.spaces.monitors?.size > 1) {
        enableMultimonitorDragDropSupport();
    }
    else {
        disableMultimonitorDragDropSupport();
    }
}

function enableMultimonitorDragDropSupport() {
    pointerWatch = PointerWatcher.getPointerWatcher().addWatch(100,
        () => {
            Tiling.spaces?.clickOverlays?.forEach(c => {
                c.monitorActiveCheck();
            });
        });
    console.debug('paperwm multimonitor drag/drop support is ENABLED');
}

function disableMultimonitorDragDropSupport() {
    pointerWatch?.remove();
    pointerWatch = null;
    console.debug('paperwm multimonitor drag/drop support is DISABLED');
}

function createAppIcon(metaWindow, size) {
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

var ClickOverlay = class ClickOverlay {
    constructor(monitor, onlyOnPrimary) {
        this.monitor = monitor;
        this.onlyOnPrimary = onlyOnPrimary;
        this.left = new StackOverlay(Meta.MotionDirection.LEFT, monitor);
        this.right = new StackOverlay(Meta.MotionDirection.RIGHT, monitor);

        let enterMonitor = new Clutter.Actor({ reactive: true });
        this.enterMonitor = enterMonitor;
        enterMonitor.set_position(monitor.x, monitor.y);

        // Uncomment to debug the overlays
        // enterMonitor.background_color = Clutter.color_from_string('green')[1];
        // enterMonitor.opacity = 100;

        Main.uiGroup.add_actor(enterMonitor);
        Main.layoutManager.trackChrome(enterMonitor);

        this.signals = new Utils.Signals();

        this._lastPointer = [];
        this._lastPointerTimeout = null;

        this.signals.connect(enterMonitor, 'enter-event', () => {
            if (Tiling.inPreview)
                return;
            this.select();
        });

        this.signals.connect(enterMonitor, 'button-press-event', () => {
            if (Tiling.inPreview)
                return;
            this.select();
            return Clutter.EVENT_STOP;
        });

        this.signals.connect(Main.overview, 'showing', () => {
            this.deactivate();
            this.hide();
        });

        this.signals.connect(Main.overview, 'hidden', () => {
            this.activate();
            this.show();
        });

        /**
         * Handle grabbed (drag & drop) windows in ClickOverlay.  If a window is
         * grabbed-dragged-and-dropped on a monitor, then select() on this ClickOverlay
         * (which deactivates ClickOverlay and immediately activates/selects the dropped window.
         */
        this.signals.connect(global.display, 'grab-op-end', (display, mw, type) => {
            if (this.monitor === this.mouseMonitor) {
                this.select();
            }
        });
    }

    /**
     * Returns the space of this ClickOverlay instance.
     */
    get space() {
        return Tiling.spaces.monitors.get(this.monitor);
    }

    /**
     * Returns the monitor the mouse is currently on.
     */
    get mouseMonitor() {
        return Grab.monitorAtCurrentPoint();
    }

    monitorActiveCheck() {
        // if clickoverlay not active, then nothing to do
        if (!this.active) {
            return;
        }

        if (Main.overview.visible || Tiling.inPreview) {
            return;
        }

        // if mouse on me, select
        if (this.monitor === this.mouseMonitor) {
            this.select();
        }
    }

    select() {
        /**
         * stop navigation before activating workspace. Avoids an issue
         * in multimonitors where workspaces can get snapped to another monitor.
         */
        Navigator.finishNavigation();
        this.deactivate();
        this.space.workspace.activate(global.get_current_time());
    }

    activate() {
        if (this.onlyOnPrimary || Main.overview.visible)
            return;

        let spaces = Tiling.spaces;
        let active = global.workspace_manager.get_active_workspace();
        let monitor = this.monitor;
        // Never activate the clickoverlay of the active monitor
        if (spaces && spaces.monitors.get(monitor) === spaces.get(active))
            return;

        this.active = true;
        this.enterMonitor.set_position(monitor.x, monitor.y);
        this.enterMonitor.set_size(monitor.width, monitor.height);
    }

    deactivate() {
        this.active = false;
        this.enterMonitor.set_size(0, 0);
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
        Utils.timeout_remove(this._lastPointerTimeout);
        this._lastPointerTimeout = null;
        this.signals.destroy();
        this.signals = null;
        for (let overlay of [this.left, this.right]) {
            let actor = overlay.overlay;
            overlay.signals.destroy();
            overlay.signals = null;
            if (overlay.clone) {
                overlay.clone.destroy();
                overlay.clone = null;
            }
            actor.destroy();
            overlay.removeBarrier();
        }
        Main.layoutManager.untrackChrome(this.enterMonitor);
        this.enterMonitor.destroy();
    }
};

var StackOverlay = class StackOverlay {
    constructor(direction, monitor) {
        this._direction = direction;

        let overlay = new Clutter.Actor({
            reactive: true,
            name: "stack-overlay",
        });

        // Uncomment to debug the overlays
        // overlay.background_color = Clutter.color_from_string('green')[1];
        // overlay.opacity = 100;

        this.monitor = monitor;
        let panelBox = Main.layoutManager.panelBox;
        overlay.y = monitor.y + panelBox.height + Settings.prefs.vertical_margin;
        overlay.height = this.monitor.height - panelBox.height - Settings.prefs.vertical_margin;
        overlay.width = Tiling.stack_margin;

        this.signals = new Utils.Signals();

        this.triggerPreviewTimeout = null;
        this.signals.connect(overlay, 'button-press-event', () => {
            Main.activateWindow(this.target);
            // remove/cleanup the previous preview
            this.removePreview();
            this.triggerPreviewTimeout = Mainloop.timeout_add(200, () => {
                // if pointer is still at edge (within 2px), trigger preview
                let [x, y, mask] = global.get_pointer();
                if (x <= 2 || x >= this.monitor.width - 2) {
                    this.triggerPreview.bind(this)();
                }
                this.triggerPreviewTimeout = null;
                return false; // on return false destroys timeout
            });
        });

        let gsettings = ExtensionUtils.getSettings();
        this.signals.connect(overlay, 'enter-event', this.triggerPreview.bind(this));
        this.signals.connect(overlay, 'leave-event', this.removePreview.bind(this));
        this.signals.connect(gsettings, 'changed::pressure-barrier',
            this.updateBarrier.bind(this, true));

        this.updateBarrier();

        global.window_group.add_child(overlay);
        Main.layoutManager.trackChrome(overlay);

        this.overlay = overlay;
        this.setTarget(null);
    }

    triggerPreview() {
        if ("_previewId" in this)
            return;
        if (!this.target)
            return;
        this._previewId = Mainloop.timeout_add(100, () => {
            delete this._previewId;
            this.removePreview();
            this.showPreview();
            this._previewId = null;
            return false; // on return false destroys timeout
        });

        // uncomment to remove the preview after a timeout
        /*
        this._removeId = Mainloop.timeout_add_seconds(2, () => {
            this.removePreview();
            this._removeId = null;
            return false; // on return false destroys timeout
        });
        */
    }

    removePreview() {
        if ("_previewId" in this) {
            Mainloop.source_remove(this._previewId);
            delete this._previewId;
        }
        if ("_removeId" in this) {
            Mainloop.source_remove(this._removeId);
            delete this._removeId;
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
        let [x, y, mask] = global.get_pointer();
        let actor = this.target.get_compositor_private();
        let clone = new Clutter.Clone({ source: actor });
        this.clone = clone;

        // Remove any window clips, and show the metaWindow.clone's
        actor.remove_clip();
        Tiling.animateWindow(this.target);

        // set clone parameters
        let scale = Settings.prefs.minimap_scale;
        clone.opacity = 255 * 0.95;

        clone.set_scale(scale, scale);
        Main.uiGroup.add_actor(clone);

        let monitor = this.monitor;
        let scaleWidth = scale * clone.width;
        let scaleHeight = scale * clone.height;
        if (this._direction === Meta.MotionDirection.RIGHT) {
            x = monitor.x + monitor.width - scaleWidth;
        }
        else {
            x = monitor.x;
        }

        // calculate y position - center of mouse
        y -= (scale * clone.height) / 2;

        // bound to remain within view
        let workArea = this.getWorkArea();
        y = Math.max(y, workArea.y);
        y = Math.min(y, workArea.y + workArea.height - scaleHeight);

        clone.set_position(x, y);
    }

    removeBarrier() {
        if (this.barrier) {
            if (this.pressureBarrier)
                this.pressureBarrier.removeBarrier(this.barrier);
            this.barrier.destroy();
            this.pressureBarrier.destroy();
            this.barrier = null;
        }
        this._removeBarrierTimeoutId = null;
    }

    updateBarrier(force) {
        if (force)
            this.removeBarrier();

        if (this.barrier || !Settings.prefs.pressure_barrier)
            return;

        this.pressureBarrier = new Layout.PressureBarrier(100, 0.25 * 1000, Shell.ActionMode.NORMAL);
        // Show the overlay on fullscreen windows when applying pressure to the edge
        // The above leave-event handler will take care of hiding the overlay
        this.pressureBarrier.connect('trigger', () => {
            this.pressureBarrier._reset();
            this.pressureBarrier._isTriggered = false;
            if (this._removeBarrierTimeoutId) {
                Mainloop.source_remove(this._removeBarrierTimeoutId);
            }
            this._removeBarrierTimeoutId = Mainloop.timeout_add(100, () => {
                this.removeBarrier();
                this._removeBarrierTimeoutId = null;
                return false;
            });
            overlay.show();
        });

        const overlay = this.overlay;
        let workArea = this.getWorkArea();
        let monitor = this.monitor;
        let x1, directions;
        if (this._direction === Meta.MotionDirection.LEFT) {
            x1 = monitor.x;
            directions = Meta.BarrierDirection.POSITIVE_X;
        } else {
            x1 = monitor.x + monitor.width - 1;
            directions = Meta.BarrierDirection.NEGATIVE_X;
        }
        this.barrier = new Meta.Barrier({
            display: global.display,
            x1, x2: x1,
            y1: workArea.y + 1,
            y2: workArea.y + workArea.height - 1,
            directions,
        });
        this.pressureBarrier.addBarrier(this.barrier);
    }

    setTarget(space, index) {
        this.removePreview();

        let bail = () => {
            this.target = null;
            this.overlay.width = 0;
            this.removeBarrier();
            return false;
        };

        if (space === null || Tiling.inPreview) {
            // No target. Eg. if we're at the left- or right-most window
            return bail();
        }

        let mru = global.display.get_tab_list(Meta.TabList.NORMAL_ALL,
            space.workspace);
        let column = space[index];
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
            let column = space[space.indexOf(metaWindow) - 1];
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
        this.updateBarrier();

        return true;
    }

    destroy() {
        Utils.timeout_remove(this._removeBarrierTimeoutId);
        this._removeBarrierTimeoutId = null;
        Utils.timeout_remove(this.triggerPreviewTimeout);
        this.triggerPreviewTimeout = null;

        this.signals.destroy();
        this.signals = null;
        this.removePreview();
        this.removeBarrier();
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
};
