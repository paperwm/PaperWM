
const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const Meta = imports.gi.Meta;
const AltTab = imports.ui.altTab;
const Main = imports.ui.main;
let WindowManager = imports.ui.windowManager;

WindowManager.WindowManager.prototype._previewWorkspace = function(from, to, direction) {

    let windows = global.get_window_actors();

    /* @direction is the direction that the "camera" moves, so the
     * screen contents have to move one screen's worth in the
     * opposite direction.
     */
    let xDest = 0, yDest = 0;

    if (direction == Meta.MotionDirection.UP ||
        direction == Meta.MotionDirection.UP_LEFT ||
        direction == Meta.MotionDirection.UP_RIGHT)
        yDest = global.screen_height - Main.panel.actor.height;
    else if (direction == Meta.MotionDirection.DOWN ||
             direction == Meta.MotionDirection.DOWN_LEFT ||
             direction == Meta.MotionDirection.DOWN_RIGHT)
        yDest = -global.screen_height + Main.panel.actor.height;

    if (direction == Meta.MotionDirection.LEFT ||
        direction == Meta.MotionDirection.UP_LEFT ||
        direction == Meta.MotionDirection.DOWN_LEFT)
        xDest = global.screen_width;
    else if (direction == Meta.MotionDirection.RIGHT ||
             direction == Meta.MotionDirection.UP_RIGHT ||
             direction == Meta.MotionDirection.DOWN_RIGHT)
        xDest = -global.screen_width;

    let switchData = {};
    this._switchData = switchData;
    switchData.inGroup = new Clutter.Actor();
    switchData.outGroup = new Clutter.Actor();
    switchData.movingWindowBin = new Clutter.Actor();
    switchData.windows = [];

    let wgroup = global.window_group;
    wgroup.add_actor(switchData.inGroup);
    wgroup.add_actor(switchData.outGroup);
    wgroup.add_actor(switchData.movingWindowBin);

    for (let i = 0; i < windows.length; i++) {
        let actor = windows[i];
        let window = actor.get_meta_window();

        if (!window.showing_on_its_workspace())
            continue;

        if (window.is_on_all_workspaces())
            continue;

        let record = { window: actor,
                       parent: actor.get_parent() };

        if (this._movingWindow && window == this._movingWindow) {
            switchData.movingWindow = record;
            switchData.windows.push(switchData.movingWindow);
            actor.reparent(switchData.movingWindowBin);
        } else if (window.get_workspace().index() == from) {
            switchData.windows.push(record);
            actor.reparent(switchData.outGroup);
        } else if (window.get_workspace().index() == to) {
            switchData.windows.push(record);
            actor.reparent(switchData.inGroup);
            actor.show();
        }
    }

    switchData.inGroup.set_position(-xDest, -yDest);
    switchData.inGroup.raise_top();

    switchData.movingWindowBin.raise_top();

    Tweener.addTween(switchData.outGroup,
                     { x: xDest,
                       y: yDest,
                       time: 0.25,
                       transition: 'easeInOutQuad',
                     });
    Tweener.addTween(switchData.inGroup,
                     { x: 0,
                       y: 0,
                       time: 0.25,
                       transition: 'easeInOutQuad'
                     });
}


WindowManager.WindowManager.prototype._previewWorkspaceDone = function() {
    let switchData = this._switchData;
    if (!switchData)
        return;
    this._switchData = null;

    for (let i = 0; i < switchData.windows.length; i++) {
        let w = switchData.windows[i];
        if (w.window.is_destroyed()) // Window gone
            continue;
        if (w.window.get_parent() == switchData.outGroup) {
            w.window.reparent(w.parent);
            w.window.hide();
        } else
            w.window.reparent(w.parent);
    }
    Tweener.removeTweens(switchData.inGroup);
    Tweener.removeTweens(switchData.outGroup);
    switchData.inGroup.destroy();
    switchData.outGroup.destroy();
    switchData.movingWindowBin.destroy();

    if (this._movingWindow)
        this._movingWindow = null;
}
