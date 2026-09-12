import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGnomeModule } from './gnome-module-harness.mjs';

const sourceRoot = process.env.PAPERWM_SOURCE_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), '../..');

async function harness() {
    let scratch;
    let space;
    const windows = [];
    const later = [];
    const Meta = { TabList: { NORMAL: 0, NORMAL_ALL: 1 }, WindowType: { NORMAL: 0 }, LaterType: { IDLE: 0 } };
    const display = {
        get_tab_list: () => windows.filter(w => w.alive),
        sort_windows_by_stacking: ws => ws,
    };
    const Settings = { prefs: {}, find_winprop: w => w.winprop, winprops: [] };
    const Utils = { later_add: (_type, fn) => later.push(fn), monitorOfPoint() {} };
    const Scratch = Object.fromEntries(['isScratchWindow', 'makeScratch', 'unmakeScratch'].map(name => [name, (...args) => scratch[name](...args)]));
    const dependencies = {
        'resource:///org/gnome/shell/ui/main.js': {},
        './imports.js': { Settings, Utils, Lib: {}, Gestures: {}, Navigator: {}, Grab: {}, Topbar: {}, Scratch, Stackoverlay: {}, Background: {} },
        './utils.js': { Easer: {}, DispatcherMode: {} },
        './stackoverlay.js': { ClickOverlay: class {} },
        './workspace.js': { WorkspaceSettings: class {} },
    };
    for (const name of ['Clutter', 'GDesktopEnums', 'Gio', 'GLib', 'Graphene', 'St'])
        dependencies[`gi://${name}`] = { default: {} };
    dependencies['gi://Meta'] = { default: Meta };
    const tiling = await loadGnomeModule(resolve(sourceRoot, 'tiling.js'), dependencies, {
        global: { display, workspace_manager: {} },
        imports: { signals: { addSignalMethods() {} } },
        console: { debug() {}, info() {} },
    }, `\nexport function setupTestState(testSpaces) { spaces = testSpaces; saveState ??= new SaveState(); signals = { connectOneShot() {} }; }
export function prepareTestState() { saveState.prepare(); }
export function previousTestSpace(workspace) { return saveState.prevSpaces.get(workspace); }
export function finishTestPopulation(workspace) { saveState.prevSpaces.delete(workspace); }
`);
    scratch = await loadGnomeModule(resolve(sourceRoot, 'scratch.js'), {
        'gi://Meta': { default: Meta },
        'gi://Mtk': { default: { Rectangle: class { constructor(props) { Object.assign(this, props); } } } },
        'resource:///org/gnome/shell/ui/main.js': { activateWindow() {} },
        'resource:///org/gnome/shell/ui/popupMenu.js': {},
        'resource:///org/gnome/shell/ui/windowMenu.js': { WindowMenu: class { _buildMenu() {} } },
        './imports.js': {
            Settings, Utils, Topbar: {},
            Tiling: { spaces: { spaceOfWindow: () => space }, showWindow() {}, focusMonitor() {} },
        },
        './utils.js': { Easer: { addEase: (_actor, params) => params.onComplete() } },
    }, { global: { display }, _: x => x });
    const workspace = { list_windows: () => windows.filter(w => w.alive) };
    function newSpace() {
        space = [];
        Object.assign(space, {
            workspace, uuid: 'test', width: 1200, targetX: 0,
            getWindows() { return this.flat(); },
            indexOf(w) { return this.findIndex(column => column.includes(w)); },
            addWindow(w, i, j = 0) {
                if (this.indexOf(w) >= 0)
                    return;
                if (!this[i])
                    this[i] = [];
                this[i].splice(j, 0, w);
            },
            removeWindow(w) {
                for (const column of this) {
                    const i = column.indexOf(w);
                    if (i >= 0)
                        column.splice(i, 1);
                }
                for (let i = this.length - 1; i >= 0; i--)
                    if (!this[i].length)
                        this.splice(i, 1);
            },
        });
        const spaces = new Map([[workspace, space]]);
        spaces.spaceOfWindow = () => space;
        spaces.selectedSpace = space;
        tiling.setupTestState(spaces);
    }
    function window(props = {}) {
        const actor = {
            connect() {
                return 1; }, disconnect() {},
        };
        const w = {
            alive: true, minimized: false, above: false, sticky: false, window_type: 0,
            clone: { get_transformed_position: () => [10, 20] },
            get_compositor_private() { return this.alive ? actor : null; },
            get_transient_for: () => null,
            get_workspace: () => workspace,
            get_frame_rect: () => ({ x: 10, y: 20, width: 300, height: 400 }),
            get_buffer_rect: () => ({ x: 10, y: 20, width: 300, height: 400 }),
            is_on_all_workspaces() { return this.sticky; },
            make_above() { this.above = true; }, unmake_above() {
                this.above = false; },
            stick() { this.sticky = true;
                space.removeWindow(this); },
            unstick() { this.sticky = false;
                if (this.alive && !this.minimized)
                    space.addWindow(this, space.length); },
            lower() {}, move_resize_frame() {}, move_frame() {},
            ...props,
        };
        windows.push(w);
        return w;
    }
    function populate() {
        tiling.Space.prototype.addAll.call(space, tiling.previousTestSpace(workspace));
        tiling.finishTestPopulation(workspace);
    }
    function disable() {
        tiling.prepareTestState();
        for (const w of windows)
            tiling.removePaperWMFlags(w);
        scratch.disable();
    }
    function enable() {
        newSpace();
        scratch.enable();
        // Actual Spaces.init clears flags before Space.addAll on every enable.
        for (const w of windows)
            tiling.removePaperWMFlags(w);
        populate();
    }
    function flush() {
        while (later.length)
            later.shift()(); }
    function minimize(w) {
        w.minimized = true;
        tiling.minimizeHandler(w);
        flush(); }
    function restore(w) {
        w.minimized = false;
        tiling.minimizeHandler(w);
        flush(); }
    newSpace();
    scratch.enable();
    return {
        window, populate, disable, enable, minimize, restore, scratch, tiling,
        isTiled: w => space.indexOf(w) >= 0,
        getSpace: () => space, flush,
        flushOne: () => later.shift()(),
    };
}

