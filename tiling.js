
// Globals
const Extension = imports.misc.extensionUtils.getCurrentExtension();
const GLib = imports.gi.GLib;
const Tweener = imports.ui.tweener;
const Lang = imports.lang;
const Meta = imports.gi.Meta;
const Main = imports.ui.main;
const Shell = imports.gi.Shell;
const Gio = imports.gi.Gio;
const utils = Extension.imports.utils;

let preferences = Extension.imports.convenience.getSettings();
// Gap between windows
window_gap = preferences.get_int('window-gap');
// Top/bottom margin
margin_tb = preferences.get_int('vertical-margin');
// left/right margin
margin_lr = preferences.get_int('horizontal-margin');
// How much the stack should protrude from the side
stack_margin = 75

// Symbol to retrieve the focus handler id
focus_signal = Symbol();

let primary = Main.layoutManager.primaryMonitor;
// Reset primary when monitors change
global.screen.connect("monitors-changed", function(screen) {
    primary = Main.layoutManager.primaryMonitor;
})

panelBox = Main.layoutManager.panelBox;

panelBox.connect('show', () => {
    Tweener.addTween(panelBox, {
        scale_y: 1,
        time: 0.25,
        onOverWrite: () => {
            scale_y: 1;
        }
    });
});


Space = (workspace) => {
    // Simplest way to get a straight array interface
    let space = [];
    space.workspace = workspace;
    space.selectedWindow = null;
    space.moving = false;
    space.leftStack = 0;
    space.rightStack = 0;
    return space;
}

panelBox.connect('hide', () => {
    panelBox.scale_y = 0;
});

const spaces = []
spaceOf = (meta_window) => {
    return spaces[meta_window.get_workspace().workspace_index];
}
window.spaces = spaces;

focus = () => {
    let meta_window = global.display.focus_window;
    if (!meta_window)
        return -1;
    return spaces[meta_window.get_workspace().workspace_index].indexOf(meta_window)
}

// Max height for windows
max_height = primary.height - panelBox.height - margin_tb*2;
// Height to use when scaled down at the sides
scaled_height = max_height*0.95;
scaled_y_offset = (max_height - scaled_height)/2;
move = (meta_window, x, y, onComplete, onStart, delay, transition) => {
    let actor = meta_window.get_compositor_private()
    let buffer = actor.meta_window.get_buffer_rect();
    let frame = actor.meta_window.get_frame_rect();
    // Set monitor offset
    y += primary.y;
    x += primary.x;
    x = Math.min(primary.width - stack_margin, x)
    x = Math.max(stack_margin - frame.width, x)
    let x_offset = frame.x - buffer.x;
    let y_offset = frame.y - buffer.y;
    let scale = 1;
    delay = delay || 0;
    transition = transition || "easeInOutQuad";
    if (x >= primary.width - stack_margin || x <= stack_margin - frame.width) {
        // Set scale so that the scaled height will be `scaled_height`
        scale = scaled_height/frame.height;
        // Center the actor properly
        y += scaled_y_offset;
        let pivot = actor.pivot_point;
        actor.set_pivot_point(pivot.x, y_offset/buffer.height);
    }
    Tweener.addTween(actor, {x: x - x_offset
                             , y: y - y_offset
                             , time: 0.25 - delay
                             , delay: delay
                             , scale_x: scale
                             , scale_y: scale
                             , transition: transition
                             , onStart: () => {
                                 onStart && onStart();
                             }
                             , onComplete: () => {
                                 if(meta_window.get_compositor_private()) {
                                     // If the actor is gone, the window is in process of closing
                                     meta_window.move_frame(true, x, y);
                                     onComplete && onComplete();
                                 }
                             }})

}


