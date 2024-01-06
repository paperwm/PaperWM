// Ressources:
// - https://gjs.guide/guides/gio/dbus.html#introduction-to-d-bus
// - https://dbus.freedesktop.org/doc/dbus-api-design.html
// - https://gitlab.gnome.org/GNOME/gnome-shell/-/tree/main/data/dbus-interfaces
// - https://gjs-docs.gnome.org/gio20~2.0/gio.bus_own_name
// - https://docs.gtk.org/glib/gvariant-format-strings.html (dbus does not support maybe/nullable types)
// - https://docs.gtk.org/glib/gvariant-text.html
// - https://dbus.freedesktop.org/doc/dbus-specification.html
// - https://dbus.freedesktop.org/doc/dbus-specification.html#type-system
// - https://www.baeldung.com/linux/dbus
// - D-Spy, dbus-monitor, dbus-send

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { Tiling, Keybindings, Utils } from './imports.js';
import * as Imports from './imports.js';

// used as the well known name and as the interface name in DBus
const DBUS_NAME = "org.github.PaperWM";
const DBUS_PATH = "/org/github/PaperWM"
const DBUS_INTERFACE_DIR = "./dbus";

let serviceInstance = null;
let spaceInstances = null;
let dbusConnection = null;
let dbusOwnerId;

export function enable() {
    console.debug(`#PaperWM: Registering DBus interface: ${DBUS_NAME} on path ${DBUS_PATH}`);
    try {
        dbusOwnerId = Gio.bus_own_name(
            Gio.BusType.SESSION,
            DBUS_NAME,
            Gio.BusNameOwnerFlags.DO_NOT_QUEUE,
            onBusAcquired,
            onNameAcquired,
            null,
        );
        console.debug(`#PaperWM: dbusOwnerId=${dbusOwnerId}`);
    } catch (e) {
        console.error("#PaperWM: Failed to own DBus name.")
        console.error(e);
    }
}

export function disable() {
    try {
        Gio.bus_unown_name(dbusOwnerId);
    } catch (e) {
        console.error("#PaperWM: Failed to unown DBus name.")
        console.error(e);
    }

    dbusConnection = null;
    serviceInstance.destroy();
    serviceInstance = null;
    spaceInstances = null;
}

/**
 * Invoked when a connection to a message bus has been obtained.
 *
 * If there is a client waiting for the well-known name to appear on the bus,
 * you probably want to export your interfaces here. This way the interfaces
 * are ready to be used when the client is notified the name has been owned.
 *
 * @param {Gio.DBusConnection} connection - the connection to a message bus
 * @param {string} name - the name that is requested to be owned
 */
function onBusAcquired(connection, name) {
    console.log(`${name}: connection acquired`);
    dbusConnection = connection;
    console.log(connection);

    serviceInstance = new PaperWMService();
    exportDBusObject("org.github.PaperWM", serviceInstance, DBUS_PATH);

    spaceInstances = new Map();
    for (const key of Tiling.spaces.keys()) {
        const i = key.index();
        spaceInstances[i] = new DBusSpace(i);
        exportDBusObject("org.github.PaperWM.Space", spaceInstances[i], DBUS_PATH + "/spaces/" + i);
    }
}

function exportDBusObject(interfaceName, object, dbusPath) {
    const xmlPath = DBUS_INTERFACE_DIR + "/" + interfaceName + ".xml";
    const uri = GLib.uri_resolve_relative(import.meta.url, xmlPath, GLib.UriFlags.NONE);
    const file = Gio.File.new_for_uri(uri);
    const [success, xmlContent, _etag] = file.load_contents(null);
    if (!success) {
        throw Error("Failed to read dbus interface definition from xml file.");
    }
    const xmlString = new TextDecoder("utf-8").decode(xmlContent);

    // Create the class instance, then the D-Bus object
    const exportedObject = Gio.DBusExportedObject.wrapJSObject(xmlString, object);

    // Assign the exported object to the property the class expects, then export
    object._impl = exportedObject;
    exportedObject.export(dbusConnection, dbusPath);
}

/**
 * Invoked when the name is acquired.
 *
 * On the other hand, if you were using something like GDBusObjectManager to
 * watch for interfaces, you could export your interfaces here.
 *
 * @param {Gio.DBusConnection} connection - the connection that acquired the name
 * @param {string} name - the name being owned
 */
