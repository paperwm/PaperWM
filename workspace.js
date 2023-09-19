import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Lib from './lib.js';

/**
 * Workspace related utility functions used by other modules.
 */
const WORKSPACE_LIST_KEY = 'org.gnome.shell.extensions.paperwm.workspacelist';
const WORKSPACE_KEY = 'org.gnome.shell.extensions.paperwm.workspace';

export class WorkspaceSettings {
    constructor(extension) {
        this.workspaceSettingsCache = {};
        this.schemaSource = Gio.SettingsSchemaSource.new_from_directory(
            GLib.build_filenamev([extension.path, "schemas"]),
            Gio.SettingsSchemaSource.get_default(),
            false
        );

        this.workspaceList = new Gio.Settings({
            settings_schema: this.getSchemaSource().lookup(WORKSPACE_LIST_KEY, true),
        });
    }

    getSchemaSource() {
        return this.schemaSource;
    }

    getWorkspaceName(settings, index) {
        let name = settings.get_string('name') ?? `Workspace ${index + 1}`;
        if (!name || name === '') {
            name = `Workspace ${index + 1}`;
        }
        return name;
    }

    getWorkspaceList() {
        return this.workspaceList;
    }

    /**
     * Returns list of ordered workspace UUIDs.
     */
    getListUUID() {
        return this.getWorkspaceList().get_strv('list');
    }

    getWorkspaceSettings(index) {
        let list = this.getListUUID();
        for (let uuid of list) {
            let settings = this.getWorkspaceSettingsByUUID(uuid);
            if (settings.get_int('index') === index) {
                return [uuid, settings];
            }
        }
        return this.getNewWorkspaceSettings(index);
    }

    getNewWorkspaceSettings(index) {
        let uuid = GLib.uuid_string_random();
        let settings = this.getWorkspaceSettingsByUUID(uuid);
        let list = this.getListUUID();
        list.push(uuid);
        this.getWorkspaceList().set_strv('list', list);
        settings.set_int('index', index);
        return [uuid, settings];
    }

    getWorkspaceSettingsByUUID(uuid) {
        if (!this.workspaceSettingsCache[uuid]) {
            let settings = new Gio.Settings({
                settings_schema: this.getSchemaSource().lookup(WORKSPACE_KEY, true),
                path: `/org/gnome/shell/extensions/paperwm/workspaces/${uuid}/`,
            });
            this.workspaceSettingsCache[uuid] = settings;
        }
        return this.workspaceSettingsCache[uuid];
    }

    /** Returns [[uuid, settings, name], ...] (Only used for debugging/development atm.) */
    findWorkspaceSettingsByName(regex) {
        let list = this.getListUUID();
        let settings = list.map(this.getWorkspaceSettingsByUUID);
        return Lib.zip(list, settings, settings.map(s => s.get_string('name')))
            .filter(([uuid, s, name]) => name.match(regex));
    }

    /** Only used for debugging/development atm. */
    deleteWorkspaceSettingsByName(regex, dryrun = true) {
        let out = "";
        function rprint(...args) { console.debug(...args); out += `${args.join(" ")}\n`; }
        let n = global.workspace_manager.get_n_workspaces();
        for (let [uuid, s, name] of this.findWorkspaceSettingsByName(regex)) {
            let index = s.get_int('index');
            if (index < n) {
                rprint("Skipping in-use settings", name, index);
                continue;
            }
            rprint(dryrun ? "[dry]" : "", `Delete settings for '${name}' (${uuid})`);
            if (!dryrun) {
                this.deleteWorkspaceSettings(uuid);
            }
        }
        return out;
    }

    /** Only used for debugging/development atm. */
    deleteWorkspaceSettings(uuid) {
        // NB! Does not check if the settings is currently in use. Does not reindex subsequent settings.
        let list = this.getListUUID();
        let i = list.indexOf(uuid);
        let settings = this.getWorkspaceSettingsByUUID(list[i]);
        for (let key of settings.list_keys()) {
            // Hopefully resetting all keys will delete the relocatable settings from dconf?
            settings.reset(key);
        }

        list.splice(i, 1);
        this.getWorkspaceList().set_strv('list', list);
    }

    // Useful for debugging
    printWorkspaceSettings() {
        let list = this.getListUUID();
        let settings = list.map(this.getWorkspaceSettingsByUUID);
        let zipped = Lib.zip(list, settings);
        const key = s => s[1].get_int('index');
        zipped.sort((a, b) => key(a) - key(b));
        for (let [uuid, s] of zipped) {
            console.log('index:', s.get_int('index'), s.get_string('name'), s.get_string('color'), uuid);
        }
    }
}
