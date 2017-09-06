// Some notes:
/* Signals:
   "window-added" (workspace)
   "window-removed" (workspace)

 */


overlap = 20

glib = imports.gi.GLib

Tweener = imports.ui.tweener;
move = (meta_window, x, y) => {
    let actor = meta_window.get_compositor_private()
    let buffer = actor.meta_window.get_buffer_rect();
    let frame = actor.meta_window.get_frame_rect();
    x = Math.min(global.screen_width - overlap*2, x)
    x = Math.max(0 - frame.width + overlap*2, x)
    let x_offset = frame.x - buffer.x;
    let y_offset = frame.y - buffer.y;
    Tweener.addTween(actor, {x: x - x_offset
                             , y: y - y_offset
                             , time: 1
                             , onComplete: () => {
                                 actor.meta_window.move_frame(true, x, y);
                             }})

}

timestamp = () => {
    return glib.get_monotonic_time()/1000
}

pages = []
focus = 0


rect = (meta_window) => {
    frame = meta_window.get_frame_rect()
    return [frame.x, frame.x + frame.width]
}


ensure_viewport = (meta_window) => {
    let [start, end] = rect(meta_window)

    let index = pages.indexOf(meta_window)
    if (end > global.screen_width) {
        let delta = start - (end - global.screen_width) - overlap
        propogate_forward(index + 1, global.screen_width)
        propogate_backward(index, global.screen_width - overlap)
    }
    else if (start < 0) {
        propogate_forward(index, overlap)
        propogate_backward(index - 1, -global.screen_width)
    }
}

focus_handler = (meta_window, user_data) => {

    ensure_viewport(meta_window)
    meta_window.activate(timestamp())

    focus = pages.indexOf(meta_window)
}

propogate_forward = (n, x) => {
    if (n < 0 || n >= pages.length)
        return
    print("positioning " + n)
    let meta_window = pages[n]
    move(meta_window, x, meta_window.get_frame_rect().y)
    propogate_forward(n+1, x+meta_window.get_frame_rect().width + overlap)
}
propogate_backward = (n, x) => {
    if (n < 0 || n >= pages.length)
        return
    print("positioning " + n)
    let meta_window = pages[n]
    x = x - meta_window.get_frame_rect().width
    move(meta_window, x, meta_window.get_frame_rect().y)
    propogate_backward(n-1, x - overlap)
}

focus_wrapper = (meta_window, user_data) => {
    focus_handler(meta_window, user_data)
}

// Run on new windows
// global.display.connect("window-created", (display, meta_window) => {
//     pages.splice(focus + 1, 0, meta_window)
//     meta_window.connect("focus", focus_wrapper)
// })

workspace = global.screen.get_active_workspace()
workspace.connect("window-added", (ws, meta_window) => {
    pages.splice(focus + 1, 0, meta_window)
    meta_window.connect("focus", focus_wrapper)
})

workspace.connect("window-removed", (ws, meta_window) => {
    pages.splice(pages.indexOf(meta_window), 1)
})


// pages[1].move_frame(true, 0, 0)

// let length = 0
// pages.map((meta_window) => {
//     let width = meta_window.get_frame_rect().width
//     meta_window.move_resize_frame(true, length, 0, width, global.screen_height)
//     length += width + 10
// })



// // web = global.window_group.get_children()[3].meta_window

// web.get_frame_rect().height
// //: 707

// web.move_resize_frame(true, -500, 20, web.get_frame_rect().width, web.get_frame_rect().height)

// // Example to move a frame
// win = global.window_group.get_children()[2]
// metawin = win.get_meta_window()
// metawin.move_resize_frame(false, global.screen_width + 20,30, 400, 700)

// //: t


// global.screen_width
// //: 1346



// nth_window
// ensure_in_viewport()
// goto_next
// goto_prev

// add_at_nth
// destroy


// move(meta_window, x)
// resize


