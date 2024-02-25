import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import { AcceleratorParse } from './acceleratorparse.js';

const _ = s => s;

const KEYBINDINGS_KEY = 'org.gnome.shell.extensions.paperwm.keybindings';

const sections = {
    windows: 'Windows',
    workspaces: 'Workspaces',
    monitors: 'Monitors',
    scratch: 'Scratch layer',
};

const actions = {
    windows: [
        'new-window',
        'close-window',
        'switch-next',
        'switch-previous',
        'switch-left',
        'switch-right',
        'switch-up',
        'switch-down',
        'switch-next-loop',
        'switch-previous-loop',
        'switch-left-loop',
        'switch-right-loop',
        'switch-up-loop',
        'switch-down-loop',
        'switch-global-left',
        'switch-global-right',
        'switch-global-up',
        'switch-global-down',
        'switch-first',
        'switch-last',
        'live-alt-tab',
        'live-alt-tab-backward',
        'live-alt-tab-scratch',
        'live-alt-tab-scratch-backward',
        'switch-focus-mode',
        'move-left',
        'move-right',
        'move-up',
        'move-down',
        'slurp-in',
        'barf-out',
        'center-horizontally',
        'paper-toggle-fullscreen',
        'toggle-maximize-width',
        'resize-h-inc',
        'resize-h-dec',
        'resize-w-inc',
        'resize-w-dec',
        'cycle-width',
        'cycle-width-backwards',
        'cycle-height',
        'cycle-height-backwards',
        'take-window',
        'activate-window-under-cursor',
    ],
    workspaces: [
        'previous-workspace',
        'previous-workspace-backward',
        'move-previous-workspace',
        'move-previous-workspace-backward',
        'switch-up-workspace',
        'switch-down-workspace',
        'switch-up-workspace-from-all-monitors',
        'switch-down-workspace-from-all-monitors',
        'move-up-workspace',
        'move-down-workspace',
    ],
    monitors: [
        'switch-monitor-right',
        'switch-monitor-left',
        'switch-monitor-above',
        'switch-monitor-below',
        'swap-monitor-right',
        'swap-monitor-left',
        'swap-monitor-above',
        'swap-monitor-below',
        'move-monitor-right',
        'move-monitor-left',
        'move-monitor-above',
        'move-monitor-below',
    ],
    scratch: [
        'toggle-scratch-layer',
        'toggle-scratch',
        'toggle-scratch-window',
    ],
};

const forbiddenKeyvals = [
    Gdk.KEY_Home,
    Gdk.KEY_Left,
    Gdk.KEY_Up,
    Gdk.KEY_Right,
    Gdk.KEY_Down,
    Gdk.KEY_Page_Up,
    Gdk.KEY_Page_Down,
    Gdk.KEY_End,
    Gdk.KEY_Tab,
    Gdk.KEY_KP_Enter,
    Gdk.KEY_Return,
    Gdk.KEY_Mode_switch,
];

function isValidBinding(combo) {
    if ((combo.mods === 0 || combo.mods === Gdk.ModifierType.SHIFT_MASK) && combo.keycode !== 0) {
        const keyval = combo.keyval;
        if ((keyval >= Gdk.KEY_a && keyval <= Gdk.KEY_z) ||
            (keyval >= Gdk.KEY_A && keyval <= Gdk.KEY_Z) ||
            (keyval >= Gdk.KEY_0 && keyval <= Gdk.KEY_9) ||
            (keyval >= Gdk.KEY_kana_fullstop && keyval <= Gdk.KEY_semivoicedsound) ||
            (keyval >= Gdk.KEY_Arabic_comma && keyval <= Gdk.KEY_Arabic_sukun) ||
            (keyval >= Gdk.KEY_Serbian_dje && keyval <= Gdk.KEY_Cyrillic_HARDSIGN) ||
            (keyval >= Gdk.KEY_Greek_ALPHAaccent && keyval <= Gdk.KEY_Greek_omega) ||
            (keyval >= Gdk.KEY_hebrew_doublelowline && keyval <= Gdk.KEY_hebrew_taf) ||
            (keyval >= Gdk.KEY_Thai_kokai && keyval <= Gdk.KEY_Thai_lekkao) ||
            (keyval >= Gdk.KEY_Hangul_Kiyeog && keyval <= Gdk.KEY_Hangul_J_YeorinHieuh) ||
            (keyval === Gdk.KEY_space && combo.mods === 0) ||
            forbiddenKeyvals.includes(keyval)) {
            return false;
        }
    }

    // Allow Tab in addition to accelerators allowed by GTK
    if (!Gtk.accelerator_valid(combo.keyval, combo.mods) &&
        (combo.keyval !== Gdk.KEY_Tab || combo.mods === 0)) {
        return false;
    }

    return true;
}

