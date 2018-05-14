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

var prefs = Extension.imports.prefs.prefs;

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
var color;

class PopupMenuEntry {
    constructor (text, label) {
        this.actor = new St.Entry({text});
        this.entry = this.actor;
        this.actor.set_style('margin: 4px 0 4px 0');

        this.button = new St.Button({label,
                                    style_class: 'modal-dialog-button button'});
        this.actor.set_secondary_icon(this.button);
        // this.actor.add_child(this.button);
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
        this.entry.actor.connect(
            'notify::text',
            () => {
                let color = this.entry.actor.text;
                this.entry.actor.set_style(`color: ${color}; `);
            });

        this.entry.button.connect('clicked', this.clicked.bind(this));

        this.actor.add_actor(this.entry.actor);
        this.actor.add_actor(flowbox);
    }

    clicked() {
        let index = global.screen.get_active_workspace_index();
        var settings = Extension.imports.convenience.getSettings();
        let colors = prefs.workspace_colors;
        for (let i=0; i < index - colors.length; i++) {
        }

        let color = this.entry.actor.text;
        colors[index] = color;
        settings.set_strv('workspace-colors', colors);

        let space = Tiling.spaces.spaceOf(global.screen.get_active_workspace());
        space.setColor(color);
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
        // this.actor.label_actor = this._label;
        this.actor.connect("destroy", this.destroy.bind(this));

        this._workspaceSwitchedSignal = global.screen.connect(
            'workspace-switched', this.workspaceSwitched.bind(this));

        this.entry = new PopupMenuEntry(this._label.text, 'Set name');
        function clicked() {
            let settings = new Gio.Settings({
                schema_id: 'org.gnome.desktop.wm.preferences'});
            let name = this.entry.text;
            let index = global.screen.get_active_workspace_index();
            let names = settings.get_strv('workspace-names');
            names[index] = name;
            settings.set_strv('workspace-names', names);
        }
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

    namesChanged(settings, key) {
        if (key !== 'workspace-names')
            return;
        let index = global.screen.get_active_workspace_index();
        let name = Meta.prefs_get_workspace_name(index);
        this._label.text = name;
        let space = Tiling.spaces.spaceOf(global.screen.get_active_workspace());
        space.label.text = name;
    }

    _onOpenStateChanged(menu, open) {
        if (!open)
            return;

        if (!this.namesChangedId) {
            let settings = new Gio.Settings({
                schema_id: 'org.gnome.desktop.wm.preferences'});
            this.namesChangedId = settings.connect('changed', this.namesChanged.bind(this));
        }

        let index = global.screen.get_active_workspace_index();
        let name = Meta.prefs_get_workspace_name(index);
        let colors = prefs.workspace_colors;
        let color = colors[index % colors.length];
        this.entry.actor.text = name;

        this.colors.entry.actor.text = color;
    }

    workspaceSwitched(screen, fromIndex, toIndex) {
        this._label.set_text(Meta.prefs_get_workspace_name(toIndex));
    }

    destroy() {
        utils.debug("#wsm", "destroyed");
        global.screen.disconnect(this._workspaceSwitchedSignal);
    }
};

var menu;
var orginalActivitiesText;
var screenSignals;
function init () {
    let label = Main.panel.statusArea.activities.actor.first_child;
    orginalActivitiesText = label.text;
    screenSignals = [];

    menu = new WorkspaceMenu();
    Main.panel.addToStatusArea('WorkspaceMenu', menu, 0, 'left');
}

var panelBoxShowId, panelBoxHideId;
function enable () {
    Main.panel.statusArea.activities.actor.hide();
    menu.actor.show();

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
    // Update the worksapce name on startup
    updateWorkspaceIndicator(screen.get_active_workspace_index());
}

function disable() {
    Main.panel.statusArea.activities.actor.show();
    menu.actor.hide();
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
function updateWorkspaceIndicator (workspaceIndex) {
    let name = Meta.prefs_get_workspace_name(workspaceIndex);
    setWorkspaceName(name);
};

function updateIndicatorPosition(workspace) {
    if (!Tiling.spaces)
        return;
    let space = Tiling.spaces.spaceOf(workspace);
    if (!space)
        return;
    let position = menu._label.get_position();
    if (position[0] === 0)
        return;
    space.label.set_position(
        ...position);
}

function setWorkspaceName (name) {
    menu._label.text = name;
}

function setMonitor(monitor) {
    let panelBox = Main.layoutManager.panelBox;
    panelBox.set_position(monitor.x, monitor.y);
    panelBox.width = monitor.width;
}
