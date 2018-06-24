var Extension = imports.misc.extensionUtils.extensions['paperwm@hedning:matrix.org'];
var GLib = imports.gi.GLib;
var Tweener = imports.ui.tweener;
var Lang = imports.lang;
var Meta = imports.gi.Meta;
var Clutter = imports.gi.Clutter;
var St = imports.gi.St;
var Main = imports.ui.main;
var Shell = imports.gi.Shell;
var Gio = imports.gi.Gio;
var Signals = imports.signals;
var utils = Extension.imports.utils;
var debug = utils.debug;

var Gdk = imports.gi.Gdk;

var screen = global.screen;

var spaces;

var Minimap = Extension.imports.minimap;
var Scratch = Extension.imports.scratch;
var TopBar = Extension.imports.topbar;
var Navigator = Extension.imports.navigator;
var ClickOverlay = Extension.imports.stackoverlay.ClickOverlay;
var Me = Extension.imports.tiling;

var prefs = Extension.imports.prefs.prefs;

// How much the stack should protrude from the side
var stack_margin = 75;
// Minimum margin
var minimumMargin = 15;

var panelBox = Main.layoutManager.panelBox;

/**
   Scrolled and tiled per monitor workspace.

   The structure is currently like this:

   A @clip actor which spans the monitor and clips all its contents to the
   monitor. The clip lives along side all other space's clips in an actor
   spanning the whole global.screen

   An @actor to hold everything visible, it contains a @background, a @label and
   a @cloneContainer.

   The @background is sized somewhat larger than the monitor, with the top left
   and right corners rounded. It's positioned slightly above the monitor so the
   corners aren't visible when the space is active.

   The @cloneContainer holds all the WindowActor clones, clipping them to the
   size of the monitor.
 */
class Space extends Array {
    constructor (workspace, container) {
        super(0);
        this.workspace = workspace;
        this.addSignal =
            workspace.connect("window-added",
                              utils.dynamic_function_ref("add_handler", Me));
        this.removeSignal =
            workspace.connect("window-removed",
                              utils.dynamic_function_ref("remove_handler", Me));

        // The windows that should be represented by their WindowActor
        this.visible = [];
        this._moveDoneId = this.connect('move-done', this._moveDone.bind(this));

        let clip = new Clutter.Actor();
        this.clip = clip;
        let actor = new Clutter.Actor();
        this.actor = actor;
        let cloneContainer = new St.Widget();
        this.cloneContainer = cloneContainer;
        let background = new St.Widget();
        this.background = background;
        let label = new St.Label();
        this.label = label;
        label.set_style('font-weight: bold; height: 1.86em;');
        label.hide();

        let selection = new St.Widget({style_class: 'tile-preview'});
        this.selection = selection;
        selection.width = 0;

        clip.space = this;
        cloneContainer.space = this;

        container.add_actor(clip);
        clip.add_actor(actor);
        actor.add_actor(background);
        actor.add_actor(label);
        actor.add_actor(cloneContainer);
        cloneContainer.add_actor(selection);

        container.set_child_below_sibling(clip,
                                          container.first_child);

        // Hardcoded to primary for now
        let monitor = Main.layoutManager.primaryMonitor;
        this.setMonitor(monitor);

        label.text = Meta.prefs_get_workspace_name(workspace.index());

        actor.set_pivot_point(0.5, 0);

        background.set_position(-8 - Math.round(prefs.window_gap/2), -4);
        let color = prefs.workspace_colors[workspace.index() % prefs.workspace_colors.length];
        this.setColor(color);

        this.selectedWindow = null;
        this.moving = false;
        this.leftStack = 0; // not implemented
        this.rightStack = 0; // not implemented

        this.addAll(oldSpaces.get(workspace));
        oldSpaces.delete(oldSpaces.get(workspace));
    }

    getWindows() {
        return this.reduce((ws, column) => ws.concat(column), []);
    }

    addWindow(metaWindow, index, row) {
        if (this.indexOf(metaWindow) !== -1)
            return;
        if (row !== undefined && this[index]) {
            let column = this[index];
            column.splice(row, 0, metaWindow);
        } else {
            row = row || 0;
            this.splice(index, 0, [metaWindow]);
        }
        metaWindow.clone.reparent(this.cloneContainer);
    }

    removeWindow(metaWindow) {
        let index = this.indexOf(metaWindow);
        if (index === -1)
            return false;
        let column = this[index];
        let row = column.indexOf(metaWindow);
        column.splice(row, 1);
        if (column.length === 0)
            this.splice(index, 1);

        if (this.selectedWindow === metaWindow) {
            // Select a new window using the stack ordering;
            let stack = global.display.sort_windows_by_stacking(this.getWindows());
            this.selectedWindow = stack[stack.length - 1];
        }


        this.cloneContainer.remove_actor(metaWindow.clone);
        Tweener.removeTweens(this.selection);
        this.selection.width = 0;
        this.visible = [];
        return true;
    }

