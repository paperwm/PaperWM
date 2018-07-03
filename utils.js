const Extension = imports.misc.extensionUtils.extensions['paperwm@hedning:matrix.org']
const Gdk = imports.gi.Gdk;
var Meta = imports.gi.Meta;

var debug_all = false; // Turn off by default
var debug_filter = {};
function debug() {
    let keyword = arguments[0];
    let filter = debug_filter[keyword];
    if (filter === false)
        return;
    if (debug_all || filter === true)
        print(Array.prototype.join.call(arguments, " | "));
}

function print_stacktrace(error) {
    let trace;
    if (!error) {
        trace = (new Error()).stack.split("\n")
        // Remove _this_ frame
        trace.splice(0, 1);
    } else {
        trace = error.stack.split("\n");
    }
    // Remove some uninteresting frames
    let filtered = trace.filter((frame) => {
        return frame !== "wrapper@resource:///org/gnome/gjs/modules/lang.js:178"   
    });
    let args = [...arguments];
    args.splice(0, 1, "stacktrace:"+(args[0] ? args[0] : ""))
    // Use non-breaking space to encode new lines (otherwise every frame is
    // prefixed by timestamp)
    let nl = " ";
    args.push(nl+filtered.join(nl))
    debug.apply(null, args);
}

function framestr(rect) {
    return "[ x:"+rect.x + ", y:" + rect.y + " w:" + rect.width + " h:"+rect.height + " ]";
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

/**
 * Adapts a function operating on a meta_window to a key handler
 */
function as_key_handler(fn, owner_obj = window) {
    if(typeof(fn) === "string") {
        fn = dynamic_function_ref(fn, owner_obj);
    }
    return function(screen, monitor, meta_window, binding) {
        return fn(meta_window);
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


//// Debug and development utils

const Tiling = Extension.imports.tiling;

function setDevGlobals() {
    // Accept the risk of this interfering with existing code for now
    metaWindow = global.display.focus_window;
    meta_window = global.display.focus_window;
    workspace = global.screen.get_active_workspace();
    actor = metaWindow.get_compositor_private();
    space = Tiling.spaces.spaceOfWindow(metaWindow);
}

/**
 * Visualize the frame and buffer bounding boxes of a meta window
 */
function toggleWindowBoxes(metaWindow) {
    metaWindow = metaWindow || global.display.focus_window;

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

    let windows = global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null);

    if (markNewClonesSignalId) {
        global.display.disconnect(markNewClonesSignalId);
        markNewClonesSignalId = null;
        windows.forEach(unmarkCloneOf);
    } else {
        markNewClonesSignalId = global.display.connect_after(
            "window-created", (_, mw) => markCloneOf(mw))

        windows.forEach(markCloneOf);
    }
}


function sum(array) {
    return array.reduce((a, b) => a + b, 0);
}

function setWorkspaceName(name, workspace) {
    let i;
    if (workspace === undefined) {
        i = global.screen.get_active_workspace_index();
    } else {
        i = workspace.index();
    }
    let settings = new Gio.Settings({ schema_id:
                                      'org.gnome.desktop.wm.preferences'});
    let names = settings.get_strv('workspace-names');

    let oldName = names[i];
    names[i] = name;
    settings.set_strv('workspace-names', names);

    return oldName;
}

function getPointerPosition() {
    let display = Gdk.Display.get_default();
    let deviceManager = display.get_device_manager();
    let pointer = deviceManager.get_client_pointer();
    let [gdkscreen, x, y] = pointer.get_position();
    return [x, y, gdkscreen, pointer]
}

function warpPointer(x, y) {
    let display = Gdk.Display.get_default();
    let deviceManager = display.get_device_manager();
    let pointer = deviceManager.get_client_pointer();
    pointer.warp(Gdk.Screen.get_default(), x, y)
}

class Signals extends Map {
    static get [Symbol.species]() { return Map; }

    connect(object, signal, handler) {
        let signals = this.get(object);
        if (!signals) {
            signals = [];
            this.set(object, signals);
        }
        signals.push(object.connect(signal, handler));
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
