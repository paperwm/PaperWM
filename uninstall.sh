#!/usr/bin/env bash

# NOTE: gnome-extensions uninstall will delete all files in the linked directory

REPO="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
if [[ -L "$REPO" ]]; then
   REPO=`readlink --canonicalize "$REPO"`
fi
UUID=paperwm@hedning:matrix.org
if type gnome-extensions > /dev/null; then
    gnome-extensions disable "$UUID"
else
    gnome-shell-extension-tool --disable="$UUID"
fi
EXT_DIR=${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions
EXT=$EXT_DIR/$UUID
LINK=`readlink --canonicalize "$EXT"`
if [[ "$LINK" != "$REPO" ]]; then
    echo "$EXT" does not link to "$REPO", refusing to remove
    exit 1
fi
rm $EXT
