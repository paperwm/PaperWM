Clutter = imports.gi.Clutter;
Tweener = imports.ui.tweener;
Lang = imports.lang;
Main = imports.ui.main;
Shell = imports.gi.Shell;

/*
  The stack overlay decorates the top stacked window with its icon and
  captures mouse input such that a mouse click only _activates_ the
  window. A very limited portion of the window is visible and due to
  the animation the button-up event will be triggered at an
  unpredictable position

  See #10
*/

/*
  Parent of the overlay?

  Most natural parent is the window actor, but then the overlay
  becomes visible in the clones too.

  Since the stacked windows doesn't really move it's not a big problem
  that the overlay doesn't track the window. The main challenge with
  using a different parent becomes controlling the "z-index".

  If I understand clutter correctly that can only be done by managing
  the order of the scene graph nodes. Descendants of node A will thus
  always be drawn in the same plane compared to a non-descendants.

  The overlay thus have to be parented to `global.window_group`. One
  would think that was ok, but unfortunately mutter keeps syncing the
  window_group with the window stacking and in the process destroy the
  stacking of any non-window actors.

  Adding a "clutter restack" to the `MetaScreen` `restacked` signal
  seems keep the stacking in sync (without entering into infinite
  restack loops)
*/

StackOverlay = new Lang.Class({
    Name: 'Stackoverlay',
    _init: function(metaWindow) {

    },
});

createAppIcon = function(metaWindow, size) {
    let tracker = Shell.WindowTracker.get_default();
    let app = tracker.get_window_app(metaWindow);
    let appIcon = app ? app.create_icon_texture(size)
        : new St.Icon({ icon_name: 'icon-missing',
                        icon_size: size });
    appIcon.x_expand = appIcon.y_expand = true;
    appIcon.x_align = appIcon.y_align = Clutter.ActorAlign.END;

    return appIcon;
}

function createStackoverlay(metaWindow) {
    if (metaWindow.stackOverlay)
        metaWindow.stackOverlay.destroy();

    let actor = metaWindow.get_compositor_private();

    let overlay = new Clutter.Actor({ reactive: true
                                      , name: "stack-overlay" });
    metaWindow.stackOverlay = overlay;
    overlay.connect('button-press-event', () => {
        return true;
    });
    overlay.connect('button-release-event', () => {
        Main.activateWindow(metaWindow);
        overlay.destroy();
        return true;
    });
    overlay.opacity = 255

    let offset = calcOffset(metaWindow)
    let dx = offset[0];
    let dy = offset[1];

    overlay.width = stack_margin;
    overlay.height = metaWindow.get_frame_rect().height * actor.scale_y;

    let icon = createAppIcon(metaWindow, margin_lr)
    overlay.add_child(icon)

    overlay.y = actor.y + dy;
    icon.y = 4;

    let iconMargin = 2;

    if (actor.x < 0) {
        overlay.x = 0;
        icon.x = iconMargin;
    } else {
        overlay.x = primary.width - overlay.width;
        icon.x = overlay.width - margin_lr - iconMargin; // Assume icon with == margin_lr
    }

    global.window_group.insert_child_above(overlay, actor);

    Main.layoutManager._trackActor(overlay)

    // We must "restack" the overlay each time mutter does a window restack :(
    // NOTE: Should probably use _one_ callback for all non-window
    // actors we need to keep stacked in window_group, but this works
    // for now
    global.screen.connect("restacked", () => {
        global.window_group.set_child_above_sibling(overlay, actor)
    });
}

function repl() {
    createStackoverlay(metaWindow);

    global.window_group.set_child_below_sibling(metaWindow.stackOverlay, actor);

    global.window_group.get_children();
}
