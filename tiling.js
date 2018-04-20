const Extension = imports.misc.extensionUtils.extensions['paperwm@hedning:matrix.org']
const GLib = imports.gi.GLib;
const Tweener = imports.ui.tweener;
const Lang = imports.lang;
const Meta = imports.gi.Meta;
const Clutter = imports.gi.Clutter;
const St = imports.gi.St;
const Main = imports.ui.main;
const Shell = imports.gi.Shell;
const Gio = imports.gi.Gio;
const utils = Extension.imports.utils;
const debug = utils.debug;

var Minimap = Extension.imports.minimap;
var Scratch = Extension.imports.scratch;
var TopBar = Extension.imports.topbar;
var Navigator = Extension.imports.navigator;
var Me = Extension.imports.tiling;

let preferences = Extension.imports.convenience.getSettings();
// Gap between windows
var window_gap = preferences.get_int('window-gap');
// Top/bottom margin
var margin_tb = preferences.get_int('vertical-margin');
margin_tb = 6
// left/right margin
var margin_lr = preferences.get_int('horizontal-margin');
margin_lr = 30
// How much the stack should protrude from the side
var stack_margin = 75;
// Minimum margin
var minimumMargin = 30;

// FIXME: stackoverlay have to be imported after certain global variables have been
//        defined atm. Preferences should be accessed as preferences and globals
//        such as stack_margin should probably not be in tiling.js
const StackOverlay = Extension.imports.stackoverlay;


var primary = Main.layoutManager.primaryMonitor;

var panelBox = Main.layoutManager.panelBox;

// From https://developer.gnome.org/hig-book/unstable/design-color.html.en
let colors = [
    '#9DB8D2', '#7590AE', '#4B6983', '#314E6C',
    '#EAE8E3', '#BAB5AB', '#807D74', '#565248',
    '#C5D2C8', '#83A67F', '#5D7555', '#445632',
    '#E0B6AF', '#C1665A', '#884631', '#663822',
    '#ADA7C8', '#887FA3', '#625B81', '#494066',
    '#EFE0CD', '#E0C39E', '#B39169', '#826647',
    '#DF421E', '#990000', '#EED680', '#D1940C',
    '#46A046', '#267726', '#ffffff', '#000000'
];
let color = 3; // light -> dark: 0 -> 3
let containers = [];

/**
   Array used to store the scrolled tiling.
 */
class Space extends Array {
    constructor (workspace) {
        super(0);
        this.workspace = workspace;
        this.addSignal =
            workspace.connect("window-added",
                              utils.dynamic_function_ref("add_handler", Me));
        this.removeSignal =
            workspace.connect("window-removed",
                              utils.dynamic_function_ref("remove_handler", Me));

        let cloneContainer = new St.Widget();
        let label = new St.Label();

        label.text = Meta.prefs_get_workspace_name(workspace.index());
        label.set_position(12, 6);
        cloneContainer.add_actor(label);

        this.cloneContainer = cloneContainer;

        cloneContainer.set_size(global.screen_width, global.screen_height);
        cloneContainer.set_clip(-10, -10,
                                global.screen_width + 2*10,
                                global.screen_height + 10);
        cloneContainer.set_pivot_point(0.5, 0);

        let cloneParent = backgroundGroup;
        cloneParent.add_actor(cloneContainer);
        cloneParent.set_child_above_sibling(
            cloneContainer,
            cloneParent.first_child);

        cloneContainer.set_style(
            `background: ${colors[color]};
             box-shadow: 0px -10px 4px 2px black;
             box-shadow: 0px -4px 8px 0 rgba(0, 0, 0, .5);
             border-radius: 4px 4px 0 0;`);
        color = (color + 4) % colors.length;

        this.selectedWindow = null;
        this.moving = false;
        this.leftStack = 0; // not implemented
        this.rightStack = 0; // not implemented
    }

    // Fix for eg. space.map, see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes#Species
    static get [Symbol.species]() { return Array; }

    selectedIndex () {
        if (this.selectedWindow) {
            return this.indexOf(this.selectedWindow);
        } else {
            return -1;
        }
    }

    topOfLeftStack () {
        // There's no left stack
        if (!isStacked(this[0]))
            return null;

        for(let i = 0; i < this.length; i++) {
            if (!isStacked(this[i])) {
                return this[i - 1];
            }
        }
        return null;
    }

