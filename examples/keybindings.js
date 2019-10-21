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
            space.swap(Meta.MotionDirection.RIGHT, space[i+1][0])
        }
    }, {activeInNavigator: true})
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
