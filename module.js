var ExtensionUtils = imports.misc.extensionUtils;
var Extension = ExtensionUtils.getCurrentExtension();

function ExtensionModule() {
    return Extension.imports.extension;
}

function Utils() {
    return Extension.imports.utils;
}

function Signals() {
    return new Extension.imports.utils.Signals();
}

function Settings() {
    return Extension.imports.settings;
}

function Tiling() {
    return Extension.imports.tiling;
}

function Navigator() {
    return Extension.imports.navigator;
}

function Keybindings() {
    return Extension.imports.keybindings;
}

function Scratch() {
    return Extension.imports.scratch;
}

function LiveAltTab() {
    return Extension.imports.liveAltTab;
}

function Stackoverlay() {
    return Extension.imports.stackoverlay;
}

function App() {
    return Extension.imports.app;
}

function Kludges() {
    return Extension.imports.kludges;
}

function TopBar() {
    return Extension.imports.topbar;
}

function Gestures() {
    return Extension.imports.gestures;
}

function Grab() {
    return Extension.imports.grab;
}
