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

var signals, oldSpaces, backgroundGroup, oldMonitors;
function init() {
    // Symbol to retrieve the focus handler id
    signals = new utils.Signals();
    oldSpaces = new Map();
    oldMonitors = new Map();

    backgroundGroup = global.window_group.first_child;
}

/**
   Scrolled and tiled per monitor workspace.

   The tiling is composed of an array of columns. A column being an array of
   MetaWindows. Ie. the type being [[MetaWindow]].

   A Space also contains a visual representation of the tiling. The structure is
   currently like this:

   A @clip actor which spans the monitor and clips all its contents to the
   monitor. The clip lives along side all other space's clips in an actor
   spanning the whole global.screen

   An @actor to hold everything that's visible, it contains a @background,
   a @label and a @cloneContainer.

   The @background is sized somewhat larger than the monitor, with the top left
   and right corners rounded. It's positioned slightly above the monitor so the
   corners aren't visible when the space is active.

   The @cloneContainer holds all the WindowActor clones, clipping them to the
   size of the monitor. Window clones are necessary due to mutter restricting
   how far a window can stick out of the screen (hardcoded to 75 pixels). The
   clones are also useful when constructing the workspace stack as it's easier
   to scale and move the space.actor in one go.
 */
class Space extends Array {
    constructor (workspace, container) {
        super(0);
        this.workspace = workspace;

        this.signals = new utils.Signals();
        this.signals.connect(workspace, "window-added", utils.dynamic_function_ref("add_handler", Me));
        this.signals.connect(workspace, "window-removed",
                             utils.dynamic_function_ref("remove_handler", Me));

        // The windows that should be represented by their WindowActor
        this.visible = [];
        this._populated = false;


        let clip = new Clutter.Actor();
        this.clip = clip;
        let actor = new Clutter.Actor();
        this.actor = actor;
        let cloneClip = new Clutter.Actor();
        this.cloneClip = cloneClip;
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
        actor.add_actor(cloneClip);
        cloneClip.add_actor(cloneContainer);
        cloneContainer.add_actor(selection);

        container.set_child_below_sibling(clip,
                                          container.first_child);

        let monitor = Main.layoutManager.primaryMonitor;
        let oldSpace = oldSpaces.get(workspace);
        this.targetX = 0;
        if (oldSpace) {
            monitor = Main.layoutManager.monitors[oldSpace.monitor.index];
            this.targetX = oldSpace.targetX;
            cloneContainer.x = this.targetX;
        }
        this.setMonitor(monitor, false);

        label.text = Meta.prefs_get_workspace_name(workspace.index());

        actor.set_pivot_point(0.5, 0);

        background.set_position(-8 - Math.round(prefs.window_gap/2), -4);
        let color = prefs.workspace_colors[workspace.index() % prefs.workspace_colors.length];
        this.setColor(color);

        this.selectedWindow = null;
        this.moving = false;
        this.leftStack = 0; // not implemented
        this.rightStack = 0; // not implemented

        this.addAll(oldSpace);
        this._populated = true;
        oldSpaces.delete(workspace);
    }

    layout(animate = true) {
        let time = animate ? 0.25 : 0;
        let gap = prefs.window_gap;
        let x = 0;
        this.startAnimate();
        for (let column of this) {
            let y = panelBox.height + prefs.vertical_margin;
            let width = Math.max(...column.map(w => w.get_frame_rect().width));
            if (column.includes(this.selectedWindow))
                width = this.selectedWindow.get_frame_rect().width;
            width = Math.min(width, this.width);
            let height = Math.round(
                (this.height - panelBox.height - prefs.vertical_margin
                 - prefs.window_gap*(column.length - 1))/column.length) ;

            for (let w of column) {
                if (!w.get_compositor_private())
                    continue;
                let f = w.get_frame_rect();
                let b = w.get_buffer_rect();

                w.move_resize_frame(true, f.x, f.y, width, height);

                let c = w.clone;
                c.targetX = x;
                c.targetY = y;
                let dX = f.x - b.x, dY = f.y - b.y;
                Tweener.addTween(c, {
                    x: x - dX,
                    y: y - dY,
                    time,
                    transition: 'easeInOutQuad',
                    onComplete: this.moveDone.bind(this)
                });

                y += height + gap;
            }
            x += width + gap;
        }
        if (x < this.width) {
            this.targetX = Math.round((this.width - x)/2);
            Tweener.addTween(this.cloneContainer,
                             { x: this.targetX,
                               time: 0.25,
                               transition: 'easeInOutQuad'});
        }
    }

