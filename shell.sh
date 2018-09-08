#!/usr/bin/env bash

old_display=$DISPLAY
NEW_DISPLAY=:3

export XDG_CONFIG_HOME=$HOME/paperwm/.config

case $1 in
    w*|-w*|--w*)
        echo "Running Wayland Gnome Shell"
        arg=--nested
        ;;
    *)
        echo "Running X11 Gnome Shell"
        Xephyr $NEW_DISPLAY &
        arg=--x11
        ;;
esac

# DISPLAY=$NEW_DISPLAY
eval $(dbus-launch --exit-with-session --sh-syntax)
echo $DBUS_SESSION_BUS_ADDRESS
echo -n $DBUS_SESSION_BUS_ADDRESS \
    | DISPLAY=$old_display xclip -i -selection clipboard
exec gnome-shell $arg
