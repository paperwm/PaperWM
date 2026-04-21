import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Ripples from 'resource:///org/gnome/shell/ui/ripples.js';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';

import { Lib } from './imports.js';

const Display = global.display;
export let version = Config.PACKAGE_VERSION.split('.').map(Number);

let warpRipple;

let signals, touchCoords;
let inTouch = false;

export function enable() {
    warpRipple = new Ripples.Ripples(0.5, 0.5, 'ripple-pointer-location');
    warpRipple.addTo(Main.uiGroup);

    signals = new Signals();
    signals.connect(global.stage, "touch-event", (_actor, event) => {
        switch (event.type()) {
        case Clutter.EventType.TOUCH_BEGIN:
        case Clutter.EventType.TOUCH_UPDATE:
            inTouch = true;
            break;
        case Clutter.EventType.TOUCH_END:
        case Clutter.EventType.TOUCH_CANCEL:
            inTouch = false;
            break;
        default:
            return Clutter.EVENT_PROPAGATE;
        }

        // was one of our touch events
        touchCoords = event.get_coords();
        return Clutter.EVENT_PROPAGATE;
    });
}

export function disable() {
    warpRipple?.destroy();
    warpRipple = null;
    markNewClonesSignalId = null;

    signals.destroy();
    signals = null;
}

export function assert(condition, message, ...dump) {
    if (!condition) {
        throw new Error(`${message}\n`, dump);
    }
}

export function print_stacktrace(error) {
    let trace;
    if (!error) {
        trace = new Error().stack.split("\n");
        // Remove _this_ frame
        trace.splice(0, 1);
    } else {
        trace = error.stack.split("\n");
    }
    console.error(`JS ERROR: ${error}\n ${trace.join('\n')}`);
}

/**
 * Pretty prints args using JSON.stringify.
 * @param  {...any} arugs
 */
export function prettyPrintToLog(...args) {
    console.log(args.map(v => JSON.stringify(v, null), 2));
}

export function framestr(rect) {
    return `[ x:${rect.x}, y:${rect.y} w:${rect.width} h:${rect.height} ]`;
}

export function isPointInsideActor(actor, x, y) {
    return (actor.x <= x && x <= actor.x + actor.width) &&
        (actor.y <= y && y <= actor.y + actor.height);
}

export function setBackgroundImage(actor, resource_path) {
    // resource://{resource_path}
    let image = new Clutter.Image();

    let pixbuf = GdkPixbuf.Pixbuf.new_from_resource(resource_path);

    image.set_data(pixbuf.get_pixels(),
        pixbuf.get_has_alpha() ? Cogl.PixelFormat.RGBA_8888
            : Cogl.PixelFormat.RGB_888,
        pixbuf.get_width(),
        pixbuf.get_height(),
        pixbuf.get_rowstride());
    actor.set_content(image);
    actor.content_repeat = Clutter.ContentRepeat.BOTH;
}

/**
 * Internal mode tracking for ActionDispatcher.
 * Tracks whether the dispatcher was requested for keyboard, pointer, or both.
 * Replaces the removed Clutter.GrabState enum (GNOME 50+).
 */
export const DispatcherMode = { NONE: 0, POINTER: 1, KEYBOARD: 2 };

export function is_wayland_compositor() {
    if (typeof Meta.is_wayland_compositor === 'function')
        return Meta.is_wayland_compositor()

    return true // GNOME 50+ is always a Wayland compositor
}

/**
 * Backwards compatible function.  Attempts to use Cogl.Color with a fallback
 * to Clutter.Color.
 * @param {String} colorString
 */
export function color_from_string(colorString) {
    try {
        // Gnome 47+ merged Clutter.Color into Cogl.Color
        return Cogl.Color.from_string(colorString);
    } catch (error) {
        // fallback for Gnome 45, 46
        return Clutter.Color.from_string(colorString);
    }
}


// // Debug and development utils

