// -*- mode: gnome-shell -*-

var Meta = imports.gi.Meta;
var Clutter = imports.gi.Clutter;
var St = imports.gi.St;
var Tweener = imports.ui.tweener;
var Main = imports.ui.main;
var Shell = imports.gi.Shell;

// Extension local imports
var Extension, Me, Tiling, Utils, App;

function init() {
    // Runs _only_ once on startup

    // Initialize extension imports here to make gnome-shell-reload work
    Extension = imports.misc.extensionUtils.getCurrentExtension();
    Me = Extension.imports.user;
    Tiling = Extension.imports.tiling;
    Utils = Extension.imports.utils;
    App = Extension.imports.app;
}

function enable() {
    // Runs on extension reloads, eg. when unlocking the session
}

function disable() {
    // Runs on extension reloads eg. when locking the session (`<super>L).
}

