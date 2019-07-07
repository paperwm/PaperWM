/**

   Settings utility shared between the running extension and the preference UI.

 */
var Extension = imports.misc.extensionUtils.extensions['paperwm@hedning:matrix.org'];
var Gio = imports.gi.Gio;
var GLib = imports.gi.GLib;
var Gtk = imports.gi.Gtk;

var Convenience = Extension.imports.convenience;
var settings = Convenience.getSettings();

var WORKSPACE_KEY = 'org.gnome.Shell.Extensions.PaperWM.Workspace';
var WORKSPACE_LIST_KEY = 'org.gnome.Shell.Extensions.PaperWM.WorkspaceList';
var KEYBINDINGS_KEY = 'org.gnome.Shell.Extensions.PaperWM.Keybindings';

// This is the value mutter uses for the keyvalue of above_tab
var META_KEY_ABOVE_TAB = 0x2f7259c9;

var prefs = {};
['window-gap', 'vertical-margin', 'vertical-margin-bottom', 'horizontal-margin',
 'workspace-colors', 'default-background', 'animation-time', 'use-workspace-name',
 'pressure-barrier', 'default-show-top-bar', 'swipe-sensitivity',
 'cycle-width-steps', 'cycle-height-steps']
    .forEach((k) => setState(null, k));

function setVerticalMargin() {
    let vMargin = settings.get_int('vertical-margin');
    let gap = settings.get_int('window-gap');
    prefs.vertical_margin = Math.max(Math.round(gap/2), vMargin);
}

function setState($, key) {
    let value = settings.get_value(key);
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
        GLib.build_filenamev([Extension.path, "schemas"]),
        Gio.SettingsSchemaSource.get_default(),
        false
    );

    workspaceList = new Gio.Settings({
        settings_schema: schemaSource.lookup(WORKSPACE_LIST_KEY, true)
    });
}
setSchemas(); // Initialize imediately so prefs.js can import properly
function init() {
    settings.connect('changed', setState);
    settings.connect('changed::vertical-margin', setVerticalMargin);
    settings.connect('changed::window-gap', setVerticalMargin);
    setVerticalMargin();

    // A intermediate window is created before the prefs dialog is created.
    // Prevent it from being inserted into the tiling causing flickering and general disorder
    defwinprop({
        wm_class: "Gnome-shell-extension-prefs",
        scratch_layer: true,
        focus: true,
    });
}

var id;
function enable() {
    setSchemas();
}

function disable() {
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
    settings.set_int('index', index);
    return [uuid, settings];
}

function getWorkspaceSettingsByUUID(uuid) {
    return new Gio.Settings({
        settings_schema: schemaSource.lookup(WORKSPACE_KEY, true),
        path: `/org/gnome/shell/extensions/paperwm/workspaces/${uuid}/`});
}

/// Keybindings

/**
 * Two keystrings can represent the same key combination
 */
function keystrToKeycombo(keystr) {
    // Above_Tab is a fake keysymbol provided by mutter
    let aboveTab = false;
    if (keystr.match(/Above_Tab/)) {
        // Gtk bails out if provided with an unknown keysymbol
        keystr = keystr.replace('Above_Tab', 'A');
        aboveTab = true;
    }
    let [key, mask] = Gtk.accelerator_parse(keystr);
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

function generateKeycomboMap(settings) {
    let map = {};
    for (let name of settings.list_keys()) {
        let value = settings.get_value(name);
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
          generateKeycomboMap(Convenience.getSettings(KEYBINDINGS_KEY));

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
    if (prop.wm_class !== wm_class) {
        return false;
    }
    if (prop.title) {
        if (prop.title.constructor === RegExp) {
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
    let props = winprops.filter(
        winprop_match_p.bind(null, meta_window));

    return props[0];
}

function defwinprop(spec) {
    winprops.push(spec);
}
