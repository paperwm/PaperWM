import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { AcceleratorParse } from './acceleratorparse.js';

/**
    Settings utility shared between the running extension and the preference UI.
    settings.js shouldn't depend on other modules (e.g with `imports` for other modules
    at the top).
 */

const KEYBINDINGS_KEY = 'org.gnome.shell.extensions.paperwm.keybindings';
const RESTORE_KEYBINDS_KEY = 'restore-keybinds';

// This is the value mutter uses for the keyvalue of above_tab
const META_KEY_ABOVE_TAB = 0x2f7259c9;

// position to open window at (e.g. to the right of current window)
export const OpenWindowPositions = { RIGHT: 0, LEFT: 1, START: 2, END: 3 };

// Animation used when ensuring viewport on a window
export const EnsureViewportAnimation = { NONE: 0, TRANSLATE: 1, FADE: 2 };

export let prefs;
let gsettings, keybindSettings, _overriddingConflicts;
let acceleratorParse;
export function enable(extension) {
    gsettings = extension.getSettings();
    keybindSettings = extension.getSettings(KEYBINDINGS_KEY);

    acceleratorParse = new AcceleratorParse();
    _overriddingConflicts = false;
    prefs = {};
    [
        'window-gap', 'vertical-margin', 'vertical-margin-bottom', 'horizontal-margin',
        'workspace-colors', 'default-background', 'animation-time', 'default-show-top-bar',
        'swipe-sensitivity', 'swipe-friction', 'cycle-width-steps', 'cycle-height-steps',
        'maximize-width-percent', 'minimap-scale', 'edge-preview-scale',
        'window-switcher-preview-scale', 'winprops', 'show-workspace-indicator',
        'show-window-position-bar', 'show-focus-mode-icon', 'disable-topbar-styling',
        'default-focus-mode', 'gesture-enabled', 'gesture-horizontal-fingers',
        'gesture-workspace-fingers', 'open-window-position',
        'overview-ensure-viewport-animation']
        .forEach(k => setState(null, k));
    prefs.__defineGetter__("minimum_margin", () => {
        return Math.min(15, prefs.horizontal_margin);
    });
    gsettings.connect('changed', setState);

    // connect to settings and update winprops array when it's updated
    gsettings.connect('changed::winprops', () => reloadWinpropsFromGSettings());

    // A intermediate window is created before the prefs dialog is created.
    // Prevent it from being inserted into the tiling causing flickering and general disorder
    defwinprop({
        wm_class: "Gnome-shell-extension-prefs",
        scratch_layer: true,
        focus: true,
    });
    defwinprop({
        wm_class: /gnome-screenshot/i,
        scratch_layer: true,
        focus: true,
    });

    addWinpropsFromGSettings();
}

export function disable() {
    gsettings = null;
    acceleratorParse = null;
    _overriddingConflicts = null;
    prefs = null;
    conflictSettings = null;
}

export function setState($, key) {
    let value = gsettings.get_value(key);
    let name = key.replace(/-/g, '_');
    prefs[name] = value.deep_unpack();
}

export let conflictSettings; // exported
export function getConflictSettings() {
    if (!conflictSettings) {
        // Schemas that may contain conflicting keybindings
        conflictSettings = [];
        addSchemaToConflictSettings('org.gnome.mutter.keybindings');
        addSchemaToConflictSettings('org.gnome.mutter.wayland.keybindings');
        addSchemaToConflictSettings('org.gnome.desktop.wm.keybindings');
        addSchemaToConflictSettings('org.gnome.shell.keybindings');

        // below schemas are checked but may not exist in all distributions
        addSchemaToConflictSettings('org.gnome.settings-daemon.plugins.media-keys', false);
        // ubuntu tiling-assistant (enabled by default on Ubuntu 23.10)
        addSchemaToConflictSettings('org.gnome.shell.extensions.tiling-assistant', false);
    }

    return conflictSettings;
}

/**
 * Adds a Gio.Settings object to conflictSettings.  Fails gracefully.
 * @param {Gio.Settings} schemaId
 */
export function addSchemaToConflictSettings(schemaId, warn = true) {
    try {
        conflictSettings.push(new Gio.Settings({ schema_id: schemaId }));
    }
    catch (e) {
        if (warn) {
            console.warn(`Invalid schema_id '${schemaId}': could not add to keybind conflict checks`);
        }
    }
}

// / Keybindings

export function accelerator_parse(keystr) {
    return acceleratorParse.accelerator_parse(keystr);
}

/**
 * Two keystrings can represent the same key combination
 */
