/*
  Navigation and previewing functionality.
 */

var Extension = imports.misc.extensionUtils.extensions['paperwm@hedning:matrix.org'];
var SwitcherPopup = imports.ui.switcherPopup;
var Lang = imports.lang;
var Meta = imports.gi.Meta;
var Main = imports.ui.main;
var Clutter = imports.gi.Clutter;
var Tweener = imports.ui.tweener;
var Signals = imports.signals;

var TopBar = Extension.imports.topbar;
var Scratch = Extension.imports.scratch;
var Minimap = Extension.imports.minimap;
var Tiling = Extension.imports.tiling;
var utils = Extension.imports.utils;
var debug = utils.debug;

var prefs = Extension.imports.prefs.prefs;

var scale = 0.9;
var navigating = false;
var workspaceMru = false;

// Dummy class to satisfy `SwitcherPopup.SwitcherPopup`
class SwitcherList {
    constructor() {
        this.actor = new Clutter.Actor();
    }
}
Signals.addSignalMethods(SwitcherList.prototype);

var PreviewedWindowNavigator = new Lang.Class({
    Name: 'PreviewedWindowNavigator',
    Extends: SwitcherPopup.SwitcherPopup,

    _yPositions: [0.95, 0.10, 0.035, 0.01],

    _init: function() {
        // Do the absolute minimal here, as `parent.show` is buggy and can
        // return early making cleanup hard. We do most initialization in
        // `_initialSelection` instead.

        // HACK: workaround to enable moving from empty workspace. See check in
        // SwitcherPopup.show
        this.parent([1]);
        this._switcherList = new SwitcherList();
        debug('#preview', 'init', this._switcherList);

    },

    _next: function() {
        return Math.min(this.space.length-1, this._selectedIndex+1)
    },
    _previous: function() {
        return Math.max(0, this._selectedIndex-1)
    },

    _initialSelection: function(backward, actionName) {
        debug('#preview', '_initialSelection');
        TopBar.show();

        navigating = true;
        this._block = Main.wm._blockAnimations;
        Main.wm._blockAnimations = true;
        Meta.disable_unredirect_for_screen(global.screen);

        this.space = Tiling.spaces.spaceOf(global.screen.get_active_workspace());

        this._selectedIndex = this.space.selectedIndex();
        this._startIndex  = this._selectedIndex;
        this.from = this.space;
        this.monitor = this.space.monitor;

        // Set up the minimap
        let minimap = new Minimap.Minimap(this.space);
        this.minimap = minimap;
        minimap.actor.opacity = 0;
        this.space.actor.add_actor(minimap.actor);
        minimap.show();
        minimap.actor.set_position(
            Math.floor((this.monitor.width - minimap.actor.width)/2),
            Math.floor((this.monitor.height - minimap.actor.height)/2));
        Tweener.addTween(minimap.actor,
                         {opacity: 255, time: 0.25, transition: 'easeInQuad'});

        this.space.visible.forEach(w => {
            w.get_compositor_private().hide();
            w.clone.show();
        });

        let paperActions = Extension.imports.extension.paperActions;
        let actionId = paperActions.idOf(actionName);
        if(actionId === Meta.KeyBindingAction.NONE) {
            try {
                // Check for built-in actions
                actionId = Meta.prefs_get_keybinding_action(actionName);
            } catch(e) {
                debug("Couldn't resolve action name");
                return;
            }
        }

        this._doAction(actionId);
    },

    _reorder: function (index, targetIndex) {
        function swapArray(array, i, j) {
            let temp = array[i];
            array[i] = array[j];
            array[j] = temp;
        }

        swapArray(this.space, index, targetIndex);

        let metaWindow = this.space[targetIndex];
        metaWindow.clone.raise_top();

        let newX = Tiling.ensureViewport(metaWindow, this.space, true);

        this._selectedIndex = targetIndex;

        this.minimap.reorder(index, targetIndex);
    },

    _initSpaceMru(move) {
        let heights = [0].concat(this._yPositions.slice(1));
        let minimap = this.minimap;

        let visible = Main.layoutManager.monitors
            .map(m => Tiling.spaces.monitors.get(m));
        Main.layoutManager.monitors
            .forEach(m => m.clickOverlay.deactivate());

        let mru = [this.space].concat(
            Tiling.spaces.mru().filter(space => !visible.includes(space)));
        this.mru = mru;

        if (move && !Scratch.isScratchActive()) {
            this._moving = this.space.selectedWindow;
            Scratch.makeScratch(this._moving);
        }

        let monitor = this.monitor;
        let cloneParent = this.space.clip.get_parent();
        mru.forEach((space, i) => {
            TopBar.updateIndicatorPosition(space.workspace);
            space.clip.set_position(monitor.x, monitor.y);

            let scaleX = monitor.width/space.width;
            let scaleY = monitor.height/space.height;
            space.clip.set_scale(scaleX, scaleY);

            let h = heights[i];
            if (h === undefined)
                h = heights[heights.length-1];
            space.actor.set_position(0, space.height*h);

            space.actor.scale_y = scale + (1 - i)*0.01;
            space.actor.scale_x = scale + (1 - i)*0.01;
            if (mru[i - 1] === undefined)
                return;
            cloneParent.set_child_below_sibling(
                space.clip,
                mru[i - 1].clip
            );
            space.actor.show();

            let selected = space.selectedWindow;
            if (selected && selected.fullscreen) {
                selected.clone.y = Main.panel.actor.height + prefs.vertical_margin;
            }
        });
        this.space.actor.scale_y = 1;
        this.space.actor.scale_x = 1;
    },

    selectSpace: function(direction, move) {
        this.minimap.actor.hide();

        if (!workspaceMru) {
            this._initSpaceMru(move);
            let selected = this.space.selectedWindow;
            if (selected && selected.fullscreen) {
                Tweener.addTween(selected.clone, {
                    y: Main.panel.actor.height + prefs.vertical_margin,
                    time: 0.25
                });
            }
        }
        let mru = this.mru;

        workspaceMru = true;

        if (Main.panel.statusArea.appMenu)
            Main.panel.statusArea.appMenu.container.hide();

        let from = mru.indexOf(this.space);
        let to;
        if (direction === Meta.MotionDirection.DOWN)
            to = from + 1;
        else
            to = from - 1;
        if (to < 0 || to >= mru.length) {
            this._select(this.space.selectedIndex());
            return true;
        }
        let oldSpace = this.space;
        let newSpace = mru[to];

        TopBar.updateWorkspaceIndicator(newSpace.workspace.index());

        let heights = this._yPositions;

        mru.forEach((space, i) => {
            let actor = space.actor;
            let h;
            if (to === i)
                h = heights[1];
            else if (to + 1 === i)
                h = heights[2];
            else if (to - 1 === i)
                h = heights[0];
            else if (i > to)
                h = heights[3];
            else if (i < to)
                h = 1;

            Tweener.addTween(actor,
                             {y: h*space.height,
                              time: 0.25,
                              scale_x: scale + (to - i)*0.01,
                              scale_y: scale + (to - i)*0.01,
                              transition: 'easeInOutQuad',
                             });

        });

        this.space = newSpace;
        this._select(this.space.selectedIndex());
    },

    _doAction: function(mutterActionId) {
        let paperActions = Extension.imports.extension.paperActions;

        switch (mutterActionId) {
        case Meta.KeyBindingAction.SWITCH_GROUP:
            mutterActionId = paperActions.idOf('previous-workspace');
            break;
        case Meta.KeyBindingAction.SWITCH_GROUP_BACKWARD:
            mutterActionId = paperActions.idOf('previous-workspace-backward');
            break;
        }

        if (mutterActionId === paperActions.idOf("switch-next")) {
            this._select(this._next());
            return true;
        } else if (mutterActionId === paperActions.idOf("switch-previous")) {
            this._select(this._previous());
            return true;
        } else if (mutterActionId === paperActions.idOf("move-left")) {
            this._reorder(this._selectedIndex, this._previous());
            return true;
        } else if (mutterActionId === paperActions.idOf("move-right")) {
            this._reorder(this._selectedIndex, this._next());
            return true;
        } else if (mutterActionId
                   === paperActions.idOf('previous-workspace-backward')) {
            this.selectSpace(Meta.MotionDirection.UP);
            return true;
        } else if (mutterActionId === paperActions.idOf('previous-workspace')) {
            this.selectSpace(Meta.MotionDirection.DOWN);
            return true;
        } else if (mutterActionId
                   === paperActions.idOf('move-previous-workspace')) {
            this.selectSpace(Meta.MotionDirection.DOWN, true);
            return true;
        } else if (mutterActionId
                   === paperActions.idOf('move-previous-workspace-backward')) {
            this.selectSpace(Meta.MotionDirection.UP, true);
            return true;
        } else {
            let action = paperActions.byId(mutterActionId);
            if (action
                && action.name !== 'toggle-scratch-layer'
                && action.name !== 'toggle-scratch') {
                let metaWindow = this.space[this._selectedIndex];
                action.handler(null, null, metaWindow);
                let minimap = this.minimap;
                minimap.layout(false);
                this.minimap.select(this._selectedIndex);
                return true;
            }
        }

        return false;
    },

    _keyPressHandler: function(keysym, action) {
        if (this._doAction(action)) {
            return Clutter.EVENT_STOP;
        } else {
            return Clutter.EVENT_PROPAGATE;
        }
    },

    _select: function(index) {
        // debug('#preview', 'Select', this.space[index].title, index);
        let metaWindow = this.space[index];
        if (metaWindow) {
            this.space.selectedWindow = metaWindow;
            Tiling.ensureViewport(metaWindow, this.space);
        }
        this._selectedIndex = index;
        if (!workspaceMru)
            this.minimap.select(index);
    },

    _finish: function(timestamp) {
        debug('#preview', 'finish');
        this.was_accepted = true;
        this.parent(timestamp);
    },

    _itemEnteredHandler: function() {
        // The item-enter (mouse hover) event is triggered even after a item is
        // accepted. This can cause _select to run on the item below the pointer
        // ensuring the wrong window.
        if(!this.was_accepted) {
            this.parent.apply(this, arguments);
        }
    },

    destroy: function() {
        debug('#preview', 'destroy');

        this.minimap.actor.destroy();

        if (Main.panel.statusArea.appMenu)
            Main.panel.statusArea.appMenu.container.show();
        if (workspaceMru)
            this.space.monitor.clickOverlay.reset();

        let force = workspaceMru;
        navigating = false; workspaceMru = false;

        let from = this.from;
        if(!this.was_accepted) {
            // Abort the navigation
            this.space = from;
            this.space.selectedWindow = from[this._startIndex];
        }

        if (this.monitor !== this.space.monitor) {
            this.space.setMonitor(this.monitor, true);
        }

        if (this.space.delayed && !force)
            this.space.emit('move-done');

        for (let monitor of Main.layoutManager.monitors) {
            if (monitor === this.monitor)
                continue;
            monitor.clickOverlay.activate();
        }

        if (this.space === from && force) {
            // We can't activate an already active workspace
            switchWorkspace(this.space.workspace);
        }

        let selected = this.space.selectedWindow;
        if (selected && !Scratch.isScratchActive()) {
            Main.activateWindow(selected);
            debug('#preview', 'Finish', selected.title, this._selectedIndex);
        } else {
            this.space.workspace.activate(global.get_current_time());
        }

        if (this._moving) {
            Scratch.unmakeScratch(this._moving);
        }

        if (selected && selected.fullscreen) {
            TopBar.hide();
        } else {
            TopBar.show();
        }

        Main.wm._blockAnimations = this._block;

        this.actor.hide(); // Prevents finalized crap
        this.parent();
    }
});