// Move @meta_window to x, y and propagate the change in @space
move_to = function(space, meta_window, x, y, delay, transition) {
    // Register @meta_window as moving on @space
    space.moving = meta_window;
    move(meta_window, x, y
         , () => { meta_window.raise(); } // onStart
         , () => { space.moving = false; } // onComplete
         , delay
         , transition
        );
    let index = space.indexOf(meta_window);
    let frame = meta_window.get_frame_rect();
    propogate_forward(space, index + 1, x + frame.width + window_gap, false);
    propogate_backward(space, index - 1, x - window_gap, false);
}


ensure_viewport = (space, meta_window, force) => {
    if (space.moving == meta_window && !force) {
        debug('already moving', meta_window.title);
        return;
    }
    debug('Moving', meta_window.title);

    let index = space.indexOf(meta_window)
    let frame = meta_window.get_frame_rect();

    // Hack to ensure the statusbar is visible while there's a fullscreen
    // windows in the space.
    if (!panelBox.visible) {
        panelBox.show();
    }

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
            onComplete: () => {
                panelBox.visible = false;
            }
        });

    } else if (required_width <= primary.width) {
        let leftovers = primary.width - required_width;
        let gaps = space.length + 1;
        let extra_gap = leftovers/gaps;
        debug('#extragap', extra_gap);
        propogate_forward(space, 0, extra_gap, true, extra_gap + window_gap);
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
        x = (primary.width - frame.width)/2;
    } else if (frame.x + frame.width >= primary.width - margin_lr) {
        // Align to the right margin_lr
        x = primary.width - margin_lr - frame.width;
    } else if (frame.x <= margin_lr) {
        // Align to the left margin_lr
        x = margin_lr;
    }
    // Add a delay for stacked window to avoid windows passing
    // through each other in the z direction

    let delay = 0;
    let transition;
    if (meta_window.get_compositor_private().is_scaled()) {
        // easeInQuad: delta/2(t/duration)^2 + start
        delay = Math.pow(2*(stack_margin - margin_lr)/frame.width, .5)*0.25/2;
        transition = 'easeInOutQuad';
        debug('delay', delay)
    }
    move_to(space, meta_window, x, y, delay, transition);
}

focus_handler = (meta_window, user_data) => {
    debug("focus:", meta_window.title, framestr(meta_window.get_frame_rect()));

    let space = spaceOf(meta_window);
    space.selectedWindow = meta_window;

    if(meta_window.scrollwm_initial_position) {
        debug("setting initial position", meta_window.scrollwm_initial_position)
        if (meta_window.get_maximized() == Meta.MaximizeFlags.BOTH) {
            meta_window.unmaximize(Meta.MaximizeFlags.BOTH);
            toggle_maximize_horizontally(meta_window);
            return;
        }
        let frame = meta_window.get_frame_rect();
        meta_window.move_resize_frame(true, meta_window.scrollwm_initial_position.x, meta_window.scrollwm_initial_position.y, frame.width, frame.height)
        ensure_viewport(space, meta_window);
        delete meta_window.scrollwm_initial_position;
    } else {
        ensure_viewport(space, meta_window)
    }
}

// Place window's left edge at x
propogate_forward = (space, n, x, lower, gap) => {
    if (n < 0 || n >= space.length)
        return
    gap = gap || window_gap;
    let meta_window = space[n]
    let actor = meta_window.get_compositor_private();
    if (actor) {
        if (lower)
            meta_window.lower()
        // Anchor scaling/animation on the left edge for windows positioned to the right,
        actor.set_pivot_point(0, 0);
        move(meta_window, x, panelBox.height + margin_tb)
        propogate_forward(space, n+1, x+meta_window.get_frame_rect().width + gap, true, gap);
    } else {
        // If the window doesn't have an actor we should just skip it
        propogate_forward(space, n+1, x, true, gap);
    }
}
// Place window's right edge at x
propogate_backward = (space, n, x, lower, gap) => {
    if (n < 0 || n >= space.length)
        return
    gap = gap || window_gap;
    let meta_window = space[n]
    let actor = meta_window.get_compositor_private();
    if (actor) {
        if (lower)
            meta_window.lower()
        x = x - meta_window.get_frame_rect().width
        // Anchor on the right edge for windows positioned to the left.
        actor.set_pivot_point(1, 0);
        move(meta_window, x, panelBox.height + margin_tb)
        propogate_backward(space, n-1, x - gap, true, gap)
    } else {
        // If the window doesn't have an actor we should just skip it
        propogate_forward(space, n-1, x, true, gap);
    }
}

