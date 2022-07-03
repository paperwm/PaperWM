var Extension;
if (imports.misc.extensionUtils.extensions) {
    Extension = imports.misc.extensionUtils.extensions["paperwm@hedning:matrix.org"];
} else {
    Extension = imports.ui.main.extensionManager.lookup("paperwm@hedning:matrix.org");
}

var GLib = imports.gi.GLib;
var Tweener = Extension.imports.utils.tweener;
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

var workspaceManager = global.workspace_manager;
var display = global.display;

var spaces;

var Minimap = Extension.imports.minimap;
var Scratch = Extension.imports.scratch;
var Gestures = Extension.imports.gestures;
var TopBar = Extension.imports.topbar;
var Navigator = Extension.imports.navigator;
var ClickOverlay = Extension.imports.stackoverlay.ClickOverlay;
var Settings = Extension.imports.settings;
var Me = Extension.imports.tiling;

var prefs = Settings.prefs;

var backgroundSettings = new Gio.Settings({
    schema_id: 'org.gnome.desktop.background'
})

var borderWidth = 8;
// Mutter prevints windows from being placed further off the screen than 75 pixels.
var stack_margin = 75;

// Some features use this to determine if to sizes is considered equal. ie. `abs(w1 - w2) < sizeSlack`
var sizeSlack = 30;

var panelBox = Main.layoutManager.panelBox;

var PreviewMode = {NONE: 0, STACK: 1, SEQUENTIAL: 2};
var inPreview = PreviewMode.NONE;

var signals, oldSpaces, backgroundGroup, oldMonitors, WindowCloneLayout,
    grabSignals;
function init() {
    // Symbol to retrieve the focus handler id
    signals = new utils.Signals();
    grabSignals = new utils.Signals();
    oldSpaces = new Map();
    oldMonitors = new Map();

    backgroundGroup = Main.layoutManager._backgroundGroup;
}


/**
   Scrolled and tiled per monitor workspace.

   The tiling is composed of an array of columns. A column being an array of
   MetaWindows. Ie. the type being [[MetaWindow]].

   A Space also contains a visual representation of the tiling. The structure is
   currently like this:

   A @clip actor which spans the monitor and clips all its contents to the
   monitor. The clip lives along side all other space's clips in an actor
   spanning the whole global.workspaceManager

   An @actor to hold everything that's visible, it contains a @background,
   a @label and a @cloneContainer.

   The @cloneContainer holds clones of all the tiled windows, it's clipped
   by @cloneClip to avoid protruding into neighbouringing monitors.

   The @border surrounds the outside of the monitor so is only visible when
   using the workspace carousel.

   Clones are necessary due to restrictions mutter places on MetaWindowActors.
   WindowActors can only live in the `global.window_group` and can't be
   moved reliably outside the monitor. We create a Clutter.Clone for every window which
   live in @cloneContainer to avoid these problems. Scrolling to a window in
   the tiling is then done by simply moving the @cloneContainer.

   While eg. animating the cloneContainer WindowActors are all hidden, while the
   clones are shown. When animation is done, the MetaWindows are moved to their
   correct position and the WindowActors are shown.

   The clones are also useful when constructing the workspace stack as it's
   easier to scale and move the whole @actor in one go.

   # Coordinate system

   MetaWindows live in the stage (global) coordinate system. NB: This system
   covers all monitors - a window positioned top-left in a monitor might have
   non-zero coordinates.

   The space (technically the @clip) has it's own coordinate system relative to
   its monitor. Ie. 0,0 is the top-left corner of the monitor.

   To transform a stage point to space coordinates: `space.actor.transform_stage_point(aX, aY)`
 */
class Space extends Array {
    constructor (workspace, container, doInit) {
        super(0);
        this.workspace = workspace;
        this.signals = new utils.Signals();

        // The windows that should be represented by their WindowActor
        this.visible = [];
        this._floating = [];
        this._populated = false;

        let clip = new Clutter.Actor({name: "clip"});
        this.clip = clip;
        let actor = new Clutter.Actor({name: "space-actor"});

        this._visible = true;
        this.hide(); // We keep the space actor hidden when inactive due to performance

        this.actor = actor;
        let cloneClip = new Clutter.Actor({name: "clone-clip"});
        this.cloneClip = cloneClip;
        let cloneContainer = new St.Widget({name: "clone-container"});
        this.cloneContainer = cloneContainer;

        // Pick up the same css as the top bar label
        let label = new St.Label();
        let labelParent = new St.Widget({name: 'panel'});
        let labelParent2 = new St.Widget({style_class: 'panel-button'});
        for (let p of [labelParent, labelParent2]) {
            p.style = `
                background-color: transparent;
                border-image: none;
                background-image: none;
                border: none;
            `;
        }
        labelParent.add_actor(labelParent2);
        labelParent2.add_actor(label);
        this.label = label;
        label.hide();

        let selection = new St.Widget({name: 'selection',
                                       style_class: 'paperwm-selection tile-preview'});
        this.selection = selection;

        clip.space = this;
        cloneContainer.space = this;

        container.add_actor(clip);
        clip.add_actor(actor);
        actor.add_actor(labelParent);
        actor.add_actor(cloneClip);
        cloneClip.add_actor(cloneContainer);

        this.border = new St.Widget({name: "border"});
        this.actor.add_actor(this.border);
        this.border.hide();

        let monitor = Main.layoutManager.primaryMonitor;
        let oldSpace = oldSpaces.get(workspace);
        this.targetX = 0;
        if (oldSpace && oldSpace.monitor) {
            let oldMonitor = Main.layoutManager.monitors[oldSpace.monitor.index];
            if (oldMonitor)
                monitor = oldMonitor;
        }

        this.setSettings(Settings.getWorkspaceSettings(this.workspace.index()));
        this.setMonitor(monitor, false);

        actor.set_pivot_point(0.5, 0);

        this.selectedWindow = null;
        this.leftStack = 0; // not implemented
        this.rightStack = 0; // not implemented

        if (doInit)
            this.init();
    }

    init() {
        if (this._populated || Main.layoutManager._startingUp)
            return;
        let workspace = this.workspace;
        let oldSpace = oldSpaces.get(workspace);

        this.addAll(oldSpace);
        oldSpaces.delete(workspace);
        this._populated = true;
        // FIXME: this prevents bad old values propagating
        // Though, targetX shouldn't ideally be able to get into this state.
        if (oldSpace && Number.isFinite(oldSpace.targetX)) {
            this.targetX = oldSpace.targetX;
        }
        this.cloneContainer.x = this.targetX;
        this.getWindows().forEach(w => {
            animateWindow(w);
        });
        this.layout(false);

        let selected = this.selectedWindow;
        if (selected) {
            ensureViewport(selected, this, true);
        }

        this.signals.connect(workspace, "window-added",
                             utils.dynamic_function_ref("add_handler", Me));
        this.signals.connect(workspace, "window-removed",
                             utils.dynamic_function_ref("remove_handler", Me));
        this.signals.connect(Main.overview, 'showing',
                             this.startAnimate.bind(this));
        this.signals.connect(Main.overview, 'hidden', this.moveDone.bind(this));

        const Convenience = Extension.imports.convenience;
        const settings = Convenience.getSettings();
        this.signals.connect(settings, 'changed::default-background',
                             this.updateBackground.bind(this));
        this.signals.connect(settings, 'changed::use-default-background',
                             this.updateBackground.bind(this));
        this.signals.connect(backgroundSettings, 'changed::picture-uri',
                             this.updateBackground.bind(this));
    }

    show() {
        if (this._visible)
            return;
        this._visible = true;
        this.clip.show();
        for (let col of this) {
            for (let w of col) {
                let actor = w.get_compositor_private();
                w.clone.cloneActor.source = actor;
            }
        }
    }

    hide() {
        if (!this._visible)
            return;
        this._visible = false;
        this.clip.hide();
        for (let col of this)
            for (let w of col)
                w.clone.cloneActor.source = null;
    }

    workArea() {
        let workArea = Main.layoutManager.getWorkAreaForMonitor(this.monitor.index);
        workArea.x -= this.monitor.x;
        workArea.y -= this.monitor.y;
        let topBarAdjustment = this.showTopBar && (prefs.topbar_follow_focus || this.monitor === Main.layoutManager.primaryMonitor) ?
            panelBox.height : 0;
        workArea.height = (workArea.y + workArea.height -
                               topBarAdjustment - prefs.vertical_margin - prefs.vertical_margin_bottom);
        workArea.y = topBarAdjustment + prefs.vertical_margin;
        return workArea;
    }

    layoutGrabColumn(column, x, y0, targetWidth, availableHeight, time, grabWindow) {
        let space = this;
        let needRelayout = false;

        function mosh(windows, height, y0) {
            let targetHeights = fitProportionally(
                windows.map(mw => mw.get_frame_rect().height),
                height
            );
            let [w, relayout, y] = space.layoutColumnSimple(windows, x, y0, targetWidth, targetHeights, time);
            needRelayout = needRelayout || relayout;
            return y;
        }

        const k = column.indexOf(grabWindow);
        if (k < 0) {
            throw new Error("Anchor doesn't exist in column " + grabWindow.title);
        }

        const gap = prefs.window_gap;
        const f = grabWindow.get_frame_rect();
        let yGrabRel = f.y - this.monitor.y;
        targetWidth = f.width;

        const H1 = (yGrabRel - y0) - gap - (k-1)*gap;
        const H2 = availableHeight - (yGrabRel + f.height - y0) - gap - (column.length-k-2)*gap;
        k > 0 && mosh(column.slice(0, k), H1, y0);
        let y = mosh(column.slice(k, k+1), f.height, yGrabRel);
        k+1 < column.length && mosh(column.slice(k+1), H2, y);

        return [targetWidth, needRelayout];
    }

    layoutColumnSimple(windows, x, y0, targetWidth, targetHeights, time) {
        let space = this;
        let y = y0;

        let widthChanged = false;
        let heightChanged = false;

        // log("Layout column simple")
        for (let i = 0; i < windows.length; i++) {
            let mw = windows[i];
            let targetHeight = targetHeights[i];

            let f = mw.get_frame_rect();

            let resizable = !mw.fullscreen &&
                mw.get_maximized() !== Meta.MaximizeFlags.BOTH;

            if (resizable) {
                const hasNewTarget = mw._targetWidth !== targetWidth || mw._targetHeight !== targetHeight;
                const targetReached = f.width === targetWidth && f.height === targetHeight;

                // Update targets (NB: must happen before resize request)
                mw._targetWidth = targetWidth;
                mw._targetHeight = targetHeight;

                if (!targetReached && hasNewTarget) {
                    // Explanation for `hasNewTarget` check in commit message
                    mw.move_resize_frame(true, f.x, f.y, targetWidth, targetHeight);
                }
            } else {
                mw.move_frame(true, space.monitor.x, space.monitor.y);
                targetWidth = f.width;
                targetHeight = f.height;
            }
            if (mw.maximized_vertically) {
                // NOTE: This should really be f.y - monitor.y, but eg. firefox
                // on wayland reports the wrong y coordinates at this point.
                y = y - prefs.vertical_margin;
            }

            // When resize is synchronous, ie. for X11 windows
            let nf = mw.get_frame_rect();
            if (nf.width !== targetWidth && nf.width !== f.width) {
                // log("  Width did not obey", "new", nf.width, "old", f.width, "target", targetWidth, mw.title)
                widthChanged = true;
            }
            if (nf.height !== targetHeight && nf.height !== f.height) {
                // log("  Height did not obey", "new", nf.height, "old", f.height, "target", targetHeight, mw.title);
                heightChanged = true;
                targetHeight = nf.height; // Use actually height for layout
            }

            let c = mw.clone;
            if (c.x !== x || c.targetX !== x ||
                c.y !== y || c.targetY !== y) {

                // log("  Position window", mw.title, `y: ${c.targetY} -> ${y} x: ${c.targetX} -> ${x}`);
                c.targetX = x;
                c.targetY = y;
                if (time === 0) {
                    c.x = x;
                    c.y = y;
                } else {
                    Tweener.addTween(c, {
                        x, y,
                        time,
                        onComplete: this.moveDone.bind(this)
                    });
                }
            }

            y += targetHeight + prefs.window_gap;
        }
        return [targetWidth, widthChanged || heightChanged, y];
    }


