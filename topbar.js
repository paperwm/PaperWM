import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import Meta from 'gi://Meta';
import St from 'gi://St';
import Pango from 'gi://Pango';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as panelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as popupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { Settings, Utils, Tiling, Navigator, Scratch } from './imports.js';

// eslint-disable-next-line no-undef
const workspaceManager = global.workspace_manager;
// eslint-disable-next-line no-undef
const display = global.display;

/*
  Functionality related to the top bar, often called the statusbar.
 */

export let panelBox = Main.layoutManager.panelBox;

export let menu, focusButton, openPositionButton;
let openPrefs, screenSignals, signals, gsettings;
let activeOpenWindowPositions;

export function enable (extension) {
    activeOpenWindowPositions = [
        {
            mode: Settings.OpenWindowPositions.RIGHT,
            active: () => Settings.prefs.open_window_position_option_right,
        },
        {
            mode: Settings.OpenWindowPositions.LEFT,
            active: () => Settings.prefs.open_window_position_option_left,
        },
        {
            mode: Settings.OpenWindowPositions.START,
            active: () => Settings.prefs.open_window_position_option_start,
        },
        {
            mode: Settings.OpenWindowPositions.END,
            active: () => Settings.prefs.open_window_position_option_end,
        },
    ];

    openPrefs = () => extension.openPreferences();
    gsettings = extension.getSettings();

    screenSignals = [];
    signals = new Utils.Signals();

    Main.panel.statusArea.activities.hide();

    menu = new WorkspaceMenu();
    focusButton = new FocusButton();
    openPositionButton = new OpenPositionButton();

    Main.panel.addToStatusArea('WorkspaceMenu', menu, 1, 'left');
    Main.panel.addToStatusArea('FocusButton', focusButton, 2, 'left');
    Main.panel.addToStatusArea('OpenPositionButton', openPositionButton, 3, 'left');

    Tiling.spaces.forEach(s => {
        s.workspaceLabel.clutter_text.set_font_description(menu.label.clutter_text.font_description);
    });

    fixWorkspaceIndicator();
    fixFocusModeIcon();
    fixOpenPositionIcon();
    fixStyle();

    screenSignals.push(
        workspaceManager.connect_after('workspace-switched',
            (workspaceManager, from, to) => updateWorkspaceIndicator(to)));

    signals.connect(Main.overview, 'showing', fixTopBar);
    signals.connect(Main.overview, 'hidden', () => {
        fixTopBar();
    });

    signals.connect(gsettings, 'changed::disable-topbar-styling', (_settings, _key) => {
        if (Settings.prefs.disable_topbar_styling) {
            removeStyles();
        }
        else {
            fixStyle();
        }
    });

    signals.connect(gsettings, 'changed::show-window-position-bar', (_settings, _key) => {
        const spaces = Tiling.spaces;
        spaces.setSpaceTopbarElementsVisible();
        spaces.forEach(s => s.layout(false));
        spaces.showWindowPositionBarChanged();
    });

    signals.connect(gsettings, 'changed::show-workspace-indicator', (_settings, _key) => {
        fixWorkspaceIndicator();
    });

    signals.connect(gsettings, 'changed::show-focus-mode-icon', (_settings, _key) => {
        fixFocusModeIcon();
    });

    signals.connect(gsettings, 'changed::show-open-position-icon', (_settings, _key) => {
        fixOpenPositionIcon();
    });

    signals.connect(panelBox, 'show', () => {
        fixTopBar();
    });
    signals.connect(panelBox, 'hide', () => {
        fixTopBar();
    });
    /**
     * Set clear-style when hiding overview.
     */
    signals.connect(Main.overview, 'hiding', () => {
        fixStyle();
    });
}

