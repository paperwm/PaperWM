var Extension = imports.misc.extensionUtils.extensions['paperwm@hedning:matrix.org'];
var Keybindings = Extension.imports.keybindings;
var Main = imports.ui.main;
var Tiling = Extension.imports.tiling;
var Scratch = Extension.imports.scratch;

function gotoByIndex() {
    function goto(k) {
        return () => {
            let space = Tiling.spaces.get(global.screen.get_active_workspace());
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
        Keybindings.bindkey(`<Super>${k}`, `goto-coloumn-${i}`,
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


function swapNeighbours() {
    var Tiling = Extension.imports.tiling;
    var Meta = imports.gi.Meta;

    Keybindings.bindkey("<Super>y", "swap-neighbours", (mw) => {
        let space = Tiling.spaces.spaceOfWindow(mw)
        let i = space.indexOf(mw);
        if (space[i+1]) {
            space.swap(Meta.MotionDirection.RIGHT, space[i+1][0])
        }
    }, {activeInNavigator: true})
}


function showNavigator() {
    Keybindings.bindkey("<Super>j", "show-minimap", () => null, { opensMinimap: true })
}


function cycleWindowHeight() {
    Keybindings.bindkey("<Super>q", "cycle-height", cycleHeight, { activeInNavigator: true });

    var Tiling = Extension.imports.tiling;

    function cycleHeight(metaWindow) {
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

        let space = Tiling.spaces.spaceOfWindow(metaWindow);
        if (!space)
            return;

        let i = space.indexOf(metaWindow);

        function allocate(column, available) {
            available -= (column.length - 1) * Tiling.prefs.window_gap;
            let frame = metaWindow.get_frame_rect();
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