/**
 * Visualize the frame and buffer bounding boxes of a meta window
 */
export function toggleWindowBoxes(metaWindow) {
    metaWindow = metaWindow || Display.focus_window;

    if (metaWindow._paperDebugBoxes) {
        metaWindow._paperDebugBoxes.forEach(box => {
            box.destroy();
        });
        delete metaWindow._paperDebugBoxes;
        return [];
    }

    const frame = metaWindow.get_frame_rect();
    const inputFrame = metaWindow.get_buffer_rect();
    const actor = metaWindow.get_compositor_private();

    const makeFrameBox = ({ x, y, width, height }, color)  => {
        let frameBox = new St.Widget();
        frameBox.set_position(x, y);
        frameBox.set_size(width, height);
        frameBox.set_style(`border: 2px${color} solid`);
        return frameBox;
    };

    const boxes = [];
    boxes.push(makeFrameBox(frame, "red"));
    boxes.push(makeFrameBox(inputFrame, "blue"));

    if (inputFrame.x !== actor.x || inputFrame.y !== actor.y ||
       inputFrame.width !== actor.width || inputFrame.height !== actor.height) {
        boxes.push(makeFrameBox(actor, "yellow"));
    }

    boxes.forEach(box => global.stage.add_child(box));
    metaWindow._paperDebugBoxes = boxes;
    return boxes;
}

let markNewClonesSignalId = null;
export function toggleCloneMarks() {
    // NB: doesn't clean up signal on disable

    function markCloneOf(metaWindow) {
        if (metaWindow.clone) {
            metaWindow.clone.opacity = 190;
            metaWindow.clone.__oldOpacity = 190;
            metaWindow.clone.background_color = color_from_string("red")[1];
        }
    }
    function unmarkCloneOf(metaWindow) {
        if (metaWindow.clone) {
            metaWindow.clone.opacity = 255;
            metaWindow.clone.__oldOpacity = 255;
            metaWindow.clone.background_color = null;
        }
    }

    let windows = Display.get_tab_list(Meta.TabList.NORMAL_ALL, null);

    if (markNewClonesSignalId) {
        Display.disconnect(markNewClonesSignalId);
        markNewClonesSignalId = null;
        windows.forEach(unmarkCloneOf);
    } else {
        markNewClonesSignalId = Display.connect_after(
            "window-created", (_, mw) => markCloneOf(mw));

        windows.forEach(markCloneOf);
    }
}

export function isInRect(x, y, r) {
    return r.x <= x && x < r.x + r.width &&
        r.y <= y && y < r.y + r.height;
}

/**
 * Retrieves global pointer coordinates taking into account touch screen events.
 * May not work for continuous tracking, see #766.
 */
export function getPointerCoords() {
    if (inTouch) {
        return touchCoords;
    } else {
        return global.get_pointer();
    }
}

/**
 * Returns monitor a pointer co-ordinates.
 */
export function monitorAtPoint(gx, gy) {
    for (let monitor of Main.layoutManager.monitors) {
        if (isInRect(gx, gy, monitor))
            return monitor;
    }
    return null;
}

/**
 * Returns the monitor current pointer coordinates.
 */
export function monitorAtCurrentPoint() {
    const [gx, gy] = getPointerCoords();
    return monitorAtPoint(gx, gy);
}

/**
 * Warps pointer to the center of a monitor.
 */
export function warpPointerToMonitor(monitor, params = { center: false, ripple: true }) {
    const center = params?.center ?? false;
    const ripple = params?.ripple ?? true;

    // no need to warp if already on this monitor
    let currMonitor = monitorAtCurrentPoint();
    if (currMonitor === monitor) {
        return;
    }

    let [x, y] = global.get_pointer();
    if (center) {
        x -= monitor.x;
        y -= monitor.y;
        warpPointer(
            monitor.x + Math.floor(monitor.width / 2),
            monitor.y + Math.floor(monitor.height / 2),
            ripple);
        return;
    }

    let proportionalX = (x - currMonitor.x) / currMonitor.width;
    let proportionalY = (y - currMonitor.y) / currMonitor.height;
    warpPointer(
        monitor.x + Math.floor(proportionalX * monitor.width),
        monitor.y + Math.floor(proportionalY * monitor.height),
        ripple
    );
}