export function disable() {
    signals.destroy();
    signals = null;
    focusButton.destroy();
    focusButton = null;
    openPositionButton.destroy();
    openPositionButton = null;
    activeOpenWindowPositions = null;
    menu.destroy();
    menu = null;
    Main.panel.statusArea.activities.show();
    // remove PaperWM style classes names for Main.panel
    removeStyles();

    screenSignals.forEach(id => workspaceManager.disconnect(id));
    screenSignals = [];
    panelBox.scale_y = 1;
    openPrefs = null;
    gsettings = null;
}

export function showWorkspaceMenu(show = false) {
    if (show) {
        Main.panel.statusArea.activities.hide();
        menu.show();
    }
    else {
        menu.hide();
        Main.panel.statusArea.activities.show();
    }
}

export function createButton(icon_name, accessible_name) {
    return new St.Button({
        reactive: true,
        can_focus: true,
        track_hover: true,
        accessible_name,
        style_class: 'button workspace-icon-button',
        child: new St.Icon({ icon_name }),
    });
}

// registerClass, breaking our somewhat lame registerClass polyfill.
export const PopupMenuEntry = GObject.registerClass(
    class PopupMenuEntry extends popupMenu.PopupBaseMenuItem {
        _init(text) {
            super._init({
                activate: false,
                reactive: true,
                hover: false,
                can_focus: false,
            });

            this.label = new St.Entry({
                text,
                // While not a search entry, this looks much better
                style_class: 'search-entry',
                name: 'workspace-name-entry',
                track_hover: true,
                reactive: true,
                can_focus: true,
            });

            this.label.set_style(`
              width: 232px;
            `);

            this.prevIcon = createButton('go-previous-symbolic', 'previous workspace setting');
            this.nextIcon = createButton('go-next-symbolic', 'next workspace setting');

            this.nextIcon.connect('clicked', () => {
                let space = Tiling.cycleWorkspaceSettings(-1);
                this.label.text = space.name;
                this.nextIcon.grab_key_focus();
            });
            this.prevIcon.connect('clicked', () => {
                let space = Tiling.cycleWorkspaceSettings(1);
                this.label.text = space.name;
                this.prevIcon.grab_key_focus();
            });

            this.actor.add_child(this.prevIcon);
            this.actor.add_child(this.label);
            this.actor.add_child(this.nextIcon);
            this.actor.label_actor = this.label;
            this.label.clutter_text.connect('activate', this.emit.bind(this, 'activate'));
        }

        activate(_event) {
            this.label.grab_key_focus();
        }

        _onKeyFocusIn(_actor) {
            this.activate();
        }
    });

// class Color {
//     constructor(color, container) {
//         this.container = container;
//         this.color = color;
//         this.actor = new St.Button();
//         let icon = new St.Widget();
//         this.actor.add_child(icon);
//         icon.set_style(`background: ${color}`);
//         icon.set_size(20, 20);
//         icon.set_position(4, 4);
//         this.actor.set_size(24, 24);

//         this.actor.connect('clicked', this.clicked.bind(this));
//     }

//     clicked() {
//         this.container.entry.actor.text = this.color;
//         this.container.clicked();
//     }
// }

// class ColorEntry {
//     constructor(startColor) {
//         this.actor = new St.BoxLayout({ vertical: true });

//         let flowbox = new St.Widget();
//         let flowLayout = new Clutter.FlowLayout();
//         let flow = new St.Widget();
//         flowbox.add_child(flow);
//         flow.layout_manager = flowLayout;
//         flow.width = 24 * 16;
//         for (let c of colors) {
//             flow.add_child(new Color(c, this).actor);
//         }

//         this.entry = new PopupMenuEntry(startColor, 'Set color');
//         this.entry.actor.clutter_text.connect(
//             'text-changed', () => {
//                 let color = this.entry.actor.text;
//                 this.entry.actor.set_style(`color: ${color}; `);
//             });

//         this.entry.button.connect('clicked', this.clicked.bind(this));

//         this.actor.add_child(this.entry.actor);
//         this.actor.add_child(flowbox);
//     }