export function keystrToKeycombo(keystr) {
    // Above_Tab is a fake keysymbol provided by mutter
    let aboveTab = false;
    if (keystr.match(/Above_Tab/) || keystr.match(/grave/)) {
        keystr = keystr.replace('Above_Tab', 'a');
        aboveTab = true;
    }

    let [ok, key, mask] = accelerator_parse(keystr);

    if (aboveTab)
        key = META_KEY_ABOVE_TAB;
    return `${key}|${mask}`; // Since js doesn't have a mapable tuple type
}

export function generateKeycomboMap(settings) {
    let map = {};
    for (let name of settings.list_keys()) {
        let value = settings.get_value(name);
        if (value.get_type_string() !== 'as')
            continue;

        for (let combo of value.deep_unpack().map(keystrToKeycombo)) {
            if (combo === '0|0')
                continue;
            if (map[combo]) {
                map[combo].push(name);
            } else {
                map[combo] = [name];
            }
        }
    }
    return map;
}

export function findConflicts(schemas) {
    schemas = schemas || getConflictSettings();
    let conflicts = [];
    const paperMap = generateKeycomboMap(keybindSettings);

    for (let settings of schemas) {
        const against = generateKeycomboMap(settings);
        for (let combo in paperMap) {
            if (against[combo]) {
                conflicts.push({
                    name: paperMap[combo][0],
                    conflicts: against[combo],
                    settings, combo,
                });
            }
        }
    }
    return conflicts;
}

/**
 * Returns / reconstitutes saved overrides list.
 */
export function getSavedOverrides() {
    let saveListJson = gsettings.get_string(RESTORE_KEYBINDS_KEY);
    let saveList;
    try {
        saveList = new Map(Object.entries(JSON.parse(saveListJson)));
    } catch (error) {
        saveList = new Map();
    }
    return saveList;
}

/**
 * Saves an overrides list.
 */
export function saveOverrides(overrides) {
    gsettings.set_string(RESTORE_KEYBINDS_KEY, JSON.stringify(Object.fromEntries(overrides)));
}

export function conflictKeyChanged(settings, key) {
    if (_overriddingConflicts) {
        return;
    }

    const newKeybind = settings.get_value(key).deep_unpack();
    if (Array.isArray(newKeybind) && newKeybind.length === 0) {
        return;
    }

    const saveList = getSavedOverrides();
    saveList.delete(key);
    saveOverrides(saveList);

    // check for new conflicts
    return overrideConflicts(key);
}

/**
 * Override conflicts and save original values for restore.
 */
export function overrideConflicts(checkKey = null) {
    if (_overriddingConflicts) {
        return;
    }

    _overriddingConflicts = true;
    let saveList = getSavedOverrides();

    // restore orignal keybinds prior to conflict overriding
    restoreConflicts();

    let disableAll = [];
    const foundConflicts = findConflicts();
    for (let conflict of foundConflicts) {
        // save conflicts (list of names of conflicting keybinds)
        let { name, conflicts, settings } = conflict;

        conflicts.forEach(c => {
            // get current value
            const keybind = settings.get_value(c);
            saveList.set(c, {
                bind: JSON.stringify(keybind.deep_unpack()),
                schema_id: settings.schema_id,
            });

            // now disable conflict
            disableAll.push(() => settings.set_value(c, new GLib.Variant('as', [])));
        });
    }

    // save override list
    saveOverrides(saveList);

    // now disable all conflicts
    disableAll.forEach(d => d());
    _overriddingConflicts = false;

    return checkKey ? saveList.has(checkKey) : false;
}

/**
 * Update overrides to their current keybinds.
 */
export function updateOverrides() {
    let saveList = getSavedOverrides();
    saveList.forEach((saved, key) => {
        const settings = getConflictSettings().find(s => s.schema_id === saved.schema_id);
        if (settings) {
            const newKeybind = settings.get_value(key).deep_unpack();
            if (Array.isArray(newKeybind) && newKeybind.length === 0) {
                return;
            }

            saveList.set(key, {
                bind: JSON.stringify(newKeybind),
                schema_id: settings.schema_id,
            });
        }
    });

    // save override list
    saveOverrides(saveList);
}

/**
 * Restores previously overridden conflicts.
 */
export function restoreConflicts() {
    let saveList = getSavedOverrides();
    const toRemove = [];
    saveList.forEach((saved, key) => {
        const settings = getConflictSettings().find(s => s.schema_id === saved.schema_id);
        if (settings) {
            const keybind = JSON.parse(saved.bind);
            toRemove.push({ key, remove: () => settings.set_value(key, new GLib.Variant('as', keybind)) });
        }
    });

    // now remove retored keybinds from list
    toRemove.forEach(r => {
        r.remove();
        saveList.delete(r.key);
    });
    saveOverrides(saveList);
}

