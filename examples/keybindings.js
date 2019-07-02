var Extension = imports.misc.extensionUtils.extensions['paperwm@hedning:matrix.org'];
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
