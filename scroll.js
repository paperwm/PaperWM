// -*- mode: gnome-shell; -*-

St = imports.gi.St;

box = new St.BoxLayout();

box.set_position(0,0);


attach = (wa) => {
    let wa_p = wa.get_position();
    let wa_s = wa.get_size();

    let mw = wa.get_meta_window();
    let frame = mw.get_frame_rect();
    let x_delta = frame.x - wa_p[0];
    let y_delta = frame.y - wa_p[1];

    let mg = wa.get_parent();
    mg.remove_child(wa);
    box.add_child(wa);
    mg.add_child(box);
    wa_p = wa.get_position();
    mw.move_frame(false, wa_p[0] + x_delta, wa_p[1] + y_delta);
};

global.get_window_actors().forEach(attach);

ma = global.get_window_actors()[2]
//: [0x4042800 MetaWindowActor]
mw = ma.get_meta_window();
//: [object instance proxy GType:MetaWindowX11 jsobj@0x7fca3517aac0 native@0x40ac460]
mw.get_title()
//: /home/hed/Downloads

frame = mw.get_frame_rect();
//: [boxed instance proxy GIName:Meta.Rectangle jsobj@0x7fca375d3eb0 native@0x4654fd0]

mw.get_compositor_private() === ma
//: true

ma.get_position()
//: 415,92
frame.x
//: 425
frame.y
//: 100

ma.get_size()
//: 402,542

frame.width
//: 382
frame.height
//: 524

ma.connect("allocation-changed", (actor, box ,flags, user_data) => {
    global.log("actor:");
    global.log(actor.get_size());

    let mwa = actor.get_meta_window();
    let buffer = mwa.get_buffer_rect();
    global.log("window:");
    global.log('' + buffer.width + ' ' + buffer.height);
})


mw.get_title()
//: ReferenceError: mw is not defined

buffer = mw.get_buffer_rect();

ma.get_size()
//: 682,614
buffer.height
buffer.width
//: 682


box.get_height()
//: 614