//     clicked() {
//         let space = Tiling.spaces.activeSpace;
//         let color = this.entry.actor.text;
//         space.settings.set_string('color', color);
//     }
// }

const BaseIcon = GObject.registerClass(
    class BaseIcon extends St.Icon {
        _init(
            props = {},
            tooltipProps = {},
            init = () => {},
            setMode = _mode => {},
            updateTooltipText = () => {}
        ) {
            super._init(props);

            // allow custom x position for tooltip
            this.tooltip_parent = tooltipProps?.parent ?? this;
            this.tooltip_x_point = tooltipProps?.x_point ?? 0;
            this.mode;

            // assign functions
            this.setMode = setMode;
            this.updateTooltipText = updateTooltipText;

            init();
            this.initToolTip();
            this.setMode();

            this.reactive = true;
            this.connect('button-press-event', () => {
                if (this.clickFunction) {
                    this.clickFunction();
                    this.updateTooltipText();
                }
            });
        }

        initToolTip() {
            const tt = new St.Label({ style_class: 'focus-button-tooltip' });
            tt.hide();
            // eslint-disable-next-line no-undef
            global.stage.add_child(tt);
            this.tooltip_parent.connect('enter-event', _icon => {
                this._updateTooltipPosition(this.tooltip_x_point);
                this.updateTooltipText();
                tt.show();

                // alignment needs to be set after actor is shown
                tt.clutter_text.set_line_alignment(Pango.Alignment.CENTER);
            });
            this.tooltip_parent.connect('leave-event', (_icon, _event) => {
                if (!this.has_pointer) {
                    tt.hide();
                }
            });
            this.tooltip = tt;
        }

        /**
         * Updates tooltip position relative to this button.
         */
        _updateTooltipPosition(xpoint = 0) {
            let point = this.apply_transform_to_point(
                new Graphene.Point3D({ x: xpoint, y: 0 }));
            this.tooltip.set_position(Math.max(0, point.x - 62), point.y + 34);
        }

        /**
         * Sets a function to be executed on click.
         * @param {Function} clickFunction
         * @returns
         */
        setClickFunction(clickFunction) {
            this.clickFunction = clickFunction;
            return this;
        }

        /**
         * Sets visibility of icon.
         * @param {boolean} visible
         */
        setVisible(visible = true) {
            this.visible = visible;
            return this;
        }

        /**
         * Returns a nicely formatted keybind string from PaperWM
         * @param {String} key
         */
        getKeybindString(key) {
            // get first keybind
            try {
                let kb = gsettings.get_child('keybindings').get_strv(key)[0]
                    .replace(/[<>]/g, ' ')
                    .trim()
                    .replace(/\s+/g, '+');

                // empty
                if (kb.length === 0) {
                    return '';
                }
                return `\n<i>(${kb})</i>`;
            } catch (error) {
                return '';
            }
        }
    }
);

export const FocusIcon = GObject.registerClass(
    class FocusIcon extends BaseIcon {
        _init(
            props = {},
            tooltipProps = {}
        ) {
            super._init(
                props,
                tooltipProps,
                () => {
                    const pather = relativePath => GLib.uri_resolve_relative(import.meta.url, relativePath, GLib.UriFlags.NONE);
                    this.gIconDefault = Gio.icon_new_for_string(pather('./resources/focus-mode-default-symbolic.svg'));
                    this.gIconCenter = Gio.icon_new_for_string(pather('./resources/focus-mode-center-symbolic.svg'));
                    this.gIconEdge = Gio.icon_new_for_string(pather('./resources/focus-mode-edge-symbolic.svg'));
                },
                mode => {
                    mode = mode ?? Tiling.FocusModes.DEFAULT;
                    this.mode = mode;

                    switch (mode) {
                    case Tiling.FocusModes.CENTER:
                        this.gicon = this.gIconCenter;
                        break;
                    case Tiling.FocusModes.EDGE:
                        this.gicon = this.gIconEdge;
                        break;
                    default:
                        this.gicon = this.gIconDefault;
                        break;
                    }

                    return this;
                },
                () => {
                    const markup = (color, mode) => {
                        const ct = this.tooltip.clutter_text;
                        ct.set_markup(`<i>Window focus mode</i>
Current mode: <span foreground="${color}"><b>${mode}</b></span>\
${this.getKeybindString('switch-focus-mode')}`);
                    };
                    switch (this.mode) {
                    case Tiling.FocusModes.DEFAULT:
                        markup('#6be67b', 'DEFAULT');
                        return;
                    case Tiling.FocusModes.CENTER:
                        markup('#6be6cb', 'CENTER');
                        break;
                    case Tiling.FocusModes.EDGE:
                        markup('#abe67b', 'EDGE');
                        break;
                    default:
                        markup('#6be67b', 'DEFAULT');
                        this.tooltip.set_text('');
                        break;
                    }
                }
            );
        }
    }
);