function isEmptyBinding(combo) {
    return combo.keyval === 0 && combo.mods === 0 && combo.keycode === 0;
}

const Combo = GObject.registerClass({
    GTypeName: 'Combo',
    Properties: {
        keycode: GObject.ParamSpec.uint(
            'keycode',
            'Keycode',
            'Key code',
            GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT_ONLY,
            0,
            GLib.MAXUINT32,
            0
        ),
        keyval: GObject.ParamSpec.uint(
            'keyval',
            'Keyval',
            'Key value',
            GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT_ONLY,
            0,
            GLib.MAXUINT32,
            0
        ),
        mods: GObject.ParamSpec.uint(
            'mods',
            'Mods',
            'Key modifiers',
            GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT_ONLY,
            0,
            GLib.MAXUINT32,
            0
        ),
        keystr: GObject.ParamSpec.string(
            'keystr',
            'Keystr',
            'Key string',
            GObject.ParamFlags.READABLE,
            null
        ),
        label: GObject.ParamSpec.string(
            'label',
            'Label',
            'Key label',
            GObject.ParamFlags.READABLE,
            null
        ),
        disabled: GObject.ParamSpec.boolean(
            'disabled',
            'Disabled',
            'Disabled sentinel',
            GObject.ParamFlags.READABLE,
            false
        ),
        placeholder: GObject.ParamSpec.boolean(
            'placeholder',
            'Placeholder',
            'Placeholder sentinel',
            GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT_ONLY,
            false
        ),
    },
}, class Combo extends GObject.Object {
    _init(params, acceleratorParse) {
        super._init(params);
        this.acceleratorParse = acceleratorParse;
    }

    get keycode() {
        if (this.disabled) {
            return 0;
        } else if (!this._keycode) {
            let [ok, key, mask] = this.acceleratorParse.accelerator_parse(this.keystr);

            if (ok && key.length) {
                return key;
            } else {
                return 0;
            }
        } else {
            return this._keycode;
        }
    }

    get keystr() {
        if (this.disabled)
            return '';
        else
            return Gtk.accelerator_name(this.keyval, this.mods);
    }

    get label() {
        if (this.disabled)
            return _('Disabled');
        else
            return Gtk.accelerator_get_label(this.keyval, this.mods);
    }

    get disabled() {
        return !this.keyval && !this.mods;
    }

    toString() {
        return `Combo(keycode=${this.keycode}, keyval=${this.keyval}, mods=${this.mods})`;
    }
});