// Detach meta_window or the focused window by default
// Can be used from the looking glass
detach = function (meta_window) {
    meta_window = meta_window || global.display.focus_window;
    remove_handler(meta_window.get_workspace(), meta_window)
}

center = (meta_window, zen) => {
    let frame = meta_window.get_frame_rect();
    let x = Math.floor((primary.width - frame.width)/2)
    move(meta_window, x, frame.y)
    let right = zen ? primary.width : x + frame.width + window_gap;
    let left = zen ? -primary.width : x - window_gap;
    let space = spaceOf(meta_window);
    let i = space.indexOf(meta_window);
    propogate_forward(space, i + 1, right);
    propogate_backward(space, i - 1, left);
}
focus_wrapper = (meta_window, user_data) => {
    focus_handler(meta_window, user_data)
}

add_filter = (meta_window) => {
    if (meta_window.window_type != Meta.WindowType.NORMAL
        || meta_window.get_transient_for() != null
        || meta_window.is_on_all_workspaces()) {
        return false;
    }
    return true;
}

/**
  Modelled after notion/ion3's system

  Examples:

    defwinprop({
        wm_class: "Emacs",
        float: true
    })
*/
winprops = [];

winprop_match_p = (meta_window, prop) => {
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

find_winprop = (meta_window) =>  {
    let props = winprops.filter(
        winprop_match_p.bind(null, meta_window));

    return props[0];
}

defwinprop = (spec) => {
    winprops.push(spec);
}

defwinprop({
    wm_class: "copyq",
    float: true
});

defwinprop({
    wm_class: "Riot",
    oneshot: true, // Allow reattaching
    scratch_layer: true
});

add_handler = (ws, meta_window) => {
    debug("window-added", meta_window, meta_window.title, meta_window.window_type, ws.index());
    if (!add_filter(meta_window)) {
        return;
    }

    let winprop = find_winprop(meta_window);
    if (winprop) {
        if (winprop.oneshot) {
            // untested :)
            winprops.splice(winprops.indexOf(winprop), 1);
        }
        if (winprop.float) {
            // Let gnome-shell handle the placement
            return;
        }
        if (winprop.scratch_layer) {
            meta_window.stick();
            return;
        }
    }

    // If we're focusing a scratch window make the new window scratch
    let focus_window = global.display.focus_window;
    if (focus_window && focus_window.is_on_all_workspaces()) {
        meta_window.stick()
        return;
    }

    let space = spaces[ws.workspace_index]

    // Don't add already added windows
    if (space.indexOf(meta_window) != -1) {
        return;
    }

    let insert_after_i = -1; // (-1 -> at beginning)
    if (space.selectedWindow) {
        insert_after_i = space.indexOf(space.selectedWindow);
    }

    space.splice(insert_after_i + 1, 0, meta_window)

    if (insert_after_i == -1) {
        meta_window.scrollwm_initial_position =
            {x: primary.x, y: primary.y + panelBox.height + margin_tb};
    } else {
        let frame = space[insert_after_i].get_frame_rect()
        meta_window.scrollwm_initial_position =
            {x: primary.x + frame.x + frame.width + window_gap,
             y: primary.y + panelBox.height + margin_tb};

    }
    // If window is receiving focus the focus handler will do the correct thing.
    // Otherwise we need set the correct position:
    // For new windows this must be done in 'first-frame' signal.
    // Existing windows being moved need a new position in this space. This
    // can be done here since the window is fully initialized.

    // If the MetaWindowActor is available the window already exists and we can position
    if (meta_window.get_compositor_private()) {
        debug('attach window', meta_window.title, meta_window.has_focus())
        if (meta_window.has_focus()) {
            ensure_viewport(space, meta_window, true);
        } else {
            move_to(space, meta_window,
                 meta_window.scrollwm_initial_position.x,
                 meta_window.scrollwm_initial_position.y);
        }
        delete meta_window.scrollwm_initial_position
    } else {
        // Just maxmize height. (This sometimes fails though)
        meta_window.move_resize_frame(true, 0, 0,
                                      meta_window.get_frame_rect().width,
                                      primary.height - panelBox.height - margin_tb*2);
    }
    meta_window[focus_signal] = meta_window.connect("focus", focus_wrapper);
}

remove_handler = (workspace, meta_window) => {
    debug("window-removed", meta_window, meta_window.title, workspace.index());
    // Note: If `meta_window` was closed and had focus at the time, the next
    // window has already received the `focus` signal at this point.
    // Not sure if we can check directly if _this_ window had focus when closed.

    let space = spaces[workspace.workspace_index];
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

add_all_from_workspace = (workspace) => {
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

    let space = spaces[workspace.workspace_index]
    windows.forEach((meta_window, i) => {
        if(space.indexOf(meta_window) < 0 && add_filter(meta_window)) {
            // Using add_handler is unreliable since it interacts with focus.
            space.push(meta_window);
            meta_window[focus_signal] = meta_window.connect("focus", focus_wrapper);
        }
    })
}

first_frame = (meta_window_actor) => {
    meta_window_actor.disconnect('first_frame');
    let meta_window = meta_window_actor.meta_window;
    debug("first frame: setting initial position", meta_window)
    if(meta_window.scrollwm_initial_position) {
        debug("setting initial position", meta_window.scrollwm_initial_position)
        if (meta_window.get_maximized() == Meta.MaximizeFlags.BOTH) {
            meta_window.unmaximize(Meta.MaximizeFlags.BOTH);
            toggle_maximize_horizontally(meta_window);
            return;
        }
        let frame = meta_window.get_frame_rect();
        meta_window.move_resize_frame(true, meta_window.scrollwm_initial_position.x, meta_window.scrollwm_initial_position.y, frame.width, frame.height)

        let space = spaces[meta_window.get_workspace().workspace_index];
        propogate_forward(space, space.indexOf(meta_window) + 1, meta_window.scrollwm_initial_position.x + frame.width + window_gap);

        delete meta_window.scrollwm_initial_position;
    }
}

window_created = (display, meta_window, user_data) => {
    debug('window-created', meta_window.title);
    let actor = meta_window.get_compositor_private();
    actor.connect('first-frame', dynamic_function_ref('first_frame'));
}

workspace_added = (screen, index) => {
    spaces[index] = [];
    let workspace = global.screen.get_workspace_by_index(index);
    workspace.connect("window-added", dynamic_function_ref("add_handler"))
    workspace.connect("window-removed", dynamic_function_ref("remove_handler"));
    debug('workspace-added', index, workspace);

}
// Doesn't seem to trigger for some reason
workspace_removed = (screen, arg1, arg2) => {
    debug('workspace-removed');
    let workspace = global.screen.get_workspace_by_index(index);
}

next = () => {
    let meta_window = global.display.focus_window
    spaces[meta_window.get_workspace().workspace_index][focus()+1].activate(global.get_current_time())
}
previous = () => {
    let meta_window = global.display.focus_window
    spaces[meta_window.get_workspace().workspace_index][focus()-1].activate(global.get_current_time())
}

move_helper = (meta_window, delta) => {
    // NB: delta should be 1 or -1
    let ws = spaces[meta_window.get_workspace().workspace_index]
    let i = ws.indexOf(meta_window)
    if(utils.in_bounds(ws, i+delta)) {
        utils.swap(ws, i, i+delta);
        ensure_viewport(ws, meta_window, true);
    }
}
move_right = () => {
    move_helper(global.display.focus_window, 1);
}
move_left = () => {
    move_helper(global.display.focus_window, -1);
}

toggle_maximize_horizontally = (meta_window) => {
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
        meta_window.move_resize_frame(true, frame.x, frame.y, primary.width - margin_lr*2, frame.height);
    }
    ensure_viewport(spaceOf(meta_window), meta_window);
}

altTab = imports.ui.altTab;

PreviewedWindowNavigator = new Lang.Class({
    Name: 'PreviewedWindowNavigator',
    Extends: altTab.WindowSwitcherPopup,

    _init: function() {
        this.parent();

        this.space = this._switcherList.windows;
        this._selectedIndex = this.space.indexOf(this.space.selectedWindow
                                                 || global.display.focus_window);
        debug('#preview', 'Init', this._switcherList.windows[this._selectedIndex].title, this._selectedIndex);
    },

    _next: function() {
        return Math.min(this._items.length-1, this._selectedIndex+1)
    },
    _previous: function() {
        return Math.max(0, this._selectedIndex-1)
    },

    _initialSelection: function(backward, actionName) {
        this._doAction(window.paperActionIds[actionName]);
    },

    _getWindowList: function() {
        return spaces[global.display.focus_window.get_workspace().workspace_index];
    },

    _reorder: function (index, targetIndex) {
        function swapArray(array, i, j) {
            let temp = array[i];
            array[i] = array[j];
            array[j] = temp;
        }

        let minimap = this._switcherList._list; // Clutter container for preview-icons

        // Make it visible! (update the clutter container)
        let selectedItem = minimap.get_child_at_index(index)
        minimap.remove_child(selectedItem);
        minimap.insert_child_at_index(selectedItem, targetIndex);

        // Update internal representations to match the new order
        // Array of actual windows
        swapArray(this._switcherList.windows, index, targetIndex);
        // Array of window buttons (wrappers around the icons)
        swapArray(this._switcherList._items, index, targetIndex);
        // Array of window icons (possible with preview)
        swapArray(this._items, index, targetIndex);

        // We've changed the space order so new ensures needs to take effect
        this.space.moving = false;

        this._select(targetIndex);
    },

    _doAction: function(mutterActionId) {
        if (mutterActionId === window.paperActionIds["switch-next"]) {
            this._select(this._next());
            return true;
        } else if (mutterActionId === window.paperActionIds["switch-previous"]) {
            this._select(this._previous());
            return true;
        } else if (mutterActionId === window.paperActionIds["move-left"]) {
            this._reorder(this._selectedIndex, this._previous());
            return true;
        } else if (mutterActionId === window.paperActionIds["move-right"]) {
            this._reorder(this._selectedIndex, this._next());
            return true;
        }
        return false;
    },

    _keyPressHandler: function(keysym, action) {
        if(!this._doAction(action)) {
            // Parent can handle rest, but censor the action
            return this.parent(keysym, undefined);
        }
        return undefined;
    },

    _select: function(index) {
        debug('#preview', 'Select', this._switcherList.windows[index].title, index);
        ensure_viewport(this.space, this._switcherList.windows[index]);
        this.parent(index);
    },

    _finish: function(timestamp) {
        debug('#preview', 'Finish', this._switcherList.windows[this._selectedIndex].title, this._selectedIndex);
        this.was_accepted = true;
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
            ensure_viewport(this.space, global.display.focus_window, true);
        }
        this.parent();
    }
});

preview_navigate = (display, screen, meta_window, binding) => {
    let tabPopup = new PreviewedWindowNavigator();
    tabPopup.show(binding.is_reversed(), binding.get_name(), binding.get_mask())
}


