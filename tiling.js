const Extension = imports.misc.extensionUtils.extensions['paperwm@hedning:matrix.org']
const GLib = imports.gi.GLib;
const Tweener = imports.ui.tweener;
const Lang = imports.lang;
const Meta = imports.gi.Meta;
const Main = imports.ui.main;
const Shell = imports.gi.Shell;
const Gio = imports.gi.Gio;
const utils = Extension.imports.utils;
const debug = utils.debug;
const Clutter = imports.gi.Clutter;

var Minimap = Extension.imports.minimap;
var Scratch = Extension.imports.scratch;
var Me = Extension.imports.tiling;

let preferences = Extension.imports.convenience.getSettings();
// Gap between windows
var window_gap = preferences.get_int('window-gap');
// Top/bottom margin
var margin_tb = preferences.get_int('vertical-margin');
// left/right margin
var margin_lr = preferences.get_int('horizontal-margin');
// How much the stack should protrude from the side
var stack_margin = 75;
// Minimum margin
var minimumMargin = 15;

// FIXME: stackoverlay have to be imported after certain global variables have been
//        defined atm. Preferences should be accessed as preferences and globals
//        such as stack_margin should probably not be in tiling.js
const StackOverlay = Extension.imports.stackoverlay;

// Symbol to retrieve the focus handler id
var focus_signal = Symbol();

var primary = Main.layoutManager.primaryMonitor;

var panelBox = Main.layoutManager.panelBox;

function showPanelBox() {
    panelBox.show();
    Tweener.addTween(panelBox, {
        scale_y: 1,
        time: 0.25,
        onOverwrite: () => {
            panelBox.scale_y = 1;
        }
    });
}
function hidePanelBox () {
    let space = spaces.spaceOf(global.screen.get_active_workspace());
    if (space.selectedWindow.fullscreen) {
        panelBox.scale_y = 0;
    } else {
        panelBox.show();
    }
}

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

// Singleton spaces object, shouldn't be reused
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
            if (this._spaces[workspace] === undefined) {
                debug('workspace added', workspace);
                this.addSpace(workspace);
            }
        }

        for (let key in this._spaces) {
            let space = this._spaces[key];
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
        this.delete(workspace);
    };

    spaces.spaceOfWindow = function(meta_window) {
        return this.get(meta_window.get_workspace());
    };

    spaces.spaceOf = function(workspace) {
        return this.get(workspace);
    };

    spaces.window_created = function (display, metaWindow, user_data) {
        // Only run setInitialPosition on inserted windows
        if (!metaWindow[isInserted])
            return;
        delete metaWindow[isInserted];
        debug('window-created', metaWindow.title);
        let actor = metaWindow.get_compositor_private();
        let signal = Symbol();
        metaWindow[signal] = actor.connect('show',
                                           Lang.bind({metaWindow, signal}, setInitialPosition));
        metaWindow[focus_signal] = metaWindow.connect("focus", focus_wrapper);
    };

    return spaces;
})();

function focus() {
    let meta_window = global.display.focus_window;
    if (!meta_window)
        return -1;
    return spaces.spaceOfWindow(meta_window).indexOf(meta_window);
}

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

/**
 * Animate @meta_window to (@x, @y) in frame coordinates.
 */
function move(meta_window, {x, y,
                            onComplete,
                            onStart,
                            delay,
                            transition}) {

    onComplete = onComplete || (() => {});
    onStart = onStart || (() => {});
    delay = delay || 0;
    transition = transition || 'easeInOutQuad';

    let actor = meta_window.get_compositor_private();
    let buffer = meta_window.get_buffer_rect();
    let frame = meta_window.get_frame_rect();
    // Set monitor offset
    y += primary.y;
    x += primary.x;
    let x_offset = frame.x - buffer.x;
    let y_offset = frame.y - buffer.y;
    meta_window.destinationX = x;
    Tweener.addTween(actor, {x: x - x_offset
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
                                     meta_window.move_frame(true, x, y);
                                     onComplete();
                                 }
                             }
                            })

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