    layout(animate = true, options={}) {
        // Guard against recursively calling layout
        if (!this._populated)
            return;
        if (this._inLayout)
            return;
        print("LAYOUT")
        this._inLayout = true;
        this.startAnimate();

        let time = animate ? prefs.animation_time : 0;
        if (window.instant) {
            time = 0;
        }
        let gap = prefs.window_gap;
        let x = 0;
        let selectedIndex = this.selectedIndex();
        let workArea = this.workArea();
        // Happens on monitors-changed
        if (workArea.width === 0) {
            this._inLayout = false;
            return;
        }
        let availableHeight = workArea.height;
        let y0 = workArea.y;
        let fixPointAttempCount = 0;

        for (let i=0; i<this.length; i++) {
            let column = this[i];
            // Actorless windows are trouble. Layout could conceivable run while a window is dying or being born.
            column = column.filter(mw => mw.get_compositor_private());
            if (column.length === 0)
                continue;

            let selectedInColumn = i === selectedIndex ? this.selectedWindow : null;

            let targetWidth;
            if (i === selectedIndex) {
                targetWidth = selectedInColumn.get_frame_rect().width;
            } else {
                targetWidth = Math.max(...column.map(w => w.get_frame_rect().width));
            }
            targetWidth = Math.min(targetWidth, workArea.width - 2*prefs.minimum_margin);

            let resultingWidth, relayout;
            let allocator = options.customAllocators && options.customAllocators[i];
            if (inGrab && column.includes(inGrab.window) && !allocator) {
                [resultingWidth, relayout] =
                    this.layoutGrabColumn(column, x, y0, targetWidth, availableHeight, time,
                                          selectedInColumn);
            } else {
                allocator = allocator || allocateDefault;
                let targetHeights = allocator(column, availableHeight, selectedInColumn);
                [resultingWidth, relayout] =
                    this.layoutColumnSimple(column, x, y0, targetWidth, targetHeights, time);
            }

            if (relayout) {
                if (fixPointAttempCount < 5) {
                    print("Trying to find layout fixpoint", fixPointAttempCount+1)
                    i--;
                    fixPointAttempCount++;
                    continue;
                } else {
                    print("Bail at fixpoint, max tries reached")
                }
            }

            x += resultingWidth + gap;
        }
        this._inLayout = false;


        let oldWidth = this.cloneContainer.width;
        let min = workArea.x;
        let auto = (this.targetX + oldWidth >= min + workArea.width && this.targetX <= 0)
            || this.targetX === min + Math.round((workArea.width - oldWidth)/2);

        // transforms break on width 1
        let width = Math.max(1, x - gap);
        this.cloneContainer.width = width;

        if (auto && animate) {
            if (width < workArea.width) {
                this.targetX = min + Math.round((workArea.width - width)/2);
            } else if (this.targetX + width < min + workArea.width) {
                this.targetX = min + workArea.width - width;
            } else if (this.targetX > workArea.min ) {
                this.targetX = workArea.x;
            }
            Tweener.addTween(this.cloneContainer,
                             { x: this.targetX,
                               time,
                               onComplete: this.moveDone.bind(this)
                             });
        }
        if (animate) {
            ensureViewport(this.selectedWindow, this);
        } else {
            this.moveDone();
        }

        this.emit('layout', this);
    }

    queueLayout() {
        if (this._layoutQueued)
            return;

        this._layoutQueued = true;
        Meta.later_add(Meta.LaterType.RESIZE, () => {
            this._layoutQueued = false;
            this.layout();
        });
    }

    // Space.prototype.isVisible = function
    isVisible(metaWindow, margin=0) {
        let clone = metaWindow.clone;
        let x = clone.x + this.cloneContainer.x;
        let workArea = this.workArea();
        let min = workArea.x;

        if (x - margin + clone.width < min
            || x + margin > min + workArea.width) {
            return false;
        } else {
            return true;
        }
    }

    isFullyVisible(metaWindow) {
        let clone = metaWindow.clone;
        let x = clone.targetX + this.targetX;
        let workArea = this.workArea();
        let min = workArea.x;

        return min <= x && x + clone.width < min + workArea.width;
    }

    visibleRatio(metaWindow) {

        let clone = metaWindow.clone;
        let x = clone.targetX + this.targetX;
        let workArea = this.workArea();
        let min = workArea.x;

        let left = min - x
        let right = x + clone.width

        return min <= x && x + clone.width < min + workArea.width;
    }