function onNameAcquired(connection, name) {
    console.log(`${name}: name acquired`);
    // TODO maybe use Gio.DBusObjectManager here
}

class DBusSpace {
    // NOTE: this._impl is set to the exported DBus service before any of the
    // methods are called.

    constructor(i) {
        this.i = i;
    }

    space() {
        return Tiling.spaces.spaceOfIndex(this.i);
    }

    // Properties
    get Name() {
        return GLib.Variant.new_string(this.space().name);
    }

    // Methods
    Activate() {
        console.log(`DBusSpace(${this.i}).Activate() invoked`);
        this.space().activate();
    }
}


class PaperWMService {
    // NOTE: this._impl is set to the exported DBus service before any of the
    // methods are called.

    constructor() {
        this.undos = new Array();

        this.signals = new Utils.Signals();

        // Need to use this signal as space::window-added does not contain
        // e.g. wm_class.
        this.signals.connect(
            Tiling.spaces, "window-first-frame",
            (_spaces, metaWindow) => {
                const space = Tiling.spaces.spaceOfWindow(metaWindow);
                this._impl.emit_signal('WindowAdded',
                    new GLib.Variant('(ssiiibbbb)', [
                        metaWindow.wm_class ?? "",
                        metaWindow.title ?? "",
                        space.index ?? -1,
                        space.indexOf(metaWindow) ?? -1,
                        space.rowOf(metaWindow) ?? -1,
                        Tiling.isFloating(metaWindow),
                        Tiling.isScratch(metaWindow),
                        Tiling.isTransient(metaWindow),
                        Tiling.isTiled(metaWindow),
                    ]));
            }
        );
    }

    destroy() {
        this.signals.destroy();
    }

    // Properties
    get ReadOnlyProperty() {
        return GLib.Variant.new_string('a string');
    }

    get ReadWriteProperty() {
        if (this._readWriteProperty === undefined)
            return false;

        return this._readWriteProperty;
    }

    set ReadWriteProperty(value) {
        if (this._readWriteProperty === value)
            return;

        this._readWriteProperty = value;
        this._impl.emit_property_changed('ReadWriteProperty',
            GLib.Variant.new_boolean(this.ReadWriteProperty));
    }

    // Methods
    ListSpaces() {
        return spaceInstances.entries().map((index, space) => `/org/github/PaperWM/spaces/${index}`);
    }

    ListActions() {
        return Keybindings.getAllMutterNames();
    }

    TriggerAction(name) {
        const action = Keybindings.byMutterName(name);
        const binding = {
            get_name: () => name,
            get_mask: () => 0,
            is_reversed: () => false,
        };
        action.keyHandler(global.display, global.display.get_focus_window(), binding);
    }

    /**
     * Eval `input` as a function.
     *
     * If the function returns a functions it will be registered and can later be
     * called using `UndoEval`. If the function returns something else it will
     * be returned as a string. Most likely you want to manually create a string
     * to get the correct representation.
     *
     * Usage (over DBus):
     *
     * ```
     * const [undoId, _output] = Eval('console.log("hi"); global.x = 1; () => { global.x = undefined; };');
     * UndoEval(undoId);
     *
     * const [_undoId, output] = Eval('console.log("hi"); global.x = 1; return "something";');
     * // assert output == "something";
     * ```
     */
    Eval(input) {
        console.debug(`Service.Eval() invoked with '${input}'`);

        const f = new Function(input);
        const undoF = f(Imports);
        const undoIndex = this.undos.length;
        if (typeof undoF === "function") {
            this.undos.push(undoF);
            return new GLib.Variant("(is)", [undoIndex, ""]);
        } else {
            this.undos.push(null);
            return new GLib.Variant("(is)", [undoIndex, undoF]);
        }
    }

    UndoEval(undoId) {
        if (undoId >= this.undos.length) {
            throw new Error("Invalid undoId.");
        }
        const undoF = this.undos[undoId];
        if (undoF === null) {
            // already used or no undo function registered
            throw new Error("Invalid undoId.");
        }
        undoF();
        this.undos[undoId] = null;
    }

    // Signals
    emitTestSignal(value) {
        this._impl.emit_signal('TestSignal',
            new GLib.Variant('(sb)', [value, true]));
    }
}
