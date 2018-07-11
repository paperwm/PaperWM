var Extension = imports.misc.extensionUtils.extensions['paperwm@hedning:matrix.org'];
var Gio = imports.gi.Gio;
var GLib = imports.gi.GLib;

var settings = Extension.imports.convenience.getSettings();

var screen = global.screen;

var WORKSPACE_KEY = 'org.gnome.Shell.Extensions.PaperWM.Workspace';
var WORKSPACE_LIST_KEY = 'org.gnome.Shell.Extensions.PaperWM.WorkspaceList';

var prefs = {
    window_gap: settings.get_int('window-gap'),
    vertical_margin: settings.get_int('vertical-margin'),
    horizontal_margin: settings.get_int('horizontal-margin'),
    workspace_colors: settings.get_strv('workspace-colors')
};

function setVerticalMargin() {
    let vMargin = settings.get_int('vertical-margin');
    let gap = settings.get_int('window-gap');
    prefs.vertical_margin = Math.max(Math.round(gap/2), vMargin);
}

function setState(_, key) {
    let value = settings.get_value(key);
    let name = key.replace(/-/g, '_');
    switch (value.get_type_string()) {
    case 'i':
        prefs[name] = settings.get_int(key);
        break;
    case 'as':
        prefs[name] = settings.get_strv(key);
        break;
    }
}

var schemaSource, workspaceList;
function setSchemas() {
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
    settings.connect('changed::window-gap', setState);
    settings.connect('changed::horizontal-margin', setState);
    settings.connect('changed::vertical-margin', setVerticalMargin);
    setVerticalMargin();
    settings.connect('changed::workspace-colors', setState);
}

var id;
function enable() {
    setSchemas();
}

function disable() {
}

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