    topOfRightStack () {
        // There's no right stack
        if (!isStacked(this[this.length-1]))
            return null;

        for(let i = this.length - 1; i >= 0; i--) {
            if (!isStacked(this[i])) {
                return this[i + 1];
            }
        }
        return null;
    }
}

// Symbol to retrieve the focus handler id
var signals, oldSpaces, backgroundGroup;
function init() {
    signals = Symbol();
    oldSpaces = new Map();

    backgroundGroup = global.window_group.first_child;

    global.screen[signals] = [];
    global.display[signals] = [];
}

function enable() {
    global.screen[signals].push(
        global.screen.connect(
            'notify::n-workspaces',
            Lang.bind(spaces,
                      utils.dynamic_function_ref('workspacesChanged', spaces))),

        global.screen.connect(
            'workspace-removed',
            utils.dynamic_function_ref('workspaceRemoved', spaces)),

        global.screen.connect(
            'workspace-switched',
            (screen, from, to) => {
                Navigator.switchWorkspace(global.screen.get_workspace_by_index(to));
            }),

        // Reset primary when monitors change
        global.screen.connect("monitors-changed",
            function(screen) {
                primary = Main.layoutManager.primaryMonitor;
            }));

    global.display[signals].push(
        global.display.connect(
            'window-created',
            utils.dynamic_function_ref('window_created', spaces)));

    // HACK: couldn't find an other way within a reasonable time budget
    // This state is different from being enabled after startup. Existing
    // windows are not accessible yet for instance.
    let isDuringGnomeShellStartup = Main.actionMode === Shell.ActionMode.NONE;

    function initWorkspaces() {

        global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null)
            .forEach(metaWindow => {
                let actor = metaWindow.get_compositor_private();
                let clone = new Clutter.Clone({source: actor});
                metaWindow.clone = clone;
            });

        // Hook up existing workspaces
        for (let i=0; i < global.screen.n_workspaces; i++) {
            let workspace = global.screen.get_workspace_by_index(i)
            let oldSpace = oldSpaces.get(workspace);
            spaces.addSpace(workspace);
            add_all_from_workspace(workspace, oldSpace);
            debug("workspace", workspace)
        }

        global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null)
            .forEach(metaWindow => {
                metaWindow[signals] = [
                    metaWindow.connect("focus", focus_wrapper),
                    metaWindow.connect('notify::minimized', minimizeWrapper),
                    metaWindow.connect('size-changed', sizeHandler)
                ];
                let actor = metaWindow.get_compositor_private();
                actor[signals] = [
                    actor.connect('show', showWrapper)
                ];
            });

        Navigator.switchWorkspace(global.screen.get_active_workspace());
    }

    if (isDuringGnomeShellStartup) {
        // Defer workspace initialization until existing windows are accessible.
        // Otherwise we're unable to restore the tiling-order. (when restarting
        // gnome-shell)
        Main.layoutManager.connect('startup-complete', function() {
            isDuringGnomeShellStartup = false;
            initWorkspaces();
        });
    } else {
        initWorkspaces();
    }
}

function disable () {
    global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null)
        .forEach(metaWindow => {
            let actor = metaWindow.get_compositor_private();
            actor.set_scale(1, 1);
            actor.set_pivot_point(0, 0);

            if (actor[signals]) {
                actor[signals].forEach(id => actor.disconnect(id));
            }

            metaWindow.clone.destroy();

            if (metaWindow[signals]) {
                metaWindow[signals].forEach(id => metaWindow.disconnect(id));
                delete metaWindow[signals];
            }

            actor.show();
        });

    // Copy the old spaces.
    oldSpaces = new Map(spaces);

    // Disable workspace related signals
    global.screen[signals].forEach(id => global.screen.disconnect(id));
    global.display[signals].forEach(id => global.display.disconnect(id));
    global.screen[signals] = [];
    global.display[signals] = [];
    for (let [workspace, space] of spaces) {
        spaces.removeSpace(space);
    }
}

/**
   A `Map` to store all `Spaces`'s, indexed by the corresponding workspace.

   TODO: Move initialization to enable
 */
