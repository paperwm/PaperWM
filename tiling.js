
glib = imports.gi.GLib

Tweener = imports.ui.tweener;
move = (actor, x, y) => {
    let buffer = actor.meta_window.get_buffer_rect();
    let frame = actor.meta_window.get_frame_rect();
    let x_offset = frame.x - buffer.x;
    let y_offset = frame.y - buffer.y;
    Tweener.addTween(actor, {x: x - x_offset
                             , y: y - y_offset
                             , time: 1
                             , onComplete: () => {
                                 actor.meta_window.move_frame(true, x, y);
                             }})

}

move(meta_window.get_compositor_private(), 400, 20)
//: t
move(pages[3].get_compositor_private(), 700, 500)
//: t

meta_window.get_frame_rect().x

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

    if (end > global.screen_width) {
        meta_window.move_frame(true, start - (end - global.screen_width) - 10
                               , meta_window.get_frame_rect().y)


    }
    else if (start < 0) {
        meta_window.move_frame(true, 10
                               , meta_window.get_frame_rect().y)
    }
}

ensure_viewport(pages[0])
//: t

focus_handler = (meta_window, user_data) => {
    let last = pages[focus]

    [start, end] = rect(meta_window)

    if (end > global.screen_width) {
        meta_window.
    }

    focus = pages.indexOf(meta_window)
}

focus_wrapper = (meta_window, user_data) => {
    focus_handler(meta_window, user_data)
}

// Run on new windows
global.display.connect("window-created", (display, meta_window) => {
    pages.splice(focus + 1, 0, meta_window)
    meta_window.connect("focus", focus_wrapper)
})

pages[1].move_frame(true, 0, 0)

let length = 0
pages.map((meta_window) => {
    let width = meta_window.get_frame_rect().width
    meta_window.move_resize_frame(true, length, 0, width, global.screen_height)
    length += width + 10
})



web = global.window_group.get_children()[3].meta_window

web.get_frame_rect().height
//: 707

web.move_resize_frame(true, -500, 20, web.get_frame_rect().width, web.get_frame_rect().height)

// Example to move a frame
win = global.window_group.get_children()[2]
metawin = win.get_meta_window()
metawin.move_resize_frame(false, global.screen_width + 20,30, 400, 700)

//: t


global.screen_width
//: 1346



nth_window
ensure_in_viewport()
goto_next
goto_prev

add_at_nth
destroy


move(meta_window, x)
resize


