var Extension = imports.misc.extensionUtils.getCurrentExtension();
var Keybindings = Extension.imports.keybindings;
var Main = imports.ui.main;
var Tiling = Extension.imports.tiling;
var Scratch = Extension.imports.scratch;

/**
   To use an example as-is ("gotoByIndex" for instance) add the following to the
   `init` function in "user.js":

   Extension.imports.examples.keybindings.gotoByIndex();
 */

function gotoByIndex() {
    function goto(k) {
        return () => {
            let space = Tiling.spaces.get(global.workspace_manager.get_active_workspace());
            let metaWindow = space.getWindow(k, 0)
            if (!metaWindow)
                return;

            if (metaWindow.has_focus()) {
                // Can happen when navigator is open
                Tiling.ensureViewport(metaWindow);
            } else {
                Main.activateWindow(metaWindow);
            }
        }
    }
    for(let k = 1; k <= 9; k++) {
        Keybindings.bindkey(`<Super>${k}`, `goto-coloumn-${k}`,
                            goto(k-1), {activeInNavigator: true})
    }
}

function windowMarks() {
    const Meta = imports.gi.Meta;
    var marks = {}

    function setMark(k) {
        return (mw) => marks[k] = mw
    }

    function gotoMark(k) {
        return (metaWindow, space, options) => {
            let mark = marks[k];
            if (!mark)
                return;

            if (mark.has_focus()) {
                // Can happen when navigator is open
                Tiling.ensureViewport(mark);
                if (!options.navigator) {
                    let mru = global.display.get_tab_list(
                        Meta.TabList.NORMAL_ALL, null);
                    let nextWindow = mru[1];
                    if (!nextWindow)
                        return;
                    Main.activateWindow(nextWindow);
                    if (Scratch.isScratchWindow(mark) &&
                        !Scratch.isScratchWindow(nextWindow)) {
                        Scratch.hide();
                    }
                }
            } else {
                Main.activateWindow(mark);
            }
        }
    }

    for(let k = 0; k <= 9; k++) {
        Keybindings.bindkey(`<Super>${k}`, `goto-mark-${k}`,
                            gotoMark(k), {activeInNavigator: true})
        Keybindings.bindkey(`<Super><Shift>${k}`, `set-mark-${k}`,
                            setMark(k), {activeInNavigator: true})
    }
}

function swapNeighbours(binding = "<Super>y") {
    var Tiling = Extension.imports.tiling;
    var Meta = imports.gi.Meta;

    Keybindings.bindkey(binding, "swap-neighbours", (mw) => {
        let space = Tiling.spaces.spaceOfWindow(mw)
        let i = space.indexOf(mw);
        if (space[i+1]) {
            space.swap(Meta.MotionDirection.RIGHT, space[i+1][0]);
            space[i+1].map(mw => mw.clone.raise_top());
        }
    }, {activeInNavigator: true});
}

function cycleMonitor(binding = "<Super>d") {
    var Tiling = Extension.imports.tiling;
    var Main = imports.ui.main;

    Keybindings.bindkey(binding, "cycle-monitor", () => {
        let curMonitor = Tiling.spaces.selectedSpace.monitor
        let monitors = Main.layoutManager.monitors;
        let nextMonitorI = (curMonitor.index + 1) % monitors.length;
        let nextMonitor = monitors[nextMonitorI];
        let nextSpace = Tiling.spaces.monitors.get(nextMonitor);
        if (nextSpace) {
            nextSpace.workspace.activate(global.get_current_time());
        }
    });
}

/**
   Cycle the workspace settings bound to the current workspace.
   (among the unused settings)
   NB: Only relevant when using dynamic workspaces.
 */
function cycleWorkspaceSettings(binding = "<Super>q") {
    var Tiling = Extension.imports.tiling;
    var Settings = Extension.imports.settings;
    var Utils = Extension.imports.utils;

    Keybindings.bindkey(
        binding, "next-space-setting",
        mw => Tiling.cycleWorkspaceSettings(-1), { activeInNavigator: true }
    );
    Keybindings.bindkey(
        "<Shift>"+binding, "prev-space-setting",
        mw => Tiling.cycleWorkspaceSettings(1), { activeInNavigator: true }
    );
}

function expand(binding = "<Super><Shift>l") {
    var Tiling = Extension.imports.tiling;

    function findNonVisibleIndex(space, metaWindow, dir=1, margin=1) {
        let k = space.indexOf(metaWindow) + dir;
        while (0 <= k && k < space.length && space.isFullyVisible(space[k][0], margin)) {
            k += dir;
        }
        return k
    }

    function action(metaWindow) {
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
            Tiling.toggleMaximizeHorizontally(metaWindow)
        } else {
            metaWindow.move_resize_frame(true, f.x, f.y, available, f.height);
            Tiling.move_to(space, space[a+1][0], { x: Tiling.prefs.horizontal_margin })
        }
    }

    Keybindings.bindkey(binding, "expand-available-width", action, {activeInNavigator: true});
}

