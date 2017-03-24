
// utility to tile all windows

St = imports.gi.St;

// St.set_slow_down_factor(2)

box = new St.BoxLayout();
global.window_group.add_child(box);

// windows are bound by the shape they were
y_offset = 14;
box.set_position(0,y_offset);

align_frame = (actor) => {

    let win = actor.get_meta_window()
    let title = win.get_title()
    global.log(title)
    // global.log(actor)
    // global.log(win)
    if (title === "gnome-shell")
        return true;

    let frame = win.get_frame_rect();
    let buffer = win.get_buffer_rect();

    // frame is the window without decorations
    let xDelta = frame.x - buffer.x;
    // buffer is included decorations
    let yDelta = frame.y - buffer.y;

    let xOffset = box.get_position()[0]
    let yOffset = box.get_position()[1]

    global.log("xOffset:" + xOffset)
    global.log("xdelta:" + xDelta)
    global.log("ydelta:" + yDelta)

    let position = actor.get_position();
    let size = actor.get_size();
    let newX = position[0] + xDelta + xOffset;
    let newY = position[1] + yDelta + yOffset;
    global.log("x: " + newX)
    global.log("y: " + newY)
    win.move_frame(true, newX, newY);
    return true
}

attach = (wa) => {
    let wa_p = wa.get_position();
    let wa_s = wa.get_size();

    let title = wa.get_meta_window().get_title();
    if (title === "gnome-shell")
        return

    let mg = wa.get_parent();
    mg.remove_child(wa);
    box.add_actor(wa);
    wa_p = wa.get_position();
}

global.get_window_actors().forEach(attach);
box.get_children().forEach(align_frame)

move_left = () => {
    position = box.get_position();
    box.set_position(position[0] - 10, position[1]);
}
move_right = () => {
    position = box.get_position();
    box.set_position(position[0] + 10, position[1]);
}
box.get_children().forEach(align_frame);

move_right()
move_left()
