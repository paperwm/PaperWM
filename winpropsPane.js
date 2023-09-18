import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

export const WinpropsPane = GObject.registerClass({
    GTypeName: 'WinpropsPane',
    Template: GLib.uri_resolve_relative(import.meta.url, './WinpropsPane.ui', GLib.UriFlags.NONE),
    InternalChildren: [
        'search',
        'listbox',
        'addButton',
        'scrolledWindow',
    ],
    Signals: {
        'changed': {},
    },
}, class WinpropsPane extends Gtk.Box {
    _init(params = {}) {
        super._init(params);

        // define search box filter function (searches wm_class, title, and accelLabel)
        this._listbox.set_filter_func(row => {
            let search = this._search.get_text().toLowerCase();
            let wmclass = row.winprop.wm_class?.toLowerCase() ?? '';
            let title = row.winprop.title?.toLowerCase() ?? '';
            let accelLabel = row._accelLabel.label?.toLowerCase() ?? '';
            return wmclass.includes(search) || title.includes(search) || accelLabel.includes(search);
        });
        this._search.connect('changed', () => {
            this._listbox.invalidate_filter();
        });

        this._expandedRow = null;
        this.rows = [];
    }

    addWinprops(winprops) {
        winprops.forEach(winprop => {
            this._listbox.insert(this._createRow(winprop), -1);
        });
    }

    _removeRow(row) {
        this._listbox.remove(row);
        let remove = this.rows.findIndex(r => r === row);
        if (remove >= 0) {
            this.rows.splice(remove, 1);
        }
        this.emit('changed');
    }

    _onAddButtonClicked() {
        // first clear search text, otherwise won't be able to see new row
        this._search.set_text('');

        let row = this._createRow();
        row.expanded = true;
        this._listbox.insert(row, 0);
        this._scrolledWindow.get_vadjustment().set_value(0);
    }

    _createRow(winprop) {
        let wp = winprop ?? { wm_class: '' };
        const row = new WinpropsRow({ winprop: wp });
        this.rows.push(row);
        row.connect('notify::expanded', row => this._onRowExpanded(row));
        row.connect('row-deleted', row => this._removeRow(row));
        row.connect('changed', () => this.emit('changed'));
        return row;
    }

    _onRowActivated(list, row) {
        if (!row.is_focus()) {
            return;
        }
        row.expanded = !row.expanded;
    }

    _onRowExpanded(row) {
        if (row.expanded) {
            if (this._expandedRow) {
                this._expandedRow.expanded = false;
            }
            this._expandedRow = row;
        } else if (this._expandedRow === row) {
            this._expandedRow = null;
        }
    }
});