/**
 * Warps pointer to x, y coordinates.
 * Optionally shows a ripple effect after warp.
 */
export function warpPointer(x, y, ripple = true) {
    const seat = Clutter.get_default_backend().get_default_seat();
    seat.warp_pointer(x, y);
    if (ripple) {
        warpRipple.playAnimation(x, y);
    }
}

/**
 * Return current modifiers state (or'ed Clutter.ModifierType.*)
 */
export function getModiferState() {
    let [, , mods] = global.get_pointer();
    return mods;
}

export function monitorOfPoint(x, y) {
    // get_monitor_index_for_rect "helpfully" returns the primary monitor index for out of bounds rects..
    for (let monitor of Main.layoutManager.monitors) {
        if ((monitor.x <= x && x <= monitor.x + monitor.width) &&
            (monitor.y <= y && y <= monitor.y + monitor.height))
        {
            return monitor;
        }
    }

    return null;
}

export function mkFmt({ nameOnly } = { nameOnly: false }) {
    function defaultFmt(actor, prefix = "") {
        const fmtNum = num => num.toFixed(0);
        let extra = [
            `${actor.get_position().map(fmtNum)}`,
            `${actor.get_size().map(fmtNum)}`,
        ];
        let metaWindow = actor.meta_window || actor.metaWindow;
        if (metaWindow) {
            metaWindow = `(mw: ${metaWindow.title})`;
            extra.push(metaWindow);
        }
        const extraStr = extra.join(" | ");
        let actorId = "";
        if (nameOnly) {
            // eslint-disable-next-line no-nested-ternary, eqeqeq
            actorId = actor.name ? actor.name : prefix.length == 0 ? "" : "#";
        } else {
            actorId = actor.toString();
        }
        actorId = prefix + actorId;
        let spacing = actorId.length > 0 ? " " : "";
        return `*${spacing}${actorId} ${extraStr}`;
    }
    return defaultFmt;
}

export function printActorTree(node, fmt = mkFmt(), options = {}, state = null) {
    state = Object.assign({}, state || { level: 0, actorPrefix: "" });
    const defaultOptions = {
        limit: 9999,
        collapseChains: true,
    };
    options = Object.assign(defaultOptions, options);

    if (state.level > options.limit) {
        return;
    }
    let collapse = false;
    if (options.collapseChains) {
        /*
          a
            b
              s
              t
            c 30,10
              u
          ->
          a.b.s
          a.b.t
          a.b.c ...
            u
        */
        if (node.get_children().length > 0) {
            if (node.x === 0 && node.y === 0) {
                state.actorPrefix += `${node.name ? node.name : "#"}.`;
                collapse = true;
            } else {
                collapse = false;
            }
        } else {
            collapse = false;
        }
    }
    if (!collapse) {
        console.debug(Lib.indent(state.level, fmt(node, state.actorPrefix)));
        state.actorPrefix = "";
        state.level += 1;
    }

    for (let child of node.get_children()) {
        printActorTree(child, fmt, options, state);
    }
}

export function isMetaWindow(obj) {
    return obj && obj.window_type && obj.get_compositor_private;
}

export function actor_raise(actor, above) {
    const parent = actor.get_parent();
    if (!parent) {
        return;
    }
    // needs to be null (not undefined) for valid second argument
    above = above ?? null;
    parent.set_child_above_sibling(actor, above);
}

export function actor_reparent(actor, newParent) {
    actor_remove_parent(actor);
    newParent.add_child(actor);
}

/**
 * Removes a child from a parent actor.  Checks child
 * exists in parent first.
 * @param {Clutter.Actor} parent
 * @param {Clutter.Actor} child
 */