test('ordinary minimized tile returns to tiling after repeated disable/enable cycles', async () => {
    const h = await harness();
    const w = h.window();
    h.populate();
    h.minimize(w);
    for (let i = 0; i < 3; i++) {
        h.disable();
        h.enable();
        assert.equal(w._tiled_on_minimize, true);
        assert.equal(Boolean(h.scratch.isScratchWindow(w)), true);
        assert.equal(h.isTiled(w), false);
    }
    h.restore(w);
    assert.equal(h.isTiled(w), true);
    assert.equal(Boolean(h.scratch.isScratchWindow(w)), false);
    assert.equal(w.sticky, false);
    assert.equal(w.above, false);
});

for (const minimized of [false, true]) {
    test(`explicit scratch preserves intent when minimized=${minimized}, even if above was cleared`, async () => {
        const h = await harness();
        const w = h.window();
        h.populate();
        h.scratch.makeScratch(w);
        if (minimized)
            h.minimize(w);
        w.above = false;
        h.disable();
        h.enable();
        assert.equal(Boolean(h.scratch.isScratchWindow(w)), true);
        assert.equal(w._tiled_on_minimize, undefined);
        if (minimized)
            h.restore(w);
        assert.equal(h.isTiled(w), false);
        assert.equal(Boolean(h.scratch.isScratchWindow(w)), true);
    });
}

test('temporary scratch restored while disabled returns directly to tiling', async () => {
    const h = await harness();
    const w = h.window();
    h.populate();
    h.minimize(w);
    h.disable();
    w.minimized = false;
    h.enable();
    assert.equal(h.isTiled(w), true);
    assert.equal(Boolean(h.scratch.isScratchWindow(w)), false);
    assert.equal(w.sticky, false);
});

test('ordinary tile minimized while disabled restores to tiling', async () => {
    const h = await harness();
    const w = h.window();
    h.populate();
    h.disable();
    w.minimized = true;
    h.enable();
    assert.equal(h.isTiled(w), false);
    h.restore(w);
    assert.equal(h.isTiled(w), true);
    assert.equal(Boolean(h.scratch.isScratchWindow(w)), false);
});

test('ordinary window already minimized at first enable is temporary scratch', async () => {
    const h = await harness();
    const w = h.window({ minimized: true });
    h.populate();
    h.restore(w);
    assert.equal(h.isTiled(w), true);
    assert.equal(Boolean(h.scratch.isScratchWindow(w)), false);
});

test('above heuristic still preserves pre-existing floating windows on first enable', async () => {
    const h = await harness();
    const w = h.window({ above: true, minimized: true });
    h.populate();
    h.restore(w);
    assert.equal(h.isTiled(w), false);
    assert.equal(Boolean(h.scratch.isScratchWindow(w)), true);
});

test('visible tile stays tiled when temporarily above (e.g. fullscreen)', async () => {
    const h = await harness();
    const w = h.window();
    h.populate();
    w.above = true;
    h.disable();
    h.enable();
    assert.equal(h.isTiled(w), true);
    assert.equal(Boolean(h.scratch.isScratchWindow(w)), false);
    assert.equal(w.above, true);
});

