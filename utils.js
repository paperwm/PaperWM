const Extension = imports.misc.extensionUtils.extensions['paperwm@hedning:matrix.org']
const Gdk = imports.gi.Gdk;
var GLib = imports.gi.GLib;
var Meta = imports.gi.Meta;

var workspaceManager = global.workspace_manager;
var display = global.display;

var GObject = imports.gi.GObject;
var registerClass;

{
    let version = imports.misc.config.PACKAGE_VERSION.split('.');
    if (version[0] >= 3 && version[1] > 30) {
        registerClass = GObject.registerClass;
    } else {
        registerClass = (x => x);
    }

}

var debug_all = false; // Turn off by default
var debug_filter = {'#paperwm': true, '#stacktrace': true};
function debug() {
    let keyword = arguments[0];
    let filter = debug_filter[keyword];
    if (filter === false)
        return;
    if (debug_all || filter === true)
        print(Array.prototype.join.call(arguments, " | "));
}

function warn(...args) {
    print("WARNING:", ...args);
}

function assert(condition, message, ...dump) {
    if (!condition) {
        throw new Error(message + "\n", dump);
    }
}

function withTimer(message, fn) {
    let start = GLib.get_monotonic_time();
    let ret = fn();
    let stop = GLib.get_monotonic_time();
    log(`${message} ${((stop - start)/1000).toFixed(1)}ms`);
}

function print_stacktrace(error) {
    let trace;
    if (!error) {
        trace = (new Error()).stack.split("\n");
        // Remove _this_ frame
        trace.splice(0, 1);
    } else {
        trace = error.stack.split("\n");
    }
    // Remove some uninteresting frames
    let filtered = trace.filter((frame) => {
        return frame !== "wrapper@resource:///org/gnome/gjs/modules/lang.js:178";
    });
    log(`JS ERROR: ${error}\n ${trace.join('\n')}`);
}

function framestr(rect) {
    return "[ x:"+rect.x + ", y:" + rect.y + " w:" + rect.width + " h:"+rect.height + " ]";
}

/**
 * Returns a human-readable enum value representation
 */
function ppEnumValue(value, genum) {
    let entry = Object.entries(genum).find(([k, v]) => v === value);
    if (entry) {
        return `${entry[0]} (${entry[1]})`
    } else {
        return `<not-found> (${value})`
    }
}

/**
 * Look up the function by name at call time. This makes it convenient to
 * redefine the function without re-registering all signal handler, keybindings,
 * etc. (this is like a function symbol in lisp)
 */
function dynamic_function_ref(handler_name, owner_obj) {
    owner_obj = owner_obj || window;
    return function() {
        owner_obj[handler_name].apply(this, arguments);
    }
}

function swap(array, i, j) {
    let temp = array[i];
    array[i] = array[j];
    array[j] = temp;
}

function in_bounds(array, i) {
    return i >= 0 && i < array.length;
}

function isPointInsideActor(actor, x, y) {
    return (actor.x <= x && x <= actor.x+actor.width)
        && (actor.y <= y && y <= actor.y+actor.height);
}

function setBackgroundImage(actor, resource_path) {
    // resource://{resource_path}
    const Clutter = imports.gi.Clutter;
    const GdkPixbuf = imports.gi.GdkPixbuf;
    const Cogl = imports.gi.Cogl;

    let image = new Clutter.Image();

    let pixbuf = GdkPixbuf.Pixbuf.new_from_resource(resource_path)

    image.set_data(pixbuf.get_pixels() ,
                   pixbuf.get_has_alpha() ? Cogl.PixelFormat.RGBA_8888
                   : Cogl.PixelFormat.RGB_888,
                   pixbuf.get_width() ,
                   pixbuf.get_height() ,
                   pixbuf.get_rowstride());
    actor.set_content(image);
    actor.content_repeat = Clutter.ContentRepeat.BOTH
}


//// Debug and development utils

const Tiling = Extension.imports.tiling;

