
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;
const Gdk = imports.gi.Gdk;

const ExtensionUtils = imports.misc.extensionUtils;
const Extension = ExtensionUtils.getCurrentExtension();
const Convenience = Extension.imports.convenience;
const { KeybindingsPane } = Extension.imports.prefsKeybinding;

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

function getOk(okValue) {
    if(okValue[0]) {
        return okValue[1];
    } else {
        return null;
    }
}

var SettingsWidget = class SettingsWidget {
    /**
       selectedWorkspace: index of initially selected workspace in workspace settings tab
       selectedTab: index of initially shown tab
     */
    constructor(prefsWindow, selectedPage = 0, selectedWorkspace = 0) {

        log(`settingsWidget: ${prefsWindow} ${selectedPage}`)

        this._settings = Convenience.getSettings();

        this.builder = Gtk.Builder.new_from_file(Extension.path + '/Settings.ui');
        this.window = prefsWindow;

        const pages = [
          this.builder.get_object('general_page'),
          this.builder.get_object('workspaces_page'),
          this.builder.get_object('keybindings_page')
        ];
    
        pages.forEach(page => prefsWindow.add(page))
        prefsWindow.set_visible_page(pages[selectedPage])

        this.aboutButton = this.builder.get_object('about_button');
        this._backgroundFilter = new Gtk.FileFilter();
        this._backgroundFilter.add_pixbuf_formats();

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

        let topMargin = this.builder.get_object('top_margin_spinner');
        topMargin.set_value(this._settings.get_int('vertical-margin'));
        topMargin.connect('value-changed', () => {
            this._settings.set_int('vertical-margin', topMargin.get_value());
        });

        let bottomMargin = this.builder.get_object('bottom_margin_spinner');
        bottomMargin.set_value(this._settings.get_int('vertical-margin-bottom'));
        bottomMargin.connect('value-changed', () => {
            this._settings.set_int('vertical-margin-bottom', bottomMargin.get_value());
        });

        let vSens = this.builder.get_object('vertical-sensitivity');
        let hSens = this.builder.get_object('horizontal-sensitivity');
        let [sx, sy] = this._settings.get_value('swipe-sensitivity').deep_unpack();
        hSens.set_value(sx);
        vSens.set_value(sy);
        let sensChanged = () => {
            this._settings.set_value('swipe-sensitivity', new GLib.Variant('ad', [hSens.get_value(), vSens.get_value()]));
        };
        vSens.connect('value-changed', sensChanged);
        hSens.connect('value-changed', sensChanged);


        let vFric = this.builder.get_object('vertical-friction');
        let hFric = this.builder.get_object('horizontal-friction');
        let [fx, fy] = this._settings.get_value('swipe-friction').deep_unpack();
        hFric.set_value(fx);
        vFric.set_value(fy);
        let fricChanged = () => {
            this._settings.set_value('swipe-friction', new GLib.Variant('ad', [hFric.get_value(), vFric.get_value()]));
        };
        vFric.connect('value-changed', fricChanged);
        hFric.connect('value-changed', fricChanged);

        let scratchOverview = this.builder.get_object('scratch-in-overview');
        if (this._settings.get_boolean('only-scratch-in-overview'))
            scratchOverview.set_active_id('only');
        else if (this._settings.get_boolean('disable-scratch-in-overview'))
            scratchOverview.set_active_id('never');
        else
            scratchOverview.set_active_id('always');

        scratchOverview.connect('changed', (obj) => {
            if (obj.get_active_id() == 'only') {
                this._settings.set_boolean('only-scratch-in-overview', true);
                this._settings.set_boolean('disable-scratch-in-overview', false);
            } else if (obj.get_active_id() == 'never') {
                this._settings.set_boolean('only-scratch-in-overview', false);
                this._settings.set_boolean('disable-scratch-in-overview', true);
            } else {
                this._settings.set_boolean('only-scratch-in-overview', false);
                this._settings.set_boolean('disable-scratch-in-overview', false);
            }

        });

        let disableCorner = this.builder.get_object('override-hot-corner');
        disableCorner.state =
            this._settings.get_boolean('override-hot-corner');
        disableCorner.connect('state-set', (obj, state) => {
            this._settings.set_boolean('override-hot-corner',
                state);
        });

        let topbarFollowFocus = this.builder.get_object('topbar-follow-focus');
        topbarFollowFocus.state =
            this._settings.get_boolean('topbar-follow-focus');
        topbarFollowFocus.connect('state-set', (obj, state) => {
            this._settings.set_boolean('topbar-follow-focus',
                state);
        });
        if (this._settings.get_boolean('found-dash-to-panel')) {
            topbarFollowFocus.set_sensitive(false);
            topbarFollowFocus.get_parent().set_tooltip_text("Incompatible with Dash to Panel.");
        }


        // Workspaces

        const defaultBackgroundSwitch = this.builder.get_object('use-default-background');
        defaultBackgroundSwitch.state =
            this._settings.get_boolean('use-default-background');
        defaultBackgroundSwitch.connect('state-set', (obj, state) => {
            this._settings.set_boolean('use-default-background',
                state);
        });
        const backgroundPanelButton = this.builder.get_object('gnome-background-panel');
        backgroundPanelButton.connect('clicked', () => {
            GLib.spawn_async(null, ['gnome-control-center', 'background'],
                GLib.get_environ(),
                GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.DO_NOT_REAP_CHILD,
                null);
        });

        let useDefault = this._settings.get_boolean('use-default-background');

        const workspaceCombo = this.builder.get_object('workspace_combo_text');
        const workspaceStack = this.builder.get_object('workspace_stack');

        this.workspaceNames = wmSettings.get_strv('workspace-names');
        const nWorkspaces = Settings.workspaceList.get_strv('list').length;

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

        // About
        let versionLabel = this.builder.get_object('extension_version');
        let version = Extension.metadata.version.toString();
        versionLabel.set_text(version);
    }

    createWorkspacePage(settings, index) {

        let list = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            focusable: false,
        });
        let nameEntry = new Gtk.Entry();
        let colorButton = new Gtk.ColorButton();

        // Background

        let backgroundBox = new Gtk.Box({spacing: 16});
        let background = createFileChooserButton(
            settings,
            'background',
            'image-x-generic',
            'document-open-symbolic',
            {
                action: Gtk.FileChooserAction.OPEN,
                title: 'Select workspace background',
                filter: this._backgroundFilter,
                select_multiple: false,
                modal: true,
                transient_for: this.window.get_root()
            }
        );
        let clearBackground = new Gtk.Button({
            icon_name: 'edit-clear-symbolic',
            tooltip_text: 'Clear workspace background',
            sensitive: settings.get_string('background') != ''
        });
        backgroundBox.append(background);
        backgroundBox.append(clearBackground);

        let hideTopBarSwitch = new Gtk.Switch({active: !settings.get_boolean('show-top-bar')});

        let directoryBox = new Gtk.Box({spacing: 16});
        let directoryChooser = createFileChooserButton(
            settings,
            'directory',
            'folder',
            'folder-open-symbolic',
            {
                action: Gtk.FileChooserAction.SELECT_FOLDER,
                title: 'Select workspace background',
                select_multiple: false,
                modal: true,
                transient_for: this.window.get_root()
            }
        );
        let clearDirectory = new Gtk.Button({
            icon_name: 'edit-clear-symbolic',
            tooltip_text: 'Clear workspace directory',
            sensitive: settings.get_string('directory') != ''
        });
        directoryBox.append(directoryChooser);
        directoryBox.append(clearDirectory);

        list.append(createRow('Name', nameEntry));
        list.append(createRow('Color', colorButton));
        list.append(createRow('Background', backgroundBox));
        list.append(createRow('Hide top bar', hideTopBarSwitch));
        list.append(createRow('Directory', directoryBox));

        let rgba = new Gdk.RGBA();
        let color = settings.get_string('color');
        let palette = this._settings.get_strv('workspace-colors');
        if (color === '')
            color = palette[index % palette.length];

        rgba.parse(color);
        colorButton.set_rgba(rgba);

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

        clearBackground.connect('clicked', () => {
            settings.reset('background');
        });

        settings.connect('changed::background', () => {
            clearBackground.sensitive = settings.get_string('background') != '';
        });

        hideTopBarSwitch.connect('state-set', (gtkswitch_, state) => {
            settings.set_boolean('show-top-bar', !state);
        });

        clearDirectory.connect('clicked', () => {
            settings.reset('directory');
        });

        settings.connect('changed::directory', () => {
            clearDirectory.sensitive = settings.get_string('directory') != '';
        });

        return list;
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
    let box = new Gtk.Box({
        margin_start: margin, margin_end: margin,
        margin_top: margin/2, margin_bottom: margin/2,
        orientation: Gtk.Orientation.HORIZONTAL
    });
    let label = new Gtk.Label({
        label: text, hexpand: true, xalign: 0
    });

    box.append(label);
    box.append(widget);

    return box;
}

