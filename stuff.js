/*
meta_window_get_mutter_hints ()

const char *
      meta_window_get_mutter_hints (MetaWindow *window);

Gets the current value of the _MUTTER_HINTS property.

The purpose of the hints is to allow fine-tuning of the Window Manager and Compositor behaviour on per-window basis, and is intended primarily for hints that are plugin-specific.

The property is a list of colon-separated key=value pairs. The key names for any plugin-specific hints must be suitably namespaced to allow for shared use; 'mutter-' key prefix is reserved for internal use, and must not be used by plugins.
*/








KeyManager = new Lang.Class({
    Name: 'MyKeyManager',

    _init: function() {
        this.grabbers = new Map()

        global.display.connect(
            'accelerator-activated',
            Lang.bind(this, function(display, action, deviceId, timestamp){
                log('Accelerator Activated: [display={}, action={}, deviceId={}, timestamp={}]',
                    display, action, deviceId, timestamp)
                this._onAccelerator(action)
            }))
    },

    listenFor: function(accelerator, callback){
        log('Trying to listen for hot key [accelerator={}]', accelerator)
        let action = global.display.grab_accelerator(accelerator)

        if(action == Meta.KeyBindingAction.NONE) {
            log('Unable to grab accelerator [binding={}]', accelerator)
        } else {
            log('Grabbed accelerator [action={}]', action)
            let name = Meta.external_binding_name_for_action(action)
            log('Received binding name for action [name={}, action={}]',
                name, action)

            log('Requesting WM to allow binding [name={}]', name)
            Main.wm.allowKeybinding(name, Shell.ActionMode.ALL)

            this.grabbers.set(action, {
                name: name,
                accelerator: accelerator,
                callback: callback
            })
        }

    },

    _onAccelerator: function(action) {
        let grabber = this.grabbers.get(action)

        if(grabber) {
            this.grabbers.get(action).callback()
        } else {
            log('No listeners [action={}]', action)
        }
    }
})

keymanager = new KeyManager()
//: [object MyKeyManager]

foobar = () => {

    print("asdf")
    
}

keymanager.listenFor("<super>u", dynamic_function_ref("foobar"))
//: 

global.window_manager
//: [object instance proxy GIName:Shell.WM jsobj@0x7f80dc9730a0 native@0xea48a0]

a.get_name()
//: external-grab-112

foo = (shell, binding) => {
    a = binding;
    debug([].join.call(arguments, " "))
}

global.window_manager.connect("filter-keybinding", dynamic_function_ref("foo"))
//: 66646


Mainloop.timeout_add_seconds

/*
  The X11 id of MetaWindow is not expose -> must rely on title and/or other
  "fingerprinting": Note: get_stable_sequence is _not_ stable across gnome-shell
  restart
  */



TILING_ORDER_PATH = GLib.getenv("HOME")
    + "/" + ".cache/gnome-shell-scrollwm.txt";

get_fingerprint = function(meta_window) {
    return meta_window.title;
}

serialize_tiling_order = function() {
    // Assume no \t or \n in title. Might not be 100% safe, but this is a bit
    // adhoc anyway
    return workspaces.map((ws) => {
        return ws.map(get_fingerprint).join("\t");
    }).join("\n");
}

write_tiling_order = function() {
    // Quick and dirty sync write: Async writing was a lot more pain with less
    // utils for eg. handling character encoding
    let serialized = serialize_tiling_order();
    let result = GLib.file_set_contents(TILING_ORDER_PATH, serialized);
    if(!result) {
        debug("Failed to write serialized tiling order:", serialized, "END");
    }
    return result;
}

read_tiling_order = function() {
    let serialized = GLib.file_get_contents(TILING_ORDER_PATH).toString();
    return serialized.split("\n").map((tsv) => tsv.split("\t"));
}

saved_order_comparator = function(ordered_fingerprints) {
    return function(a, b) {
        let af = get_fingerprint(a);
        let bf = get_fingerprint(b);
        let ai = ordered_fingerprints.indexOf(af)
        let bi = ordered_fingerprints.indexOf(bf)
        return ai - bi
    }
}

add_all_from_workspace = (workspace, saved_fingerprint_order) => {
    workspace = workspace || global.screen.get_active_workspace();
    let windows = workspace.list_windows();
    if(saved_fingerprint_order) {
        windows.sort(saved_order_comparator(saved_fingerprint_order))
    }
    windows.forEach((meta_window, i) => {
        if(workspaces[workspace.workspace_index].indexOf(meta_window) < 0) {
            add_handler(workspace, meta_window)
        }
    })
}


write_tiling_order_async = function() {
    // BROKEN: need to do char conversion
    let file = Gio.File.new_for_path(GLib.getenv("HOME")+"/"+SESSION_PATH);
    let stream;
    stream = file.replace(null, false, Gio.FileCreateFlags.PRIVATE, null)
    let serialized = serialize_tiling_order();
    stream.write_async(serialized,
                       0, null, (stream, res) => {
                           if(res.had_error()) {
                               debug("Something went wrong");
                           }
                           let bytes_written = res.propagate_int();
                           if(serialized.length !== bytes_written) {
                               debug("Incomplete write, ignoring!",
                                     serialized.length, bytes_written);
                           }
                           debug("Tiling order written");
                           stream.close_async(0, null, null);
                       });
}
