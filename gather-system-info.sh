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

main() {
    cd "${REPO}"

    echo "Please include this information in your bug report on GitHub!"

    show_distribution
    show_gnome_version
    show_display_server
    show_paperwm_version
    show_gnome_extensions
}

show_distribution() {
    echo -n "Distribution: "
    if [ -f /etc/os-release ]; then
        source /etc/os-release && echo "${NAME}"
    fi
}

show_gnome_version() {
    gnome-shell --version
}

show_display_server() {
    echo -n "Display server: "
    if [ "${XDG_SESSION_TYPE}" = "wayland" ]; then
        echo "Wayland"
    else
        echo "Xorg"
    fi
}

show_paperwm_version() {
    echo -n "PaperWM branch/tag: "
    git symbolic-ref --short -q HEAD || git name-rev --tags --name-only --no-undefined "$(git rev-parse HEAD)"
    echo -n "PaperWM commit: "
    git rev-parse HEAD

}

show_gnome_extensions() {
    echo "Enabled extensions:"
    # make a markdown list out of gnome-extensions list
    # use gnome-extensions if it exists and falls back to bash on older gnome
    # versions
    if command -v gnome-extensions >/dev/null; then
        gnome-extensions list --enabled | {
            if command -v awk >/dev/null; then
                awk '{print "- " $0}'
            else
                cat
            fi
        }
    else
        # compare enabled extensions to installed extensions
        # because some uninstalled extensions could still be enabled because of
        # stale gsettings
        for ext in $(_enabled_extensions); do
            if is_extension_installed "$ext"; then
                echo "- $ext"
            fi
        done
    fi
}

is_extension_installed() {
    local ext=$1
    [[ -d "$HOME/.local/share/gnome-shell/extensions/$ext" ]] || [[ -d "/usr/share/gnome-shell/extensions/$ext" ]]
}

_enabled_extensions() {
    local s matches
    s=$(gsettings get org.gnome.shell enabled-extensions)
    # $matches contains lines with the extension uuid and lines with ", "
    mapfile -t matches < <(_global_rematch "$s" "'([^']*)'")
    for match in "${matches[@]}"; do
        if [[ "$match" =~ ^,\s* ]]; then
            continue
        fi
        echo "$match"
    done
}

_global_rematch() {
    local s=$1 regex=$2
    while [[ $s =~ $regex ]]; do
        echo "${BASH_REMATCH[1]}"
        s=${s#*"${BASH_REMATCH[1]}"}
    done
}

main "$@"
