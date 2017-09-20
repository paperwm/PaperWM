const Extension = imports.misc.extensionUtils.getCurrentExtension();
const Tiling = Extension.imports.tiling;
const Gio = imports.gi.Gio;
const Meta = imports.gi.Meta;

function init() {
    // Hook up new workspaces
    debug('init')
}

function enable() {
    debug('enable')


    window.statusbar = undefined;

    statusbar = undefined;
    global.stage.get_first_child().get_children().forEach((actor) => {
        if ("panelBox" == actor.name) {
            statusbar = actor
        }
    })
    // The above doesn't work, we need to find a signal to get the statusbar out
    // In the meantime just set the height manually
    statusbar_height = 41;

    global.screen.connect("workspace-added", dynamic_function_ref('workspace_added'))
    global.screen.connect("workspace-removed", dynamic_function_ref('workspace_removed'));

    global.display.connect('window-created', dynamic_function_ref('window_created'));

    // Hook up existing workspaces
    for (let i=0; i < global.screen.n_workspaces; i++) {
        let workspace = global.screen.get_workspace_by_index(i)
        print("workspace: " + workspace)
        workspace.connect("window-added", dynamic_function_ref("add_handler"))
        workspace.connect("window-removed", dynamic_function_ref("remove_handler"));
        add_all_from_workspace(workspace);
    }


    settings = new Gio.Settings({ schema_id: "org.gnome.desktop.wm.keybindings"});
    // Temporary cycle-windows bindings
    settings.set_strv("cycle-windows", ["<super><ctrl>period" ])
    settings.set_strv("cycle-windows-backward", ["<super><ctrl>comma"])

    settings.set_strv("switch-windows", ["<alt>period", "<super>period" ])
    settings.set_strv("switch-windows-backward", ["<alt>comma", "<super>comma"])

    settings.set_strv("close", ['<super>c'])
    settings.set_strv("maximize-horizontally", ['<super>h'])

    shell_settings = new Gio.Settings({ schema_id: "org.gnome.shell.keybindings"});
    shell_settings.set_strv("toggle-overview", ["<super>space"])

    Meta.keybindings_set_custom_handler("cycle-windows",
                                        dynamic_function_ref("live_navigate"));
    Meta.keybindings_set_custom_handler("cycle-windows-backward",
                                        dynamic_function_ref("live_navigate"));

    Meta.keybindings_set_custom_handler("switch-windows",
                                        dynamic_function_ref("preview_navigate"));
    Meta.keybindings_set_custom_handler("switch-windows-backward",
                                        dynamic_function_ref("preview_navigate"));


    // Or use "toggle-maximize"?
    Meta.keybindings_set_custom_handler("maximize-horizontally",
                                        as_key_handler("toggle_maximize_horizontally"));



    // Must use `Meta.keybindings_set_custom_handler` to re-assign handler?
    set_action_handler("move-left", dynamic_function_ref("move_left"));
    set_action_handler("move-right", dynamic_function_ref("move_right"));
}

function disable() {
}
