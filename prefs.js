
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;
const Gdk = imports.gi.Gdk;
const Mainloop = imports.mainloop;

const ExtensionUtils = imports.misc.extensionUtils;
const Extension = ExtensionUtils.getCurrentExtension();
const Convenience = Extension.imports.convenience;

const WORKSPACE_KEY = 'org.gnome.Shell.Extensions.PaperWM.Workspace';
const KEYBINDINGS_KEY = 'org.gnome.Shell.Extensions.PaperWM.Keybindings';

const wmSettings = new Gio.Settings({ schema_id:
                                    'org.gnome.desktop.wm.preferences'});

let _ = s => s;

// TreeStore model
const COLUMN_ID          = 0;
const COLUMN_INDEX       = 1;
const COLUMN_DESCRIPTION = 2;
const COLUMN_KEY         = 3;
const COLUMN_MODS        = 4;
const COLUMN_WARNING     = 5;
const COLUMN_RESET       = 6;
const COLUMN_TOOLTIP     = 7;

const Settings = Extension.imports.settings;
let getWorkspaceSettings = Settings.getWorkspaceSettings;
let getNewWorkspaceSettings = Settings.getNewWorkspaceSettings;
let getWorkspaceSettingsByUUID = Settings.getWorkspaceSettingsByUUID;

function range(n) {
    let r = [];
    for (let i = 0; i < n; i++)
        r.push(i);
    return r;
}

function swapArrayElements(array, i, j) {
    let iVal = array[i];
    array[i] = array[j];
    array[j] = iVal;
    return array;
}

function ok(okValue) {
    if(okValue[0]) {
        return okValue[1]
    } else {
        return null
    }
}

