#!/usr/bin/env bash

REPO="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
UUID=paperwm@hedning:matrix.org
EXT_DIR=${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions
mkdir -p "$EXT_DIR"
ln -sn "$REPO" "$EXT_DIR"/"$UUID"

read -p "Enable the extension [Y/n]: " consent
case "$p" in
    Y|"")
    ;;
    *)
        exit
    ;;
esac

# Coax gnome-shell to enable the extension, since gnome-extensions enable does't
# work without a restart
ENABLE=`cat <<EOF
try {
    let path = "$EXT_DIR";
    let uuid = "$UUID";
    let Gio = imports.gi.Gio;
    let extensionUtils, extensionSystem, paperwm;
    // Work around differences between 3.32 and 3.34
    if (imports.misc.extensionUtils.createExtensionObject) {
        extensionSystem = imports.ui.extensionSystem;
        extensionUtils = imports.misc.extensionUtils;
        paperwm = extensionUtils[uuid];
    } else {
        extensionSystem = imports.ui.main.extensionManager;
        extensionUtils = extensionSystem;
        paperwm = extensionSystem.lookup(uuid);
    }
    if (paperwm)
        throw new Error("paperwm-loaded");

    let dir = Gio.File.new_for_path(path + "/" + uuid);
    let extension = extensionUtils.createExtensionObject(uuid, dir, 2);

    extensionSystem.loadExtension(extension);
    extensionSystem.enableExtension(uuid);
} catch (e) {
    if (e.message === "paperwm-loaded")
       "paperwm already loaded"
    else
        e.message + "  " + e.stack;
};
EOF
`
echo "Trying to load and enable extension:"
RET=`gdbus call --session -d org.gnome.Shell -o /org/gnome/Shell -m org.gnome.Shell.Eval "$ENABLE"`
if [[ "(true, '\"paperwm already loaded\"')" = "$RET" ]]; then
    echo "paperwm is already loaded, enabling with gnome-extensions"
    if type gnome-extensions > /dev/null; then
        gnome-extensions enable "$UUID"
    else
        gnome-shell-extension-tool --enable="$UUID"
    fi
    echo Success
elif [[ "(true, 'true')" != "$RET" ]]; then
    echo something went wrong:
    echo $RET | sed -e "s/(true, '\"//" | sed -e "s/\\\\n/\n/g"
else
    echo Success
fi