test('closed windows are pruned without restoring scratch or retained tiling entries', async () => {
    const h = await harness();
    const tiled = h.window();
    const scratched = h.window();
    h.populate();
    h.scratch.makeScratch(scratched);
    h.disable();
    tiled.alive = false;
    scratched.alive = false;
    h.enable();
    assert.equal(h.getSpace().length, 0);
    assert.equal(Boolean(h.scratch.isScratchWindow(scratched)), false);
});

test('explicit scratch chosen after a completed minimize/restore survives another cycle', async () => {
    const h = await harness();
    const w = h.window();
    h.populate();
    h.minimize(w);
    h.restore(w);
    h.scratch.makeScratch(w);
    h.minimize(w);
    h.disable();
    h.enable();
    h.restore(w);
    assert.equal(Boolean(h.scratch.isScratchWindow(w)), true);
    assert.equal(h.isTiled(w), false);
});

// Exercise the real insertWindow winprop branch, with clone sizing already hooked up.
test('scratch_layer winprop still creates persistent explicit scratch', async () => {
    const h = await harness();
    const w = h.window({ winprop: { scratch_layer: true }, _resizeHandlerAdded: true, _positionHandlerAdded: true });
    h.tiling.insertWindow(w);
    assert.equal(Boolean(h.scratch.isScratchWindow(w)), true);
    h.minimize(w);
    h.disable();
    h.enable();
    h.restore(w);
    assert.equal(Boolean(h.scratch.isScratchWindow(w)), true);
    assert.equal(h.isTiled(w), false);
});

test('saved tile intent is consumed before a later workspace population sees newly chosen scratch', async () => {
    const h = await harness();
    const w = h.window();
    h.populate();
    h.disable();
    h.enable();
    h.scratch.makeScratch(w);
    h.minimize(w);
    w.above = false;
    h.populate();
    assert.equal(w._tiled_on_minimize, undefined);
    h.restore(w);
    assert.equal(Boolean(h.scratch.isScratchWindow(w)), true);
    assert.equal(h.isTiled(w), false);
});

for (const flushWhileDisabled of [true, false]) {
    test(`pending restore survives disable/enable (idle while disabled=${flushWhileDisabled})`, async () => {
        const h = await harness();
        const w = h.window();
        h.populate();
        h.minimize(w);
        w.minimized = false;
        h.tiling.minimizeHandler(w);
        h.disable();
        if (flushWhileDisabled)
            h.flush();
        h.enable();
        h.flush();
        assert.equal(h.isTiled(w), true);
        assert.equal(Boolean(h.scratch.isScratchWindow(w)), false);
        assert.equal(w.sticky, false);
        assert.equal(w.above, false);
    });
}

test('explicit scratch choice cancels pending restore and survives reload', async () => {
    const h = await harness();
    const w = h.window();
    h.populate();
    h.minimize(w);
    w.minimized = false;
    h.tiling.minimizeHandler(w);
    h.scratch.makeScratch(w);
    h.flush();
    assert.equal(h.isTiled(w), false);
    assert.equal(Boolean(h.scratch.isScratchWindow(w)), true);
    h.disable();
    h.enable();
    assert.equal(h.isTiled(w), false);
    assert.equal(Boolean(h.scratch.isScratchWindow(w)), true);
});

test('restore callback does not touch a destroyed window', async () => {
    const h = await harness();
    const w = h.window();
    h.populate();
    h.minimize(w);
    w.minimized = false;
    h.tiling.minimizeHandler(w);
    w.alive = false;
    w.get_frame_rect = w.unmake_above = w.unstick = () => assert.fail('Destroyed window was accessed');
    h.flush();
});

test('old restore callback cannot complete a newer minimize/restore transition', async () => {
    const h = await harness();
    const w = h.window();
    h.populate();
    h.minimize(w);
    w.minimized = false;
    h.tiling.minimizeHandler(w);
    w.minimized = true;
    h.tiling.minimizeHandler(w);
    w.minimized = false;
    h.tiling.minimizeHandler(w);
    h.flushOne();
    assert.equal(h.isTiled(w), false);
    h.flush();
    assert.equal(h.isTiled(w), true);
    assert.equal(Boolean(h.scratch.isScratchWindow(w)), false);
});

test('repeated population preserves temporary scratch restoration', async () => {
    const h = await harness();
    const w = h.window();
    h.populate();
    h.minimize(w);
    h.populate();
    h.restore(w);
    assert.equal(h.isTiled(w), true);
    assert.equal(Boolean(h.scratch.isScratchWindow(w)), false);
});