class SettingsWidget {
    /**
       selectedWorkspace: index of initially selected workspace in workspace settings tab
       selectedTab: index of initially shown tab
     */
    constructor(selectedTab=0, selectedWorkspace=0 ) {
        this._settings = Convenience.getSettings();

        this.builder = new Gtk.Builder();
        this.builder.add_from_file(Extension.path + '/Settings.ui');

        this.widget = new Gtk.ScrolledWindow({ hscrollbar_policy: Gtk.PolicyType.NEVER });
        this._notebook = this.builder.get_object('paperwm_settings');
        this._notebook.page = selectedTab;
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

        let onlyScratch = this.builder.get_object('only-scratch-in-overview');
        onlyScratch.state =
            this._settings.get_boolean('only-scratch-in-overview');
        onlyScratch.connect('state-set', (obj, state) => {
            this._settings.set_boolean('only-scratch-in-overview',
                                       state);
        });

        let disableCorner = this.builder.get_object('override-hot-corner');
        disableCorner.state =
            this._settings.get_boolean('override-hot-corner');
        disableCorner.connect('state-set', (obj, state) => {
            this._settings.set_boolean('override-hot-corner',
                                       state);
        });


        // Workspaces

        const defaultBackground = this.builder.get_object('workspace_chooser_default_background');
        const deleteDefaultBackground = this.builder.get_object('workspace_button_delete_default_background');

        let filename = this._settings.get_string('default-background');
        if (filename === ''){
            defaultBackground.unselect_all();
            deleteDefaultBackground.sensitive = false;
        } else {
            defaultBackground.set_filename(filename);
            deleteDefaultBackground.sensitive = true;
        }

        defaultBackground.connect('file-set', () => {
            let filename = defaultBackground.get_filename();
            this._settings.set_string('default-background', filename);
            deleteDefaultBackground.sensitive = true;
        });

        deleteDefaultBackground.connect('clicked', () => {
            this._settings.set_string('default-background', '');
            defaultBackground.unselect_all();
            deleteDefaultBackground.sensitive = false;
        });

        const workspaceCombo = this.builder.get_object('workspace_combo_text');
        const workspaceStack = this.builder.get_object('workspace_stack');

        const nWorkspaces = wmSettings.get_int('num-workspaces');
        this.workspaceNames = wmSettings.get_strv('workspace-names');

        // Note: For some reason we can't set the visible child of the workspace
        //       stack at construction time.. (!)
        //       Ensure the initially selected workspace is added to the stack
        //       first as a workaround.
        let wsIndices = range(nWorkspaces);
        let wsSettingsByIndex = wsIndices.map(i => getWorkspaceSettings(i)[1]);
        let wsIndicesSelectedFirst =
            swapArrayElements(wsIndices.slice(), 0, selectedWorkspace);

        for (let i of wsIndicesSelectedFirst) {
            let view = this.createWorkspacePage(wsSettingsByIndex[i], i);
            workspaceStack.add_named(view, i.toString());
        }

        for (let i of wsIndices) {
            // Combo box entries in normal workspace index order
            let name = this.getWorkspaceName(wsSettingsByIndex[i], i);
            workspaceCombo.append_text(name);
        }

        workspaceCombo.connect('changed', () => {
            if (this._updatingName)
                return;

            let active = workspaceCombo.get_active();
            workspaceStack.set_visible_child_name(active.toString());
        });

        workspaceCombo.set_active(selectedWorkspace);

        // Keybindings

        let settings = Convenience.getSettings(KEYBINDINGS_KEY);
        let box = this.builder.get_object('keybindings');
        box.spacing = 12;

        let searchEntry = this.builder.get_object('keybinding_search');

        let windowFrame = new Gtk.Frame({label: _('Windows'),
                                         label_xalign: 0.5});
        let windows = createKeybindingWidget(settings, searchEntry);
        box.add(windowFrame);
        windowFrame.add(windows);


        ['new-window', 'close-window', 'switch-next', 'switch-previous',
         'switch-left', 'switch-right', 'switch-up', 'switch-down',
         'switch-first', 'switch-last', 'live-alt-tab', 'live-alt-tab-backward',
         'move-left', 'move-right', 'move-up', 'move-down',
         'slurp-in', 'barf-out', 'center-horizontally',
         'paper-toggle-fullscreen', 'toggle-maximize-width', 'cycle-width',
         'cycle-height', 'take-window']
            .forEach(k => {
            addKeybinding(windows.model.child_model, settings, k);
        });

        annotateKeybindings(windows.model.child_model, settings);

        let workspaceFrame = new Gtk.Frame({label: _('Workspaces'),
                                            label_xalign: 0.5});
        let workspaces = createKeybindingWidget(settings, searchEntry);
        box.add(workspaceFrame);
        workspaceFrame.add(workspaces);

        ['previous-workspace', 'previous-workspace-backward',
         'move-previous-workspace', 'move-previous-workspace-backward' ]
            .forEach(k => {
                addKeybinding(workspaces.model.child_model, settings, k);
            });

        annotateKeybindings(workspaces.model.child_model, settings);


        let scratchFrame = new Gtk.Frame({label: _('Scratch layer'),
                                          label_xalign: 0.5});
        let scratch = createKeybindingWidget(settings, searchEntry);
        box.add(scratchFrame);
        scratchFrame.add(scratch);

        ['toggle-scratch-layer', 'toggle-scratch']
            .forEach(k => {
                addKeybinding(scratch.model.child_model, settings, k);
            });

        annotateKeybindings(scratch.model.child_model, settings);

        searchEntry.connect('changed', () => {
            [windows, workspaces, scratch].map(tw => tw.model).forEach(m => m.refilter());
        });


        // About
        let versionLabel = this.builder.get_object('extension_version');
        let version = Extension.metadata.version.toString();
        versionLabel.set_text(version);
    }