function cycleLayouts(binding = "<Super>d") {
    var Tiling = Extension.imports.tiling;
    var Virt = Extension.imports.virtTiling;
    var Tweener = Extension.imports.utils.tweener;
    var Utils = Extension.imports.utils;
    var prefs = Tiling.prefs;

    const splits = [
        [0.5, 0.5],
        [0.7, 0.3],
        [0.3, 0.7]
    ];

    function moveTo(space, metaWindow, target) {
        space.startAnimate();
        space.targetX = target;
        Tweener.addTween(space.cloneContainer,
                         { x: space.targetX,
                           time: prefs.animation_time,
                           onComplete: space.moveDone.bind(space)
                         });

        space.fixOverlays(metaWindow);
    }

    function action(metaWindow, space, {navigator}={}) {
        const m = 50
        space = Tiling.spaces.spaceOfWindow(metaWindow);

        prefs = {...prefs, minimum_margin: Tiling.minimumMargin()}

        const tiling = Virt.layout(Virt.fromSpace(space), space.workArea(), prefs);

        function resize(i, width) {
            for (let w of tiling[i]) {
                w.width = width;
            }
        }

        let k = space.indexOf(metaWindow);
        let next = space.length > k+1 && space.isVisible(space[k+1][0], m) && space[k+1][0];
        let prev = k > 0 && space.isVisible(space[k-1][0], m) && space[k-1][0];


        let neighbour = next || prev;
        let f = metaWindow.get_frame_rect();
        let f2 = neighbour.get_frame_rect();

        let neighbourK = space.indexOf(neighbour);

        let available = space.width - Tiling.prefs.horizontal_margin*2 - Tiling.prefs.window_gap;

        let s1 = f.width / available;
        let s2 = f2.width / available;

        let state;
        if (!navigator["cycle-layouts"]) {
            navigator["cycle-layouts"] = {i: Utils.eq(s1, splits[0][0]) ? 1 : 0 }
        }
        state = navigator["cycle-layouts"];

        let [a, b] = splits[(state.i++) % splits.length];

        let metaWindowWidth = Math.round(available * a);;
        metaWindow.move_resize_frame(true, f.x, f.y, metaWindowWidth, f.height);
        resize(k, metaWindowWidth);

        let neighbourWidth = Math.round(available * b);
        neighbour.move_resize_frame(true, f2.x, f2.y, neighbourWidth, f2.height);
        resize(neighbourK, neighbourWidth);

        Virt.layout(tiling, space.workArea(), prefs);

        let margin = Tiling.prefs.horizontal_margin;
        let width = f.width;
        let workarea = space.workArea();
        let wax = workarea.x - space.monitor.x;

        let leftSnapPos = wax + margin;
        let rightSnapPos = wax + workarea.width - metaWindowWidth - margin;

        if (neighbour == next) {
            print("next", metaWindow.title, leftSnapPos, tiling[k][0].x);
            moveTo(space, metaWindow, leftSnapPos - tiling[k][0].x);
            // Tiling.move_to(space, metaWindow, {x: leftSnapPos});
        } else {
            print("prev", neighbour.title, rightSnapPos, tiling[neighbourK][0].x);
            moveTo(space, neighbour, leftSnapPos - tiling[neighbourK][0].x);
            // Tiling.move_to(space, neighbour, {x: leftSnapPos});
        }
    }

    Keybindings.bindkey(binding, "cycle-layouts", action, { opensNavigator: true })
}

function showNavigator(binding = "<Super>j") {
    Keybindings.bindkey(binding, "show-minimap", () => null, { opensMinimap: true })
}


// listFreeBindings("<super>").join("\n")
function listFreeBindings(modifierString) {
    let free = [];
    const chars = "abcdefghijklmnopqrstuvxyz1234567890".split("")
    const symbols = ["minus", "comma", "period", "plus"]
    return [].concat(chars, symbols).filter(
        key => Keybindings.getBoundActionId(modifierString+key) === 0
    ).map(key => modifierString+key)
}

