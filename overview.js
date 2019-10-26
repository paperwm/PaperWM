var Extension;
if (imports.misc.extensionUtils.extensions) {
    Extension = imports.misc.extensionUtils.extensions["paperwm@hedning:matrix.org"];
} else {
    Extension = imports.ui.main.extensionManager.lookup("paperwm@hedning:matrix.org");
}

var Search = imports.ui.search;
var Main = imports.ui.main;

var Tiling = Extension.imports.tiling;
var Navigator = Extension.imports.navigator;


function repl() {
    var spaces = Tiling.spaces;

    Scratch.isScratchWindow

    imports.misc.util.spawn(['tilix'])
    space.switchLeft()
    let space = spaces.selectedSpace;

    space.switchLeft()
    spaces.spaceOf(workspaceManager.get_workspace_by_index(0)).workspace.activate(global.get_current_time())


    let floating = display.get_tab_list(Meta.TabList.NORMAL, null).filter(Scratch.isScratchWindow);

    let x = 400;
    floating.forEach(mw => {
        mw.clone.reparent(Main.uiGroup);
        animateWindow(mw);
        mw.clone.set_scale(0.3, 0.3)
        mw.clone.x = x;
        x += mw.clone.width*mw.clone.scale_x + 20;
    });

    space.monitor

    Navigator.getNavigator().finish();
    Navigator.getNavigator();
    spaces._initWorkspaceStack();
    let workArea = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
    let y = workArea.y + 20;
    let ys = {}
    let scale = 0.6;
    Main.layoutManager._bgManagers[0].backgroundActor.vignette = true
    for (let [workspace, space] of spaces) {
        space.cloneClip.remove_clip();
        space.actor.set_pivot_point(0, 0);
        space.actor.set_scale(scale, scale);
        space.background.width = (space.width - 20)/space.actor.scale_y;
        space.actor.x = 10;
        space.background.show();
        space.border.hide();
        // space.background.width = space.width/space.actor.scale_y
        // space.background.x = -(space.background.width)/2
        space.actor.y = y;
        y += space.actor.height*space.actor.scale_y + 20;
    }

    for (let [workspace, space] of spaces) {
        space.cloneClip.remove_clip();
        space.actor.set_pivot_point(0.5, 0.5);
        space.background.width = space.width;
        space.background.x = 0;
        space.background.show();
        space.border.hide();
    }

    const Search = imports.ui.search;

    let search = new Search.SearchResults()

    Main.uiGroup.add_actor(search.actor)

    search.actor.y = 200

}

