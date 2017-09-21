
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

timestamp = () => {
    return GLib.get_monotonic_time()/1000
}

/**
 * Look up the function by name at call time. This makes it convenient to
 * redefine the function without re-registering all signal handler, keybindings,
 * etc. (this is like a function symbol in lisp)
 */
dynamic_function_ref = (handler_name, owner_obj) => {
    owner_obj = owner_obj || window;
    return function() {
        owner_obj[handler_name].apply(owner_obj, arguments);
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

