# PaperWM #

PaperWM is an experimental gnome shell extension providing scrollable tiling of windows and per monitor workspaces. It's inspired by paper notebooks and tiling window managers.

While technically an extension it's to a large extent built on top of the Gnome desktop rather than merely extending it.

## Installation

Clone the repo and run the `install.sh` script from the directory:
```bash
./install.sh
```
It will link the repo to `~/.local/share/gnome-shell-extensions/` where gnome-shell can find it. You can then enable the extension in Gnome Tweaks. Running the extension will automatic install of a user config file as described in [Development & user configuration](#development--user-configuration).

## Usage ##

Most functionality is available using a mouse, eg. by clicking on a window at the edge of a monitor. But the primary focus is making an environment which works well with a keyboard.

All keybindings start with the <kbd>Super</kbd> modifier. On most keyboards it's the Windows key, on mac keyboards it's the Command key. It's possible and recommended to modify the keyboard layout so that <kbd>Super</kbd> is switched with <kbd>Alt</kbd> making all the keybindings easier to reach. This can be done through Gnome Tweaks under `Keybard & Mouse` ⟶ `Additional Layout Options` ⟶ `Alt/Win key behavior` ⟶ `Left Alt is swapped with Left Win`.

Most keybindings will grab the keyboard while <kbd>Super</kbd> is held down, only switching focus when <kbd>Super</kbd> is released. <kbd>Escape</kbd> will abort the navigation taking you back to the previously active window.

Adding <kbd>Ctrl</kbd> to a keybinding will take the current window with you when navigating.

Window management and navigation is based around the three following concepts.

### Scrollable window tiling ###

![The window tiling with the minimap shown](https://github.com/paperwm/media/blob/master/tiling.png)

New windows are automatically tiled to the right of the active window, taking up as much height as possible. <kbd>Super</kbd><kbd>N</kbd> will open a new window of the same type as the active window.

Activating a window will ensure it's fully visible, scrolling the tiling if necessary. Pressing <kbd>Super</kbd><kbd>.</kbd> activates the window to the right. <kbd>Super</kbd><kbd>,</kbd> activates the window to the left. On a US keyboard these keys are intuitively marked by <kbd><</kbd> and <kbd>></kbd>, they are also ordered the same way on almost all keyboard layouts. A minimap will be shown when <kbd>Super</kbd> is continually being pressed, as can be seen in the above screenshot.

Pressing <kbd>Super</kbd><kbd>I</kbd> will move the window to the right below the active window, tiling them vertically in a column. <kbd>Super</kbd><kbd>O</kbd> will do the opposite, pushing the bottom window out of the current column.

<kbd>Alt</kbd><kbd>Tab</kbd> is of course also available.

| Keybindings                                                                                       |                                                        |
| ------                                                                                            | -------                                                |
| <kbd>Super</kbd><kbd>,</kbd> or <kbd>Super</kbd><kbd>.</kbd>                                      | Activate the next or previous window                   |
| <kbd>Super</kbd><kbd>Left</kbd> or <kbd>Super</kbd><kbd>Right</kbd>                               | Activate the window to the left or right               |
| <kbd>Super</kbd><kbd>Up</kbd> or <kbd>Super</kbd><kbd>Down</kbd>                                  | Activate the window above or below                     |
| <kbd>Super</kbd><kbd>Home</kbd> or <kbd>Super</kbd><kbd>End</kbd>                                 | Activate the first or last window                      |
| <kbd>Super</kbd><kbd>Ctrl</kbd><kbd>,</kbd> or <kbd>Super</kbd><kbd>Ctrl</kbd><kbd>.</kbd>        | Move the current window to the left or right           |
| <kbd>Super</kbd><kbd>Ctrl</kbd><kbd>Left</kbd> or <kbd>Super</kbd><kbd>Ctrl</kbd><kbd>Right</kbd> | Move the current window to the left or right           |
| <kbd>Super</kbd><kbd>Ctrl</kbd><kbd>Up</kbd> or <kbd>Super</kbd><kbd>Ctrl</kbd><kbd>Down</kbd>    | Move the current window up or down                     |
| <kbd>Super</kbd><kbd>Tab</kbd> or <kbd>Alt</kbd><kbd>Tab</kbd>                                    | Cycle through the most recently used windows           |
| <kbd>Super</kbd><kbd>Shift</kbd><kbd>Tab</kbd> or <kbd>Alt</kbd><kbd>Shift</kbd><kbd>Tab</kbd>    | Cycle backwards through the most recently used windows |
| <kbd>Super</kbd><kbd>R</kbd>                                                                      | Resize the window (cycles through useful widths)       |
| <kbd>Super</kbd><kbd>F</kbd>                                                                      | Maximize the width of a window                         |
| <kbd>Super</kbd><kbd>Shift</kbd><kbd>F</kbd>                                                      | Toggle fullscreen                                      |
| <kbd>Super</kbd><kbd>N</kbd>                                                                      | Create a new window from the active application        |
| <kbd>Super</kbd><kbd>C</kbd> or <kbd>Super</kbd><kbd>Backspace</kbd>                              | Close the active window                                |
| <kbd>Super</kbd><kbd>I</kbd>                                                                      | Absorb the window to the right into the active column  |
| <kbd>Super</kbd><kbd>O</kbd>                                                                      | Expel the bottom window out to the right               |


### The workspace stack & monitors ###

![The most recently used workspace stack](https://github.com/paperwm/media/blob/master/stack.png)

Pressing <kbd>Super</kbd><kbd>Above_Tab</kbd> will slide the active workspace down revealing the stack as shown in the above screenshot. You can then flip through the most recently used workspaces with repeated <kbd>Above_Tab</kbd> presses while holding <kbd>Super</kbd> downe. <kbd>Above_Tab</kbd> is the key above <kbd>Tab</kbd> (<kbd>\`</kbd> in a US qwerty layout). Like alt-tab <kbd>Shift</kbd> is added to move in reverse order.

A workspace has a name and background color. Clicking on the workspace name lets you change them easily:

![The workspace menu](https://github.com/paperwm/media/blob/master/menu.png)

There's a single scrollable tiling per workspace. Adding another monitor simply makes it possible to have another workspace visible. The workspace stack is shared among all the monitors, windows being resized vertically as necessary when workspace is displayed on another monitor.

| Keybindings                                                                                                              |                                                                                   |
| ------                                                                                                                   | -------                                                                           |
| <kbd>Super</kbd><kbd>Above_Tab</kbd> or <kbd>Super</kbd><kbd>Page_Down</kbd>                                             | Cycle through the most recently used workspaces                                   |
| <kbd>Super</kbd><kbd>Shift</kbd><kbd>Above_Tab</kbd> or <kbd>Super</kbd><kbd>Page_Up</kbd>                               | Cycle backwards through the most recently used workspaces                         |
| <kbd>Super</kbd><kbd>Ctrl</kbd><kbd>Above_Tab</kbd> or <kbd>Super</kbd><kbd>Ctrl</kbd><kbd>Page_Down</kbd>               | Cycle through the most recently used, taking the active window with you           |
| <kbd>Super</kbd><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>Above_Tab</kbd> or <kbd>Super</kbd><kbd>Ctrl</kbd><kbd>Page_Up</kbd> | Cycle backwards through the most recently used, taking the active window with you |

Note: Multi monitor support only works when Gnome Shell is configured to use the `Workspaces span displays` option in Gnome Tweaks (under the `Workspaces` heading).

### Scratch layer ###

![The floating scratch layer, with the alt tab menu open](https://github.com/paperwm/media/blob/master/scratch.png)

The scratch layer is an escape hatch to a familiar floating layout. This layer is intended to store windows that are globally useful like chat applications and in general serve as the kitchen sink.
When the scratch layer is active it will float above the tiled windows, when hidden the windows will be minimized. 

Opening a window when the scratch layer is active will make it float automatically.

Pressing <kbd>Super</kbd><kbd>Escape</kbd> toggles between showing and hiding the windows in the scratch layer. Activating windows in the scratch layer is done using <kbd>Super</kbd><kbd>Tab</kbd>, the floating windows having priority in the list while active.

<kbd>Super</kbd><kbd>Ctrl</kbd><kbd>Escape</kbd> will move a tiled window into the scratch layer or alternatively tile an already floating window. This functionality can also be accessed in the windows context menu (<kbd>Alt</kbd><kbd>Space</kbd>).

| Keybindings                                      |                                                       |
| ------                                           | -------                                               |
| <kbd>Super</kbd><kbd>Escape</kbd>                | Toggle between showing and hiding the scratch windows |
| <kbd>Super</kbd><kbd>Ctrl</kbd><kbd>Escape</kbd> | Toggle between floating and tiling the current window |
| <kbd>Super</kbd><kbd>Tab</kbd>                   | Cycle through the most recently used scratch windows  |
| <kbd>Super</kbd><kbd>H</kbd>                     | Minimize the current window                           |

## Development & user configuration ##

A default user configuration, `user.js`, is created in `~/.config/paperwm/` with three functions `init`, `enable` and `disable`. `init` will run only once on startup, `enable` and `disable` will be run whenever extensions are being told to disable and enable themselves. Eg. when locking the screen with <kbd>Super</kbd><kbd>L</kbd>.

We also made an emacs package, [gnome-shell-mode](https://github.com/paperwm/gnome-shell-mode), to make hacking on the config and writing extensions a more pleasant experience. To support this out of the box we also install a `metadata.json` so gnome-shell-mode will pick up the correct file context, giving you completion and interactive evaluation ala. looking glass straight in emacs.

Pressing <kbd>Super</kbd><kbd>Insert</kbd> will assign the active window to a global variable `metaWindow`, its [window actor](https://developer.gnome.org/meta/stable/MetaWindowActor.html) to `actor`, its [workspace](https://developer.gnome.org/meta/stable/MetaWorkspace.html) to `workspace` and its PaperWM style workspace to `space`. This makes it easy to inspect state and test things out.

### Winprops

It's possible to create simple rules for placing new windows. Currently mostly useful when a window should be placed in the scratch layer automatically. An example, best placed in the `init` part of `user.js`:

```javascript
    let Tiling = Extension.imports.Tiling;
    Tiling.defwinprop({
        wm_class: "Spotify",
        scratch_layer: true,
        oneshot: true
    });
```

The `wm_class` of a window can be looked up by clicking <kbd>Super</kbd><kbd>Insert</kbd> and then checking the value of `metaWindow.wm_class` in emacs or looking glass.

### New Window Handlers

If opening a new application window with <kbd>Super</kbd><kbd>N</kbd> isn't doing exactly what you want you can create custom functions to fit your needs. Say you want new emacs windows to open the current buffer by default, or have new terminals inherit the current directory:

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


## Prior work ##

A similar idea was apparently tried out a while back: http://10gui.com/
