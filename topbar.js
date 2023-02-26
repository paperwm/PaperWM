/*
  Functionality related to the top bar, often called the statusbar.
 */

var Extension;
if (imports.misc.extensionUtils.extensions) {
    Extension = imports.misc.extensionUtils.extensions["paperwm@hedning:matrix.org"];
} else {
    Extension = imports.ui.main.extensionManager.lookup("paperwm@hedning:matrix.org");
}

var Meta = imports.gi.Meta;
var St = imports.gi.St;
var Gio = imports.gi.Gio;
var GLib = imports.gi.GLib;
var PanelMenu = imports.ui.panelMenu;
var PopupMenu = imports.ui.popupMenu;
var Clutter = imports.gi.Clutter;
var Main = imports.ui.main;
var Tweener = Extension.imports.utils.tweener;

var Tiling = Extension.imports.tiling;
var Navigator = Extension.imports.navigator;
var Utils = Extension.imports.utils;
var Scratch = Extension.imports.scratch;

var Settings = Extension.imports.settings;
var prefs = Settings.prefs;

var panelBox = Main.layoutManager.panelBox;
var panelMonitor;

var workspaceManager = global.workspace_manager;
var display = global.display;


// From https://developer.gnome.org/hig-book/unstable/design-color.html.en
var colors = [
    '#9DB8D2', '#7590AE', '#4B6983', '#314E6C',
    '#EAE8E3', '#BAB5AB', '#807D74', '#565248',
    '#C5D2C8', '#83A67F', '#5D7555', '#445632',
    '#E0B6AF', '#C1665A', '#884631', '#663822',
    '#ADA7C8', '#887FA3', '#625B81', '#494066',
    '#EFE0CD', '#E0C39E', '#B39169', '#826647',
    '#DF421E', '#990000', '#EED680', '#D1940C',
    '#46A046', '#267726', '#ffffff', '#000000'
];

var styles = {
    clear: 'background-color: rgba(0, 0, 0, 0);',
    transparent: 'background-color: rgba(0, 0, 0, 0.35);'
};

function createButton(icon_name, accessible_name) {
    return new St.Button({reactive: true,
                          can_focus: true,
                          track_hover: true,
                          accessible_name,
                          style_class: 'button workspace-icon-button',
                          child: new St.Icon({icon_name})
                         });
}

