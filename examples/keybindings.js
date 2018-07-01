var Extension = imports.misc.extensionUtils.extensions['paperwm@hedning:matrix.org'];
var Keybindings = Extension.imports.keybindings;
var Main = imports.ui.main;


function windowMarks() {
    var marks = {}

    function setMark(k) {
        return (mw) => marks[k] = mw
    }

    function gotoMark(k) {
        return () => marks[k] && Main.activateWindow(marks[k])
    }

    for(let k = 0; k < 9; k++) {
        Keybindings.bindkey(`<Super>${k}`, gotoMark(k))
        Keybindings.bindkey(`<Super><Shift>${k}`, setMark(k),
                            {activeInNavigator: true})
    }
}


function swapNeighbours() {
    var Tiling = Extension.imports.tiling;
    var Meta = imports.gi.Meta;

    Keybindings.bindkey("<Super>y", (mw) => {
        let space = Tiling.spaces.spaceOfWindow(mw)
        let i = space.indexOf(mw);
        if (space[i+1]) {
            space.swap(Meta.MotionDirection.RIGHT, space[i+1][0])
        }
    }, {activeInNavigator: true})
}


function showNavigator() {
    Keybindings.bindkey("<Super>j", () => null, { opensNavigator: true })
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