    getWindows() {
        return this.reduce((ws, column) => ws.concat(column), []);
    }

    getWindow(index, row) {
        if (row < 0 || index < 0 || index >= this.length)
            return false;

        let column = this[index];
        if (row >= column.length)
            return false;
        return column[row];
    }

    addWindow(metaWindow, index, row) {
        if (!this.selectedWindow)
            this.selectedWindow = metaWindow;
        if (this.indexOf(metaWindow) !== -1)
            return false;
        if (row !== undefined && this[index]) {
            let column = this[index];
            column.splice(row, 0, metaWindow);
        } else {
            this.splice(index, 0, [metaWindow]);
        }
        metaWindow.clone.reparent(this.cloneContainer);
        this._populated && this.layout();
        this.emit('window-added', metaWindow, index, row);
        return true;
    }

    removeWindow(metaWindow) {
        let index = this.indexOf(metaWindow);
        if (index === -1)
            return false;

        let selected = this.selectedWindow;
        if (selected === metaWindow) {
            // Select a new window using the stack ordering;
            let windows = this.getWindows();
            let i = windows.indexOf(metaWindow);
            let neighbours = [windows[i - 1], windows[i + 1]].filter(w => w);
            let stack = global.display.sort_windows_by_stacking(neighbours);
            selected = stack[stack.length - 1];
        }

        let column = this[index];
        let row = column.indexOf(metaWindow);
        column.splice(row, 1);
        if (column.length === 0)
            this.splice(index, 1);


        this.cloneContainer.remove_actor(metaWindow.clone);
        Tweener.removeTweens(this.selection);
        this.selection.width = 0;
        this.visible = this.visible.filter(w => w !== metaWindow);

        this.layout();
        this.emit('window-removed', metaWindow, index, row);
        if (selected)
            ensureViewport(selected, this, true);
        else
            this.selectedWindow = null;
        return true;
    }

    swap(direction, metaWindow) {
        metaWindow = metaWindow || this.selectedWindow;

        let [index, row] = this.positionOf(metaWindow);
        let targetIndex = index;
        let targetRow = row;
        switch (direction) {
        case Meta.MotionDirection.LEFT:
            targetIndex--;
            break;
        case Meta.MotionDirection.RIGHT:
            targetIndex++;
            break;
        case Meta.MotionDirection.DOWN:
            targetRow++;
            break;
        case Meta.MotionDirection.UP:
            targetRow--;
            break;
        }
        let column = this[index];
        if (targetIndex < 0 || targetIndex >= this.length
            || targetRow < 0 || targetRow >= column.length)
            return;

        utils.swap(this[index], row, targetRow);
        utils.swap(this, index, targetIndex);
        metaWindow.clone.raise_top();

        this.layout();
        this.emit('swapped', index, targetIndex, row, targetRow);
        ensureViewport(this.selectedWindow, this, true);
    }