const Keybinding = GObject.registerClass({
    GTypeName: 'Keybinding',
    Implements: [Gio.ListModel],
    Properties: {
        section: GObject.ParamSpec.string(
            'section',
            'Section',
            'Keybinding section title',
            GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT_ONLY,
            null
        ),
        action: GObject.ParamSpec.string(
            'action',
            'Action',
            'Keybinding action ID',
            GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT_ONLY,
            null
        ),
        description: GObject.ParamSpec.string(
            'description',
            'Description',
            'Keybinding action description',
            GObject.ParamFlags.READABLE,
            null
        ),
        label: GObject.ParamSpec.string(
            'label',
            'Label',
            'Keybinding combo label',
            GObject.ParamFlags.READABLE,
            null
        ),
        combos: GObject.ParamSpec.object(
            'combos',
            'Combos',
            'Key combos',
            GObject.ParamFlags.READABLE,
            Gio.ListModel.$gtype
        ),
        modified: GObject.ParamSpec.boolean(
            'modified',
            'Modified',
            'True if the user has modified the shortcut from its default value',
            GObject.ParamFlags.READABLE,
            false
        ),
        enabled: GObject.ParamSpec.boolean(
            'enabled',
            'Enabled',
            'True if this keybinding has any shortcuts',
            GObject.ParamFlags.READABLE,
            false
        ),
    },
    Signals: {
        changed: {},
    },
}, class Keybinding extends GObject.Object {
    _init(params = {}, settings, acceleratorParse) {
        super._init(params);
        this._settings = settings;
        this.acceleratorParse = acceleratorParse;
        this._description = _(this._settings.settings_schema.get_key(this.action).get_summary());

        this._combos = new Gio.ListStore();
        this._combos.connect('items-changed', (_, position, removed, added) => {
            this.items_changed(position, removed, added);
            this.notify('label');
        });

        this._settings.connect(`changed::${this.action}`, () => this._load());
        GLib.idle_add(0, () => this._load());
    }

    get description() {
        return this._description;
    }

    get label() {
        const labels = [...this.combos]
              .filter(c => !isEmptyBinding(c))
              .map(c => c.label);

        let label = '';
        if (labels.length === 0) {
            label = _('Disabled');
        } else {
            label = labels.join(', ');
        }

        if (this.modified) {
            label = `<b>${label}</b>`;
        }

        return label;
    }

    get combos() {
        return this._combos;
    }

    get modified() {
        return this._settings.get_user_value(this.action) !== null;
    }

    get enabled() {
        return [...this.combos].some(c => !c.disabled);
    }

    vfunc_get_item_type() {
        return Combo.$gtype;
    }

    vfunc_get_item(position) {
        return this.combos.get_item(position);
    }

    vfunc_get_n_items() {
        return this.combos.get_n_items();
    }

    add(combo) {
        const [found, _] = this.find(combo);
        if (found)
            return;
        this.combos.append(combo);
        if (!combo.disabled) {
            this._store();
        }
    }

    remove(combo) {
        const [found, pos] = this.find(combo);
        if (!found)
            return;
        this.combos.remove(pos);
        if (this.combos.get_n_items() === 0)
            this.combos.append(new Combo({}, this.acceleratorParse));
        this._store();
    }

    replace(oldCombo, newCombo) {
        const [found, _] = this.find(newCombo);
        if (found)
            return;
        const [oldFound, pos] = this.find(oldCombo);
        if (oldFound) {
            this.combos.splice(pos, 1, [newCombo]);
        } else {
            this.combos.append(newCombo);
        }
        this._store();
    }

    disable() {
        this._settings.set_strv(this.action, ['']);
    }

    reset() {
        if (this._settings.get_user_value(this.action)) {
            this._settings.reset(this.action);
        }
    }

    find(combo) {
        const pos = [...this.combos].findIndex(c => c.keystr === combo.keystr);
        if (pos === -1) {
            return [false];
        } else {
            return [true, pos];
        }
    }

    _load() {
        const keystrs = this._settings.get_strv(this.action) || [];
        let combos = keystrs
            .map(this._translateAboveTab)
            .map(keystr => {
                if (keystr !== '')
                    return this.acceleratorParse.accelerator_parse(keystr);
                else
                    return [true, 0, 0];
            })
            .map(([, keyval, mods]) => new Combo({ keyval, mods }, this.acceleratorParse));

        if (combos.length === 0) {
            combos.push(new Combo({}, this.acceleratorParse));
        }

        this.combos.splice(0, this.combos.get_n_items(), combos);
    }

    _store() {
        let filtered = [...this.combos]
            .filter(c => !isEmptyBinding(c))
            .map(c => c.keystr);
        if (filtered.length === 0) {
            filtered = [''];
        }
        this._settings.set_strv(this.action, filtered);
    }

    _translateAboveTab(keystr) {
        if (!keystr.match(/Above_Tab/)) {
            return keystr;
        } else {
            let keyvals = aboveTabKeyvals();
            if (!keyvals)
                return keystr.replace('Above_Tab', 'grave');

            let keyname = Gdk.keyval_name(keyvals[0]);
            return keystr.replace('Above_Tab', keyname);
        }
    }
});

