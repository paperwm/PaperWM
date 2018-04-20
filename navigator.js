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
const Minimap = Extension.imports.minimap;
const Tiling = Extension.imports.tiling;
const utils = Extension.imports.utils;
const debug = utils.debug;

var scale = 0.9;
var navigating = false;

var PreviewedWindowNavigator = new Lang.Class({
    Name: 'PreviewedWindowNavigator',
    Extends: SwitcherPopup.SwitcherPopup,

    _yPositions: [0.95, 0.10, 0.035, 0.01],

    _init: function() {
        this.parent();

        this._block = Main.wm._blockAnimations;
        Main.wm._blockAnimations = true;

        navigating = true;

        let multimap = new Minimap.MultiMap(true);
        this.multimap = multimap;
        this._switcherList = multimap;
        this.space = this._switcherList.getSelected().space;

        let heights = [0].concat(this._yPositions.slice(1));

        let cloneParent = this.space.cloneContainer.get_parent();
        multimap.minimaps.forEach((m, i) => {
            let h = heights[i];
            if (h === undefined)
                h = heights[heights.length-1];
            m.space.cloneContainer.set_position(0, global.screen_height*h);

            m.space.cloneContainer.scale_y = scale + (1 - i)*0.01;
            m.space.cloneContainer.scale_x = scale + (1 - i)*0.01;
            if (multimap.minimaps[i - 1] === undefined)
                return;
            cloneParent.set_child_below_sibling(
                m.space.cloneContainer,
                multimap.minimaps[i - 1].space.cloneContainer
            );
            m.space.cloneContainer.show();
        });
        this.space.cloneContainer.scale_y = 1;
        this.space.cloneContainer.scale_x = 1;


        this._switcherList.onlyShowSelected();

        // HACK: workaround to enable moving from empty workspace. See check in
        // SwitcherPopup.show
        this._items = [1];

        this._selectedIndex = this.space.selectedIndex();
        // debug('#preview', 'Init', this.space[this._selectedIndex].title, this._selectedIndex);
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

    selectSpace: function(direction, move) {
        this._switcherList.actor.hide();

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
                             {y: h*global.screen_height,
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
            if (action && action.name !== 'toggle-scratch-layer') {
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

        switchWorkspace(this.space.workspace);

        if (this.space.length === 0) {
            this.space.workspace.activate(global.get_current_time());
        } else {
            Main.activateWindow(this.space[this._selectedIndex]);
            debug('#preview', 'Finish', this.space[this._selectedIndex].title, this._selectedIndex);
        }
        // Finish workspace preview _after_ activate, that way the new animation
        // triggered by activate gets killed immediately
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
        if (Main.panel.statusArea.appMenu)
            Main.panel.statusArea.appMenu.container.show();
        debug('#preview', 'onDestroy', this.was_accepted);

        if(!this.was_accepted) {
            debug('#preview', 'Abort', global.display.focus_window.title);
            let focus = global.display.focus_window;
            let multimap = this.multimap;
            let last = multimap.minimaps[multimap.selectedIndex - 1];
            if (focus.get_workspace() !== this.space.workspace) {
                switchWorkspace(focus.get_workspace());
            }
            Tiling.ensureViewport(focus, Tiling.spaces.spaceOfWindow(focus));
        }

        navigating = false;

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
                           toSpace.cloneContainer.raise_top();
_
                           callback && callback();
                       }
                     });

    let next = toSpace.cloneContainer.get_next_sibling();

    while (next !== null) {
        Tweener.addTween(next,
                         { x: xDest,
                           y: yDest,
                           scale_x: scale,
                           scale_y: scale,
                           time: 0.25,
                           transition: 'easeInOutQuad',
                           onComplete() {
                               this.set_position(0, global.screen_height*0.1);
                           },
                           onCompleteScope: next
                         });

        next = next.get_next_sibling();
    }
}
