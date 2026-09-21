# Scratch lifecycle regression tests

Run `tests/run-scratch-tests` with Node.js 20 or newer. The runner enables Node's
experimental VM module API; no package installation is required. To test another
source checkout, set `PAPERWM_SOURCE_DIR` to its absolute path.

The suite evaluates the complete production `tiling.js` and `scratch.js`
modules with explicit GNOME import mocks. Test-only exports expose SaveState and
inject a mocked Spaces collection. It calls the real SaveState.prepare, flag
cleanup, scratch enable/disable, Space.addAll, minimizeHandler, and insertWindow
winprop branch. It does not instantiate a GNOME desktop or run the complete
extension enable/disable chain.

Coverage includes visible and minimized tiles, deliberate scratch windows,
first-enable heuristics, scratch winprops, destroyed windows, repeated
population, and restoration callbacks crossing lifecycle boundaries. Explicit
scratch choices cancel pending restoration; internal refreshes retain it.

`native/scratch-lifecycle.js` is a GNOME Shell automation module. Run it only in
an isolated GNOME test session with PaperWM installed and enabled, using Shell's
`--automation-script` option. It creates four windows, enters and exits actual
fullscreen across an extension reload, then tests immediate restore followed by
disable and three cycles of visible/minimized tiled and scratch windows. It
exports assertion-backed metrics for the automation runner and destroys its
test windows on success. This test calls the extension manager's disable/enable
methods; it does not simulate a lock screen, physical display power cycle, or
application-specific behavior. Do not run it in your active desktop session.
