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

/**
   Swap current window and right neighbor and leave focus "in place" (ie. also focus the right neigbor)
 */
function pullFromRight(binding = "<Super><Shift>d") {
    var Tiling = Extension.imports.tiling;
    var Utils = Extension.imports.utils;

    Keybindings.bindkey(binding, "pull-from-right", mw => {
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

function cycleEdgeSnap(binding = "<Super>d") {
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

    function rotated(list, dir=1) {
        return [].concat(
            list.slice(dir),
            list.slice(0, dir)
        );
    }

    function cycle(mw, dir=1) {
        let n = global.workspace_manager.get_n_workspaces();
        let N = Settings.workspaceList.get_strv('list').length;
        let space = Tiling.spaces.selectedSpace;
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
    }

    Keybindings.bindkey(
        binding, "next-space-setting",
        mw => cycle(mw, -1), { activeInNavigator: true }
    );
    Keybindings.bindkey(
        "<Shift>"+binding, "prev-space-setting",
        mw => cycle(mw,  1), { activeInNavigator: true }
    );
}

function adjustWidth(incBinding="<Super>plus", decBinding="<Super>minus", increment=50) {
    function inc(mw) {
        const f = mw.get_frame_rect();
        mw.move_resize_frame(true, f.x, f.y, f.width + increment, f.height);
    }

    function dec(mw) {
        const f = mw.get_frame_rect();
        mw.move_resize_frame(true, f.x, f.y, f.width - increment, f.height);
    }

    Keybindings.bindkey(incBinding, "inc-width", inc);
    Keybindings.bindkey(decBinding, "dec-width", dec);

    // OMFG... should support multiple bindings..!
    Keybindings.bindkey("<Super>KP_Add", "inc-width-2", inc);
    Keybindings.bindkey("<Super>KP_Subtract", "dec-width-2", dec);
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
