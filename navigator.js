/*
  Navigation and previewing functionality.
 */

const Extension = imports.misc.extensionUtils.extensions['paperwm@hedning:matrix.org'];
const SwitcherPopup = imports.ui.switcherPopup;
const Lang = imports.lang;
const Meta = imports.gi.Meta;
const Main = imports.ui.main;
const Clutter = imports.gi.Clutter;
const Tweener = imports.ui.tweener;

var TopBar = Extension.imports.topbar;
var StackOverlay = Extension.imports.stackoverlay;
var Scratch = Extension.imports.scratch;
const Minimap = Extension.imports.minimap;
const Tiling = Extension.imports.tiling;
const utils = Extension.imports.utils;
const debug = utils.debug;

var scale = 0.9;
var navigating = false;
var workspaceMru = false;

var PreviewedWindowNavigator = new Lang.Class({
    Name: 'PreviewedWindowNavigator',
    Extends: SwitcherPopup.SwitcherPopup,

    _yPositions: [0.95, 0.10, 0.035, 0.01],

    _init: function() {
        this.parent();

        TopBar.show();

        this._block = Main.wm._blockAnimations;
        Main.wm._blockAnimations = true;

        navigating = true;

        let multimap = new Minimap.MultiMap(true);
        this.multimap = multimap;
        this._switcherList = multimap;
        this.space = this._switcherList.getSelected().space;
        this.monitor = this.space.monitor;

        this._switcherList.onlyShowSelected();

        // HACK: workaround to enable moving from empty workspace. See check in
        // SwitcherPopup.show
        this._items = [1];

        this._selectedIndex = this.space.selectedIndex();
        this._startIndex  = this._selectedIndex;
    },

    _next: function() {
        return Math.min(this.space.length-1, this._selectedIndex+1)
    },
    _previous: function() {
        return Math.max(0, this._selectedIndex-1)
    },

    _initialSelection: function(backward, actionName) {
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

        this._switcherList.getSelected().reorder(index, targetIndex, newX);
        this._switcherList.highlight(targetIndex);
    },

    _initSpaceMru(move) {
        let heights = [0].concat(this._yPositions.slice(1));
        let multimap = this.multimap;
        Meta.disable_unredirect_for_screen(global.screen);

        let visible = Main.layoutManager.monitors
            .map(m => Tiling.spaces.monitors.get(m));

        let top = multimap.minimaps[0];
        multimap.minimaps = [top].concat(multimap.minimaps
            .filter(m => visible.indexOf(m.space) === -1));

        if (move && !Scratch.isScratchActive()) {
            this._moving = this.space.selectedWindow;
            Scratch.makeScratch(this._moving);
        }

        let monitor = this.monitor;
        let cloneParent = this.space.clip.get_parent();
        multimap.minimaps .forEach((m, i) => {
            let space = m.space;

            space.clip.set_position(monitor.x, monitor.y);

            let scaleX = monitor.width/space.width;
            let scaleY = monitor.height/space.height;
            space.clip.set_scale(scaleX, scaleY);

            let h = heights[i];
            if (h === undefined)
                h = heights[heights.length-1];
            space.cloneContainer.set_position(0, space.height*h);

            space.cloneContainer.scale_y = scale + (1 - i)*0.01;
            space.cloneContainer.scale_x = scale + (1 - i)*0.01;
            if (multimap.minimaps[i - 1] === undefined)
                return;
            cloneParent.set_child_below_sibling(
                space.clip,
                multimap.minimaps[i - 1].space.clip
            );
            space.cloneContainer.show();

            let selected = space.selectedWindow;
            if (selected && selected.fullscreen) {
                selected.clone.y = Main.panel.actor.height + Tiling.margin_tb;
            }
        });
        this.space.cloneContainer.scale_y = 1;
        this.space.cloneContainer.scale_x = 1;
    },

    selectSpace: function(direction, move) {
        this._switcherList.actor.hide();

        if (!workspaceMru) {
            this._initSpaceMru(move);
            let selected = this.space.selectedWindow;
            if (selected && selected.fullscreen) {
                Tweener.addTween(selected.clone, {
                    y: Main.panel.actor.height + Tiling.margin_tb,
                    time: 0.25
                });
            }
        }

        workspaceMru = true;

        if (Main.panel.statusArea.appMenu)
            Main.panel.statusArea.appMenu.container.hide();

        let multimap = this._switcherList;

        let from = multimap.selectedIndex;
        let to;
        if (direction === Meta.MotionDirection.DOWN)
            to = from + 1;
        else
            to = from - 1;
        if (to < 0 || to >= multimap.minimaps.length) {
            this._select(this.space.selectedIndex());
            return true;
        }
        let oldMap = multimap.getSelected();
        let newMap = multimap.setSelected(to);

        TopBar.updateWorkspaceIndicator(newMap.space.workspace.index());

        let spaces = [
            multimap.minimaps[to],
            multimap.minimaps[to - 1],
            multimap.minimaps[to + 1]
        ].filter(x => x)
            .map(x => x.space);

        spaces.forEach(space => space.forEach(w => {
            w.get_compositor_private().hide();
            w.clone.show();
        }));

        let heights = this._yPositions;

        multimap.minimaps.forEach((m, i) => {
            let actor = m.space.cloneContainer;
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
                             {y: h*m.space.height,
                              time: 0.25,
                              scale_x: scale + (to - i)*0.01,
                              scale_y: scale + (to - i)*0.01,
                              transition: 'easeInOutQuad',
                             });

        });

        this.space = newMap.space;
        this._selectedIndex = this.space.selectedIndex();
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
                let minimap = this._switcherList.getSelected();
                minimap.layout();
                minimap.sync(metaWindow.destinationX);
                this._switcherList.highlight(this._selectedIndex);
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
            let newX = Tiling.ensureViewport(metaWindow, this.space);
            if (newX !== undefined) {
                this._switcherList.getSelected().sync(newX);
            }
        }
        this._selectedIndex = index;
        this._switcherList.highlight(index);
    },

    destroy: function() {
        this.parent();
    },

    _finish: function(timestamp) {
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

    _onDestroy: function() {
        debug('#preview', 'onDestroy', this.was_accepted);

        if (Main.panel.statusArea.appMenu)
            Main.panel.statusArea.appMenu.container.show();
        if (workspaceMru)
            this.space.monitor.clickOverlay.reset();

        let force = workspaceMru;
        navigating = false; workspaceMru = false;

        let from = this.multimap.minimaps[0].space;
        if(!this.was_accepted) {
            // Abort the navigation
            this.space = from;
            this.space.selectedWindow = from[this._startIndex];
        }

        this.space.setMonitor(this.monitor, true);

        if (this.space === from && force) {
            // We can't activate an already active workspace
            switchWorkspace(this.space.workspace);
        }

        let selected = this.space.selectedWindow;
        if (selected && !Scratch.isScratchActive()) {
            Main.activateWindow(selected);
            debug('#preview', 'Finish', selected.title, this._selectedIndex);
            Tiling.ensureViewport(selected, this.space, force);
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

    if (from) {
        Tiling.spaces.spaceOf(from).forEach(w => {
            w.get_compositor_private().hide();
            w.clone.show();
        });
    }

    Tweener.addTween(toSpace.cloneContainer,
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

    while (next !== null) {
        if (next.space.monitor === toSpace.monitor)
        Tweener.addTween(next.first_child,
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
