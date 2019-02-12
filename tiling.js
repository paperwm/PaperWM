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

var workspaceManager = global.workspace_manager;
var display = global.display;

var spaces;

var Minimap = Extension.imports.minimap;
var Scratch = Extension.imports.scratch;
var TopBar = Extension.imports.topbar;
var Navigator = Extension.imports.navigator;
var ClickOverlay = Extension.imports.stackoverlay.ClickOverlay;
var Settings = Extension.imports.settings;
var Me = Extension.imports.tiling;

var prefs = Settings.prefs;

// Mutter prevints windows from being placed further off the screen than 75 pixels.
var stack_margin = 75;
// Minimum margin
var minimumMargin = 15;

var panelBox = Main.layoutManager.panelBox;

var inPreview = false;

var signals, oldSpaces, backgroundGroup, oldMonitors, WindowCloneLayout,
    grabSignals;
function init() {
    // Symbol to retrieve the focus handler id
    signals = new utils.Signals();
    grabSignals = new utils.Signals();
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
   spanning the whole global.workspaceManager

   An @actor to hold everything that's visible, it contains a @background,
   a @label and a @cloneContainer.

   The @background is sized somewhat larger than the monitor, with the top left
   and right corners rounded. It's positioned slightly above the monitor so the
   corners aren't visible when the space is active.

   The @cloneContainer holds clones of all the tiled windows, it's clipped
   by @cloneClip to avoid protruding into neighbouringing monitors.

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
 */
class Space extends Array {
    constructor (workspace, container) {
        super(0);
        this.workspace = workspace;
        this.signals = new utils.Signals();

        // The windows that should be represented by their WindowActor
        this.visible = [];
        this._floating = [];
        this._populated = false;

        let clip = new Clutter.Actor();
        this.clip = clip;
        let actor = new Clutter.Actor();
        actor.hide(); // We keep the space actor hidden when inactive due to performance
        this.actor = actor;
        let cloneClip = new Clutter.Actor();
        this.cloneClip = cloneClip;
        let cloneContainer = new St.Widget();
        this.cloneContainer = cloneContainer;

        let meta_display = global.screen ?
            { meta_screen: global.screen } :
            { meta_display: display };

        const GDesktopEnums = imports.gi.GDesktopEnums;
        let metaBackground = new Meta.Background(meta_display);
        let background = new Meta.BackgroundActor(
            Object.assign({
                monitor: 0, background: metaBackground,
                reactive: true // Disable the background menu
            }, meta_display)
        );

        // This kills all mouse input on X11, but works on wayland
        if (Meta.is_wayland_compositor()) {
            Main.layoutManager.trackChrome(background);
        }

        this.signals.connect(
            background, 'button-press-event',
            (actor, event) => {
                let [aX, aY, mask] = global.get_pointer();
                let [ok, x, y] =
                    this.actor.transform_stage_point(aX, aY);
                let windowAtPoint = this.getWindowAtPoint(x, y);
                // FIXME: Fix interaction with swiping and remove guard
                if (!inPreview && Meta.is_wayland_compositor())
                    return;
                let nav = Navigator.getNavigator();
                if (windowAtPoint)
                    ensureViewport(windowAtPoint, this);
                spaces.selectedSpace = this;
                nav.finish();
            });

            this.signals.connect(
                background, 'captured-event',
                Extension.imports.gestures.horizontalScroll.bind(this));

        this.background = background;
        this.shadow = new St.Widget();;
        this.shadow.set_style(
            `background: black;
             box-shadow: 0px -4px 8px 0 rgba(0, 0, 0, .5);`);

        let label = new St.Label();
        this.label = label;
        label.set_style('font-weight: bold; font-feature-settings: "tnum";');
        label.hide();

        let selection = new St.Widget({name: 'selection',
                                       style_class: 'tile-preview'});
        this.selection = selection;

        clip.space = this;
        cloneContainer.space = this;

        container.add_actor(clip);
        clip.add_actor(actor);
        actor.add_actor(this.shadow);
        this.shadow.add_actor(background);
        actor.add_actor(label);
        actor.add_actor(cloneClip);
        cloneClip.add_actor(cloneContainer);

        container.set_child_below_sibling(clip,
                                          container.first_child);

        let monitor = Main.layoutManager.primaryMonitor;
        let oldSpace = oldSpaces.get(workspace);
        this.targetX = 0;
        if (oldSpace) {
            let oldMonitor = Main.layoutManager.monitors[oldSpace.monitor.index];
            if (oldMonitor)
                monitor = oldMonitor;
        }
        this.setMonitor(monitor, false);

        this.setSettings(Settings.getWorkspaceSettings(this.workspace.index()));

        actor.set_pivot_point(0.5, 0);

        this.shadow.set_position(-8 - Math.round(prefs.window_gap/2), -4);

        this.selectedWindow = null;
        this.leftStack = 0; // not implemented
        this.rightStack = 0; // not implemented

    }

    init() {
        let workspace = this.workspace;
        let oldSpace = oldSpaces.get(workspace);

        this.addAll(oldSpace);
        oldSpaces.delete(workspace);
        this._populated = true;
        // FIXME: this prevents bad old values propagating
        // Though, targetX shouldn't ideally be able to get into this state.
        if (oldSpace && Number.isFinite(oldSpace.targetX)) {
            this.targetX = oldSpace.targetX;
            this.cloneContainer.x = this.targetX;
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
        targetWidth = f.width;

        const H1 = (f.y - y0) - gap - (k-1)*gap;
        const H2 = availableHeight - (f.y + f.height - y0) - gap - (column.length-k-2)*gap;
        k > 0 && mosh(column.slice(0, k), H1, y0);
        let y = mosh(column.slice(k, k+1), f.height, f.y);
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
                Tweener.addTween(c, {
                    x, y,
                    time,
                    transition: 'easeInOutQuad',
                });
            }

            y += targetHeight + prefs.window_gap;
        }
        return [targetWidth, widthChanged || heightChanged, y];
    }


    layout(animate = true, options={}) {
        // Guard against recursively calling layout
        if (this._inLayout)
            return;
        this._inLayout = true;
        this.startAnimate();

        let time = animate ? prefs.animation_time : 0;
        let gap = prefs.window_gap;
        let x = 0;
        let selectedIndex = this.selectedIndex();
        let availableHeight = (this.height - panelBox.height - prefs.vertical_margin)
        let y0 = panelBox.height + prefs.vertical_margin;
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
            targetWidth = Math.min(targetWidth, this.width - 2*minimumMargin);

            let resultingWidth, relayout;
            if (inGrab && i === selectedIndex) {
                [resultingWidth, relayout] =
                    this.layoutGrabColumn(column, x, y0, targetWidth, availableHeight, time,
                                          selectedInColumn);
            } else {
                let allocator = options.customAllocators && options.customAllocators[i];
                allocator = allocator || allocateDefault;

                let targetHeights = allocator(column, availableHeight, selectedInColumn);
                [resultingWidth, relayout] =
                    this.layoutColumnSimple(column, x, y0, targetWidth, targetHeights, time);
            }

            if (relayout) {
                if (fixPointAttempCount < 5) {
                    log("Trying to find layout fixpoint", fixPointAttempCount+1)
                    i--;
                    fixPointAttempCount++;
                    continue;
                } else {
                    log("Bail at fixpoint, max tries reached")
                }
            }

            x += resultingWidth + gap;
        }
        this._inLayout = false;

        // transforms break on width 1
        let width = Math.max(1, x - gap);
        this.cloneContainer.width = width;
        let workArea = Main.layoutManager.getWorkAreaForMonitor(this.monitor.index);
        if (width < workArea.width) {
            this.targetX = workArea.x + Math.round((workArea.width - width)/2);
        }
        if (animate) {
            Tweener.addTween(this.cloneContainer,
                             { x: this.targetX,
                               time: prefs.animation_time,
                               transition: 'easeInOutQuad',
                               onComplete: this.moveDone.bind(this)
                             });
            ensureViewport(this.selectedWindow, this);
        }
    }

    isPlaceable(metaWindow) {
        let clone = metaWindow.clone;
        let x = clone.targetX + this.targetX;
        let workArea = Main.layoutManager.getWorkAreaForMonitor(this.monitor.index);

        if (x + clone.width < workArea.x + stack_margin
            || x > workArea.x + workArea.width - stack_margin) {
            return false;
        } else {
            // Fullscreen windows are only placeable on the monitor origin
            if ((metaWindow.get_maximized() === Meta.MaximizeFlags.BOTH && x !== workArea.x - this.monitor.x) ||
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
        let wX = clone.targetX + this.cloneContainer.x;
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

        metaWindow.clone.reparent(this.cloneContainer);

        this._populated && this.layout();
        this.emit('window-added', metaWindow, index, row);
        return true;
    }

    removeWindow(metaWindow) {
        let index = this.indexOf(metaWindow);
        if (index === -1)
            return this.removeFloating(metaWindow);

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

    addFloating(metaWindow) {
        if (this._floating.indexOf(metaWindow) !== -1 ||
            metaWindow.is_on_all_workspaces())
            return false;
        this._floating.push(metaWindow);
        let clone = metaWindow.clone;
        clone.reparent(this.actor);
        showWindow(metaWindow);
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

    moveDone() {
        if (this.cloneContainer.x !== this.targetX ||
            this.actor.y !== 0 ||
            Navigator.navigating || inPreview || inGrab ||
            Main.overview.visible) {
            return;
        }

        this.visible = [];
        const monitor = this.monitor;
        this.getWindows().forEach(w => {
            if (!w.get_compositor_private())
                return;

            if (this.isPlaceable(w))
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
            let x = monitor.x + Math.round(clone.x) + this.targetX;
            let y = monitor.y + Math.round(clone.y);
            let f = w.get_frame_rect();
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
            const x = Math.max(0, monitor.x - b.x);
            const y = Math.max(0, monitor.y - b.y);
            const cw = b.width - x
                  - Math.max(0, (b.x + b.width) - (monitor.x + monitor.width));
            const ch = actor.height - y
                  - Math.max(0, (b.y + b.height) - (monitor.y + monitor.height));
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
        this.updateColor();
        this.updateBackground();
        this.updateName();
        this.signals.connect(this.settings, 'changed::name',
                             this.updateName.bind(this));
        this.signals.connect(this.settings, 'changed::color',
                             this.updateColor.bind(this));
        this.signals.connect(this.settings, 'changed::background',
                             this.updateBackground.bind(this));
    }

    updateColor() {
        let color = this.settings.get_string('color');
        if (color === '') {
            let colors = prefs.workspace_colors;
            let index = this.workspace.index() % prefs.workspace_colors.length;
            color = colors[index];
        }
        this.color = color;
        this.background.background.set_color(Clutter.color_from_string(color)[1]);
    }

    updateBackground() {
        let path = this.settings.get_string('background') || prefs.default_background;
        let file = Gio.File.new_for_path(path);
        const BackgroundStyle = imports.gi.GDesktopEnums.BackgroundStyle;
        let style = BackgroundStyle.ZOOM;
        if (path === '' || !file.query_exists(null)) {
            file = Gio.File.new_for_uri('resource:///org/gnome/shell/theme/noise-texture.png');
            style = BackgroundStyle.WALLPAPER;
        }
        this.background.background.set_file(file, style);
    }

    updateName() {
        let name = this.settings.get_string('name');
        if (name === '')
            name = Meta.prefs_get_workspace_name(this.workspace.index());
        Meta.prefs_change_workspace_name(this.workspace.index(), name);
        this.label.text = name;
        this.name = name;

        if (this.workspace === workspaceManager.get_active_workspace()) {
            TopBar.setWorkspaceName(this.name);
        }
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

        this.shadow.set_size(monitor.width + 8*2 + prefs.window_gap,
                             monitor.height + 4 + prefs.window_gap);
        background.set_size(this.shadow.width, this.shadow.height);

        this.cloneClip.set_size(monitor.width, monitor.height);
        this.cloneClip.set_clip(-Math.round(prefs.window_gap/2), 0,
                                monitor.width + prefs.window_gap, this.shadow.height);
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
        this.cloneContainer.destroy();
        this.clip.destroy();
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

        this.clickOverlays = [];
        this.signals = new utils.Signals();
        this.stack = [];
        let spaceContainer = new Clutter.Actor({name: 'spaceContainer'});
        spaceContainer.hide();
        this.spaceContainer = spaceContainer;

        backgroundGroup.add_actor(spaceContainer);
        backgroundGroup.set_child_above_sibling(
            spaceContainer,
            backgroundGroup.last_child);

        // Hook up existing workspaces
        for (let i=0; i < workspaceManager.n_workspaces; i++) {
            let workspace = workspaceManager.get_workspace_by_index(i);
            this.addSpace(workspace);
            debug("workspace", workspace)
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
        this.signals.connect(workspaceManager, 'notify::n-workspaces',
                        utils.dynamic_function_ref('workspacesChanged', this).bind(this));
        // this.signals.connect(workspaceManager, 'workspace-removed',
        //                 utils.dynamic_function_ref('workspaceRemoved', this));
        this.signals.connect(global.screen || display,
                        'window-left-monitor',
                        this.windowLeftMonitor.bind(this));
        this.signals.connect(global.screen || display,
                        "window-entered-monitor",
                        this.windowEnteredMonitor.bind(this));

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
                allocateClone(w.get_compositor_private());
                this.signals.connect(w, 'size-changed', resizeHandler);
            });

        this.forEach(space => space.init());

        // Redo the stack
        this.monitorsChanged(); // Necessary for X11
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
        let mru = this.mru();
        let primary = Main.layoutManager.primaryMonitor;
        let monitors = Main.layoutManager.monitors;

        let finish = () => {
            let activeSpace = this.get(workspaceManager.get_active_workspace());
            let visible = monitors.map(m => this.monitors.get(m));
            let mru = this.mru();
            this.selectedSpace = mru[0];
            this.monitors.set(activeSpace.monitor, activeSpace);
            for (let [monitor, space] of this.monitors) {
                space.actor.show();
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
                space.setMonitor(monitor, false);
                mru = mru.filter(s => s !== space);
            }
            oldMonitors.delete(oldMonitor);
        }

        // Populate any remaining monitors
        for (let monitor of monitors) {
            if (this.monitors.get(monitor) === undefined) {
                let space = mru[0];
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

                if (metaWindow.clone)
                    metaWindow.clone.destroy();

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

        for (let [workspace, space] of this) {
            if (workspaces[space.workspace] !== true) {
                debug('workspace removed', space.workspace);
                this.removeSpace(space);
            }
        }
    };

    workspaceRemoved(workspaceManager, index) {
        let settings = new Gio.Settings({ schema_id:
                                          'org.gnome.desktop.wm.preferences'});
        let names = settings.get_strv('workspace-names');

        // Move removed workspace name to the end. Could've simply removed it
        // too, but this way it's not lost. In the future we want a UI to select
        // old names when selecting a new workspace.
        names = names.slice(0, index).concat(names.slice(index+1), [names[index]]);
        settings.set_strv('workspace-names', names);
    };

    switchWorkspace(wm, fromIndex, toIndex) {
        let to = workspaceManager.get_workspace_by_index(toIndex);
        let from = workspaceManager.get_workspace_by_index(fromIndex);
        let toSpace = this.spaceOf(to);

        this.stack = this.stack.filter(s => s !== toSpace);
        this.stack = [toSpace, ...this.stack];

        let monitor = toSpace.monitor;
        this.monitors.set(monitor, toSpace);

        let fromSpace = this.spaceOf(from);

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
    }

    _initWorkspaceStack() {
        if (inPreview)
            return;
        const scale = 0.9;
        let space = this.spaceOf(workspaceManager.get_active_workspace());
        let mru = [...this.stack];
        this.monitors.forEach(space => mru.splice(mru.indexOf(space), 1));
        mru = [space, ...mru];

        if (Main.panel.statusArea.appMenu)
            Main.panel.statusArea.appMenu.container.hide();
        let monitor = space.monitor;
        this.selectedSpace = space;
        inPreview = true;

        let cloneParent = space.clip.get_parent();
        mru.forEach((space, i) => {
            space.clip.set_position(monitor.x, monitor.y);
            space.startAnimate();

            let scaleX = monitor.width/space.width;
            let scaleY = monitor.height/space.height;
            space.clip.set_scale(scaleX, scaleY);

            space.actor.show();

            let h;
            if (i === 0)
                h = 0;
            else if (i === 1)
                h = StackPositions.up;
            else if (i === 2)
                h = StackPositions.top;
            else {
                h = StackPositions.top;
                space.actor.hide();
            }

            space.actor.set_position(0, space.height*h);

            space.actor.scale_y = scale - i*0.01;
            space.actor.scale_x = scale - i*0.01;

            // Remove any lingering onComplete handlers from animateToSpace
            Tweener.removeTweens(space.actor);

            if (mru[i - 1] === undefined)
                return;
            cloneParent.set_child_below_sibling(
                space.clip,
                mru[i - 1].clip
            );
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

    selectSpace(direction, move, transition) {
        transition = transition || 'easeInOutQuad';
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
        if (to < 0 || to >= mru.length) {
            to = from;
        }
        if (to === from && Tweener.getTweenCount(newSpace.actor) > 0)
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
                onComplete = () => space.actor.hide();
            } else {
                space.actor.show();
            }

            Tweener.addTween(actor,
                             {y: h*space.height,
                              time: prefs.animation_time,
                              scale_x: scale + (to - i)*0.01,
                              scale_y: scale + (to - i)*0.01,
                              transition, onComplete
                             });

        });
    }

    animateToSpace(to, from, callback) {
        inPreview = false;
        TopBar.updateWorkspaceIndicator(to.workspace.index());

        this.selectedSpace = to;

        to.actor.show();
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

        Tweener.addTween(to.actor,
                         { x: 0,
                           y: 0,
                           scale_x: 1,
                           scale_y: 1,
                           time: prefs.animation_time,
                           transition: 'easeInOutQuad',
                           onComplete: () => {
                               // Meta.enable_unredirect_for_screen(screen);

                               // Hide any spaces that aren't visible This
                               // avoids a nasty permance degregration in some
                               // cases
                               for (const space of spaces.values()) {
                                   if (!visible.get(space)) {
                                       space.actor.hide();
                                   }
                               }

                               to.moveDone();
                               to.clip.raise_top();
                               callback && callback();
                           }
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
                                  time: prefs.animation_time, transition: 'easeInOutQuad' });
            }
            above = above.get_next_sibling();
        }
    }

    addSpace(workspace) {
        let space = new Space(workspace, this.spaceContainer);
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

        if (!metaWindow.get_compositor_private()) {
            // Doing stuff to a actorless window is usually a bad idea
            return;
        }

        if (!metaWindow.clone
            || metaWindow.unmapped
            || isWindowAnimating(metaWindow)
            || this._monitorsChanging
            || metaWindow.is_on_all_workspaces())
            return;

        let monitor = Main.layoutManager.monitors[index];
        let space = this.monitors.get(monitor);
        if (space.monitor !== monitor)
            return;

        if (inGrab) {
            spaces.spaceOfWindow(metaWindow).removeWindow(metaWindow);
            inGrab.workspace = space.workspace;
            return;
        }

        metaWindow.change_workspace(space.workspace);

        // This doesn't play nice with the clickoverlay, disable for now
        if (metaWindow.has_focus())
            Main.activateWindow(metaWindow);
    }
}
Signals.addSignalMethods(Spaces.prototype);

function registerWindow(metaWindow) {
    if (metaWindow.is_override_redirect()) {
        return false;
    }

    let actor = metaWindow.get_compositor_private();
    let cloneActor = new Clutter.Clone({source: actor});
    let clone = new Clutter.Actor();
    signals.connect(actor, "notify::allocation", allocateClone);

    clone.add_actor(cloneActor);
    clone.targetX = 0;
    clone.meta_window = metaWindow;

    metaWindow.clone = clone;
    metaWindow.clone.actor = cloneActor;

    signals.connect(metaWindow, "focus", focus_wrapper);
    signals.connect(metaWindow, 'notify::minimized', minimizeWrapper);
    signals.connect(metaWindow, 'notify::fullscreen', fullscreenWrapper);
    signals.connect(actor, 'show', showWrapper);

    signals.connect(actor, 'destroy', destroyHandler);

    return true;
}

function allocateClone(actor) {
    let metaWindow = actor.meta_window;
    let frame = metaWindow.get_frame_rect();
    // Adjust the clone's origin to the north-west, so it will line up
    // with the frame.
    let clone = metaWindow.clone;
    let cloneActor = clone.actor;
    cloneActor.set_position(actor.x - frame.x,
                       actor.y - frame.y);
    clone.set_size(frame.width, frame.height);

    if (metaWindow.clone.first_child.name === 'selection') {
        let selection = metaWindow.clone.first_child;
        let protrusion = Math.round(prefs.window_gap/2);
        selection.x = - protrusion;
        selection.y = - protrusion;
        selection.set_size(frame.width + prefs.window_gap, frame.height + prefs.window_gap);
    }
}

function destroyHandler(actor) {
    signals.disconnect(actor);
}

function resizeHandler(metaWindow) {
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

    if (inGrab) {
        space.layout(false);
    } else if (!space._inLayout && needLayout) {
        // Restore window position when eg. exiting fullscreen
        !Navigator.navigating && selected
            && move_to(space, metaWindow, {
                x: metaWindow.get_frame_rect().x - space.monitor.x});

        space.layout();
    }
}

function enable() {
    debug('#enable');
    spaces = new Spaces();

    function initWorkspaces() {
        spaces.init();

        // Fix the stack overlay
        spaces.mru().reverse().forEach(s => {
            s.selectedWindow && ensureViewport(s.selectedWindow, s, true);
            s.monitor.clickOverlay.show();
        });
    }

    if (Main.layoutManager._startingUp) {
        // Defer workspace initialization until existing windows are accessible.
        // Otherwise we're unable to restore the tiling-order. (when restarting
        // gnome-shell)
        let id = Main.layoutManager.connect('startup-complete', function() {
            Main.layoutManager.disconnect(id);
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
        if (meta_window.clone)
            meta_window.clone.destroy();
    }
}


/**
   Handle windows entering workspaces.
*/
function add_handler(ws, metaWindow) {
    debug("window-added", metaWindow, metaWindow.title, metaWindow.window_type, ws.index());

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

    let connectSizeChanged = () => {
        delete metaWindow.unmapped;
        !existing && signals.connect(metaWindow, 'size-changed', resizeHandler);
    };

    if (!existing) {
        let focusWindow = display.focus_window;

        if (!focusWindow) {
            // This happens when a new window is created from the overview
            let mru = display.get_tab_list(Meta.TabList.NORMAL_ALL, null);
            if (mru[0] === metaWindow) {
                // The new window is added to the mru before receiving focus..
                focusWindow = mru[1];
            } else {
                focusWindow = mru[0]; // Branch not observed yet
            }
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

    let space = spaces.spaceOfWindow(metaWindow);
    if (!add_filter(metaWindow)) {
        connectSizeChanged();
        space.addFloating(metaWindow);
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

    let actor = metaWindow.get_compositor_private();
    animateWindow(metaWindow);
    if (!existing) {
        clone.set_position(clone.targetX,
                           panelBox.height + prefs.vertical_margin);
        clone.set_scale(0, 0);
        Tweener.addTween(clone, {
            scale_x: 1,
            scale_y: 1,
            time: prefs.animation_time,
            transition: 'easeInOutQuad',
            onComplete: () => {
                space.layout();
                connectSizeChanged();
            }
        });
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

    let frame = metaWindow.get_frame_rect();
    let buffer = metaWindow.get_buffer_rect();
    let clone = metaWindow.clone;
    Tweener.addTween(metaWindow.clone, {
        y: panelBox.height + prefs.vertical_margin,
        time: prefs.animation_time,
        transition: 'easeInOutQuad'
    });
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

    if (space.selectedWindow.fullscreen ||
        space.selectedWindow.get_maximized() === Meta.MaximizeFlags.BOTH) {
        animateDown(space.selectedWindow);
    }

    space.selectedWindow = meta_window;

    let monitor = space.monitor;
    let frame = meta_window.get_frame_rect();
    let buffer = meta_window.get_buffer_rect();
    let clone = meta_window.clone;

    let x = Math.round(clone.targetX) + space.targetX;
    let y = panelBox.height + prefs.vertical_margin;
    let gap = prefs.window_gap;
    let workArea = Main.layoutManager.getWorkAreaForMonitor(monitor.index);
    let min = workArea.x - monitor.x;
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
        x = max - minimumMargin - frame.width;
    } else if (x === min) {
        // Same for the start (though the case isn't as common)
        x = min + minimumMargin;
    }


    let selected = space.selectedWindow;
    if (!inPreview && (selected.fullscreen
        || selected.get_maximized() === Meta.MaximizeFlags.BOTH)) {
        Tweener.addTween(selected.clone,
                         { y: frame.y - monitor.y,
                           time: prefs.animation_time,
                           transition: 'easeInOutQuad',
                         });
        // Hack to ensure a moveDone is called after the above tween is done
        Tweener.addTween(space.cloneContainer,
                         {time: prefs.animation_time, onComplete: space.moveDone.bind(space)});
    }
    move_to(space, meta_window, {
        x, y, force
    });

    selected.raise();
    selected.clone.raise_top();
    updateSelection(space, meta_window);
    space.emit('select');
}

function updateSelection(space, metaWindow) {
    let clone = metaWindow.clone;
    let cloneActor = clone.actor;
    space.setSelectionActive();
    if (space.selection.get_parent() === clone)
        return;
    space.selection.reparent(clone);
    clone.set_child_below_sibling(space.selection, cloneActor);
    allocateClone(metaWindow.get_compositor_private());
}


/**
 * Move the column containing @meta_window to x, y and propagate the change
 * in @space. Coordinates are relative to monitor and y is optional.
 */
function move_to(space, metaWindow, { x, y, transition, force }) {
    if (space.indexOf(metaWindow) === -1)
        return;

    let clone = metaWindow.clone;
    let target = x - clone.targetX;
    if (target === space.targetX && !force) {
        space.moveDone();
        return;
    }

    space.targetX = target;
    space.startAnimate();
    Tweener.addTween(space.cloneContainer,
                     { x: target,
                       time: prefs.animation_time,
                       transition: 'easeInOutQuad',
                       onComplete: space.moveDone.bind(space)
                     });

    space.fixOverlays(metaWindow);
}

var inGrab = false;
function grabBegin(metaWindow, type) {
    // Don't handle pushModal grabs and SCD button (close/minimize/etc.) grabs
    if (type === Meta.GrabOp.COMPOSITOR || type === Meta.GrabOp.FRAME_BUTTON)
        return;
    let space = spaces.spaceOfWindow(metaWindow);
    if (space.indexOf(metaWindow) === -1)
        return;
    inGrab = {window: metaWindow};
    space.startAnimate();
    let frame = metaWindow.get_frame_rect();
    let anchor = metaWindow.clone.targetX + space.monitor.x;
    let handler = getGrab(space, anchor);
    grabSignals.connect(metaWindow, 'position-changed', handler);
    Tweener.removeTweens(space.cloneContainer);
    // Turn size/position animation off when grabbing a window with the mouse
}

function grabEnd(metaWindow, type) {
    if (type === Meta.GrabOp.COMPOSITOR)
        return;
    grabSignals.destroy();
    let dragInfo = inGrab;
    inGrab = false;
    if (dragInfo.workspace) {
        let workspace = dragInfo.workspace;
        if (metaWindow.get_workspace() === workspace)
            insertWindow(metaWindow, {existing: true});
        else
            metaWindow.change_workspace(workspace);
        return;
    }
    let space = spaces.spaceOfWindow(metaWindow);
    let frame = metaWindow.get_frame_rect();
    if (space.indexOf(metaWindow) === -1)
        return;
    let buffer = metaWindow.get_buffer_rect();
    let clone = metaWindow.clone;
    space.targetX = space.cloneContainer.x;
    clone.targetX = frame.x - space.monitor.x - space.targetX;
    clone.targetY = frame.y - space.monitor.y;
    clone.set_position(clone.targetX,
                       clone.targetY);
    space.layout();
    ensureViewport(metaWindow, space);
}
function getGrab(space, anchor) {
    return (metaWindow) => {
        if (inGrab.workspace)
            return;
        let frame = metaWindow.get_frame_rect();
        space.cloneContainer.x = frame.x - anchor;
        metaWindow.clone.y = frame.y - space.monitor.y;
    };
}

// `MetaWindow::focus` handling
function focus_handler(metaWindow, user_data) {
    debug("focus:", metaWindow.title, utils.framestr(metaWindow.get_frame_rect()));

    if (metaWindow.fullscreen) {
        TopBar.hide();
    } else {
        TopBar.show();
    }

    if (Scratch.isScratchWindow(metaWindow)) {
        spaces.get(workspaceManager.get_active_workspace()).setSelectionInactive();
        Scratch.makeScratch(metaWindow);
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
    let onActive = metaWindow.get_workspace() === workspaceManager.get_active_workspace();

    if (!metaWindow.clone.get_parent())
        return;

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
    metaWindow.clone.actor.hide();
    actor.show();
    return true;
}

function animateWindow(metaWindow) {
    let actor = metaWindow.get_compositor_private();
    if (!actor)
        return false;
    metaWindow.clone.actor.show();
    actor.hide();
    return true;
}

function isWindowAnimating(metaWindow) {
    let clone = metaWindow.clone;
    return clone.get_parent() && clone.actor.visible;
}

function toggleMaximizeHorizontally(metaWindow) {
    metaWindow = metaWindow || display.focus_window;
    let workArea = Main.layoutManager.getWorkAreaForMonitor(metaWindow.get_monitor());
    let frame = metaWindow.get_frame_rect();
    let reqWidth = workArea.width - minimumMargin*2;

    // Some windows only resize in increments > 1px so we can't rely on a precise width
    // Hopefully this heuristic is good enough
    let isFullWidth = (reqWidth - frame.width) < 10;

    if (isFullWidth && metaWindow.unmaximizedRect) {
        let unmaximizedRect = metaWindow.unmaximizedRect;
        metaWindow.move_resize_frame(
            true, unmaximizedRect.x, frame.y,
            unmaximizedRect.width, frame.height);

        metaWindow.unmaximizedRect = null;
    } else {
        let x = workArea.x + minimumMargin;
        metaWindow.unmaximizedRect = frame;
        metaWindow.move_resize_frame(true, x, frame.y, workArea.width - minimumMargin*2, frame.height);
    }
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
    let workArea = Main.layoutManager.getWorkAreaForMonitor(metaWindow.get_monitor());
    // Make sure two windows of "compatible" width will have room
    let availableWidth = workArea.width - prefs.horizontal_margin*2 - prefs.window_gap;
    let r = frame.width / availableWidth;
    let nextW = Math.floor(ratios[findNext(r)]*availableWidth);
    let nextX = frame.x;

    if (nextX+nextW > monitor.x+monitor.width - minimumMargin) {
        // Move the window so it remains fully visible
        nextX = workArea.x + workArea.width - minimumMargin - nextW;
    }

    metaWindow.move_resize_frame(true, nextX, frame.y, nextW, frame.height);
}

function cycleWindowHeight(metaWindow) {
    const ratios = [1/3, 1/2, 2/3];

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

    let space = spaces.spaceOfWindow(metaWindow);
    if (!space)
        return;

    let i = space.indexOf(metaWindow);

    // Fix `frame` outside `allocate` so the allocation wont change during
    // fixpoint calculation. (could move more out, but then we'd have to
    // calculate available manually)
    let frame = metaWindow.get_frame_rect();

    function allocate(column, available) {
        available -= (column.length - 1) * prefs.window_gap;
        let r = frame.height / available;
        let nextR = ratios[findNext(r)];
        return column.map(mw => {
            if (mw === metaWindow) {
                return Math.floor(available * nextR);
            } else {
                return Math.floor(available * (1-nextR)/(column.length-1));
            }
        });
    }

    if (space[i].length > 1) {
        space.layout(false, {customAllocators: {[i]: allocate}});
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
    const targetX = Math.round(monitor.width/2 - frame.width/2);
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
    spaces.selectSpace(Meta.MotionDirection.DOWN);
}

function selectPreviousSpaceBackwards(mw, space) {
    spaces.selectSpace(Meta.MotionDirection.UP);
}

function movePreviousSpace(mw, space) {
    spaces.selectSpace(Meta.MotionDirection.DOWN, true);
}

function movePreviousSpaceBackwards(mw, space) {
    spaces.selectSpace(Meta.MotionDirection.UP, true);
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
    metaWindow.move_frame(true, x, y);
    animateWindow(metaWindow);
    Tweener.addTween(metaWindow.clone,
                     {x, y,
                      time: prefs.animation_time,
                      transition: 'easeInOutQuad',
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


// Backward compatibility
function defwinprop(...args) {
    return Settings.defwinprop(...args);
}