function moveSpaceToMonitor(basebinding = '<super><alt>') {
    let Meta = imports.gi.Meta;
    let display = global.display;

    function moveTo(direction) {
        let Navigator = Extension.imports.navigator;
        let spaces = Tiling.spaces;

        let currentSpace = spaces.selectedSpace;
        let monitor = currentSpace.monitor;
        let i = display.get_monitor_neighbor_index(monitor.index, direction);
        let opposite;
        switch (direction) {
        case Meta.DisplayDirection.RIGHT:
            opposite = Meta.DisplayDirection.LEFT; break;
        case Meta.DisplayDirection.LEFT:
            opposite = Meta.DisplayDirection.RIGHT; break;
        case Meta.DisplayDirection.UP:
            opposite = Meta.DisplayDirection.DOWN; break;
        case Meta.DisplayDirection.DOWN:
            opposite = Meta.DisplayDirection.UP; break;
        }
        let n = i;
        if (i === -1) {
            let i = monitor.index;
            while (i !== -1) {
                n = i;
                i = display.get_monitor_neighbor_index(n, opposite);
            }
        }
        let next = spaces.monitors.get(Main.layoutManager.monitors[n]);

        currentSpace.setMonitor(next.monitor);
        spaces.monitors.set(next.monitor, currentSpace);

        next.setMonitor(monitor);
        spaces.monitors.set(monitor, next);

        // This is pretty hacky
        spaces.switchWorkspace(null, currentSpace.workspace.index(), currentSpace.workspace.index());
    }

    for (let arrow of ['Down', 'Left', 'Up', 'Right']) {
        Keybindings.bindkey(`${basebinding}${arrow}`, `move-space-monitor-${arrow}`,
                            () => {
                                moveTo(Meta.DisplayDirection[arrow.toUpperCase()]);
                            });
    }
}

/**
   "<Super>KP_Add" and "<Super>KP_Subtract" to use the numpad keys
 */
function adjustWidth(incBinding="<Super>plus", decBinding="<Super>minus", increment=50) {
    function adjuster(delta) {
        return mw => {
            if (!mw) return;
            const f = mw.get_frame_rect();
            mw.move_resize_frame(true, f.x, f.y, f.width + delta, f.height);
        }
    }

    Keybindings.bindkey(incBinding, "inc-width", adjuster(increment));
    Keybindings.bindkey(decBinding, "dec-width", adjuster(-increment));
}

function tileInto(leftBinding="<Super>less", rightBinding="<Super><Shift>less") {
    // less: '<'
    let Tiling = Extension.imports.tiling;

    const tileIntoDirection = (dir=-1) => (metaWindow) => {
        let space = Tiling.spaces.spaceOfWindow(metaWindow);
        let jFrom = space.indexOf(metaWindow);
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

    let options = { activeInNavigator: true };
    if (leftBinding)
        Keybindings.bindkey(leftBinding, "tile-into-left-column", tileIntoDirection(-1), options);
    if (rightBinding)
        Keybindings.bindkey(rightBinding, "tile-into-right-column", tileIntoDirection(1), options);
}


function cycleEdgeSnap(binding = "<Super>u") {
    var Tiling = Extension.imports.tiling;
    var Meta = imports.gi.Meta;

    Keybindings.bindkey(binding, "cycle-edge-snap", (mw) => {
        // Snaps window to the left/right monitor edge
        // Note: mostly the same as quickly switching left+right / right+left

        // Note: We work in monitor relative coordinates here
        let margin = Tiling.prefs.horizontal_margin;
        let space = Tiling.spaces.spaceOfWindow(mw);
        let workarea = Main.layoutManager.getWorkAreaForMonitor(space.monitor.index);
        let clone = mw.clone;

        let x = clone.targetX + space.targetX;
        let width = clone.width;
        let wax = workarea.x - space.monitor.x;

        let leftSnapPos = wax + margin;
        let rightSnapPos = wax + workarea.width - width - margin;

        let targetX;
        if (x == leftSnapPos) {
            targetX = rightSnapPos;
        } else if (x == rightSnapPos) {
            targetX = leftSnapPos;
        } else {
            targetX = leftSnapPos;
        }

        Tiling.move_to(space, mw, {x: targetX});
    }, {activeInNavigator: true});
}

function reorderWorkspace(bindingUp = "<Alt><Super>Page_Up", bindingDown = "<Alt><Super>Page_Down") {
    if (!global.workspace_manager.reorder_workspace) {
        print("Reorder workspaces not supported by this gnome-shell version");
        return;
    }
    function moveWorkspace(dir, metaWindow, space) {
        if (!space)
            return;

        let nextI = Math.min(Tiling.spaces.size-1 , Math.max(0, space.workspace.index() + dir));
        global.workspace_manager.reorder_workspace(space.workspace, nextI);
    }

    Keybindings.bindkey(
        bindingUp, "reorder-workspace-up",
        moveWorkspace.bind(null, -1),
        { activeInNavigator: true }
    );

    Keybindings.bindkey(
        bindingDown, "reorder-workspace-down",
        moveWorkspace.bind(null, 1),
        { activeInNavigator: true }
    );
}
