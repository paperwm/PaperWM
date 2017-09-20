function _repl() {
    add_all_from_workspace()

    meta_window = global.display.focus_window;
    workspace = meta_window.get_workspace();
    window_actor = meta_window.get_compositor_private();

    set_action_handler("toggle-scratch-layer", () => { print("It works!"); });

    meta_window = pages[0]
    //: [object instance proxy GType:MetaWindowX11 jsobj@0x7f8c39e52f70 native@0x3d43880]
    workspace = meta_window.get_workspace()
    //: [object instance proxy GIName:Meta.Workspace jsobj@0x7f8c47166790 native@0x23b5360]

    actor = meta_window.get_compositor_private()

    St = imports.gi.St;
    St.set_slow_down_factor(1);
    St.set_slow_down_factor(3);

    actor.z_position

    meta = imports.gi.Meta
    meta_window.get_layer()

    // Use to control the stack level
    meta_window.raise()
    meta_window.lower()

}
