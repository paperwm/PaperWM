#!/usr/bin/env bash

# Simple helper script to start nested wayland/x11 gnome sessions

# The new dbus address is copied into the clipboard so you're able to run
# `M-x # gnome-shell-set-dbus-address` and paste the address.

old_display=$DISPLAY

d=0
while [ -e /tmp/.X11-unix/X${d} ]; do
    d=$((d + 1))
done

NEW_DISPLAY=:$d

export XDG_CONFIG_HOME=$HOME/paperwm/.config

args=()

DISPLAY=$NEW_DISPLAY
eval $(dbus-launch --exit-with-session --sh-syntax)
echo $DBUS_SESSION_BUS_ADDRESS

echo -n $DBUS_SESSION_BUS_ADDRESS \
    | DISPLAY=$old_display xclip -i -selection clipboard

DISPLAY=$old_display
case $1 in
    w*|-w*|--w*)
        echo "Running Wayland Gnome Shell"
        args=(--nested --wayland)
        ;;
    *)
        echo "Running X11 Gnome Shell"
        Xephyr $NEW_DISPLAY &
        DISPLAY=$NEW_DISPLAY
        args=--x11
        ;;
esac


dconf reset -f /  # Reset settings
dconf write /org/gnome/shell/enabled-extensions "['paperwm@paperwm.github.com']"

gnome-shell $args