export const FocusButton = GObject.registerClass(
    class FocusButton extends panelMenu.Button {
        _init() {
            super._init(0.0, 'FocusMode');

            this._icon = new FocusIcon({
                style_class: 'system-status-icon focus-mode-button',
            }, { parent: this, x_point: -10 });

            this.setFocusMode();
            this.add_child(this._icon);
            this.connect('event', this._onClicked.bind(this));
        }

        /**
         * Sets the focus mode with this button.
         * @param {*} mode
         */
        setFocusMode(mode) {
            mode = mode ?? Tiling.FocusModes.DEFAULT;
            this.focusMode = mode;
            this._icon.setMode(mode);
            return this;
        }

        _onClicked(_actor, event) {
            if (Tiling.inPreview !== Tiling.PreviewMode.NONE || Main.overview.visible) {
                return Clutter.EVENT_PROPAGATE;
            }

            if (event.type() !== Clutter.EventType.TOUCH_BEGIN &&
                event.type() !== Clutter.EventType.BUTTON_PRESS) {
                return Clutter.EVENT_PROPAGATE;
            }

            Tiling.switchToNextFocusMode();
            this._icon.updateTooltipText();
            return Clutter.EVENT_PROPAGATE;
        }
    }
);

export const OpenPositionIcon = GObject.registerClass(
    class OpenPositionIcon extends BaseIcon {
        _init(
            props = {},
            tooltipProps = {}
        ) {
            super._init(
                props,
                tooltipProps,
                () => {
                    const pather = relativePath => GLib.uri_resolve_relative(import.meta.url, relativePath, GLib.UriFlags.NONE);
                    this.gIconRight = Gio.icon_new_for_string(pather('./resources/open-position-right-symbolic.svg'));
                    this.gIconLeft = Gio.icon_new_for_string(pather('./resources/open-position-left-symbolic.svg'));
                    this.gIconStart = Gio.icon_new_for_string(pather('./resources/open-position-start-symbolic.svg'));
                    this.gIconEnd = Gio.icon_new_for_string(pather('./resources/open-position-end-symbolic.svg'));

                    // connection to update based on gsetting
                    signals.connect(gsettings, 'changed::open-window-position', (_settings, _key) => {
                        const mode = Settings.prefs.open_window_position;
                        this.setMode(mode);
                    });
                },
                mode => {
                    mode = mode ?? Settings.OpenWindowPositions.RIGHT;
                    this.mode = mode;

                    switch (mode) {
                    case Settings.OpenWindowPositions.LEFT:
                        this.gicon = this.gIconLeft;
                        break;
                    case Settings.OpenWindowPositions.START:
                        this.gicon = this.gIconStart;
                        break;
                    case Settings.OpenWindowPositions.END:
                        this.gicon = this.gIconEnd;
                        break;
                    default:
                        this.gicon = this.gIconRight;
                        break;
                    }

                    this.updateTooltipText();
                    return this;
                },
                () => {
                    const markup = mode => {
                        const ct = this.tooltip.clutter_text;
                        ct.set_markup(`<i>Open Window Position</i>
Current position: <b>${mode}</b>\
${this.getKeybindString('switch-open-window-position')}`);
                    };
                    switch (this.mode) {
                    case Settings.OpenWindowPositions.LEFT:
                        markup('LEFT');
                        return;
                    case Settings.OpenWindowPositions.START:
                        markup('START');
                        break;
                    case Settings.OpenWindowPositions.END:
                        markup('END');
                        break;
                    default:
                        markup('RIGHT');
                        break;
                    }
                }
            );
        }
    }
);