export function actor_remove_child(parent, child) {
    if (parent.get_children().includes(child)) {
        parent.remove_child(child);
    }
}

/**
 * Removes the parent from this actor (if it has one).
 * @param {Clutter.Actor} actor
 */
export function actor_remove_parent(actor) {
    const parent = actor.get_parent();
    if (parent) {
        parent.remove_child(actor);
    }
}

/**
 * Adds a child from a parent actor.  Checks child if is already
 * attached.
 * @param {Clutter.Actor} parent
 * @param {Clutter.Actor} child
 */
export function actor_add_child(parent, child) {
    // check if already a child of this parent
    if (parent.get_children().includes(child)) {
        return;
    }

    actor_remove_parent(child);
    parent.add_child(child);
}

/**
 * Backwards compatible later_add function.
 */
export function later_add(...args) {
    global.compositor.get_laters().add(...args);
}

/**
 * Backwards compatible Display.grab_accelerator function.
 */
export function grab_accelerator(keystr, keyBindingFlags = Meta.KeyBindingFlags.NONE) {
    if (Display.grab_accelerator.length > 1) {
        return Display.grab_accelerator(keystr, keyBindingFlags);
    } else  {
        return Display.grab_accelerator(keystr);
    }
}

/**
 * Convenience method for removing timeout source(s) from Mainloop.
 */
export function timeout_remove(...timeouts) {
    timeouts.forEach(t => {
        if (t) {
            GLib.source_remove(t);
        }
    });
}

/**
 * Calls a period timeout (GLib.timeout_add) that calls a callback function.
 * Also contains parameters for init (call for initialisation), onContinue (callback when continuing),
 * onComplete (callback when completed last callback).
 * @param {Object} options
 * @param {Number} options.period_ms
 * @param {Number} options.count
 * @param {Function} options.init
 * @param {Function} options.callback
 * @param {Function} options.onContinue
 * @param {Function} options.onComplete
 * @returns GLib timeout id
 */
export function periodic_timeout(options = { }) {
    const operiod = options?.period_ms ?? 1000;
    const ocount = options?.count ?? 1;
    const oinit = options?.init ?? function() {};
    const ocallback = options?.callback ?? function() {};
    const ocontinue = options?.onContinue ?? function() {};
    const ocomplete = options?.onComplete ?? function() {};

    oinit();
    let called = 0;
    return GLib.timeout_add(
        GLib.PRIORITY_DEFAULT,
        operiod,
        () => {
            // check for early exit (if callback returns false)
            if (ocallback() === false) {
                ocomplete();
                return false;
            }

            if (called < ocount) {
                called++;
                ocontinue(called);
                return true;
            }

            ocomplete();
            return false; // on return false destroys timeout
        });
}

export class Signals extends Map {
    static get [Symbol.species]() { return Map; }

    _getOrCreateSignals(object) {
        let signals = this.get(object);
        if (!signals) {
            signals = [];
            this.set(object, signals);
        }
        return signals;
    }

    connectOneShot(object, signal, handler) {
        let id = this.connect(object, signal, (...args) => {
            this.disconnect(object, id);
            return handler(...args);
        });
    }

    connect(object, signal, handler) {
        let id = object.connect(signal, handler);
        let signals = this._getOrCreateSignals(object);
        signals.push(id);
        return id;
    }

    disconnect(object, id = null) {
        let ids = this.get(object);
        if (ids) {
            if (id === null) {
                ids.forEach(id => object.disconnect(id));
                ids = [];
            } else {
                object.disconnect(id);
                let i = ids.indexOf(id);
                if (i > -1) {
                    ids.splice(i, 1);
                }
            }
            if (ids.length === 0)
                this.delete(object);
        }
    }

    destroy() {
        for (let [object, signals] of this) {
            signals.forEach(id => object.disconnect(id));
            this.delete(object);
        }
    }
}

