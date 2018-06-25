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

var prefs = Extension.imports.prefs.prefs;

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

        this.enterSignal = enterMonitor.connect(
            'enter-event', () => {
                this.deactivate();
                let space = Tiling.spaces.monitors.get(this.monitor);
                space.workspace.activate(global.get_current_time());
                return Clutter.EVENT_STOP;
            }
        );
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
        this.enterMonitor.disconnect(this.enterSignal);
        this.enterMonitor.destroy();
    }
}

var StackOverlay = new Lang.Class({
    Name: 'Stackoverlay',

    _init: function(direction, monitor, showIcon) {
        this.showIcon = showIcon;

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
            // this.fadeOut();
            return true;
        });

        this.enterId = overlay.connect('enter-event', () => {
            if (this.clone)
                this.clone.destroy();

            let [x, y, mask] = global.get_pointer();
            let clone = new Clutter.Clone({
                source: this.target.get_compositor_private()});
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
            this.clone.destroy();
        });

        global.window_group.add_child(overlay);
        Main.layoutManager.trackChrome(overlay);

        this.overlay = overlay;
    },
    updateIcon: function() {
        if (this.icon) {
            this.icon.destroy();
            this.icon = null;
        }

        let iconMarginX = 2;
        let iconSize = horizontal_margin;
        let icon = createAppIcon(this.target, iconSize);
        this.icon = icon;

        let actor = this.target.get_compositor_private();

        if (actor.x <= Tiling.stack_margin) {
            icon.x = iconMarginX;
        } else {
            icon.x = this.overlay.width - iconMarginX - iconSize; 
        }

        let [dx, dy] = Minimap.calcOffset(this.target);
        icon.y = actor.y + dy + 4 - this.overlay.y;

        this.overlay.add_child(icon);
    },
    setTarget: function(space, index) {

        let bail = () => {
            this.target = null;
            this.overlay.width = 0;
            return false;
        }

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
            let max = 75;
            let width = frame.x - this.monitor.x;
            if (space.visible.includes(metaWindow))
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
            let width = (this.monitor.x + this.monitor.width) - (frame.x + frame.width);
            if (space.visible.includes(metaWindow))
                width = Math.min(width, 75);
            if (width > 75)
                width -= prefs.window_gap;
            overlay.x = this.monitor.x + this.monitor.width - width;
            overlay.width = width;
        }

        if (this.showIcon) {
            this.updateIcon();
        }

        global.window_group.set_child_above_sibling(overlay, actor);

        // Tweener.addTween(this.overlay, { opacity: 255, time: 0.25 });
        return true;
    },
    fadeOut: function() {
        Tweener.addTween(this.overlay, { opacity: 0, time: 0.25 });
    }
});