var spaces = (function () {
    let spaces = new Map();

    spaces.workspacesChanged = function () {
        let nWorkspaces = global.screen.n_workspaces;

        // Identifying destroyed workspaces is rather bothersome,
        // as it will for example report having windows,
        // but will crash when looking at the workspace index

        // Gather all indexed workspaces for easy comparison
        let workspaces = {};
        for (let i=0; i < nWorkspaces; i++) {
            let workspace = global.screen.get_workspace_by_index(i);
            workspaces[workspace] = true;
            if (spaces.spaceOf(workspace) === undefined) {
                debug('workspace added', workspace);
                this.addSpace(workspace);
            }
        }

        for (let [workspace, space] of spaces) {
            if (workspaces[space.workspace] !== true) {
                debug('workspace removed', space.workspace);
                this.removeSpace(space);
            }
        }
    };

    spaces.workspaceRemoved = function(screen, index) {
        let settings = new Gio.Settings({ schema_id:
                                          'org.gnome.desktop.wm.preferences'});
        let names = settings.get_strv('workspace-names');

        // Move removed workspace name to the end. Could've simply removed it
        // too, but this way it's not lost. In the future we want a UI to select
        // old names when selecting a new workspace.
        names = names.slice(0, index).concat(names.slice(index+1), [names[index]]);
        settings.set_strv('workspace-names', names);
    };

    spaces.addSpace = function(workspace) {
        this.set(workspace, new Space(workspace));
    };

    spaces.removeSpace = function(space) {
        let workspace = space.workspace;
        workspace.disconnect(space.addSignal);
        workspace.disconnect(space.removeSignal);
        space.cloneContainer.destroy();
        this.delete(workspace);
    };

    spaces.spaceOfWindow = function(meta_window) {
        return this.get(meta_window.get_workspace());
    };

    spaces.spaceOf = function(workspace) {
        return this.get(workspace);
    };

    spaces.window_created = function (display, metaWindow, user_data) {
        if (!metaWindow[signals]) {
            metaWindow[signals] = [
                metaWindow.connect("focus", focus_wrapper),
                metaWindow.connect('notify::minimized', minimizeWrapper)
            ];
        }

        let actor = metaWindow.get_compositor_private();
        let clone = new Clutter.Clone({source: actor});
        metaWindow.clone = clone;

        actor[signals] = [
            actor.connect('show', showWrapper)
        ];

        // Only run setInitialPosition on inserted windows
        if (!metaWindow[isInserted])
            return;
        delete metaWindow[isInserted];
        debug('window-created', metaWindow.title);
        let signal = Symbol();
        metaWindow[signal] = actor.connect('show',
                                           Lang.bind({metaWindow, signal}, setInitialPosition));
    };

    return spaces;
})();


/**
   Add any existing windows on `workspace` to the corresponding `Space`,
   optionally using `windows` as a preferred order.
 */
function add_all_from_workspace(workspace, windows = []) {

    // On gnome-shell-restarts the windows are moved into the viewport, but
    // they're moved minimally and the stacking is not changed, so the tiling
    // order is preserved (sans full-width windows..)
    function xz_comparator(windows) {
        // Seems to be the only documented way to get stacking order?
        // Could also rely on the MetaWindowActor's index in it's parent
        // children array: That seem to correspond to clutters z-index (note:
        // z_position is something else)
        let z_sorted = global.display.sort_windows_by_stacking(windows);
        function xkey(mw) {
            let frame = mw.get_frame_rect();
            if(frame.x <= 0)
                return 0;
            if(frame.x+frame.width == primary.width) {
                return primary.width;
            }
            return frame.x;
        }
        // xorder: a|b c|d
        // zorder: a d b c
        return (a,b) => {
            let ax = xkey(a);
            let bx = xkey(b);
            // Yes, this is not efficient
            let az = z_sorted.indexOf(a);
            let bz = z_sorted.indexOf(b);
            let xcmp = ax - bx;
            if (xcmp !== 0)
                return xcmp;

            if (ax === 0) {
                // Left side: lower stacking first
                return az - bz;
            } else {
                // Right side: higher stacking first
                return bz - az;
            }
        };
    }

    workspace = workspace || global.screen.get_active_workspace();
    windows = windows.concat(
        // Add all the other windows as we want to support someone disabling
        // the extension, and enabling it after using the session for a
        // while
        workspace.list_windows()
            .filter(w => windows.indexOf(w) === -1)
            .sort(xz_comparator(workspace.list_windows())));

    let space = spaces.spaceOf(workspace);
    windows.forEach((meta_window, i) => {
        if (meta_window.above || meta_window.minimized) {
            // Rough heuristic to figure out if a window should float
            Scratch.makeScratch(meta_window);
            return;
        }
        if(space.indexOf(meta_window) < 0 && add_filter(meta_window, true)) {
            // Using add_handler is unreliable since it interacts with focus.
            space.push(meta_window);
            space.cloneContainer.add_actor(meta_window.clone);
        }
    })

    let tabList = global.display.get_tab_list(Meta.TabList.NORMAL, workspace)
        .filter(metaWindow => { return space.indexOf(metaWindow) !== -1; });
    if (tabList[0]) {
        space.selectedWindow = tabList[0]
        ensureViewport(space.selectedWindow, space);
    }
}