export const KeybindingsModel = GObject.registerClass({
    GTypeName: 'KeybindingsModel',
    Implements: [Gio.ListModel],
    Signals: {
        'collisions-changed': {
            flags: GObject.SignalFlags.RUN_LAST | GObject.SignalFlags.DETAILED,
        },
    },
}, class KeybindingsModel extends GObject.Object {
    _init(params = {}, acceleratorParse) {
        super._init(params);
        this.acceleratorParse = acceleratorParse;
        this._model = Gio.ListStore.new(Keybinding.$gtype);
        this._model.connect('items-changed', (_, position, removed, added) => {
            this.items_changed(position, removed, added);
        });

        this._combos = Gtk.FlattenListModel.new(this._model);
        this._combos.connect('items-changed', () => {
            // Room for optimization here.
            this._updateCollisions();
        });

        this._actionToBinding = new Map();
    }

    init(settings) {
        this._settings = settings;
        this.load();
    }

    vfunc_get_item_type() {
        return this._model.get_item_type();
    }

    vfunc_get_item(position) {
        return this._model.get_item(position);
    }

    vfunc_get_n_items() {
        return this._model.get_n_items();
    }

    get collisions() {
        if (this._collisions === undefined) {
            this._collisions = new Map();
            this._updateCollisions();
        }
        return this._collisions;
    }

    getKeybinding(action) {
        return this._actionToBinding.get(action);
    }

    find(binding) {
        return this._model.find(binding);
    }

    load() {
        let bindings = [];
        for (const section in actions) {
            for (const action of actions[section]) {
                const binding = new Keybinding({
                    section,
                    action,
                }, this._settings, this.acceleratorParse);
                bindings.push(binding);
                this._actionToBinding.set(action, binding);
            }
        }
        this._model.splice(0, this._model.get_n_items(), bindings);
    }

    _updateCollisions(position, removed, added) {
        let map = new Map();
        for (const binding of this._model) {
            for (const combo of binding.combos) {
                if (combo.disabled)
                    continue;
                map.set(combo.keystr, (map.get(combo.keystr) || new Set()).add(binding.action));
            }
        }
        let changed = new Set();
        for (const [keystr, actions] of map.entries()) {
            if (actions.size > 1) {
                if (!this.collisions.has(keystr)) {
                    for (const action of actions) {
                        changed.add(action);
                    }
                } else {
                    let old = this.collisions.get(keystr);
                    for (const action of symmetricDifference(old, actions)) {
                        changed.add(action);
                    }
                }
                this.collisions.set(keystr, actions);
            } else {
                for (const action of actions) {
                    changed.add(action);
                }
                this.collisions.delete(keystr);
            }
        }
        if (changed.size > 0) {
            for (const action of changed) {
                this.emit(`collisions-changed::${action}`);
            }
        }
    }
});

