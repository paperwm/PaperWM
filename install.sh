#!/usr/bin/env bash

REPO="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
UUID=paperwm@paperwm.github.com
EXT_DIR=${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions
EXT="$EXT_DIR"/"$UUID"
mkdir -p "$EXT_DIR"

# Check if ext path already exists and if is a folder
if [[ ! -L "$EXT" && -d "$EXT" ]]; then
cat << EOF

INSTALL FAILED:

A previous (non-symlinked) installation of PaperWM already exists at:
"$EXT".

Please remove the installed version from that path and re-run this install script.

EOF
exit 1
fi

ln -snf "$REPO" "$EXT"

cat << EOF

INSTALL SUCCESSFUL:

If this is the first time installing PaperWM, then please logout/login 
and enable the PaperWM extension, either with the Gnome Extensions application, 
or manually by executing the following command from a terminal:

gnome-extensions enable ${UUID}

EOF
