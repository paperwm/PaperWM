var Extension;
if (imports.misc.extensionUtils.extensions) {
    Extension = imports.misc.extensionUtils.extensions["paperwm@hedning:matrix.org"];
} else {
    Extension = imports.ui.main.extensionManager.lookup("paperwm@hedning:matrix.org");
}

var Search = imports.ui.search;
var Main = imports.ui.main;
var {Shell, St, Clutter} = imports.gi;

var Tiling = Extension.imports.tiling;
var Navigator = Extension.imports.navigator;

var spaces = Tiling.spaces;
var scale = 0.45;

var Overview = class Overview {
    constructor() {
        this.actor = new Shell.Stack();
        this.workspaceView = new Workspaces
    }
};

var Workspaces = class Workspaces {
    constructor(monitor) {

        Main.layoutManager.trackChrome(spaces.spaceContainer);

        spaces.spaceContainer.remove_actor(this._scrollView);
        Navigator.getNavigator();
        spaces._initWorkspaceStack();


        this._list = new St.BoxLayout({ vertical: true,
                                        x_expand: true,
                                        y_expand: true,
                                      });
        this._scrollView = new St.ScrollView({ enable_mouse_scrolling: true });
        this._scrollView.set_policy(St.PolicyType.NEVER, St.PolicyType.NEVER);
        this._scrollView.add_actor(this._list);
        this.views = [];
        for (let [$, space] of spaces) {
            let view = new Workspace(space);
            this.views.push(view);
            this._list.add_actor(view.actor);
        }
        spaces.spaceContainer.add_actor(this._scrollView);
        this._scrollView.y = Main.layoutManager.panelBox.height;
        this._scrollView.x = 10;
        this._list.layout_manager.spacing = 25;
        this._list.width += 20;

        let adjustment = this._scrollView.vscroll.adjustment;
        let [value, lower_, upper, stepIncrement_, pageIncrement_, pageSize] = adjustment.get_values();

        // adjustment.ease(2*pageIncrement_, {
        //     progress_mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        //     duration: 2000,
        // });
    }
};


var Workspace = class Workspace {
    constructor(space) {
        let borderWidth = 8;
        this.space = space;
        this.actor = new St.Widget({
            height: Math.round(space.height*scale + 10),
            width: Math.round(space.width - 30),
            x_expand: true,
            y_expand: true,
        });
        this.border = new St.Widget({
            y: - borderWidth,
            width: this.actor.width + borderWidth,
            height: this.actor.height + 2*borderWidth,
        });
        this.actor.set_style = `
`
        this.actor.remove_clip();
        space.actor.reparent(this.actor);
        this.actor.add_actor(this.border);
        this.border.style = `
border: ${borderWidth}px ${space.color};
border-radius: ${borderWidth}px;
box-shadow: 0px 0px 8px 0px rgba(0, 0, 0, .7);
`;
        space.actor.x = 0;
        space.actor.y = 0;
        space.actor.set_pivot_point(0, 0);
        space.actor.set_scale(scale, scale);
        space.background.width = (space.width - 30)/space.actor.scale_y;
        space.background.height = space.height;
        space.background.height +=  10/space.actor.scale_y;
        space.cloneClip.set_clip(0, 0, space.background.width, space.background.height);
        space.border.hide();
    }
};

var SearchPage = class Search {
    constructor() {
    }
}

function repl() {

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

    space.background.background.


    Navigator.getNavigator().finish();

    var spaces = Tiling.spaces;
    Navigator.getNavigator();
    spaces._initWorkspaceStack();
    let workArea = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
    let y = workArea.y + 20;
    let ys = {}
    Main.layoutManager._bgManagers[0].backgroundActor.vignette = true
    for (let [workspace, space] of spaces) {
        space.cloneClip.remove_clip();
        space.actor.set_pivot_point(0, 0);
        space.actor.set_scale(scale, scale);
        space.background.width = (space.width - 20)/space.actor.scale_y;
        space.background.height = space.height;
        space.background.height +=  10/space.actor.scale_y;
        space.actor.x = 10;
        space.background.show();
        space.border.hide();
        // space.background.width = space.width/space.actor.scale_y
        // space.background.x = -(space.background.width)/2
        space.actor.y = y;
        y += space.actor.height*space.actor.scale_y + 20;
    }

    imports.misc.util.spawn(['tilix'])

    for (let [workspace, space] of spaces) {
        space.cloneClip.remove_clip();
        space.actor.set_pivot_point(0.5, 0.5);
        space.background.width = space.width;
        space.background.x = 0;
        space.background.show();
        space.border.hide();
    }

    let search = new Search.SearchResults()

    Main.uiGroup.add_actor(search.actor)

    search.actor.y = 200

    search.setTerms(['display'])

}

