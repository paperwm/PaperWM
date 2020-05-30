var Extension;
if (imports.misc.extensionUtils.extensions) {
    Extension = imports.misc.extensionUtils.extensions["paperwm@hedning:matrix.org"];
} else {
    Extension = imports.ui.main.extensionManager.lookup("paperwm@hedning:matrix.org");
}
var Keybindings = Extension.imports.keybindings;
var Main = imports.ui.main;
var Tiling = Extension.imports.tiling;
var Scratch = Extension.imports.scratch;
var Virt = Extension.imports.virtTiling;
var Tweener = Extension.imports.utils.tweener;
var Utils = Extension.imports.utils;
var prefs = Tiling.prefs;


/** Adapts an action handler to operate on the neighbour in the given direction */
function useNeigbour(dir, action) {
    return (metaWindow) => {
        let space = Tiling.spaces.spaceOfWindow(metaWindow);
        let i = space.indexOf(metaWindow);
        if (!space[i+dir])
            return action(undefined);

        return action(space[i+dir][0]);
    }
}

/** Find the index of the first not fully visible column in the given direction */
function findNonVisibleIndex(space, metaWindow, dir=1, margin=1) {
    let k = space.indexOf(metaWindow) + dir;
    while (0 <= k && k < space.length && space.isFullyVisible(space[k][0], margin)) {
        k += dir;
    }
    return k
}

function moveTo(space, metaWindow, target) {
    space.startAnimate();
    space.targetX = target;
    Tweener.addTween(space.cloneContainer,
                     { x: space.targetX,
                       time: prefs.animation_time,
                       onComplete: space.moveDone.bind(space)
                     });

    space.fixOverlays();
}

function getLeftSnapPosition(space) {
    let margin = Tiling.prefs.horizontal_margin;
    let workarea = space.workArea();
    let wax = workarea.x - space.monitor.x;

    return wax + margin;
}

function getSnapPositions(space, windowWidth) {
    let margin = Tiling.prefs.horizontal_margin;
    let workarea = space.workArea();
    let wax = workarea.x - space.monitor.x;

    let leftSnapPos = wax + margin;
    let rightSnapPos = wax + workarea.width - windowWidth - margin;
    return [leftSnapPos, rightSnapPos]
}

function mkVirtTiling(space) {
    return Virt.layout(Virt.fromSpace(space), space.workArea(), prefs);
}

function moveToViewport(space, tiling, i, vx) {
    moveTo(space, null, vx - tiling[i][0].x);
}

function resize(tiling, i, width) {
    for (let w of tiling[i]) {
        w.width = width;
    }
}


////// Actions


/**
   Expands or shrinks the window to fit the available viewport space.
   Available space is space not occupied by fully visible windows
   Will move the tiling as necessary.
 */
function fitAvailable(metaWindow) {
    // TERMINOLOGY: mold-into ?
    let space = Tiling.spaces.spaceOfWindow(metaWindow);

    let a = findNonVisibleIndex(space, metaWindow, -1);
    let b = findNonVisibleIndex(space, metaWindow,  1);

    let leftMost = space[a+1][0];
    let availableLeft = space.targetX + leftMost.clone.targetX;

    let rightMost = space[b-1][0];
    let rightEdge = space.targetX + rightMost.clone.targetX + rightMost.clone.width;
    let availableRight = space.width - rightEdge;

    let f = metaWindow.get_frame_rect();
    let available = f.width + availableRight + availableLeft - Tiling.prefs.horizontal_margin*2;

    if (a+1 === b-1) {
        // We're the only window
        Tiling.toggleMaximizeHorizontally(metaWindow);
    } else {
        metaWindow.move_resize_frame(true, f.x, f.y, available, f.height);
        Tiling.move_to(space, space[a+1][0], { x: Tiling.prefs.horizontal_margin });
    }
}



