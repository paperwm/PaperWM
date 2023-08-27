const ExtensionUtils = imports.misc.extensionUtils;
const Extension = ExtensionUtils.getCurrentExtension();
const Lib = Extension.imports.lib;
const { Gio, GLib } = imports.gi;

/**
 * Workspace related utility functions used by other modules.
 */
let WORKSPACE_LIST_KEY = 'org.gnome.shell.extensions.paperwm.workspacelist';
let WORKSPACE_KEY = 'org.gnome.shell.extensions.paperwm.workspace';
let workspaceSettingsCache;

let schemaSource, workspaceList;
function enable() {
    workspaceSettingsCache = {};

    schemaSource = Gio.SettingsSchemaSource.new_from_directory(
        GLib.build_filenamev([Extension.path, "schemas"]),
        Gio.SettingsSchemaSource.get_default(),
        false
    );

    workspaceList = new Gio.Settings({
        settings_schema: getSchemaSource().lookup(WORKSPACE_LIST_KEY, true),
    });
}

function disable() {
    workspaceSettingsCache = null;
    schemaSource = null;
    workspaceList = null;
}

function getSchemaSource() {
    return schemaSource;
}

function getWorkspaceName(settings, index) {
    let name = settings.get_string('name') ?? `Workspace ${index + 1}`;
    if (!name || name === '') {
        name = `Workspace ${index + 1}`;
    }
    return name;
}

function getWorkspaceList() {
    return workspaceList;
}

/**
 * Returns list of ordered workspace UUIDs.
 */
function getListUUID() {
    return getWorkspaceList().get_strv('list');
}

function getWorkspaceSettings(index) {
    let list = getListUUID();
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
    let list = getListUUID();
    list.push(uuid);
    getWorkspaceList().set_strv('list', list);
    settings.set_int('index', index);
    return [uuid, settings];
}

function getWorkspaceSettingsByUUID(uuid) {
    if (!workspaceSettingsCache[uuid]) {
        let settings = new Gio.Settings({
            settings_schema: getSchemaSource().lookup(WORKSPACE_KEY, true),
            path: `/org/gnome/shell/extensions/paperwm/workspaces/${uuid}/`,
        });
        workspaceSettingsCache[uuid] = settings;
    }
    return workspaceSettingsCache[uuid];
}

/** Returns [[uuid, settings, name], ...] (Only used for debugging/development atm.) */
function findWorkspaceSettingsByName(regex) {
    let list = getListUUID();
    let settings = list.map(getWorkspaceSettingsByUUID);
    return Lib.zip(list, settings, settings.map(s => s.get_string('name')))
        .filter(([uuid, s, name]) => name.match(regex));
}

/** Only used for debugging/development atm. */
function deleteWorkspaceSettingsByName(regex, dryrun = true) {
    let out = "";
    function rprint(...args) { console.debug(...args); out += `${args.join(" ")}\n`; }
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
    let list = getListUUID();
    let i = list.indexOf(uuid);
    let settings = getWorkspaceSettingsByUUID(list[i]);
    for (let key of settings.list_keys()) {
        // Hopefully resetting all keys will delete the relocatable settings from dconf?
        settings.reset(key);
    }

    list.splice(i, 1);
    getWorkspaceList().set_strv('list', list);
}

// Useful for debugging
function printWorkspaceSettings() {
    let list = getListUUID();
    let settings = list.map(getWorkspaceSettingsByUUID);
    let zipped = Lib.zip(list, settings);
    const key = s => s[1].get_int('index');
    zipped.sort((a, b) => key(a) - key(b));
    for (let [uuid, s] of zipped) {
        console.log('index:', s.get_int('index'), s.get_string('name'), s.get_string('color'), uuid);
    }
}
