#!/usr/bin/env gjs

/*
Create a window with given size constraints

Run it with:
    gjs $FILENAME
*/

const Gio   = imports.gi.Gio;
const GLib  = imports.gi.GLib;
const Gtk   = imports.gi.Gtk;
const Gdk   = imports.gi.Gdk;
const Lang  = imports.lang;

const App = function () { 
    let args = ARGV.slice();
    if (args[0] === "--paint-delay") {
        this.paintDelay = parseInt(ARGV[1]);
        args = args.slice(2);
    }

    if (args.length % 2 === 1) {
        this.title = args[args.length-1]
        args.splice(args.length-1, 1);
    } else {
        this.title = `Constrained window`;
    }

    this.hintsRaw = args;

    GLib.set_prgname(this.title);
};

App.prototype.run = function (ARGV) {

    this.application = new Gtk.Application();
    this.application.connect('activate', () => { this.onActivate(); });
    this.application.connect('startup', () => { this.onStartup(); });
    this.application.run([]);
};

App.prototype.onActivate = function () {

    this.window.show_all();
};

App.prototype.onStartup = function() {
    this.buildUI();
};

App.prototype.buildUI = function() {
    this.window = new Gtk.ApplicationWindow({ application: this.application,
                                              title: this.title,
                                              default_height: 200,
                                              default_width: 200,
                                              window_position: Gtk.WindowPosition.CENTER });

    let {hints, flags} = parseHints(this.hintsRaw);
    this.window.set_geometry_hints(null, hints, flags);

    let infoLines = [];
    if (this.paintDelay) {
        infoLines.push(`  paint-delay: ${this.paintDelay}`)
    }
    for (let i = 0; i < this.hintsRaw.length; i += 2) {
        infoLines.push(`  ${this.hintsRaw[i]}: ${this.hintsRaw[i+1]}`);
    }

    let infoLabel = new Gtk.Label({label: infoLines.join("\n")})
    // Adding the info label directly creates a min-width constrain
    let scroll = new Gtk.Layout();
    scroll.add(infoLabel);
    this.window.add(scroll);

    if (this.paintDelay) {
        this.window.connect('draw', () => {
            GLib.usleep(1000*this.paintDelay);
        })
    }
};


let flagOfHint = {
    min_width: Gdk.WindowHints.MIN_SIZE,
    min_height: Gdk.WindowHints.MIN_SIZE,

    max_width: Gdk.WindowHints.MAX_SIZE,
    max_height: Gdk.WindowHints.MAX_SIZE,

    base_width: Gdk.WindowHints.BASE_SIZE,
    base_height: Gdk.WindowHints.BASE_SIZE,

    width_inc: Gdk.WindowHints.RESIZE_INC,
    height_inc: Gdk.WindowHints.RESIZE_INC,

    min_aspect: Gdk.WindowHints.ASPECT,
    max_aspect: Gdk.WindowHints.ASPECT,
}

function parseHints(args) {
    // NB: the supposed to work -1 values for the hints doesn't work.. Provide
    // default values that represent 0 and "infinty" instead
    let hints = new Gdk.Geometry({min_width: 0, min_height: 0, max_width: 999999, max_height: 999999, base_width: -1, base_height: -1, width_inc: 1, height_inc: 1, min_aspect: 0, max_aspect: 999999});
    let flags = 0;

    for (let i = 0; i < args.length-1; i+=2) {
        let name = args[i];
        let value = args[i+1];
        hints[name] = parseFloat(value);
        flags |= flagOfHint[name];
    }

    return {hints, flags};
}

if (ARGV[0] === "--help") {
    print("usage: [--paint-delay DELAY_MS] [HINT VALUE ...] [WINDOW_TITLE]");
    print("Hints:");
    print(Object.keys(flagOfHint).join("\n"));
} else {
    let app = new App();
    app.run();
}