    isPlaceable(metaWindow) {
        let clone = metaWindow.clone;
        let x = clone.targetX + this.targetX;
        let workArea = Main.layoutManager.getWorkAreaForMonitor(this.monitor.index);
        let min = workArea.x - this.monitor.x;

        if (x + clone.width < min + stack_margin
            || x > min + workArea.width - stack_margin) {
            return false;
        } else {
            // Fullscreen windows are only placeable on the monitor origin
            if ((metaWindow.get_maximized() === Meta.MaximizeFlags.BOTH && x !== min) ||
                (metaWindow.fullscreen && x !== 0)) {
                return false;
            }
            return true;
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

    isWindowAtPoint(metaWindow, x, y) {
        let clone = metaWindow.clone;
        let wX = clone.x + this.cloneContainer.x;
        return x >= wX && x <= wX + clone.width &&
            y >= clone.y && y <= clone.y + clone.height;
    }

    getWindowAtPoint(x, y) {
        for (let column of this) {
            for (let w of column) {
                if (this.isWindowAtPoint(w, x, y))
                    return w;
            }
        }
        return null;
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

        /*
         * 3.35+ has a bug where move_frame sometimes triggers another move back to its original position. Make sure tiled windows are always positioned correctly.
         */
        this.signals.connect(metaWindow, 'position-changed', (w) => {
            if (inGrab)
                return
            let f = w.get_frame_rect();
            let clone = w.clone;
            let x = clone.targetX + this.targetX;
            let y = this.monitor.y + clone.targetY;
            x = Math.min(this.width - stack_margin, Math.max(stack_margin - f.width, x));
            x += this.monitor.x;
            if (f.x !== x || f.y !== y) {
                w.move_frame(true, x, y);
            }
        });

        metaWindow.clone.reparent(this.cloneContainer);

        // Make sure the cloneContainer is in a clean state (centered) before layout
        if (this.length === 1) {
            let workArea = this.workArea();
            this.targetX = workArea.x + Math.round((workArea.width - this.cloneContainer.width)/2);
        }
        this.emit('window-added', metaWindow, index, row);
        return true;
    }

    removeWindow(metaWindow) {
        let index = this.indexOf(metaWindow);
        if (index === -1)
            return this.removeFloating(metaWindow);

        this.signals.disconnect(metaWindow);

        let selected = this.selectedWindow;
        if (selected === metaWindow) {
            // Select a new window using the stack ordering;
            let windows = this.getWindows();
            let i = windows.indexOf(metaWindow);
            let neighbours = [windows[i - 1], windows[i + 1]].filter(w => w);
            let stack = sortWindows(this, neighbours);
            selected = stack[stack.length - 1];
        }

        let column = this[index];
        let row = column.indexOf(metaWindow);
        column.splice(row, 1);
        if (column.length === 0)
            this.splice(index, 1);

        this.visible.splice(this.visible.indexOf(metaWindow), 1);

        let clone = metaWindow.clone;
        if (clone.get_parent() !== this.cloneContainer)
            utils.trace('wrong parent', metaWindow);
        this.cloneContainer.remove_actor(clone);
        // Don't destroy the selection highlight widget
        if (clone.first_child.name === 'selection')
            clone.remove_actor(clone.first_child);
        let actor = metaWindow.get_compositor_private();
        if (actor)
            actor.remove_clip();

        this.layout();
        if (selected) {
            ensureViewport(selected, this);
        } else {
            this.selectedWindow = null;
        }

        this.emit('window-removed', metaWindow, index, row);
        return true;
    }

    isFloating(metaWindow) {
        return this._floating.indexOf(metaWindow) !== -1;
    }

    addFloating(metaWindow) {
        if (this._floating.indexOf(metaWindow) !== -1 ||
            metaWindow.is_on_all_workspaces())
            return false;
        this._floating.push(metaWindow);
        let clone = metaWindow.clone;
        clone.reparent(this.actor);
        return true;
    }

    removeFloating(metaWindow) {
        let i = this._floating.indexOf(metaWindow);
        if (i === -1)
            return false;
        this._floating.splice(i, 1);
        this.actor.remove_actor(metaWindow.clone);
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

        this.layout();
        this.emit('swapped', index, targetIndex, row, targetRow);
        ensureViewport(this.selectedWindow, this, true);
    }

    switchLinear(dir) {
        let index = this.selectedIndex();
        let column = this[index];
        if (!column)
            return false;
        let row = column.indexOf(this.selectedWindow);
        if (utils.in_bounds(column, row + dir) == false) {
            index += dir;
            if (dir === 1) {
                if (index < this.length) row = 0;
            } else {
                if (index >= 0)
                    row = this[index].length - 1
            }
        } else {
            row += dir;
        }

        let metaWindow = this.getWindow(index, row);
        ensureViewport(metaWindow, this);
        return true;
    }

    switchLeft() { this.switch(Meta.MotionDirection.LEFT) }
    switchRight() { this.switch(Meta.MotionDirection.RIGHT) }
    switchUp() { this.switch(Meta.MotionDirection.UP) }
    switchDown() { this.switch(Meta.MotionDirection.DOWN) }
    switch(direction) {
        let space = this;
        let index = space.selectedIndex();
        if (index === -1) {
            return;
        }
        let row = space[index].indexOf(space.selectedWindow);
        switch (direction) {
        case Meta.MotionDirection.RIGHT:
            index++;
            row = -1;
            break;;
        case Meta.MotionDirection.LEFT:
            index--;
            row = -1;
        }
        if (index < 0 || index >= space.length)
            return;

        let column = space[index];

        if (row === -1) {
            let selected =
                sortWindows(this, column)[column.length - 1];
            row = column.indexOf(selected);
        }

        switch (direction) {
        case Meta.MotionDirection.UP:
            row--;
            break;;
        case Meta.MotionDirection.DOWN:
            row++;
        }
        if (row < 0 || row >= column.length)
            return;

        let metaWindow = space.getWindow(index, row);
        ensureViewport(metaWindow, space);
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

    globalToViewport(gx, gy) {
        let [ok, vx, vy] = this.actor.transform_stage_point(gx, gy);
        return [Math.round(vx), Math.round(vy)];
    }

    /** Transform global coordinates to scroll cooridinates (cloneContainer relative) */
    globalToScroll(gx, gy, {useTarget = false} = {}) {
        // Use the smart transform on the actor, as that's the one we scale etc.
        // We can then use straight translation on the scroll which makes it possible to use target instead if wanted.
        let [vx, vy] = this.globalToViewport(gx, gy);
        let sx = vx - (useTarget ? this.targetX : this.cloneContainer.x);
        let sy = vy - this.cloneContainer.y;
        return [Math.round(sx), Math.round(sy)];
    }

    viewportToScroll(vx, vy=0) {
        return [vx - this.cloneContainer.x, vy - this.cloneContainer.y];
    }

    moveDone() {
        if (this.cloneContainer.x !== this.targetX ||
            this.actor.y !== 0 ||
            Navigator.navigating || inPreview ||
            Main.overview.visible ||
            // Block when we're carrying a window in dnd
            (inGrab && inGrab.window)
           ) {
            return;
        }

        this.visible = [];
        const monitor = this.monitor;
        this.getWindows().forEach(w => {
            let actor = w.get_compositor_private();
            if (!actor)
                return;

            let placeable = this.isPlaceable(w);
            if (placeable)
                this.visible.push(w);

            // Guard against races between move_to and layout
            // eg. moving can kill ongoing resize on wayland
            if (Tweener.isTweening(w.clone))
                return;

            let unMovable = w.fullscreen ||
                w.get_maximized() === Meta.MaximizeFlags.BOTH;
            if (unMovable)
                return;

            let clone = w.clone;
            let f = w.get_frame_rect();
            let x = clone.targetX + this.targetX;
            let y = monitor.y + clone.targetY;
            x = Math.max(stack_margin - f.width, x);
            x = Math.min(this.width - stack_margin, x);
            x += monitor.x;
            // let b = w.get_frame_rect();
            if ((f.x !== x || f.y !== y)) {
                w.move_frame(true, x, y);
            }
        });

        this.visible.forEach(w => {
            if (Tweener.isTweening(w.clone))
                return;
            let actor = w.get_compositor_private();

            // The actor's width/height is not correct right after resize
            let b = w.get_buffer_rect();
            const x = monitor.x - b.x;
            const y = monitor.y - b.y;
            const cw = monitor.width;
            const ch = monitor.height;
            actor.set_clip(x, y, cw, ch);

            showWindow(w);
        });

        this._floating.forEach(showWindow);

        this.fixOverlays();

        if (!Meta.is_wayland_compositor()) {
            // See startAnimate
            Main.layoutManager.untrackChrome(this.background);
        }

        this._isAnimating = false;

        if (this.selectedWindow && this.selectedWindow === display.focus_window) {
            let index = this.indexOf(this.selectedWindow);
            this[index].forEach(w => w.lastFrame = w.get_frame_rect());
        }

        this.emit('move-done');
    }

    startAnimate(grabWindow) {

        if (!this._isAnimating && !Meta.is_wayland_compositor()) {
            // Tracking the background fixes issue #80
            // It also let us activate window clones clicked during animation
            // Untracked in moveDone
            Main.layoutManager.trackChrome(this.background);
        }

        this.visible.forEach(w => {
            let actor = w.get_compositor_private();
            if (!actor)
                return;
            actor.remove_clip();
            if (inGrab && inGrab.window === w)
                return;
            animateWindow(w);
        });

        this._floating.forEach(w => {
            let f = w.get_frame_rect();
            if (!animateWindow(w))
                return;
            w.clone.x = f.x - this.monitor.x;
            w.clone.y = f.y - this.monitor.y;
        });

        this._isAnimating = true;
    }

    fixOverlays(metaWindow) {

        metaWindow = metaWindow || this.selectedWindow;
        let index = this.indexOf(metaWindow);
        let target = this.targetX;
        this.monitor.clickOverlay.reset();
        for (let overlay = this.monitor.clickOverlay.right,
                 n=index+1 ; n < this.length; n++) {
            let metaWindow = this[n][0];
            let clone = metaWindow.clone;
            let x = clone.targetX + target;
            if (!overlay.target && x + clone.width > this.width) {
                overlay.setTarget(this, n);
                break;
            }
        }

        for (let overlay = this.monitor.clickOverlay.left,
                 n=index-1; n >= 0; n--) {
            let metaWindow = this[n][0];
            let clone = metaWindow.clone;
            let x = clone.targetX + target;
            if (!overlay.target && x < 0) {
                overlay.setTarget(this, n);
                break;
            }
        }
    }

    setSelectionActive() {
        this.selection.opacity = 255;
    }

    setSelectionInactive() {
        this.selection.opacity = 140;
    }

    setSettings([uuid, settings]) {
        this.signals.disconnect(this.settings);

        this.settings = settings;
        this.uuid = uuid;
        if (this.background) {
            this.updateColor();
            this.updateBackground();
        }
        this.updateName();
        this.updateShowTopBar();
        this.signals.connect(this.settings, 'changed::name',
                             this.updateName.bind(this));
        this.signals.connect(Settings.settings, 'changed::use-workspace-name',
                             this.updateName.bind(this));
        this.signals.connect(this.settings, 'changed::color',
                             this.updateColor.bind(this));
        this.signals.connect(this.settings, 'changed::background',
                             this.updateBackground.bind(this));
        this.signals.connect(Settings.settings, 'changed::default-show-top-bar',
                             this.updateShowTopBar.bind(this));
        this.signals.connect(this.settings, 'changed::show-top-bar',
                             this.updateShowTopBar.bind(this));
    }

    updateShowTopBar() {
        let showTopBar = prefs.default_show_top_bar;
        let userValue = this.settings.get_user_value('show-top-bar');
        if (userValue) {
            showTopBar = userValue.unpack();
        }

        if (showTopBar) {
            this.showTopBar = 1;
        } else {
            this.showTopBar = 0;
        }
        this._populated && TopBar.fixTopBar();

        this.layout();
    }

    updateColor() {
        let color = this.settings.get_string('color');
        if (color === '') {
            let colors = prefs.workspace_colors;
            let index = this.workspace.index() % prefs.workspace_colors.length;
            color = colors[index];
        }
        this.color = color;
        this.border.set_style(`
border: ${borderWidth}px ${this.color};
border-radius: ${borderWidth}px;
box-shadow: 0px 0px 8px 0px rgba(0, 0, 0, .7);
`);
        this.metaBackground.set_color(Clutter.color_from_string(color)[1]);
    }

    updateBackground() {
        let path = this.settings.get_string('background') || prefs.default_background;
        let useDefault = Settings.settings.get_boolean('use-default-background');
        const BackgroundStyle = imports.gi.GDesktopEnums.BackgroundStyle;
        let style = BackgroundStyle.ZOOM;
        if (!path && useDefault) {
            path = backgroundSettings.get_string('picture-uri');
        }

        let file = Gio.File.new_for_commandline_arg(path);
        if (path === '' || !file.query_exists(null)) {
            file = Gio.File.new_for_uri('resource:///org/gnome/shell/theme/noise-texture.png');
            style = BackgroundStyle.WALLPAPER;
        }
        this.metaBackground.set_file(file, style);
    }

    updateName() {
        if (prefs.use_workspace_name) {
            this.label.show();
        } else {
            this.label.hide();
        }
        let name = this.settings.get_string('name');
        if (name === '')
            name = Meta.prefs_get_workspace_name(this.workspace.index());
        Meta.prefs_change_workspace_name(this.workspace.index(), name);
        this.label.text = name;
        this.name = name;

        if (this.workspace === workspaceManager.get_active_workspace()) {
            TopBar.updateWorkspaceIndicator(this.workspace.index());
        }
    }

    createBackground() {
        if (this.background) {
            this.signals.disconnect(this.background)
            this.background.destroy();
        }

        let monitor = this.monitor;
        const GDesktopEnums = imports.gi.GDesktopEnums;
        let backgroundParams = global.screen ?
            { meta_screen: global.screen } :
            { meta_display: display };

        let metaBackground = new Meta.Background(backgroundParams);
        // gnome-shell 3.38
        if (Meta.BackgroundActor.prototype.set_background) {
            backgroundParams.background = metaBackground
        }
        this.background = new Meta.BackgroundActor(
            Object.assign({
                name: "background",
                monitor: monitor.index,
                reactive: true // Disable the background menu
            }, backgroundParams)
        );

        if (this.background.content) {
            this.background.content.set({
                background: metaBackground
            })
        }
        this.metaBackground = metaBackground

        this.actor.insert_child_below(this.background, null);

        this.signals.connect(
            this.background, 'button-press-event',
            (actor, event) => {
                if (inGrab) {
                    return;
                }
                let [gx, gy, $] = global.get_pointer();
                let [ok, x, y] = this.actor.transform_stage_point(gx, gy);
                let windowAtPoint = !Gestures.gliding && this.getWindowAtPoint(x, y);
                if (windowAtPoint) {
                    ensureViewport(windowAtPoint, this);
                    inGrab = new Extension.imports.grab.MoveGrab(windowAtPoint, Meta.GrabOp.MOVING, this);
                    inGrab.begin();
                } else if (inPreview) {
                    spaces.selectedSpace = this;
                    Navigator.getNavigator().finish();
                }
            });

        this.signals.connect(
            this.background, 'scroll-event',
            (actor, event) => {
                if (!inGrab && !Navigator.navigating)
                    return;
                let dir = event.get_scroll_direction();
                if (dir === Clutter.ScrollDirection.SMOOTH)
                    return;
                // print(dir, Clutter.ScrollDirection.SMOOTH, Clutter.ScrollDirection.UP, Clutter.ScrollDirection.DOWN)
                let dx
                log(utils.ppEnumValue(dir, Clutter.ScrollDirection))
                // let dx = dir === Clutter.ScrollDirection.DOWN ? -1 : 1
                // let [dx, dy] = event.get_scroll_delta()

                let [gx, gy] = event.get_coords();
                if (!gx) {
                    print("Noooo");
                    return;
                }
                print(dx, gx, gy);

                switch (dir) {
                    case Clutter.ScrollDirection.LEFT:
                    case Clutter.ScrollDirection.UP:
                        this.switchLeft();
                        break;
                    case Clutter.ScrollDirection.RIGHT:
                    case Clutter.ScrollDirection.DOWN:
                        this.switchRight();
                        break;
                }
                // spaces.selectedSpace = this;
                // nav.finish();
            });

        this.signals.connect(
            this.background, 'captured-event',
            Gestures.horizontalScroll.bind(this));
    }

    setMonitor(monitor, animate) {
        // Remake the background when we move monitors. The size/scale will be
        // incorrect when using fractional scaling.
        if (monitor !== this.monitor) {
            this.monitor = monitor;
            this.createBackground();
            this.updateBackground();
            this.updateColor()
        }
        let background = this.background;


        let cloneContainer = this.cloneContainer;
        let clip = this.clip;

        this.width = monitor.width;
        this.height = monitor.height;

        let time = animate ? 0.25 : 0;

        Tweener.addTween(this.actor,
                        {x: 0, y: 0, scale_x: 1, scale_y: 1,
                         time});
        Tweener.addTween(clip,
                         {scale_x: 1, scale_y: 1, time});

        clip.set_position(monitor.x, monitor.y);
        clip.set_size(monitor.width, monitor.height);
        clip.set_clip(0, 0,
                      monitor.width,
                      monitor.height);

        let scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        this.border.set_position(-borderWidth*scale, -borderWidth*scale);
        this.border.set_size(monitor.width + scale*borderWidth*2,
                             monitor.height + scale*borderWidth*2);

        background.set_size(this.width, this.height);

        this.cloneClip.set_size(monitor.width, monitor.height);
        this.cloneClip.set_clip(0, 0,
                                this.width, this.height);
        // transforms break if there's no height
        this.cloneContainer.height = this.monitor.height;

        this.layout();
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
            let z_sorted = display.sort_windows_by_stacking(windows);
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
                    // Prune removed windows
                    if (metaWindow.get_compositor_private()) {
                        this.addWindow(metaWindow, i, j);
                    } else {
                        column.splice(j, 1); j--;
                    }
                }
                if (column.length === 0) {
                    oldSpace.splice(i, 1); i--;
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

        let tabList = display.get_tab_list(Meta.TabList.NORMAL, workspace)
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
        this.signals.destroy();
        this.background.destroy();
        this.background = null;
        this.cloneContainer.destroy();
        this.cloneContainer = null;
        this.clip.destroy();
        this.cloneContainer = null;
        let workspace = this.workspace;
    }
}
Signals.addSignalMethods(Space.prototype);


var StackPositions = {
    top: 0.01,
    up: 0.035,
    selected: 0.1,
    down: 0.95,
    bottom: 1.1
};

/**
   A `Map` to store all `Spaces`'s, indexed by the corresponding workspace.

   TODO: Move initialization to enable
*/
class Spaces extends Map {
    // Fix for eg. space.map, see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes#Species
    static get [Symbol.species]() { return Map; }

    constructor() {
        super();

        this._initDone = false;
        this.clickOverlays = [];
        this.signals = new utils.Signals();
        this.stack = [];
        let spaceContainer = new Clutter.Actor({name: 'spaceContainer'});
        spaceContainer.hide();
        this.spaceContainer = spaceContainer;

        backgroundGroup.add_child(this.spaceContainer);

        // Hook up existing workspaces
        for (let i=0; i < workspaceManager.n_workspaces; i++) {
            let workspace = workspaceManager.get_workspace_by_index(i);
            this.addSpace(workspace);
        }
        this.signals.connect(workspaceManager, 'notify::n-workspaces',
                             utils.dynamic_function_ref('workspacesChanged', this).bind(this));

        if (workspaceManager.reorder_workspace) {
            // Compatibility: only in recent gnome-shell versions
            this.signals.connect(workspaceManager, 'workspaces-reordered',
                                 utils.dynamic_function_ref('workspacesChanged', this).bind(this));
        }

        let OVERRIDE_SCHEMA;
        if (global.screen) {
            OVERRIDE_SCHEMA = 'org.gnome.shell.overrides';
        } else { // 3.30 now uses per desktop settings, instead of ad-hoc overrides
            OVERRIDE_SCHEMA = 'org.gnome.mutter';
        }
        this.overrideSettings = new Gio.Settings({ schema_id: OVERRIDE_SCHEMA });

        this.monitorsChanged();
    }

    init() {
        // Create extra workspaces if required
        Main.wm._workspaceTracker._checkWorkspaces()

        this.signals.connect(display, 'window-created',
                        this.window_created.bind(this));
        this.signals.connect(display, 'grab-op-begin',
                        (display, d, mw, type) => grabBegin(mw, type));
        this.signals.connect(display, 'grab-op-end',
                        (display, d, mw, type) => grabEnd(mw, type));

        this.signals.connect(Main.layoutManager, 'monitors-changed', this.monitorsChanged.bind(this));

        this.signals.connect(global.window_manager, 'switch-workspace',
                        this.switchWorkspace.bind(this));

        this.signals.connect(this.overrideSettings, 'changed::workspaces-only-on-primary',
                             this.monitorsChanged.bind(this));

        // Clone and hook up existing windows
        display.get_tab_list(Meta.TabList.NORMAL_ALL, null)
            .forEach(w => {
                registerWindow(w);
                // Fixup allocations on reload
                allocateClone(w);
                this.signals.connect(w, 'size-changed', resizeHandler);
            });
        this._initDone = true;

        // Redo the stack
        // X11: Monitors aren't set up properly on `enable`, so we need it here too
        this.monitorsChanged();

        // Initialize spaces _after_ monitors are set up
        this.forEach(space => space.init());

        this.stack = this.mru();
    }

    /**
       The monitors-changed signal can trigger _many_ times when
       connection/disconnecting monitors.

       Monitors also doesn't seem to have a stable identity, which means we're
       left with heuristics.
     */
    monitorsChanged() {
        this._monitorsChanging = true;
        this.onlyOnPrimary = this.overrideSettings.get_boolean('workspaces-only-on-primary');

        if (this.monitors)
            oldMonitors = this.monitors;

        this.monitors = new Map();
        this.get(workspaceManager.get_active_workspace()).getWindows().forEach(w => {
            animateWindow(w);
        });

        this.spaceContainer.set_size(global.screen_width, global.screen_height);

        for (let overlay of this.clickOverlays) {
            overlay.destroy();
        }
        this.clickOverlays = [];
        for (let monitor of Main.layoutManager.monitors) {
            let overlay = new ClickOverlay(monitor, this.onlyOnPrimary);
            monitor.clickOverlay = overlay;
            overlay.activate();
            this.clickOverlays.push(overlay);
        }

        let mru = this.mru();
        let primary = Main.layoutManager.primaryMonitor;
        let monitors = Main.layoutManager.monitors;

        let finish = () => {
            let activeSpace = this.get(workspaceManager.get_active_workspace());
            let visible = monitors.map(m => this.monitors.get(m));
            let mru = this.mru();
            this.selectedSpace = mru[0];
            this.monitors.set(activeSpace.monitor, activeSpace);
            TopBar.setMonitor(activeSpace.monitor);
            for (let [monitor, space] of this.monitors) {
                space.show();
                space.clip.raise_top();
            }
            this.forEach(space => {
                space.layout(false);
                let selected = space.selectedWindow;
                if (selected) {
                    ensureViewport(selected, space, true);
                }
            });
            this.spaceContainer.show();

            imports.mainloop.timeout_add(
                20, () => { this._monitorsChanging = false; });

            activeSpace.monitor.clickOverlay.deactivate();
        };

        if (this.onlyOnPrimary) {
            this.forEach(space => {
                space.setMonitor(primary, false);
            });
            this.monitors.set(primary, mru[0]);
            finish();
            return;
        }

        // Persist as many monitors as possible
        for (let [oldMonitor, oldSpace] of oldMonitors) {
            let monitor = monitors[oldMonitor.index];
            let space = this.get(oldSpace.workspace);
            if (monitor && space &&
                oldMonitor.width === monitor.width &&
                oldMonitor.height === monitor.height &&
                oldMonitor.x === monitor.x &&
                oldMonitor.y === monitor.y) {
                this.monitors.set(monitor, space);
                space.setMonitor(monitor, false);
                mru = mru.filter(s => s !== space);
            }
            oldMonitors.delete(oldMonitor);
        }

        // Populate any remaining monitors
        for (let monitor of monitors) {
            if (this.monitors.get(monitor) === undefined) {
                let space = mru[0];
                if (space === undefined && this._initDone) {
                    let workspace = workspaceManager.append_new_workspace(
                        false, global.get_current_time());
                    space = this.spaceOf(workspace);
                }
                if (space === undefined) {
                    break;
                }
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
                space.setMonitor(monitor, false);
            }
        });

        finish();
    }

    destroy() {
        for (let overlay of this.clickOverlays) {
            overlay.destroy();
        }
        for (let monitor of Main.layoutManager.monitors) {
            delete monitor.clickOverlay;
        }

        display.get_tab_list(Meta.TabList.NORMAL_ALL, null)
            .forEach(metaWindow => {
                let actor = metaWindow.get_compositor_private();
                actor.remove_clip();

                if (metaWindow.clone) {
                    metaWindow.clone.destroy();
                    metaWindow.clone = null;
                }

                metaWindow._targetHeight = null;
                metaWindow._targetWidth = null;

                if (metaWindow.get_workspace() === workspaceManager.get_active_workspace()
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
        this.spaceContainer = null;
    }

    workspacesChanged() {
        let nWorkspaces = workspaceManager.n_workspaces;

        // Identifying destroyed workspaces is rather bothersome,
        // as it will for example report having windows,
        // but will crash when looking at the workspace index

        // Gather all indexed workspaces for easy comparison
        let workspaces = {};
        for (let i=0; i < nWorkspaces; i++) {
            let workspace = workspaceManager.get_workspace_by_index(i);
            workspaces[workspace] = true;
            if (this.spaceOf(workspace) === undefined) {
                debug('workspace added', workspace);
                this.addSpace(workspace);
            }
        }

        let nextUnusedWorkspaceIndex = nWorkspaces;
        for (let [workspace, space] of this) {
            if (workspaces[space.workspace] !== true) {
                debug('workspace removed', space.workspace);
                this.removeSpace(space);

                // Maps in javascript (and thus Spaces) remember insertion order
                // so the workspaces are sorted by index. The relative ordering
                // of the removed workspaces will thus be preserved when resurrected.
                space.settings.set_int('index', nextUnusedWorkspaceIndex);
                nextUnusedWorkspaceIndex++;
            }
        }

        // Ensure the live spaces have correct indices
        for (let [workspace, space] of this) {
            space.settings.set_int('index', workspace.index());
            Meta.prefs_change_workspace_name(workspace.index(), space.name);
        }
    };

    switchMonitor(direction, move) {
        let focus = display.focus_window;
        let monitor = Scratch.focusMonitor();
        let currentSpace = this.monitors.get(monitor);
        let i = display.get_monitor_neighbor_index(monitor.index, direction);
        print("switch", utils.ppEnumValue(direction, Meta.DisplayDirection), i, monitor.index)
        print("currentSpace", currentSpace.name)
        print("focus window", global.display.focus_window)
        if (i === -1)
            return;
        let newMonitor = Main.layoutManager.monitors[i];
        let space = this.monitors.get(newMonitor);
        print("nextSpace", space.name)

        if (move && focus) {
            let metaWindow = focus.get_transient_for() || focus;

            if (currentSpace && currentSpace.indexOf(metaWindow) !== -1) {
                currentSpace.removeWindow(metaWindow);
                metaWindow.foreach_transient((t) => {
                    currentSpace.removeWindow(t);
                });
            } else {
                metaWindow.move_to_monitor(newMonitor.index);
            }
            metaWindow.foreach_transient((t) => {
                t.move_to_monitor(newMonitor.index);
            });
            if (space) {
                metaWindow.change_workspace(space.workspace);
                metaWindow.foreach_transient((t) => {
                    space.addFloating(t);
                });
                space.workspace.activate_with_focus(focus, global.get_current_time());
            } else {
                metaWindow.move_to_monitor(newMonitor.index);
            }
        } else {
            space.workspace.activate(global.get_current_time());
        }
    }

    switchWorkspace(wm, fromIndex, toIndex) {
        let to = workspaceManager.get_workspace_by_index(toIndex);
        let from = workspaceManager.get_workspace_by_index(fromIndex);
        let toSpace = this.spaceOf(to);
        let fromSpace = this.spaceOf(from);

        print("switchWorkspace", fromSpace.monitor.index, toSpace.monitor.index)
        if (inGrab && inGrab.window) {
            inGrab.window.change_workspace(toSpace.workspace);
        }

        for (let metaWindow of toSpace.getWindows()) {
            // Make sure all windows belong to the correct workspace.
            // Note: The 'switch-workspace' signal (this method) runs before mutter decides on focus window.
            // This simplifies other code moving windows between workspaces.
            // Eg.: The DnD-window defer changing its workspace until the workspace actually is activated.
            //      This ensures the DnD window keep focus the whole time.
            metaWindow.change_workspace(toSpace.workspace);
        }

        if (inPreview === PreviewMode.NONE && toSpace.monitor === fromSpace.monitor) {
            // Only start an animation if we're moving between workspaces on the
            // same monitor
            this._initWorkspaceSequence();
        } else {
            this.selectedSpace.setMonitor(this.selectedSpace.monitor, false);
        }

        this.stack = this.stack.filter(s => s !== toSpace);
        this.stack = [toSpace, ...this.stack];

        let monitor = toSpace.monitor;
        this.monitors.set(monitor, toSpace);

        this.animateToSpace(toSpace, fromSpace);

        TopBar.setMonitor(toSpace.monitor);
        toSpace.monitor.clickOverlay.deactivate();

        let [x, y, _mods] = global.get_pointer();
        x -= monitor.x;
        y -= monitor.y;
        if (x < 0 || x > monitor.width ||
            y < 0 || y > monitor.height) {
            utils.warpPointer(monitor.x + Math.floor(monitor.width/2),
                              monitor.y + Math.floor(monitor.height/2));
        }

        for (let monitor of Main.layoutManager.monitors) {
            if (monitor === toSpace.monitor)
                continue;
            monitor.clickOverlay.activate();
        }

        inPreview = PreviewMode.NONE;
    }

    _getOrderedSpaces(monitor) {
        let nWorkspaces = workspaceManager.n_workspaces;
        let out = [];
        for (let i=0; i<nWorkspaces; i++) {
            let space = this.spaceOf(workspaceManager.get_workspace_by_index(i));
            if (space.monitor === monitor ||
                (space.length === 0 && this.monitors.get(space.monitor) !== space))
                out.push(space);
        }
        return out;
    }

    _initWorkspaceSequence() {
        if (inPreview) {
            return;
        }
        inPreview = PreviewMode.SEQUENTIAL;

        if (Main.panel.statusArea.appMenu) {
            Main.panel.statusArea.appMenu.container.hide();
        }

        this._animateToSpaceOrdered(this.selectedSpace, false);

        let selected = this.selectedSpace.selectedWindow;
        if (selected && selected.fullscreen) {
            Tweener.addTween(selected.clone, {
                y: Main.panel.actor.height + prefs.vertical_margin,
                time: prefs.animation_time,
            });
        }
    }

    _animateToSpaceOrdered(toSpace, animate = true) {
        // Always show the topbar when using the workspace stack
        TopBar.fixTopBar();

        toSpace = toSpace || this.selectedSpace;
        let monitorSpaces = this._getOrderedSpaces(toSpace.monitor);

        let currentMonitor = toSpace.monitor;
        this.selectedSpace = toSpace;

        const scale = 1;
        const padding_percentage = 4;
        const to = monitorSpaces.indexOf(toSpace);
        monitorSpaces.forEach((space, i) => {

            space.setMonitor(currentMonitor, false);
            space.startAnimate();

            Tweener.removeTweens(space.border);
            space.border.opacity = 255;
            space.border.show();

            space.show();

            let padding = (space.height * scale / 100) * padding_percentage;
            let y = ((space.height + padding) * (i - to)) * scale;
            if (animate) {
                Tweener.addTween(space.actor, {
                    time: prefs.animation_time,
                    y, scale_y: scale, scale_x: scale,
                });
            } else {
                // Remove any lingering onComplete handlers from animateToSpace
                Tweener.removeTweens(space.actor);

                space.actor.y = y;
                space.actor.scale_y = scale;
                space.actor.scale_x = scale;
            }

            let selected = space.selectedWindow;
            if (selected && selected.fullscreen && space !== toSpace) {
                selected.clone.y = Main.panel.actor.height + prefs.vertical_margin;
            }
        });
    }

    selectSequenceSpace(direction, move) {

        // if in stack preview do not run sequence preview
        if (inPreview === PreviewMode.STACK) {
            return;
        }

        let currentSpace = this.spaceOf(workspaceManager.get_active_workspace());
        let monitorSpaces = this._getOrderedSpaces(currentSpace.monitor);

        if (!inPreview) {
            this._initWorkspaceSequence();
        }

        let from = monitorSpaces.indexOf(this.selectedSpace);
        let newSpace = this.selectedSpace;
        let to = from;
        if (move && this.selectedSpace.selectedWindow) {
            takeWindow(this.selectedSpace.selectedWindow,
                       this.selectedSpace,
                       {navigator: Navigator.getNavigator()});
        }

        if (direction === Meta.MotionDirection.DOWN)
            to = from + 1;
        else
            to = from - 1;

        if (to < 0 || to >= monitorSpaces.length)
            return;

        if (to === from && Tweener.isTweening(newSpace.actor))
            return;

        newSpace = monitorSpaces[to];
        this.selectedSpace = newSpace;

        TopBar.updateWorkspaceIndicator(newSpace.workspace.index());

        const scale = 0.825;
        const padding_percentage = 4;
        let last = monitorSpaces.length - 1;
        monitorSpaces.forEach((space, i) => {

            let padding = (space.height * scale / 100) * padding_percentage;
            let center = (space.height - (space.height * scale)) / 2;
            let space_y;
            if (to === 0) {
                space_y = padding + (space.height + padding) * (i - to) * scale;
            } else if (to == last) {
                space_y = (center*2 - padding) + (space.height + padding) * (i - to) * scale;
            } else {
                space_y = center + (space.height + padding) * (i - to) * scale;
            }

            space.show();
            Tweener.addTween(space.actor,
                             {y: space_y,
                              time: prefs.animation_time,
                              scale_x: scale,
                              scale_y: scale,
                             });

        });
    }

    _initWorkspaceStack() {

        if (inPreview)
            return;

        inPreview = PreviewMode.STACK;

        // Always show the topbar when using the workspace stack
        TopBar.fixTopBar();
        const scale = 0.9;
        let space = this.spaceOf(workspaceManager.get_active_workspace());
        let mru = [...this.stack];
        this.monitors.forEach(space => mru.splice(mru.indexOf(space), 1));
        mru = [space, ...mru];

        if (Main.panel.statusArea.appMenu)
            Main.panel.statusArea.appMenu.container.hide();
        let monitor = space.monitor;
        this.selectedSpace = space;

        let cloneParent = space.clip.get_parent();
        mru.forEach((space, i) => {
            space.startAnimate();

            if (space.length !== 0) {
                let scaleX = monitor.width/space.width;
                let scaleY = monitor.height/space.height;
                space.clip.set_scale(scaleX, scaleY);
                space.clip.set_position(monitor.x, monitor.y);
            } else {
                space.setMonitor(monitor);
            }

            Tweener.removeTweens(space.border);
            space.border.opacity = 255;
            space.border.show();

            let h;
            if (i === 0) {
                h = 0;
                space.show();
            } else if (i === 1) {
                h = StackPositions.up;
                space.show();
            } else if (i === 2) {
                h = StackPositions.top;
                space.show();
            } else {
                h = StackPositions.top;
                space.hide();
            }

            space.actor.set_position(0, space.height*h);

            space.actor.scale_y = scale - i*0.01;
            space.actor.scale_x = scale - i*0.01;

            // Remove any lingering onComplete handlers from animateToSpace
            Tweener.removeTweens(space.actor);

            if (mru[i - 1] === undefined)
                return;
            let child = space.clip;
            let sibling = mru[i - 1].clip;
            child !== sibling && cloneParent.set_child_below_sibling(child, sibling);
            let selected = space.selectedWindow;
            if (selected && selected.fullscreen) {
                selected.clone.y = Main.panel.actor.height + prefs.vertical_margin;
            }
        });

        space.actor.scale_y = 1;
        space.actor.scale_x = 1;

        let selected = space.selectedWindow;
        if (selected && selected.fullscreen) {
            Tweener.addTween(selected.clone, {
                y: Main.panel.actor.height + prefs.vertical_margin,
                time: prefs.animation_time,
            });
        }
    }

    selectStackSpace(direction, move) {

        // if in sequence preview do not run stack preview
        if (inPreview === PreviewMode.SEQUENTIAL) {
            return;
        }

        const scale = 0.9;
        let space = this.spaceOf(workspaceManager.get_active_workspace());
        let mru = [...this.stack];

        this.monitors.forEach(space => mru.splice(mru.indexOf(space), 1));
        mru = [space, ...mru];

        if (!inPreview) {
            this._initWorkspaceStack();
        }

        let from = mru.indexOf(this.selectedSpace);
        let newSpace = this.selectedSpace;
        let to = from;
        if (move && this.selectedSpace.selectedWindow) {
            takeWindow(this.selectedSpace.selectedWindow,
                       this.selectedSpace,
                       {navigator: Navigator.getNavigator()});
        }

        if (direction === Meta.MotionDirection.DOWN)
            to = from + 1;
        else
            to = from - 1;

        // wrap around workspaces
        if (to < 0) {
            to = mru.length - 1;
        }
        else if (to >= mru.length) {
            to = 0;
        }

        if (to === from && Tweener.isTweening(newSpace.actor))
            return;

        newSpace = mru[to];
        this.selectedSpace = newSpace;

        TopBar.updateWorkspaceIndicator(newSpace.workspace.index());

        mru.forEach((space, i) => {
            let actor = space.actor;
            let h, onComplete = () => {};
            if (to === i)
                h = StackPositions.selected;
            else if (to + 1 === i)
                h = StackPositions.up;
            else if (to - 1 === i)
                h = StackPositions.down;
            else if (i > to)
                h = StackPositions.top;
            else if (i < to)
                h = StackPositions.bottom;

            if (Math.abs(i - to) > 2) {
                onComplete = () => space.hide();
            } else {
                space.show();
            }

            Tweener.addTween(actor,
                             {y: h*space.height,
                              time: prefs.animation_time,
                              scale_x: scale + (to - i)*0.01,
                              scale_y: scale + (to - i)*0.01,
                              onComplete
                             });

        });
    }

    animateToSpace(to, from, callback) {

        let currentPreviewMode = inPreview;
        inPreview = PreviewMode.NONE;

        TopBar.updateWorkspaceIndicator(to.workspace.index());

        this.selectedSpace = to;

        to.show();
        let selected = to.selectedWindow;
        if (selected)
            ensureViewport(selected, to);

        if (from) {
            from.startAnimate();
        }

        let visible = new Map();
        for (let [monitor, space] of this.monitors) {
            visible.set(space, true);
        }

        let onComplete = () => {
            // Hide any spaces that aren't visible This
            // avoids a nasty permance degregration in some
            // cases
            for (const space of spaces.values()) {
                if (!visible.get(space)) {
                    space.hide();
                }
            }

            Tweener.addTween(to.border, {
                opacity: 0,
                time: prefs.animation_time,
                onComplete: () => {
                    to.border.hide();
                    to.border.opacity = 255;
                }
            });
            to.clip.raise_top();

            // Fixes a weird bug where mouse input stops
            // working after mousing to another monitor on
            // X11.
            !Meta.is_wayland_compositor() && to.startAnimate();

            to.moveDone();
            callback && callback();
        };

        if (currentPreviewMode === PreviewMode.SEQUENTIAL) {
            this._animateToSpaceOrdered(to, true);
            let t = to.actor.get_transition('y');
            let time = GLib.get_monotonic_time();
            if (t) {
                t && t.connect('stopped', (t, finished) => {
                    finished && onComplete();
                });
            } else {
                // When switching between monitors there's no animation we can
                // connect to
                onComplete();
            }
            return;
        }

        this._updateMonitor();

        Tweener.addTween(to.actor,
                         { x: 0,
                           y: 0,
                           scale_x: 1,
                           scale_y: 1,
                           time: prefs.animation_time,
                           onComplete
                         });


        // Animate all the spaces above `to` down below the monitor. We get
        // these spaces by looking at siblings of upper most actor, ie. the
        // `clip`. This is done since `this.stack` is already updated.
        let above = to.clip.get_next_sibling();
        while (above) {
            let space = above.space;
            if (!visible.get(space)) {
                Tweener.addTween(space.actor,
                                 {x: 0, y: space.height + 20,
                                  time: prefs.animation_time });
            }
            above = above.get_next_sibling();
        }

    }

    _updateMonitor() {
        let monitorSpaces = this._getOrderedSpaces(this.selectedSpace.monitor);
        let currentMonitor = this.selectedSpace.monitor;
        monitorSpaces.forEach((space, i) => {
            space.setMonitor(currentMonitor, false);
        });
    }

    addSpace(workspace) {
        let space = new Space(workspace, this.spaceContainer, this._initDone);
        this.set(workspace, space);
        this.stack.push(space);
    };

    removeSpace(space) {
        this.delete(space.workspace);
        this.stack.splice(this.stack.indexOf(space), 1);
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
        let active = workspaceManager.get_active_workspace();
        out.push(this.get(active));
        seen.set(active, true);

        display.get_tab_list(Meta.TabList.NORMAL_ALL, null)
            .forEach((metaWindow, i) => {
                let workspace = metaWindow.get_workspace();
                if (!seen.get(workspace)) {
                    out.push(this.get(workspace));
                    seen.set(workspace, true);
                }
            });

        let workspaces = workspaceManager.get_n_workspaces();
        for (let i=0; i < workspaces; i++) {
            let workspace = workspaceManager.get_workspace_by_index(i);
            if (!seen.get(workspace)) {
                out.push(this.get(workspace));
                seen.set(workspace, true);
           }
        }

        return out;
    }

    window_created(display, metaWindow, user_data) {
        if (!registerWindow(metaWindow)) {
            return;
        }

        metaWindow.unmapped = true;

        debug('window-created', metaWindow.title);
        let actor = metaWindow.get_compositor_private();

        if (utils.version[1] < 34 || utils.version[1] >= 40) {
            animateWindow(metaWindow);
        } else {
            /* HACK 3.34: Hidden actors aren't allocated if hidden, use opacity
               instead to fix new window animations.

               The first draw will reset the opacity it seems (but not visible).
               So even if we set it again in `first-frame` that is too late
               since that happens _after_ mutter have drawn the frame.

               So we kill visibily on the first the `queue-redraw`.
            */
            signals.connectOneShot(actor, 'queue-redraw', () =>  {
                actor.opacity = 0;
            });
        }

        /*
          We need reliable `window_type`, `wm_class` et. all to handle window insertion correctly.

          On wayland this is completely broken before `first-frame`. It's
          somewhat more stable on X11, but there's at minimum some racing with
          `wm_class` which can break the users winprop rules.
        */
        signals.connectOneShot(actor, 'first-frame', () =>  {
            allocateClone(metaWindow);
            insertWindow(metaWindow, {existing: false});
        });
    };
}
Signals.addSignalMethods(Spaces.prototype);

function is_override_redirect(metaWindow) {
    // Note: is_overrride_redirect() seem to be false for all wayland windows
    const windowType = metaWindow.windowType;
    return (
        metaWindow.is_override_redirect()
            || windowType === Meta.WindowType.DROPDOWN_MENU
            || windowType === Meta.WindowType.TOOLTIP
    );
}

function registerWindow(metaWindow) {
    if (is_override_redirect(metaWindow)) {
        return false;
    }

    if (metaWindow.clone) {
        // Should no longer be possible, but leave a trace just to be sure
        utils.warn("window already registered", metaWindow.title);
        utils.print_stacktrace();
    }

    let actor = metaWindow.get_compositor_private();
    let cloneActor = new Clutter.Clone({source: actor});
    let clone = new Clutter.Actor();

    clone.add_actor(cloneActor);
    clone.targetX = 0;
    clone.meta_window = metaWindow;

    metaWindow.clone = clone;
    metaWindow.clone.cloneActor = cloneActor;

    signals.connect(metaWindow, "focus", focus_wrapper);
    signals.connect(metaWindow, 'size-changed', allocateClone);
    // Note: runs before gnome-shell's minimize handling code
    signals.connect(metaWindow, 'notify::fullscreen', TopBar.fixTopBar);
    signals.connect(metaWindow, 'notify::minimized', minimizeWrapper);
    signals.connect(actor, 'show', showWrapper);

    signals.connect(actor, 'destroy', destroyHandler);

    return true;
}

function allocateClone(metaWindow) {
    let frame = metaWindow.get_frame_rect();
    let buffer = metaWindow.get_buffer_rect();
    // Adjust the clone's origin to the north-west, so it will line up
    // with the frame.
    let clone = metaWindow.clone;
    let cloneActor = clone.cloneActor;
    cloneActor.set_position(buffer.x - frame.x,
                       buffer.y - frame.y);
    cloneActor.set_size(buffer.width, buffer.height);
    clone.set_size(frame.width, frame.height);

    if (metaWindow.clone.first_child.name === 'selection') {
        let selection = metaWindow.clone.first_child;
        let vMax = metaWindow.maximized_vertically;
        let hMax = metaWindow.maximized_horizontally;
        let protrusion = Math.round(prefs.window_gap/2);
        selection.x = hMax ? 0 : - protrusion;
        selection.y = vMax ? 0 : - protrusion;
        selection.set_size(frame.width + (hMax ? 0 : prefs.window_gap),
                           frame.height + (vMax ? 0 : prefs.window_gap));
    }
}

function destroyHandler(actor) {
    signals.disconnect(actor);
}

function resizeHandler(metaWindow) {
    if (inGrab && inGrab.window === metaWindow)
        return;

    print("resize-handler-width", metaWindow.get_frame_rect().width)
    // print("RESIZE\n", GLib.on_error_stack_trace(GLib.get_prgname()));

    let f = metaWindow.get_frame_rect();
    let needLayout = false;
    if (metaWindow._targetWidth !== f.width || metaWindow._targetHeight !== f.height) {
        needLayout = true;
    }
    metaWindow._targetWidth = null;
    metaWindow._targetHeight = null;

    let space = spaces.spaceOfWindow(metaWindow);
    if (space.indexOf(metaWindow) === -1)
        return;

    let selected = metaWindow === space.selectedWindow;

    if (!space._inLayout && needLayout) {
        // Restore window position when eg. exiting fullscreen
        !Navigator.navigating && selected
            && move_to(space, metaWindow, {
                x: metaWindow.get_frame_rect().x - space.monitor.x});

        // Resizing from within a size-changed signal is troube (#73). Queue instead.
        space.queueLayout();
    }
}

function enable(errorNotification) {
    debug('#enable');
    spaces = new Spaces();

    function initWorkspaces() {
        try {
            spaces.init();
        } catch(e) {
            log('#paperwm startup failed');
            log(`JS ERROR: ${e}\n${e.stack}`);
            errorNotification(
                "PaperWM",
                `Error occured in paperwm startup:\n\n${e.message}`,
                e.stack);
        }

        // Fix the stack overlay
        spaces.mru().reverse().forEach(s => {
            s.selectedWindow && ensureViewport(s.selectedWindow, s, true);
            s.monitor.clickOverlay.show();
        });
        TopBar.fixTopBar()
    }

    if (Main.layoutManager._startingUp) {
        // Defer workspace initialization until existing windows are accessible.
        // Otherwise we're unable to restore the tiling-order. (when restarting
        // gnome-shell)
        signals.connectOneShot(Main.layoutManager, 'startup-complete', initWorkspaces);
    } else {
        // NOTE: this needs to happen after kludges.enable() have run, so we do
        // it in a timeout
        imports.mainloop.timeout_add(0, initWorkspaces);
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
    if (meta_window.get_transient_for()) {
        // Never add transient windows
        return false;
    }
    if (meta_window.window_type !== Meta.WindowType.NORMAL) {
        // And only add Normal windows
        return false;
    }

    if (meta_window.is_on_all_workspaces()) {
        return false;
    }
    if (Scratch.isScratchWindow(meta_window)) {
        return false;
    }

    return true;
}


/**
   Handle windows leaving workspaces.
 */
function remove_handler(workspace, meta_window) {
    debug("window-removed", meta_window, meta_window.title, workspace.index());
    // Note: If `meta_window` was closed and had focus at the time, the next
    // window has already received the `focus` signal at this point.
    // Not sure if we can check directly if _this_ window had focus when closed.

    let space = spaces.spaceOf(workspace);
    space.removeWindow(meta_window);

    let actor = meta_window.get_compositor_private();
    if (!actor) {
        signals.disconnect(meta_window);
        if (meta_window.clone && meta_window.clone.mapped) {
            meta_window.clone.destroy();
            meta_window.clone = null;
        }
    }
}


/**
   Handle windows entering workspaces.
*/
function add_handler(ws, metaWindow) {
    debug("window-added", metaWindow, metaWindow.title, metaWindow.window_type, ws.index(), metaWindow.on_all_workspaces);

    // Do not handle grabbed windows
    if (inGrab && inGrab.window === metaWindow)
        return;

    let actor = metaWindow.get_compositor_private();
    if (actor) {
        // Set position and hookup signals, with `existing` set to true
        insertWindow(metaWindow, {existing: true && !metaWindow.redirected});
        delete metaWindow.redirected;
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

    // Add newly created windows to the space being previewed
    if (!existing &&
        !metaWindow.is_on_all_workspaces() &&
        metaWindow.get_workspace() !== spaces.selectedSpace.workspace) {
        metaWindow.redirected = true;
        metaWindow.change_workspace(spaces.selectedSpace.workspace);
        return;
    }

    let actor = metaWindow.get_compositor_private();

    let connectSizeChanged = (tiled) => {
        if (tiled)
            animateWindow(metaWindow);
        actor.opacity = 255;
        metaWindow.unmapped && signals.connect(metaWindow, 'size-changed', resizeHandler);
        delete metaWindow.unmapped;
    };

    if (!existing) {
        // Note: Can't trust global.display.focus_window to determine currently focused window.
        //       The mru is more flexible. (global.display.focus_window does not always agree with mru[0])
        let mru = display.get_tab_list(Meta.TabList.NORMAL_ALL, null);
        let focusWindow = mru[0];

        if (focusWindow === metaWindow) {
            focusWindow = mru[1];
        }

        let scratchIsFocused = Scratch.isScratchWindow(focusWindow);
        let addToScratch = scratchIsFocused;

        let winprop = Settings.find_winprop(metaWindow);
        if (winprop) {
            if (winprop.oneshot) {
                Settings.winprops.splice(Settings.winprops.indexOf(winprop), 1);
            }
            if (winprop.scratch_layer) {
                debug("#winprops", `Move ${metaWindow.title} to scratch`);
                addToScratch = true;
            }
            if (winprop.focus) {
                Main.activateWindow(metaWindow);
            }
        }

        if (addToScratch) {
            connectSizeChanged();
            Scratch.makeScratch(metaWindow);
            if (scratchIsFocused) {
                Main.activateWindow(metaWindow);
            }
            return;
        }
    }

    if (metaWindow.is_on_all_workspaces()) {
        // Only connect the necessary signals and show windows on shared
        // secondary monitors.
        connectSizeChanged();
        showWindow(metaWindow);
        return;
    } else if (Scratch.isScratchWindow(metaWindow)){
        // And make sure scratch windows are stuck
        Scratch.makeScratch(metaWindow);
        return;
    }

    let space = spaces.spaceOfWindow(metaWindow);
    if (!add_filter(metaWindow)) {
        connectSizeChanged();
        space.addFloating(metaWindow);
        // Make sure the window is on the correct monitor
        metaWindow.move_to_monitor(space.monitor.index);
        showWindow(metaWindow);
        // Make sure the window isn't hidden behind the space (eg. dialogs)
        !existing && metaWindow.make_above()
        return;
    }

    if (space.indexOf(metaWindow) !== -1)
        return;

    let clone = metaWindow.clone;
    let ok, x, y;
    // Figure out the matching coordinates before the clone is reparented.
    if (isWindowAnimating(metaWindow)) {
        let point = clone.apply_transform_to_point(new Clutter.Vertex({x: 0, y: 0}));
        [ok, x, y] = space.cloneContainer.transform_stage_point(point.x, point.y);
    } else {
        let frame = metaWindow.get_frame_rect();
        [ok, x, y] = space.cloneContainer.transform_stage_point(frame.x, frame.y);
    }
    ok && clone.set_position(x, y);

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
    space.layout();

    if (!existing) {
        actor.opacity = 0;
        clone.x = clone.targetX;
        clone.y = clone.targetY;
        clone.set_scale(0, 0);
        Tweener.addTween(clone, {
            scale_x: 1,
            scale_y: 1,
            time: prefs.animation_time,
            onStopped: () => {
                connectSizeChanged(true);
                space.layout();
            }
        });
    } else {
        animateWindow(metaWindow);
    }

    if (metaWindow === display.focus_window) {
        focus_handler(metaWindow);
    } else if (space.workspace === workspaceManager.get_active_workspace()) {
        Main.activateWindow(metaWindow);
    } else {
        ensureViewport(space.selectedWindow, space);
    }
}

function animateDown(metaWindow) {

    let space = spaces.spaceOfWindow(metaWindow);
    let workArea = space.workArea();
    let frame = metaWindow.get_frame_rect();
    let buffer = metaWindow.get_buffer_rect();
    let clone = metaWindow.clone;
    Tweener.addTween(metaWindow.clone, {
        y:  workArea.y,
        time: prefs.animation_time,
    });
}

function ensuredX(meta_window, space) {
    let index = space.indexOf(meta_window);
    let last = space.selectedWindow;
    let lastIndex = space.indexOf(last);
    let neighbour = Math.abs(lastIndex - index) <= 1;

    let monitor = space.monitor;
    let frame = meta_window.get_frame_rect();
    let buffer = meta_window.get_buffer_rect();
    let clone = meta_window.clone;

    let x;
    if (neighbour || space.isVisible(meta_window) || meta_window.lastFrame === undefined)
        x = Math.round(clone.targetX) + space.targetX;
    else
        x = meta_window.lastFrame.x - monitor.x;
    let gap = prefs.window_gap;
    let workArea = space.workArea();
    let min = workArea.x;
    let max = min + workArea.width;
    if (meta_window.fullscreen) {
        x = 0;
    } else if (index == 0 && x <= min) {
        // Always align the first window to the display's left edge
        x = min;
    } else if (index == space.length-1 && x + frame.width >= max) {
        // Always align the first window to the display's right edge
        x = max - frame.width;
    } else if (frame.width > workArea.width*0.9 - 2*(prefs.horizontal_margin + prefs.window_gap)) {
        // Consider the window to be wide and center it
        x = min + Math.round((workArea.width - frame.width)/2);

    } else if (x + frame.width > max) {
        // Align to the right prefs.horizontal_margin
        x = max - prefs.horizontal_margin - frame.width;
    } else if (x < min) {
        // Align to the left prefs.horizontal_margin
        x = min + prefs.horizontal_margin;
    } else if (x + frame.width === max) {
        // When opening new windows at the end, in the background, we want to
        // show some minimup margin
        x = max - prefs.minimum_margin - frame.width;
    } else if (x === min) {
        // Same for the start (though the case isn't as common)
        x = min + prefs.minimum_margin;
    }

    return x;
}


/**
   Make sure that `meta_window` is in view, scrolling the space if needed.
 */
function ensureViewport(meta_window, space, force) {
    space = space || spaces.spaceOfWindow(meta_window);

    let index = space.indexOf(meta_window);
    if (index === -1 || space.length === 0)
        return undefined;

    debug('Moving', meta_window.title);

    if (space.selectedWindow.fullscreen &&
        !meta_window.fullscreen) {
        animateDown(space.selectedWindow);
    }
    let x = ensuredX(meta_window, space);

    space.selectedWindow = meta_window;
    let selected = space.selectedWindow;
    let frame = meta_window.get_frame_rect();
    if (!inPreview && selected.fullscreen) {
        let y = 0;
        let ty = selected.clone.get_transition('y');
        if (!space.isVisible(selected)) {
            selected.clone.y = y;
        } else if (!ty || ty.get_interval().final !== y) {
            Tweener.addTween(selected.clone,
                             { y: y,
                               time: prefs.animation_time,
                               onComplete: space.moveDone.bind(space)
                             });
        }
    }
    move_to(space, meta_window, {
        x, force
    });

    selected.raise();
    selected.clone.raise_top();
    updateSelection(space, meta_window);
    space.emit('select');
}

function updateSelection(space, metaWindow) {
    let clone = metaWindow.clone;
    let cloneActor = clone.cloneActor;
    space.setSelectionActive();
    if (space.selection.get_parent() === clone)
        return;
    space.selection.reparent(clone);
    clone.set_child_below_sibling(space.selection, cloneActor);
    allocateClone(metaWindow);
}


/**
 * Move the column containing @meta_window to x, y and propagate the change
 * in @space. Coordinates are relative to monitor and y is optional.
 */
function move_to(space, metaWindow, { x, y, force, instant }) {
    if (space.indexOf(metaWindow) === -1)
        return;

    let clone = metaWindow.clone;
    let target = x - clone.targetX;
    if (target === space.targetX && !force) {
        space.moveDone();
        return;
    }

    space.targetX = target;

    if (Main.overview.visible) {
        // Do the move immediately, and let the overview take care of animation
        space.cloneContainer.x = target;
        space.moveDone();
        return;
    }

    space.startAnimate();
    Tweener.addTween(space.cloneContainer,
                     { x: target,
                       time: prefs.animation_time,
                       onComplete: space.moveDone.bind(space)
                     });

    space.fixOverlays(metaWindow);
}

var inGrab = false;
function grabBegin(metaWindow, type) {
    switch(type) {
        case Meta.GrabOp.COMPOSITOR:
        case Meta.GrabOp.FRAME_BUTTON:
            // Don't handle pushModal grabs and SCD button (close/minimize/etc.) grabs
            break;
        case Meta.GrabOp.KEYBOARD_MOVING:
            inGrab = new Extension.imports.grab.MoveGrab(metaWindow, type);

            if (inGrab.initialSpace.isFloating(metaWindow))
                return;

            // NOTE: Keyboard grab moves the cursor, but it happens after grab
            // signals have run. Simply delay the dnd so it will get the correct
            // pointer coordinates.
            Meta.later_add(Meta.LaterType.IDLE, () => {
                inGrab.begin();
                inGrab.beginDnD();
            })
            break;
        case Meta.GrabOp.MOVING:
            inGrab = new Extension.imports.grab.MoveGrab(metaWindow, type);

            if (utils.getModiferState() & Clutter.ModifierType.CONTROL_MASK) {
                inGrab.begin();
                inGrab.beginDnD();
            } else if (inGrab.initialSpace && inGrab.initialSpace.indexOf(metaWindow) > -1) {
                inGrab.begin();
            }

            break;
        case Meta.GrabOp.RESIZING_NW:
        case Meta.GrabOp.RESIZING_N:
        case Meta.GrabOp.RESIZING_NE:
        case Meta.GrabOp.RESIZING_E:
        case Meta.GrabOp.RESIZING_SW:
        case Meta.GrabOp.RESIZING_S:
        case Meta.GrabOp.RESIZING_SE:
        case Meta.GrabOp.RESIZING_W:
        case Meta.GrabOp.KEYBOARD_RESIZING_UNKNOWN:
        case Meta.GrabOp.KEYBOARD_RESIZING_NW:
        case Meta.GrabOp.KEYBOARD_RESIZING_N:
        case Meta.GrabOp.KEYBOARD_RESIZING_NE:
        case Meta.GrabOp.KEYBOARD_RESIZING_E:
        case Meta.GrabOp.KEYBOARD_RESIZING_SW:
        case Meta.GrabOp.KEYBOARD_RESIZING_S:
        case Meta.GrabOp.KEYBOARD_RESIZING_SE:
        case Meta.GrabOp.KEYBOARD_RESIZING_W:
            inGrab = new Extension.imports.grab.ResizeGrab(metaWindow, type);
            break;
    }
}

function grabEnd(metaWindow, type) {
    if (!inGrab || inGrab.dnd || inGrab.grabbed)
        return;

    inGrab.end();
    inGrab = false;
}

// `MetaWindow::focus` handling
function focus_handler(metaWindow, user_data) {
    debug("focus:", metaWindow.title, utils.framestr(metaWindow.get_frame_rect()));


    if (Scratch.isScratchWindow(metaWindow)) {
        spaces.get(workspaceManager.get_active_workspace()).setSelectionInactive();
        Scratch.makeScratch(metaWindow);
        TopBar.fixTopBar();
        return;
    }

    // If metaWindow is a transient window ensure the parent window instead
    let transientFor = metaWindow.get_transient_for();
    if (transientFor !== null) {
        metaWindow = transientFor;
    }

    let space = spaces.spaceOfWindow(metaWindow);
    space.monitor.clickOverlay.show();

    /**
       Find the closest neighbours. Remove any dead windows in the process to
       work around the fact that `focus` runs before `window-removed` (and there
       doesn't seem to be a better signal to use)
     */
    let windows = space.getWindows();
    let around = windows.indexOf(metaWindow);
    if (around === -1)
        return;

    let neighbours = [];
    for (let i=around - 1; i >= 0; i--) {
        let w = windows[i];
        if (w.get_compositor_private()) {
            neighbours.push(windows[i]);
            break;
        }
        space.removeWindow(w);
    }
    for (let i=around + 1; i < windows.length; i++) {
        let w = windows[i];
        if (w.get_compositor_private()) {
            neighbours.push(windows[i]);
            break;
        }
        space.removeWindow(w);
    }

    /**
       We need to stack windows in mru order, since mutter picks from the
       stack, not the mru, when auto choosing focus after closing a window.
    */
    let stack = sortWindows(space, neighbours);
    stack.forEach(w => w.raise());
    metaWindow.raise();

    ensureViewport(metaWindow, space);
    TopBar.fixTopBar();
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

/**
  `WindowActor::show` handling

  Kill any falsely shown WindowActor.
*/
function showHandler(actor) {
    let metaWindow = actor.meta_window;
    let onActive = metaWindow.get_workspace() === workspaceManager.get_active_workspace();

    if (!metaWindow.clone.get_parent() && !metaWindow.unmapped)
        return;

    // HACK: use opacity instead of hidden on new windows
    if (metaWindow.unmapped) {
        if (utils.version[1] < 34)
            animateWindow(metaWindow);
        else
            actor.opacity = 0;
        return;
    }

    if (!onActive
        || isWindowAnimating(metaWindow)
        // The built-in workspace-change animation is running: suppress it
        || actor.get_parent() !== global.window_group
       ) {
        animateWindow(metaWindow);
    }
}
var showWrapper = utils.dynamic_function_ref('showHandler', Me);

function showWindow(metaWindow) {
    let actor = metaWindow.get_compositor_private();
    if (!actor)
        return false;
    metaWindow.clone.cloneActor.hide();
    metaWindow.clone.cloneActor.source = null;
    actor.show();
    return true;
}

function animateWindow(metaWindow) {
    let actor = metaWindow.get_compositor_private();
    if (!actor)
        return false;
    metaWindow.clone.cloneActor.show();
    metaWindow.clone.cloneActor.source = actor;
    actor.hide();
    return true;
}

function isWindowAnimating(metaWindow) {
    let clone = metaWindow.clone;
    return clone.get_parent() && clone.cloneActor.visible;
}

function toggleMaximizeHorizontally(metaWindow) {
    metaWindow = metaWindow || display.focus_window;

    if (metaWindow.get_maximized() === Meta.MaximizeFlags.BOTH) {
        // ASSUMPTION: MaximizeFlags.HORIZONTALLY is not used
        metaWindow.unmaximize(Meta.MaximizeFlags.BOTH);
        metaWindow.unmaximizedRect = null;
        return;
    }

    let space = spaces.spaceOfWindow(metaWindow);
    let workArea = space.workArea();
    let frame = metaWindow.get_frame_rect();
    let reqWidth = workArea.width - prefs.minimum_margin*2;

    // Some windows only resize in increments > 1px so we can't rely on a precise width
    // Hopefully this heuristic is good enough
    let isFullWidth = (reqWidth - frame.width) < sizeSlack;

    if (isFullWidth && metaWindow.unmaximizedRect) {
        let unmaximizedRect = metaWindow.unmaximizedRect;
        metaWindow.move_resize_frame(
            true, unmaximizedRect.x, frame.y,
            unmaximizedRect.width, frame.height);

        metaWindow.unmaximizedRect = null;
    } else {
        let x = workArea.x + space.monitor.x + prefs.minimum_margin;
        metaWindow.unmaximizedRect = frame;
        metaWindow.move_resize_frame(true, x, frame.y, workArea.width - prefs.minimum_margin*2, frame.height);
    }
}

function resizeHInc(metaWindow) {
    let frame = metaWindow.get_frame_rect();
    let monitor = Main.layoutManager.monitors[metaWindow.get_monitor()];
    let space = spaces.spaceOfWindow(metaWindow);
    let workArea = space.workArea();

    let maxHeight = workArea.height - prefs.horizontal_margin*2 - prefs.window_gap;
    let step = Math.floor(maxHeight * 0.1)
    let currentHeight = Math.floor(frame.height/step)*step;
    let targetHeight = Math.min(currentHeight + step, maxHeight);
    let targetY = frame.y;

    if (metaWindow.get_maximized() === Meta.MaximizeFlags.BOTH) {
        metaWindow.unmaximize(Meta.MaximizeFlags.BOTH);
    }

    // Space.layout will ensure the window is moved if necessary
    metaWindow.move_resize_frame(true, frame.x, targetY, frame.width, targetHeight);
}

function resizeHDec(metaWindow) {
    let frame = metaWindow.get_frame_rect();
    let monitor = Main.layoutManager.monitors[metaWindow.get_monitor()];
    let space = spaces.spaceOfWindow(metaWindow);
    let workArea = space.workArea();

    let maxHeight = workArea.height - prefs.horizontal_margin*2 - prefs.window_gap;
    let step = Math.floor(maxHeight * 0.1);
    let currentHeight = Math.floor(frame.height/step)*step;
    let minHeight = step;
    let targetHeight = Math.max(currentHeight - step, minHeight);
    let targetY = frame.y;

    if (metaWindow.get_maximized() === Meta.MaximizeFlags.BOTH) {
        metaWindow.unmaximize(Meta.MaximizeFlags.BOTH);
    }

    // Space.layout will ensure the window is moved if necessary
    metaWindow.move_resize_frame(true, frame.x, targetY, frame.width, targetHeight);
}

function resizeWInc(metaWindow) {
    let frame = metaWindow.get_frame_rect();
    let monitor = Main.layoutManager.monitors[metaWindow.get_monitor()];
    let space = spaces.spaceOfWindow(metaWindow);
    let workArea = space.workArea();

    let maxWidth = workArea.width - prefs.horizontal_margin*2 - prefs.window_gap;
    let step = Math.floor(maxWidth * 0.1);
    let currentWidth = Math.floor(frame.width/step)*step;
    let targetWidth = Math.min(currentWidth + step, maxWidth);
    let targetX = frame.x;

    if (metaWindow.get_maximized() === Meta.MaximizeFlags.BOTH) {
        metaWindow.unmaximize(Meta.MaximizeFlags.BOTH);
    }

    // Space.layout will ensure the window is moved if necessary
    metaWindow.move_resize_frame(true, targetX, frame.y, targetWidth, frame.height);
}

function resizeWDec(metaWindow) {
    let frame = metaWindow.get_frame_rect();
    let monitor = Main.layoutManager.monitors[metaWindow.get_monitor()];
    let space = spaces.spaceOfWindow(metaWindow);
    let workArea = space.workArea();

    let maxWidth = workArea.width - prefs.horizontal_margin*2 - prefs.window_gap;
    let step = Math.floor(maxWidth * 0.1);
    let currentWidth = Math.floor(frame.width/step)*step;
    let minWidth = step;
    let targetWidth = Math.max(currentWidth - step, minWidth);
    let targetX = frame.x;

    if (metaWindow.get_maximized() === Meta.MaximizeFlags.BOTH) {
        metaWindow.unmaximize(Meta.MaximizeFlags.BOTH);
    }

    // Space.layout will ensure the window is moved if necessary
    metaWindow.move_resize_frame(true, targetX, frame.y, targetWidth, frame.height);
}

function cycleWindowWidth(metaWindow) {
    let steps = prefs.cycle_width_steps;

    let frame = metaWindow.get_frame_rect();
    let monitor = Main.layoutManager.monitors[metaWindow.get_monitor()];
    let space = spaces.spaceOfWindow(metaWindow);
    let workArea = space.workArea();
    workArea.x += space.monitor.x;

    if (steps[0] <= 1) {
        // Steps are specifed as ratios -> convert to pixels
        // Make sure two windows of "compatible" width will have room:
        let availableWidth = workArea.width - prefs.horizontal_margin*2 - prefs.window_gap;
        steps = steps.map(x => Math.floor(x*availableWidth));
    }

    // 10px slack to avoid locking up windows that only resize in increments > 1px
    let targetWidth = Math.min(utils.findNext(frame.width, steps, sizeSlack), workArea.width);
    let targetX = frame.x;

    if (Scratch.isScratchWindow(metaWindow)) {
        if (targetX+targetWidth > workArea.x + workArea.width - prefs.minimum_margin) {
            // Move the window so it remains fully visible
            targetX = workArea.x + workArea.width - prefs.minimum_margin - targetWidth;
        }
    }

    if (metaWindow.get_maximized() === Meta.MaximizeFlags.BOTH) {
        metaWindow.unmaximize(Meta.MaximizeFlags.BOTH);
    }

    // Space.layout will ensure the window is moved if necessary
    metaWindow.move_resize_frame(true, targetX, frame.y, targetWidth, frame.height);
}

function cycleWindowHeight(metaWindow) {
    let steps = prefs.cycle_height_steps;
    let frame = metaWindow.get_frame_rect();

    let space = spaces.spaceOfWindow(metaWindow);
    let i = space.indexOf(metaWindow);

    function calcTargetHeight(available) {
        let targetHeight;
        if (steps[0] <= 1) { // ratio steps
            let targetR = utils.findNext(frame.height/available, steps, sizeSlack/available);
            targetHeight = Math.floor(targetR * available);
        } else { // pixel steps
            targetHeight = utils.findNext(frame.height, steps, sizeSlack);
        }
        return Math.min(targetHeight, available);
    }

    if (i > -1) {
        function allocate(column, available) {
            // NB: important to not retrieve the frame size inside allocate. Allocation of
            // metaWindow should stay the same during a potential fixpoint evaluation.
            available -= (column.length - 1) * prefs.window_gap;
            let targetHeight = calcTargetHeight(available);
            return column.map(mw => {
                if (mw === metaWindow) {
                    return targetHeight;
                } else {
                    return Math.floor((available - targetHeight) / (column.length-1));
                }
            });
        }

        if (space[i].length > 1) {
            space.layout(false, {customAllocators: {[i]: allocate}});
        }
    } else {
        // Not in tiling
        let workspace = metaWindow.get_workspace();
        let available = workspace.get_work_area_for_monitor(metaWindow.get_monitor()).height;
        let targetHeight = calcTargetHeight(available);
        metaWindow.move_resize_frame(true, frame.x, frame.y, frame.width, targetHeight);
    }
}

function activateNthWindow(n, space) {
    space = space || spaces.spaceOf(workspaceManager.get_active_workspace());
    let nth = space[n][0];
    ensureViewport(nth, space);
}

function activateFirstWindow(mw, space) {
    space = space || spaces.spaceOf(workspaceManager.get_active_workspace());
    activateNthWindow(0, space);
}

function activateLastWindow(mw, space) {
    space = space || spaces.spaceOf(workspaceManager.get_active_workspace());
    activateNthWindow(space.length - 1, space);
}

function centerWindowHorizontally(metaWindow) {
    const frame = metaWindow.get_frame_rect();
    const space = spaces.spaceOfWindow(metaWindow);
    const monitor = space.monitor;
    const workArea = space.workArea();
    const targetX = workArea.x + Math.round(workArea.width/2 - frame.width/2);
    const dx = targetX - (metaWindow.clone.targetX + space.targetX);

    let [pointerX, pointerY, mask] = global.get_pointer();
    let relPointerX = pointerX - monitor.x - space.cloneContainer.x;
    let relPointerY = pointerY - monitor.y - space.cloneContainer.y;
    if (utils.isPointInsideActor(metaWindow.clone, relPointerX, relPointerY)) {
        utils.warpPointer(pointerX + dx, pointerY)
    }
    if (space.indexOf(metaWindow) === -1) {
        metaWindow.move_frame(true, targetX + monitor.x, frame.y);
    } else {
        move_to(space, metaWindow, { x: targetX,
                                     onComplete: () => space.moveDone()});
    }
}

/**
 * "Fit" values such that they sum to `targetSum`
 */
function fitProportionally(values, targetSum) {
    let sum = utils.sum(values);
    let weights = values.map(v => v / sum);

    let fitted = utils.zip(values, weights).map(
        ([h, w]) => Math.round(targetSum * w)
    )
    let r = targetSum - utils.sum(fitted);
    fitted[0] += r;
    return fitted;
}

function allocateDefault(column, availableHeight, selectedWindow) {
    if (column.length === 1) {
        return [availableHeight];
    } else {
        // Distribute available height amongst non-selected windows in proportion to their existing height
        const gap = prefs.window_gap;
        const minHeight = 50;

        function heightOf(mw) {
            return mw._targetHeight || mw.get_frame_rect().height;
        }

        const k = selectedWindow && column.indexOf(selectedWindow);
        const selectedHeight = selectedWindow && heightOf(selectedWindow);

        let nonSelected = column.slice();
        if (selectedWindow) nonSelected.splice(k, 1)

        const nonSelectedHeights = nonSelected.map(heightOf);
        let availableForNonSelected = Math.max(
            0,
            availableHeight
                - (column.length-1) * gap
                - (selectedWindow ? selectedHeight : 0)
        );

        const deficit = Math.max(
            0, nonSelected.length * minHeight - availableForNonSelected);

        let heights = fitProportionally(
            nonSelectedHeights,
            availableForNonSelected + deficit
        );

        if (selectedWindow)
            heights.splice(k, 0, selectedHeight - deficit);

        return heights
    }
}

function allocateEqualHeight(column, available) {
    available = available - (column.length-1)*prefs.window_gap;
    return column.map(_ => Math.floor(available / column.length));
}

/*
* pull in the top window from the column to the right. if there is no
* column to the right, push active window into column to the left.
* this allows freshly created windows to be stacked without
* having to change focus
*/
function slurp(metaWindow) {
    let space = spaces.spaceOfWindow(metaWindow);
    let index = space.indexOf(metaWindow);

    let to, from;
    let metaWindowToEnsure = space.selectedWindow;
    let metaWindowToSlurp;

    if (index + 1 < space.length) {
        to = index;
        from = to + 1;
        metaWindowToSlurp = space[from][0];
    } else if (index + 1 === space.length){
        if(space[index].length > 1) return;
        metaWindowToSlurp = metaWindow;
        metaWindowToEnsure = metaWindowToSlurp;
        to = index - 1;
        from = index;
    }

    if(!metaWindowToSlurp || space.length < 2) {
        return;
    }

    space[to].push(metaWindowToSlurp)

    { // Remove the slurped window
        let column = space[from];
        let row = column.indexOf(metaWindowToSlurp);
        column.splice(row, 1);
        if (column.length === 0)
            space.splice(from, 1);
    }

    space.layout(true, {
        customAllocators: { [to]: allocateEqualHeight }
    });
    space.emit("full-layout");
    ensureViewport(metaWindowToEnsure, space, true);
}

function barf(metaWindow) {
    let space = spaces.spaceOfWindow(metaWindow);
    let index = space.indexOf(metaWindow);
    if (index === -1)
        return;

    let column = space[index];
    if (column.length < 2)
        return;

    let bottom = column.splice(-1, 1)[0];
    space.splice(index + 1, 0, [bottom]);

    space.layout(true, {
        customAllocators: { [index]: allocateEqualHeight }
    })
    space.emit("full-layout")
    ensureViewport(space.selectedWindow, space, true);
}

function selectPreviousSpace(mw, space) {
    spaces.selectStackSpace(Meta.MotionDirection.DOWN);
}

function selectPreviousSpaceBackwards(mw, space) {
    spaces.selectStackSpace(Meta.MotionDirection.UP);
}

function movePreviousSpace(mw, space) {
    spaces.selectStackSpace(Meta.MotionDirection.DOWN, true);
}

function movePreviousSpaceBackwards(mw, space) {
    spaces.selectStackSpace(Meta.MotionDirection.UP, true);
}

function selectDownSpace(mw, space) {
    spaces.selectSequenceSpace(Meta.MotionDirection.DOWN);
}

function selectUpSpace(mw, space) {
    spaces.selectSequenceSpace(Meta.MotionDirection.UP);
}

function moveDownSpace(mw, space) {
    spaces.selectSequenceSpace(Meta.MotionDirection.DOWN, true);
}

function moveUpSpace(mw, space) {
    spaces.selectSequenceSpace(Meta.MotionDirection.UP, true);
}


/**
   Detach the @metaWindow, storing it at the bottom right corner while
   navigating. When done, insert all the detached windows again.
 */
function takeWindow(metaWindow, space, {navigator}) {
    space = space || spaces.selectedSpace;
    metaWindow = metaWindow || space.selectedWindow;
    navigator = navigator || Navigator.getNavigator();
    if (!space.removeWindow(metaWindow))
        return;

    if (!navigator._moving) {
        navigator._moving = [];
        let id = navigator.connect('destroy', () => {
            navigator.disconnect(id);
            let space = spaces.selectedSpace;
            navigator._moving.reverse().forEach(w => {
                w.change_workspace(space.workspace);
                if (w.get_workspace() === space.workspace) {
                    insertWindow(w, {existing: true});
                }
            });
        });
    }

    navigator._moving.push(metaWindow);
    let parent = backgroundGroup;
    let actor = metaWindow.get_compositor_private();
    parent.add_actor(metaWindow.clone);
    let lowest = navigator._moving[navigator._moving.length - 2];
    lowest && parent.set_child_below_sibling(metaWindow.clone, lowest.clone);
    let point = space.cloneContainer.apply_relative_transform_to_point(
        parent, new Clutter.Vertex({x: metaWindow.clone.x,
                                             y: metaWindow.clone.y}));
    metaWindow.clone.set_position(point.x, point.y);
    let x = Math.round(space.monitor.x +
                       space.monitor.width -
                       (0.1*space.monitor.width*(1 +navigator._moving.length)));
    let y = Math.round(space.monitor.y + space.monitor.height*2/3)
        + 20*navigator._moving.length;
    animateWindow(metaWindow);
    Tweener.addTween(metaWindow.clone,
                     {x, y,
                      time: prefs.animation_time,
                     });
}

/**
   Sort the @windows based on their clone's stacking order
   in @space.cloneContainer.
 */
function sortWindows(space, windows) {
    if (windows.length === 1)
        return windows;
    let clones = windows.map(w => w.clone);
    return space.cloneContainer.get_children()
        .filter(c => clones.includes(c))
        .map(c => c.meta_window);
}

function rotated(list, dir=1) {
    return [].concat(
        list.slice(dir),
        list.slice(0, dir)
    );
}

function cycleWorkspaceSettings(dir=1) {
    let n = workspaceManager.get_n_workspaces();
    let N = Settings.workspaceList.get_strv('list').length;
    let space = spaces.selectedSpace;
    let wsI = space.workspace.index();

    // 2 6 7 8   <-- indices
    // x a b c   <-- settings
    // a b c x   <-- rotated settings

    let uuids = Settings.workspaceList.get_strv('list');
    // Work on tuples of [uuid, settings] since we need to uuid association
    // in the last step
    let settings = uuids.map(
        uuid => [uuid, Settings.getWorkspaceSettingsByUUID(uuid)]
    );
    settings.sort((a, b) => a[1].get_int('index') - b[1].get_int('index'));

    let unbound = settings.slice(n);
    let strip = [settings[wsI]].concat(unbound);

    strip = rotated(strip, dir);

    let nextSettings = strip[0];
    unbound = strip.slice(1);

    nextSettings[1].set_int('index', wsI);
    space.setSettings(nextSettings); // ASSUMPTION: ok that two settings have same index here

    // Re-assign unbound indices:
    for (let i = n; i < N; i++) {
        unbound[i-n][1].set_int('index', i);
    }
    return space;
}


// Backward compatibility
function defwinprop(...args) {
    return Settings.defwinprop(...args);
}
