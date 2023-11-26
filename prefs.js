import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {
    ExtensionPreferences
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import * as Settings from './settings.js';
import { WorkspaceSettings } from './workspace.js';
import * as KeybindingsPane from './prefsKeybinding.js';
import * as WinpropsPane from './winpropsPane.js';

const _ = s => s;

export default class PaperWMPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const provider = new Gtk.CssProvider();
        provider.load_from_path(`${this.path}/resources/prefs.css`);
        Gtk.StyleContext.add_provider_for_display(
            Gdk.Display.get_default(),
            provider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
        );

        let selectedWorkspace = null;
        try {
            const tempFile = Gio.File.new_for_path(GLib.get_tmp_dir()).get_child('paperwm.workspace');
            let [, contents] = tempFile.load_contents(null);
            const decoder = new TextDecoder('utf-8');
            const contentsString = decoder.decode(contents);
            let workspaceN = parseInt(contentsString);
            if (!isNaN(workspaceN)) {
                selectedWorkspace = workspaceN;
            }
            tempFile.delete(null);
        } catch (e) { }

        let selectedTab = selectedWorkspace !== null ? 1 : 0;
        window.set_size_request(626, 700);
        new SettingsWidget(
            this,
            window,
            selectedTab,
            selectedWorkspace || 0);
    }
}

