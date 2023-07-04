#!/usr/bin/env bash

REPO="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
UUID=paperwm@paperwm.github.com
EXT_DIR=${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions
mkdir -p "$EXT_DIR"
ln -sn "$REPO" "$EXT_DIR"/"$UUID"

cat <<EOF

PaperWM runs best with some Gnome Shell settings changed:
 workspaces-only-on-primary off: Required for working multi-monitor support
 edge-tiling off: Natively tiled windows doesn't work in PaperWM
 attach-modal-dialogs off: Attached modal dialogs can cause visual glitching
EOF
echo
read -p "Use recommended settings (generates a backup) [Y/n]: " consent
case "$consent" in
    (Y|y|"")
        $REPO/set-recommended-gnome-shell-settings.sh
    ;;
esac

echo
read -p "Enable the extension [Y/n]? " consent
case "$consent" in
    (Y|y|"")
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
    true
} catch (e) {
    if (e.message === "paperwm-loaded")
	true
    else
        e.message + "  " + e.stack;
};
EOF
`
echo "Trying to load and enable extension:"
RET=`gdbus call --session -d org.gnome.Shell -o /org/gnome/Shell -m org.gnome.Shell.Eval "$ENABLE"`
if [[ "(true, 'true')" == "$RET" ]]; then
    # Enable with gnome-extensions tool since `extensionSystem.enableExtension`
    # doesn't write to dconf in version < 3.34
    if type gnome-extensions &> /dev/null; then
        gnome-extensions enable "$UUID"
    else
        gnome-shell-extension-tool --enable="$UUID"
    fi
else
    # String is already quoted and escaped; we want to print the unescaped version
    unescaped="$(echo "$RET" | sed -e "s/(true, '\"//" | sed -e "s/\\\\n/\n/g")"

    echo "Could not enable PaperWM automatically. You may need to enable it manually."
    printf 'Debug output: %s\n' "$unescaped"
fi
