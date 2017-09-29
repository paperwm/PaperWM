const Extension = imports.misc.extensionUtils.getCurrentExtension();
const convenience = Extension.imports.convenience;
const Tiling = Extension.imports.tiling;
const Scratch = Extension.imports.scratch;
const utils = Extension.utils;
const Gio = imports.gi.Gio;
const Meta = imports.gi.Meta;
const Main = imports.ui.main;
const Shell = imports.gi.Shell;

let SESSIONID = ""+(new Date().getTime());
// The extension sometimes go through multiple init -> enable -> disable cycles..
// Keep track of the count here.
let initCount = 0;

let isDuringGnomeShellStartup = false;

window.PaperWM = Extension;

function init() {
    initCount++;
    SESSIONID += "#"
    debug('init', SESSIONID);
}

function enable() {
    debug('enable', SESSIONID);
    if(initCount > 1) {
        debug("#startup",
              "Reinitialized against our will! Skipping 'enable()' to not cause trouble. ('disable()' isn't implemented yet)")
        return;
    }

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

    settings.set_strv("close", ['<super>c'])
    settings.set_strv("maximize-horizontally", ['<super>f'])
    settings.set_strv("toggle-fullscreen", ['<super><shift>f']);

    shell_settings = new Gio.Settings({ schema_id: "org.gnome.shell.keybindings"});
    shell_settings.set_strv("toggle-overview", ["<super>space"])

    // Or use "toggle-maximize"?
    Meta.keybindings_set_custom_handler("maximize-horizontally",
                                        as_key_handler("toggle_maximize_horizontally"));


    // Action name => mutter-keybinding-action-id
    window.paperActionIds = {};

    registerPaperAction("switch-next",     dynamic_function_ref("preview_navigate"));
    registerPaperAction("switch-previous", dynamic_function_ref("preview_navigate"),
                        Meta.KeyBindingFlags.IS_REVERSED);

    registerPaperAction("move-left", dynamic_function_ref("preview_navigate"));
    registerPaperAction("move-right", dynamic_function_ref("preview_navigate"));
    registerPaperAction("toggle-scratch-layer", dynamic_function_ref("toggleScratch"));

    registerPaperAction("develop-set-globals", dynamic_function_ref("setDevGlobals"));
}

function disable() {
    debug("disable", SESSIONID);
}

function registerPaperAction(actionName, handler, metaKeyBindingFlags) {
    let id = registerMutterAction(actionName, handler, metaKeyBindingFlags)
    window.paperActionIds[actionName] = id;
    return id;
}

/**
 * Register a key-bindable action (from our own schema) in mutter.
 *
 * Return the assigned numeric id.
 *
 * NB: use `Meta.keybindings_set_custom_handler` to re-assign the handler.
 */
function registerMutterAction(action_name, handler, flags) {
    // Ripped from https://github.com/negesti/gnome-shell-extensions-negesti 
    // Handles multiple gnome-shell versions
    flags = flags || Meta.KeyBindingFlags.NONE;

    if (Main.wm.addKeybinding && Shell.ActionMode){ // introduced in 3.16
        return Main.wm.addKeybinding(action_name,
                                     convenience.getSettings(), flags,
                                     Shell.ActionMode.NORMAL,
                                     handler
                                    );
    } else if (Main.wm.addKeybinding && Shell.KeyBindingMode) { // introduced in 3.7.5
        // Shell.KeyBindingMode.NORMAL | Shell.KeyBindingMode.MESSAGE_TRAY,
        return Main.wm.addKeybinding(action_name,
                                     convenience.getSettings(), flags,
                                     Shell.KeyBindingMode.NORMAL,
                                     handler
                                    );
    } else {
        return global.display.add_keybinding(
            action_name,
            convenience.getSettings(),
            flags,
            handler
        );
    }
}