/**
   Types of windows which never should be tiled.
 */
function add_filter(meta_window, startup) {
    let add = true;
    if (meta_window.window_type != Meta.WindowType.NORMAL
        || meta_window.get_transient_for() != null
        || meta_window.is_on_all_workspaces()
        ) {
        add = false;
    }

    let winprop = find_winprop(meta_window);
    if (winprop) {
        if (winprop.oneshot) {
            // untested :)
            winprops.splice(winprops.indexOf(winprop), 1);
        }
        if (winprop.float) {
            // Let gnome-shell handle the placement
            add = false;
        }
        if (winprop.scratch_layer) {
            Scratch.makeScratch(meta_window);
            add = false;
        }
    }

    // If we're focusing a scratch window make on top and return
    let focus_window = global.display.focus_window;
    if (Scratch.isScratchWindow(focus_window) && !startup) {
        Scratch.makeScratch(meta_window);
        add = false;
    }

    // If the window is a scratch window make it always on top
    if (Scratch.isScratchWindow(meta_window)) {
        meta_window.make_above();
        add = false;
    }

    return add;
}


/**
   Handle windows leaving workspaces.

   TODO: move to `Space`
 */
function remove_handler(workspace, meta_window) {
    debug("window-removed", meta_window, meta_window.title, workspace.index());
    // Note: If `meta_window` was closed and had focus at the time, the next
    // window has already received the `focus` signal at this point.
    // Not sure if we can check directly if _this_ window had focus when closed.

    let space = spaces.spaceOf(workspace);
    let removed_i = space.indexOf(meta_window)
    if (removed_i < 0)
        return
    space.splice(removed_i, 1)

    space.cloneContainer.remove_actor(meta_window.clone);

    if (space.selectedWindow === meta_window) {
        // Window closed or moved when other workspace is active so no new focus
        // has been assigned in this workspace.
        // Ideally we'd get the window that will get focus when this workspace
        // is activated again, but the function mutter use doesn't seem to be
        // exposed to javascript.

        // Use the top window in the MRU list as a proxy:
        let mru_list = global.display.get_tab_list(Meta.TabList.NORMAL, workspace);
        // The mru list might contain needy windows from other workspaces
        space.selectedWindow =
            mru_list.filter(w => w.get_workspace() === workspace
                            && space.indexOf(w) !== -1 )[0];
    }

    // (could be an empty workspace)
    if (space.selectedWindow) {
        // Force a new ensure, since the focus_handler is run before
        // window-removed
        ensureViewport(space.selectedWindow, space, true)
    }
}

/**
   Handle windows entering workspaces.

   TODO: move to `Space`
*/
function add_handler(ws, meta_window) {
    debug("window-added", meta_window, meta_window.title, meta_window.window_type, ws.index());
    if (!add_filter(meta_window)) {
        return;
    }

    let space = spaces.spaceOf(ws);

    // Don't add already added windows
    if (space.indexOf(meta_window) != -1) {
        return;
    }

    let insert_after_i = -1; // (-1 -> at beginning)
    if (space.selectedWindow) {
        insert_after_i = space.indexOf(space.selectedWindow);
    }

    insertWindow(space, meta_window, insert_after_i + 1);
}

