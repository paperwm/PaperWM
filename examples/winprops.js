const Extension = imports.misc.extensionUtils.getCurrentExtension();
const defwinprop = Extension.imports.tiling.defwinprop

defwinprop({
    wm_class: "copyq",
    scratch_layer: true
});

defwinprop({
    wm_class: "Riot",
    oneshot: true, // Allow reattaching
    scratch_layer: true
});

// Fix rofi in normal window mode (eg. in Wayland)
defwinprop({
    wm_class: "Rofi",
    focus: true
});
