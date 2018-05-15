var Extension = imports.misc.extensionUtils.extensions['paperwm@hedning:matrix.org'];
var settings = Extension.imports.convenience.getSettings();
var utils = Extension.imports.utils;
var debug = utils.debug;

var prefs = {
    window_gap: settings.get_int('window-gap'),
    vertical_margin: settings.get_int('vertical-margin'),
    horizontal_margin: settings.get_int('horizontal-margin'),
    workspace_colors: settings.get_strv('workspace-colors')
};

function setState(_, key) {
    let value = settings.get_value(key);
    let name = key.replace('-', '_');
    switch (value.get_type_string()) {
    case 'i':
        prefs[name] = settings.get_int(key);
        break;
    case 'as':
        prefs[name] = settings.get_strv(key);
        break;
    }
}

function init() {
    settings.connect('changed', setState);
}
