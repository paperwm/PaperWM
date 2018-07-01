// -*- mode: gnome-shell -*-

var Meta = imports.gi.Meta;
var Clutter = imports.gi.Clutter;
var St = imports.gi.St;
var Tweener = imports.ui.tweener;
var Main = imports.ui.main;
var Shell = imports.gi.Shell;

// Extension local imports
var Extension = imports.misc.extensionUtils.getCurrentExtension();
var Me = Extension.imports.user;
var Tiling = Extension.imports.tiling;
var Utils = Extension.imports.utils;
var App = Extension.imports.app;

function init() {
    // Runs _only_ once on startup
}

function enable() {
    // Runs on extension reloads, eg. when unlocking the session
}

function disable() {
    // Runs on extension reloads eg. when locking the session (`<super>L).
}

