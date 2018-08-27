var Extension = imports.misc.extensionUtils.extensions['paperwm@hedning:matrix.org'];
var Tiling = Extension.imports.tiling;
var Clutter = imports.gi.Clutter;
var Tweener = imports.ui.tweener;
var Lang = imports.lang;
var Main = imports.ui.main;
var Shell = imports.gi.Shell;
var Meta = imports.gi.Meta;
var utils = Extension.imports.utils;
var debug = utils.debug;
var Minimap = Extension.imports.minimap;

var prefs = Extension.imports.settings.prefs;

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

function createAppIcon(metaWindow, size) {
    let tracker = Shell.WindowTracker.get_default();
    let app = tracker.get_window_app(metaWindow);
    let appIcon = app ? app.create_icon_texture(size)
        : new St.Icon({ icon_name: 'icon-missing',
                        icon_size: size });
    appIcon.x_expand = appIcon.y_expand = true;
    appIcon.x_align = appIcon.y_align = Clutter.ActorAlign.END;

    return appIcon;
}

/**
 */
class ClickOverlay {
    constructor(monitor) {
        this.monitor = monitor;
        this.left = new StackOverlay(Meta.MotionDirection.LEFT, monitor);
        this.right = new StackOverlay(Meta.MotionDirection.RIGHT, monitor);

        let enterMonitor = new Clutter.Actor({reactive: true});
        this.enterMonitor = enterMonitor;
        enterMonitor.set_position(monitor.x, monitor.y);

        Main.uiGroup.add_actor(enterMonitor);
        Main.layoutManager.trackChrome(enterMonitor);

        this.signals = new utils.Signals();

        this.signals.connect(
            enterMonitor, 'enter-event',
            () => {
                this.deactivate();
                let space = Tiling.spaces.monitors.get(this.monitor);
                if (space.selectedWindow) {
                    space.workspace.activate_with_focus(
                        space.selectedWindow,
                        global.get_current_time());
                } else {
                    space.workspace.activate(global.get_current_time());
                }
                return Clutter.EVENT_STOP;
            }
        );

        this.signals.connect(Main.overview, 'showing', this.hide.bind(this));
        this.signals.connect(Main.overview, 'hidden', this.show.bind(this));
    }

    activate() {
        let monitor = this.monitor;
        this.enterMonitor.set_position(monitor.x, monitor.y);
        this.enterMonitor.set_size(monitor.width, monitor.height);
    }

    deactivate() {
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
        for (let overlay of [this.left, this.right]) {
            let actor = overlay.overlay;
            [overlay.pressId, overlay.releaseId, overlay.enterId,
             overlay.leaveId].forEach(id => actor.disconnect(id));
            if (overlay.clone)
                overlay.clone.destroy();
            actor.destroy();
        }
        this.signals.destroy();
        this.enterMonitor.destroy();
    }
}

var StackOverlay = new Lang.Class({
    Name: 'Stackoverlay',

    _init: function(direction, monitor) {

        this._direction = direction;

        let overlay = new Clutter.Actor({ reactive: true
                                          , name: "stack-overlay" });

        // Uncomment to debug the overlays
        // overlay.background_color = Clutter.color_from_string('green')[1];
        // overlay.opacity = 100;

        this.monitor = monitor;

        let panelBox = Main.layoutManager.panelBox;

        overlay.y = monitor.y + panelBox.height + prefs.vertical_margin;
        overlay.height = this.monitor.height - panelBox.height - prefs.vertical_margin;
        overlay.width = Tiling.stack_margin;

        this.pressId = overlay.connect('button-press-event', () => {
            Main.activateWindow(this.target);
            if (this.clone)
                this.clone.destroy();
            return true;
        });
        this.releaseId = overlay.connect('button-release-event', () => {
            return true;
        });

        this.enterId = overlay.connect('enter-event', () => {
            if (this.clone)
                this.clone.destroy();

            let [x, y, mask] = global.get_pointer();
            let actor = this.target.get_compositor_private();
            let clone = new Clutter.Clone({source: actor});
            let space = Tiling.spaces.spaceOfWindow(this.target);
            // Remove any window clips, and show the metaWindow.clone's
            space.startAnimate();

            this.clone = clone;
            clone.set_scale(0.15, 0.15);
            Main.uiGroup.add_actor(clone);

            if (this._direction === Meta.MotionDirection.RIGHT)
                x = monitor.x + monitor.width - clone.get_transformed_size()[0];
            else
                x = monitor.x;
            clone.set_position(x, y);
        });

        this.leaveId = overlay.connect('leave-event', () => {
            if (!this.clone)
                return;

            this.clone.destroy();
            delete this.clone;
            let space = Tiling.spaces.spaceOfWindow(this.target);
            // Show the WindowActors again and re-apply clipping
            space.moveDone();
        });

        Main.uiGroup.add_child(overlay);
        Main.layoutManager.trackChrome(overlay);

        this.overlay = overlay;
    },

    setTarget: function(space, index) {

        if (this.clone) {
            this.clone.destroy();
            delete this.clone;
        }

        let bail = () => {
            this.target = null;
            this.overlay.width = 0;
            return false;
        };

        if (space === null) {
            // No target. Eg. if we're at the left- or right-most window
            return bail();
        }

        let mru = global.display.get_tab_list(Meta.TabList.NORMAL,
                                              space.workspace);
        let column = space[index];
        this.target = mru.filter(w => column.includes(w))[0];
        let metaWindow = this.target;

        let overlay = this.overlay;
        let actor = metaWindow.get_compositor_private();

        overlay.y = this.monitor.y + Main.layoutManager.panelBox.height + prefs.vertical_margin;

        if (this._direction === Meta.MotionDirection.LEFT) {
            let column = space[space.indexOf(metaWindow) + 1];
            let neighbour = column && column[0];
            if (!neighbour)
                return bail(); // Should normally have a neighbour. Bail!

            let frame = neighbour.get_frame_rect();
            frame.x = neighbour.clone.targetX + space.targetX;
            let max = 75;
            let width = frame.x;
            if (space.isPlaceable(metaWindow))
                width = Math.min(width, 75);
            if (width > 75)
                width -= prefs.window_gap;
            overlay.x = this.monitor.x;
            overlay.width = width;
        } else {
            let column = space[space.indexOf(metaWindow) - 1];
            let neighbour = column && column[0];
            if (!neighbour)
                return bail(); // Should normally have a neighbour. Bail!

            let frame = neighbour.get_frame_rect();
            frame.x = neighbour.clone.targetX + space.targetX;
            let width = this.monitor.width - (frame.x + frame.width);
            if (space.isPlaceable(metaWindow))
                width = Math.min(width, 75);
            if (width > 75)
                width -= prefs.window_gap;
            overlay.x = this.monitor.x + this.monitor.width - width;
            overlay.width = width;
        }

        return true;
    },
});
