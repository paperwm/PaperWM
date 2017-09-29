
debug_all = true; // Consider the default value in `debug_filter` to be true
debug_filter = { "#preview": false };
debug = () => {
    let keyword = arguments[0];
    let filter = debug_filter[keyword];
    if (filter === false)
        return;
    if (debug_all || filter === true)
        print(Array.prototype.join.call(arguments, " | "));
}

print_stacktrace = () => {
    let trace = (new Error()).stack.split("\n")
    // Remove _this_ frame
    trace.splice(0, 1);
    // Remove some uninteresting frames
    let filtered = trace.filter((frame) => {
        return frame !== "wrapper@resource:///org/gnome/gjs/modules/lang.js:178"   
    });
    let args = Array.prototype.splice.call(arguments);
    args.splice(0, 1, "stacktrace:"+(args[0] ? args[0] : ""))
    // Use non-breaking space to encode new lines (otherwise every frame is
    // prefixed by timestamp)
    let nl = " ";
    args.push(nl+filtered.join(nl))
    debug.apply(null, args);
}

framestr = (rect) => {
    return "[ x:"+rect.x + ", y:" + rect.y + " w:" + rect.width + " h:"+rect.height + " ]";
}

/**
 * Look up the function by name at call time. This makes it convenient to
 * redefine the function without re-registering all signal handler, keybindings,
 * etc. (this is like a function symbol in lisp)
 */
dynamic_function_ref = (handler_name, owner_obj) => {
    owner_obj = owner_obj || window;
    return function() {
        owner_obj[handler_name].apply(this, arguments);
    }
}

/**
 * Adapts a function operating on a meta_window to a key handler
 */
as_key_handler = function(fn) {
    if(typeof(fn) === "string") {
        fn = dynamic_function_ref(fn);
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


//// Debug and development utils

setDevGlobals = function() {
    // Accept the risk of this interfering with existing code for now
    metaWindow = global.display.focus_window;
    workspace = global.screen.get_active_workspace();
    actor = metaWindow.get_compositor_private();
}

/**
 * Visualize the frame and buffer bounding boxes of a meta window
 */
toggleWindowBoxes = function(metaWindow) {
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
        let frameBox = new St.Widget();
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