/**
 * Switches to the next position for opening new windows.
 */
export function switchToNextOpenPositionMode() {
    const activeModes = activeOpenWindowPositions
        .filter(m => m.active())
        .map(m => m.mode);

    // if activeModes are empty, do nothing
    if (activeModes.length <= 0) {
        return;
    }

    const currIndex = activeModes.indexOf(Settings.prefs.open_window_position);
    // if current mode is -1, then set the mode to the first option
    let nextMode;
    if (currIndex < 0) {
        console.log(`couldn't find`);
        nextMode = activeModes[0];
    }
    else {
        nextMode = activeModes[(currIndex + 1) % activeModes.length];
    }

    // simply need to set gsettings and mode will be set and updated
    gsettings.set_int('open-window-position', nextMode);
}

export const OpenPositionButton = GObject.registerClass(
    class OpenPositionButton extends panelMenu.Button {
        _init() {
            super._init(0.0, 'OpenPosition');

            this._icon = new OpenPositionIcon({
                style_class: 'system-status-icon open-position-icon',
            }, { parent: this, x_point: -10 });

            this.setPositionMode(Settings.prefs.open_window_position);
            this.add_child(this._icon);
            this.connect('button-press-event', this._onClicked.bind(this));
        }

        /**
         * Sets the position mode with this button.
         * @param {*} mode
         */
        setPositionMode(mode) {
            mode = mode ?? Settings.OpenWindowPositions.RIGHT;
            this.positionMode = mode;
            this._icon.setMode(mode);
            return this;
        }

        _onClicked(_actor, _event) {
            switchToNextOpenPositionMode();
            return Clutter.EVENT_PROPAGATE;
        }
    }
);