var isInserted = Symbol();
// Insert @metaWindow in @space at @index, setting up focus handling
function insertWindow(space, metaWindow, index) {
    index = index || space.length;
    space.splice(index, 0, metaWindow);

    metaWindow.unmake_above();

    if (index == 0) {
        // If the workspace was empty the inserted window should be selected
        space.selectedWindow = metaWindow;

        let frame = metaWindow.get_frame_rect();
        metaWindow.scrollwm_initial_position =
            {x: primary.x + (primary.width - frame.width)/2,
             y: primary.y + panelBox.height + margin_tb};
    } else {
        let frame = space[index - 1].get_frame_rect()
        metaWindow.scrollwm_initial_position =
            {x: primary.x + frame.x + frame.width + window_gap,
             y: primary.y + panelBox.height + margin_tb};

    }

    let actor = metaWindow.get_compositor_private();
    // If the MetaWindowActor is available the window already exists and we can
    // position
    if (actor) {
        debug('attach window', metaWindow.title, metaWindow.has_focus())
        // Set position and hookup signals, with `existing` set to true
        setInitialPosition.apply({metaWindow}, [ actor, true ]);
    } else {
        // Let either `focus` or `first-frame` do positioning and further signal
        // hookup

        // Set `isInserted` so `first-frame` signal will connect `focus_wrapper`
        metaWindow[isInserted] = true;
        let signal = Symbol();
        metaWindow[signal] = metaWindow.connect('focus',
                                                Lang.bind({metaWindow, signal}, setInitialPosition));
    }
}

/**
   Weird utility to function that applies the any initial position on newly
   added windows. Specifically gets called by the first `MetaWindow::focus`,
   or `Actor::show` signal.

   The main purpose is handling both newly created window and windows that are
   moved into a workspace. This is probably pretty foolish.

   NB: Needs to be called by {metaWindow, signal}
*/
function setInitialPosition(actor, existing) {
    let {metaWindow, signal} = this;

    if(metaWindow.scrollwm_initial_position) {
        debug("setting initial position", metaWindow.scrollwm_initial_position)
        if (metaWindow.get_maximized() == Meta.MaximizeFlags.BOTH) {
            metaWindow.unmaximize(Meta.MaximizeFlags.BOTH);
            toggle_maximize_horizontally(metaWindow);
            return;
        }
        let space = spaces.spaceOfWindow(metaWindow);

        // Only move the frame when dealing with new windows
        !existing && metaWindow.move_frame(true,
                              metaWindow.scrollwm_initial_position.x,
                              metaWindow.scrollwm_initial_position.y);


        if (metaWindow.has_focus()) {
            space.selectedWindow = metaWindow;
            ensureViewport(metaWindow, space, true);
        } else {
            ensureViewport(space.selectedWindow, space);
        }

        delete metaWindow.scrollwm_initial_position;
    }

    let signalId = metaWindow[signal];
    // check if we're in `first-frame` or `focus`
    if (actor.constructor == Meta.WindowActor) {
        signalId && metaWindow.get_compositor_private().disconnect(signalId);
        metaWindow[signals].push(
            metaWindow.connect('size-changed', sizeHandler));

        let space = spaces.spaceOfWindow(metaWindow);
        space.cloneContainer.add_actor(metaWindow.clone);
    } else {
        signalId && metaWindow.disconnect(signalId);
    }
}


/**
   Make sure that `meta_window` is in view, scrolling the space if needed.
 */