export const WinpropsRow = GObject.registerClass({
    GTypeName: 'WinpropsRow',
    Template: GLib.uri_resolve_relative(import.meta.url, './WinpropsRow.ui', GLib.UriFlags.NONE),
    InternalChildren: [
        'header',
        'descLabel',
        'accelLabel',
        'revealer',
        'optionList',
        'wmClass',
        'title',
        'scratchLayer',
        'preferredWidth',
        'deleteButton',
    ],
    Properties: {
        winprop: GObject.ParamSpec.jsobject(
            'winprop',
            'winprop',
            'Winprop',
            GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT_ONLY
        ),
        expanded: GObject.ParamSpec.boolean(
            'expanded',
            'Expanded',
            'Expanded',
            GObject.ParamFlags.READWRITE,
            false
        ),
    },
    Signals: {
        'changed': {},
        'row-deleted': {},
    },
}, class WinpropsRow extends Gtk.ListBoxRow {
    _init(params = {}) {
        super._init(params);

        // description label
        this._setDescLabel();

        // set the values to current state and connect to 'changed' signal
        this._wmClass.set_text(this.winprop.wm_class ?? '');
        this._wmClass.connect('changed', () => {
            // check if null or empty (we still emit changed if wm_class is wiped)
            this.checkHasWmClassOrTitle();
            this.winprop.wm_class = this._wmClass.get_text();
            this._setDescLabel();
            this.emit('changed');
        });

        this._title.set_text(this.winprop.title ?? '');
        this._title.connect('changed', () => {
            this.checkHasWmClassOrTitle();
            this.winprop.title = this._title.get_text();
            this._setDescLabel();
            this.emit('changed');
        });

        this._scratchLayer.set_active(this.winprop.scratch_layer ?? false);
        this._scratchLayer.connect('state-set', () => {
            let isActive = this._scratchLayer.get_active();
            this.winprop.scratch_layer = isActive;

            // if is active then disable the preferredWidth input
            this._preferredWidth.set_sensitive(!isActive);

            this.emit('changed');
        });

        this._preferredWidth.set_text(this.winprop.preferredWidth ?? '');
        // if scratchLayer is active then users can't edit preferredWidth
        this._preferredWidth.set_sensitive(!this.winprop.scratch_layer ?? true);

        this._preferredWidth.connect('changed', () => {
            // if has value, needs to be valid (have a value or unit)
            if (this._preferredWidth.get_text()) {
                let value = this._preferredWidth.get_text();
                let digits = (value.match(/\d+/) ?? [null])[0];
                let isPercent = /^.*%$/.test(value);
                let isPixel = /^.*px$/.test(value);

                // check had valid number
                if (!digits) {
                    this._setError(this._preferredWidth);
                }
                // if no unit defined
                else if (!isPercent && !isPixel) {
                    this._setError(this._preferredWidth);
                }
                else {
                    this._setError(this._preferredWidth, false);
                    this.winprop.preferredWidth = this._preferredWidth.get_text();
                    this.emit('changed');
                }
            } else {
                // having no preferredWidth is valid
                this._setError(this._preferredWidth, false);
                delete this.winprop.preferredWidth;
                this.emit('changed');
            }
        });

        this._updateState();
    }

    /**
     * Checks has an input for either wmClass or title.
     * Sets 'error' cssClass is neither.
     */
    checkHasWmClassOrTitle() {
        if (!this._wmClass.get_text() && !this._title.get_text()) {
            this._setError(this._wmClass);
            this._setError(this._title);
            return false;
        } else {
            this._setError(this._wmClass, false);
            this._setError(this._title, false);
            return true;
        }
    }

    /**
     * Get the wmClass if it exists, otherwise returns the title.
     * @returns String
     */
    getWmClassOrTitle() {
        if (this.winprop.wm_class) {
            return this.winprop.wm_class;
        }
        else if (this.winprop.title) {
            return this.winprop.title;
        }
        else {
            return '';
        }
    }

    _setError(child, option = true) {
        if (child) {
            if (option) {
                child.add_css_class('error');
            } else {
                child.remove_css_class('error');
            }
        }
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

    _onDeleteButtonClicked() {
        this.emit('row-deleted');
    }

    _onRowActivated(list, row) {
        if (row.is_focus()) {
            row.editing = !row.editing;
        }
    }

    _setAccelLabel() {
        let isScratch = this.winprop.scratch_layer ?? false;
        let isPreferredWidth = this.winprop.preferredWidth || false;

        if (isScratch) {
            return 'scratch layer';
        }
        else if (isPreferredWidth) {
            return 'preferred width';
        } else {
            return 'no setting';
        }
    }

    /**
     * Sets the description label for this row.
     * @returns boolean
     */
    _setDescLabel() {
        // if wmClass, use that, otherwise use title (fallback)
        if (this.winprop.wm_class) {
            this._descLabel.label = this.winprop.wm_class;
        }
        else if (this.winprop.title) {
            this._descLabel.label = this.winprop.title;
        }
    }

    _updateState() {
        GLib.idle_add(0, () => {
            this._accelLabel.label = this._setAccelLabel();
            if (this.expanded) {
                this._accelLabel.hide();
                this._revealer.reveal_child = true;
                this.add_css_class('expanded');
            } else {
                this._accelLabel.show();
                this._revealer.reveal_child = false;
                this.remove_css_class('expanded');
            }
        });
    }
});
