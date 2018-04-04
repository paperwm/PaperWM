/*
  Functionality related to the top bar, often called the statusbar.
 */

const Meta = imports.gi.Meta;
const Main = imports.ui.main;

var orginalActivitiesText;
function init () {
    let label = Main.layoutManager.panelBox.first_child.first_child.first_child.first_child.first_child;
    orginalActivitiesText = label.text;
}

var updateIndicatorSignal;
function enable () {
    updateIndicatorSignal =
        global.screen.connect_after('workspace-switched',
                                    (screen, from, to) => {
                                        updateWorkspaceIndicator(to);
                                    });

    // Update the worksapce name on startup
    updateWorkspaceIndicator(global.screen.get_active_workspace_index());
}

function disable () {
    global.screen.disconnect(updateIndicatorSignal);
    setWorkspaceName(orginalActivitiesText);
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
    let panelBox = Main.layoutManager.panelBox;
    // A lot of boxes
    let label = panelBox.first_child.first_child
        .first_child.first_child.first_child;
    label.text = name;
}