class SettingsWidget {
    /**
       selectedWorkspace: index of initially selected workspace in workspace settings tab
       selectedTab: index of initially shown tab
     */
    constructor(extension, prefsWindow, selectedPage = 0, selectedWorkspace = 0) {
        this.extension = extension;
        this._settings = extension.getSettings();
        this.workspaceSettings = new WorkspaceSettings(extension);
        const wmSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.wm.preferences' });
        this.builder = Gtk.Builder.new_from_file(`${extension.path}/Settings.ui`);
        this.window = prefsWindow;

        const pages = [
            this.builder.get_object('general_page'),
            this.builder.get_object('workspaces_page'),
            this.builder.get_object('keybindings_page'),
            this.builder.get_object('winprops_page'),
            this.builder.get_object('advanced_page'),
        ];

        pages.forEach(page => prefsWindow.add(page));
        prefsWindow.set_visible_page(pages[selectedPage]);

        this.aboutButton = this.builder.get_object('about_button');
        this._backgroundFilter = new Gtk.FileFilter();
        this._backgroundFilter.add_pixbuf_formats();

        // value-changed methods
        const booleanStateChanged = (key, inverted = false) => {
            const builder = this.builder.get_object(key);
            builder.active = inverted
                ? !this._settings.get_boolean(key) : this._settings.get_boolean(key);
            builder.connect('state-set', (obj, state) => {
                this._settings.set_boolean(key, inverted ? !state : state);
            });
        };

        const intValueChanged = (builderKey, settingKey) => {
            const builder = this.builder.get_object(builderKey);
            const value = this._settings.get_int(settingKey);
            builder.set_value(value);
            builder.connect('value-changed', () => {
                this._settings.set_int(settingKey, builder.get_value());
            });
        };

        const doubleValueChanged = (builderKey, settingKey) => {
            const builder = this.builder.get_object(builderKey);
            const value = this._settings.get_double(settingKey);
            builder.set_value(value);
            builder.connect('value-changed', () => {
                this._settings.set_double(settingKey, builder.get_value());
            });
        };

        const percentValueChanged = (builderKey, settingKey) => {
            const builder = this.builder.get_object(builderKey);
            const value = this._settings.get_double(settingKey);
            builder.set_value(value * 100.0);
            builder.connect('value-changed', () => {
                this._settings.set_double(settingKey, builder.get_value() / 100.0);
            });
        };

        const enumOptionsChanged = (settingKey, optionNumberEnum, defaultOption, defaultNumber) => {
            const builder = this.builder.get_object(settingKey);
            const setting = this._settings.get_int(settingKey);
            const numberOptionEnum = Object.fromEntries(
                Object.entries(optionNumberEnum).map(a => a.reverse())
            );

            builder.set_active_id(numberOptionEnum[setting] ?? defaultOption);
            builder.connect('changed', obj => {
                const value = optionNumberEnum[obj.get_active_id()] ?? defaultNumber;
                this._settings.set_int(settingKey, value);
            });
        };

        const gestureFingersChanged = key => {
            const builder = this.builder.get_object(key);
            const setting = this._settings.get_int(key);
            const valueToFingers = {
                0: 'fingers-disabled',
                3: 'three-fingers',
                4: 'four-fingers',
            };
            const fingersToValue = Object.fromEntries(
                Object.entries(valueToFingers).map(a => a.reverse())
            );

            builder.set_active_id(valueToFingers[setting] ?? 'fingers-disable');
            builder.connect('changed', obj => {
                const value = fingersToValue[obj.get_active_id()] ?? 0;
                this._settings.set_int(key, value);
            });
        };

        // General
        intValueChanged('window_gap_spin', 'window-gap');
        intValueChanged('hmargin_spinner', 'horizontal-margin');
        intValueChanged('top_margin_spinner', 'vertical-margin');
        intValueChanged('bottom_margin_spinner', 'vertical-margin-bottom');

        // processing function for cycle values
        let cycleProcessor = (elementName, settingName, resetElementName) => {
            let element = this.builder.get_object(elementName);
            let steps = this._settings.get_value(settingName).deep_unpack();

            // need to check if current values are ratio or pixel ==> assume if all <=1 is ratio
            let isRatio = steps.every(v => v <= 1);
            let value;
            if (isRatio) {
                value = steps.map(v => `${(v * 100.0).toString()}%`).toString();
            } else {
                value = steps.map(v => `${v.toString()}px`).toString();
            }
            element.set_text(value.replaceAll(',', '; '));

            element.connect('changed', () => {
                // process values
                // check if values are percent or pixel
                let value = element.get_text();
                let isPercent = value.split(';').map(v => v.trim()).every(v => /^.*%$/.test(v));
                let isPixels = value.split(';').map(v => v.trim()).every(v => /^.*px$/.test(v));
                if (isPercent && isPixels) {
                    console.error("cycle width/height values cannot mix percentage and pixel values");
                    element.add_css_class('error');
                    return;
                }
                if (!isPercent && !isPixels) {
                    console.error("no cycle width/height value units present");
                    element.add_css_class('error');
                    return;
                }

                // now process element value into internal array
                let varr = value
                    .split(';')
                    .map(v => v.trim())
                    .map(v => v.replaceAll(/[^\d.]/g, '')) // strip everything but digits and period
                    .filter(v => v.length > 0) // needed to remove invalid inputs
                    .map(Number) // only accept valid numbers
                    .map(v => isPercent ? v / 100.0 : v)
                    .sort((a, b) => a - b); // sort values to ensure monotonicity

                // check to make sure if percent than input cannot be > 100%
                if (isPercent && varr.some(v => v > 1)) {
                    console.error("cycle width/height percent inputs cannot be greater than 100%");
                    element.add_css_class('error');
                    return;
                }
                element.remove_css_class('error');

                this._settings.set_value(settingName, new GLib.Variant('ad', varr));
            });
            this.builder.get_object(resetElementName).connect('clicked', () => {
                // text value here should match the gshema value for cycle-width-steps
                element.set_text('38.195%; 50%; 61.804%');
            });
        };
        cycleProcessor('cycle_widths_entry', 'cycle-width-steps', 'cycle_widths_reset_button');
        cycleProcessor('cycle_heights_entry', 'cycle-height-steps', 'cycle_heights_reset_button');

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

        doubleValueChanged('animation_time_spin', 'animation-time');
        percentValueChanged('minimap_scale_spin', 'minimap-scale');
        percentValueChanged('edge_scale_spin', 'edge-preview-scale');
        percentValueChanged('window_switcher_preview_scale_spin', 'window-switcher-preview-scale');

        const openWindowPosition = this.builder.get_object('open-window-position');
        const owpos = this._settings.get_int('open-window-position');
        switch (owpos) {
        case Settings.OpenWindowPositions.LEFT:
            openWindowPosition.set_active_id('left');
            break;
        case Settings.OpenWindowPositions.START:
            openWindowPosition.set_active_id('start');
            break;
        case Settings.OpenWindowPositions.END:
            openWindowPosition.set_active_id('end');
            break;
        default:
            openWindowPosition.set_active_id('right');
        }

        openWindowPosition.connect('changed', obj => {
            switch (obj.get_active_id()) {
            case 'left':
                this._settings.set_int('open-window-position', Settings.OpenWindowPositions.LEFT);
                break;
            case 'start':
                this._settings.set_int('open-window-position', Settings.OpenWindowPositions.START);
                break;
            case 'end':
                this._settings.set_int('open-window-position', Settings.OpenWindowPositions.END);
                break;
            default:
                this._settings.set_int('open-window-position', Settings.OpenWindowPositions.RIGHT);
            }
        });

        const scratchOverview = this.builder.get_object('scratch-in-overview');
        if (this._settings.get_boolean('only-scratch-in-overview'))
            scratchOverview.set_active_id('only');
        else if (this._settings.get_boolean('disable-scratch-in-overview'))
            scratchOverview.set_active_id('never');
        else
            scratchOverview.set_active_id('always');

        scratchOverview.connect('changed', obj => {
            if (obj.get_active_id() === 'only') {
                this._settings.set_boolean('only-scratch-in-overview', true);
                this._settings.set_boolean('disable-scratch-in-overview', false);
            } else if (obj.get_active_id() === 'never') {
                this._settings.set_boolean('only-scratch-in-overview', false);
                this._settings.set_boolean('disable-scratch-in-overview', true);
            } else {
                this._settings.set_boolean('only-scratch-in-overview', false);
                this._settings.set_boolean('disable-scratch-in-overview', false);
            }
        });

        booleanStateChanged('show-window-position-bar');

        const enableGnomePill = this.builder.get_object('use-gnome-pill');
        enableGnomePill.active = !this._settings.get_boolean('show-workspace-indicator');
        enableGnomePill.connect('state-set', (obj, state) => {
            this._settings.set_boolean('show-workspace-indicator', !state);
        });

        // Workspaces
        booleanStateChanged('use-default-background');

        const backgroundPanelButton = this.builder.get_object('gnome-background-panel');
        backgroundPanelButton.connect('clicked', () => {
            GLib.spawn_async(null, ['gnome-control-center', 'background'],
                GLib.get_environ(),
                GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.DO_NOT_REAP_CHILD,
                null);
        });

        const workspaceCombo = this.builder.get_object('workspace_combo_text');
        const workspaceStack = this.builder.get_object('workspace_stack');
        const nWorkspaces = this.workspaceSettings.getWorkspaceList().get_strv('list').length;

        // Note: For some reason we can't set the visible child of the workspace
        //       stack at construction time.. (!)
        //       Ensure the initially selected workspace is added to the stack
        //       first as a workaround.
        let wsIndices = this.range(nWorkspaces);
        let wsSettingsByIndex = wsIndices.map(i => this.workspaceSettings.getWorkspaceSettings(i)[1]);
        let wsIndicesSelectedFirst =
            this.swapArrayElements(wsIndices.slice(), 0, selectedWorkspace);

        for (let i of wsIndicesSelectedFirst) {
            let view = this.createWorkspacePage(wsSettingsByIndex[i], i);
            workspaceStack.add_named(view, i.toString());
        }

        for (let i of wsIndices) {
            // Combo box entries in normal workspace index order
            let name = this.getWorkspaceName(wsSettingsByIndex[i], i);
            workspaceCombo.append_text(name);
        }

        this.builder.get_object('workspace_reset_button').connect('clicked', () => {
            this._updatingName = true;
            wmSettings.set_strv('workspace-names', []);

            let settings = i => wsSettingsByIndex[i];
            let name = (s, i) => this.getWorkspaceName(s, i);
            workspaceCombo.remove_all();
            for (let i of wsIndices) {
                settings(i).reset('name');
                workspaceCombo.append_text(name(settings(i), i));
            }

            // update pages
            for (let j of wsIndicesSelectedFirst) {
                let view = workspaceStack.get_child_by_name(j.toString());
                let nameEntry = view.get_first_child().get_last_child();
                nameEntry.set_text(name(settings(j), j));
            }
            this._updatingName = false;

            workspaceCombo.set_active(0);
        });

        workspaceCombo.connect('changed', () => {
            if (this._updatingName)
                return;

            let active = workspaceCombo.get_active();
            workspaceStack.set_visible_child_name(active.toString());
        });

        workspaceCombo.set_active(selectedWorkspace);

        // Keybindings
        let keybindingsPane = this.builder.get_object('keybindings_pane');
        keybindingsPane.init(extension);

        // Winprops
        let winprops = this._settings.get_value('winprops').deep_unpack()
            .map(p => JSON.parse(p));
        // sort a little nicer
        let valueFn = wp =>  {
            if (wp.wm_class) {
                return wp.wm_class;
            }
            if (wp.title) {
                return wp.title;
            }
            return '';
        };
        winprops.sort((a, b) => {
            let aa = valueFn(a).replaceAll(/[/]/g, '');
            let bb = valueFn(b).replaceAll(/[/]/g, '');
            return aa.localeCompare(bb);
        });
        let winpropsPane = this.builder.get_object('winpropsPane');
        winpropsPane.addWinprops(winprops);
        winpropsPane.connect('changed', () => {
            // update gsettings with changes
            let rows = winpropsPane.rows
                .filter(r => r.checkHasWmClassOrTitle())
                .map(r => JSON.stringify(r.winprop));

            this._settings.set_value('winprops', new GLib.Variant('as', rows));
        });

        // Advanced
        booleanStateChanged('gesture-enabled');

        const fingerOptions = {
            'fingers-disabled': 0,
            'three-fingers': 3,
            'four-fingers': 4,
        };
        const fingerOptionDefault = 'fingers-disabled';
        const fingerNumberDefault = 0;
        enumOptionsChanged('gesture-horizontal-fingers', fingerOptions, fingerOptionDefault, fingerNumberDefault);
        enumOptionsChanged('gesture-workspace-fingers', fingerOptions, fingerOptionDefault, fingerNumberDefault);
        enumOptionsChanged(
            'default-focus-mode',
            {
                'default': 0,
                'center': 1,
            },
            'default',
            0);

        enumOptionsChanged(
            'overview-ensure-viewport-animation',
            {
                'none': 0,
                'translate': 1,
                'fade': 2,
            },
            'translate',
            1);

        booleanStateChanged('show-focus-mode-icon');
        booleanStateChanged('disable-topbar-styling', true);
        // disabled since opposite of gnome-pill
        // booleanSetState('show-workspace-indicator');
        percentValueChanged('maximize-width-percent', 'maximize-width-percent');

        // About
        let versionLabel = this.builder.get_object('extension_version');
        let version = this.extension.metadata.version?.toString() ?? '?';
        versionLabel.set_text(version);
    }

