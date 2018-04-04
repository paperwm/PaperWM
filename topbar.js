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
function init () {
    let label = panelBox.first_child.first_child.first_child.first_child.first_child;
    orginalActivitiesText = label.text;
}

var updateIndicatorSignal, panelBoxShowId, panelBoxHideId;
function enable () {
    updateIndicatorSignal =
        global.screen.connect_after('workspace-switched',
                                    (screen, from, to) => {
                                        updateWorkspaceIndicator(to);
                                    });

    panelBoxShowId =  panelBox.connect('show', show);
    panelBoxHideId = panelBox.connect('hide', () => {
        let space = Tiling.spaces.spaceOf(global.screen.get_active_workspace());
        if (space.selectedWindow.fullscreen) {
            hide();
        } else {
            panelBox.show();
        }
    });
    // Update the worksapce name on startup
    updateWorkspaceIndicator(global.screen.get_active_workspace_index());
}

function disable () {
    global.screen.disconnect(updateIndicatorSignal);
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
    // A lot of boxes
    let label = panelBox.first_child.first_child
        .first_child.first_child.first_child;
    label.text = name;
}
