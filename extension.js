const Extension = imports.misc.extensionUtils.getCurrentExtension();
const convenience = Extension.imports.convenience;
const Tiling = Extension.imports.tiling;
const Scratch = Extension.imports.scratch;
const LiveAltTab = Extension.imports.liveAltTab;
const utils = Extension.utils;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Meta = imports.gi.Meta;
const Main = imports.ui.main;
const Shell = imports.gi.Shell;

let SESSIONID = ""+(new Date().getTime());
// The extension sometimes go through multiple init -> enable -> disable cycles..
// Keep track of the count here.
let initCount = 0;

let isDuringGnomeShellStartup = false;

window.PaperWM = Extension;

/*
  Keep track of some mappings mutter doesn't do/expose
  - action-name -> action-id mapping
  - action-id   -> action mapping
  - action      -> handler
*/
window.paperActions = {
    actions: [],
    nameMap: {},
    register: function(actionName, handler, metaKeyBindingFlags) {
        let id = registerMutterAction(actionName,
                                      handler,
                                      metaKeyBindingFlags)
        let action = { id: id
                       , name: actionName
                       , handler: handler
                     };
        this.actions.push(action);
        this.nameMap[actionName] = action;
        return action;
    },
    idOf: function(name) {
        let action = this.byName(name);
        if (action) {
            return action.id;
        } else {
            return Meta.KeyBindingAction.NONE;
        }
    },
    byName: function(name) {
        return this.nameMap[name];
    },
    byId: function(mutterId) {
        return this.actions.find(action => action.id == mutterId);
    }
};


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


    function initWorkspaces() {
        // Hook up existing workspaces
        for (let i=0; i < global.screen.n_workspaces; i++) {
            let workspace = global.screen.get_workspace_by_index(i)
            Tiling.spaces.addSpace(workspace);
            debug("workspace", workspace)
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

    Meta.keybindings_set_custom_handler("switch-applications",
                                        dynamic_function_ref("liveAltTab"));

    Meta.keybindings_set_custom_handler("switch-to-workspace-up",
                                        dynamic_function_ref("preview_navigate"));

    Meta.keybindings_set_custom_handler("switch-to-workspace-down",
                                        dynamic_function_ref("preview_navigate"));


    paperActions.register("switch-next",     dynamic_function_ref("preview_navigate"));
    paperActions.register("switch-previous", dynamic_function_ref("preview_navigate"),
                        Meta.KeyBindingFlags.IS_REVERSED);

    paperActions.register("move-left", dynamic_function_ref("preview_navigate"));
    paperActions.register("move-right", dynamic_function_ref("preview_navigate"));
    paperActions.register("toggle-scratch-layer", dynamic_function_ref("toggleScratch"));

    paperActions.register("develop-set-globals", dynamic_function_ref("setDevGlobals"));

    paperActions.register("cycle-width", as_key_handler("cycleWindowWidth"),
                        Meta.KeyBindingFlags.PER_WINDOW);
    paperActions.register("tile-visible", as_key_handler("tileVisible"),
                        Meta.KeyBindingFlags.PER_WINDOW);

    loadRcFile();
}

function disable() {
    debug("disable", SESSIONID);
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

function loadRcFile() {
    try {
        // https://github.com/coolwanglu/gnome-shell-extension-rc/blob/master/extension.js
        // But since we want to be sure that our extension is loaded at the time 
        // we load our own. 
        //
        // Note that `imports.misc.extensionUtils.getCurrentExtension();` works
        // inside the rc file
        const rcpath = GLib.getenv('HOME') + '/.config/' + "paperwm-rc.js"
        if (GLib.file_test(rcpath, GLib.FileTest.IS_REGULAR)) {
            const [success, rcCodeBytes] = GLib.file_get_contents(rcpath);
            if (success) {
                debug("Loading rcfile:", rcpath)
                eval(rcCodeBytes.toString());
            } else {
                debug("Failed to read rcfile");
            }
        }
    } catch(e) {
        debug("rcfile error", e.message, e.stack);
    }
}
