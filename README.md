# PaperWM #

[![project chat](https://img.shields.io/badge/PaperWM_Discussions-join_chat-brightgreen)](https://github.com/paperwm/PaperWM/discussions)

PaperWM is a [GNOME Shell](https://www.gnome.org/) extension which provides scrollable tiling of windows and per monitor workspaces. It's inspired by paper notebooks and tiling window managers.

While technically an [extension](https://extensions.gnome.org/about/) it's to a large extent built on top of the Gnome desktop rather than merely extending it.

PaperWM aims to continually support [current stable](https://release.gnome.org/calendar/#branches) GNOME Shell versions (currently GNOME 47-49).  Older versions of PaperWM can generally be installed on older GNOME Shell versions (see [Install via Source](#install-via-source) for more information on targeting an older/EOL Gnome version).

New features and fixes aren't generally backported to older Gnome shell versions.  [Pull requests](https://github.com/paperwm/PaperWM/pulls) for fixes to older PaperWM versions (that run on previous Gnome versions) will be accepted if the submitter can help test and update related documentation.

Have questions or comments?  Please ask on our [Github Discussions](https://github.com/paperwm/PaperWM/discussions) board.

## Installation

### Install via [extensions.gnome.org](https://extensions.gnome.org/extension/6099/paperwm/) (recommended)

[<img alt="Install it on extensions.gnome.org" src="media/get-it-on-ego.svg" width="150px">](https://extensions.gnome.org/extension/6099/paperwm/)

### Install via Source

Clone the repo and check out the branch for the GNOME Shell version you're running:

- 45-50 (currently developed/supported): https://github.com/paperwm/PaperWM/tree/release
- 42-44 ([EOL](https://release.gnome.org/calendar/#releases)): https://github.com/paperwm/PaperWM/tree/gnome-44
- 40-41 ([EOL](https://release.gnome.org/calendar/#releases)): https://github.com/paperwm/PaperWM/tree/gnome-40
- 3.28-3.38 ([EOL](https://release.gnome.org/calendar/#releases)): https://github.com/paperwm/PaperWM/tree/gnome-3.38

then run the [`make install`](https://github.com/paperwm/PaperWM/blob/release/install.sh) 
from the repository. The installer will create a link to the repo in
`~/.local/share/gnome-shell/extensions`. It will then ask if you want to enable PaperWM.
```bash
make install # install, load and enable paperwm
```

Running the extension will automatically install a user config file as described in [User configuration & development](#user-configuration--development).

> #### ➡️ You'll need to restart GNOME Shell after installing PaperWM, e.g. logout then login, or restart in place with an `alt-F2` and entering `r` (X11 only).
>
> After logging back in, you can then enable PaperWM via the `Extensions` application, or by running the following command from the command-line:
>
> `/usr/bin/gnome-extensions enable paperwm@paperwm.github.com`
>

> if you have run into issues, delete any older `paperwm@...` symlinks from `~/.local/share/gnome-shell/extensions` and re-run the `install.sh` script.

#### Uninstall PaperWM (if installed via source)

To uninstall simply run `make uninstall`.

### Try without installing

This repo provides a lightweight VM based on [NixOS](https://nixos.org) to try PaperWM and aid with development. You can launch it if [Nix](https://nixos.org/nix) is installed on your system using this command:

```sh
nix run .\#vm
```

Alternatively, the VM can also be launched with GPU acceleration, by installing [NixGL](https://github.com/nix-community/nixgl) first:

```sh
nixGLIntel nix run .\#vm -- -device virtio-gpu-gl -display gtk,gl=on
# or nixGLNvidia depending on your host GPU
```

## Contributing
Users are encouraged to submit [issues](https://github.com/paperwm/PaperWM/issues/new/choose) and [Pull Requests](https://github.com/paperwm/PaperWM/pulls)!

> #### ➡️ Please ensure pull requests are based off, and submitted to, [develop](https://github.com/paperwm/PaperWM/tree/develop) branch.
> 
> Pull requests submitted to the `release` branch will not be accepted (but don't worry, if you accidentally submit a PR to the `release` branch, the target branch will automatically be changed to `develop` branch).

## Usage ##

Most functionality is available using a mouse, eg. activating a window at the edge of the monitor by clicking on it. Wayland support gestures (See the [Touchpad Gestures](#touchpad-gestures) section). PaperWM is designed to work work well with keyboard + mouse, trackpads etc.

Most keybindings start with the <kbd>Super</kbd> modifier (by default), which is usually the Windows key, or on mac keyboards it's the Command key. It's possible to modify the keyboard layout so that <kbd>Super</kbd> is switched with <kbd>Alt</kbd> making all the keybindings easier to reach. This can be done through Gnome Tweaks under `Keyboard & Mouse` ⟶ `Additional Layout Options` ⟶ `Alt/Win key behavior` ⟶ `Left Alt is swapped with Left Win`.

Most keybindings will grab the keyboard while <kbd>Super</kbd> is held down, only switching focus when <kbd>Super</kbd> is released. <kbd>Escape</kbd> will abort the navigation taking you back to the previously active window.

All PaperWM keybinds can be changed (and disabled) via PaperWM extension settings, which can be accessed through [`Extensions`](https://apps.gnome.org/Extensions/) ⟶ `PaperWM` ⟶ `Settings`.

Window management and navigation is based around the three following concepts.

### Scrollable window tiling ###

![The window tiling with the minimap shown](https://github.com/paperwm/media/blob/master/tiling.png)

New windows are automatically tiled to the right of the active window (see [here](#window-insertion-position-for-new-windows-and-dropped-windows-in-take-mode) for dynamically changing the insertion position of new windows), taking up as much height as possible. <kbd>Super</kbd><kbd>Return</kbd> will open a new window of the same type as the active window.

Activating a window will ensure it's fully visible, scrolling the tiling if necessary. By default, pressing <kbd>Super</kbd><kbd>.</kbd> activates the window to the right. <kbd>Super</kbd><kbd>,</kbd> activates the window to the left. On a US keyboard these keys are intuitively marked by <kbd><</kbd> and <kbd>></kbd>, they are also ordered the same way on almost all keyboard layouts. Navigating around windows brings up the minimap as can be seen in the above screenshot. The minimap will stay visible as long as <kbd>Super</kbd> is continually being pressed.

Pressing <kbd>Super</kbd><kbd>I</kbd> will move the window to the right below the active window, tiling them vertically in a column. <kbd>Super</kbd><kbd>O</kbd> will do the opposite, pushing the bottom window out of the current column.

You can scroll the tiling by swiping the trackpad horizontally with three fingers (Wayland only), swiping the panel on a touch screen, or using the mouse scroll wheel on the topbar.

<kbd>Alt</kbd><kbd>Tab</kbd> is of course also available.

| Default `window` Keybindings                                                                      | _Can be changed in PaperWM extension settings_ | 
| ------                                                                                            | ------- |
| <kbd>Super</kbd><kbd>Return</kbd> or <kbd>Super</kbd><kbd>N</kbd>                                 | Open a new windows (of the current application) |
| <kbd>Super</kbd><kbd>Backspace</kbd>                                                              | Close the active window |
| <kbd>Super</kbd><kbd>.</kbd> or <kbd>Super</kbd><kbd>,</kbd>                                      | Switch to the next or previous window |
| <kbd>Super</kbd><kbd>Left</kbd> or <kbd>Super</kbd><kbd>Right</kbd>                               | Activate the window to the left or right |
| <kbd>Super</kbd><kbd>Up</kbd> or <kbd>Super</kbd><kbd>Down</kbd>                                  | Activate the window above or below |
| <kbd>Super</kbd><kbd>Home</kbd> or <kbd>Super</kbd><kbd>End</kbd>                                 | Activate the first or last window |
| _Not set by default (set in extension settings)_                                                  | Switch to the [second _to_ eleventh] window |
| <kbd>Super</kbd><kbd>Tab</kbd> or <kbd>Alt</kbd><kbd>Tab</kbd>                                    | Cycle through previously active windows |
| <kbd>Shift</kbd><kbd>Super</kbd><kbd>Tab</kbd> or <kbd>Shift</kbd><kbd>Alt</kbd><kbd>Tab</kbd>    | Cycle through previously active windows (backward order) |
| <kbd>Ctrl</kbd><kbd>Alt</kbd><kbd>Tab</kbd>                                                       | Cycle through previously active scratch windows | 
| <kbd>Shift</kbd><kbd>Ctrl</kbd><kbd>Alt</kbd><kbd>Tab</kbd>                                       | Cycle through previously active scratch windows (backward order) |
| <kbd>Shift</kbd><kbd>Super</kbd><kbd>C</kbd>                                                      | Switch between window focus modes |
| <kbd>Shift</kbd><kbd>Super</kbd><kbd>W</kbd>                                                      | Switch between positions for creating/dropping new windows |
| _Not set by default (set in extension settings)_                                                  | Create/drop windows to the right of current window |
| _Not set by default (set in extension settings)_                                                  | Create/drop windows to the left of current window |
| _Not set by default (set in extension settings)_                                                  | Create/drop windows in vertical stack (down) |
| _Not set by default (set in extension settings)_                                                  | Create/drop windows in vertical stack (up) |
| _Not set by default (set in extension settings)_                                                  | Create/drop windows at start position |
| _Not set by default (set in extension settings)_                                                  | Create/drop windows at end position |
| <kbd>Super</kbd><kbd>Ctrl</kbd><kbd>,</kbd> or <kbd>Super</kbd><kbd>Ctrl</kbd><kbd>.</kbd>        | Move the current window to the left or right |
| <kbd>Shift</kbd><kbd>Super</kbd><kbd>,</kbd> or <kbd>Shift</kbd><kbd>Super</kbd><kbd>.</kbd>      | Move the current window to the left or right |
| <kbd>Super</kbd><kbd>Ctrl</kbd><kbd>Left</kbd> or <kbd>Super</kbd><kbd>Ctrl</kbd><kbd>Right</kbd> | Move the current window to the left or right |
| <kbd>Super</kbd><kbd>Ctrl</kbd><kbd>Up</kbd> or <kbd>Super</kbd><kbd>Ctrl</kbd><kbd>Down</kbd>    | Move the current window up or down |
| <kbd>Super</kbd><kbd>I</kbd>                                                                      | Absorb window into the active column |
| <kbd>Super</kbd><kbd>O</kbd>                                                                      | Expel the bottom window from vertically tiled windows |
| <kbd>Shift</kbd><kbd>Super</kbd><kbd>O</kbd>                                                      | Expel the active window from vertically tiled windows |
| <kbd>Super</kbd><kbd>C</kbd>                                                                      | Center windows horizontally |
| <kbd>Shift</kbd><kbd>Super</kbd><kbd>F</kbd>                                                      | Toggle fullscreen |
| <kbd>Super</kbd><kbd>F</kbd>                                                                      | Maximize the width of a window |
| <kbd>Shift</kbd><kbd>Super</kbd><kbd>+</kbd>                                                      | Increment window height (scratch or vertically tiled windows) |
| <kbd>Shift</kbd><kbd>Super</kbd><kbd>-</kbd>                                                      | Decrement window height (scratch or vertically tiled windows) |
| <kbd>Super</kbd><kbd>+</kbd>                                                                      | Increment window width |
| <kbd>Super</kbd><kbd>-</kbd>                                                                      | Decrement window width |
| <kbd>Super</kbd><kbd>R</kbd>                                                                      | Resize the window (cycles through useful widths) |
| <kbd>Super</kbd><kbd>Alt</kbd><kbd>R</kbd>                                                        | Resize the window (cycles backwards through useful widths)  |
| <kbd>Super</kbd><kbd>Shift</kbd><kbd>R</kbd>                                                      | Resize the window (cycles through useful heights) |
| <kbd>Super</kbd><kbd>Shift</kbd><kbd>Alt</kbd><kbd>R</kbd>                                        | Resize the window (cycles backwards through useful heights) |
| <kbd>Super</kbd><kbd>t</kbd>                                                                      | Take window(s) dropping when finished navigating |
| _Not set by default (set in extension settings)_                                                  | Activate the window under mouse cursor |

### The workspace stack & monitors ###

Pressing <kbd>Super</kbd><kbd>Above_Tab</kbd> will slide the active workspace down revealing the stack as shown in the above screenshot. You can then flip through the most recently used workspaces with repeated <kbd>Above_Tab</kbd> presses while holding <kbd>Super</kbd> down. <kbd>Above_Tab</kbd> is the key above <kbd>Tab</kbd> (<kbd>\`</kbd> in a US qwerty layout). Like alt-tab <kbd>Shift</kbd> is added to move in reverse order:

![The most recently used workspace stack](https://github.com/paperwm/media/blob/master/stack.png)

Pressing <kbd>Super</kbd><kbd>Page_Down</kbd> and <kbd>Super</kbd><kbd>Page_Up</kbd> will slide between workspaces sequentially:

![Sequential workspace navigation](https://github.com/paperwm/media/blob/master/sequence.png)

By default <kbd>Super</kbd><kbd>Page_Down</kbd> and <kbd>Super</kbd><kbd>Page_Down</kbd> are bound to the keybindings "Switch to workspace below/above (**ws from current monitor**)". That means using the keybindings you can select all workspaces that were previously shown on the current monitor and all empty once.

Alternatively you can change these keybindings to "Switch to workspace below/above (**ws from all monitors**)" in the settings. That way you can switch to **all** workspaces (that are not currently shown on another monitor). Depending on your workflow this might feel more natural.

The workspace name is shown in the top left corner replacing the `Activities` button adding a few enhancements. Scrolling on the name will let you browse the workspace stack just like <kbd>Super</kbd><kbd>Above_Tab</kbd>. Left clicking on the name opens Gnome overview, while right clicking the name lets you access and change the workspace name.

> If you prefer to use Gnome workspace "pill", you can replace the workspace name element, and enable the Gnome pill from the `General` section of PaperWM preferences:
>
> <img alt="Using the Gnome pill" src="media/gnome-pill-option.png" width="560px">

Swiping down on the trackpad vertically with three fingers will initiate the workspace stack, and then allow you navigate the workspace stack with 3-finger vertical swipes (only available in Wayland).  See the [Touchpad Gestures](#touchpad-gestures) section for more information on gesture support in PaperWM.

There's a single scrollable tiling per workspace. Adding another monitor simply makes it possible to have another workspace visible. The workspace stack is shared among all the monitors, windows being resized vertically as necessary when workspace is displayed on another monitor.

| `workspace` keybindings                                                                           | _Can be changed in PaperWM extension settings_ | 
| ------                                                                                            | ------- |
| <kbd>Super</kbd><kbd>\`</kbd>                                                                     | Switch to previously active workspace |
| <kbd>Shift</kbd><kbd>Super</kbd><kbd>\`</kbd>                                                     | Switch to previously active workspace (backwards order) |
| <kbd>Ctrl</kbd><kbd>Super</kbd><kbd>\`</kbd>                                                      | Move active window to previously active workspace |
| <kbd>Shift</kbd><kbd>Ctrl</kbd><kbd>Super</kbd><kbd>\`</kbd>                                      | Move active window to previously active workspace (backwards order) |
| <kbd>Super</kbd><kbd>PageUp</kbd>                                                                 | Switch to workspace above |
| <kbd>Super</kbd><kbd>PageDown</kbd>                                                               | Switch to workspace below |
| <kbd>Ctrl</kbd><kbd>Super</kbd><kbd>PageUp</kbd>                                                  | Move active window one workspace up |
| <kbd>Ctrl</kbd><kbd>Super</kbd><kbd>PageDown</kbd>                                                | Move active window one workspace down |
| <kbd>Ctrl</kbd><kbd>Super</kbd><kbd>B</kbd>                                                       | Toggle show/hide (GNOME) TopBar and Window Position Bar |
| _Not set by default (set in extension settings)_                                                  | Toggle show/hide (GNOME) TopBar |
| _Not set by default (set in extension settings)_                                                  | Toggle show/hide Window Position Bar |


| `monitor` keybindings                                                                             | _Can be changed in PaperWM extension settings_ | 
| ------                                                                                            | ------- |
| <kbd>Super</kbd><kbd>Shift</kbd><kbd>Right</kbd>                                                  | Switch to the right monitor |
| <kbd>Super</kbd><kbd>Shift</kbd><kbd>Left</kbd>                                                   | Switch to the left monitor |
| <kbd>Super</kbd><kbd>Shift</kbd><kbd>Up</kbd>                                                     | Switch to the above monitor |
| <kbd>Super</kbd><kbd>Shift</kbd><kbd>Down</kbd>                                                   | Switch to the below monitor |
| <kbd>Shift</kbd><kbd>Ctrl</kbd><kbd>Alt</kbd><kbd>Right</kbd>                                     | Move workspace to monitor on the right |
| <kbd>Shift</kbd><kbd>Ctrl</kbd><kbd>Alt</kbd><kbd>Left</kbd>                                      | Move workspace to monitor on the left |
| <kbd>Shift</kbd><kbd>Ctrl</kbd><kbd>Alt</kbd><kbd>Up</kbd>                                        | Move workspace to monitor above |
| <kbd>Shift</kbd><kbd>Ctrl</kbd><kbd>Alt</kbd><kbd>Down</kbd>                                      | Move workspace to monitor below |
| <kbd>Super</kbd><kbd>Alt</kbd><kbd>Right</kbd>                                                    | Swap workspace with monitor to the right |
| <kbd>Super</kbd><kbd>Alt</kbd><kbd>Left</kbd>                                                     | Swap workspace with monitor to the left |
| <kbd>Super</kbd><kbd>Alt</kbd><kbd>Up</kbd>                                                       | Swap workspace with monitor above |
| <kbd>Super</kbd><kbd>Alt</kbd><kbd>Down</kbd>                                                     | Swap workspace with monitor below |
| <kbd>Shift</kbd><kbd>Ctrl</kbd><kbd>Super</kbd><kbd>Right</kbd>                                   | Move active window to the right monitor |
| <kbd>Shift</kbd><kbd>Ctrl</kbd><kbd>Super</kbd><kbd>Left</kbd>                                    | Move active window to the left monitor |
| <kbd>Shift</kbd><kbd>Ctrl</kbd><kbd>Super</kbd><kbd>Up</kbd>                                      | Move active window to the above monitor |
| <kbd>Shift</kbd><kbd>Ctrl</kbd><kbd>Super</kbd><kbd>Down</kbd>                                    | Move active window to the below monitor |

### Scratch layer ###

![The floating scratch layer, with the alt tab menu open](https://github.com/paperwm/media/blob/master/scratch.png)

The scratch layer is an escape hatch to a familiar floating layout. This layer is intended to store windows that are globally useful like chat applications and in general serve as the kitchen sink.
When the scratch layer is active it will float above the tiled windows, when hidden the windows will be minimized.

Pressing <kbd>Super</kbd><kbd>Escape</kbd> toggles between showing and hiding the windows in the scratch layer.
Activating windows in the scratch layer is done using <kbd>Super</kbd><kbd>Tab</kbd>, the floating windows having priority in the list while active.
When the tiling is active <kbd>Super</kbd><kbd>Shift</kbd><kbd>Tab</kbd> selects the most recently used scratch window.

<kbd>Super</kbd><kbd>Ctrl</kbd><kbd>Escape</kbd> will move a tiled window into the scratch layer or alternatively tile an already floating window. This functionality can also be accessed through the window context menu (<kbd>Alt</kbd><kbd>Space</kbd>).

| `scratch` keybindings                                                                             | _Can be changed in PaperWM extension settings_ | 
| ------                                                                                            | ------- |
| <kbd>Shift</kbd><kbd>Super</kbd><kbd>Escape</kbd>                                                 | Toggles the floating scratch layer |
| <kbd>Ctrl</kbd><kbd>Super</kbd><kbd>Escape</kbd>                                                  | Attach/detach active window into scratch layer |
| <kbd>Super</kbd><kbd>Escape</kbd>                                                                 | Toggle the most recent scratch window |

## Touchpad Gestures  ###

PaperWM implements the following touchpad gestures by default:

Gesture                       | Action              
------------------------------|------------------------------------------------------
three-finger swipe up         | Gnome Overview
three-finger swipe down       | PaperWM workspace stack view (see [here](#the-workspace-stack--monitors))
three-finger swipe left/right | Moves tiling viewport (windows) left / right

PaperWM touchpad gesture behaviour can be modified via the `General` tab in PaperWM settings:

<img alt="Touchpad gesture settings" src="media/gesture-settings.png" width="560px">

## Window Position Bar (colored bar segment in Top Bar) ##

[#476](https://github.com/paperwm/PaperWM/pull/476) added a coloured window position bar to the Gnome Top Bar.  This allows users to visually identify the current selected window position of the scrollable viewport in the current workspace.  This is demonstrated in the following video:

https://user-images.githubusercontent.com/30424662/221416159-464d7512-5174-451b-9035-0ee84f9eb4ec.mp4

The window position bar can be _disabled_ from `PaperWM extension settings`:

<img alt="Window indicator bar" src="media/window-indicator-bar.png" width="560px">

You can style both the coloured position bar and the dimmed "position bar backdrop" by overriding the `paperwm-window-position-bar` and `paperwm-window-position-bar-backdrop` CSS classes respectively (see `user.css` in [User configuration & development](#user-configuration--development) section for more information). The `paperwm-window-position-bar` will also inherit the selection color (same as window borders) from `tile-preview`.

_Note: PaperWM overrides the default Gnome Top Bar style to be completely transparent so that the dimmed `window-position-bar-backdrop` and `window-position-bar` elements are visible._

## Window Focus Modes ##

[#482](https://github.com/paperwm/PaperWM/pull/482) added the concept of `window focus modes` to PaperWM.  A `focus mode` controls how windows are "focused".  The following modes are currently available:

- the `DEFAULT` focus mode is the traditional PaperWM behaviour (no snapping, just free scrolling)
- the `CENTER` focus mode causes all windows to be centered horizontally on selection
- the `EDGE` focus mode causes windows to snap to the closest edge horizontally on selection (but while there is only one window, it is centered)

Focus modes can be toggled by user-settable keybinding (default is `Super`+`Shift`+`c`), or by clicking the new focus-mode button in the Top Bar:

![Focus mode button](media/focus-mode-button.png)

### Setting the default focus mode

The default focus mode is the standard PaperWM focus mode (i.e. not centered).  This can be changed according to preference by changing the `Default focus mode` setting PaperWM settings.  

<img alt="Default focus mode" src="media/default-focus-mode.png" width="560px">

_Note: changing this setting during a PaperWM session will set all spaces to the new default focus mode._

### Hiding the focus mode icon

Users may also prefer to hide the focus mode icon.  You can do so from the `Advanced` tab in PaperWM extension settings:

<img alt="Hiding the focus mode icon" src="media/hide-focus-mode-icon.png" width="560px">

## Setting window specific properties

It's possible to set window properties using simple rules that will be applied when placing new windows. Properties can applied to windows identified by their `wm_class` or `title`.  The following properties are currently supported:

Property              | Input type                          | Input example | Description
----------------------|-------------------------------------|------------------|------------------
`scratch_layer`       | Boolean                             | `true`, `false`  | if `true` window will be placed on the scratch layer.
`preferredWidth`      | String value with `%` or `px` unit         | `"50%"`, `"450px"`    | resizes the window width to the preferred width when it's created. </br>_Note<sup>1</sup>: property not applicable to windows on scratch layer._

Window properties can be added using the `Winprops` tab of the PaperWM extension settings:

https://user-images.githubusercontent.com/30424662/211422647-79e64d56-5dbb-4054-b9a6-32bf3194b636.mp4

The `wm_class` or `title` of a window can be found by using looking glass: <kbd>Alt</kbd><kbd>F2</kbd> `lg` <kbd>Return</kbd> Go to the "Windows" section at the top right and find the window. X11 users can also use the `xprop` command line tool (`title` is referred as `WM_NAME` in `xprop`). The match of `wm_class` and `title` are with an OR condition; and in addition to a plain string matching, a constructed [`RegExp()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/RegExp) can be used to utilise regex matching.  For example, e.g. `/.*terminal.*/i` would match on any value that contains the word "terminal" (case-insensitive).

### Setting a default window property rule

You can use the functionality defined in the [setting window specific properties](#setting-window-specific-properties) section to define a `default` window property rule that will be applied to all windows NOT matched by a more specific window property rule.

You do this by using the special "match all" operator `*` as an input for `wm_class` or `title`.  The below image shows setting a default `Preferred width` value of `50%`.

<img alt="Setting default window property rule" src="media/default-star-winprop.png" width="560px">

This special operator is at a lower precedence, so more specific properties that match a window will always take precedence and be applied.


## Window insertion position for new windows (and dropped windows in `take` mode)

By default PaperWM inserts new windows (and drops windows in `take` mode, see [Managing multiple windows at once](#managing-multiple-windows-at-once)) to the right of the currently active window.  This behaviour can be changed via PaperWM settings, or with the `Open Window Position` button/icon (which is to the right of the focus mode icon):

![Open positions button](media/open-position-button.png)

There are several `positions` available for selection.  Namely, `right`, `left`, `start`, `end`.  The latter two will insert windows at the start or end of tiled windows container.

Options for these settings, as well as settings to enable/disable specific positions in the `Open Window Position` buttons, are provided in PaperWM settings:

https://github.com/paperwm/PaperWM/assets/30424662/4e4aa415-d047-44cb-b87a-d7e08493ecbd

## Managing multiple windows at once

PaperWM provides functionality to move, reorder, and close multiple windows at once.  These "multi-window" operations are initialised with the `Take the window, dropping it when finished navigating` keybind (default <kbd>Super</kbd><kbd>T</kbd>).

This allows you to `take` multiple windows and temporarily store them in the bottom-right corner of the workspace.  The following operations are available while there are one or more windows "taken":

_Selectively take/drop windows (pressing `spacebar` to drop the latest taken window):_

https://github.com/paperwm/PaperWM/assets/30424662/f736adea-d5ba-4c9d-aca0-2f63322c08cb

_Selecting all windows across spaces to close at once (pressing `q`):_

https://github.com/paperwm/PaperWM/assets/30424662/e6596de2-f5f7-46af-b447-044f17f326f9

_Reordering "taken" windows and selectively dropping them:_

https://github.com/paperwm/PaperWM/assets/30424662/c7c50471-f352-4693-a936-2e711189f933

## User configuration & development ##

You can supply a custom `user.css` in `~/.config/paperwm/`. This user stylesheet can override the default styles of paperwm (e.g. from `~/.local/share/gnome-shell/extensions/paperwm@paperwm.github.com/user.css` or `/usr/share/gnome-shell/extensions/paperwm@paperwm.github.com/user.css`), gnome or even other extensions. The same rules as for CSS in the browser apply (i.e. CSS rules are additive). 

You can reload the `user.css` by disabling (turning off) PaperWM and then re-enabling PaperWM (turning on), e.g via `Extensions` app, or by running `Main.loadTheme()` in looking glass (i.e. <kbd>Alt</kbd><kbd>F2</kbd> `lg` <kbd>Return</kbd>). Note that the latter approach will reload all other .css files (e.g. from other extensions) and `user.css` needs to already be loaded for this to work. So after initially creating the file you'll need to disable then enable PaperWM (or restart Gnome).

### Using PaperWM extension settings (UI) to modify settings
PaperWM provides an extension settings UI to modify many of PaperWM's more prevalent settings.  This is available in the `gnome-extensions` application.

### Using dconf-editor to modify settings
You can also use `dconf-editor` to view and modify all PaperWM user settings.  You can view all settings by executing the following command from a terminal:

```shell
GSETTINGS_SCHEMA_DIR=::$HOME/.local/share/gnome-shell/extensions/paperwm@paperwm.github.com/schemas dconf-editor /org/gnome/shell/extensions/paperwm/ &>/dev/null
```

### PaperWM user-configurable settings _not_ available in settings UI

Below is a list of user-configurable settings that are not exposed in the PaperWM settings UI.  These can be modified via [`dconf-editor`](#using-dconf-editor-to-modify-settings).

Setting | Description | Input Type | Default value
--------|-------------|------------|--------------
<code>default&#8209;background</code>| Sets the (default) background used for PaperWM workspaces.  If set will use this background instead of colors defined in `workspace-colors`. | _absolute path_ | _empty_

_Note: you can override this for individual workspaces in the settings UI._

__Example:__
```
dconf write /org/gnome/shell/extensions/paperwm/default-background '"/home/user/Wallpaper/mars-sunset-2k.jpg"'
```

Setting | Description | Input Type | Default value
--------|-------------|------------|--------------
<code>workspace&#8209;colors</code>  | Sets the workspace background color palette. | _String array of colors_ | `['#314E6C', '#565248', '#445632', '#663822', '#494066',   '#826647', '#4B6983', '#807D74', '#5D7555', '#884631', '#625B81', '#B39169', '#7590AE', '#BAB5AB', '#83A67F', '#C1665A', '#887FA3', '#E0C39E']`

## Gnome Top Bar opacity / styling ##

PaperWM by default changes the opacity of the Gnome Top Bar.  This styling is used for certain PaperWM features.  However, this styling may conflict with the Top Bar styling of other extensions (that you may prefer have style the Top Bar instead).

Users can disable PaperWM's ability to change GNOME Top Bar styling from PaperWM settings:

<img alt="Enable Top Bar Styling" src="media/topbar-styling.png" width="560px">

_Note: several PaperWM specific features are dependent on changing the Gnome Top Bar to function correctly.  If you choose to disable PaperWM's ability to change the Top Bar styles (with the setting above), you may also want to disable the [Window Position Bar](#window-position-bar-colored-bar-segment-in-top-bar)_.

## Managed Gnome Shell Settings ##

There's a few Gnome Shell settings that are incompatible with, or work poorly with, PaperWM. Namely
- `workspaces-only-on-primary`: Multi monitor support require workspaces
  spanning all monitors
- `edge-tiling`: We don't support the native half tiled windows
- `attach-modal-dialogs`: Attached modal dialogs can cause visual glitching

PaperWM manages these settings (disables them) during runtime.  It will then restore these settings to their prior values when PaperWM is disabled.

## Recommended extensions ##

These extensions are good complements to PaperWM:

- [Switcher](https://github.com/daniellandau/switcher) - combined window switcher and launcher
- [Dash to Dock](https://micheleg.github.io/dash-to-dock/) - a great dock
- [Focus Follows Workspace](https://github.com/christopher-l/focus-follows-workspace) - This complements the experience with multiple monitors and GNOME's global hotkeys for switching workspaces or moving windows to workspaces (see #704)

## Incompatible extensions

In most cases it should be enough to disable these extensions.

- [DING (Desktop Icons NG)](https://gitlab.com/rastersoft/desktop-icons-ng) (shipped by default with Ubuntu) or similar extensions that add desktop icons. Creates invisible windows and does not properly show icons. See #784, #266
- Fedoras builtin desktop watermark (shipped with Fedora) See #706
- [Rounded Window Corners](https://github.com/yilozt/rounded-window-corners) or similar extensions that change the window shape. See #763, #431
- [Space Bar](https://github.com/christopher-l/space-bar) or similar extensions that modify workspace names etc. See #720
- [Dash to Panel](https://github.com/home-sweet-gnome/dash-to-panel) or similar panels. Works in some configurations and in some not. Is incompatible with PaperWMs window position bar. See #170, #199, #646, #382, #166, #258

See issues tagged with the [extension-conflict](https://github.com/paperwm/PaperWM/issues?q=is%3Aissue+label%3Aextension-conflict+sort%3Aupdated-desc) label for current and closed issues related to extension conflicts.

In general extensions that do one of the following are problematic when used together with PaperWM (although they might partially work):

- Modify the desktop
- Modify window "shapes" (e.g. rounded corners)
- Modify workspaces
- Modify touch gestures

PaperWM will attempt to disable keybindings of some known extensions if they clash. E.g. the Ubuntu Tiling Assistant from Ubuntu 23.10.

## Related / similar projects ##

More projects are embracing the scrollable tiling concept!  The following projects may be of interest to others (especially if PaperWM doesn't quite work for you):

- Niri: https://github.com/YaLTeR/niri
- Karousel (for KDE): https://github.com/peterfajdiga/karousel
- papersway (for i3/sway): https://spwhitton.name/tech/code/papersway/

A similar idea was apparently tried out a while back: [10/GUI](https://web.archive.org/web/20201123162403/http://10gui.com/).
