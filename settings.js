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

function setVerticalMargin() {
    let vMargin = settings.get_int('vertical-margin');
    let gap = settings.get_int('window-gap');
    prefs.vertical_margin = Math.max(Math.round(gap/2), vMargin);
}

function setState(_, key) {
    let value = settings.get_value(key);
    let name = key.replace(/-/g, '_');
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
    settings.connect('changed::window-gap', setState);
    settings.connect('changed::horizontal-margin', setState);
    settings.connect('changed::vertical-margin', setVerticalMargin);
    setVerticalMargin();
    settings.connect('changed::workspace-colors', setState);
}
