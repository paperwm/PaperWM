/**
   Settings utility shared between the running extension and the preference UI.
 */
const Module = imports.misc.extensionUtils.getCurrentExtension().imports.module;
const {Gio, GLib, Gtk} = imports.gi;
const Mainloop = imports.mainloop;

var workspaceSettingsCache = {};

var WORKSPACE_KEY = 'org.gnome.shell.extensions.paperwm.workspace';
var WORKSPACE_LIST_KEY = 'org.gnome.shell.extensions.paperwm.workspacelist';
var KEYBINDINGS_KEY = 'org.gnome.shell.extensions.paperwm.keybindings';

// This is the value mutter uses for the keyvalue of above_tab
var META_KEY_ABOVE_TAB = 0x2f7259c9;

var prefs = {};

function setVerticalMargin() {
    let vMargin = Module.GSettings().get_int('vertical-margin');
    let gap = Module.GSettings().get_int('window-gap');
    prefs.vertical_margin = Math.max(Math.round(gap / 2), vMargin);
}
let timerId;
function onWindowGapChanged() {
    setVerticalMargin();
    if (timerId) {
        Mainloop.source_remove(timerId);
    }
    timerId = Mainloop.timeout_add(500, () => {
        Module.Extension.imports.tiling.spaces.mru().forEach(space => {
            space.layout();
        });
        timerId = null;
        return false; // on return false destroys timeout
    });
}

function setState($, key) {
    let value = Module.GSettings().get_value(key);
    let name = key.replace(/-/g, '_');
    prefs[name] = value.deep_unpack();
}

var schemaSource, workspaceList, conflictSettings;
function setSchemas() {
    // Schemas that may contain conflicting keybindings
    // It's possible to inject or remove settings here on `user.init`.
    conflictSettings = [
        new Gio.Settings({schema_id: 'org.gnome.mutter.keybindings'}),
        new Gio.Settings({schema_id: 'org.gnome.mutter.wayland.keybindings'}),
        new Gio.Settings({schema_id: "org.gnome.desktop.wm.keybindings"}),
        new Gio.Settings({schema_id: "org.gnome.shell.keybindings"})
    ];
    schemaSource = Gio.SettingsSchemaSource.new_from_directory(
        GLib.build_filenamev([Module.Extension.path, "schemas"]),
        Gio.SettingsSchemaSource.get_default(),
        false
    );

    workspaceList = new Gio.Settings({
        settings_schema: schemaSource.lookup(WORKSPACE_LIST_KEY, true)
    });
}

function enable() {
    // generate preferences
    ['window-gap', 'vertical-margin', 'vertical-margin-bottom', 'horizontal-margin',
        'workspace-colors', 'default-background', 'animation-time', 'use-workspace-name',
        'pressure-barrier', 'default-show-top-bar', 'swipe-sensitivity', 'swipe-friction',
        'cycle-width-steps', 'cycle-height-steps', 'minimap-scale', 'winprops',
        'show-workspace-indicator', 'show-window-position-bar', 'show-focus-mode-icon',
        'disable-topbar-styling', 'default-focus-mode']
        .forEach(k => setState(null, k));
    prefs.__defineGetter__("minimum_margin", function () {
        return Math.min(15, this.horizontal_margin);
    });


    Module.GSettings().connect('changed', setState);
    Module.GSettings().connect('changed::vertical-margin', onWindowGapChanged);
    Module.GSettings().connect('changed::vertical-margin-bottom', onWindowGapChanged);
    Module.GSettings().connect('changed::window-gap', onWindowGapChanged);
    setVerticalMargin();

    // A intermediate window is created before the prefs dialog is created.
    // Prevent it from being inserted into the tiling causing flickering and general disorder
    defwinprop({
        wm_class: "Gnome-shell-extension-prefs",
        scratch_layer: true,
        focus: true,
    });
    defwinprop({
        wm_class: /gnome-screenshot/i,
        scratch_layer: true,
        focus: true,
    });

    addWinpropsFromGSettings();
    setSchemas();
}

function disable() {
    Module.Utils().timeout_remove(timerId);
    timerId = null;

    prefs = {};
    workspaceSettingsCache = {};
    schemaSource = null;
    workspaceList = null;
    conflictSettings = null;
}

/**
 * Returns the default focus mode (can be user-defined).
 */
function getDefaultFocusMode() {
    // find matching focus mode
    const mode = prefs.default_focus_mode;
    const modes = Module.Extension.imports.tiling.FocusModes;
    let result = null;
    Object.entries(modes).forEach(([k,v]) => {
        if (v === mode) {
            result = k;
        }
    });

    // if found return, otherwise return default
    if (result) {
        return modes[result];
    } else {
        return modes.DEFAULT;
    }
}

/// Workspaces

function getWorkspaceSettings(index) {
    let list = workspaceList.get_strv('list');
    for (let uuid of list) {
        let settings = getWorkspaceSettingsByUUID(uuid);
        if (settings.get_int('index') === index) {
            return [uuid, settings];
        }
    }
    return getNewWorkspaceSettings(index);
}

