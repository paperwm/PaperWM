#!/usr/bin/env bash
# Gather and print version information about the system.
#
# Expects the following commands to be available:
# - git
# - gnome-shell
# - gnome-extensions
# Optionally:
# - awk

REPO="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "${REPO}"

echo "Please include this information in your bug report on GitHub!"

echo -n "Distribution: "
if [ -f /etc/os-release ]; then
    source /etc/os-release && echo "${NAME}"
fi

gnome-shell --version

echo -n "Display server: "
if [ "${XDG_SESSION_TYPE}" = "wayland" ]; then
    echo "Wayland"
else
    echo "Xorg"
fi

echo -n "PaperWM branch/tag: "
git symbolic-ref --short -q HEAD || git name-rev --tags --name-only --no-undefined "$(git rev-parse HEAD)"
echo -n "PaperWM commit: "
git rev-parse HEAD

echo "Enabled extensions:"
# make a markdown list out of gnome-extensions list
gnome-extensions list --enabled | {
    if command -v awk >/dev/null; then
        awk '{print "- " $0}'
    else
        cat
    fi
}

