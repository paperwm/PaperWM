const Extension = imports.misc.extensionUtils.getCurrentExtension();
const convenience = Extension.imports.convenience;
const Tiling = Extension.imports.tiling;
const utils = Extension.utils;
const Gio = imports.gi.Gio;
const Meta = imports.gi.Meta;
const Main = imports.ui.main;
const Shell = imports.gi.Shell;

let isDuringGnomeShellStartup = false;

function init() {
    debug('init');
}

function enable() {
    debug('enable');

    // HACK: couldn't find an other way within a reasonable time budget
    // This state is different from being enabled after startup. Existing
    // windows are not accessible yet for instance.
    isDuringGnomeShellStartup = Main.actionMode === Shell.ActionMode.NONE;

    global.screen.connect("workspace-added", dynamic_function_ref('workspace_added'));
    global.screen.connect("workspace-removed", dynamic_function_ref('workspace_removed'));

    global.display.connect('window-created', dynamic_function_ref('window_created'));

    function initWorkspaces() {
        // Hook up existing workspaces
        for (let i=0; i < global.screen.n_workspaces; i++) {
            let workspace = global.screen.get_workspace_by_index(i)
            Tiling.spaces[i] = Space(workspace);
            debug("workspace", workspace)
            workspace.connect("window-added", dynamic_function_ref("add_handler"))
            workspace.connect("window-removed", dynamic_function_ref("remove_handler"));
            add_all_from_workspace(workspace);
        }
    }

    if (isDuringGnomeShellStartup) {
        // Defer workspace initialization until existing windows are accessible.
        // Otherwise we're unable to restore the tiling-order. (when restarting
        // gnome-shell)
        Main.layoutManager.connect('startup-complete', function() {
            isDuringGnomeShellStartup = false;
            initWorkspaces();
        });
    } else {
        initWorkspaces();
    }

    settings = new Gio.Settings({ schema_id: "org.gnome.desktop.wm.keybindings"});
    // Temporary cycle-windows bindings
    settings.set_strv("cycle-windows", ["<super><ctrl>period" ])
    settings.set_strv("cycle-windows-backward", ["<super><ctrl>comma"])

    settings.set_strv("switch-windows", ["<alt>period", "<super>period" ])
    settings.set_strv("switch-windows-backward", ["<alt>comma", "<super>comma"])

    settings.set_strv("close", ['<super>c'])
    settings.set_strv("maximize-horizontally", ['<super>f'])

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

function set_action_handler(action_name, handler) {
    // Ripped from https://github.com/negesti/gnome-shell-extensions-negesti 
    // Handles multiple gnome-shell versions

    if (Main.wm.addKeybinding && Shell.ActionMode){ // introduced in 3.16
        Main.wm.addKeybinding(action_name,
                              convenience.getSettings(), Meta.KeyBindingFlags.NONE,
                              Shell.ActionMode.NORMAL,
                              handler
                             );
    } else if (Main.wm.addKeybinding && Shell.KeyBindingMode) { // introduced in 3.7.5
        // Shell.KeyBindingMode.NORMAL | Shell.KeyBindingMode.MESSAGE_TRAY,
        Main.wm.addKeybinding(action_name,
                              convenience.getSettings(), Meta.KeyBindingFlags.NONE,
                              Shell.KeyBindingMode.NORMAL,
                              handler
                             );
    } else {
        global.display.add_keybinding(
            action_name,
            convenience.getSettings(),
            Meta.KeyBindingFlags.NONE,
            handler
        );
    }
}
