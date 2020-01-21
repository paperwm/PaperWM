#!/usr/bin/env bash

RESTORE_SETTINGS_SCRIPT="restore-gnome-shell-settings-$(date +%F).sh"

if [[ -e $RESTORE_SETTINGS_SCRIPT ]]; then
    echo "$RESTORE_SETTINGS_SCRIPT exists"
    exit 1
fi

GNOME_SHELL_VERSION=$(gnome-shell --version)

if [[ $GNOME_SHELL_VERSION > "GNOME Shell 3.3" ]]; then
   USE_OVERRIDE_SCHEMA=true
fi

echo -e "#!/usr/bin/env bash\n\n" > $RESTORE_SETTINGS_SCRIPT
chmod +x $RESTORE_SETTINGS_SCRIPT

function set-with-backup {
    SCHEMA=$1
    KEY=$2
    TARGET_VAL=$3

    if [[ $USE_OVERRIDE_SCHEMA == true ]]; then
        # Gnome 3.3x doesn't use the override path
        # https://gitlab.gnome.org/GNOME/gnome-shell/commit/393d7246cc176cbe8200a62bd661830597ca2fb6
        SCHEMA=$(echo $SCHEMA |
                    sed "s|^org\.gnome\.shell\.overrides|org.gnome.mutter|g")
    fi

    CURRENT_VAL=$(gsettings get $SCHEMA $KEY)
    if [[ "$CURRENT_VAL" == "$TARGET_VAL" ]]; then
        return
    fi

    echo "gsettings set $SCHEMA $KEY $CURRENT_VAL" >> $RESTORE_SETTINGS_SCRIPT

    gsettings set $SCHEMA $KEY $TARGET_VAL
    echo "Changed $SCHEMA $KEY from '$CURRENT_VAL' to '$TARGET_VAL'"
}


##### Recommended settings

# Multi-monitor support is much more complete with workspaces spanning monitors
set-with-backup org.gnome.shell.overrides workspaces-only-on-primary false

# We make no attempt at handing edge-tiling
set-with-backup org.gnome.shell.overrides edge-tiling false

# Attached modal dialogs isn't handled very well
set-with-backup org.gnome.shell.overrides attach-modal-dialogs false



echo
echo "Run $RESTORE_SETTINGS_SCRIPT to revert changes"