// Needs to be called by {metaWindow, signal}
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
            ensure_viewport(space, metaWindow, true);
        } else {
            ensure_viewport(space, space.selectedWindow);
        }

        delete metaWindow.scrollwm_initial_position;
    }

    let signalId = metaWindow[signal];
    // check if we're in `first-frame` or `focus`
    if (actor.constructor == Meta.WindowActor) {
        signalId && metaWindow.get_compositor_private().disconnect(signalId);
    } else {
        signalId && metaWindow.disconnect(signalId);
    }
}

// Move @meta_window to x, y and propagate the change in @space
function move_to(space, meta_window, { x, y, delay, transition,
                                         onComplete, onStart }) {
    // Register @meta_window as moving on @space
    move(meta_window, { x, y
                        , onComplete
                        , onStart
                        , delay
                        , transition }
        );
    let index = space.indexOf(meta_window);
    let frame = meta_window.get_frame_rect();
    propogate_forward(space, index + 1, x + frame.width + window_gap);
    propogate_backward(space, index - 1, x - window_gap);
    fixStack(space, index);
}

const DIRECTION = {
    Left: 0,
    Right: 1
}

/**
   Put @space[@index] on the stack in @direction.
 */
function stackWindow(space, index, direction) {
    let metaWindow = space[index];
    metaWindow._isStacked = true; // use isStacked function to check

    let x, y = primary.y + panelBox.height + margin_tb;

    let actor = metaWindow.get_compositor_private();
    let buffer = metaWindow.get_buffer_rect();
    let frame = metaWindow.get_frame_rect();


    let x_offset = frame.x - buffer.x;
    let y_offset = frame.y - buffer.y;

    var max_height = primary.height - panelBox.height - margin_tb*2;
    // Height to use when scaled down at the sides
    var scaled_height = max_height*0.95;
    var scaled_y_offset = (max_height - scaled_height)/2;

    let scale = scaled_height/frame.height;
    // Center the actor properly
    y += scaled_y_offset;

    if (direction === DIRECTION.Right) {
        x = primary.x + primary.width - stack_margin;
        actor.set_pivot_point(0, y_offset/buffer.height);
    } else { // Left
        x = primary.x + stack_margin - frame.width;
        actor.set_pivot_point(1, y_offset/buffer.height);
    }

    metaWindow.destinationX = x;
    Tweener.addTween(actor, {x: x - x_offset
                             , y: y - y_offset
                             , time: 0.25
                             , scale_x: scale
                             , scale_y: scale
                             , transition: 'easeInOutQuad'
                             , onComplete: () => {
                                 metaWindow.destinationX = undefined;
                                 if(metaWindow.get_compositor_private()) {
                                     // If the actor is gone, the window is in
                                     // process of closing
                                     metaWindow.move_frame(true, x, y);
                                 }
                             }
                            });
}