    indexOf(metaWindow) {
        for (let i=0; i < this.length; i++) {
            if (this[i].includes(metaWindow))
                return i;
        }
        return -1;
    }

    rowOf(metaWindow) {
        let column = this[this.indexOf(metaWindow)];
        return column.indexOf(metaWindow);
    }

    _moveDone() {
        debug('#move-done');
        if (Navigator.navigating) {
            this.delayed = true;
            return;
        }
        this.visible.forEach(w => {
            let actor = w.get_compositor_private();
            w.clone.hide();
            actor && actor.show();
        });
        // this.selection.hide();
    }

    setColor(color) {
        this.background.set_style(
            `background: ${color};
             box-shadow: 0px -10px 4px 2px black;
             box-shadow: 0px -4px 8px 0 rgba(0, 0, 0, .5);
             border-radius: 4px 4px 0 0;`);
    }

    setMonitor(monitor, animate) {
        let cloneContainer = this.cloneContainer;
        let background = this.background;
        let clip = this.clip;

        this.monitor = monitor;
        this.width = monitor.width;
        this.height = monitor.height;

        let time = animate ? 0.25 : 0;

        let transition = 'easeInOutQuad';
        Tweener.addTween(this.actor,
                        {x: 0, y: 0, scale_x: 1, scale_y: 1,
                         time, transition});
        Tweener.addTween(clip,
                         {scale_x: 1, scale_y: 1, time});

        clip.set_position(monitor.x, monitor.y);
        clip.set_size(monitor.width, monitor.height);
        clip.set_clip(0, 0,
                      monitor.width,
                      monitor.height);

        background.set_size(monitor.width + 8*2 + prefs.window_gap, monitor.height + 4);

        cloneContainer.set_size(monitor.width, monitor.height);
        cloneContainer.set_clip(-Math.round(prefs.window_gap/2), 0, monitor.width + prefs.window_gap, monitor.height);
    }