function ensureViewport(meta_window, space, force) {
    space = space || spaces.spaceOfWindow(meta_window);
    if (space.moving == meta_window && !force) {
        debug('already moving', meta_window.title);
        return;
    }
    debug('Moving', meta_window.title);

    meta_window._isStacked = false;

    let index = space.indexOf(meta_window)
    if (index === -1)
        return;

    space.selectedWindow = meta_window;
    let frame = meta_window.get_frame_rect();
    meta_window.move_resize_frame(true, frame.x, frame.y,
                                  frame.width,
                                  primary.height - panelBox.height - margin_tb*2);

    // Hack to ensure the statusbar is visible while there's a fullscreen
    // windows in the space.
    if (!meta_window.fullscreen) {
        TopBar.show();
    }

    if (meta_window.destinationX !== undefined)
        // Use the destination of the window if available
        frame.x = meta_window.destinationX;
    let x = frame.x;
    let y = panelBox.height + margin_tb;
    let required_width = space.reduce((length, meta_window) => {
        let frame = meta_window.get_frame_rect();
        return length + frame.width + window_gap;
    }, -window_gap);
    if (meta_window.fullscreen) {
        // Fullscreen takes highest priority
        x = 0, y = 0;
        TopBar.hide();
    } else if (meta_window.maximized_vertically
               && meta_window.maximized_horizontally) {
        x = frame.x;
        y = frame.y;
    } else if (required_width <= primary.width) {
        let leftovers = primary.width - required_width;
        let gaps = space.length + 1;
        let extra_gap = Math.floor(leftovers/gaps);
        debug('#extragap', extra_gap);
        propagateForward(space, 0, extra_gap, extra_gap + window_gap);
        propagateBackward(space, -1);
        return;
    } else if (index == 0) {
        // Always align the first window to the display's left edge
        x = 0;
    } else if (index == space.length-1) {
        // Always align the first window to the display's right edge
        x = primary.width - frame.width;
    } else if (frame.width >
               primary.width - 2*(margin_lr + stack_margin + window_gap)) {
        // Consider the window to be wide and center it
        x = Math.round((primary.width - frame.width)/2);

    } else if (frame.x + frame.width > primary.width) {
        // Align to the right margin_lr
        x = primary.width - margin_lr - frame.width;
    } else if (frame.x < 0) {
        // Align to the left margin_lr
        x = margin_lr;
    } else if (frame.x + frame.width === primary.width) {
        // When opening new windows at the end, in the background, we want to
        // show some minimup margin
        x = primary.width - minimumMargin - frame.width;
    } else if (frame.x === 0) {
        // Same for the start (though the case isn't as common)
        x = minimumMargin;
    }

    space.moving = meta_window;
    move_to(space, meta_window,
            { x, y,
              onComplete: () => {
                  space.moving = false;
                  // Certain gnome-shell/mutter animations expect default
                  // pivot point (eg. fullscreen)
                  meta_window.get_compositor_private().set_pivot_point(0, 0);
              },
              onStart:() => { meta_window.raise(); }
            });
    // Return x so we can position the minimap
    return x;
}


/**
   Animate @meta_window to (@x, @y) in primary relative coordinates.


   FIXME: This should really be __monitor__ relative instead.
 */
function move(meta_window, {x, y,
                            onComplete,
                            onStart,
                            delay,
                            transition,
                            stack
                           }) {

    onComplete = onComplete || (() => {});
    onStart = onStart || (() => {});
    delay = delay || 0;
    transition = transition || 'easeInOutQuad';

    let actor = meta_window.get_compositor_private();
    let buffer = meta_window.get_buffer_rect();
    let frame = meta_window.get_frame_rect();
    let clone = meta_window.clone;

    clone.show();
    actor.hide();

    // Set monitor offset
    y += primary.y;
    x += primary.x;
    let x_offset = frame.x - buffer.x;
    let y_offset = frame.y - buffer.y;
    meta_window.destinationX = x;
    Tweener.addTween(clone, {x: x - x_offset
                             , y: y - y_offset
                             , time: 0.25 - delay
                             , delay: delay
                             , scale_y: 1
                             , scale_x: 1
                             , transition: transition
                             , onStart: onStart
                             , onComplete: () => {
                                 meta_window.destinationX = undefined;
                                 if(meta_window.get_compositor_private()) {
                                     // If the actor is gone, the window is in process of closing
                                     if (!stack) {
                                         actor.set_position(clone.x, clone.y);
                                         clone.hide();
                                         actor.show();
                                     }
                                     meta_window.move_frame(true, x, y);
                                     onComplete();
                                 }
                             }
                            })

}

// Move @meta_window to x, y and propagate the change in @space
function move_to(space, meta_window, { x, y, delay, transition,
                                         onComplete, onStart }) {
    move(meta_window, { x, y
                        , onComplete
                        , onStart
                        , delay
                        , transition }
        );
    let index = space.indexOf(meta_window);
    let frame = meta_window.get_frame_rect();
    propagateForward(space, index + 1, x + frame.width + window_gap);
    propagateBackward(space, index - 1, x - window_gap);
    fixStack(space, index);
}

