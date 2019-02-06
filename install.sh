#!/usr/bin/env bash

EXT_DIR=${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions
mkdir -p "$EXT_DIR"
ln -s "$(realpath .)" "$EXT_DIR"/'paperwm@hedning:matrix.org'
