var Extension;
if (imports.misc.extensionUtils.extensions) {
    Extension = imports.misc.extensionUtils.extensions["paperwm@hedning:matrix.org"];
} else {
    Extension = imports.ui.main.extensionManager.lookup("paperwm@hedning:matrix.org");
}

var Meta = imports.gi.Meta;
var Clutter = imports.gi.Clutter;
var St = imports.gi.St;
var Main = imports.ui.main;

var Tiling = Extension.imports.tiling;
var Scratch = Extension.imports.scratch;
var prefs = Extension.imports.settings.prefs;
var Utils = Extension.imports.utils;
var Tweener = Utils.tweener;
var Navigator = Extension.imports.navigator;


function isInRect(x, y, r) {
    return r.x <= x && x < r.x + r.width &&
        r.y <= y && y < r.y + r.height;
}


function monitorAtPoint(gx, gy) {
    for (let monitor of Main.layoutManager.monitors) {
        if (isInRect(gx, gy, monitor))
            return monitor;
    }
    return null;
}

var MoveGrab = class MoveGrab {
    constructor(metaWindow, type, space) {
        this.window = metaWindow;
        this.type = type;
        this.signals = new Utils.Signals();
        this.grabbed = false;

        this.initialSpace = space || Tiling.spaces.spaceOfWindow(metaWindow);
        this.zoneActors = new Set();
    }

    begin({center} = {}) {
        this.center = center;
        log(`begin`)
        if (this.grabbed)
            return;
        this.grabbed = true
        global.display.end_grab_op(global.get_current_time());
        global.display.set_cursor(Meta.Cursor.MOVE_OR_RESIZE_WINDOW);


        for (let [monitor, $] of Tiling.spaces.monitors) {
            monitor.clickOverlay.deactivate();
        }

        let metaWindow = this.window;
        let actor = metaWindow.get_compositor_private();
        let clone = metaWindow.clone;
        let space = this.initialSpace;
        let frame = metaWindow.get_frame_rect();

        this.initialY = clone.targetY;
        Tweener.removeTweens(clone);
        let [gx, gy, $] = global.get_pointer();

        let px = (gx - actor.x) / actor.width;
        let py = (gy - actor.y) / actor.height;
        actor.set_pivot_point(px, py);

        let [x, y] = space.globalToScroll(gx, gy);
        if (clone.get_parent() === this.initialSpace.cloneContainer) {
            this.pointerOffset = [x - clone.x, y - clone.y];
            px = (x - clone.x) / clone.width;
            py = (y - clone.y) / clone.height;
        } else {
            this.pointerOffset = [gx - frame.x, gy - frame.y];
            clone.x = frame.x;
            clone.y = frame.y;
            px = (gx - clone.x) / clone.width;
            py = (gy - clone.y) / clone.height;
        }
        !center && clone.set_pivot_point(px, py);
        center && clone.set_pivot_point(0, 0);
        log('pointeroffset', this.pointerOffset, clone.get_pivot_point())

        this.signals.connect(global.stage, "button-release-event", this.end.bind(this));
        this.signals.connect(global.stage, "motion-event", this.motion.bind(this));
        this.signals.connect(
            global.screen || global.display, "window-entered-monitor",
            this.beginDnD.bind(this)
        );

        this.scrollAnchor = x;
        space.startAnimate();
        // Make sure the window actor is visible
        Navigator.getNavigator();
        Tiling.animateWindow(metaWindow);
        Tweener.removeTweens(space.cloneContainer);
    }

    beginDnD({center} = {}) {
        if (this.dnd)
            return;
        this.center = center;
        this.dnd = true;
        log(`beginDND`)
        Navigator.getNavigator()
                 .minimaps.forEach(m => typeof(m) === 'number' ?
                                   Mainloop.source_remove(m) : m.hide());
        global.display.set_cursor(Meta.Cursor.MOVE_OR_RESIZE_WINDOW);
        let metaWindow = this.window;
        let actor = metaWindow.get_compositor_private();
        let clone = metaWindow.clone;
        let space = this.initialSpace;

        let [gx, gy, $] = global.get_pointer();
        let point = {};
        if (center) {
            point = space.cloneContainer.apply_relative_transform_to_point(
                global.stage, new Clutter.Vertex({x: Math.round(clone.x), y: Math.round(clone.y)}));
        } else {
            // For some reason the above isn't smooth when DnD is triggered from dragging
            let [dx, dy] = this.pointerOffset;
            point.x = gx - dx;
            point.y = gy - dy;
        }

        let i = space.indexOf(metaWindow);
        let single = i !== -1 && space[i].length === 1;
        space.removeWindow(metaWindow);
        clone.reparent(Main.uiGroup);
        log(`begin dnd`, point.x, point.y)
        clone.x = Math.round(point.x);
        clone.y = Math.round(point.y);
        let newScale = clone.scale_x*space.actor.scale_x;
        clone.set_scale(newScale, newScale);

        let params = {time: prefs.animation_time, scale_x: 0.5, scale_y: 0.5, opacity: 240}
        if (center) {
            this.pointerOffset = [0, 0];
            clone.set_pivot_point(0, 0)
            params.x = gx
            params.y = gy
        }

        clone.__oldOpacity = clone.opacity
        Tweener.addTween(clone, params);

        this.signals.connect(global.stage, "button-press-event", this.end.bind(this));

        let monitor = monitorAtPoint(gx, gy);

        let onSame = monitor === space.monitor;

        let [x, y] = space.globalToViewport(gx, gy);
        if (!this.center && onSame && single && space[i]) {
            Tiling.move_to(space, space[i][0], { x: x + prefs.window_gap/2 });
        } else if (!this.center && onSame && single && space[i-1]) {
            Tiling.move_to(space, space[i-1][0], {
                x: x - space[i-1][0].clone.width - prefs.window_gap/2 });
        } else if (!this.center && onSame && space.length === 0) {
            space.targetX = x;
            space.cloneContainer.x = x;
        }

        let [sx, sy] = space.globalToScroll(gx, gy, {useTarget: true});

        for (let [workspace, space] of Tiling.spaces) {
            this.signals.connect(space.background, "motion-event", this.spaceMotion.bind(this, space));
        }
        this.selectDndZone(space, sx, sy, single && onSame);
    }

    spaceMotion(space, background, event) {
        let [gx, gy, $] = global.get_pointer();
        let [sx, sy] = space.globalToScroll(gx, gy, {useTarget: true});
        this.selectDndZone(space, sx, sy);
    }

    /** x,y in scroll cooridinates */
    selectDndZone(space, x, y, initial=false) {
        const gap = prefs.window_gap;
        const halfGap = gap / 2;
        const columnZoneMarginViz = 100 + halfGap;
        const columnZoneMargin = space.length > 0 ? columnZoneMarginViz : Math.round(space.width / 4);
        const rowZoneMargin = 250 + halfGap;

        let target = null;
        const tilingHeight = space.height - Tiling.panelBox.height;

        let fakeClone = {
            targetX: null,
            targetY: 0,
            width: columnZoneMargin,
            height: tilingHeight
        };
        if (space.length > 0) {
            const lastClone = space[space.length - 1][0].clone;
            fakeClone.targetX = lastClone.x + lastClone.width + gap;
        } else {
            let [sx, sy] = space.viewportToScroll(Math.round(space.width/2), 0);
            fakeClone.targetX = sx + halfGap;
        }

        const columns = [...space, [{ clone: fakeClone }]];
        for (let j = 0; j < columns.length; j++) {
            const column = columns[j];
            const metaWindow = column[0];
            const clone = metaWindow.clone;

            // FIXME: Non-uniform column width
            const colX = clone.targetX;
            const colW = clone.width;

            // Fast forward if pointer is not inside the column or the column zone
            if (x < colX - gap - columnZoneMargin) {
                continue;
            }
            if (colX + colW < x) {
                continue;
            }

            const cx = colX - halfGap;
            const l = cx - columnZoneMargin;
            const r = cx + columnZoneMargin;
            if (l <= x && x <= r) {
                target = {
                    position: [j],
                    center: cx,
                    originProp: "x",
                    sizeProp: "width",
                    marginA: columnZoneMarginViz,
                    marginB: columnZoneMarginViz,
                    space: space,
                    actorParams: {
                        y: Tiling.panelBox.height,
                        height: tilingHeight
                    }
                };
                break;
            }

            // Must be strictly within the column to tile vertically
            if (x < colX)
                continue;

            for (let i = 0; i < column.length + 1; i++) {
                let clone;
                if (i < column.length) {
                    clone = column[i].clone;
                } else {
                    let lastClone = column[i-1].clone;
                    clone = {
                        targetX: lastClone.targetX,
                        targetY: lastClone.targetY + lastClone.height + gap,
                        width: lastClone.width,
                        height: 0
                    };
                }
                const isFirst = i === 0;
                const isLast = i === column.length;
                const cy = clone.targetY - halfGap;
                const t = cy - rowZoneMargin;
                const b = cy + rowZoneMargin;
                if (t <= y && y <= b) {
                    target = {
                        position: [j, i],
                        center: cy,
                        originProp: "y",
                        sizeProp: "height",
                        marginA: isFirst ? 0 : rowZoneMargin,
                        marginB: isLast  ? 0 : rowZoneMargin,
                        space: space,
                        actorParams: {
                            x: clone.targetX,
                            width: clone.width,
                        }
                    };
                    break;
                }
            }
        }

        function sameTarget(a, b) {
            if (a === b)
                return true;
            if (!a || !b)
                return false;
            return a.space === b.space && a.position[0] === b.position[0] && a.position[1] === b.position[1];
        }

        // TODO: rename dndTarget to selectedZone ?
        if (!sameTarget(target, this.dndTarget)) {
            this.dndTarget && this.deactivateDndTarget(this.dndTarget);
            if (target)
                this.activateDndTarget(target, initial);
        }
    }

    motion(actor, event) {
        let metaWindow = this.window;
        // let [gx, gy] = event.get_coords();
        let [gx, gy, $] = global.get_pointer();
        let [dx, dy] = this.pointerOffset;
        let clone = metaWindow.clone;

        let tx = clone.get_transition('x')
        let ty = clone.get_transition('y')

        if (this.dnd) {
            if (tx) {
                log(`motion`, tx, this.pointerOffset)
                tx.set_to(gx - dx)
                ty.set_to(gy - dy)
            } else {
                clone.x = gx - dx;
                clone.y = gy - dy;
            }
        } else {
            let monitor = monitorAtPoint(gx, gy);
            if (monitor !== this.initialSpace.monitor) {
                this.beginDnD();
                return;
            }

            if (event.get_state() & Clutter.ModifierType.CONTROL_MASK) {
                // NB: only works in wayland
                this.beginDnD();
                return;
            }

            let space = this.initialSpace;
            let clone = metaWindow.clone;
            let [x, y] = space.globalToViewport(gx, gy);
            space.targetX = x - this.scrollAnchor;
            space.cloneContainer.x = space.targetX;

            clone.y = y - dy;

            const threshold = 300;
            dy = Math.min(threshold, Math.abs(clone.y - this.initialY));
            let s = 1 - Math.pow(dy / 500, 3);
            let actor = metaWindow.get_compositor_private();
            actor.set_scale(s, s);
            clone.set_scale(s, s);

            if (dy >= threshold) {
                this.beginDnD();
            }
        }
    }

    end() {
        log(`end`)
        this.signals.destroy();

        let metaWindow = this.window;
        let actor = metaWindow.get_compositor_private();
        let frame = metaWindow.get_frame_rect();
        let clone = metaWindow.clone;
        let destSpace;
        let [gx, gy, $] = global.get_pointer();

        this.zoneActors.forEach(actor => actor.destroy());
        let params = {
            time: prefs.animation_time,
            scale_x: 1,
            scale_y: 1,
            opacity: clone.__oldOpacity || 255
        };

        if (this.dnd) {
            let dndTarget = this.dndTarget;

            if (dndTarget) {
                let space = dndTarget.space;
                destSpace = space;
                space.selection.show()

                if (Scratch.isScratchWindow(metaWindow))
                    Scratch.unmakeScratch(metaWindow);

                // Remember the global coordinates of the clone
                let [x, y] = clone.get_position();
                space.addWindow(metaWindow, ...dndTarget.position);

                let [sx, sy] = space.globalToScroll(gx, gy);
                let [dx, dy] = this.pointerOffset;
                clone.x = sx - dx;
                clone.y = sy - dy;
                let newScale = clone.scale_x/space.actor.scale_x;
                clone.set_scale(newScale, newScale);

                actor.set_scale(1, 1);
                actor.set_pivot_point(0, 0);

                // Tiling.animateWindow(metaWindow);
                params.onStopped = () => {
                    space.moveDone()
                    clone.set_pivot_point(0, 0)
                }
                Tweener.addTween(clone, params);

                space.targetX = space.cloneContainer.x;
                space.selectedWindow = metaWindow;
                if (dndTarget.position) {
                    space.layout(true, {customAllocators: {[dndTarget.position[0]]: Tiling.allocateEqualHeight}});
                } else {
                    space.layout();
                }
                Tiling.move_to(space, metaWindow, {x: x - space.monitor.x})
                Tiling.ensureViewport(metaWindow, space);

                clone.raise_top()
            } else {
                metaWindow.move_frame(true, clone.x, clone.y);
                Scratch.makeScratch(metaWindow);
                this.initialSpace.moveDone();

                actor.set_scale(clone.scale_x, clone.scale_y);
                actor.opacity = clone.opacity;

                clone.opacity = clone.__oldOpacity || 255;
                clone.set_scale(1, 1);
                clone.set_pivot_point(0, 0);

                params.onStopped = () => { actor.set_pivot_point(0, 0) };
                Tweener.addTween(actor, params);
            }
        } else if (this.initialSpace.indexOf(metaWindow) !== -1){
            let space = this.initialSpace;
            destSpace = space;
            space.targetX = space.cloneContainer.x;

            actor.set_scale(1, 1);
            actor.set_pivot_point(0, 0);

            Tiling.animateWindow(metaWindow);
            params.onStopped = () => {
                space.moveDone()
                clone.set_pivot_point(0, 0)
            }
            Tweener.addTween(clone, params);

            Tiling.ensureViewport(metaWindow, space);
        }

        // NOTE: we reset window here so `window-added` will handle the window,
        // and layout will work correctly etc.
        this.window = null;

        this.initialSpace.layout();

        // let monitor = monitorAtPoint(gx, gy);
        // let space = Tiling.spaces.monitors.get(monitor);

        // // Make sure the window is on the correct workspace.
        // // If the window is transient this will take care of its parent too.
        // metaWindow.change_workspace(space.workspace)
        // space.workspace.activate(global.get_current_time());
        Tiling.inGrab = false;
        Navigator.getNavigator().finish(destSpace, metaWindow);
        global.display.set_cursor(Meta.Cursor.DEFAULT);
    }

    activateDndTarget(zone, first) {
        function mkZoneActor(props) {
            let actor = new St.Widget({style_class: "tile-preview"});
            actor.x = props.x;
            actor.y = props.y;
            actor.width = props.width;
            actor.height = props.height;
            return actor;
        }

        zone.actor = mkZoneActor({...zone.actorParams});

        this.dndTarget = zone;
        this.zoneActors.add(zone.actor);

        let params = {
            time: prefs.animation_time,
            [zone.originProp]: zone.center - zone.marginA,
            [zone.sizeProp]: zone.marginA + zone.marginB,
        };

        if (first) {
            params.height = zone.actor.height
            params.y = zone.actor.y

            let clone = this.window.clone;
            let space = zone.space;
            let [x, y] = space.globalToScroll(...clone.get_transformed_position())
            zone.actor.set_position(x, y)
            zone.actor.set_size(...clone.get_transformed_size())
        } else {
            zone.actor[zone.sizeProp] = 0;
            zone.actor[zone.originProp] = zone.center;
        }

        zone.space.cloneContainer.add_child(zone.actor);
        zone.space.selection.hide();
        zone.actor.show();
        zone.actor.raise_top();
        Tweener.addTween(zone.actor, params);
    }

    deactivateDndTarget(zone) {
        if (zone) {
            zone.space.selection.show();
            Tweener.addTween(zone.actor, {
                time: prefs.animation_time,
                [zone.originProp]: zone.center,
                [zone.sizeProp]: 0,
                onComplete: () => { zone.actor.destroy(); this.zoneActors.delete(zone.actor); }
            });
        }

        this.dndTarget = null;
    }
}

var ResizeGrab = class ResizeGrab {
    constructor(metaWindow, type) {
        print("Resize grab begin", metaWindow.title)
        this.window = metaWindow;
        this.signals = new Utils.Signals();

        this.space = Tiling.spaces.spaceOfWindow(metaWindow);
        if (this.space.indexOf(metaWindow) === -1)
            return;

        this.scrollAnchor = metaWindow.clone.targetX + this.space.monitor.x;

        this.signals.connect(metaWindow, 'size-changed', () => {
            metaWindow._targetWidth = null;
            metaWindow._targetHeight = null;
            let frame = metaWindow.get_frame_rect();

            this.space.targetX = frame.x - this.scrollAnchor;
            this.space.cloneContainer.x = this.space.targetX;
            this.space.layout(false);
        })
    }
    end() {
        this.signals.destroy();

        this.window = null;
        this.space.layout();
    }
}