const ComboRow = GObject.registerClass({
    GTypeName: 'ComboRow',
    Template: GLib.uri_resolve_relative(import.meta.url, './KeybindingsComboRow.ui', GLib.UriFlags.NONE),
    InternalChildren: [
        'stack',
        'shortcutPage',
        'placeholderPage',
        'editPage',
        'shortcutLabel',
        'deleteButton',
        'conflictButton',
        'conflictList',
    ],
    Properties: {
        keybinding: GObject.ParamSpec.object(
            'keybinding',
            'Keybinding',
            'Keybinding',
            GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT_ONLY,
            Keybinding.$gtype
        ),
        combo: GObject.ParamSpec.object(
            'combo',
            'Combo',
            'Key combo',
            GObject.ParamFlags.READWRITE,
            Combo.$gtype
        ),
        editing: GObject.ParamSpec.boolean(
            'editing',
            'Editing',
            'Editing',
            GObject.ParamFlags.READWRITE,
            false
        ),
    },
    Signals: {
        'collision-activated': {
            param_types: [Keybinding.$gtype],
        },
    },
}, class ComboRow extends Gtk.ListBoxRow {
    _init(params = {}) {
        super._init(params);

        let controller;
        controller = Gtk.EventControllerKey.new();
        controller.connect('key-pressed', (controller, keyval, keycode, state) => {
            this._onKeyPressed(controller, keyval, keycode, state);
        });
        this.add_controller(controller);

        controller = Gtk.EventControllerFocus.new();
        controller.connect('leave', () => {
            this.editing = false;
        });
        this.add_controller(controller);

        this._collisions = Gio.ListStore.new(Keybinding.$gtype);

        this._conflictList.bind_model(this._collisions, binding => this._createConflictRow(binding));

        GLib.idle_add(0, () => this._updateState());
    }

    get combo() {
        if (this._combo === undefined)
            this._combo = null;
        return this._combo;
    }

    set combo(value) {
        if (value && this._combo && this._combo.keystr === value.keystr)
            return;
        this._combo = value;
        this.notify('combo');
        this._updateState();
    }

    get editing() {
        if (this._editing === undefined)
            this._editing = false;
        return this._editing;
    }

    set editing(value) {
        if (this.editing === value)
            return;
        this._editing = value;
        this.notify('editing');
        this._updateState();
    }

    get collisions() {
        return [...this._collisions];
    }

    set collisions(value) {
        this._collisions.splice(0, this._collisions.get_n_items(), value);
    }

    _createConflictRow(binding) {
        return new Gtk.Label({
            label: binding.description,
        });
    }

    _onConflictRowActivated(list, row) {
        const binding = this._collisions.get_item(row.get_index());
        this.emit('collision-activated', binding);
    }

    _grabKeyboard() {
        this.get_root().get_surface().inhibit_system_shortcuts(null);
    }

    _ungrabKeyboard() {
        // using optionals here since may have already been ungrabbed
        this.get_root()?.get_surface()?.restore_system_shortcuts();
    }

    _onDeleteButtonClicked() {
        GLib.idle_add(0, () => this.keybinding.remove(this.combo));
    }

    _onKeyPressed(controller, keyval, keycode, state) {
        // Adapted from Control Center, cc-keyboard-shortcut-editor.c
        if (!this.editing)
            return Gdk.EVENT_PROPAGATE;

        /**
         * Replace KEY_less ("<") with comma, see
         * https://github.com/paperwm/PaperWM/issues/545
         */
        if (keyval === Gdk.KEY_less) {
            keycode = Gdk.KEY_comma;
            keyval = Gdk.KEY_comma;
        }

        let modmask = state & Gtk.accelerator_get_default_mod_mask();
        let keyvalLower = Gdk.keyval_to_lower(keyval);

        // Normalize <Tab>
        if (keyvalLower === Gdk.KEY_ISO_Left_Tab) {
            keyvalLower = Gdk.KEY_Tab;
        }

        // Put Shift back if it changed the case of the key
        if (keyvalLower !== keyval) {
            modmask |= Gdk.ModifierType.SHIFT_MASK;
        }

        if (keyvalLower === Gdk.KEY_Sys_Req && (modmask & Gdk.ModifierType.ALT_MASK) !== 0) {
            // Don't allow SysRq as a keybinding, but allow Alt+Print
            keyvalLower = Gdk.KEY_Print;
        }

        const event = controller.get_current_event();
        const isModifier = event.is_modifier();

        // Escape cancels
        if (!isModifier && modmask === 0 && keyvalLower === Gdk.KEY_Escape) {
            this.editing = false;
            if (this.combo.placeholder) {
                this.keybinding.remove(this.combo);
            }
            return Gdk.EVENT_STOP;
        }

        // Backspace deletes
        if (!isModifier && modmask === 0 && keyvalLower === Gdk.KEY_BackSpace) {
            this._updateKeybinding(new Combo({}, this.acceleratorParse));
            return Gdk.EVENT_STOP;
        }

        // Remove CapsLock
        modmask &= ~Gdk.ModifierType.LOCK_MASK;

        this._updateKeybinding(new Combo({ keycode, keyval: keyvalLower, mods: modmask },
            this.acceleratorParse));

        return Gdk.EVENT_STOP;
    }

    _updateKeybinding(newCombo) {
        let isValid = isValidBinding(newCombo);
        let isEmpty = isEmptyBinding(newCombo);

        const oldCombo = this.combo;
        if (isEmptyBinding(oldCombo) && isValid) {
            this.editing = false;
            this.keybinding.add(newCombo);
            return;
        }

        if (isEmpty) {
            this.editing = false;
            this.keybinding.remove(oldCombo);
            return;
        }

        if (isValid) {
            this.editing = false;
            this.keybinding.replace(oldCombo, newCombo);
        }
    }

    _updateState() {
        if (!this._stack) {
            return;
        }

        if (this.editing) {
            this.add_css_class('editing');
            this._stack.visible_child = this._editPage;
            this.grab_focus();
            this._grabKeyboard();
        } else {
            this.remove_css_class('editing');
            this._stack.visible_child = this._shortcutPage;
            this._ungrabKeyboard();

            if (this._combo && !this._combo.disabled) {
                this._shortcutLabel.accelerator = this._combo.keystr;
                this._deleteButton.visible = true;
                this._conflictButton.visible = this.collisions.length > 0;
            } else {
                this._shortcutLabel.accelerator = '';
                this._deleteButton.visible = false;
            }
        }
    }
});

