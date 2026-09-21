/* eslint-disable no-await-in-loop -- Lifecycle stages must execute sequentially. */
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import { ExtensionState } from 'resource:///org/gnome/shell/misc/extensionUtils.js';

const UUID = 'paperwm@paperwm.github.com';
export const METRICS = {
    fullscreen: { description: 'Fullscreen tile survives extension reload and exit from fullscreen', units: 'checks', value: 0 },
    pendingRestore: { description: 'Restore immediately before disable remains tiled', units: 'checks', value: 0 },
    cycles: { description: 'Verified scratch-preserving lifecycle cycles', units: 'cycles', value: 0 },
};
function assert(value, message) {
    if (!value)
        throw new Error(message);
}
async function settle() {
    await Scripting.waitLeisure();
    await Scripting.sleep(400);
}
export async function run() {
    await settle();
    const extension = Main.extensionManager.lookup(UUID);
    assert(extension?.state === ExtensionState.ACTIVE, 'PaperWM not active');
    const { Scratch, Tiling } = await import(`file://${extension.path}/imports.js`);
    for (let i = 0; i < 4; i++)
        await Scripting.createTestWindow({ width: 300 + i * 20, height: 250 });
    await Scripting.waitTestWindows();
    await settle();
    const windows = global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null);
    assert(windows.length === 4, `Expected 4 windows, got ${windows.length}`);
    const [tiled, minimizedTiled, scratch, minimizedScratch] = windows;
    Scratch.makeScratch(scratch);
    Scratch.makeScratch(minimizedScratch);
    await settle();
    tiled.make_fullscreen();
    await settle();
    assert(tiled.fullscreen && tiled.is_above(), 'Precondition: fullscreen tile must be above');
    await Main.extensionManager._callExtensionDisable(UUID);
    await settle();
    await Main.extensionManager._callExtensionEnable(UUID);
    await settle();
    assert(extension.state === ExtensionState.ACTIVE, 'PaperWM failed to re-enable with fullscreen tile');
    assert(tiled.fullscreen, 'Reload unexpectedly exited fullscreen');
    assert(Tiling.spaces.spaceOfWindow(tiled).indexOf(tiled) >= 0 &&
        !Scratch.isScratchWindow(tiled), 'Fullscreen tile became scratch across reload');
    tiled.unmake_fullscreen();
    await settle();
    assert(Tiling.spaces.spaceOfWindow(tiled).indexOf(tiled) >= 0 &&
        !Scratch.isScratchWindow(tiled) && !tiled.is_on_all_workspaces(),
    'Exiting fullscreen failed to preserve tiling');
    METRICS.fullscreen.value++;
    console.log('SCRATCH_NATIVE fullscreen passed');
    // Do not settle between unminimize and disable: its deferred restoration
    // must survive a lifecycle boundary before the compositor idle callback.
    minimizedTiled.minimize();
    await settle();
    minimizedTiled.unminimize();
    await Main.extensionManager._callExtensionDisable(UUID);
    await settle();
    await Main.extensionManager._callExtensionEnable(UUID);
    await settle();
    assert(extension.state === ExtensionState.ACTIVE, 'PaperWM failed to re-enable after pending restore');
    assert(Tiling.spaces.spaceOfWindow(minimizedTiled).indexOf(minimizedTiled) >= 0 &&
        !Scratch.isScratchWindow(minimizedTiled), 'Pending restore became explicit scratch across reload');
    assert(!minimizedTiled.is_above() && !minimizedTiled.is_on_all_workspaces(),
        'Pending restore retained scratch above/sticky state');
    console.log('SCRATCH_NATIVE pending-restore passed');
    METRICS.pendingRestore.value++;
    for (let cycle = 0; cycle < 3; cycle++) {
        minimizedTiled.minimize();
        minimizedScratch.minimize();
        await settle();
        assert(minimizedTiled._tiled_on_minimize === true, 'Precondition: tiled restoration marker absent');
        await Main.extensionManager._callExtensionDisable(UUID);
        await settle();
        await Main.extensionManager._callExtensionEnable(UUID);
        await settle();
        assert(extension.state === ExtensionState.ACTIVE, 'PaperWM failed to re-enable');
        assert(minimizedTiled.minimized, 'Reload unexpectedly unminimized a tiled window');
        assert(minimizedScratch.minimized, 'Reload unexpectedly unminimized explicit scratch');
        minimizedTiled.unminimize();
        minimizedScratch.unminimize();
        await settle();
        const actualTiled = w => Tiling.spaces.spaceOfWindow(w).indexOf(w) >= 0;
        const states = windows.map(w => ({
            scratch: Boolean(Scratch.isScratchWindow(w)),
            tiled: actualTiled(w), sticky: w.is_on_all_workspaces(), above: w.is_above(), minimized: w.minimized,
        }));
        console.log(`SCRATCH_NATIVE cycle=${cycle + 1} ${JSON.stringify(states)}`);
        assert(actualTiled(tiled) && !Scratch.isScratchWindow(tiled), 'Visible tiled window lost tiling');
        assert(actualTiled(minimizedTiled) && !Scratch.isScratchWindow(minimizedTiled),
            'Minimized tiled window remained scratch after reload/restore');
        assert(Scratch.isScratchWindow(scratch) && !actualTiled(scratch), 'Explicit visible scratch lost intent');
        assert(Scratch.isScratchWindow(minimizedScratch) && !actualTiled(minimizedScratch),
            'Explicit minimized scratch lost intent');
        assert(!extension.errors?.length, `Extension errors: ${extension.errors}`);
        METRICS.cycles.value++;
    }
    await Scripting.destroyTestWindows();
    await settle();
    assert(global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null).length === 0, 'Window cleanup failed');
}
