/*
  Functionality related to the top bar, often called the statusbar.
 */

var Extension = imports.misc.extensionUtils.extensions['paperwm@hedning:matrix.org'];
var Meta = imports.gi.Meta;
var St = imports.gi.St;
var Gio = imports.gi.Gio;
var PanelMenu = imports.ui.panelMenu;
var PopupMenu = imports.ui.popupMenu;
var Clutter = imports.gi.Clutter;
var Main = imports.ui.main;
var Tweener = imports.ui.tweener;

var Tiling = Extension.imports.tiling;

var prefs = Extension.imports.settings.prefs;

var panelBox = Main.layoutManager.panelBox;

var screen = global.screen;


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

class PopupMenuEntry {
    constructor (text, label) {
        this.actor = new St.Entry({text});
        this.entry = this.actor;
        this.actor.set_style('margin: 4px 0 4px 0');

        this.button = new St.Button({label,
                                    style_class: 'modal-dialog-button button'});
        this.actor.set_secondary_icon(this.button);

        this.entry.clutter_text.set_activatable(true);
        this.entry.clutter_text.connect('activate', () => {
            this.button.emit('clicked', null);
        });
    }
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
    constructor() {
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

        this.entry = new PopupMenuEntry('', 'Set color');
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
        let space = Tiling.spaces.spaceOf(screen.get_active_workspace());
        let color = this.entry.actor.text;
        space.settings.set_string('color', color);
    }
}

class WorkspaceMenu extends PanelMenu.Button {
    constructor(panel) {
        super(0.5, 'WorkspaceMenu', false);

        this.actor.name = 'workspace-button';

        this._label = new St.Label({
            text: Meta.prefs_get_workspace_name(global.screen.get_active_workspace_index()),
            y_align: Clutter.ActorAlign.CENTER });

        this.actor.add_actor(this._label);

        this._workspaceSwitchedSignal = global.screen.connect(
            'workspace-switched', this.workspaceSwitched.bind(this));

        this.entry = new PopupMenuEntry(this._label.text, 'Set name');
        let clicked = () => {
            let name = this.entry.entry.text;
            let space = Tiling.spaces.spaceOf(screen.get_active_workspace());
            space.settings.set_string('name', name);
            this._label.text = name;
        };
        this.entry.button.connect('clicked', clicked.bind(this.entry));

        this.colors = new ColorEntry();

        this.contentBox = new St.BoxLayout({vertical: true});
        this.contentBox.layout_manager.spacing = 10;
        this.contentBox.set_style('margin: 10px 20px;');
        this.contentBox.add_actor(this.entry.actor);
        this.contentBox.add_actor(this.colors.actor);
        this.menu.box.add_actor(this.contentBox);

        this.entry.actor.width = this.colors.actor.width;
        this.colors.entry.actor.width = this.colors.actor.width;
    }

    _onOpenStateChanged(menu, open) {
        if (!open)
            return;

        let space = Tiling.spaces.spaceOf(screen.get_active_workspace());
        this.entry.actor.text = space.name;
        this.colors.entry.actor.text = space.color;
    }

    workspaceSwitched(screen, fromIndex, toIndex) {
        let space = Tiling.spaces.spaceOf(screen.get_workspace_by_index(toIndex));
        this._label.set_text(space.name);
    }

    destroy() {
        super.destroy();
        screen.disconnect(this._workspaceSwitchedSignal);
    }
};

var menu;
var orginalActivitiesText;
var screenSignals;
function init () {
    let label = Main.panel.statusArea.activities.actor.first_child;
    orginalActivitiesText = label.text;
    screenSignals = [];
}

var panelBoxShowId, panelBoxHideId;
function enable () {
    Main.panel.statusArea.activities.actor.hide();

    menu = new WorkspaceMenu();
    Main.panel.addToStatusArea('WorkspaceMenu', menu, 0, 'left');
    menu.actor.show();
    let id = panelBox.connect('parent-set', (actor) => {
        actor.disconnect(id);
        updateWorkspaceIndicator(global.screen.get_active_workspace());
    });

    // Force transparency
    Main.panel.actor.set_style('background-color: rgba(0, 0, 0, 0.35);');
    [Main.panel._rightCorner, Main.panel._leftCorner]
        .forEach(c => c.actor.opacity = 0);

    screenSignals.push(
        screen.connect_after('workspace-switched',
                                    (screen, from, to) => {
                                        updateWorkspaceIndicator(to);
                                    }));

    panelBoxShowId =  panelBox.connect('show', show);
    panelBoxHideId = panelBox.connect('hide', () => {
        if (global.display.focus_window.fullscreen) {
            hide();
        } else {
            panelBox.show();
        }
    });
}

function disable() {
    menu.destroy();
    Main.panel.statusArea.activities.actor.show();
    Main.panel.actor.set_style('');
    [Main.panel._rightCorner, Main.panel._leftCorner]
        .forEach(c => c.actor.opacity = 255);

    screenSignals.forEach(id => screen.disconnect(id));
    screenSignals = [];

    panelBox.scale_y = 1;
    panelBox.disconnect(panelBoxShowId);
    panelBox.disconnect(panelBoxHideId);
}

function show() {
    panelBox.show();
    Tweener.addTween(panelBox, {
        scale_y: 1,
        time: 0.25,
        onOverwrite: () => {
            panelBox.scale_y = 1;
        }
    });
}

function hide() {
    Tweener.addTween(panelBox, {
        scale_y: 0,
        time: 0.25,
        onOverwrite: () => {
            panelBox.scale_y = 0;
        },
        onComplete: () => {
            panelBox.scale_y = 0;
        }
    });
}

/**
   Override the activities label with the workspace name.
   let workspaceIndex = 0
*/
function updateWorkspaceIndicator (index) {
    let space = Tiling.spaces.spaceOf(screen.get_workspace_by_index(index));
    setWorkspaceName(space.name);
};

function updateIndicatorPosition(workspace) {
    if (!Tiling.spaces)
        return;
    let space = Tiling.spaces.spaceOf(workspace);
    if (!space)
        return;
    if (!menu._label)
        return;
    space.label.show();
    let p = menu._label.get_position();
    let point = new Clutter.Vertex({
        x: p[0],
        y: p[1]
    });
    if (!menu._label || !menu._label.get_parent())
        return;
    let r = menu._label.get_parent().apply_relative_transform_to_point(Main.panel.actor,
                                                          point);

    space.label.set_position(r.x, r.y);
}

function setWorkspaceName (name) {
    menu._label.text = name;
}

function setMonitor(monitor) {
    let panelBox = Main.layoutManager.panelBox;
    panelBox.set_position(monitor.x, monitor.y);
    panelBox.width = monitor.width;
}