    positionOf(metaWindow) {
        metaWindow = metaWindow || this.selectedWindow;
        let index, row;
        for (let i=0; i < this.length; i++) {
            if (this[i].includes(metaWindow))
                return [i, this[i].indexOf(metaWindow)];
        }
        return false;
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

    moveDone() {
        debug('#move-done');
        if (Navigator.navigating || noAnimate) {
            this.delayed = true;
            return;
        }
        this.getWindows().forEach(w => {
            if (!w.get_compositor_private())
                return;
            let unMovable = w.fullscreen ||
                w.get_maximized() === Meta.MaximizeFlags.BOTH;
            if (unMovable)
                return;

            let clone = w.clone;
            let frame = w.get_frame_rect();
            let buffer = w.get_buffer_rect();

            let dX = frame.x - buffer.x, dY = frame.y - buffer.y;
            let x = this.monitor.x + Math.round(clone.x) + dX
                + this.targetX;
            let y = this.monitor.y + Math.round(clone.y) + dY;
            w.move_frame(true, x, y);

        });

        this.visible.forEach(w => {
            w.clone.hide();
            let actor = w.get_compositor_private();
            actor && actor.show();
        });

        this.delayed = false;
        this.emit('move-done');
    }

    startAnimate(grabWindow) {
        this.visible.forEach(w => {
            let actor = w.get_compositor_private();
            if (!actor || w === grabWindow)
                return;
            actor.hide();
            w.clone.show();
        })
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

        this.cloneClip.set_size(monitor.width, monitor.height);
        this.cloneClip.set_clip(-Math.round(prefs.window_gap/2), 0, monitor.width + prefs.window_gap, monitor.height);

        this.emit('monitor-changed');
    }

    /**
       Add existing windows on workspace to the space. Restore the
       layout of oldSpace if present.
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
            if(this.indexOf(meta_window) < 0 && add_filter(meta_window)) {
                this.addWindow(meta_window, this.length);
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
        this.signals.destroy();
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

        this.clickOverlays = [];

        let signals = new utils.Signals();
        this.signals = signals;

        signals.connect(screen, 'notify::n-workspaces',
                        utils.dynamic_function_ref('workspacesChanged', this).bind(this));
        signals.connect(screen, 'workspace-removed',
                        utils.dynamic_function_ref('workspaceRemoved', this));
        signals.connect(screen, 'window-left-monitor', this.windowLeftMonitor.bind(this));
        signals.connect(screen, "window-entered-monitor", this.windowEnteredMonitor.bind(this));

        signals.connect(global.display, 'window-created',
                        utils.dynamic_function_ref('window_created', this));
        signals.connect(global.display, 'grab-op-begin', grabBegin);
        signals.connect(global.display, 'grab-op-end', grabEnd);

        signals.connect(Main.layoutManager, 'monitors-changed', this.monitorsChanged.bind(this));

        const OVERRIDE_SCHEMA = 'org.gnome.shell.overrides';
        this.overrideSettings = new Gio.Settings({ schema_id: OVERRIDE_SCHEMA });
        signals.connect(this.overrideSettings, 'changed::workspaces-only-on-primary',
                        this.monitorsChanged.bind(this));

        // Clone and hook up existing windows
        global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null)
            .forEach(w => {
                registerWindow(w);
                signals.connect(w, 'size-changed', cloneSizeHandler);
            });

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
       The monitors-changed signal can trigger _many_ times when
       connection/disconnecting monitors.

       Monitors also doesn't seem to have a stable identity, which means we're
       left with heuristics.
     */
    monitorsChanged() {
        log('#monitors changed');
        log(Main.layoutManager.primaryIndex);

        if (this.monitors)
            oldMonitors = this.monitors;

        this.monitors = new Map();
        this.get(screen.get_active_workspace()).getWindows().forEach(w => {
            w.get_compositor_private().hide();
            w.clone.show();
        });

        this.spaceContainer.set_size(global.screen_width, global.screen_height);

        for (let overlay of this.clickOverlays) {
            overlay.destroy();
        }
        this.clickOverlays = [];
        let mru = this.mru();
        log('#mru before');
        log(mru.map(s => s.actor));
        let primary = Main.layoutManager.primaryMonitor;
        let monitors = Main.layoutManager.monitors;

        let finish = () => {
            let activeSpace = this.get(global.screen.get_active_workspace());
            this.monitors.set(activeSpace.monitor, activeSpace);
            for (let [monitor, space] of this.monitors) {
                space.clip.raise_top();
            }
            this.forEach(space => {
                space.layout(false);
                let selected = activeSpace.selectedWindow;
                if (selected) {
                    ensureViewport(selected, space, true);
                }
            });
            this.spaceContainer.show();
        };

        if (this.overrideSettings.get_boolean('workspaces-only-on-primary')) {
            this.forEach(space => {
                space.setMonitor(primary, false);
            });
            this.monitors.set(primary, mru[0]);
            let overlay = new ClickOverlay(primary);
            primary.clickOverlay = overlay;
            this.clickOverlays.push(overlay);
            finish();
            return;
        }

        for (let monitor of Main.layoutManager.monitors) {
            let overlay = new ClickOverlay(monitor);
            monitor.clickOverlay = overlay;
            overlay.activate();
            this.clickOverlays.push(overlay);
        }


        // Persist as many monitors as possible
        for (let [oldMonitor, oldSpace] of oldMonitors) {
            let monitor = monitors[oldMonitor.index];
            if (monitor &&
                oldMonitor.width === monitor.width &&
                oldMonitor.height === monitor.height &&
                oldMonitor.x === monitor.x &&
                oldMonitor.y === monitor.y) {
                let space = this.get(oldSpace.workspace);
                this.monitors.set(monitor, space);
                log(`persist: ${monitor.index} ${space.actor}`);
                space.setMonitor(monitor, false);
                mru = mru.filter(s => s !== space);
            }
            oldMonitors.delete(oldMonitor);
        }

        // Populate any remaining monitors
        for (let monitor of monitors) {
            if (this.monitors.get(monitor) === undefined) {
                let space = mru[0];
                log(`remaining: ${monitor.index} ${space.actor}`);
                this.monitors.set(monitor, space);
                space.setMonitor(monitor, false);
                mru = mru.slice(1);
            }
        }

        // Reset any removed monitors
        mru.forEach(space => {
            if (!monitors.includes(space.monitor)) {
                let monitor = monitors[space.monitor.index];
                if (!monitor)
                    monitor = primary;
                log(`removed: ${monitor.index} ${space.actor}`);
                space.setMonitor(monitor, false);
            }
        });
        log('#mru after')
        log(mru.map(s => s.actor));

        finish();
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

                if (metaWindow.get_workspace() === screen.get_active_workspace()
                   && !metaWindow.minimized)
                    actor.show();
                else
                    actor.hide();
            });