    createWorkspacePage(settings, index) {

        let view = new Gtk.Frame();
        let list = new Gtk.ListBox();
        view.add(list);

        let nameEntry = new Gtk.Entry();
        let colorButton = new Gtk.ColorButton();

        let backgroundBox = new Gtk.Box({spacing: 32});  // same spacing as used in glade for default background
        let background = new Gtk.FileChooserButton();
        let clearBackground = new Gtk.Button({label: 'Clear', sensitive: settings.get_string('background') != ''});
        backgroundBox.add(background)
        backgroundBox.add(clearBackground)

        list.add(createRow('Name', nameEntry));
        list.add(createRow('Color', colorButton));
        list.add(createRow('Background', backgroundBox));

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

        let workspace_combo = this.builder.get_object('workspace_combo_text');

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
            clearBackground.sensitive = filename != '';
        });

        clearBackground.connect('clicked', () => {
            background.unselect_all();  // Note: does not trigger 'file-set'
            settings.reset('background');
            clearBackground.sensitive = settings.get_string('background') != '';
        });

        return view;
    }

    getWorkspaceName(settings, index) {
        let name = settings.get_string('name');
        if (name === '')
            name = this.workspaceNames[index];
        if (name === undefined)
            name = `Workspace ${index + 1}`;
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

function createKeybindingWidget(settings, searchEntry) {
    let model = new Gtk.TreeStore();
    let filteredModel = new Gtk.TreeModelFilter({child_model: model});
    filteredModel.set_visible_func(
        (model, iter) => {
            let desc = model.get_value(iter, COLUMN_DESCRIPTION);

            if(ok(model.iter_parent(iter)) || desc === null) {
                return true;
            }

            let query = searchEntry.get_chars(0, -1).toLowerCase().split(" ");
            let descLc = desc.toLowerCase();
            
            return query.every(word => descLc.indexOf(word) > -1);
        }
    );

    model.set_column_types(
            [
                // GObject.TYPE_BOOLEAN, // COLUMN_VISIBLE
                GObject.TYPE_STRING, // COLUMN_ID
                GObject.TYPE_INT,    // COLUMN_INDEX
                GObject.TYPE_STRING, // COLUMN_DESCRIPTION
                GObject.TYPE_INT,    // COLUMN_KEY
                GObject.TYPE_INT,    // COLUMN_MODS
                GObject.TYPE_BOOLEAN,// COLUMN_WARNING
                GObject.TYPE_BOOLEAN,// COLUMN_RESET
                GObject.TYPE_STRING, // COLUMN_TOOLTIP
            ]);

    let treeView = new Gtk.TreeView();
    treeView.model = filteredModel;
    treeView.headers_visible = false;
    treeView.margin_start = 12;
    treeView.margin_end = 12;
    treeView.search_column = COLUMN_DESCRIPTION;
    treeView.enable_search = true;
    treeView.tooltip_column = COLUMN_TOOLTIP;

    let descriptionRenderer = new Gtk.CellRendererText();
    let descriptionColumn = new Gtk.TreeViewColumn();
    descriptionColumn.expand = true;
    descriptionColumn.pack_start(descriptionRenderer, true);
    descriptionColumn.add_attribute(descriptionRenderer, "text", COLUMN_DESCRIPTION);

    treeView.append_column(descriptionColumn);

    let warningRenderer = new Gtk.CellRendererPixbuf();
    warningRenderer.mode = Gtk.CellRendererMode.INERT;
    warningRenderer.stock_id = 'gtk-dialog-warning';
    let warningColumn = new Gtk.TreeViewColumn();
    warningColumn.pack_start(warningRenderer, true);
    warningColumn.add_attribute(warningRenderer, "visible", COLUMN_WARNING);

    treeView.append_column(warningColumn);

    let accelRenderer = new Gtk.CellRendererAccel();
    accelRenderer.accel_mode = Gtk.CellRendererAccelMode.GTK;
    accelRenderer.editable = true;

    accelRenderer.connect("accel-edited",
            (accelRenderer, path, key, mods, hwCode) => {
                let iter = ok(filteredModel.get_iter_from_string(path));
                if(!iter)
                    return;

                iter = filteredModel.convert_iter_to_child_iter(iter);

                // Update the UI.
                model.set(iter, [COLUMN_KEY, COLUMN_MODS], [key, mods]);

                // Update the stored setting.
                let id = model.get_value(iter, COLUMN_ID);
                let index = model.get_value(iter, COLUMN_INDEX);
                let accelString = Gtk.accelerator_name(key, mods);

                let accels = settings.get_strv(id);

                if (index === -1) {
                    accels.push(accelString);
                } else {
                    accels[index] = accelString
                }
                settings.set_strv(id, accels);

                let newEmptyRow = null, parent;
                if (index === -1) {
                    model.set_value(iter, COLUMN_INDEX, accels.length-1);
                    model.set_value(iter, COLUMN_DESCRIPTION, "...");

                    let parent = ok(model.iter_parent(iter));
                    newEmptyRow = model.insert_after(parent, iter);
                } else if (index === 0 && !model.iter_has_child(iter)) {
                    newEmptyRow = model.insert(iter, -1);
                }

                if (newEmptyRow) {
                    model.set(newEmptyRow, ...transpose([
                        [COLUMN_ID, id],
                        [COLUMN_INDEX, -1],
                        [COLUMN_DESCRIPTION, "New binding"],
                        [COLUMN_KEY, 0],
                        [COLUMN_MODS, 0],
                    ]));
                }

                annotateKeybindings(model, settings);
            });

    accelRenderer.connect("accel-cleared",
            (accelRenderer, path) => {
                let iter = ok(filteredModel.get_iter_from_string(path));
                if(!iter)
                    return;

                iter = filteredModel.convert_iter_to_child_iter(iter);

                let index = model.get_value(iter, COLUMN_INDEX);

                // Update the UI.
                model.set(iter, [COLUMN_KEY, COLUMN_MODS], [0, 0]);

                if (index === -1) {
                    // Clearing the empty row
                    return;
                }

                let id = model.get_value(iter, COLUMN_ID);
                let accels = settings.get_strv(id);
                accels.splice(index, 1);

                let parent, nextSibling;
                // Simply rebuild the model for this action
                if (index === 0) {
                    parent = iter.copy();
                } else {
                    parent = ok(model.iter_parent(iter));
                }
                nextSibling = parent.copy();

                if(!model.iter_next(nextSibling))
                    nextSibling = null;

                model.remove(parent);

                // Update the stored setting.
                settings.set_strv(id, accels);

                let recreated = addKeybinding(model, settings, id, nextSibling);
                let selection = treeView.get_selection();
                selection.select_iter(recreated);

                annotateKeybindings(model, settings);
            });

    let accelColumn = new Gtk.TreeViewColumn();
    accelColumn.pack_end(accelRenderer, false);
    accelColumn.add_attribute(accelRenderer, "accel-key", COLUMN_KEY);
    accelColumn.add_attribute(accelRenderer, "accel-mods", COLUMN_MODS);

    treeView.append_column(accelColumn);

    let resetRenderer = new Gtk.CellRendererToggle();
    resetRenderer.mode = Gtk.CellRendererMode.ACTIVATABLE;
    let resetColumn = new Gtk.TreeViewColumn();
    resetColumn.clickable = true;
    resetColumn.pack_start(resetRenderer, true);
    resetColumn.add_attribute(resetRenderer, "visible", COLUMN_RESET);

    resetRenderer.connect('toggled', (renderer, path) => {
        let iter = ok(filteredModel.get_iter_from_string(path));
        if(!iter)
            return;
        iter = filteredModel.convert_iter_to_child_iter(iter);

        let id = model.get_value(iter, COLUMN_ID);
        if (settings.get_user_value(id)) {
            settings.reset(id);
            model.set_value(iter, COLUMN_RESET, false);
        }

        let parent = ok(model.iter_parent(iter)) || iter.copy();
        let nextSibling = parent.copy();
        if(!model.iter_next(nextSibling))
            nextSibling = null;

        model.remove(parent);

        let recreated = addKeybinding(model, settings, id, nextSibling);
        let selection = treeView.get_selection();
        selection.select_iter(recreated);

        annotateKeybindings(model, settings);
    });

    treeView.append_column(resetColumn);

    return treeView;
}

function parseAccelerator(accelerator) {
    let key, mods;
    if (accelerator.match(/Above_Tab/)) {
        let keymap = Gdk.Keymap.get_default();
        let entries = keymap.get_entries_for_keycode(49)[1];
        let keyval = keymap.lookup_key(entries[0]);
        let name = Gtk.accelerator_name(keyval, 0);
        accelerator = accelerator.replace('Above_Tab', name);
    }

    [key, mods] = Gtk.accelerator_parse(accelerator);
    return [key, mods];
}

function transpose(colValPairs) {
    let colKeys = [], values = [];
    colValPairs.forEach(([k, v]) => {
        colKeys.push(k); values.push(v);
    })
    return [colKeys, values];
}

function addKeybinding(model, settings, id, position=null) {
    let accels = settings.get_strv(id);

    let schema = settings.settings_schema;
    let schemaKey = schema.get_key(id);
    let description = _(schemaKey.get_summary());

    let accelerator = accels.length > 0 ? accels[0] : null;
    // Add a row for the keybinding.
    let [key, mods] = accelerator ? parseAccelerator(accelerator) : [0, 0];
    let row = model.insert_before(null, position);
    model.set(row, ...transpose([
        [COLUMN_ID, id],
        [COLUMN_INDEX, 0],
        [COLUMN_DESCRIPTION, description],
        [COLUMN_KEY, key],
        [COLUMN_MODS, mods],
    ]));



    // Add one subrow for each additional keybinding
    accels.slice(1).forEach((accelerator, i) => {
        let [key, mods] = parseAccelerator(accelerator);
        let subrow = model.insert(row, 0);
        model.set(subrow, ...transpose([
            [COLUMN_ID, id],
            [COLUMN_INDEX, i+1],
            [COLUMN_DESCRIPTION, "..."],
            [COLUMN_KEY, key],
            [COLUMN_MODS, mods],
        ]));
    });

    if (accels.length !== 0) {
        // Add an empty row used for adding new bindings
        let emptyRow = model.append(row);
        model.set(emptyRow, ...transpose([
            [COLUMN_ID, id],
            [COLUMN_INDEX, -1],
            [COLUMN_DESCRIPTION, "New binding"],
            [COLUMN_KEY, 0],
            [COLUMN_MODS, 0],
        ]));
    }

    return row;
}

function annotateKeybindings(model, settings) {
    let conflicts = Settings.findConflicts();
    let warning = (id, c) => {
        return conflicts.filter(({name, combo}) => name === id && combo === c);
    };

    model.foreach((model, path, iter) => {
        let id = model.get_value(iter, COLUMN_ID);
        if (model.iter_depth(iter) === 0) {
            let reset = settings.get_user_value(id) ? true : false;
            model.set_value(iter, COLUMN_RESET, reset);
        }

        let accels = settings.get_strv(id);
        let index = model.get_value(iter, COLUMN_INDEX);
        if (index === -1 || accels.length === 0)
            return;
        let combo = Settings.keystrToKeycombo(accels[index]);

        let conflict = warning(id, combo);
        let tooltip = null;
        if (conflict.length > 0) {
            let keystr = Settings.keycomboToKeystr(combo);
            tooltip = `${keystr} overrides ${conflict[0].conflicts} in ${conflict[0].settings.path}`;

            model.set_value(iter, COLUMN_TOOLTIP,
                            GLib.markup_escape_text(tooltip, -1));
            model.set_value(iter, COLUMN_WARNING, true);
        } else {
            model.set_value(iter, COLUMN_WARNING, false);
        }

        return false;
    });
}

function init() {
}

function buildPrefsWidget() {
    let selectedWorkspace = GLib.getenv("PAPERWM_PREFS_SELECTED_WORKSPACE");
    let selectedTab = 0;
    if (selectedWorkspace) {
        selectedTab = 1;
    }
    let settings = new SettingsWidget(selectedTab, selectedWorkspace || 0);
    let widget = settings.widget;
    widget.show_all();
    return widget;
}