const KeybindingsRow = GObject.registerClass({
    GTypeName: 'KeybindingsRow',
    Template: GLib.uri_resolve_relative(import.meta.url, './KeybindingsRow.ui', GLib.UriFlags.NONE),
    InternalChildren: [
        'header',
        'descLabel',
        'accelLabel',
        'conflictIcon',
        'revealer',
        'comboList',
    ],
    Properties: {
        keybindings: GObject.ParamSpec.object(
            'keybindings',
            'Keybindings',
            'Keybindings model',
            GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT_ONLY,
            KeybindingsModel.$gtype
        ),
        keybinding: GObject.ParamSpec.object(
            'keybinding',
            'Keybinding',
            'Keybinding',
            GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT_ONLY,
            Keybinding.$gtype
        ),
        expanded: GObject.ParamSpec.boolean(
            'expanded',
            'Expanded',
            'Expanded',
            GObject.ParamFlags.READWRITE,
            false
        ),
        collisions: GObject.ParamSpec.jsobject(
            'collisions',
            'Collisions',
            'Colliding keybindings',
            GObject.ParamFlags.READABLE
        ),
    },
    Signals: {
        'collision-activated': {
            param_types: [Keybinding.$gtype],
        },
    },
}, class KeybindingsRow extends Gtk.ListBoxRow {
    _init(params = {}, acceleratorParse) {
        super._init(params);
        this.acceleratorParse = acceleratorParse;
        this._actionGroup = new Gio.SimpleActionGroup();
        this.insert_action_group('keybinding', this._actionGroup);

        let action;
        action = new Gio.SimpleAction({
            name: 'reset',
            enabled: this.keybinding.modified,
        });
        action.connect('activate', () => this.keybinding.reset());
        this._actionGroup.add_action(action);

        action = new Gio.SimpleAction({ name: 'add' });
        action.connect('activate', () => this.keybinding.add(new Combo({ placeholder: true },
            this.acceleratorParse)));
        this._actionGroup.add_action(action);

        const gesture = Gtk.GestureClick.new();
        gesture.set_button(Gdk.BUTTON_PRIMARY);
        gesture.connect('released', controller => {
            this.expanded = !this.expanded;
            controller.set_state(Gtk.EventSequenceState.CLAIMED);
        });
        this._header.add_controller(gesture);

        this._descLabel.label = this.keybinding.description;
        this._descLabel.tooltip_text = this.keybinding.description;

        this.keybinding.connect('notify::label', () => this._updateState());

        this._comboList.bind_model(this.keybinding, combo => this._createRow(combo));

        this.keybindings.connect(
            `collisions-changed::${this.keybinding.action}`,
            () => { this._onCollisionsChanged(); }
        );

        this._updateState();
    }

    get expanded() {
        if (this._expanded === undefined)
            this._expanded = false;
        return this._expanded;
    }

    set expanded(value) {
        if (this._expanded === value)
            return;

        this._expanded = value;
        this.notify('expanded');
        this._updateState();
    }

    get collisions() {
        if (this._collisions === undefined) {
            this._collisions = new Map();
        }
        return this._collisions;
    }

    _createRow(combo) {
        const row = new ComboRow({
            keybinding: this.keybinding,
            combo,
        });
        if (combo.placeholder) {
            GLib.idle_add(0, () => { row.editing = true; });
        }
        this.connect('notify::collisions', () => {
            row.collisions = this.collisions.get(combo.keystr) || [];
        });
        row.connect('collision-activated', (_, binding) => {
            this.emit('collision-activated', binding);
        });
        return row;
    }

    _onCollisionsChanged() {
        const map = new Map();
        const collisions = this.keybindings.collisions;
        for (const combo of this.keybinding.combos) {
            const actions = collisions.get(combo.keystr);
            if (!actions)
                continue;
            map.set(
                combo.keystr,
                [...actions]
                    .filter(a => a !== this.keybinding.action)
                    .map(a => this.keybindings.getKeybinding(a))
            );
        }
        this._collisions = map;
        this.notify('collisions');
        this._updateState();
    }

    _onRowActivated(list, row) {
        if (row.is_focus()) {
            row.editing = !row.editing;
        }
    }

    _updateState() {
        GLib.idle_add(0, () => {
            this._accelLabel.label = this.keybinding.label;
            if (this.expanded) {
                this._accelLabel.hide();
                this._conflictIcon.visible = false;
                this._revealer.reveal_child = true;
                this.add_css_class('expanded');
            } else {
                this._accelLabel.show();
                this._conflictIcon.visible = this.collisions.size > 0;
                this._revealer.reveal_child = false;
                this.remove_css_class('expanded');
            }
        });
    }
});

