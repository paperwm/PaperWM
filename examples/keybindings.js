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

/**
   Before: |[ A ][ *B* ]|[  C  ]
   After:  |[ A ][ *C* ]|[  B  ]
*/
function swapWithRight(binding = "<Super><Shift>d") {
    var Tiling = Extension.imports.tiling;
    var Utils = Extension.imports.utils;

    Keybindings.bindkey(binding, "swap-with-right", mw => {
        let space = Tiling.spaces.spaceOfWindow(mw);
        let i = space.indexOf(mw);
        if (i === space.length - 1)
            return;

        Utils.swap(space, i, i+1);
        space.layout(false);
        space.emit("full-layout");
        Main.activateWindow(space[i][0]);
    }, { opensMinimap: true });
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

function tileInto(leftBinding="<Super><Shift>less", rightBinding="<Super><Shift>less") {
    Extension.imports.examples.layouts.bindTileInto(leftBinding, rightBinding);
}

function stackUnstack(basebinding = '<Super><Alt><Ctrl>') {
    // less: '<'
    let Tiling = Extension.imports.tiling;

    const stackUnstackDirection = (dir=-1) => (metaWindow) => {
        let space = Tiling.spaces.spaceOfWindow(metaWindow);
        let column_idx = space.indexOf(metaWindow);
        if (column_idx < 0)
            return;
        let column = space[column_idx];

        if (column.length >= 2) {
            // this is a stacked window
            // move it into a new column
            let row_idx = column.indexOf(metaWindow);
            if (row_idx < 0)
                return;

            let removed = column.splice(row_idx, 1)[0];
            let new_column_idx = column_idx;
            if (dir === 1)
                new_column_idx += 1;

            space.splice(new_column_idx, 0, [removed]);
        }
        else {
            // this is an unstacked window
            // move it into a stack

            // can't stack into a column that doesn't exist
            if (column_idx == 0 && dir == -1)
                return;
            if (column_idx + 1 >= space.length && dir == 1)
                return;

            let windowToMove = column[0];
            space[column_idx + dir].push(windowToMove);

            // is it necessary to remove the window from the column before removing the column?
            column.splice(0, 1);
            
            space.splice(column_idx, 1);
        }

        space.layout(true, {
            customAllocators: { [space.indexOf(metaWindow)]: Tiling.allocateEqualHeight }
        });
        space.emit("full-layout");
    }

    let options = { activeInNavigator: true };
    Keybindings.bindkey(`${basebinding}Left`, "stack-unstack-left", stackUnstackDirection(-1), options);
    Keybindings.bindkey(`${basebinding}Right`, "stack-unstack-right", stackUnstackDirection(1), options);
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