// Place window's left edge at x
function propagateForward(space, n, x, gap) {
    if (n < 0 || n >= space.length) {
        StackOverlay.rightOverlay.setTarget(null);
        return;
    }
    let meta_window = space[n];
    let frame = meta_window.get_frame_rect();
    gap = gap || window_gap;

    let stack = false;
    // Check if we should start stacking windows
    if (x > primary.width - stack_margin) {
        stack = true;
        meta_window._isStacked = true;
    } else {
        meta_window._isStacked = false;
    }

    let actor = meta_window.get_compositor_private();
    if (actor) {
        // Anchor scaling/animation on the left edge for windows positioned to the right,

        move(meta_window, { x,
                            y: meta_window.fullscreen ?
                            0 :
                            panelBox.height + margin_tb,
                            stack
                          });
        propagateForward(space, n+1, x+meta_window.get_frame_rect().width + gap, gap);
    } else {
        // If the window doesn't have an actor we should just skip it
        propagateForward(space, n+1, x, gap);
    }
}

// Place window's right edge at x
function propagateBackward(space, n, x, gap) {
    if (n < 0 || n >= space.length) {
        StackOverlay.leftOverlay.setTarget(null);
        return;
    }
    let meta_window = space[n];
    let frame = meta_window.get_frame_rect();
    gap = gap || window_gap;

    // Check if we should start stacking windows
    let stack = false;
    if (x < stack_margin) {
        stack = true;
        meta_window._isStacked = true;
    } else {
        meta_window._isStacked = false;
    }

    let actor = meta_window.get_compositor_private();
    if (actor) {
        x = x - meta_window.get_frame_rect().width
        // Anchor on the right edge for windows positioned to the left.
        move(meta_window, { x, y: meta_window.fullscreen ?
                            0 :
                            panelBox.height + margin_tb,
                            stack
                          });
        propagateBackward(space, n-1, x - gap, gap);
    } else {
        // If the window doesn't have an actor we should just skip it
        propagateBackward(space, n-1, x, gap);
    }
}

// `MetaWindow::size-changed` handling
function sizeHandler(metaWindow) {
    debug('size-changed', metaWindow.title);
    let space = spaces.spaceOfWindow(metaWindow);
    if (space.selectedWindow === metaWindow)
        ensureViewport(metaWindow, space, true);
}

// `MetaWindow::focus` handling
function focus_handler(meta_window, user_data) {
    debug("focus:", meta_window.title, utils.framestr(meta_window.get_frame_rect()));

    if (Scratch.isScratchWindow(meta_window)) {
        Scratch.makeScratch(meta_window);
        TopBar.show();
        return;
    }

    // If meta_window is a transient window ensure the parent window instead
    let transientFor = meta_window.get_transient_for();
    if (transientFor !== null) {
        meta_window = transientFor;
    }

    let space = spaces.spaceOfWindow(meta_window);
    ensureViewport(meta_window, space);
}
let focus_wrapper = utils.dynamic_function_ref('focus_handler', Me);

/**
   Push all minimized windows to the scratch layer
 */
function minimizeHandler(metaWindow) {
    debug('minimized', metaWindow.title);
    if (metaWindow.minimized) {
        Scratch.makeScratch(metaWindow);
    }
}
let minimizeWrapper = utils.dynamic_function_ref('minimizeHandler', Me);

/**
  `WindowActor::show` handling

  Kill any falsely shown WindowActor.
*/
function showHandler(actor) {
    let metaWindow = actor.meta_window;
    let onActive = metaWindow.get_workspace() === global.screen.get_active_workspace();

    if (Scratch.isScratchWindow(metaWindow))
        return;

    if (metaWindow.clone.visible || ! onActive || Navigator.navigating) {
        actor.hide();
        metaWindow.clone.show();
    }
}
let showWrapper = utils.dynamic_function_ref('showHandler', Me);

/**
  We need to stack windows in mru order, since mutter picks from the
  stack, not the mru, when auto choosing focus after closing a window.
 */
function fixStack(space, around) {
    let mru = global.display.get_tab_list(Meta.TabList.NORMAL,
                                          space.workspace);

    for (let i=1; i >= 0; i--) {
        let leftWindow = space[around - i];
        let rightWindow = space[around + i];
        mru.filter(w => w === leftWindow || w === rightWindow)
            .reverse()
            .forEach(w => w && w.raise());
    }
}

