#!/usr/bin/env gjs
/*
 * Manual-verification trigger for the popup-visibility fix — the live-window
 * companion to tests/test-popup-visibility.js (which covers only the pure,
 * shell-free geometry). Verified to reproduce the bug pre-fix and confirm it
 * post-fix.
 *
 * Run:   gjs -m tests/trigger-popup.js [delay_secs]
 *
 *   1. Opens a parent window (PaperWM tiles it).
 *   2. Waits <delay> seconds (default 10) — scroll the parent OUT OF VIEW.
 *   3. Pops up a transient (modal) dialog for the parent.
 *
 *   fix works  ⇒ the dialog lands fully on-screen (Case A if it got focus,
 *                Case B / demands-attention if focus was denied — no focus steal
 *                either way, it's just repositioned).
 *   bug present ⇒ dialog clamped at the monitor edge / partially off-screen,
 *                or (Case B + skip_taskbar) not visible at all.
 *
 * To exercise Case A (popup gets focus), click the parent window right before
 * the timer fires. To exercise Case B (focus denied — the common background
 * case), just don't touch the parent after it opens; the popup arrives "stale"
 * and mutter's focus-stealing prevention denies focus.
 */

import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib';

const delay = parseInt(ARGV[0] ?? '10', 10);

const app = new Gtk.Application({ application_id: 'org.paperwm.trigger' });

let parent;

app.connect('activate', () => {
    parent = new Gtk.ApplicationWindow({
        application: app,
        title: 'PaperWM popup trigger — parent',
        default_width: 520,
        default_height: 350,
    });
    parent.set_child(new Gtk.Label({
        label: `Parent window.\n\nIn ${delay}s a transient dialog will pop up.\n` +
               '→ scroll me OUT OF VIEW in PaperWM now.',
    }));
    parent.connect('close-request', () => app.quit());
    parent.present();

    print(`parent up — popup in ${delay}s (scroll the parent off-screen now)`);

    GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, delay, () => {
        const dlg = new Gtk.Window({
            transient_for: parent,
            modal: true,
            title: 'Transient popup',
            default_width: 360,
            default_height: 160,
            destroy_with_parent: true,
        });
        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            margin_top: 14, margin_bottom: 14, margin_start: 14, margin_end: 14,
        });
        box.append(new Gtk.Label({
            label: 'Readable + fully on-screen ⇒ the fix works.\n' +
                   'Clamped at the edge / invisible ⇒ bug.',
        }));
        const btn = new Gtk.Button({ label: 'Close' });
        btn.connect('clicked', () => {
            dlg.destroy();
            app.quit();
        });
        box.append(btn);
        dlg.set_child(box);
        dlg.present();
        print('popup shown');
        return GLib.SOURCE_REMOVE;
    });
});

app.run([]);