function getNewWorkspaceSettings(index) {
    let uuid = GLib.uuid_string_random();
    let settings = getWorkspaceSettingsByUUID(uuid);
    let list = workspaceList.get_strv('list');
    list.push(uuid);
    workspaceList.set_strv('list', list);
    Module.GSettings().set_int('index', index);
    return [uuid, settings];
}

function getWorkspaceSettingsByUUID(uuid) {
    if (!workspaceSettingsCache[uuid]) {
        let settings = new Gio.Settings({
            settings_schema: schemaSource.lookup(WORKSPACE_KEY, true),
            path: `/org/gnome/shell/extensions/paperwm/workspaces/${uuid}/`
        });
        workspaceSettingsCache[uuid] = settings;
    }
    return workspaceSettingsCache[uuid];
}

/** Returns [[uuid, settings, name], ...] (Only used for debugging/development atm.) */
function findWorkspaceSettingsByName(regex) {
    let list = workspaceList.get_strv('list');
    let settingss = list.map(getWorkspaceSettingsByUUID);
    return Module.Utils().zip(list, settingss, settingss.map(s => s.get_string('name')))
        .filter(([uuid, s, name]) => name.match(regex));
}

/** Only used for debugging/development atm. */
function deleteWorkspaceSettingsByName(regex, dryrun = true) {
    let out = "";
    function rprint(...args) { console.debug(...args); out += args.join(" ") + "\n"; }
    let n = global.workspace_manager.get_n_workspaces();
    for (let [uuid, s, name] of findWorkspaceSettingsByName(regex)) {
        let index = s.get_int('index');
        if (index < n) {
            rprint("Skipping in-use settings", name, index);
            continue;
        }
        rprint(dryrun ? "[dry]" : "", `Delete settings for '${name}' (${uuid})`);
        if (!dryrun) {
            deleteWorkspaceSettings(uuid);
        }
    }
    return out;
}

/** Only used for debugging/development atm. */
function deleteWorkspaceSettings(uuid) {
    // NB! Does not check if the settings is currently in use. Does not reindex subsequent settings.
    let list = workspaceList.get_strv('list');
    let i = list.indexOf(uuid);
    let settings = getWorkspaceSettingsByUUID(list[i]);
    for (let key of Module.GSettings().list_keys()) {
        // Hopefully resetting all keys will delete the relocatable settings from dconf?
        Module.GSettings().reset(key);
    }

    list.splice(i, 1);
    workspaceList.set_strv('list', list);
}

// Useful for debugging
function printWorkspaceSettings() {
    let list = workspaceList.get_strv('list');
    let settings = list.map(getWorkspaceSettingsByUUID);
    let zipped = Module.Utils().zip(list, settings);
    const key = s => s[1].get_int('index');
    zipped.sort((a, b) => key(a) - key(b));
    for (let [uuid, s] of zipped) {
        console.debug('index:', s.get_int('index'), s.get_string('name'), s.get_string('color'), uuid);
    }
}

/// Keybindings

/**
 * Depending on your gnome version, Gtk.accelerator_parse() can return a 2 value arrary
 * or a 3 value array.  This method handles both return results.
 */
function accelerator_parse(keystr) {
    let ok, key, mask;
    let result = Gtk.accelerator_parse(keystr);
    if (result.length === 3) {
        [ok, key, mask] = result;
    }
    else {
        [key, mask] = result;
        if (key) {
            ok = true;
        }
    }

    return [ok, key, mask];
}

/**
 * Two keystrings can represent the same key combination
 */
function keystrToKeycombo(keystr) {
    // Above_Tab is a fake keysymbol provided by mutter
    let aboveTab = false;
    if (keystr.match(/Above_Tab/) || keystr.match(/grave/)) {
        // Gtk bails out if provided with an unknown keysymbol
        keystr = keystr.replace('Above_Tab', 'a');
        aboveTab = true;
    }

    let [ok, key, mask] = accelerator_parse(keystr);

    if (aboveTab)
        key = META_KEY_ABOVE_TAB;
    return `${key}|${mask}`; // Since js doesn't have a mapable tuple type
}

function keycomboToKeystr(combo) {
    let [mutterKey, mods] = combo.split('|').map(s => Number.parseInt(s));
    let key = mutterKey;
    if (mutterKey === META_KEY_ABOVE_TAB)
        key = 97; // a
    let keystr = Gtk.accelerator_name(key, mods);
    if (mutterKey === META_KEY_ABOVE_TAB)
        keystr = keystr.replace(/a$/, 'Above_Tab');
    return keystr;
}

function keycomboToKeylab(combo) {
    let [mutterKey, mods] = combo.split('|').map(s => Number.parseInt(s));
    let key = mutterKey;
    if (mutterKey === META_KEY_ABOVE_TAB)
        key = 97; // a
    let keylab = Gtk.accelerator_get_label(key, mods);
    if (mutterKey === META_KEY_ABOVE_TAB)
        keylab = keylab.replace(/a$/, 'Above_Tab');
    return keylab;
}

