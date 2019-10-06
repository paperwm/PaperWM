var Extension = imports.misc.extensionUtils.extensions['paperwm@hedning:matrix.org'];
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
function enable() {
    // Touchpad swipes only works in Wayland
    if (!Meta.is_wayland_compositor())
        return;

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
            event.get_touchpad_gesture_finger_count() > 3 ||
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
                updateVertical(-dy*prefs.swipe_sensitivity[1], event.get_time());
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        case Clutter.TouchpadGesturePhase.BEGIN:
            time = event.get_time();
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
function horizontalScroll(actor, event) {
    if (event.type() !== Clutter.EventType.TOUCHPAD_SWIPE ||
        event.get_touchpad_gesture_finger_count() > 3) {
        return Clutter.EVENT_PROPAGATE;
    }
    const phase = event.get_gesture_phase();
    switch (phase) {
    case Clutter.TouchpadGesturePhase.UPDATE:
        let [dx, dy] = event.get_gesture_motion_delta();
        if (direction === undefined) {
            this.vx = 0;
            this.hState = phase;
            Tweener.removeTweens(this.cloneContainer);
            direction = DIRECTIONS.Horizontal;
        }
        return update(this, -dx*prefs.swipe_sensitivity[0], event.get_time());
    case Clutter.TouchpadGesturePhase.CANCEL:
    case Clutter.TouchpadGesturePhase.END:
        this.hState = phase;
        return done(this);
    }
}

function update(space, dx, t) {

    let v = dx/(t - time);
    if (Number.isFinite(v)) {
        space.vx = v;
    }
    time = t;
    space.targetX -= dx;
    space.cloneContainer.x = space.targetX;
    return Clutter.EVENT_STOP;
}

function done(space) {
    if (!Number.isFinite(space.vx)) {
        navigator.finish();
        space.hState = -1;
        return Clutter.EVENT_STOP;
    }
    let test = space.vx > 0 ?
        () => space.vx < 0 :
        () => space.vx > 0;

    // Only snap to the edges if we started gliding when the viewport is fully covered
    let snap = !(0 <= space.cloneContainer.x ||
                 space.targetX + space.cloneContainer.width <= space.width);

    let glide = () => {
        if (space.hState === -1) {
            focusWindowAtPointer(space);
        }
        if (space.hState < Clutter.TouchpadGesturePhase.END)
            return false;

        if (test() ||
            (snap && (space.targetX > 0 ||
                      space.targetX + space.cloneContainer.width < space.width)) ||
            space.targetX > space.width ||
            space.targetX + space.cloneContainer.width < 0
           ) {
            focusWindowAtPointer(space, snap);
            space.cloneContainer.set_scale(1, 1);
            return false;
        }
        let dx = space.vx*16;
        space.targetX -= dx;
        space.cloneContainer.x = space.targetX;
        space.vx = space.vx + (space.vx > 0 ? -0.2 : 0.2);
        return true;
    };

    imports.mainloop.timeout_add(16, glide, 0);
    return Clutter.EVENT_STOP;
}

function focusWindowAtPointer(space, snap) {
    let [aX, aY, mask] = global.get_pointer();
    let [ok, x, y] = space.actor.transform_stage_point(aX, aY);
    space.targetX = Math.round(space.targetX);
    space.cloneContainer.x = space.targetX;

    let selected = space.selectedWindow.clone;
    if (!(selected.x + space.targetX >= 0 &&
          selected.x + selected.width + space.targetX <= space.width)) {
        selected = false;
    }

    let pointerAt;
    let gap = prefs.window_gap/2;
    for (let w of space.getWindows()) {
        let clone = w.clone;
        if (clone.x + space.targetX - gap <= x
            && x <= clone.x + space.targetX + clone.width + gap) {
            pointerAt = w;
            break;
        }
    }

    let first, last;
    if (space.cloneContainer.width < space.width) {
        space.layout();
    } else if (0 <= space.cloneContainer.x && snap) {
        first = space[0][0];
        Tiling.move_to(space, first, {x: 0});
    } else if (space.targetX + space.cloneContainer.width <= space.width && snap) {
        last = space[space.length-1][0];
        Tiling.move_to(space, last, {x: space.width - last.clone.width});
    }

    let target = selected || pointerAt || last || first;
    Tiling.ensureViewport(target, space);
    if (!Tiling.inPreview)
        Navigator.getNavigator().finish();
}

var transition = 'easeOutQuad';
function updateVertical(dy, t) {
    if (!Tiling.inPreview) {
        Tiling.spaces._initWorkspaceStack();
    }
    let selected = Tiling.spaces.selectedSpace;
    let monitor = navigator.monitor;
    let v = dy/(t - time);
    const StackPositions = Tiling.StackPositions;
    if (dy > 0
        && selected !== navigator.from
        && (selected.actor.y - dy < StackPositions.up*monitor.height)
       ) {
        dy = 0;
        vy = 1;
        selected.actor.y = StackPositions.up*selected.height;
        Tiling.spaces.selectSpace(Meta.MotionDirection.UP, false, transition);
        selected = Tiling.spaces.selectedSpace;
        Tweener.removeTweens(selected.actor);
        Tweener.addTween(selected.actor, {scale_x: 0.9, scale_y: 0.9, time:
                                          prefs.animation_time, transition});
    } else if (dy < 0
               && (selected.actor.y - dy > StackPositions.down*monitor.height)) {
        dy = 0;
        vy = -1;
        selected.actor.y = StackPositions.down*selected.height;
        Tiling.spaces.selectSpace(Meta.MotionDirection.DOWN, false, transition);
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

        let friction = 0.05;
        let dy = vy*16;
        let v = vy;
        updateVertical(dy, time + 16);
        vy = vy + (v > 0 ? -0.1 : 0.1);
        return true; // repeat
    };

    imports.mainloop.timeout_add(16, glide, 0);
}