function setDevGlobals() {
    // Accept the risk of this interfering with existing code for now
    metaWindow = display.focus_window;
    meta_window = display.focus_window;
    workspace = workspaceManager.get_active_workspace();
    actor = metaWindow.get_compositor_private();
    space = Tiling.spaces.spaceOfWindow(metaWindow);
}

/**
 * Visualize the frame and buffer bounding boxes of a meta window
 */
function toggleWindowBoxes(metaWindow) {
    metaWindow = metaWindow || display.focus_window;

    if(metaWindow._paperDebugBoxes) {
        metaWindow._paperDebugBoxes.forEach(box => {
            box.destroy();
        });
        delete metaWindow._paperDebugBoxes;
        return [];
    }

    let frame = metaWindow.get_frame_rect()
    let inputFrame = metaWindow.get_buffer_rect()
    let actor = metaWindow.get_compositor_private();

    makeFrameBox = function({x, y, width, height}, color) {
        let frameBox = new imports.gi.St.Widget();
        frameBox.set_position(x, y)
        frameBox.set_size(width, height)
        frameBox.set_style("border: 2px" + color + " solid");
        return frameBox;
    }

    let boxes = [];

    boxes.push(makeFrameBox(frame, "red"));
    boxes.push(makeFrameBox(inputFrame, "blue"));

    if(inputFrame.x !== actor.x || inputFrame.y !== actor.y
       || inputFrame.width !== actor.width || inputFrame.height !== actor.height) {
        boxes.push(makeFrameBox(actor, "yellow"));
    }

    boxes.forEach(box => global.stage.add_actor(box));

    metaWindow._paperDebugBoxes = boxes;
    return boxes;
}

var markNewClonesSignalId = null;
function toggleCloneMarks() {
    // NB: doesn't clean up signal on disable

    function markCloneOf(metaWindow) {
        if (metaWindow.clone)
            metaWindow.clone.opacity = 190;
    }
    function unmarkCloneOf(metaWindow) {
        if (metaWindow.clone)
            metaWindow.clone.opacity = 255;
    }

    let windows = display.get_tab_list(Meta.TabList.NORMAL_ALL, null);

    if (markNewClonesSignalId) {
        display.disconnect(markNewClonesSignalId);
        markNewClonesSignalId = null;
        windows.forEach(unmarkCloneOf);
    } else {
        markNewClonesSignalId = display.connect_after(
            "window-created", (_, mw) => markCloneOf(mw))

        windows.forEach(markCloneOf);
    }
}


function sum(array) {
    return array.reduce((a, b) => a + b, 0);
}

function zip(...as) {
    let r = [];
    let minLength = Math.min(...as.map(x => x.length));
    for (let i = 0; i < minLength; i++) {
        r.push(as.map(a => a[i]));
    }
    return r;
}

function warpPointer(x, y) {
    let display = Gdk.Display.get_default();
    let deviceManager = display.get_device_manager();
    let pointer = deviceManager.get_client_pointer();
    pointer.warp(Gdk.Screen.get_default(), x, y)
}

function monitorOfPoint(x, y) {
    // get_monitor_index_for_rect "helpfully" returns the primary monitor index for out of bounds rects..
    const Main = imports.ui.main;
    for (let monitor of Main.layoutManager.monitors) {
        if ((monitor.x <= x && x <= monitor.x+monitor.width) &&
            (monitor.y <= y && y <= monitor.y+monitor.height))
        {
            return monitor;
        }
    }

    return null;
}


class Signals extends Map {
    static get [Symbol.species]() { return Map; }

    connect(object, signal, handler) {
        let signals = this.get(object);
        if (!signals) {
            signals = [];
            this.set(object, signals);
        }
        let id = object.connect(signal, handler);
        signals.push(id);
        return id;
    }

    disconnect(object) {
        let ids = this.get(object);
        if (ids) {
            ids.forEach(id => object.disconnect(id));
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