var PopupMenuEntryHelper = function constructor(text) {
    this.label = new St.Entry({
        text,
        // While not a search entry, this looks much better
        style_class:'search-entry',
        name: 'workspace-name-entry',
        track_hover: true,
        reactive: true,
        can_focus: true
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

    this.actor.add_actor(this.prevIcon);
    this.actor.add_actor(this.label);
    this.actor.add_actor(this.nextIcon);
    this.actor.label_actor = this.label;
    this.label.clutter_text.connect('activate', this.emit.bind(this, 'activate'));
}

var PopupMenuEntry;
// 3.32 uses `class` to define `PopupBaseMenuItem`, but doesn't use
// registerClass, breaking our somewhat lame registerClass polyfill.
if (Utils.version[1] === 32) {
    PopupMenuEntry = class PopupMenuEntry extends PopupMenu.PopupBaseMenuItem {
        constructor(text) {
            super({
                activate: false,
                reactive: true,
                hover: false,
                can_focus: false
            });

            PopupMenuEntryHelper.call(this, text);
        }


        activate(event) {
            this.label.grab_key_focus();
        }

        _onKeyFocusIn(actor) {
            this.activate();
        }
    };
} else {
    PopupMenuEntry = Utils.registerClass(
    class PopupMenuEntry extends PopupMenu.PopupBaseMenuItem {
        _init(text) {
            super._init({
                activate: false,
                reactive: true,
                hover: false,
                can_focus: false
            });

            PopupMenuEntryHelper.call(this, text);
        }

        activate(event) {
            this.label.grab_key_focus();
        }

        _onKeyFocusIn(actor) {
            this.activate();
        }
    });
}

class Color {
    constructor(color, container) {
        this.container = container;
        this.color = color;
        this.actor = new St.Button();
        let icon = new St.Widget();
        this.actor.add_actor(icon);
        icon.set_style(`background: ${color}`);
        icon.set_size(20, 20);
        icon.set_position(4, 4);
        this.actor.set_size(24, 24);

        this.actor.connect('clicked', this.clicked.bind(this));
    }

    clicked() {
        this.container.entry.actor.text = this.color;
        this.container.clicked();
    }
}

class ColorEntry {
    constructor(startColor) {
        this.actor = new St.BoxLayout({vertical: true});

        let flowbox = new St.Widget();
        let flowLayout = new Clutter.FlowLayout();
        let flow = new St.Widget();
        flowbox.add_actor(flow);
        flow.layout_manager = flowLayout;
        flow.width = 24*16;
        for (let c of colors) {
            flow.add_actor(new Color(c, this).actor);
        }

        this.entry = new PopupMenuEntry(startColor, 'Set color');
        this.entry.actor.clutter_text.connect(
            'text-changed', () => {
                let color = this.entry.actor.text;
                this.entry.actor.set_style(`color: ${color}; `);
            });

        this.entry.button.connect('clicked', this.clicked.bind(this));

        this.actor.add_actor(this.entry.actor);
        this.actor.add_actor(flowbox);
    }

    clicked() {
        let space = Tiling.spaces.spaceOf(workspaceManager.get_active_workspace());
        let color = this.entry.actor.text;
        space.settings.set_string('color', color);
    }
}

var WorkspaceMenu = Utils.registerClass(
class WorkspaceMenu extends PanelMenu.Button {
    _init() {
        super._init(0.5, 'Workspace', false);

        this.name = 'workspace-button';

        let scale = display.get_monitor_scale(Main.layoutManager.primaryIndex);
        this._label = new St.Label({
            y_align: Clutter.ActorAlign.CENTER,
            // Avoid moving the menu on short names
            // TODO: update on scale changes
            min_width: 60*scale
        });

        this.setName(Meta.prefs_get_workspace_name(workspaceManager.get_active_workspace_index()));

        this.add_actor(this._label);

        this.signals = new Utils.Signals();
        this.signals.connect(global.window_manager,
                             'switch-workspace',
                             this.workspaceSwitched.bind(this));

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(_('Workspace Settings')));

        this.entry = new PopupMenuEntry(this._label.text);
        this.menu.addMenuItem(this.entry);
        let changed = () => {
            let name = this.entry.label.text;
            let space = Tiling.spaces.spaceOf(workspaceManager.get_active_workspace());
            space.settings.set_string('name', name);
            this.setName(name);
        };
        this.signals.connect(this.entry.label.clutter_text, 'text-changed',
                             changed);

        // this._zenItem = new PopupMenu.PopupSwitchMenuItem('Hide top bar', false);
        // this.menu.addMenuItem(this._zenItem);
        // this._zenItem.connect('toggled', item => {
        //     Tiling.spaces.selectedSpace.settings.set_boolean('show-top-bar', !item.state);
        // });

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());


        this._prefItem = new PopupMenu.PopupImageMenuItem('Workspace preference', 'preferences-system-symbolic');
        this.menu.addMenuItem(this._prefItem);

        // this.prefsIcon = createButton('preferences-system-symbolic', 'workspace preference');
        // this.prevIcon = createButton('go-previous-symbolic', 'previous workspace setting');
        // this.nextIcon = createButton('go-next-symbolic', 'next workspace setting');

        this._prefItem.connect('activate', () => {
            this.menu.close(true);
            let wi = workspaceManager.get_active_workspace_index();
            let temp_file = Gio.File.new_for_path(GLib.get_tmp_dir()).get_child('paperwm.workspace')
            temp_file.replace_contents(wi.toString(), null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null)
            imports.misc.extensionUtils.openPrefs()
    
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
            log("?? no menu ??");
            Utils.print_stacktrace();
            return Clutter.EVENT_PROPAGATE;
        }

        if (this.state === "MENU" && !this.menu.isOpen) {
            this.state = "NORMAL";
        }

        let type = event.type();

        if ((type == Clutter.EventType.TOUCH_END ||
             type == Clutter.EventType.BUTTON_RELEASE)) {
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
            if (!this._navigator) {
                this.state = 'SCROLL';
                this._navigator = Navigator.getNavigator();
                Tiling.spaces._initWorkspaceStack();
                this._enterbox =  new Clutter.Actor({reactive: true});
                Main.uiGroup.add_actor(this._enterbox);
                this._enterbox.set_position(panelBox.x, panelBox.y + panelBox.height + 20);
                this._enterbox.set_size(global.screen_width, global.screen_height);
                Main.layoutManager.trackChrome(this._enterbox);

                this._navigator.connect('destroy', this._finishWorkspaceSelect.bind(this));

                let id = this._enterbox.connect('enter-event', () => {
                    this._navigator.finish();
                });
            }

            let device = event.get_source_device();
            // log(`source: ${device.get_device_type()}`);
            let direction = event.get_scroll_direction();
            if (direction === Clutter.ScrollDirection.SMOOTH
                && device.get_device_type() !== Clutter.InputDeviceType.POINTER_DEVICE) {
                this.state = 'SMOOTH';
            }

            if (direction === Clutter.ScrollDirection.DOWN) {
                Tiling.spaces.selectStackSpace(Meta.MotionDirection.DOWN);
            }
            if (direction === Clutter.ScrollDirection.UP) {
                Tiling.spaces.selectStackSpace(Meta.MotionDirection.UP);
            }
        }

        if (this.state === 'SMOOTH' && type === Clutter.EventType.SCROLL
            && event.get_scroll_direction() === Clutter.ScrollDirection.SMOOTH) {

            let spaces = Tiling.spaces;
            let active = spaces.spaceOf(workspaceManager.get_active_workspace());

            let [dx, dy] = event.get_scroll_delta();
            dy *= active.height*0.05;
            let t = event.get_time();
            let v = -dy/(this.time - t);
            // log(`v ${v}, dy: ${dy}`);

            let firstEvent = false;
            if (!this.selected) {
                firstEvent = true;
                this.selected = spaces.selectedSpace;
            }
            let mode = Clutter.AnimationMode.EASE_IN_OUT_QUAD;
            const StackPositions = Tiling.StackPositions;
            const upEdge = 0.385*active.height;
            const downEdge = 0.60*active.height;
            if (dy > 0
                && this.selected !== active
                && ((this.selected.actor.y > upEdge &&
                     this.selected.actor.y - dy < upEdge)
                    ||
                    (this.selected.actor.y - dy < StackPositions.up*active.height))
               ) {
                dy = 0;
                v = 0.1;
                spaces.selectStackSpace(Meta.MotionDirection.UP, false, mode);
                this.selected = spaces.selectedSpace;
                Tweener.removeTweens(this.selected.actor);
                Tweener.addTween(this.selected.actor,
                                 {scale_x: 0.9, scale_y: 0.9, time: prefs.animation_time, mode});
            } else if (dy < 0
                       && ((this.selected.actor.y < downEdge &&
                            this.selected.actor.y - dy > downEdge)
                           ||
                           (this.selected.actor.y - dy > StackPositions.down*active.height))
                      ) {
                dy = 0;
                v = 0.1;
                spaces.selectStackSpace(Meta.MotionDirection.DOWN, false, mode);
                this.selected = spaces.selectedSpace;
                Tweener.removeTweens(this.selected.actor);
                Tweener.addTween(this.selected.actor,
                                 {scale_x: 0.9, scale_y: 0.9, time: prefs.animation_time, mode});
            }

            this.selected.actor.y -= dy;
            if (this.selected === active) {
                let scale = 0.90;
                let s = 1 - (1 - scale)*(this.selected.actor.y/(0.1*this.selected.height));
                s = Math.max(s, scale);
                Tweener.removeTweens(this.selected.actor);
                this.selected.actor.set_scale(s, s);
            }

            if (v === 0 && !firstEvent) {
                // log(`finish: ${this.velocity}`);
                let test;
                if (this.velocity > 0)
                    test = () => this.velocity > 0;
                else
                    test = () => this.velocity < 0;

                let y = this.selected.actor.y;
                let friction = 0.5;
                while (test()) {

                    let dy = this.velocity*16;
                    y -= dy;
                    // log(`calc target: ${dy} ${y} ${this.velocity}`);
                    if (this.velocity > 0)
                        this.velocity -= friction;
                    else
                        this.velocity += friction;
                }
                // log(`zero: ${y/this.selected.height}`);

                if (this.selected === active && y <= 0.1*this.selected.height) {
                    this._navigator.finish();
                    return;
                } else if (y > downEdge) {
                    spaces.selectStackSpace(Meta.MotionDirection.DOWN, false, mode);
                    this.selected = spaces.selectedSpace;
                } else {
                    spaces.selectStackSpace(Meta.MotionDirection.DOWN);
                    spaces.selectStackSpace(Meta.MotionDirection.UP);
                }
            } else {
                this.time = t;
                this.velocity = v;
            }

        }

        return Clutter.EVENT_PROPAGATE;
    }

    vfunc_event(event) {
        // Ugly hack to work on 3.34 at the same time as 3.36> vfunc_event is
        // active on 3.34, but upstream still connects _onEvent resulting in
        // double events.
        if (Utils.version[1] < 35) {
            return;
        }
        this._onEvent(null, event)
    }

    // WorkspaceMenu.prototype._onOpenStateChanged = function
    _onOpenStateChanged(menu, open) {
        if (!open)
            return;

        let space = Tiling.spaces.spaceOf(workspaceManager.get_active_workspace());
        this.entry.label.text = space.name;
        GLib.idle_add(GLib.PRIORITY_DEFAULT, this.entry.activate.bind(this.entry));

        // this._zenItem._switch.setToggleState(!space.showTopBar);
    }

    workspaceSwitched(wm, fromIndex, toIndex) {
        updateWorkspaceIndicator(toIndex);
    }

    destroy() {
        this.signals.destroy();
        super.destroy();
    }

    setName(name) {
        if (prefs.use_workspace_name)
            this._label.text = name;
        else
            this._label.text = orginalActivitiesText;
    }
});

var menu;
var orginalActivitiesText;
var screenSignals, signals;
function init () {
    let label = Main.panel.statusArea.activities.first_child;
    orginalActivitiesText = label.text;
    screenSignals = [];
    signals = new Utils.Signals();
}

var panelBoxShowId, panelBoxHideId;
function enable () {
    Main.panel.statusArea.activities.hide();

    menu = new WorkspaceMenu();
    // Work around 'actor' warnings
    let panel = Main.panel;
    function fixLabel(label) {
        let point = new Clutter.Vertex({x: 0, y: 0});
        let r = label.apply_relative_transform_to_point(panel, point);

        for (let [workspace, space] of Tiling.spaces) {
            space.label.set_position(panel.x + Math.round(r.x), panel.y + Math.round(r.y));
            let fontDescription = label.clutter_text.font_description;
            space.label.clutter_text.set_font_description(fontDescription);
        }
    }
    Main.panel.addToStatusArea('WorkspaceMenu', menu, 0, 'left');
    menu.show();

    setClearStyle();

    screenSignals.push(
        workspaceManager.connect_after('workspace-switched',
                                    (workspaceManager, from, to) => {
                                        updateWorkspaceIndicator(to);
                                    }));

    signals.connect(Main.overview, 'showing', fixTopBar);
    signals.connect(Main.overview, 'hidden', () => {
        if (Tiling.spaces.selectedSpace.showTopBar)
            return;
        fixTopBar();
    });
    
    signals.connect(Settings.settings, 'changed::topbar-follow-focus', (settings, key) => {
        let monitors = Tiling.spaces.monitors;
        if (!settings.prefs.topbar_follow_focus) {
            moveTopBarTo(Main.layoutManager.primaryMonitor);
        }
        let to = setMonitor(Main.layoutManager.focusMonitor);
        let space = monitors.get(to);
        updateWorkspaceIndicator(space.workspace.index());
        for (let [workspace, space] of Tiling.spaces) {
            space.layout();
        }
    });

    signals.connect(Settings.settings, 'changed::show-window-position-bar', (settings, key) => {
        for (let [workspace, space] of Tiling.spaces) {
            space.updateWindowPositionBar();
        }
    });

    signals.connect(panelBox, 'show', () => {
        fixTopBar();
    });
    signals.connect(panelBox, 'hide', () => {
        fixTopBar();
    });
    /**
     * Set clear-style after hiding overview.  Mainloop timeout
     * needed here to execute after hidden is finished.
     */
    signals.connect(Main.overview, 'hidden', () => {
          imports.mainloop.timeout_add(0, () => {
            setClearStyle();
          });
    })

    fixLabel(menu._label);
    signals.connect(menu._label, 'notify::allocation', fixLabel);
    signals.connectOneShot(menu._label, 'notify::allocation', () => {
        setMonitor(Main.layoutManager.primaryMonitor);
    })
}

function disable() {
    signals.destroy();
    menu.destroy();
    menu = null;
    Main.panel.statusArea.activities.actor.show();
    Main.panel.set_style("");

    screenSignals.forEach(id => workspaceManager.disconnect(id));
    screenSignals = [];

    panelBox.scale_y = 1;
}

function setClearStyle() {
    Main.panel.set_style(styles.clear);
}

function setTransparentStyle() {
    Main.panel.set_style(styles.transparent);
}

function fixTopBar() {
    let space = Tiling.spaces?.monitors.get(panelMonitor) ?? false;
    if (!space)
        return;
    
    let normal = !Main.overview.visible && !Tiling.inPreview;
    // selected is current (tiled) selected window (can be different to focused window)
    let selected = space.selectedWindow;
    let focused = display.focus_window;
    let focusIsFloatOrScratch = focused && (space.isFloating(focused) || Scratch.isScratchWindow(focused));
    // check if is currently fullscreened (check focused-floating, focused-scratch, and selected/tiled window)
    let fullscreen = focusIsFloatOrScratch ? focused.fullscreen : selected && selected.fullscreen;
    
    if (normal && !space.showTopBar) {
        panelBox.scale_y = 0; // Update the workarea to support hide top bar
        panelBox.hide();
    }
    else if (normal && fullscreen) {
        panelBox.hide();
    }
    else {
        panelBox.scale_y = 1;
        panelBox.show();
    }
}

/**
   Override the activities label with the workspace name.
   let workspaceIndex = 0
*/
function updateWorkspaceIndicator (index) {
    let spaces = Tiling.spaces;
    let space = spaces && spaces.spaceOf(workspaceManager.get_workspace_by_index(index));
    let onMonitor = space && space.monitor === panelMonitor;
    let nav = Navigator.navigator
    if (onMonitor || (Tiling.inPreview && nav && nav.from.monitor === panelMonitor))
        setWorkspaceName(space.name);
};

function setWorkspaceName (name) {
    menu && menu.setName(name);
}

function setMonitor(monitor) {
    if (prefs.topbar_follow_focus) {
        moveTopBarTo(monitor);
    } else {
        monitor = Main.layoutManager.primaryMonitor
    }
    panelMonitor = monitor;
    return monitor;
}

function moveTopBarTo(monitor) {
    let panelBox = Main.layoutManager.panelBox;
    panelMonitor = monitor;
    panelBox.set_position(monitor.x, monitor.y);
    panelBox.width = monitor.width;
    fixTopBar();
    return monitor;
}