function generateKeycomboMap(settings) {
    let map = {};
    for (let name of Module.GSettings().list_keys()) {
        let value = Module.GSettings().get_value(name);
        if (value.get_type_string() !== 'as')
            continue;

        for (let combo of value.deep_unpack().map(keystrToKeycombo)) {
            if (combo === '0|0')
                continue;
            if (map[combo]) {
                map[combo].push(name);
            } else {
                map[combo] = [name];
            }
        }
    }
    return map;
}

function findConflicts(schemas) {
    schemas = schemas || conflictSettings;
    let conflicts = [];
    const paperMap =
          generateKeycomboMap(Module.ExtensionUtils.getSettings(KEYBINDINGS_KEY));

    for (let settings of schemas) {
        const against = generateKeycomboMap(settings);
        for (let combo in paperMap) {
            if (against[combo]) {
                conflicts.push({
                    name: paperMap[combo][0],
                    conflicts: against[combo],
                    settings, combo
                });
            }
        }
    }
    return conflicts;
}

/// Winprops

/**
   Modelled after notion/ion3's system

   Examples:

   defwinprop({
     wm_class: "Riot",
     scratch_layer: true
   })
*/
var winprops = [];

function winprop_match_p(meta_window, prop) {
    let wm_class = meta_window.wm_class || "";
    let title = meta_window.title;
    if (prop.wm_class) {
        if (prop.wm_class instanceof RegExp) {
            if (!wm_class.match(prop.wm_class))
                return false;
        } else if (prop.wm_class !== wm_class) {
            return false;
        }
    }
    if (prop.title) {
        if (prop.title instanceof RegExp) {
            if (!title.match(prop.title))
                return false;
        } else {
            if (prop.title !== title)
                return false;
        }
    }

    return true;
}

function find_winprop(meta_window)  {
    // sort by title first (prioritise title over wm_class)


    let props = winprops.filter(winprop_match_p.bind(null, meta_window));

    // if matching props found, return first one
    if (props.length > 0) {
        return props[0];
    }

    // fall back, if star (catch-all) winprop exists, return the first one
    let starProps = winprops.filter(w => w.wm_class === "*" || w.title === "*");
    if (starProps.length > 0) {
        return starProps[0];
    }
    
    return null;
}

function defwinprop(spec) {
    // process preferredWidth - expects inputs like 50% or 400px
    if (spec.preferredWidth) {
        spec.preferredWidth = {
            // value is first contiguous block of digits
            value: new Number((spec.preferredWidth.match(/\d+/) ?? ['0'])[0]),
            // unit is first contiguous block of apha chars or % char
            unit: (spec.preferredWidth.match(/[a-zA-Z%]+/) ?? ['NO_UNIT'])[0],
        }
    }

    /**
     * we order specs with gsettings rirst ==> gsetting winprops take precedence
     * over winprops defined in user.js.  This was done since gsetting winprops
     * are easier to add/remove (and can be added/removed/edited instantly without
     * restarting shell).
     */
    // add winprop
    winprops.push(spec);

    // now order winprops with gsettings first, then title over wm_class
    winprops.sort((a,b) => {
        let firstresult = 0;
        if (a.gsetting && !b.gsetting) {
            firstresult = -1;
        }
        else if (!a.gsetting && b.gsetting) {
            firstresult = 1;
        }

        // second compare, prioritise title
        let secondresult = 0;
        if (a.title && !b.title) {
            secondresult = -1;
        }
        else if (!a.title && b.title) {
            secondresult = 1;
        }

        return firstresult || secondresult;
    });
}

/**
 * Adds user-defined winprops from gsettings (as defined in 
 * org.gnome.shell.extensions.paperwm.winprops) to the winprops array.
 */
function addWinpropsFromGSettings() {
    // add gsetting (user config) winprops
    Module.GSettings().get_value('winprops').deep_unpack()
        .map(value => JSON.parse(value))
        .forEach(prop => {
            // test if wm_class or title is a regex expression
            if (/^\/.+\/[igmsuy]*$/.test(prop.wm_class)) {
                // extract inner regex and flags from wm_class
                let matches = prop.wm_class.match(/^\/(.+)\/([igmsuy]*)$/);
                let inner = matches[1];
                let flags = matches[2];
                prop.wm_class = new RegExp(inner, flags);
            }
            if (/^\/.+\/[igmsuy]*$/.test(prop.title)) {
                // extract inner regex and flags from title
                let matches = prop.title.match(/^\/(.+)\/([igmsuy]*)$/);
                let inner = matches[1];
                let flags = matches[2];
                prop.title = new RegExp(inner, flags);
            }
            prop.gsetting = true; // set property that is from user gsettings
            defwinprop(prop);
        });
}

/**
 * Removes winprops with the `gsetting:true` property from the winprops array.
 */
function removeGSettingWinpropsFromArray() {
    winprops = winprops.filter(prop => !prop.gsetting ?? true);
}

/**
 * Effectively reloads winprops from gsettings.
 * This is a convenience function which removes gsetting winprops from winprops
 * array and then adds the currently defined 
 * org.gnome.shell.extensions.paperwm.winprops winprops.
 */
function reloadWinpropsFromGSettings() {
    removeGSettingWinpropsFromArray();
    addWinpropsFromGSettings();
}