export const WorkspaceMenu = GObject.registerClass(
    class WorkspaceMenu extends panelMenu.Button {
        _init() {
            super._init(0.5, 'Workspace', false);

            this.name = 'workspace-button';

            let scale = display.get_monitor_scale(Main.layoutManager.primaryIndex);
            this.label = new St.Label({
                y_align: Clutter.ActorAlign.CENTER,
                // Avoid moving the menu on short names
                // TODO: update on scale changes
                min_width: 60 * scale,
            });

            this.setName(Meta.prefs_get_workspace_name(workspaceManager.get_active_workspace_index()));

            this.add_child(this.label);

            this.signals = new Utils.Signals();
            // eslint-disable-next-line no-undef
            this.signals.connect(global.window_manager,
                'switch-workspace',
                this.workspaceSwitched.bind(this));

            this.menu.addMenuItem(new popupMenu.PopupSeparatorMenuItem('Workspace Settings'));

            this.entry = new PopupMenuEntry(this.label.text);
            this.menu.addMenuItem(this.entry);
            let changed = () => {
                let name = this.entry.label.text;
                let space = Tiling.spaces.activeSpace;
                space.settings.set_string('name', name);
                this.setName(name);
            };
            this.signals.connect(this.entry.label.clutter_text, 'text-changed',
                changed);

            // this._zenItem = new popupMenu.PopupSwitchMenuItem('Hide top bar', false);
            // this.menu.addMenuItem(this._zenItem);
            // this._zenItem.connect('toggled', item => {
            //     Tiling.spaces.selectedSpace.settings.set_boolean('show-top-bar', !item.state);
            // });

            this.menu.addMenuItem(new popupMenu.PopupSeparatorMenuItem());

            this._prefItem = new popupMenu.PopupImageMenuItem('Workspace preference', 'preferences-system-symbolic');
            this.menu.addMenuItem(this._prefItem);

            // this.prefsIcon = createButton('preferences-system-symbolic', 'workspace preference');
            // this.prevIcon = createButton('go-previous-symbolic', 'previous workspace setting');
            // this.nextIcon = createButton('go-next-symbolic', 'next workspace setting');

            this._prefItem.connect('activate', () => {
                this.menu.close(true);
                let wi = workspaceManager.get_active_workspace_index();
                let temp_file = Gio.File.new_for_path(GLib.get_tmp_dir()).get_child('paperwm.workspace');
                temp_file.replace_contents(wi.toString(), null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
                openPrefs();
            });

            // this.iconBox = new St.BoxLayout();
            // this.menu.box.add(this.iconBox);

            // this.iconBox.add(this.prefsIcon, { expand: true, x_fill: false });

            // this.entry.actor.width = this.colors.actor.width;
            // this.colors.entry.actor.width = this.colors.actor.width;
            this.state = "NORMAL";
        }

        _finishWorkspaceSelect() {
            this.state = "NORMAL";
            this._enterbox.destroy();
            delete this.selected;
            delete this._enterbox;
            delete this._navigator;
        }

        _onEvent(actor, event) {
            if (!this.menu) {
                console.warn("?? no menu ??");
                Utils.print_stacktrace();
                return Clutter.EVENT_PROPAGATE;
            }

            if (this.state === "MENU" && !this.menu.isOpen) {
                this.state = "NORMAL";
            }

            let type = event.type();

            if (type === Clutter.EventType.TOUCH_END ||
                type === Clutter.EventType.BUTTON_RELEASE) {
                if (Navigator.navigating) {
                    Navigator.getNavigator().finish();
                } else {
                    if (this.menu.isOpen) {
                        this.menu.toggle();
                    } else if (event.get_button() === Clutter.BUTTON_SECONDARY) {
                        this.menu.toggle();
                    } else {
                        Main.overview.toggle();
                    }
                    this.state = this.menu.isOpen ? "MENU" : "NORMAL";
                }
                return Clutter.EVENT_PROPAGATE;
            }

            if (Main.overview.visible) {
                return Clutter.EVENT_PROPAGATE;
            }

            if (["NORMAL", "SCROLL"].includes(this.state) &&
                type === Clutter.EventType.SCROLL) {
                const direction = event.get_scroll_direction();
                switch (direction) {
                case Clutter.ScrollDirection.DOWN:
                    Tiling.spaces.selectSequenceSpace(Meta.MotionDirection.DOWN);
                    Navigator.getNavigator().finish();
                    break;
                case Clutter.ScrollDirection.UP:
                    Tiling.spaces.selectSequenceSpace(Meta.MotionDirection.UP);
                    Navigator.getNavigator().finish();
                    break;
                }
            }

            return Clutter.EVENT_PROPAGATE;
        }

        vfunc_event(event) {
            this._onEvent(null, event);
        }

        // WorkspaceMenu.prototype._onOpenStateChanged = function
        _onOpenStateChanged(menu, open) {
            if (!open)
                return;

            let space = Tiling.spaces.activeSpace;
            this.entry.label.text = space.name;
            GLib.idle_add(GLib.PRIORITY_DEFAULT, this.entry.activate.bind(this.entry));

            // this._zenItem._switch.setToggleState(!space.showTopBar);
        }

        workspaceSwitched(wm, fromIndex, toIndex) {
            updateWorkspaceIndicator(toIndex);
        }

        destroy() {
            this.signals.destroy();
            this.signals = null;
            super.destroy();
        }

        setName(name) {
            this.label.text = name;
        }
    });

export function panelMonitor() {
    return Main.layoutManager.primaryMonitor;
}

export function setNoBackgroundStyle() {
    if (Settings.prefs.disable_topbar_styling) {
        return;
    }
    removeStyles();
    Main.panel.add_style_class_name('background-clear');
}

export function setTransparentStyle() {
    if (Settings.prefs.disable_topbar_styling) {
        return;
    }
    removeStyles();
    Main.panel.add_style_class_name('topbar-transparent-background');
}

export function removeStyles() {
    ['background-clear', 'topbar-transparent-background'].forEach(s => {
        Main.panel.remove_style_class_name(s);
    });
}

/**
 * Applies correct style based on whether we use the windowPositionBar or not.
 */
export function fixStyle() {
    Settings.prefs.show_window_position_bar ? setNoBackgroundStyle() : setTransparentStyle();
}

export function fixTopBar() {
    let space = Tiling?.spaces?.spaceWithTopBar() ?? false;
    if (!space)
        return;

    let normal = !Main.overview.visible && !Tiling.inPreview;
    // selected is current (tiled) selected window (can be different to focused window)
    let selected = space.selectedWindow;
    let focused = display.focus_window;
    let focusIsFloatOrScratch = focused && (space.isFloating(focused) || Scratch.isScratchWindow(focused));
    // check if is currently fullscreened (check focused-floating, focused-scratch, and selected/tiled window)
    let fullscreen = focusIsFloatOrScratch ? focused.fullscreen : selected && selected.fullscreen;

    if (normal && space.hasTopBar) {
        if (!space.showTopBar) {
            panelBox.scale_y = 0; // Update the workarea to support hide top bar
            panelBox.hide();
        } else {
            panelBox.scale_y = 1;
            panelBox.show();
        }
    }

    // if (normal && !fullscreen && !space.showTopBar) {
    //     panelBox.scale_y = 0; // Update the workarea to support hide top bar
    //     panelBox.hide();
    // } else {
    //     panelBox.scale_y = 1;
    //     panelBox.show();
    // }
}

export function fixWorkspaceIndicator() {
    const show = Settings.prefs.show_workspace_indicator;
    if (show) {
        Main.panel.statusArea.activities.hide();
        menu.show();
    }
    else {
        menu.hide();
        Main.panel.statusArea.activities.show();
    }
}

export function fixFocusModeIcon() {
    Settings.prefs.show_focus_mode_icon ? focusButton.show() : focusButton.hide();
    Tiling.spaces.forEach(s => s.showFocusModeIcon());
}

export function fixOpenPositionIcon() {
    Settings.prefs.show_open_position_icon ? openPositionButton.show() : openPositionButton.hide();
}

/**
   Override the activities label with the workspace name.
   let workspaceIndex = 0
*/
export function updateWorkspaceIndicator(index) {
    let spaces = Tiling.spaces;
    let space = spaces?.spaceOf(workspaceManager.get_workspace_by_index(index));
    if (space && isOnMonitor(space.monitor)) {
        setWorkspaceName(space.name);

        // also update focus mode
        focusButton.setFocusMode(space.focusMode);
    }
}

/**
 * Refreshes topbar workspace indicator.
 */
export function refreshWorkspaceIndicator() {
    let panelSpace = Tiling.spaces.monitors.get(panelMonitor());
    updateWorkspaceIndicator(panelSpace.index);
}

export function setWorkspaceName (name) {
    menu && menu.setName(name);
}

export function isOnMonitor(monitor) {
    // Check if panel position is the same as the monitor position (because
    // it is always at position 0,0 relative to the monitor). This is useful
    // when an extension moves the panel to another monitor.
    const [panelBoxX, panelBoxY] = Main.layoutManager.panelBox.get_transformed_position();
    return monitor && monitor.x == panelBoxX && monitor.y == panelBoxY;
}
