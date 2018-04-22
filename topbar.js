/*
  Functionality related to the top bar, often called the statusbar.
 */

const Extension = imports.misc.extensionUtils.extensions['paperwm@hedning:matrix.org'];
const Meta = imports.gi.Meta;
const Main = imports.ui.main;
const Tweener = imports.ui.tweener;

const Tiling = Extension.imports.tiling;

var panelBox = Main.layoutManager.panelBox;

var orginalActivitiesText;
var screenSignals;
function init () {
    let label = Main.panel.statusArea.activities.actor.first_child;
    orginalActivitiesText = label.text;
    screenSignals = [];
}

var panelBoxShowId, panelBoxHideId;
function enable () {

    // Force transparency
    Main.panel.actor.set_style('background-color: rgba(0, 0, 0, 0.35);');
    [Main.panel._rightCorner, Main.panel._leftCorner]
        .forEach(c => c.actor.hide());

    screenSignals.push(
        global.screen.connect_after('workspace-switched',
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
    updateWorkspaceIndicator(global.screen.get_active_workspace_index());
}

function disable() {
    Main.panel.actor.set_style('');
    [Main.panel._rightCorner, Main.panel._leftCorner]
        .forEach(c => c.actor.show());

    screenSignals.forEach(id => global.screen.disconnect(id));
    screenSignals = [];

    setWorkspaceName(orginalActivitiesText);

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

function setWorkspaceName (name) {
    let label = Main.panel.statusArea.activities.actor.first_child;
    label.text = name;
}
