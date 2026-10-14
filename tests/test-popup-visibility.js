#!/usr/bin/env gjs
/*
 * Unit tests for the pure popup-positioning helpers (popuputil.js).
 *
 * Run:  gjs -m tests/test-popup-visibility.js
 *
 * These cover the shell-free pieces only — the coordinate reconciliation
 * (workArea is monitor-relative, frame/move_frame are screen-absolute) and the
 * clamp arithmetic (incl. the oversize edge case). The shell-facing wrappers in
 * tiling.js (ensureVisibleInWorkArea, the focus / demands-attention entry
 * points, the isPopupClass predicate) need a live gnome-shell session and are
 * exercised manually.
 */

import { workAreaToBounds, computeClampedPosition } from '../popuputil.js';
import system from 'system';

let _passed = 0, _failed = 0;
const _failures = [];

function check(name, cond, detail) {
    if (cond) {
        _passed++;
    } else {
        _failed++;
        _failures.push(detail ? `${name}  —  ${detail}` : name);
        print(`  FAIL: ${name}${detail ? `  —  ${detail}` : ''}`);
    }
}

function rectEq(a, b) {
    return Math.round(a.x) === Math.round(b.x) && Math.round(a.y) === Math.round(b.y);
}

// ─── workAreaToBounds (the coordinate bug: monitor-relative vs screen-absolute) ─

print('\n== workAreaToBounds (coordinate reconciliation) ==');

{
    const mon = { x: 0, y: 0 };
    const wa = { x: 0, y: 12, width: 1920, height: 1068 };
    const b = workAreaToBounds(mon, wa);
    check('primary monitor keeps origin', b.x === 0 && b.y === 12,
        `got x=${b.x} y=${b.y}`);
    check('primary width/height pass through', b.width === 1920 && b.height === 1068);
}

{
    // THE BUG SCENARIO: secondary monitor at x=1920. A naive clamp comparing
    // screen-absolute frame.x against monitor-relative workArea.x (0) would
    // relocate the window onto the primary monitor. Reconciliation adds 1920.
    const mon = { x: 1920, y: 0 };
    const wa = { x: 0, y: 0, width: 1920, height: 1080 };
    const b = workAreaToBounds(mon, wa);
    check('secondary monitor bounds.x == 1920', b.x === 1920,
        `got ${b.x} (wrong monitor if 0)`);
    check('secondary monitor right edge == 3840', b.x + b.width === 3840,
        `got ${b.x + b.width}`);
}

// ─── computeClampedPosition ────────────────────────────────────────────────────

print('\n== computeClampedPosition (clamp math) ==');

{
    const bounds = { x: 0, y: 0, width: 1920, height: 1080 };

    let r = computeClampedPosition({ x: 100, y: 100, width: 800, height: 600 }, bounds);
    check('already visible: unchanged', rectEq(r, { x: 100, y: 100 }),
        `got x=${r.x} y=${r.y}`);

    r = computeClampedPosition({ x: -200, y: 100, width: 800, height: 600 }, bounds);
    check('off left: clamped to minX', r.x === 0, `got ${r.x}`);

    r = computeClampedPosition({ x: 1500, y: 100, width: 800, height: 600 }, bounds);
    check('off right: clamped to maxX - width', r.x === 1920 - 800, `got ${r.x}`);

    r = computeClampedPosition({ x: 100, y: -50, width: 800, height: 600 }, bounds);
    check('off top: clamped to minY', r.y === 0, `got ${r.y}`);

    r = computeClampedPosition({ x: 100, y: 700, width: 800, height: 600 }, bounds);
    check('off bottom: clamped to maxY - height', r.y === 1080 - 600, `got ${r.y}`);

    // oversize: wider AND taller than the workarea must pin to the leading
    // edge, not go negative (this case is why computeClampedPosition uses
    // Math.max(minX, …) rather than a bare right-edge rule).
    r = computeClampedPosition({ x: 500, y: 500, width: 3000, height: 2000 }, bounds);
    check('oversize: clamped to minX', r.x === 0, `got ${r.x}`);
    check('oversize: clamped to minY', r.y === 0, `got ${r.y}`);
}

{
    // Multi-monitor: a popup half-off the RIGHT edge of the secondary monitor
    // must stay on the secondary monitor, not jump to the primary.
    const bounds = { x: 1920, y: 0, width: 1920, height: 1080 };
    const frame = { x: 1920 + 1500, y: 100, width: 800, height: 600 };
    const r = computeClampedPosition(frame, bounds);
    check('multi-monitor: stays on secondary',
        r.x === 1920 + (1920 - 800), `got ${r.x}, expected ${1920 + (1920 - 800)}`);
    check('multi-monitor: not relocated to primary', r.x >= 1920,
        `got ${r.x} (< 1920 would be the primary-monitor bug)`);
}

// ─── end-to-end (workArea + frame + clamp, multi-monitor) ──────────────────────

print('\n== end-to-end (workArea + frame + clamp, multi-monitor) ==');

{
    // Reproduces the reported symptom: popup of an off-screen parent, partially
    // visible (clamped to the monitor edge by mutter). Should land fully
    // on-screen AND on the correct monitor.
    const monitor = { x: 1920, y: 0 };
    const workArea = { x: 0, y: 0, width: 1920, height: 1080 };
    const bounds = workAreaToBounds(monitor, workArea);
    const frame = { x: 3500, y: 100, width: 800, height: 600 };
    const target = computeClampedPosition(frame, bounds);
    const fullyOnScreen =
        target.x >= bounds.x &&
        target.y >= bounds.y &&
        target.x + frame.width <= bounds.x + bounds.width &&
        target.y + frame.height <= bounds.y + bounds.height;
    check('end-to-end: popup fully on-screen', fullyOnScreen,
        `target x=${target.x} y=${target.y}`);
    check('end-to-end: on correct (secondary) monitor', target.x >= 1920,
        `got ${target.x}`);
    check('end-to-end: actually moved (not a no-op)',
        !(target.x === frame.x && target.y === frame.y));
}

{
    // No-op case: popup already visible should not move (idempotency for
    // repeated demands-attention signals).
    const monitor = { x: 0, y: 0 };
    const workArea = { x: 0, y: 0, width: 1920, height: 1080 };
    const bounds = workAreaToBounds(monitor, workArea);
    const frame = { x: 500, y: 400, width: 800, height: 600 };
    const target = computeClampedPosition(frame, bounds);
    check('no-op when already visible',
        target.x === frame.x && target.y === frame.y,
        `expected unchanged, got x=${target.x} y=${target.y}`);
}

// ─── summary ───────────────────────────────────────────────────────────────────

print(`\n━━━ ${_passed} passed, ${_failed} failed ━━━`);
if (_failed > 0) {
    print('Failures:');
    _failures.forEach(f => print(`  • ${f}`));
}
system.exit(_failed > 0 ? 1 : 0);
