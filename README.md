# PaperWM #

[![project chat](https://img.shields.io/badge/zulip-join_chat-brightgreen.svg)](https://paperwm.zulipchat.com)

PaperWM is an experimental [Gnome Shell](https://wiki.gnome.org/Projects/GnomeShell) extension providing scrollable tiling of windows and per monitor workspaces. It's inspired by paper notebooks and tiling window managers.

Supports Gnome Shell from 3.28 to 3.38 on X11 and wayland.

While technically an [extension](https://wiki.gnome.org/Projects/GnomeShell/Extensions) it's to a large extent built on top of the Gnome desktop rather than merely extending it.

We hang out on [zulip](https://paperwm.zulipchat.com).

## Installation

Clone the repo and run the
[`install.sh`](https://github.com/paperwm/PaperWM/blob/master/install.sh) script
from the repository. The installer will create a link to the repo in
`$XDG_DATA_HOME/gnome-shell/extensions/`. It will then ask if you want to apply
the recommended settings (see [Recommended
Settings](#recommended-gnome-shell-settings)) and lastly it will ask to enable PaperWM.
```bash
./install.sh # install, load and enable paperwm
```

To uninstall simply run `./uninstall.sh`.

You'll by default follow the
[develop](https://github.com/paperwm/PaperWM/tree/develop) branch. If you want a
possibly more stable experience you can follow the releases by checking out the
[master](https://github.com/paperwm/PaperWM/tree/master) branch.

Cloning the repo directly into `$XDG_DATA_HOME` also works (you can then run
`install.sh` to enable PaperWM):
```bash
git clone 'https://github.com/paperwm/PaperWM.git' \
    "${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/paperwm@hedning:matrix.org"
```

Running the extension will automatically install a user config file as described in [Development & user configuration](#development--user-configuration).

### Note for Ubuntu users ###

There's three different gnome-desktop variants in Ubuntu:
- [`ubuntu-desktop`](https://packages.ubuntu.com/focal/ubuntu-desktop): the default
- [`ubuntu-gnome-desktop`](https://packages.ubuntu.com/focal/ubuntu-gnome-desktop):
  adds plain gnome sessions to the default
- [`vanilla-gnome-desktop`](https://packages.ubuntu.com/focal/vanilla-gnome-desktop):
  a «plain» variant

The default `ubuntu-desktop` ships with `desktop-icons` which doesn't work
correctly with PaperWM ([#145](https://github.com/paperwm/PaperWM/issues/145),
[#218](https://github.com/paperwm/PaperWM/issues/218)). Turning the extension
off in gnome-tweaks [should work in
19.10](https://github.com/paperwm/PaperWM/issues/218#issuecomment-572250654),
but there's [reports of this not
working](https://github.com/paperwm/PaperWM/issues/145#issuecomment-508620154)
in 19.04, so your milage my vary.

For the easiest out of the box experience we reccommend `ubuntu-gnome-desktop`.
`vanilla-gnome-desktop` adds some keybindings which plays badly with PaperWM
([#233](https://github.com/paperwm/PaperWM/issues/233)), making it unsuitable at
the moment.

## Usage ##

Most functionality is available using a mouse, eg. activating a window at the edge of the monitor by clicking on it. In wayland its possible to navigate with 3-finger swipes on the trackpad. But the primary focus is making an environment which works well with a keyboard.

All keybindings start with the <kbd>Super</kbd> modifier. On most keyboards it's the Windows key, on mac keyboards it's the Command key. It's possible to modify the keyboard layout so that <kbd>Super</kbd> is switched with <kbd>Alt</kbd> making all the keybindings easier to reach. This can be done through Gnome Tweaks under `Keybard & Mouse` ⟶ `Additional Layout Options` ⟶ `Alt/Win key behavior` ⟶ `Left Alt is swapped with Left Win`.

Most keybindings will grab the keyboard while <kbd>Super</kbd> is held down, only switching focus when <kbd>Super</kbd> is released. <kbd>Escape</kbd> will abort the navigation taking you back to the previously active window.

Adding <kbd>Ctrl</kbd> to a keybinding will take the current window with you when navigating.

Window management and navigation is based around the three following concepts.

### Scrollable window tiling ###

![The window tiling with the minimap shown](https://github.com/paperwm/media/blob/master/tiling.png)

New windows are automatically tiled to the right of the active window, taking up as much height as possible. <kbd>Super</kbd><kbd>Return</kbd> will open a new window of the same type as the active window.

Activating a window will ensure it's fully visible, scrolling the tiling if necessary. Pressing <kbd>Super</kbd><kbd>.</kbd> activates the window to the right. <kbd>Super</kbd><kbd>,</kbd> activates the window to the left. On a US keyboard these keys are intuitively marked by <kbd><</kbd> and <kbd>></kbd>, they are also ordered the same way on almost all keyboard layouts. A minimap will be shown when <kbd>Super</kbd> is continually being pressed, as can be seen in the above screenshot.

Pressing <kbd>Super</kbd><kbd>I</kbd> will move the window to the right below the active window, tiling them vertically in a column. <kbd>Super</kbd><kbd>O</kbd> will do the opposite, pushing the bottom window out of the current column.

Swiping the trackpad horizontally with three fingers will scroll the tiling (only available in Wayland).

<kbd>Alt</kbd><kbd>Tab</kbd> is of course also available.

PaperWM doesn't handle attached modal dialogs very well, so it's best to turn it off in Gnome Tweaks (under Windows).

| Keybindings                                                                                       |                                                        |
| ------                                                                                            | -------                                                |
| <kbd>Super</kbd><kbd>,</kbd> or <kbd>Super</kbd><kbd>.</kbd>                                      | Activate the next or previous window                   |
| <kbd>Super</kbd><kbd>Left</kbd> or <kbd>Super</kbd><kbd>Right</kbd>                               | Activate the window to the left or right               |
| <kbd>Super</kbd><kbd>Up</kbd> or <kbd>Super</kbd><kbd>Down</kbd>                                  | Activate the window above or below                     |
| <kbd>Super</kbd><kbd>Home</kbd> or <kbd>Super</kbd><kbd>End</kbd>                                 | Activate the first or last window                      |
| <kbd>Super</kbd><kbd>Ctrl</kbd><kbd>,</kbd> or <kbd>Super</kbd><kbd>Ctrl</kbd><kbd>.</kbd>        | Move the current window to the left or right           |
| <kbd>Super</kbd><kbd>Ctrl</kbd><kbd>Left</kbd> or <kbd>Super</kbd><kbd>Ctrl</kbd><kbd>Right</kbd> | Move the current window to the left or right           |
| <kbd>Super</kbd><kbd>Ctrl</kbd><kbd>Up</kbd> or <kbd>Super</kbd><kbd>Ctrl</kbd><kbd>Down</kbd>    | Move the current window up or down                     |
| <kbd>Super</kbd><kbd>t</kbd>                                                                      | Take the window, placing it when finished navigating   |
| <kbd>Super</kbd><kbd>Tab</kbd> or <kbd>Alt</kbd><kbd>Tab</kbd>                                    | Cycle through the most recently used windows           |
| <kbd>Super</kbd><kbd>Shift</kbd><kbd>Tab</kbd> or <kbd>Alt</kbd><kbd>Shift</kbd><kbd>Tab</kbd>    | Cycle backwards through the most recently used windows |
| <kbd>Super</kbd><kbd>C</kbd>                                                                      | Center the active window horizontally                  |
| <kbd>Super</kbd><kbd>R</kbd>                                                                      | Resize the window (cycles through useful widths)       |
| <kbd>Super</kbd><kbd>Shift</kbd><kbd>R</kbd>                                                      | Resize the window (cycles through useful heights)      |
| <kbd>Super</kbd><kbd>F</kbd>                                                                      | Maximize the width of a window                         |
| <kbd>Super</kbd><kbd>Shift</kbd><kbd>F</kbd>                                                      | Toggle fullscreen                                      |
| <kbd>Super</kbd><kbd>Return</kbd> or <kbd>Super</kbd><kbd>N</kbd>                                 | Create a new window from the active application        |
| <kbd>Super</kbd><kbd>Backspace</kbd>                                                              | Close the active window                                |
| <kbd>Super</kbd><kbd>I</kbd>                                                                      | Absorb the window to the right into the active column  |
| <kbd>Super</kbd><kbd>O</kbd>                                                                      | Expel the bottom window out to the right               |


### The workspace stack & monitors ###

Pressing <kbd>Super</kbd><kbd>Above_Tab</kbd> will slide the active workspace down revealing the stack as shown in the above screenshot. You can then flip through the most recently used workspaces with repeated <kbd>Above_Tab</kbd> presses while holding <kbd>Super</kbd> down. <kbd>Above_Tab</kbd> is the key above <kbd>Tab</kbd> (<kbd>\`</kbd> in a US qwerty layout). Like alt-tab <kbd>Shift</kbd> is added to move in reverse order:

![The most recently used workspace stack](https://github.com/paperwm/media/blob/master/stack.png)

Pressing <kbd>Super</kbd><kbd>Page_Down</kbd> and <kbd>Super</kbd><kbd>Page_Up</kbd> will slide between workspaces sequentially:

![Sequential workspace navigation](https://github.com/paperwm/media/blob/master/sequence.png)

The workspace name is shown in the top left corner replacing the `Activities` button adding a few enhancements. Scrolling on the name will let you browse the workspace stack just like <kbd>Super</kbd><kbd>Above_Tab</kbd>. Right clicking the name lets you access and change the workspace name and the background color:

![The workspace menu](https://github.com/paperwm/media/blob/master/menu.png)

Swiping the trackpad vertically with three fingers lets you navigate the workspace stack (only available in Wayland).

There's a single scrollable tiling per workspace. Adding another monitor simply makes it possible to have another workspace visible. The workspace stack is shared among all the monitors, windows being resized vertically as necessary when workspace is displayed on another monitor.

PaperWM currently works best using the workspaces span monitors preference, this can be turned on with Gnome Tweaks under Workspaces. If you want to use workspaces only on primary you need to place the secondary monitor either below or above the primary (with the best result having it below).

| Workspace Keybindings                                                  |                                                                                   |
| ------                                                                 | -------                                                                           |
| <kbd>Super</kbd><kbd>Above_Tab</kbd>                                   | Cycle through the most recently used workspaces                                   |
| <kbd>Super</kbd><kbd>Shift</kbd><kbd>Above_Tab</kbd>                   | Cycle backwards through the most recently used workspaces                         |
| <kbd>Super</kbd><kbd>Ctrl</kbd><kbd>Above_Tab</kbd>                    | Cycle through the most recently used, taking the active window with you           |
| <kbd>Super</kbd><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>Above_Tab</kbd>    | Cycle backwards through the most recently used, taking the active window with you |
| <kbd>Super</kbd><kbd>Page_Down</kbd>/<kbd>Page_Up</kbd>                | Cycle sequentially through workspaces                                             |
| <kbd>Super</kbd><kbd>Ctrl</kbd><kbd>Page_Down</kbd>/<kbd>Page_Up</kbd> | Cycle sequentially through workspaces, taking the active window with you          |


| Monitor Keybindings                                                 |                                            |
| ------                                                              | -------                                    |
| <kbd>Super</kbd><kbd>Shift</kbd><kbd>Arrow_key</kbd>                | Select neighbouring monitor                |
| <kbd>Super</kbd><kbd>Shift</kbd><kbd>Ctrl</kbd><kbd>Arrow_key</kbd> | Move active window to neighbouring monitor |

### Scratch layer ###

![The floating scratch layer, with the alt tab menu open](https://github.com/paperwm/media/blob/master/scratch.png)

The scratch layer is an escape hatch to a familiar floating layout. This layer is intended to store windows that are globally useful like chat applications and in general serve as the kitchen sink.
When the scratch layer is active it will float above the tiled windows, when hidden the windows will be minimized.

Opening a window when the scratch layer is active will make it float automatically.

Pressing <kbd>Super</kbd><kbd>Escape</kbd> toggles between showing and hiding the windows in the scratch layer.
Activating windows in the scratch layer is done using <kbd>Super</kbd><kbd>Tab</kbd>, the floating windows having priority in the list while active.
When the tiling is active <kbd>Super</kbd><kbd>Shift</kbd><kbd>Tab</kbd> selects the most recently used scratch window.

<kbd>Super</kbd><kbd>Ctrl</kbd><kbd>Escape</kbd> will move a tiled window into the scratch layer or alternatively tile an already floating window. This functionality can also be accessed through the window context menu (<kbd>Alt</kbd><kbd>Space</kbd>).

| Keybindings                                       |                                                                  |
| ------                                            | -------                                                          |
| <kbd>Super</kbd><kbd>Escape</kbd>                 | Toggle between showing and hiding the most recent scratch window |
| <kbd>Super</kbd><kbd>Shift</kbd><kbd>Escape</kbd> | Toggle between showing and hiding the scratch windows            |
| <kbd>Super</kbd><kbd>Ctrl</kbd><kbd>Escape</kbd>  | Toggle between floating and tiling the current window            |
| <kbd>Super</kbd><kbd>Tab</kbd>                    | Cycle through the most recently used scratch windows             |
| <kbd>Super</kbd><kbd>H</kbd>                      | Minimize the current window                                      |

## Development & user configuration ##

A default user configuration, `user.js`, is created in `~/.config/paperwm/` with three functions `init`, `enable` and `disable`. `init` will run only once on startup, `enable` and `disable` will be run whenever extensions are being told to disable and enable themselves. Eg. when locking the screen with <kbd>Super</kbd><kbd>L</kbd>.

We also made an emacs package, [gnome-shell-mode](https://github.com/paperwm/gnome-shell-mode), to make hacking on the config and writing extensions a more pleasant experience. To support this out of the box we also install a `metadata.json` so gnome-shell-mode will pick up the correct file context, giving you completion and interactive evaluation ala. looking glass straight in emacs.

Pressing <kbd>Super</kbd><kbd>Insert</kbd> will assign the active window to a global variable `metaWindow`, its [window actor](https://developer.gnome.org/meta/stable/MetaWindowActor.html) to `actor`, its [workspace](https://developer.gnome.org/meta/stable/MetaWorkspace.html) to `workspace` and its PaperWM style workspace to `space`. This makes it easy to inspect state and test things out.

#### Using dconf-editor to modify settings

```shell
GSETTINGS_SCHEMA_DIR=$HOME/.local/share/gnome-shell/extensions/paperwm@hedning:matrix.org/schemas dconf-editor /org/gnome/shell/extensions/paperwm/
```

### Winprops

It's possible to create simple rules for placing new windows. Currently most useful when a window should be placed in the scratch layer automatically. An example, best placed in the `init` part of `user.js`:

```javascript
    Tiling.defwinprop({
        wm_class: "Spotify",
        scratch_layer: true,
    });
```

The `wm_class` of a window can be found by using looking glass: <kbd>Alt</kbd><kbd>F2</kbd> `lg` <kbd>Return</kbd> Go to the "Windows" section at the top right and find the window. X11 users can also use the `xprop` command line tool.

### New Window Handlers

If opening a new application window with <kbd>Super</kbd><kbd>Return</kbd> isn't doing exactly what you want you can create custom functions to fit your needs. Say you want new emacs windows to open the current buffer by default, or have new terminals inherit the current directory:

```javascript
    let App = Extension.imports.app;
    App.customHandlers['emacs.desktop'] =
        () => imports.misc.util.spawn(['emacsclient', '--eval', '(make-frame)']);
    App.customHandlers['org.gnome.Terminal.desktop'] =
        (metaWindow, app) => app.action_group.activate_action(
          "win.new-terminal",
          new imports.gi.GLib.Variant("(ss)", ["window", "current"]));
```

The app id of a window can be looked up like this:

```javascript
var Shell = imports.gi.Shell;
var Tracker = Shell.WindowTracker.get_default();
var app = Tracker.get_window_app(metaWindow);
app.get_id();
```

Available application actions can be listed like this:
```javascript
app.action_group.list_actions();
```

### Keybindings

Due to limitations in the mutter keybinding API we need to steal some built in Gnome Shell actions by default. Eg. the builtin action `switch-group` with the default <kbd>Super</kbd><kbd>Above_Tab</kbd> keybinding is overridden to cycle through recently used workspaces. If an overridden action has several keybindings they will unfortunately all activate the override, so for instance because <kbd>Alt</kbd><kbd>Above_Tab</kbd> is also bound to `switch-group` it will be overridden by default. If you want to avoid this, eg. you want <kbd>Alt</kbd><kbd>Tab</kbd> and <kbd>Alt</kbd><kbd>Above_Tab</kbd> to use the builtin behavior simply remove the conflicts (ie. <kbd>Super</kbd><kbd>Tab</kbd> and <kbd>Super</kbd><kbd>Above_Tab</kbd> and their <kbd>Shift</kbd> variants) from `/org/gnome/desktop/wm/keybindings/switch-group` (no restarts required).

#### User defined keybindings

`Extension.imports.keybindings.bindkey(keystr, name, handler, options)`

Option              | Values              | Meaning
--------------------|---------------------|------------------------------------
`activeInNavigator` | `true`, **`false`** | The keybinding is active when the minimap/navigator is open
`opensMinimap`    | `true`, **`false`** | The minimap will open when the keybinding is invoked

```javascript
let Keybindings = Extension.imports.keybindings;
Keybindings.bindkey("<Super>j", "my-favorite-width",
                    (metaWindow) => {
                        let f = metaWindow.get_frame_rect();
                        metaWindow.move_resize_frame(true, f.x, f.y, 500, f.h);
                    },
                    { activeInNavigator: true });
```

See `examples/keybindings.js` for more examples.

## Fixed Window Size ##

Currently it is not possible to have a default fixed window size.
Please check the following issues for progress / info:

* https://github.com/paperwm/PaperWM/issues/304
* https://github.com/paperwm/PaperWM/pull/189
* https://github.com/paperwm/PaperWM/issues/311

## Recommended Gnome Shell Settings ##

There's a few Gnome Shell settings which works poorly with PaperWM. Namely
- `workspaces-only-on-primary`: Multi monitor support require workspaces
  spanning all monitors
- `edge-tiling`: We don't support the native half tiled windows
- `attach-modal-dialogs`: Attached modal dialogs can cause visual glitching

To use the recommended settings run
[`set-recommended-gnome-shell-settings.sh`](https://github.com/paperwm/PaperWM/blob/master/set-recommended-gnome-shell-settings.sh). A "restore previous settings" script is generated so the original settings is not lost.


## Recommended extensions ##

These extensions are good complements to PaperWM:

- [Switcher](https://github.com/daniellandau/switcher) - combined window switcher and launcher
- [Dash to Dock](https://micheleg.github.io/dash-to-dock/) - a great dock

## Prior work ##

A similar idea was apparently tried out a while back: http://10gui.com/