// / Winprops

/**
   Modelled after notion/ion3's system

   Examples:

   defwinprop({
     wm_class: "Riot",
     scratch_layer: true
   })
*/
export let winprops = [];
export function winprop_match_p(meta_window, prop) {
    let wm_class = meta_window.wm_class || "";
    let title = meta_window.title;
    if (prop.wm_class) {
        if (prop.wm_class instanceof RegExp) {
            if (!wm_class.match(prop.wm_class))
                return false;
        } else if (prop.wm_class !== wm_class) {
            return false;
        }
    }
    if (prop.title) {
        if (prop.title instanceof RegExp) {
            if (!title.match(prop.title))
                return false;
        } else if (prop.title !== title)
            return false;
    }

    return true;
}

export function find_winprop(meta_window)  {
    // sort by title first (prioritise title over wm_class)
    let props = winprops.filter(winprop_match_p.bind(null, meta_window));

    // if matching props found, return first one
    if (props.length > 0) {
        return props[0];
    }

    // fall back, if star (catch-all) winprop exists, return the first one
    let starProps = winprops.filter(w => w.wm_class === "*" || w.title === "*");
    if (starProps.length > 0) {
        return starProps[0];
    }

    return null;
}

export function defwinprop(spec) {
    // process preferredWidth - expects inputs like 50% or 400px
    if (spec.preferredWidth) {
        spec.preferredWidth = {
            // value is first contiguous block of digits
            // eslint-disable-next-line no-new-wrappers
            value: new Number((spec.preferredWidth.match(/\d+/) ?? ['0'])[0]),
            // unit is first contiguous block of apha chars or % char
            unit: (spec.preferredWidth.match(/[a-zA-Z%]+/) ?? ['NO_UNIT'])[0],
        };
    }

    /**
     * we order specs with gsettings rirst ==> gsetting winprops take precedence
     * over winprops defined in user.js.  This was done since gsetting winprops
     * are easier to add/remove (and can be added/removed/edited instantly without
     * restarting shell).
     */
    // add winprop
    winprops.push(spec);

    // now order winprops with gsettings first, then title over wm_class
    winprops.sort((a, b) => {
        let firstresult = 0;
        if (a.gsetting && !b.gsetting) {
            firstresult = -1;
        }
        else if (!a.gsetting && b.gsetting) {
            firstresult = 1;
        }

        // second compare, prioritise title
        let secondresult = 0;
        if (a.title && !b.title) {
            secondresult = -1;
        }
        else if (!a.title && b.title) {
            secondresult = 1;
        }

        return firstresult || secondresult;
    });
}

/**
 * Adds user-defined winprops from gsettings (as defined in
 * org.gnome.shell.extensions.paperwm.winprops) to the winprops array.
 */
export function addWinpropsFromGSettings() {
    // add gsetting (user config) winprops
    gsettings.get_value('winprops').deep_unpack()
        .map(value => JSON.parse(value))
        .forEach(prop => {
            // test if wm_class or title is a regex expression
            if (/^\/.+\/[igmsuy]*$/.test(prop.wm_class)) {
                // extract inner regex and flags from wm_class
                let matches = prop.wm_class.match(/^\/(.+)\/([igmsuy]*)$/);
                let inner = matches[1];
                let flags = matches[2];
                prop.wm_class = new RegExp(inner, flags);
            }
            if (/^\/.+\/[igmsuy]*$/.test(prop.title)) {
                // extract inner regex and flags from title
                let matches = prop.title.match(/^\/(.+)\/([igmsuy]*)$/);
                let inner = matches[1];
                let flags = matches[2];
                prop.title = new RegExp(inner, flags);
            }
            prop.gsetting = true; // set property that is from user gsettings
            defwinprop(prop);
        });
}

/**
 * Removes winprops with the `gsetting:true` property from the winprops array.
 */
export function removeGSettingWinpropsFromArray() {
    winprops = winprops.filter(prop => !prop.gsetting ?? true);
}

/**
 * Effectively reloads winprops from gsettings.
 * This is a convenience function which removes gsetting winprops from winprops
 * array and then adds the currently defined
 * org.gnome.shell.extensions.paperwm.winprops winprops.
 */
export function reloadWinpropsFromGSettings() {
    removeGSettingWinpropsFromArray();
    addWinpropsFromGSettings();
}
