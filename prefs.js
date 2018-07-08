
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;
const Gdk = imports.gi.Gdk;
const Lang = imports.lang;
const Mainloop = imports.mainloop;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;

const WORKSPACE_KEY = 'org.gnome.Shell.Extensions.PaperWM.Workspace';
const WORKSPACE_LIST_KEY = 'org.gnome.Shell.Extensions.PaperWM.WorkspaceList';

const wmSettings = new Gio.Settings({ schema_id:
                                    'org.gnome.desktop.wm.preferences'});

const schemaSource = Gio.SettingsSchemaSource.new_from_directory(
    GLib.build_filenamev([Me.path, "schemas"]),
    Gio.SettingsSchemaSource.get_default(),
    false
);

const workspaceList = new Gio.Settings({
    settings_schema: schemaSource.lookup(WORKSPACE_LIST_KEY, true)
});

function getWorkspaceSettingsByUUID(uuid) {
    return new Gio.Settings({
        settings_schema: schemaSource.lookup(WORKSPACE_KEY, true),
        path: `/org/gnome/shell/extensions/paperwm/workspaces/${uuid}/`});
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
    let id = settings.connect('changed', () => {
        settings.disconnect(id);

        if (settings.get_int('index') === -1) {
            settings.set_int('index', index);
        }

        let list = workspaceList.get_strv('list');
        list.push(uuid);
        workspaceList.set_strv('list', list);

    });
    return [uuid, settings];
}

class SettingsWidget {
    constructor() {
        this._settings = Convenience.getSettings();
        this._workspaceList = workspaceList;

        this.builder = new Gtk.Builder();
        this.builder.add_from_file(Me.path + '/Settings.ui');

        this.widget = new Gtk.ScrolledWindow({ hscrollbar_policy: Gtk.PolicyType.NEVER });
        this._notebook = this.builder.get_object('paperwm_settings');
        this.widget.add(this._notebook);

        // General

        let windowGap = this.builder.get_object('window_gap_spin');
        let gap = this._settings.get_int('window-gap');

        windowGap.set_value(gap);
        windowGap.connect('value-changed', () => {
            this._settings.set_int('window-gap', windowGap.get_value());
        });

        let hMargin = this.builder.get_object('hmargin_spinner');
        hMargin.set_value(this._settings.get_int('horizontal-margin'));
        hMargin.connect('value-changed', () => {
            this._settings.set_int('horizontal-margin', hMargin.get_value());
        });

        let vMargin = this.builder.get_object('vmargin_spinner');
        vMargin.set_value(this._settings.get_int('vertical-margin'));
        vMargin.connect('value-changed', () => {
            this._settings.set_int('vertical-margin', vMargin.get_value());
        });

        // Workspaces
        const workspaceCombo = this.builder.get_object('worskpace_combo_text');
        const workspaceStack = this.builder.get_object('workspace_stack');

        const nWorkspaces = wmSettings.get_int('num-workspaces');
        this.workspaceNames = wmSettings.get_strv('workspace-names');

        for (let i=0; i < nWorkspaces; i++) {
            let [uuid, settings] = getWorkspaceSettings(i);
            let view = this.createWorkspacePage(settings, i);

            workspaceStack.add_named(view, i.toString());
            let name = this.getWorkspaceName(settings, i);
            workspaceCombo.append_text(name);
        }

        workspaceCombo.connect('changed', () => {
            if (this._updatingName)
                return;

            let active = workspaceCombo.get_active();
            log(`active ${active}`);
            let page = workspaceStack.get_child_by_name(active.toString());
            workspaceStack.set_visible_child(page);
        });

        workspaceCombo.set_active(0);


        createRow('foo', new Gtk.ColorButton());

    }

    createWorkspacePage(settings, index) {

        let view = new Gtk.Frame();
        let list = new Gtk.ListBox();
        view.add(list);

        let nameEntry = new Gtk.Entry();
        let colorButton = new Gtk.ColorButton();
        let background = new Gtk.FileChooserButton();

        list.add(createRow('Name', nameEntry));
        list.add(createRow('Color', colorButton));
        list.add(createRow('Background', background));

        let rgba = new Gdk.RGBA();
        let color = settings.get_string('color');
        let palette = this._settings.get_strv('workspace-colors');
        if (color === '')
            color = palette[index % palette.length];

        rgba.parse(color);
        colorButton.set_rgba(rgba);

        let filename = settings.get_string('background');
        if (filename === '')
            background.unselect_all();
        else
            background.set_filename(filename);

        nameEntry.set_text(this.getWorkspaceName(settings, index));

        let workspace_combo = this.builder.get_object('worskpace_combo_text');

        nameEntry.connect('changed', () => {
            let active = workspace_combo.get_active();
            let name = nameEntry.get_text();

            this._updatingName = true;
            workspace_combo.remove(active);
            workspace_combo.insert_text(active, name);

            workspace_combo.set_active(active);
            this._updatingName = false;

            settings.set_string('name', name);
        });

        colorButton.connect('color-set', () => {
            let color = colorButton.get_rgba().to_string();
            settings.set_string('color', color);
            settings.set_string('background', '');
            background.unselect_all();
        });

        background.connect('file-set', () => {
            let filename = background.get_filename();
            settings.set_string('background', filename);
        });

        return view;
    }

    getWorkspaceName(settings, index) {
        let name = settings.get_string('name');
        if (name === '')
            name = this.workspaceNames[index];
        if (name === undefined)
            name = `Workspace ${index}`;
        return name;
    }

}

function createRow(text, widget, signal, handler) {
    let margin = 12;
    let row = new Gtk.ListBoxRow({selectable: false});
    let box = new Gtk.Box({
        margin_start: margin, margin_end: margin,
        orientation: Gtk.Orientation.HORIZONTAL
    });
    let label = new Gtk.Label({
        label: text, hexpand: true, xalign: 0
    });

    box.add(label);
    box.add(widget);

    row.add(box);

    return row;

}

function init() {
}

function buildPrefsWidget() {
    let settings = new SettingsWidget();
    let widget = settings.widget;
    widget.show_all();
    return widget;
}