export const KeybindingsPane = GObject.registerClass({
    GTypeName: 'KeybindingsPane',
    Template: GLib.uri_resolve_relative(import.meta.url, './KeybindingsPane.ui', GLib.UriFlags.NONE),
    InternalChildren: [
        'search',
        'listbox',
    ],
}, class KeybindingsPane extends Gtk.Box {
    _init(params = {}) {
        super._init(params);
    }

    init(extension) {
        this._settings = extension.getSettings(KEYBINDINGS_KEY);
        this.acceleratorParse = new AcceleratorParse();
        this._model = new KeybindingsModel({}, this.acceleratorParse);

        this._filter = new Gtk.StringFilter({
            expression: Gtk.PropertyExpression.new(Keybinding.$gtype, null, 'description'),
            ignore_case: true,
            match_mode: Gtk.StringFilterMatchMode.SUBSTRING,
        });

        const filteredBindings = new Gtk.FilterListModel({
            model: this._model,
            filter: this._filter,
        });

        this._listbox.bind_model(filteredBindings, keybinding => this._createRow(keybinding));
        this._listbox.set_header_func((row, before, data) => this._onSetHeader(row, before, data));

        this._expandedRow = null;

        // send settings to model (which processes and creates rows)
        this._model.init(this._settings);
    }

    _createHeader(row, before) {
        const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
        if (before)
            box.append(new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL }));
        box.append(new Gtk.Label({
            use_markup: true,
            label: _(`<b>${sections[row.keybinding.section]}</b>`),
            xalign: 0.0,
            margin_top: 24,
            margin_bottom: 6,
            margin_start: 12,
            margin_end: 12,
        }));
        box.append(new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL }));
        return box;
    }

    _createRow(keybinding) {
        const row = new KeybindingsRow({ keybindings: this._model, keybinding }, this.acceleratorParse);
        row.connect('notify::expanded', row => this._onRowExpanded(row));
        row.connect('collision-activated', (_, binding) => this._onCollisionActivated(binding));
        return row;
    }

    _onCollisionActivated(keybinding) {
        const [found, pos] = this._model.find(keybinding);
        if (found) {
            const row = this._listbox.get_row_at_index(pos);
            row.activate();
        }
    }

    _onSearchChanged() {
        this._filter.search = this._search.text || null;
    }

    _onRowActivated(list, row) {
        if (!row.is_focus())
            return;
        row.expanded = !row.expanded;
    }

    _onRowExpanded(row) {
        if (row.expanded) {
            if (this._expandedRow)
                this._expandedRow.expanded = false;
            this._expandedRow = row;
        } else if (this._expandedRow === row) {
            this._expandedRow = null;
        }
    }

    _onSetHeader(row, before, data) {
        const header = row.get_header();
        if (!before || before.keybinding.section !== row.keybinding.section) {
            if (!header || header instanceof Gtk.Separator) {
                row.set_header(this._createHeader(row, before));
            }
        } else if (!header || !(header instanceof Gtk.Separator)) {
            row.set_header(new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL }));
        }
    }
});

let _aboveTabKeyvals = null;

function aboveTabKeyvals() {
    if (!_aboveTabKeyvals) {
        const keycode = 0x29 + 8; // KEY_GRAVE
        let display = Gdk.Display.get_default();
        let [, , keyvals] = display.map_keycode(keycode);
        _aboveTabKeyvals = keyvals;
    }
    return _aboveTabKeyvals;
}

function symmetricDifference(setA, setB) {
    let _difference = new Set(setA);
    for (let elem of setB) {
        if (_difference.has(elem)) {
            _difference.delete(elem);
        } else {
            _difference.add(elem);
        }
    }
    return _difference;
}