function preview_navigate(display, screen, meta_window, binding) {
    let tabPopup = new PreviewedWindowNavigator();
    tabPopup.show(binding.is_reversed(), binding.get_name(), binding.get_mask())
}

function switchWorkspace(to, from, callback) {
    TopBar.updateWorkspaceIndicator(to.index());

    let xDest = 0, yDest = global.screen_height;

    let toSpace = Tiling.spaces.spaceOf(to);
    let selected = toSpace.selectedWindow;
    if (selected)
        Tiling.ensureViewport(selected, this.space, true);

    if (from) {
        Tiling.spaces.spaceOf(from).forEach(w => {
            w.get_compositor_private().hide();
            w.clone.show();
        });
    }

    Tweener.addTween(toSpace.actor,
                     { x: 0,
                       y: 0,
                       scale_x: 1,
                       scale_y: 1,
                       time: 0.25,
                       transition: 'easeInOutQuad',
                       onComplete: () => {
                           Meta.enable_unredirect_for_screen(global.screen);

                           toSpace.clip.raise_top();
                           callback && callback();
                       }
                     });

    let next = toSpace.clip.get_next_sibling();

    let visible = new Map();
    for (let [monitor, space] of Tiling.spaces.monitors) {
        visible.set(space, true);
    }
    while (next !== null) {
        if (!visible.get(next.space))
            Tweener.addTween(
                next.first_child,
                { x: xDest,
                  y: yDest,
                  scale_x: scale,
                  scale_y: scale,
                  time: 0.25,
                  transition: 'easeInOutQuad',
                  onComplete() {
                      this.set_position(0, global.screen_height*0.1);
                  },
                  onCompleteScope: next.first_child
                });

        next = next.get_next_sibling();
    }
}