    /**
       Add any existing windows on `workspace` to the corresponding `Space`,
       optionally using `windows` as a preferred order.
    */
    addAll(oldSpace) {

        // On gnome-shell-restarts the windows are moved into the viewport, but
        // they're moved minimally and the stacking is not changed, so the tiling
        // order is preserved (sans full-width windows..)
        let xz_comparator = (windows) => {
            // Seems to be the only documented way to get stacking order?
            // Could also rely on the MetaWindowActor's index in it's parent
            // children array: That seem to correspond to clutters z-index (note:
            // z_position is something else)
            let z_sorted = global.display.sort_windows_by_stacking(windows);
            let xkey = (mw) => {
                let frame = mw.get_frame_rect();
                if(frame.x <= 0)
                    return 0;
                if(frame.x+frame.width == this.width) {
                    return this.width;
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

        if (oldSpace) {
            for (let i=0; i < oldSpace.length; i++) {
                let column = oldSpace[i];
                for(let j=0; j < column.length; j++) {
                    let metaWindow = column[j];
                    this.addWindow(metaWindow, i, j);
                }
            }
        }

        let workspace = this.workspace;
        let windows = workspace.list_windows()
            .sort(xz_comparator(workspace.list_windows()));

        windows.forEach((meta_window, i) => {
            if (meta_window.above || meta_window.minimized) {
                // Rough heuristic to figure out if a window should float
                Scratch.makeScratch(meta_window);
                return;
            }
            if(this.indexOf(meta_window) < 0 && add_filter(meta_window, true)) {
                // Using add_handler is unreliable since it interacts with focus.
                this.addWindow(meta_window, this.length);
                this.cloneContainer.add_actor(meta_window.clone);
            }
        })

        let tabList = global.display.get_tab_list(Meta.TabList.NORMAL, workspace)
            .filter(metaWindow => { return this.indexOf(metaWindow) !== -1; });
        if (tabList[0]) {
            this.selectedWindow = tabList[0]
            // ensureViewport(space.selectedWindow, space);
        }
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

    destroy() {
        this.background.destroy();
        this.cloneContainer.destroy();
        this.clip.destroy();
        let workspace = this.workspace;
        workspace.disconnect(this.addSignal);
        workspace.disconnect(this.removeSignal);
        this.disconnect(this._moveDoneId);
    }
}
Signals.addSignalMethods(Space.prototype);

/**
   A `Map` to store all `Spaces`'s, indexed by the corresponding workspace.

   TODO: Move initialization to enable
*/
class Spaces extends Map {
    // Fix for eg. space.map, see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes#Species
    static get [Symbol.species]() { return Map; }

    constructor() {
        super();

        this.monitors = new Map();
        this.clickOverlays = [];

        this.screenSignals = [
            global.screen.connect(
                'notify::n-workspaces',
                Lang.bind(this,
                          utils.dynamic_function_ref('workspacesChanged', this))),

            global.screen.connect(
                'workspace-removed',
                utils.dynamic_function_ref('workspaceRemoved', this)),

            global.screen.connect("monitors-changed",
                                  this.monitorsChanged.bind(this)),

            global.screen.connect("window-left-monitor",
                                  this.windowLeftMonitor.bind(this)),

            global.screen.connect("window-entered-monitor",
                                  this.windowEnteredMonitor.bind(this))
        ];

        this.displaySignals = [
            global.display.connect(
                'window-created',
                utils.dynamic_function_ref('window_created', this)),
            global.display.connect('grab-op-begin', grabBegin),
            global.display.connect('grab-op-end', grabEnd),
        ];

        // Clone and hook up existing windows
        global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null)
            .forEach(registerWindow);

        let spaceContainer = new Clutter.Actor({name: 'spaceContainer'});
        spaceContainer.hide();
        this.spaceContainer = spaceContainer;

        backgroundGroup.add_actor(spaceContainer);
        backgroundGroup.set_child_above_sibling(
            spaceContainer,
            backgroundGroup.last_child);

        // Hook up existing workspaces
        for (let i=0; i < global.screen.n_workspaces; i++) {
            let workspace = global.screen.get_workspace_by_index(i);
            this.addSpace(workspace);
            debug("workspace", workspace)
        }

        this.monitorsChanged();
    }

    /**
     */
    monitorsChanged() {
        debug('#monitors changed', Main.layoutManager.primaryIndex);

        this.get(screen.get_active_workspace()).getWindows().forEach(w => {
            w.get_compositor_private().hide();
            w.clone.show();
        });

        this.spaceContainer.set_size(global.screen_width, global.screen_height);

        for (let overlay of this.clickOverlays) {
            overlay.destroy();
        }
        this.clickOverlays = [];
        for (let monitor of Main.layoutManager.monitors) {
            let overlay = new ClickOverlay(monitor);
            monitor.clickOverlay = overlay;
            overlay.activate();
            this.clickOverlays.push(overlay);
        }

        let mru = this.mru();
        let primary = Main.layoutManager.primaryMonitor;
        let monitors = Main.layoutManager.monitors;
        let others = monitors.filter(m => m !== primary);

        // Reset all removed monitors
        this.forEach(space => {
            if (monitors.indexOf(space.monitor) === -1) {
                space.setMonitor(primary);
                this.monitors.set(primary, space);
            }
        });

        // Populate all monitors with existing worspaces
        mru.slice(1).forEach((space, i) => {
            let monitor = monitors[i];
            if (!monitor)
                return;
            space.setMonitor(monitor);
            this.monitors.set(monitor, space);
        });

        // Let the active workspace follow the primary monitor
        let active = mru[0];
        active.setMonitor(primary);
        this.monitors.set(primary, active);

        this.spaceContainer.show();
    }

    destroy() {
        for (let overlay of this.clickOverlays) {
            overlay.destroy();
        }
        for (let monitor of Main.layoutManager.monitors) {
            delete monitor.clickOverlay;
        }

        global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null)
            .forEach(metaWindow => {
                let actor = metaWindow.get_compositor_private();
                actor.set_scale(1, 1);
                actor.set_pivot_point(0, 0);

                if (actor[signals]) {
                    actor[signals].forEach(id => actor.disconnect(id));
                }

                if (metaWindow[signals]) {
                    metaWindow[signals].forEach(id => metaWindow.disconnect(id));
                    delete metaWindow[signals];
                }

                if (metaWindow.get_workspace() === screen.get_active_workspace()
                   && !metaWindow.minimized)
                    actor.show();
                else
                    actor.hide();
            });

        this.screenSignals.forEach(id => global.screen.disconnect(id));
        this.displaySignals.forEach(id => global.display.disconnect(id));

        // Copy the old spaces.
        oldSpaces = new Map(spaces);
        for (let [workspace, space] of this) {
            this.removeSpace(space);
        }

        this.spaceContainer.destroy();
    }

    workspacesChanged() {
        let nWorkspaces = global.screen.n_workspaces;

        // Identifying destroyed workspaces is rather bothersome,
        // as it will for example report having windows,
        // but will crash when looking at the workspace index

        // Gather all indexed workspaces for easy comparison
        let workspaces = {};
        for (let i=0; i < nWorkspaces; i++) {
            let workspace = global.screen.get_workspace_by_index(i);
            workspaces[workspace] = true;
            if (this.spaceOf(workspace) === undefined) {
                debug('workspace added', workspace);
                this.addSpace(workspace);
            }
        }

        for (let [workspace, space] of this) {
            if (workspaces[space.workspace] !== true) {
                debug('workspace removed', space.workspace);
                this.removeSpace(space);
            }
        }
    };

    workspaceRemoved(screen, index) {
        let settings = new Gio.Settings({ schema_id:
                                          'org.gnome.desktop.wm.preferences'});
        let names = settings.get_strv('workspace-names');

        // Move removed workspace name to the end. Could've simply removed it
        // too, but this way it's not lost. In the future we want a UI to select
        // old names when selecting a new workspace.
        names = names.slice(0, index).concat(names.slice(index+1), [names[index]]);
        settings.set_strv('workspace-names', names);
    };

    addSpace(workspace) {
        this.set(workspace, new Space(workspace, this.spaceContainer));
    };

    removeSpace(space) {
        this.delete(space.workspace);
        space.destroy();
    };

    spaceOfWindow(meta_window) {
        return this.get(meta_window.get_workspace());
    };

    spaceOf(workspace) {
        return this.get(workspace);
    };

    /**
       Return an array of Space's ordered in most recently used order.
     */
    mru() {
        let seen = new Map(), out = [];
        let active = global.screen.get_active_workspace();
        out.push(this.get(active));
        seen.set(active, true);

        global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null)
            .forEach((metaWindow, i) => {
                let workspace = metaWindow.get_workspace();
                if (!seen.get(workspace)) {
                    out.push(this.get(workspace));
                    seen.set(workspace, true);
                }
            });

        let workspaces = global.screen.get_n_workspaces();
        for (let i=0; i < workspaces; i++) {
            let workspace = global.screen.get_workspace_by_index(i);
            if (!seen.get(workspace)) {
                out.push(this.get(workspace));
                seen.set(workspace, true);
           }
        }

        return out;
    }

    window_created(display, metaWindow, user_data) {
        registerWindow(metaWindow);

        debug('window-created', metaWindow.title);
        let actor = metaWindow.get_compositor_private();
        let signal = Symbol();
        metaWindow[signal] = actor.connect(
            'show',
            () =>  {
                actor.disconnect(metaWindow[signal]);
                delete metaWindow[signal];
                insertWindow(metaWindow, {});
            });
    };

    windowLeftMonitor(screen, index, metaWindow) {
        debug('window-left-monitor', index, metaWindow.title);
    }

    windowEnteredMonitor(screen, index, metaWindow) {
        debug('window-entered-monitor', index, metaWindow.title);
        if (!metaWindow.get_compositor_private()
            || !metaWindow.clone
            || metaWindow.clone.visible)
            return;

        let monitor = Main.layoutManager.monitors[index];
        let space = this.monitors.get(monitor);
        let focus = metaWindow.has_focus();

        metaWindow.change_workspace(space.workspace);

        // This doesn't play nice with the clickoverlay, disable for now
        // if (focus)
        //     Main.activateWindow(metaWindow);
    }
}

function registerWindow(metaWindow) {
    let actor = metaWindow.get_compositor_private();
    let clone = new Clutter.Clone({source: actor});
    clone.set_position(actor.x, actor.y);
    metaWindow.clone = clone;

    metaWindow[signals] = [
        metaWindow.connect("focus", focus_wrapper),
        metaWindow.connect('notify::minimized', minimizeWrapper),
        metaWindow.connect('size-changed', moveSizeHandlerWrapper),
        metaWindow.connect('position-changed', moveSizeHandlerWrapper),
        metaWindow.connect('notify::fullscreen', fullscreenWrapper)
    ];
    actor[signals] = [
        actor.connect('show', showWrapper)
    ];
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
    debug('#enable');

    global.window_manager[signals] = [
        global.window_manager.connect(
            'switch-workspace',
            (wm, fromIndex, toIndex) => {
                log('workpace-switched');
                let to = screen.get_workspace_by_index(toIndex);
                let from = screen.get_workspace_by_index(fromIndex);
                let toSpace = spaces.spaceOf(to);
                spaces.monitors.set(toSpace.monitor, toSpace);

                Navigator.switchWorkspace(to, from);

                let fromSpace = spaces.spaceOf(from);
                if (toSpace.monitor === fromSpace.monitor)
                    return;

                TopBar.setMonitor(toSpace.monitor);
                toSpace.monitor.clickOverlay.deactivate();

                let display = Gdk.Display.get_default();
                let deviceManager = display.get_device_manager();
                let pointer = deviceManager.get_client_pointer();
                let [gdkscreen, pointerX, pointerY] = pointer.get_position();

                let monitor = toSpace.monitor;
                pointerX -= monitor.x;
                pointerY -= monitor.y;
                if (pointerX < 0 ||
                    pointerX > monitor.width ||
                    pointerY < 0 ||
                    pointerY > monitor.height)
                    pointer.warp(gdkscreen,
                                 monitor.x + Math.floor(monitor.width/2),
                                 monitor.y + Math.floor(monitor.height/2));

                for (let monitor of Main.layoutManager.monitors) {
                    if (monitor === toSpace.monitor)
                        continue;
                    monitor.clickOverlay.activate();
                }
            })
    ];
    // HACK: couldn't find an other way within a reasonable time budget
    // This state is different from being enabled after startup. Existing
    // windows are not accessible yet for instance.
    let isDuringGnomeShellStartup = Main.actionMode === Shell.ActionMode.NONE;

    function initWorkspaces() {
        spaces = new Spaces();
        Navigator.switchWorkspace(global.screen.get_active_workspace());
        spaces.mru().reverse().forEach(s => {
            s.selectedWindow && ensureViewport(s.selectedWindow, s, true);
            s.monitor.clickOverlay.show();
        });

        if (!Scratch.isScratchActive()) {
            Scratch.getScratchWindows().forEach(
                w => w.get_compositor_private().hide());
        }
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
    spaces.destroy();

    oldSpaces.forEach(space => {
        let selected = space.selectedIndex();
        if (selected === -1)
            return;
        // Stack windows correctly for controlled restarts
        for (let i=selected; i<space.length; i++) {
            space[i][0].lower();
        }
        for (let i=selected; i>=0; i--) {
            space[i][0].lower();
        }
    });

    // Disable workspace related signals
    global.window_manager[signals].forEach(id => global.window_manager.disconnect(id));
}

/**
   Types of windows which never should be tiled.
 */
function add_filter(meta_window, startup) {
    let add = true;

    if (meta_window.window_type != Meta.WindowType.NORMAL) {
        if (meta_window.get_transient_for()) {
            add = false;
            // Note: Some dialog windows doesn't set the transient hint. Simply
            // treat those as regular windows since it's hard to handle them as
            // proper dialogs without the hint (eg. gnome-shell extension preference)
        }
    }
    if (meta_window.is_on_all_workspaces()) {
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
    if (!space.removeWindow(meta_window))
        return;

    // (could be an empty workspace)
    if (space.selectedWindow) {
        // Force a new ensure, since the focus_handler is run before
        // window-removed
        ensureViewport(space.selectedWindow, space, true);
    }
}

/**
   Handle windows entering workspaces.

   TODO: move to `Space`
*/
function add_handler(ws, metaWindow) {
    debug("window-added", metaWindow, metaWindow.title, metaWindow.window_type, ws.index());

    let actor = metaWindow.get_compositor_private();
    if (actor) {
        // Set position and hookup signals, with `existing` set to true
        insertWindow(metaWindow, {existing: true});
    }
    // Otherwise we're dealing with a new window, so we let `window-created`
    // handle initial positioning.
}

/**
   Insert the window into its space if appropriate.
*/
function insertWindow(metaWindow, {existing}) {

    let space = spaces.spaceOfWindow(metaWindow);
    let monitor = Main.layoutManager.monitors[metaWindow.get_monitor()];

    if (monitor !== space.monitor) {
        return;
    }

    if (!add_filter(metaWindow)) {
        return;
    }

    // Don't add already added windows
    if (space.indexOf(metaWindow) != -1) {
        return;
    }

    let index = -1; // (-1 -> at beginning)
    if (space.selectedWindow) {
        index = space.indexOf(space.selectedWindow);
    }
    index++;

    space.addWindow(metaWindow, index);

    metaWindow.unmake_above();

    let position;
    if (index == 0) {
        // If the workspace was empty the inserted window should be selected
        space.selectedWindow = metaWindow;

        let frame = metaWindow.get_frame_rect();
        position = {x: monitor.x + (monitor.width - frame.width)/2,
                    y: monitor.y + panelBox.height + prefs.vertical_margin};
    } else {
        let frame = space[index - 1][0].get_frame_rect();
        position = {x: monitor.x + frame.x + frame.width + prefs.window_gap,
                    y: monitor.y + panelBox.height + prefs.vertical_margin};
    }

    debug("setting initial position", position)
    if (metaWindow.get_maximized() == Meta.MaximizeFlags.BOTH) {
        metaWindow.unmaximize(Meta.MaximizeFlags.BOTH);
        toggleMaximizeHorizontally(metaWindow);
    }

    let buffer = metaWindow.get_buffer_rect();
    let frame = metaWindow.get_frame_rect();
    let x_offset = frame.x - buffer.x;
    let y_offset = frame.y - buffer.y;
    let clone = metaWindow.clone;

    if (!existing) {
        metaWindow.get_compositor_private().hide();
        // Only move the frame when dealing with new windows
        metaWindow.move_frame(true,
                              position.x,
                              position.y);
        metaWindow.clone.set_position(
            position.x - monitor.x - x_offset,
            position.y - monitor.y - y_offset);

        clone.set_scale(0, 0);
        Tweener.addTween(clone, {
            scale_x: 1,
            scale_y: 1,
            time: 0.25
        });
    }

    if (space.workspace === global.screen.get_active_workspace()) {
        ensureViewport(metaWindow, space, true);
        Main.activateWindow(metaWindow);
    } else {
        ensureViewport(space.selectedWindow, space);
    }
}


/**
   Make sure that `meta_window` is in view, scrolling the space if needed.
 */
function ensureViewport(meta_window, space, force) {
    space = space || spaces.spaceOfWindow(meta_window);
    if (space.moving == meta_window && !force) {
        debug('already moving', meta_window.title);
        return undefined;
    }

    let index = space.indexOf(meta_window)
    if (index === -1)
        return undefined;

    debug('Moving', meta_window.title);
    meta_window._isStacked = false;
    space.selectedWindow = meta_window;

    let monitor = space.monitor;
    let frame = meta_window.get_frame_rect();
    let width = Math.min(space.monitor.width - 2*minimumMargin, frame.width);
    // meta_window.move_resize_frame(true, frame.x, frame.y, width,
    //                               space.height - panelBox.height - prefs.vertical_margin);

    // Use monitor relative coordinates.
    frame.x -= monitor.x;
    frame.y -= monitor.y;

    updateSelection(space, true);

    let x = frame.x;
    let y = panelBox.height + prefs.vertical_margin;
    let gap = prefs.window_gap;
    let required_width = space.getWindows().reduce((length, meta_window) => {
        let frame = meta_window.get_frame_rect();
        return length + frame.width + prefs.window_gap;
    }, -prefs.window_gap);
    if (!Navigator.workspaceMru && (meta_window.fullscreen ||
        meta_window.get_maximized() === Meta.MaximizeFlags.BOTH)) {
        x = frame.x; y = frame.y;
        force = true;
    } else if (required_width <= space.width) {
        let leftovers = space.width - required_width;
        let gaps = space.length + 1;
        gap = Math.floor(leftovers/gaps);
        x = gap;
        meta_window = space[0][0];
    } else if (index == 0 && frame.x <= 0) {
        // Always align the first window to the display's left edge
        x = 0;
    } else if (index == space.length-1 && x + frame.width >= space.width) {
        // Always align the first window to the display's right edge
        x = space.width - frame.width;
    } else if (frame.width > space.width*0.9 - 2*(prefs.horizontal_margin + prefs.window_gap)) {
        // Consider the window to be wide and center it
        x = Math.round((space.width - frame.width)/2);

    } else if (frame.x + frame.width > space.width) {
        // Align to the right prefs.horizontal_margin
        x = space.width - prefs.horizontal_margin - frame.width;
    } else if (frame.x < 0) {
        // Align to the left prefs.horizontal_margin
        x = prefs.horizontal_margin;
    } else if (frame.x + frame.width === space.width) {
        // When opening new windows at the end, in the background, we want to
        // show some minimup margin
        x = space.width - minimumMargin - frame.width;
    } else if (frame.x === 0) {
        // Same for the start (though the case isn't as common)
        x = minimumMargin;
    }

    if (!force && frame.x === x && frame.y === y) {
        space.emit('move-done');
    } else {
        space.moving = space.selectedWindow;
        move_to(space, meta_window,
                { x, y,
                  gap,
                  onComplete: () => {
                      space.moving = false;
                      space.emit('move-done');
                      if (!Navigator.navigating)
                          Meta.enable_unredirect_for_screen(global.screen);
                  },
                });
    }

    updateSelection(space, noAnimate);

    // Return x so we can position the minimap
    // return selectedFrame.x;
}

function updateSelection(space, noAnimate) {
    if (space.length === 0)
        return;

    const frame = space.selectedWindow.get_frame_rect();
    let protrusion = Math.round(prefs.window_gap/2);
    Tweener.addTween(space.selection,
                     {x: frame.x - protrusion,
                      y: Math.max(frame.y, panelBox.height + prefs.vertical_margin) - protrusion,
                      width: frame.width + prefs.window_gap,
                      height: frame.height + prefs.window_gap,
                      time: noAnimate ? 0 : 0.25,
                      transition: 'easeInOutQuad'});
}


/**
   Animate @meta_window to (@x, @y) in @space.monitor relative coordinates.
 */
function move(meta_window, space,
              { x, y, onComplete, onStart,
                delay, transition, visible }) {

    onComplete = onComplete || (() => {});
    onStart = onStart || (() => {});
    delay = delay || 0;
    transition = transition || 'easeInOutQuad';

    let actor = meta_window.get_compositor_private();
    let buffer = meta_window.get_buffer_rect();
    let frame = meta_window.get_frame_rect();
    let clone = meta_window.clone;
    let monitor = space.monitor;

    if (y === undefined) {
        y = frame.y - monitor.y;
    }
    if (x === undefined) {
        x = frame.x - monitor.x;
    }

    if (actor.visible) {
        clone.set_position(actor.x - monitor.x, actor.y - monitor.y);
    }

    clone.show();
    actor.hide();

    if (visible) {
        space.visible.push(meta_window);
    }

    let time = 0.25;
    if (noAnimate)
        time = 0;

    // Move the frame before animation to indicate where it's actually going.
    // The animation being purely cosmetic.
    meta_window.move_frame(true,
                           x + monitor.x,
                           y + monitor.y);

    let x_offset = frame.x - buffer.x;
    let y_offset = frame.y - buffer.y;
    Tweener.addTween(clone,
                     {x: x - x_offset
                      , y: y - y_offset
                      , time
                      , delay: delay
                      , scale_y: 1
                      , scale_x: 1
                      , transition: transition
                      , onStart: onStart
                      , onComplete: () => {
                          // If the actor is gone, the window is in
                          // process of closing
                          if(!meta_window.get_compositor_private())
                              return;
                          onComplete();
                      }
                     });

}

/**
 * Move the column containing @meta_window to x, y and propagate the change in @space.
 * Coordinates are relative to monitor and y is optional.
 */
function move_to(space, meta_window, { x, y, delay, transition,
                                       onComplete, onStart, gap }) {

    space.visible = [];
    space.delayed = false;

    let index = space.indexOf(meta_window);
    if (index === -1)
        return;

    const columnTop = panelBox.height + prefs.vertical_margin;

    if (y === undefined) {
        let top = space[index][0];
        let topFrame = top.get_frame_rect();
        y = topFrame.y - space.monitor.y
    }

    fixColumn(space, index, x, y, onComplete);

    let frame = meta_window.get_frame_rect();

    space.monitor.clickOverlay.reset();

    gap = gap || prefs.window_gap;

    for (let X = x + frame.width + gap,
             targetSet = false,
             n=index+1 ; n < space.length; n++) {
        let width = fixColumn(space, n, X, columnTop);
        if (!targetSet && X + width > space.width) {
            let mru = global.display.get_tab_list(Meta.TabList.NORMAL,
                                                  space.workspace);
            let column = space[n];
            let target = mru.filter(w => column.includes(w))[0];
            space.monitor.clickOverlay.right.setTarget(target);
            targetSet = true;
        }
        X += width + gap;
    }

    for (let X = x,
             targetSet = false,
             n=index-1; n >= 0; n--) {
        let width = Math.max(...space[n].map(w => w.get_frame_rect().width));
        X -= gap + width;
        fixColumn(space, n, X, columnTop);

        if (!targetSet && X < 0) {
            let mru = global.display.get_tab_list(Meta.TabList.NORMAL,
                                                  space.workspace);
            let column = space[n];
            let target = mru.filter(w => column.includes(w))[0];
            space.monitor.clickOverlay.left.setTarget(target);
            targetSet = true;
        }
    }
}

function fixColumn(space, index, x, y, onComplete) {
    let column = space[index];
    let width = Math.max(...space[index].map(w => w.get_frame_rect().width));
    let height = Math.round(
        (space.height - y - prefs.window_gap*(column.length - 1))/column.length) ;
    if (column.includes(space.selectedWindow))
        width = space.selectedWindow.get_frame_rect().width;

    for (let r=0; r < column.length; r++) {
        let meta_window = column[r];
        let frame = meta_window.get_frame_rect();

        // Check if the window is fully visible
        let visible = true;
        if (x + frame.width < stack_margin
            || x > space.width - stack_margin
            || meta_window.fullscreen
            || meta_window.get_maximized() === Meta.MaximizeFlags.BOTH) {
            visible = false;
        }

        let actor = meta_window.get_compositor_private();
        if (actor) {
            // Anchor on the right edge for windows positioned to the left.
            move(meta_window, space, { x, y, visible, onComplete});
            meta_window.move_resize_frame(true, x, y, width, height);
        }
        y += height + prefs.window_gap;
    }
    return width;
}

let noAnimate = false;
function grabBegin(screen, display, metaWindow, type) {
    // Don't handle pushModal grabs
    if (type === Meta.GrabOp.COMPOSITOR)
        return;
    // Turn size/position animation off when grabbing a window with the mouse
    noAnimate = true;
}

function grabEnd(screen, display, metaWindow, type) {
    if (type === Meta.GrabOp.COMPOSITOR)
        return;
    noAnimate = false;
    let space = spaces.spaceOfWindow(metaWindow);
    ensureViewport(metaWindow, space, true);
}


// `MetaWindow::size-changed` and `MetaWindow::position-changed` handling
function moveSizeHandler(metaWindow) {
    debug('move-or-resize', metaWindow.title);
    let space = spaces.spaceOfWindow(metaWindow);
    if (space.selectedWindow !== metaWindow
        || space.moving === metaWindow)
        return;

    let frame = metaWindow.get_frame_rect();
    let monitor = space.monitor;
    const x = frame.x - monitor.x;
    move_to(space, metaWindow, {x: x,
                                onComplete: () => !noAnimate && space.emit('move-done')});

    updateSelection(space, noAnimate);
}
var moveSizeHandlerWrapper = utils.dynamic_function_ref("moveSizeHandler", Me);

// `MetaWindow::focus` handling
function focus_handler(meta_window, user_data) {
    debug("focus:", meta_window.title, utils.framestr(meta_window.get_frame_rect()));

    if (meta_window.fullscreen) {
        TopBar.hide();
    } else {
        TopBar.show();
    }

    if (Scratch.isScratchWindow(meta_window)) {
        Scratch.makeScratch(meta_window);
        return;
    }

    // If meta_window is a transient window ensure the parent window instead
    let transientFor = meta_window.get_transient_for();
    if (transientFor !== null) {
        meta_window = transientFor;
    }

    let space = spaces.spaceOfWindow(meta_window);
    space.monitor.clickOverlay.show();
    ensureViewport(meta_window, space);
    fixStack(space, meta_window);
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

function fullscreenHandler(metaWindow) {
    let space = spaces.spaceOfWindow(metaWindow);
    if (space.selectedWindow !== metaWindow)
        return;

    if (metaWindow.fullscreen) {
        TopBar.hide();
    } else {
        TopBar.show();
    }
}
let fullscreenWrapper = utils.dynamic_function_ref('fullscreenHandler', Me);

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
function fixStack(space, metaWindow) {
    let windows = space.getWindows();
    let around = windows.indexOf(metaWindow);
    if (around === -1)
        return;

    utils.debug("stack", "fix stack");
    let mru = global.display.get_tab_list(Meta.TabList.NORMAL,
                                          space.workspace);

    for (let i=1; i >= 0; i--) {
        let leftWindow = windows[around - i];
        let rightWindow = windows[around + i];
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
    let space = spaces.spaceOfWindow(metaWindow);
    return frame.x >= 0 && (frame.x + frame.width) <= space.width;
}

function toggleMaximizeHorizontally(metaWindow) {
    metaWindow = metaWindow || global.display.focus_window;
    let monitor = Main.layoutManager.monitors[metaWindow.get_monitor()];

    // TODO: make some sort of animation
    // Note: should investigate best-practice for attaching extension-data to meta_windows
    if(metaWindow.unmaximizedRect) {
        let unmaximizedRect = metaWindow.unmaximizedRect;
        metaWindow.move_resize_frame(true,
                                      unmaximizedRect.x, unmaximizedRect.y,
                                      unmaximizedRect.width, unmaximizedRect.height)
        metaWindow.unmaximizedRect = undefined;
    } else {
        let frame = metaWindow.get_frame_rect();
        metaWindow.unmaximizedRect = frame;
        metaWindow.move_resize_frame(true, minimumMargin, frame.y, monitor.width - minimumMargin*2, frame.height);
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
        + (active.length-1)*prefs.window_gap + minimumMargin*2;
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
    let monitor = Main.layoutManager.monitors[metaWindow.get_monitor()];
    let availableWidth = monitor.width - minimumMargin*2;
    let r = frame.width / availableWidth;
    let nextW = Math.floor(ratios[findNext(r)]*availableWidth);
    let nextX = frame.x;

    if (nextX+nextW > monitor.x+monitor.width - minimumMargin) {
        // Move the window so it remains fully visible
        nextX = monitor.x+monitor.width - minimumMargin - nextW;
    }

    // WEAKNESS: When the navigator is open the window is not moved until the navigator is closed
    metaWindow.move_resize_frame(true, nextX, frame.y, nextW, frame.height);

    delete metaWindow.unmaximized_rect;
}

function activateNthWindow(n, space) {
    space = space || spaces.spaceOf(screen.get_active_workspace());
    let nth = space[n][0];
    if (nth)
        Main.activateWindow(nth);
}

function activateFirstWindow() {
    let space = spaces.spaceOf(screen.get_active_workspace());
    activateNthWindow(0, space);
}

function activateLastWindow() {
    let space = spaces.spaceOf(screen.get_active_workspace());
    activateNthWindow(space.length - 1, space);
}

function centerWindowHorizontally(metaWindow) {
    const frame = metaWindow.get_frame_rect();
    const space = spaces.spaceOfWindow(metaWindow);
    const monitor = space.monitor;
    const targetX = Math.round(monitor.width/2 - frame.width/2);
    const dx = (targetX + monitor.x) - frame.x;
    utils.warpPointerRelative(dx, 0);
    if (space.indexOf(metaWindow) === -1) {
        metaWindow.move_frame(true, targetX + monitor.x, frame.y);
    } else {
        move_to(space, metaWindow, { x: targetX,
                                     onComplete: () => space.emit('move-done')});
        updateSelection(space);
    }
}

function slurp(metaWindow) {
    let space = spaces.spaceOfWindow(metaWindow);
    let index = space.indexOf(metaWindow);
    let rightNeigbour = index < space.length ? space[index+1][0] : null;
    if(!rightNeigbour)
        return;
    space.removeWindow(rightNeigbour);
    let column = space[index];
    space.addWindow(rightNeigbour, index, column.length);
    ensureViewport(global.display.focus_window, spaces.spaceOfWindow(global.display.focus_window), true);
}

function barf(metaWindow) {
    let space = spaces.spaceOfWindow(metaWindow);
    let index = space.indexOf(metaWindow);
    if (index === -1)
        return;

    let column = space[index];
    if (column.length < 2)
        return;

    let bottom = column[column.length - 1];
    space.removeWindow(bottom);
    space.addWindow(bottom, index + 1);
    ensureViewport(global.display.focus_window, spaces.spaceOfWindow(global.display.focus_window), true);
}
