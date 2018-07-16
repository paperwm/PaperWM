/**
  Navigation and previewing functionality.

  This is a somewhat messy tangle of functionality relying on
  `SwitcherPopup.SwitcherPopup` when we really should just take full control.
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
var Keybindings = Extension.imports.keybindings;
var utils = Extension.imports.utils;
var debug = utils.debug;

var prefs = Extension.imports.settings.prefs;

var screen = global.screen;
var display = global.display;

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

    _initialSelection: function(backward, actionName) {
        debug('#preview', '_initialSelection');
        TopBar.show();

        navigating = true;
        this._block = Main.wm._blockAnimations;
        Main.wm._blockAnimations = true;
        Meta.disable_unredirect_for_screen(screen);

        this.space = Tiling.spaces.spaceOf(screen.get_active_workspace());

        this._startWindow = this.space.selectedWindow;
        this.from = this.space;
        this.monitor = this.space.monitor;
        this.minimaps = new Map();

        this.space.startAnimate();

        let actionId = Keybindings.idOf(actionName);
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

    _initSpaceMru(move) {
        let heights = [0].concat(this._yPositions.slice(1));

        let visible = Main.layoutManager.monitors
            .map(m => Tiling.spaces.monitors.get(m));
        Tiling.spaces.clickOverlays
            .forEach(overlay => overlay.deactivate());

        let mru = [this.space].concat(
            Tiling.spaces.mru().filter(space => !visible.includes(space)));
        this.mru = mru;

        let monitor = this.monitor;
        if (move && !Scratch.isScratchActive()) {
            this._moving = this.space.selectedWindow;
            let moving = this._moving;
            Scratch.makeScratch(this._moving);
            let actor = moving.get_compositor_private();
            Main.uiGroup.add_actor(this._moving.clone);
            moving.clone.set_position(...actor.get_position());
            moving.clone.show();
            moving.get_compositor_private().hide();
            Tweener.addTween(moving.clone,
                             {y: Math.round(monitor.y + monitor.height/2),
                              time: 0.25,
                              transition: 'easeInOutQuad'
                             });
        }

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
            Tweener.removeTweens(space.actor);
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
        this._hideMinimap();

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
            Tiling.ensureViewport(this.space.selectedWindow);
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
        Tiling.ensureViewport(this.space.selectedWindow);
    },

    _doAction: function(mutterActionId) {

        if (mutterActionId
                   === Keybindings.idOf('move-previous-workspace')) {
            this.selectSpace(Meta.MotionDirection.DOWN, true);
            return true;
        } else if (mutterActionId
                   === Keybindings.idOf('move-previous-workspace-backward')) {
            this.selectSpace(Meta.MotionDirection.UP, true);
            return true;
        } else {
            let action = Keybindings.byId(mutterActionId);
            if (action && action.options.activeInNavigator) {
                log("Show minimap and do action..")
                // this._showMinimap();
                let space = Tiling.spaces.selectedSpace;
                let metaWindow = space.selectedWindow;
                action.handler(metaWindow, space);
                return true;
            }
        }

        return false;
    },

    _keyPressHandler: function(keysym, action) {
        if (keysym !== Clutter.KEY_Escape && this._doAction(action)) {
            return Clutter.EVENT_STOP;
        } else {
            return Clutter.EVENT_PROPAGATE;
        }
    },

    _showMinimap() {
        let minimap = this.minimaps.get(this.space);
        if (!minimap) {
            minimap = new Minimap.Minimap(this.space, this.monitor);
            this.minimaps.set(this.space, minimap);
            this.space.startAnimate();
            minimap.show(true);
        } else {
            minimap.show();
        }
    },

    _hideMinimap() {
        let minimap = this.minimaps.get(this.space);
        if (minimap)
            minimap.hide();
    },

    _select: function(position) {
        // debug('#preview', 'Select', this.space[index][0].title, index);
        if (!position)
            return;
        let metaWindow = this.space.getWindow(...position);
        if (metaWindow) {
            this._showMinimap();
            Tiling.ensureViewport(metaWindow, this.space);
        }
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
        debug('#preview', 'destroy', this.space.actor);

        this.minimaps.forEach(m => m.destroy());

        if (Main.panel.statusArea.appMenu)
            Main.panel.statusArea.appMenu.container.show();
        if (workspaceMru)
            this.space.monitor.clickOverlay.hide();

        let force = Tiling.spaces._inPreview;
        navigating = false; workspaceMru = false;

        if (force) {
            this.space = Tiling.spaces.selectedSpace;
        }

        let from = this.from;
        if(!this.was_accepted) {
            // Abort the navigation
            this.space = from;
            if (this.startWindow && this._startWindow.get_compositor_private())
                this.space.selectedWindow = this._startWindow;
            else
                this.space.selectedWindow = display.focus_window;
        }

        if (this.monitor !== this.space.monitor) {
            this.space.setMonitor(this.monitor, true);
        }

        for (let monitor of Main.layoutManager.monitors) {
            if (monitor === this.monitor || !monitor.clickOverlay)
                continue;
            monitor.clickOverlay.activate();
        }

        if (this.space === from && force) {
            // Animate the selected space into full view - normally this
            // happens on workspace switch, but activating the same workspace
            // again doesn't trigger a switch signal
            Tiling.spaces.animateToSpace(this.space);
        }

        let selected = this.space.selectedWindow;
        if (selected && !Scratch.isScratchActive()) {
            if (selected !== display.focus_window) {
                Main.activateWindow(selected);
            } else {
                // Typically on cancel - the `focus` signal won't run
                // automatically, so we run it manually
                Tiling.focus_handler(selected);
            }
            debug('#preview', 'Finish', selected.title);
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

function preview_navigate(meta_window, space, {display, screen, binding}) {
    let tabPopup = new PreviewedWindowNavigator();
    tabPopup.show(binding.is_reversed(), binding.get_name(), binding.get_mask());
}
