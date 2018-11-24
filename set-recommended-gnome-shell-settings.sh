#!/usr/bin/env bash

RESTORE_SETTINGS_SCRIPT="restore-gnome-shell-settings-$(date +%F).sh"

if [[ -e $RESTORE_SETTINGS_SCRIPT ]]; then
    echo "$RESTORE_SETTINGS_SCRIPT exists"
    exit 1
fi

function set-with-backup {
    DPATH=$1
    TARGET_VAL=$2
    CURRENT_VAL=$(dconf read $DPATH)
    echo "dconf write $DPATH $CURRENT_VAL" >> $RESTORE_SETTINGS_SCRIPT

    dconf write $DPATH $TARGET_VAL
    echo "Changed $DPATH from '$CURRENT_VAL' to '$TARGET_VAL'"
}

##### Recommended settings

set-with-backup /org/gnome/mutter/auto-maximize false

# Multi-monitor support is much more complete with workspaces spanning monitors
set-with-backup /org/gnome/shell/overrides/workspaces-only-on-primary false

# PaperWM currently works best using static workspaces
set-with-backup /org/gnome/shell/overrides/dynamic-workspaces false

# We make no attempt at handing edge-tiling
set-with-backup /org/gnome/shell/overrides/edge-tiling false


echo
echo "Run $RESTORE_SETTINGS_SCRIPT to revert changes"
