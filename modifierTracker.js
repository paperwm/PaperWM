var Extension = imports.misc.extensionUtils.extensions['paperwm@hedning:matrix.org'];
var Utils = Extension.imports.utils;
var Me = Extension.imports.modifierTracker;
var Gdk = imports.gi.Gdk;
var Signals = imports.signals;
var Meta = imports.gi.Meta;


var trackedModifiers = [
    ["Super", Gdk.ModifierType.MOD4_MASK]
];

var keymap;
var prevState = 0;

function stateChangedHandler() {
    let curState = keymap.get_modifier_state()
    /// A maze of different kind of mask, can't find the right conversion.. :(
    // Meta.VirtualModifier
    // Gdk.ModifierType
    // const mask = keymap.get_modifier_mask(Gdk.ModifierIntent.DEFAULT_MOD_MASK)
    // let [suc, rawMask] = keymap.map_virtual_modifiers(curState)
    // curState = rawMask;
    // const withVirtual = keymap.add_virtual_modifiers(mask)
    // curState = withVirtual;
    const removed = prevState & ~curState
    const added = curState & ~prevState
    // log("Added/removed", added, removed)
    trackedModifiers.forEach(([name, mask]) => {
        if (removed & mask) {
            // log(`Me.emit('modifier-up', ${name});`)
            Me.emit('modifier-up', mask, name, added);
        }
        if (added & mask) {
            // log(`Me.emit('modifier-down', ${name});`)
            Me.emit('modifier-down', mask, name, removed);
        }
    });
    prevState = curState;
}

var stateChangedId;

function enable() {
    Signals.addSignalMethods(Me)
    keymap = Gdk.Keymap.get_default();
    stateChangedId = keymap.connect(
        'state-changed',
        Utils.dynamic_function_ref(stateChangedHandler.name, Me)
    )

    // Me.connect('modifier-down', log.bind(log, "modifier-down"))
    // Me.connect('modifier-up', log.bind(log, "modifier-up"))
}

function disable() {
    keymap.disconnect(stateChangedId);
}