        this.signals.destroy();

        // Hold onto a copy of the old monitors and spaces to support reload.
        oldMonitors = this.monitors;
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
        let signal = actor.connect(
            'show',
            () =>  {
                actor.disconnect(signal);
                insertWindow(metaWindow, {});
            });
    };

    windowLeftMonitor(screen, index, metaWindow) {
        debug('window-left-monitor', index, metaWindow.title);
    }

    windowEnteredMonitor(screen, index, metaWindow) {
        debug('window-entered-monitor', index, metaWindow.title);
        if (!metaWindow.get_compositor_private()
            || Scratch.isScratchWindow(metaWindow)
            || metaWindow.is_on_all_workspaces()
            || !metaWindow.clone
            || metaWindow.clone.visible)
            return;

        let monitor = Main.layoutManager.monitors[index];
        let space = this.monitors.get(monitor);
        let focus = metaWindow.has_focus();

        metaWindow.change_workspace(space.workspace);

        // This doesn't play nice with the clickoverlay, disable for now
        if (focus)
            Main.activateWindow(metaWindow);
    }
}

function registerWindow(metaWindow) {
    let actor = metaWindow.get_compositor_private();
    let clone = new Clutter.Clone({source: actor});
    clone.set_position(actor.x, actor.y);
    metaWindow.clone = clone;

    signals.connect(metaWindow, "focus", focus_wrapper);
    signals.connect(metaWindow, 'notify::minimized', minimizeWrapper);
    signals.connect(metaWindow, 'notify::fullscreen', fullscreenWrapper);
    signals.connect(metaWindow, 'size-changed', resizeHandler);
    signals.connect(actor, 'show', showWrapper);

    signals.connect(actor, 'destroy', destroyHandler);
}

function destroyHandler(actor) {
    signals.disconnect(actor);
}

function cloneSizeHandler(metaWindow) {
    // On wayland the clone size doesn't seem to update properly if the window
    // actor is hidden.
    let b = metaWindow.get_buffer_rect();
    metaWindow.clone.set_size(b.width, b.height);
}

function resizeHandler(metaWindow) {
    let space = spaces.spaceOfWindow(metaWindow);
    if (metaWindow !== space.selectedWindow)
        return;

    if (noAnimate) {
        space.layout(false);
        space.selection.width = metaWindow.get_frame_rect().width + prefs.window_gap;
    } else {
        // Restore window position when eg. exiting fullscreen
        !Navigator.navigating
            && move_to(space, metaWindow, {x: metaWindow.get_frame_rect().x});

        space.layout(true);
        ensureViewport(space.selectedWindow, space, true);
    }
}

