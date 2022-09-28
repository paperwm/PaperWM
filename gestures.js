var Extension;
if (imports.misc.extensionUtils.extensions) {
    Extension = imports.misc.extensionUtils.extensions["paperwm@hedning:matrix.org"];
} else {
    Extension = imports.ui.main.extensionManager.lookup("paperwm@hedning:matrix.org");
}

var gliding = false;

var Meta = imports.gi.Meta;
var St = imports.gi.St;
var Gio = imports.gi.Gio;
var PanelMenu = imports.ui.panelMenu;
var PopupMenu = imports.ui.popupMenu;
var Clutter = imports.gi.Clutter;
var Main = imports.ui.main;
var Shell = imports.gi.Shell;
var Tweener = Extension.imports.utils.tweener;

var Utils = Extension.imports.utils;
var Tiling = Extension.imports.tiling;
var Navigator = Extension.imports.navigator;
var prefs = Extension.imports.settings.prefs;

const stage = global.stage;

var signals;
function init() {
    signals = new Utils.Signals();
}

const DIRECTIONS = {
    Horizontal: true,
    Vertical: false,
}

var vy;
var time;
var vState;
var navigator;
var direction = undefined;
// 1 is natural scrolling, -1 is unnatural
var natural = 1;
function enable() {
    // Touchpad swipes only works in Wayland
    if (!Meta.is_wayland_compositor())
        return;

    var touchpadSettings = new Gio.Settings({
        schema_id: 'org.gnome.desktop.peripherals.touchpad'
    });

    signals.destroy();
    /**
       In order for the space.background actors to get any input we need to hide
       all the window actors from the stage.

       The stage takes care of scrolling vertically through the workspace mru.
       Delegating the horizontal scrolling to each space. This way vertical
       scrolling works anywhere, while horizontal scrolling is done on the space
       under the mouse cursor.
     */
    signals.connect(stage, 'captured-event', (actor, event) => {
        if (event.type() !== Clutter.EventType.TOUCHPAD_SWIPE ||
            event.get_touchpad_gesture_finger_count() < 3 ||
            (Main.actionMode & Shell.ActionMode.OVERVIEW) > 0) {
            return Clutter.EVENT_PROPAGATE;
        }
        const phase = event.get_gesture_phase();
        switch (phase) {
        case Clutter.TouchpadGesturePhase.UPDATE:
            if (direction === DIRECTIONS.Horizontal) {
                return Clutter.EVENT_PROPAGATE;
            }
            let [dx, dy] = event.get_gesture_motion_delta();
            if (direction === undefined) {
                if (Math.abs(dx) < Math.abs(dy)) {
                    vy = 0;
                    vState = phase;
                    direction = DIRECTIONS.Vertical;
                }
            }
            if (direction === DIRECTIONS.Vertical) {
                updateVertical(-dy*natural*prefs.swipe_sensitivity[1], event.get_time());
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        case Clutter.TouchpadGesturePhase.BEGIN:
            time = event.get_time();
            natural = touchpadSettings.get_boolean("natural-scroll") ? 1 : -1;
            direction = undefined;
            navigator = Navigator.getNavigator();
            navigator.connect('destroy', () => {
                vState = -1;
            });
            return Clutter.EVENT_STOP;
        case Clutter.TouchpadGesturePhase.CANCEL:
        case Clutter.TouchpadGesturePhase.END:
            if (direction === DIRECTIONS.Vertical) {
                vState = phase;
                endVertical();
                return Clutter.EVENT_STOP;
            }
        };
        return Clutter.EVENT_PROPAGATE;
    });
}

function disable() {
    signals.destroy();
}

/**
   Handle scrolling horizontally in a space. The handler is meant to be
   connected from each space.background and bound to the space.
 */
let start, dxs = [], dts = [];
function horizontalScroll(actor, event) {
    if (event.type() !== Clutter.EventType.TOUCHPAD_SWIPE ||
        event.get_touchpad_gesture_finger_count() < 3) {
        return Clutter.EVENT_PROPAGATE;
    }
    const phase = event.get_gesture_phase();
    switch (phase) {
    case Clutter.TouchpadGesturePhase.UPDATE:
        let [dx, dy] = event.get_gesture_motion_delta();
        if (direction === undefined) {
            this.vx = 0;
            dxs = [];
            dts = [];
            this.hState = phase;
            start = this.targetX;
            Tweener.removeTweens(this.cloneContainer);
            direction = DIRECTIONS.Horizontal;
        }
        return update(this, -dx*natural*prefs.swipe_sensitivity[0], event.get_time());
    case Clutter.TouchpadGesturePhase.CANCEL:
    case Clutter.TouchpadGesturePhase.END:
        this.hState = phase;
        done(this, event);
        dxs = [];
        dts = [];
        return Clutter.EVENT_STOP;
    }
}

let walk = 0;
let sdx = null;
function horizontalTouchScroll(actor, event) {
  const type = event.type()
  const [myx, myy] = event.get_coords();

  switch (type) {
    case Clutter.EventType.TOUCH_BEGIN:
      this.vx = 0;
      dxs = [];
      dts = [];
      sdx = myx;
      walk = 0;
      start = this.targetX;
      this.hState = Clutter.TouchpadGesturePhase.UPDATE;
      Tweener.removeTweens(this.cloneContainer);
      navigator = Navigator.getNavigator();
      direction = DIRECTIONS.Horizontal;
      update(this, 0, event.get_time());
      return Clutter.EVENT_PROPAGATE
    case Clutter.EventType.TOUCH_UPDATE:
      let dx = 0;
      if (sdx !== null) {
        dx = myx - sdx;
      }
      sdx = myx;
      walk = walk + Math.abs(dx);

      update(this, -dx, event.get_time() * .75)
      return Clutter.EVENT_PROPAGATE
    case Clutter.EventType.TOUCH_CANCEL:
    case Clutter.EventType.TOUCH_END:
      done(this, event);
      dxs = [];
      dts = [];
      sdx = null;
      walk = 0;
      this.hState = Clutter.TouchpadGesturePhase.END;
      if (walk < 20) return Clutter.EVENT_PROPAGATE; // Don't steal non-swipe events
      else return Clutter.EVENT_STOP;
  }
}

function update(space, dx, t) {

    dxs.push(dx);
    dts.push(t);

    space.cloneContainer.x -= dx;
    space.targetX = space.cloneContainer.x;

    // Check which target windew will be selected if we releas the swipe at this
    // moment
    dx = Utils.sum(dxs.slice(-3));
    let v = dx/(t - dts.slice(-3)[0]);
    if (Number.isFinite(v)) {
        space.vx = v;
    }

    let accel = prefs.swipe_friction[0]/16; // px/ms^2
    accel = space.vx > 0 ? -accel : accel;
    let duration = -space.vx/accel;
    let d = space.vx*duration + .5*accel*duration**2;
    let target = Math.round(space.targetX - d);

    space.targetX = target;
    let selected = findTargetWindow(space, direction, start - space.targetX > 0);
    space.targetX = space.cloneContainer.x;
    Tiling.updateSelection(space, selected);
    space.selectedWindow = selected;
    space.emit('select');

    return Clutter.EVENT_STOP;
}

function done(space) {
    if (!Number.isFinite(space.vx) || space.length === 0) {
        navigator.finish();
        space.hState = -1;
        return Clutter.EVENT_STOP;
    }

    let startGlide = space.targetX;

    // timetravel
    let accel = prefs.swipe_friction[0]/16; // px/ms^2
    accel = space.vx > 0 ? -accel : accel;
    let t = -space.vx/accel;
    let d = space.vx*t + .5*accel*t**2;
    let target = Math.round(space.targetX - d);

    let mode = Clutter.AnimationMode.EASE_OUT_QUAD;
    let first;
    let last;

    let full = space.cloneContainer.width > space.width;
    // Only snap to the edges if we started gliding when the viewport is fully covered
    let snap = !(0 <= space.targetX ||
                 space.targetX + space.cloneContainer.width <= space.width);
    if ((snap && target > 0)
        || (full && target > space.width*2)) {
        // Snap to left edge
        first = space[0][0];
        target = 0;
        mode = Clutter.AnimationMode.EASE_OUT_BACK;
    } else if ((snap && target + space.cloneContainer.width < space.width)
               || (full && target + space.cloneContainer.width < -space.width)) {
        // Snap to right edge
        last = space[space.length-1][0];
        target = space.width - space.cloneContainer.width;
        mode = Clutter.AnimationMode.EASE_OUT_BACK;
    }

    // Adjust for target window
    let selected;
    space.targetX = Math.round(target);
    selected = last || first || findTargetWindow(space, start - target > 0 );
    delete selected.lastFrame; // Invalidate frame information
    let x = Tiling.ensuredX(selected, space);
    target = x - selected.clone.targetX;

    // Scale down travel time if we've cut down the discance to travel
    let newD = Math.abs(startGlide - target);
    if (newD < Math.abs(d))
        t = t*Math.abs(newD/d);

    // Use a minimum duration if we've adjusted travel
    if (target !== space.targetX || mode === Clutter.AnimationMode.EASE_OUT_BACK) {
        t = Math.max(t, 200);
    }
    space.targetX = target;

    Tiling.updateSelection(space, selected);
    space.selectedWindow = selected;
    space.emit('select');
    gliding = true;
    Tweener.addTween(space.cloneContainer, {
        x: space.targetX,
        duration: t,
        mode,
        onStopped: () => {
            gliding = false;
        },
        onComplete: () => {
            if (!Tiling.inPreview)
                Navigator.getNavigator().finish();
        }
    });
}


function findTargetWindow(space, direction) {
    let selected = space.selectedWindow.clone;
    if (selected.x + space.targetX >= 0 &&
          selected.x + selected.width + space.targetX <= space.width) {
        return selected.meta_window;
    }
    selected = selected && space.selectedWindow;
    let workArea = space.workArea();
    let min = workArea.x;

    let windows = space.getWindows().filter(w => {
        let  clone = w.clone;
        let x = clone.targetX + space.targetX;
        return !(x + clone.width < min
                 || x > min + workArea.width);
    });
    if (!direction) // scroll left
        windows.reverse();
    let visible = windows.filter(w => {
        let clone = w.clone;
        let x = clone.targetX + space.targetX;
        return x >= 0 &&
            x + clone.width <= min + workArea.width;
    });
    if (visible.length > 0) {
        return visible[0];
    }

    if (windows.length === 0) {
        let first = space.getWindow(0, 0);
        let last = space.getWindow(space.length - 1, 0);
        if (direction) {
            return last;
        } else {
            return first;
        }
    }

    if (windows.length === 1)
        return windows[0];

    let closest = windows[0].clone;
    let next = windows[1].clone;
    let r1, r2;
    if (direction) { // ->
        r1 = Math.abs(closest.targetX + closest.width + space.targetX)/closest.width;
        r2 = Math.abs(next.targetX + space.targetX - space.width)/next.width;
    } else {
        r1 = Math.abs(closest.targetX + space.targetX - space.width)/closest.width;
        r2 = Math.abs(next.targetX + next.width + space.targetX)/next.width;
    }
    // Choose the window the most visible width (as a ratio)
    if (r1 > r2)
        return closest.meta_window;
    else
        return next.meta_window;
}

var transition = 'easeOutQuad';
function updateVertical(dy, t) {
    if (!Tiling.inPreview) {
        Tiling.spaces._initWorkspaceStack();
    }
    let selected = Tiling.spaces.selectedSpace;
    let monitor = navigator.monitor;
    let v = dy/(t - time);
    time = t;
    const StackPositions = Tiling.StackPositions;
    if (dy > 0
        && selected !== navigator.from
        && (selected.actor.y - dy < StackPositions.up*monitor.height)
       ) {
        dy = 0;
        vy = 1;
        selected.actor.y = StackPositions.up*selected.height;
        Tiling.spaces.selectStackSpace(Meta.MotionDirection.UP, false, transition);
        selected = Tiling.spaces.selectedSpace;
        Tweener.removeTweens(selected.actor);
        Tweener.addTween(selected.actor, {scale_x: 0.9, scale_y: 0.9, time:
                                          prefs.animation_time, transition});
    } else if (dy < 0
               && (selected.actor.y - dy > StackPositions.down*monitor.height)) {
        dy = 0;
        vy = -1;
        selected.actor.y = StackPositions.down*selected.height;
        Tiling.spaces.selectStackSpace(Meta.MotionDirection.DOWN, false, transition);
        selected = Tiling.spaces.selectedSpace;
        Tweener.removeTweens(selected.actor);
        Tweener.addTween(selected.actor, {scale_x: 0.9, scale_y: 0.9, time:
                                          prefs.animation_time, transition});
    } else if (Number.isFinite(v)) {
        vy = v;
    }

    selected.actor.y -= dy;
    if (selected === navigator.from) {
        let scale = 0.90;
        let s = 1 - (1 - scale)*(selected.actor.y/(0.1*monitor.height));
        s = Math.max(s, scale);
        Tweener.removeTweens(selected.actor);
        selected.actor.set_scale(s, s);
    }
}

function endVertical() {
    let test = vy > 0 ?
        () => vy < 0 :
        () => vy > 0;

    let glide = () => {
        if (vState < Clutter.TouchpadGesturePhase.END)
            return false;

        if (!Number.isFinite(vy)) {
            return false;
        }

        let selected = Tiling.spaces.selectedSpace;
        let y = selected.actor.y;
        if (selected === navigator.from && y <= 0.1*selected.height) {
            navigator.finish();
            return false;
        }

        if (test()) {
            return false;
        }

        let dy = vy*16;
        let v = vy;
        let accel = prefs.swipe_friction[1];
        accel = v > 0 ? -accel : accel;
        updateVertical(dy, time + 16);
        vy = vy + accel;
        return true; // repeat
    };

    imports.mainloop.timeout_add(16, glide, 0);
}