/**
 * Note the name 'Tweener' used previously was just a legacy name, we're actually using
 * Widget.ease here.  This was renamed to avoid confusion with the deprecated `Tweener`
 * module.
 */
export let Easer = {
    /**
     * Safer time setting to essentiall disable easer animation.
     * Setting to values lower than this can have some side-effects
     * like "jumpy" three-finger left/right swiping etc.
     */
    ANIMATION_SAFE_TIME: 0.03,

    /**
     * Can set animation to instant time.  Used for to override animation
     * time to effectively "disable" an animation.  Setting to 0 can have
     * some side-effects and cause race aconditions
     */
    ANIMATION_INSTANT_TIME: 0.0001,

    addEase(actor, params) {
        if (params.time) {
            params.duration = this._safeDuration(params.time, params.instant);
            delete params.time;
        }

        if (!params.mode) {
            params.mode = Clutter.AnimationMode.EASE_IN_OUT_QUAD;
        }

        actor.ease(params);
    },

    /**
     * Returns a safe animation time to avoid timing
     * race conditions etc.
     */
    _safeDuration(time, instant) {
        let duration = Math.max(time, this.ANIMATION_SAFE_TIME);
        if (instant === true) {
            duration = this.ANIMATION_INSTANT_TIME;
        }

        return duration * 1000;
    },

    removeEase(actor) {
        actor.remove_all_transitions();
    },

    isEasing(actor) {
        return actor.get_transition('x') ||
        actor.get_transition('y') ||
        actor.get_transition('scale-x') ||
        actor.get_transition('scale-x');
    },
};

export class DisplayConfig {
    static get proxyWrapper() {
        return Gio.DBusProxy.makeProxyWrapper('<node>\
        <interface name="org.gnome.Mutter.DisplayConfig">\
            <method name="GetCurrentState">\
            <arg name="serial" direction="out" type="u" />\
            <arg name="monitors" direction="out" type="a((ssss)a(siiddada{sv})a{sv})" />\
            <arg name="logical_monitors" direction="out" type="a(iiduba(ssss)a{sv})" />\
            <arg name="properties" direction="out" type="a{sv}" />\
            </method>\
            <signal name="MonitorsChanged" />\
        </interface>\
    </node>');
    }

    constructor() {
        this.proxy = new DisplayConfig.proxyWrapper(
            Gio.DBus.session,
            'org.gnome.Mutter.DisplayConfig',
            '/org/gnome/Mutter/DisplayConfig',
            (proxy, error) => {
                if (error) {
                    console.error(error);
                    return;
                }
                this.upgradeGnomeMonitors();
            }
        );
    }

    /**
     * Upgrades Main.layoutManager.monitors by adding a dbus monitor connector
     * (e.g. "eDP-1" or "DP-1", etc.).  Used for stable restoring for monitor
     * layouts.
     */
    upgradeGnomeMonitors(callback = () => {}) {
        this.proxy.GetCurrentStateRemote((state, error) => {
            if (error) {
                console.error(error);
                return;
            }

            const [, monitors] = state;
            for (const monitor of monitors) {
                const [specs] = monitor;
                const [connector] = specs;

                // upgrade gnome monitor object to add connector
                let gnomeIndex = this.monitorManager.get_monitor_for_connector(connector);
                let gnomeMonitor = this.gnomeMonitors.find(m => m.index === gnomeIndex);
                if (gnomeMonitor) {
                    gnomeMonitor.connector = connector;
                }
            }

            callback();
        });
    }

    /**
     * Downgrades Main.layoutManager.monitors to default gnome state (without "connector"
     * information).
     */
    downgradeGnomeMonitors() {
        this.gnomeMonitors.forEach(m => {
            delete m.connector;
        });
    }

    get monitorManager() {
        return global.backend.get_monitor_manager();
    }

    get gnomeMonitors() {
        return Main.layoutManager.monitors;
    }
}