function enable() {
    debug('#enable');

    signals.connect(
        global.window_manager,
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
        });

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
    signals.destroy();
    spaces.destroy();

    oldSpaces.forEach(space => {
        let windows = space.getWindows();
        let selected = windows.indexOf(space.selectedWindow);
        if (selected === -1)
            return;
        // Stack windows correctly for controlled restarts
        for (let i=selected; i<windows.length; i++) {
            windows[i].lower();
        }
        for (let i=selected; i>=0; i--) {
            windows[i].lower();
        }
    });
}

/**
   Types of windows which never should be tiled.
 */
function add_filter(meta_window) {
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
    if (Scratch.isScratchWindow(meta_window)) {
        add = false;
    }

    return add;
}


/**
   Handle windows leaving workspaces.
 */
function remove_handler(workspace, meta_window) {
    debug("window-removed", meta_window, meta_window.title, workspace.index());
    // Note: If `meta_window` was closed and had focus at the time, the next
    // window has already received the `focus` signal at this point.
    // Not sure if we can check directly if _this_ window had focus when closed.

    if (!meta_window.get_compositor_private())
        signals.disconnect(meta_window);

    let space = spaces.spaceOf(workspace);
    space.removeWindow(meta_window);
}


/**
   Handle windows entering workspaces.
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
   Insert the window into its space if appropriate. Requires MetaWindowActor

   This gets called from `Workspace::window-added` if the window already exists,
   and `Display::window-created` through `WindowActor::show` if window is newly
   created to ensure that the WindowActor exists.
*/
function insertWindow(metaWindow, {existing}) {

    if (!existing) {
        let scratchIsFocused = Scratch.isScratchWindow(global.display.focus_window);
        let addToScratch = scratchIsFocused;

        let winprop = find_winprop(metaWindow);
        if (winprop) {
            if (winprop.oneshot) {
                winprops.splice(winprops.indexOf(winprop), 1);
            }
            if (winprop.scratch_layer) {
                debug("#winprops", `Move ${metaWindow.title} to scratch`);
                addToScratch = true;
            }
        }

        if (addToScratch) {
            Scratch.makeScratch(metaWindow);
            if (scratchIsFocused) {
                Main.activateWindow(metaWindow);
            }
            return;
        }
    }

    if (!add_filter(metaWindow)) {
        !existing && signals.connect(metaWindow, 'size-changed', cloneSizeHandler);
        return;
    }

    let space = spaces.spaceOfWindow(metaWindow);
    let monitor = space.monitor;

    let index = -1; // (-1 -> at beginning)
    if (space.selectedWindow) {
        index = space.indexOf(space.selectedWindow);
    }
    index++;

    if (!space.addWindow(metaWindow, index))
        return;

    metaWindow.unmake_above();
    if (metaWindow.get_maximized() == Meta.MaximizeFlags.BOTH) {
        metaWindow.unmaximize(Meta.MaximizeFlags.BOTH);
        toggleMaximizeHorizontally(metaWindow);
    }

    let buffer = metaWindow.get_buffer_rect();
    let frame = metaWindow.get_frame_rect();
    let x_offset = frame.x - buffer.x;
    let y_offset = frame.y - buffer.y;
    let clone = metaWindow.clone;

    let actor = metaWindow.get_compositor_private();
    actor.hide();
    if (!existing) {
        clone.set_position(clone.targetX,
                           panelBox.height + prefs.vertical_margin);
        clone.set_scale(0, 0);
        Tweener.addTween(clone, {
            scale_x: 1,
            scale_y: 1,
            time: 0.25,
            transition: 'easeInOutQuad',
            onComplete: () => signals.connect(metaWindow, 'size-changed', cloneSizeHandler)
        });
    } else {
        clone.set_position(
            frame.x - monitor.x - x_offset - space.cloneContainer.x,
            frame.y - monitor.y - y_offset + space.cloneContainer.y);
        clone.show();
    }

    if (metaWindow === global.display.focus_window ||
        space.workspace === global.screen.get_active_workspace()) {
        ensureViewport(metaWindow, space, true);
        Main.activateWindow(metaWindow);
    } else {
        ensureViewport(space.selectedWindow, space, true);
    }
}