    range(n) {
        let r = [];
        for (let i = 0; i < n; i++)
            r.push(i);
        return r;
    }

    swapArrayElements(array, i, j) {
        let iVal = array[i];
        array[i] = array[j];
        array[j] = iVal;
        return array;
    }

    createWorkspacePage(settings, index) {
        let list = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            focusable: false,
        });
        let nameEntry = new Gtk.Entry();
        let colorButton = new Gtk.ColorButton();

        // Background

        let backgroundBox = new Gtk.Box({ spacing: 16 });
        let background = this.createFileChooserButton(
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
                transient_for: this.window.get_root(),
            }
        );
        let clearBackground = new Gtk.Button({
            icon_name: 'edit-clear-symbolic',
            tooltip_text: 'Clear workspace background',
            sensitive: settings.get_string('background') !== '',
        });
        backgroundBox.append(background);
        backgroundBox.append(clearBackground);

        let hideTopBarSwitch = new Gtk.Switch({ active: !settings.get_boolean('show-top-bar') });

        let directoryBox = new Gtk.Box({ spacing: 16 });
        let directoryChooser = this.createFileChooserButton(
            settings,
            'directory',
            'folder',
            'folder-open-symbolic',
            {
                action: Gtk.FileChooserAction.SELECT_FOLDER,
                title: 'Select workspace background',
                select_multiple: false,
                modal: true,
                transient_for: this.window.get_root(),
            }
        );
        let clearDirectory = new Gtk.Button({
            icon_name: 'edit-clear-symbolic',
            tooltip_text: 'Clear workspace directory',
            sensitive: settings.get_string('directory') !== '',
        });
        directoryBox.append(directoryChooser);
        directoryBox.append(clearDirectory);

        list.append(this.createRow('Name', nameEntry));
        list.append(this.createRow('Color', colorButton));
        list.append(this.createRow('Background', backgroundBox));
        list.append(this.createRow('Hide top bar', hideTopBarSwitch));
        list.append(this.createRow('Directory', directoryBox));

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
            if (this._updatingName) {
                return;
            }
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
        return this.workspaceSettings.getWorkspaceName(settings, index);
    }

    createRow(text, widget) {
        let margin = 12;
        let box = new Gtk.Box({
            margin_start: margin, margin_end: margin,
            margin_top: margin / 2, margin_bottom: margin / 2,
            orientation: Gtk.Orientation.HORIZONTAL,
        });
        let label = new Gtk.Label({
            label: text, hexpand: true, xalign: 0,
        });

        box.append(label);
        box.append(widget);

        return box;
    }

    createFileChooserButton(settings, key, iconName, symbolicIconName, properties) {
        const buttonIcon = Gtk.Image.new_from_icon_name(iconName);
        const buttonLabel = new Gtk.Label();
        const buttonBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 8,
        });

        buttonBox.append(buttonIcon);
        buttonBox.append(buttonLabel);
        if (symbolicIconName) {
            buttonBox.append(new Gtk.Image({ icon_name: symbolicIconName, margin_start: 8 }));
        }

        const button = new Gtk.Button({ child: buttonBox });

        this.syncStringSetting(settings, key, path => {
            buttonIcon.visible = path !== '';
            buttonLabel.label = path === '' ? '(None)' : GLib.filename_display_basename(path);
        });
        button.connect('clicked', () => {
            const chooser = new Gtk.FileChooserDialog(properties);
            let path = settings.get_string(key);
            if (path !== '')
                chooser.set_file(Gio.File.new_for_path(path));
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

    syncStringSetting(settings, key, callback) {
        settings.connect(`changed::${key}`, () => {
            callback(settings.get_string(key));
        });
        callback(settings.get_string(key));
    }
}