/**
  Modelled after notion/ion3's system

  Examples:

    defwinprop({
        wm_class: "Riot",
        scratch_layer: true
    })
*/
var winprops = [];

function winprop_match_p(meta_window, prop) {
    let wm_class = meta_window.wm_class || "";
    let title = meta_window.title;
    if (prop.wm_class !== wm_class) {
        return false;
    }
    if (prop.title) {
        if (prop.title.constructor === RegExp) {
            if (!title.match(prop.title))
                return false;
        } else {
            if (prop.title !== title)
                return false;
        }
    }

    return true;
}

function find_winprop(meta_window)  {
    let props = winprops.filter(
        winprop_match_p.bind(null, meta_window));

    return props[0];
}

function defwinprop(spec) {
    winprops.push(spec);
}

/* simple utils */

function isStacked(metaWindow) {
    return metaWindow._isStacked;
}

function isUnStacked(metaWindow) {
    return !isStacked(metaWindow);
}

function isFullyVisible(metaWindow) {
    let frame = metaWindow.get_frame_rect();
    return frame.x >= 0 && (frame.x + frame.width) <= primary.width;
}

// Detach meta_window or the focused window by default
// Can be used from the looking glass
function detach (meta_window) {
    meta_window = meta_window || global.display.focus_window;
    remove_handler(meta_window.get_workspace(), meta_window)
}

function center(meta_window, zen) {
    let frame = meta_window.get_frame_rect();
    let x = Math.floor((primary.width - frame.width)/2)
    move_to(undefined, meta_window, {x, y: frame.y})
    let right = zen ? primary.width : x + frame.width + window_gap;
    let left = zen ? -primary.width : x - window_gap;
    let space = spaces.spaceOfWindow(meta_window);
    let i = space.indexOf(meta_window);
    propagateForward(space, i + 1, right);
    propagateBackward(space, i - 1, left);
}

function toggle_maximize_horizontally(meta_window) {
    meta_window = meta_window || global.display.focus_window;

    // TODO: make some sort of animation
    // Note: should investigate best-practice for attaching extension-data to meta_windows
    if(meta_window.unmaximized_rect) {
        let unmaximized_rect = meta_window.unmaximized_rect;
        meta_window.move_resize_frame(true,
                                      unmaximized_rect.x, unmaximized_rect.y,
                                      unmaximized_rect.width, unmaximized_rect.height)
        meta_window.unmaximized_rect = undefined;
    } else {
        let frame = meta_window.get_frame_rect();
        meta_window.unmaximized_rect = frame;
        meta_window.move_resize_frame(true, minimumMargin, frame.y, primary.width - minimumMargin*2, frame.height);
    }
}

function tileVisible(metaWindow) {
    metaWindow = metaWindow || global.display.focus_window;
    let space = spaces.spaceOfWindow(metaWindow);
    if (!space)
        return;

    let active = space.filter(isUnStacked);
    let requiredWidth =
        utils.sum(active.map(mw => mw.get_frame_rect().width))
        + (active.length-1)*window_gap + minimumMargin*2;
    let deficit = requiredWidth - primary.width;
    if (deficit > 0) {
        let perWindowReduction = Math.ceil(deficit/active.length);
        active.forEach(mw => {
            let frame = mw.get_frame_rect();
            mw.move_resize_frame(true, frame.x, frame.y, frame.width - perWindowReduction, frame.height);
        });

    }
    move_to(space, active[0], { x: minimumMargin, y: active[0].get_frame_rect().y });
}

function cycleWindowWidth(metaWindow) {
    const gr = 1/1.618;
    const ratios = [(1-gr), 1/2, gr];

    function findNext(tr) {
        // Find the first ratio that is significantly bigger than 'tr'
        for (let i = 0; i < ratios.length; i++) {
            let r = ratios[i]
            if (tr <= r) {
                if (tr/r > 0.9) {
                    return (i+1) % ratios.length;
                } else {
                    return i;
                }
            }
        }
        return 0; // cycle
    }
    let frame = metaWindow.get_frame_rect();
    let availableWidth = primary.width - minimumMargin*2;
    let r = frame.width / availableWidth;
    let nextW = Math.floor(ratios[findNext(r)]*availableWidth);
    metaWindow.move_resize_frame(true, frame.x, frame.y, nextW, frame.height);

    delete metaWindow.unmaximized_rect;
}