function animateDown(metaWindow) {

    let frame = metaWindow.get_frame_rect();
    let buffer = metaWindow.get_buffer_rect();
    let clone = metaWindow.clone;
    let dY = frame.y - buffer.y;
    Tweener.addTween(metaWindow.clone, {
        y: panelBox.height + prefs.vertical_margin - dY,
        time: 0.25,
        transition: 'easeInOutQuad'
    });
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

    let index = space.indexOf(meta_window);
    if (index === -1 || space.length === 0)
        return undefined;

    debug('Moving', meta_window.title);

    if (space.selectedWindow.fullscreen ||
        space.selectedWindow.get_maximized() === Meta.MaximizeFlags.BOTH) {
        animateDown(space.selectedWindow);
    }

    if (space.selectedWindow !== meta_window) {
        updateSelection(space, meta_window, true);
    }

    space.selectedWindow = meta_window;

    let monitor = space.monitor;
    let frame = meta_window.get_frame_rect();
    let buffer = meta_window.get_buffer_rect();
    let clone = meta_window.clone;
    let dX = frame.x - buffer.x;

    let x = Math.round(clone.targetX) + space.targetX;
    let y = panelBox.height + prefs.vertical_margin;
    let gap = prefs.window_gap;
    if (index == 0 && x <= 0) {
        // Always align the first window to the display's left edge
        x = 0;
    } else if (index == space.length-1 && x + frame.width >= space.width) {
        // Always align the first window to the display's right edge
        x = space.width - frame.width;
    } else if (frame.width > space.width*0.9 - 2*(prefs.horizontal_margin + prefs.window_gap)) {
        // Consider the window to be wide and center it
        x = Math.round((space.width - frame.width)/2);

    } else if (x + frame.width > space.width) {
        // Align to the right prefs.horizontal_margin
        x = space.width - prefs.horizontal_margin - frame.width;
    } else if (x < 0) {
        // Align to the left prefs.horizontal_margin
        x = prefs.horizontal_margin;
    } else if (x + frame.width === space.width) {
        // When opening new windows at the end, in the background, we want to
        // show some minimup margin
        x = space.width - minimumMargin - frame.width;
    } else if (x === 0) {
        // Same for the start (though the case isn't as common)
        x = minimumMargin;
    }


    let selected = space.selectedWindow;
    if (!Navigator.workspaceMru && (selected.fullscreen
        || selected.get_maximized() === Meta.MaximizeFlags.BOTH)) {
        Tweener.addTween(selected.clone,
                         { y: frame.y - monitor.y,
                           time: 0.25,
                           transition: 'easeInOutQuad',
                         });
    }
    space.moving = selected;
    move_to(space, meta_window, {
        x, y, force
    });

    updateSelection(space);
    selected.raise();
    space.emit('select');
}

function updateSelection(space, metaWindow, noAnimate){
    metaWindow = metaWindow || space.selectedWindow;
    if (!metaWindow)
        return;

    let clone = metaWindow.clone;
    const frame = metaWindow.get_frame_rect();
    const buffer = metaWindow.get_buffer_rect();
    const dX = frame.x - buffer.x, dY = frame.y - buffer.y;
    let protrusion = Math.round(prefs.window_gap/2);
    Tweener.addTween(space.selection,
                     {x: clone.targetX - protrusion,
                      y: clone.targetY - protrusion,
                      width: frame.width + prefs.window_gap,
                      height: frame.height + prefs.window_gap,
                      time: noAnimate ? 0 : 0.25,
                      transition: 'easeInOutQuad'});
}


/**
 * Move the column containing @meta_window to x, y and propagate the change
 * in @space. Coordinates are relative to monitor and y is optional.
 */