function cycleLayoutDirection(dir) {

    const splits = [
        [0.5, 0.5],
        [0.7, 0.3],
        [0.3, 0.7]
    ];

    return (metaWindow, space, {navigator}={}) => {
        let k = space.indexOf(metaWindow);
        let j = k+dir;
        let neighbourCol = space[j];
        if (!neighbourCol)
            return;

        let neighbour = neighbourCol[0];

        let tiling = mkVirtTiling(space)

        let available = space.width - Tiling.prefs.horizontal_margin*2 - Tiling.prefs.window_gap;

        let f1 = metaWindow.get_frame_rect();
        let f2 = neighbour.get_frame_rect();

        let s1 = f1.width / available;
        let s2 = f2.width / available;

        let state;
        if (!navigator["cycle-layouts"]) {
            navigator["cycle-layouts"] = {i: Utils.eq(s1, splits[0][0]) ? 1 : 0 };
        }
        state = navigator["cycle-layouts"];

        let [a, b] = splits[state.i % splits.length];
        state.i++;

        let metaWindowWidth = Math.round(available * a);;
        metaWindow.move_resize_frame(true, f1.x, f1.y, metaWindowWidth, f1.height);
        resize(tiling, k, metaWindowWidth);

        let neighbourWidth = Math.round(available * b);
        neighbour.move_resize_frame(true, f2.x, f2.y, neighbourWidth, f2.height);
        resize(tiling, j, neighbourWidth);

        Virt.layout(tiling, space.workArea(), prefs);

        let snapLeft = getLeftSnapPosition(space);

        if (dir === 1)
            moveToViewport(space, tiling, k, snapLeft);
        else
            moveToViewport(space, tiling, j, snapLeft);
    }
}

function cycleLayouts(binding = "<Super>d") {
    function action(metaWindow, space, {navigator}={}) {
        const m = 50;
        space = Tiling.spaces.spaceOfWindow(metaWindow);

        let k = space.indexOf(metaWindow);
        let next = space.length > k+1 && space.isVisible(space[k+1][0], m) && space[k+1][0];
        let prev = k > 0 && space.isVisible(space[k-1][0], m) && space[k-1][0];

        let neighbour = next || prev;

        if (neighbour === next) {
            return cycleLayoutDirection(1)(metaWindow, space, {navigator});
        } else {
            return cycleLayoutDirection(-1)(metaWindow, space, {navigator});
        }
    }

    Keybindings.bindkey(binding, "cycle-layouts", action, { opensNavigator: true });
}


function tileInto(dir=-1) {
    return (metaWindow, space) => {
        space = space || Tiling.spaces.spaceOfWindow(metaWindow);
        let jFrom = space.indexOf(metaWindow);
        if (space[jFrom].length > 1) {
            return tileOut(dir)(metaWindow, space);
        }
        let jTo = jFrom + dir;
        if (jTo < 0 || jTo >= space.length)
            return;

        space[jFrom].splice(space.rowOf(metaWindow), 1);
        space[jTo].push(metaWindow);

        if (space[jFrom].length === 0) {
            space.splice(jFrom, 1);
        }
        space.layout(true, {
            customAllocators: { [space.indexOf(metaWindow)]: Tiling.allocateEqualHeight }
        });
        space.emit("full-layout");
    }
}

function tileOut(dir) {
    return (metaWindow, space) => {
        space = space || Tiling.spaces.spaceOfWindow(metaWindow);
        let [j, i] = space.positionOf(metaWindow);
        if (space[j].length === 0)
            return;

        space[j].splice(i, 1);
        space.splice(j + (dir === 1 ? 1 : 0), 0, [metaWindow]);
        space.layout();
        space.emit("full-layout");
        space.fixOverlays();
    }
}


////// Bindings

function bindTileInto(leftBinding="<Super><Alt>Left", rightBinding="<Super><Alt>Right") {
    let options = { activeInNavigator: true };
    if (leftBinding)
        Keybindings.bindkey(leftBinding, "tile-into-left-column", tileInto(-1), options);
    if (rightBinding)
        Keybindings.bindkey(rightBinding, "tile-into-right-column", tileInto(1), options);
}

function bindTileOut(left="<Super><Ctrl>k", right="<Super><Ctrl>l") {
    Keybindings.bindkey(left, "tile-out-left", tileOut(-1), {activeInNavigator: true});
    Keybindings.bindkey(right, "tile-out-right", tileOut(1), {activeInNavigator: true});
}


function bindFitAvailable(left="<Super>j", focus = "<Super>k", right="<Super>l") {
    left && Keybindings.bindkey(left, "fit-available-width-left", useNeigbour(-1, fitAvailable), {activeInNavigator: true});
    focus && Keybindings.bindkey(focus, "fit-available-width", fitAvailable, {activeInNavigator: true});
    right && Keybindings.bindkey(right, "fit-available-width-right", useNeigbour(1, fitAvailable), {activeInNavigator: true});
}

function bindCycleLayoutDirection(left="<Super><Shift>d", right="<Super>d") {
    Keybindings.bindkey(left, "cycle-layout-left", cycleLayoutDirection(-1), { opensNavigator: true });
    Keybindings.bindkey(right, "cycle-layout-right", cycleLayoutDirection(1), { opensNavigator: true });
}