function createKeybindingSection(settings, searchEntry) {
    let model = new Gtk.ListStore();
}

function createKeybindingWidget(settings, searchEntry) {
    let model = new Gtk.TreeStore();
    let filteredModel = new Gtk.TreeModelFilter({child_model: model});
    filteredModel.set_visible_func(
        (model, iter) => {
            let desc = model.get_value(iter, COLUMN_DESCRIPTION);

            if(getOk(model.iter_parent(iter)) || desc === null) {
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
    treeView.set_enable_search(false);
    treeView.model = filteredModel;
    treeView.headers_visible = false;
    treeView.margin_start = 12;
    treeView.margin_end = 12;
    treeView.search_column = COLUMN_DESCRIPTION;
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
                let iter = getOk(filteredModel.get_iter_from_string(path));
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
                    accels[index] = accelString;
                }
                settings.set_strv(id, accels);

                let newEmptyRow = null, parent;
                if (index === -1) {
                    model.set_value(iter, COLUMN_INDEX, accels.length-1);
                    model.set_value(iter, COLUMN_DESCRIPTION, "...");

                    let parent = getOk(model.iter_parent(iter));
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
                let iter = getOk(filteredModel.get_iter_from_string(path));
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
                    parent = getOk(model.iter_parent(iter));
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
        let iter = getOk(filteredModel.get_iter_from_string(path));
        if(!iter)
            return;
        iter = filteredModel.convert_iter_to_child_iter(iter);

        let id = model.get_value(iter, COLUMN_ID);
        if (settings.get_user_value(id)) {
            settings.reset(id);
            model.set_value(iter, COLUMN_RESET, false);
        }

        let parent = getOk(model.iter_parent(iter)) || iter.copy();
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
        accelerator = accelerator.replace('Above_Tab', 'grave');
    }

    [ok, key, mods] = Gtk.accelerator_parse(accelerator);

    log(`PaperWM: parseAccelerator(${accelerator}) -> [${key}, ${mods}]`);

    return [key, mods];
}

function transpose(colValPairs) {
    let colKeys = [], values = [];
    colValPairs.forEach(([k, v]) => {
        colKeys.push(k); values.push(v);
    });
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
            return true;
        let combo = Settings.keystrToKeycombo(accels[index]);

        let conflict = warning(id, combo);
        let tooltip = null;
        if (conflict.length > 0) {
            let keystr = Settings.keycomboToKeylab(combo);
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

function createFileChooserButton(settings, key, iconName, symbolicIconName, properties) {
    const buttonIcon = Gtk.Image.new_from_icon_name(iconName);
    const buttonLabel = new Gtk.Label();
    const buttonBox = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 8
    });

    buttonBox.append(buttonIcon);
    buttonBox.append(buttonLabel);
    if (symbolicIconName) {
        buttonBox.append(new Gtk.Image({icon_name: symbolicIconName, margin_start: 8}));
    }

    const button = new Gtk.Button({child: buttonBox});

    syncStringSetting(settings, key, path => {
        buttonIcon.visible = path != '';
        buttonLabel.label = path == '' ? '(None)' : GLib.filename_display_basename(path);
    });
    button.connect('clicked', () => {
        const chooser = new Gtk.FileChooserDialog(properties);
        let path = settings.get_string(key);
        if (path != '') chooser.set_file(Gio.File.new_for_path(path));
        chooser.add_button('Open', Gtk.ResponseType.OK);
        chooser.add_button('Cancel', Gtk.ResponseType.CANCEL);
        chooser.connect('response', (dialog, response) => {
            if (response === Gtk.ResponseType.OK) {
                settings.set_string(key, chooser.get_file().get_path());
            }
            chooser.destroy();
        });
        chooser.show();
    });
    return button;
}

function syncStringSetting(settings, key, callback) {
    settings.connect('changed::' + key, () => {
        callback(settings.get_string(key));
    });
    callback(settings.get_string(key));
}

function init() {
    const provider = new Gtk.CssProvider();
    provider.load_from_path(Extension.dir.get_path() + '/resources/prefs.css');
    Gtk.StyleContext.add_provider_for_display(
        Gdk.Display.get_default(),
        provider,
        Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
    );
}

function fillPreferencesWindow(window) {
    log(`fill ${window}`)
    let selectedWorkspace = null;
    try {
        const tempFile = Gio.File.new_for_path(GLib.get_tmp_dir()).get_child('paperwm.workspace');
        [, contents] = tempFile.load_contents(null);
        const decoder = new TextDecoder('utf-8');
        const contentsString = decoder.decode(contents);
        let workspaceN = parseInt(contentsString);
        if (!isNaN(workspaceN)) {
            selectedWorkspace = workspaceN;
        }
        tempFile.delete(null);
    } catch (e) { }

    let selectedTab = selectedWorkspace !== null ? 1 : 0;
    new SettingsWidget(window, selectedTab, selectedWorkspace || 0);
}
