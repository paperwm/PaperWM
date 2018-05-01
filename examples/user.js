var Extension;
function init() {
  // Runs _only_ once on startup
  Extension = imports.misc.extensionUtils.getCurrentExtension();
}

function enable() {
  // Runs on extension reloads, eg. when unlocking the session
}

function disable() {
  // Runs on extension reloads eg. when locking the session (`<super>L).
}