function ensure_viewport(space, meta_window, force) {
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
        showPanelBox();
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
        Tweener.addTween(panelBox, {
            scale_y: 0,
            time: 0.25,
        });

    } else if (meta_window.maximized_vertically
               && meta_window.maximized_horizontally) {
        x = frame.x;
        y = frame.y;
    } else if (required_width <= primary.width) {
        let leftovers = primary.width - required_width;
        let gaps = space.length + 1;
        let extra_gap = Math.floor(leftovers/gaps);
        debug('#extragap', extra_gap);
        propogate_forward(space, 0, extra_gap, extra_gap + window_gap);
        propogate_backward(space, -1);
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

function focus_handler(meta_window, user_data) {
    debug("focus:", meta_window.title, utils.framestr(meta_window.get_frame_rect()));

    let space = spaces.spaceOfWindow(meta_window);
    ensure_viewport(space, meta_window);
}
let focus_wrapper = utils.dynamic_function_ref('focus_handler', Me);

/**
  We need to stack windows in mru order, since mutter picks from the
  stack, not the mru, when auto choosing focus after closing a window.
 */
function fixStack(space, around) {
    let topLeft = space.topOfLeftStack();
    let topRight = space.topOfRightStack();

    let left = topLeft !== null ? space.indexOf(topLeft) : 0;
    let right = topRight !== null ? space.indexOf(topRight) : space.length - 1;

    let max = Math.max(Math.abs(around - left), Math.abs(around - right));

    let mru = global.display.get_tab_list(Meta.TabList.NORMAL,
                                          space.workspace);

    for (let i=max; i >= 0; i--) {
        let leftWindow = space[around - i];
        let rightWindow = space[around + i];
        mru.filter(w => w === leftWindow || w === rightWindow)
            .reverse()
            .forEach(w => w && w.raise());
    }
}

// Place window's left edge at x
function propogate_forward(space, n, x, gap) {
    if (n < 0 || n >= space.length) {
        StackOverlay.rightOverlay.setTarget(null);
        return;
    }
    let meta_window = space[n];

    // Check if we should start stacking windows
    if (x > primary.width - stack_margin) {
        for (let i=n; i<space.length; i++) {
            stackWindow(space, i, DIRECTION.Right);
        }
        StackOverlay.rightOverlay.setTarget(meta_window);
        return;
    }
    meta_window._isStacked = false;

    gap = gap || window_gap;
    let actor = meta_window.get_compositor_private();
    if (actor) {
        // Anchor scaling/animation on the left edge for windows positioned to the right,
        move(meta_window, { x, y: panelBox.height + margin_tb });
        propogate_forward(space, n+1, x+meta_window.get_frame_rect().width + gap, gap);
    } else {
        // If the window doesn't have an actor we should just skip it
        propogate_forward(space, n+1, x, gap);
    }
}

// Place window's right edge at x
function propogate_backward(space, n, x, gap) {
    if (n < 0 || n >= space.length) {
        StackOverlay.leftOverlay.setTarget(null);
        return;
    }
    let meta_window = space[n];

    // Check if we should start stacking windows
    if (x < stack_margin) {
        for (let i=n; i>=0; i--) {
            stackWindow(space, i, DIRECTION.Left);
        }
        StackOverlay.leftOverlay.setTarget(meta_window);
        return;
    }
    meta_window._isStacked = false;

    gap = gap || window_gap;
    let actor = meta_window.get_compositor_private();
    if (actor) {
        x = x - meta_window.get_frame_rect().width
        // Anchor on the right edge for windows positioned to the left.
        move(meta_window, { x, y: panelBox.height + margin_tb });
        propogate_backward(space, n-1, x - gap, gap);
    } else {
        // If the window doesn't have an actor we should just skip it
        propogate_backward(space, n-1, x, gap);
    }
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
    propogate_forward(space, i + 1, right);
    propogate_backward(space, i - 1, left);
}

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
  Modelled after notion/ion3's system

  Examples:

    defwinprop({
        wm_class: "Emacs",
        float: true
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

defwinprop({
    wm_class: "copyq",
    scratch_layer: true
});

defwinprop({
    wm_class: "Riot",
    oneshot: true, // Allow reattaching
    scratch_layer: true
});

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

    // Remove our signal handlers: Needed for non-closed windows.
    // (closing a window seems to clean out it's signal handlers)
    if (meta_window[focus_signal]) {
        meta_window.disconnect(meta_window[focus_signal]);
        delete meta_window[focus_signal];
    }

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
        ensure_viewport(space, space.selectedWindow, true)
    }
}

function add_all_from_workspace(workspace) {
    workspace = workspace || global.screen.get_active_workspace();
    let windows = workspace.list_windows();

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

    windows.sort(xz_comparator(windows));

    let space = spaces.spaceOf(workspace);
    windows.forEach((meta_window, i) => {
        meta_window[focus_signal] = meta_window.connect("focus", focus_wrapper);
        if(space.indexOf(meta_window) < 0 && add_filter(meta_window, true)) {
            if (meta_window.above || meta_window.minimized) {
                // Rough heuristic to figure out if a window should float
                Scratch.makeScratch(meta_window);
                return;
            }

            // Using add_handler is unreliable since it interacts with focus.
            space.push(meta_window);
        }
    })

    let tabList = global.display.get_tab_list(Meta.TabList.NORMAL, workspace)
        .filter(metaWindow => { return space.indexOf(metaWindow) !== -1; });
    if (tabList[0]) {
        space.selectedWindow = tabList[0]
        ensure_viewport(space, space.selectedWindow);
    }
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
    // We've mutated the space, so need to force the ensure
    ensure_viewport(spaces.spaceOfWindow(meta_window), meta_window, true);
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

const SwitcherPopup = imports.ui.switcherPopup;
var PreviewedWindowNavigator = new Lang.Class({
    Name: 'PreviewedWindowNavigator',
    Extends: SwitcherPopup.SwitcherPopup,

    _init: function() {
        this.parent();

        this._switcherList = new Minimap.MultiMap(true);
        this.space = this._switcherList.getSelected().space;

        this._switcherList.onlyShowSelected();

        // HACK: workaround to enable moving from empty workspace. See check in
        // SwitcherPopup.show
        this._items = [1];

        this._selectedIndex = this.space.selectedIndex();
        // debug('#preview', 'Init', this.space[this._selectedIndex].title, this._selectedIndex);
    },

    _next: function() {
        return Math.min(this.space.length-1, this._selectedIndex+1)
    },
    _previous: function() {
        return Math.max(0, this._selectedIndex-1)
    },

    _initialSelection: function(backward, actionName) {
        let paperActions = Extension.imports.extension.paperActions;
        let actionId = paperActions.idOf(actionName);
        if(actionId === Meta.KeyBindingAction.NONE) {
            try {
                // Check for built-in actions
                actionId = Meta.prefs_get_keybinding_action(actionName);
            } catch(e) {
                debug("Couldn't resolve action name");
                return;
            }
        }

        this._doAction(actionId);
    },

    _reorder: function (index, targetIndex) {
        function swapArray(array, i, j) {
            let temp = array[i];
            array[i] = array[j];
            array[j] = temp;
        }

        swapArray(this.space, index, targetIndex);

        let metaWindow = this.space[targetIndex];
        let newX = ensure_viewport(this.space, metaWindow, true);

        this._selectedIndex = targetIndex;

        this._switcherList.getSelected().reorder(index, targetIndex, newX);
        this._switcherList.highlight(targetIndex);
    },

    selectSpace: function(direction, move) {
        let multimap = this._switcherList;
        multimap.showAll();
        let from = multimap.selectedIndex;
        let to;
        if (direction === Meta.MotionDirection.DOWN)
            to = from + 1;
        else
            to = from - 1;
        if (to < 0 || to >= multimap.minimaps.length) {
            this._select(this.space.selectedIndex());
            return true;
        }
        let oldMap = multimap.getSelected();
        let newMap = multimap.setSelected(to);
        Main.wm._previewWorkspaceDone();

        if (move) {
            let selectedWindow = this.space.selectedWindow;
            Main.wm._movingWindow = selectedWindow;
            selectedWindow.change_workspace(newMap.space.workspace);
            oldMap.refresh();
            newMap.refresh();
            oldMap.fold();
            newMap.space.selectedWindow = selectedWindow;
            newMap.space.moving = false;
        }

        // This will crash gnome-shell if one of the workspaces have been removed
        Main.wm._previewWorkspace(oldMap.space.workspace,
                                  newMap.space.workspace,
                                  direction);
        this.space = newMap.space;
        this._select(this.space.selectedIndex());
    },

    _doAction: function(mutterActionId) {
        let paperActions = Extension.imports.extension.paperActions;
        if (mutterActionId === paperActions.idOf("switch-next")) {
            this._select(this._next());
            return true;
        } else if (mutterActionId === paperActions.idOf("switch-previous")) {
            this._select(this._previous());
            return true;
        } else if (mutterActionId === paperActions.idOf("move-left")) {
            this._reorder(this._selectedIndex, this._previous());
            return true;
        } else if (mutterActionId === paperActions.idOf("move-right")) {
            this._reorder(this._selectedIndex, this._next());
            return true;
        } else if (mutterActionId
                   === paperActions.idOf('previous-workspace-backward')) {
            this.selectSpace(Meta.MotionDirection.UP);
            return true;
        } else if (mutterActionId === paperActions.idOf('previous-workspace')) {
            this.selectSpace(Meta.MotionDirection.DOWN);
            return true;
        } else if (mutterActionId
                   === paperActions.idOf('move-previous-workspace')) {
            this.selectSpace(Meta.MotionDirection.DOWN, true);
            return true;
        } else if (mutterActionId
                   === paperActions.idOf('move-previous-workspace-backward')) {
            this.selectSpace(Meta.MotionDirection.UP, true);
            return true;
        } else {
            let action = paperActions.byId(mutterActionId);
            if (action) {
                let metaWindow = this.space[this._selectedIndex];
                action.handler(null, null, metaWindow);
                let minimap = this._switcherList.getSelected();
                minimap.layout();
                minimap.sync(metaWindow.destinationX);
                this._switcherList.highlight(this._selectedIndex);
                return true;
            }
        }

        return false;
    },

    _keyPressHandler: function(keysym, action) {
        if (this._doAction(action)) {
            return Clutter.EVENT_STOP;
        } else {
            return Clutter.EVENT_PROPAGATE;
        }
    },

    _select: function(index) {
        // debug('#preview', 'Select', this.space[index].title, index);
        let metaWindow = this.space[index];
        if (metaWindow) {
            this.space.selectedWindow = metaWindow;
            let newX = ensure_viewport(this.space, metaWindow);
            if (newX !== undefined) {
                this._switcherList.getSelected().sync(newX);
            }
        }
        this._selectedIndex = index;
        this._switcherList.highlight(index);
    },

    destroy: function() {
        this.parent();
    },

    _finish: function(timestamp) {
        this.was_accepted = true;
        if (this.space.length === 0) {
            this.space.workspace.activate(global.get_current_time());
        } else {
            Main.activateWindow(this.space[this._selectedIndex]);
            debug('#preview', 'Finish', this.space[this._selectedIndex].title, this._selectedIndex);
        }
        // Finish workspace preview _after_ activate, that way the new animation
        // triggered by activate gets killed immediately
        Main.wm._previewWorkspaceDone();
        this.parent(timestamp);
    },

    _itemEnteredHandler: function() {
        // The item-enter (mouse hover) event is triggered even after a item is
        // accepted. This can cause _select to run on the item below the pointer
        // ensuring the wrong window.
        if(!this.was_accepted) {
            this.parent.apply(this, arguments);
        }
    },

    _onDestroy: function() {
        debug('#preview', 'onDestroy', this.was_accepted);
        if(!this.was_accepted && this._selectedIndex != focus()) {
            debug('#preview', 'Abort', global.display.focus_window.title);
            ensure_viewport(this.space, global.display.focus_window);
        }
        Main.wm._previewWorkspaceDone();
        this.parent();
    }
});

function preview_navigate(display, screen, meta_window, binding) {
    let tabPopup = new PreviewedWindowNavigator();
    tabPopup.show(binding.is_reversed(), binding.get_name(), binding.get_mask())
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
    ensure_viewport(spaces.spaceOfWindow(metaWindow), metaWindow, true);

    delete metaWindow.unmaximized_rect;
}

var nWorkspacesSignal, workspaceRemovedSignal, windowCreatedSignal;
var panelBoxShowId, panelBoxHideId, monitorsChangedId;
function enable () {
    nWorkspacesSignal =
        global.screen.connect('notify::n-workspaces',
                              Lang.bind(spaces, utils.dynamic_function_ref('workspacesChanged', spaces)));

    workspaceRemovedSignal =
        global.screen.connect('workspace-removed',
                              utils.dynamic_function_ref('workspaceRemoved', spaces));

    windowCreatedSignal =
        global.display.connect('window-created',
                               utils.dynamic_function_ref('window_created', spaces));

    // Reset primary when monitors change
    monitorsChangedId = global.screen.connect(
        "monitors-changed",
        function(screen) {
            primary = Main.layoutManager.primaryMonitor;
        });

    panelBoxShowId =  panelBox.connect('show', showPanelBox);
    panelBoxHideId = panelBox.connect('hide', hidePanelBox);
}

function disable () {
    global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null)
        .forEach(metaWindow => {
            let actor = metaWindow.get_compositor_private();
            actor.set_scale(1, 1);
            actor.set_pivot_point(0, 0);
            if (metaWindow[focus_signal]) {
                metaWindow.disconnect(metaWindow[focus_signal]);
                delete metaWindow[focus_signal]
            }
        });

    // Disable workspace related signals
    global.screen.disconnect(nWorkspacesSignal);
    global.screen.disconnect(workspaceRemovedSignal);
    global.display.disconnect(windowCreatedSignal);
    for (let workspace in spaces._spaces) {
        spaces.removeSpace(spaces._spaces[workspace]);
    }

    global.screen.disconnect(monitorsChangedId);

    panelBox.scale_y = 1;
    panelBox.disconnect(panelBoxShowId);
    panelBox.disconnect(panelBoxHideId);
}
