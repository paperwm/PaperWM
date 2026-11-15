/**
 * Pure (shell-free) helpers for positioning popup/transient windows.
 *
 * Deliberately free of `gi://` and gnome-shell imports so it can be unit-tested
 * with standalone GJS (tests/test-popup-visibility.js). `tiling.js`'s
 * `ensureVisibleInWorkArea` is a thin adapter that feeds live MetaWindow /
 * Space objects into these functions.
 */

/**
 * Reconcile a Space's monitor-relative workArea into screen-absolute bounds.
 *
 * `Space.workArea()` returns monitor-relative coordinates (it subtracts
 * `monitor.x` / `monitor.y`), while `MetaWindow.get_frame_rect()` and
 * `move_frame()` are screen-absolute. Folding the monitor origin back in here
 * avoids relocating windows to the wrong monitor on multi-head.
 *
 * @param {{x:number,y:number}} monitor  the monitor's screen-absolute origin
 * @param {{x:number,y:number,width:number,height:number}} workArea  monitor-relative
 * @returns {{x:number,y:number,width:number,height:number}}
 */
export function workAreaToBounds(monitor, workArea) {
    return {
        x: monitor.x + workArea.x,
        y: monitor.y + workArea.y,
        width: workArea.width,
        height: workArea.height,
    };
}

/**
 * Clamp a frame rectangle into bounds, returning the target {x, y}.
 *
 * A window that fits is shifted minimally so it is fully inside bounds. One
 * that is larger than bounds on an axis is pinned to the leading edge
 * (minX / minY) rather than allowed to go negative.
 *
 * @param {{x:number,y:number,width:number,height:number}} frame
 * @param {{x:number,y:number,width:number,height:number}} bounds
 * @returns {{x:number,y:number}}
 */
export function computeClampedPosition(frame, bounds) {
    const minX = bounds.x;
    const maxX = bounds.x + bounds.width - frame.width;
    const minY = bounds.y;
    const maxY = bounds.y + bounds.height - frame.height;
    const x = Math.max(minX, Math.min(frame.x, maxX));
    const y = Math.max(minY, Math.min(frame.y, maxY));
    return { x, y };
}
