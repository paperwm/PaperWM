#!/usr/bin/env bash

DEST=${XDG_DATA_HOME:-$HOME/.local/share}/'gnome-shell/extensions/paperwm@hedning:matrix.org'

if [[ -L "$DEST" || ! -e "$DEST" ]]; then
    ln -fTs "$(realpath ./src)" "$DEST"
else
    echo Install destination already exists: "$DEST"
    echo "  re run install to fix it."
fi