function move_to(space, metaWindow, { x, y, delay, transition,
                                       onComplete, onStart, gap, force }) {
    space.delayed = false;

    let index = space.indexOf(metaWindow);
    if (index === -1)
        return;

    let clone = metaWindow.clone;
    let delta = Math.round(clone.targetX) + space.targetX - x;
    let target = space.targetX - delta;
    if (!Navigator.workspaceMru && delta === 0 && !force) {
        space.moveDone();
        return;
    }

    space.targetX = target;
    space.startAnimate();
    Tweener.addTween(space.cloneContainer,
                     { x: target,
                       time: 0.25,
                       transition: 'easeInOutQuad',
                       onComplete: () => {
                           space.moving = false;
                           space.moveDone();
                       }
                     });


    space.monitor.clickOverlay.reset();
    space.visible = [...space[index]];

    for (let overlay = space.monitor.clickOverlay.right,
             n=index+1 ; n < space.length; n++) {

        let metaWindow = space[n][0];
        let clone = metaWindow.clone;
        let frame = metaWindow.get_frame_rect();
        let x = clone.targetX + target;

        if (!(x + frame.width < stack_margin
              || x > space.width - stack_margin
              || metaWindow.fullscreen
              || metaWindow.get_maximized() === Meta.MaximizeFlags.BOTH)) {
            space.visible.push(...space[n]);
        }
        if (!overlay.target && x + frame.width > space.width) {
            overlay.setTarget(space, n);
            break;
        }
    }

    for (let overlay = space.monitor.clickOverlay.left,
             n=index-1; n >= 0; n--) {
        // let width = Math.max(...space[n].map(w => w.get_frame_rect().width));

        let metaWindow = space[n][0];
        let clone = metaWindow.clone;
        let frame = metaWindow.get_frame_rect();
        let x = clone.targetX + target;

        if (!(x + frame.width < stack_margin
            || x > space.width - stack_margin
            || metaWindow.fullscreen
            || metaWindow.get_maximized() === Meta.MaximizeFlags.BOTH)) {
            space.visible.push(...space[n]);
        }
        if (!overlay.target && x < 0) {
            overlay.setTarget(space, n);
            break;
        }
    }
}

var noAnimate = false;
var grabSignals = new utils.Signals();
function grabBegin(screen, display, metaWindow, type) {
    // Don't handle pushModal grabs
    if (type === Meta.GrabOp.COMPOSITOR)
        return;
    let space = spaces.spaceOfWindow(metaWindow);
    if (space.indexOf(metaWindow) === -1)
        return;
    space.startAnimate(metaWindow);
    let frame = metaWindow.get_frame_rect();
    let anchor = metaWindow.clone.targetX;
    let handler = getGrab(space, anchor);
    log(`anchor: ${anchor}`);
    grabSignals.connect(metaWindow, 'position-changed', handler);
    Tweener.removeTweens(space.cloneContainer);
    // Turn size/position animation off when grabbing a window with the mouse
    noAnimate = true;
}

function grabEnd(screen, display, metaWindow, type) {
    if (type === Meta.GrabOp.COMPOSITOR)
        return;
    let space = spaces.spaceOfWindow(metaWindow);
    if (space.indexOf(metaWindow) === -1)
        return;
    grabSignals.destroy();
    noAnimate = false;
    let buffer = metaWindow.get_buffer_rect();
    let clone = metaWindow.clone;
    space.targetX = space.cloneContainer.x;
    clone.set_position(buffer.x - space.targetX, buffer.y);
    space.layout();
    ensureViewport(metaWindow, space, true);
}
function getGrab(space, anchor) {
    let gap = Math.round(prefs.window_gap/2);
    return (metaWindow) => {
        let frame = metaWindow.get_frame_rect();
        space.cloneContainer.x = frame.x - anchor;
        space.selection.y = frame.y - gap;
    };
}

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
var focus_wrapper = utils.dynamic_function_ref('focus_handler', Me);

/**
   Push all minimized windows to the scratch layer
 */
function minimizeHandler(metaWindow) {
    debug('minimized', metaWindow.title);
    if (metaWindow.minimized) {
        Scratch.makeScratch(metaWindow);
    }
}
var minimizeWrapper = utils.dynamic_function_ref('minimizeHandler', Me);

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
var fullscreenWrapper = utils.dynamic_function_ref('fullscreenHandler', Me);

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
var showWrapper = utils.dynamic_function_ref('showHandler', Me);

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
        metaWindow.move_resize_frame(
            true, unmaximizedRect.x, unmaximizedRect.y,
            unmaximizedRect.width, unmaximizedRect.height);
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
    const dx = (targetX + monitor.x) - metaWindow.clone.targetX;
    utils.warpPointerRelative(dx, 0);
    if (space.indexOf(metaWindow) === -1) {
        metaWindow.move_frame(true, targetX + monitor.x, frame.y);
    } else {
        move_to(space, metaWindow, { x: targetX,
                                     onComplete: () => space.moveDone()});
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
    ensureViewport(space.selectedWindow, space, true);
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
    ensureViewport(space.selectedWindow, space, true);
}
