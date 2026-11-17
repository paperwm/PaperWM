import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

let pointerWatcher = null;

/**
 * Return a pointer watcher that works before and after GNOME Shell 51.
 *
 * GNOME Shell 51 removed its private pointerWatcher.js module in favour of
 * Meta.CursorTracker's position-invalidated signal. That signal is used on
 * Wayland; X11 sessions (GNOME 45-48) poll the pointer instead.
 *
 * @returns {PointerWatcher}
 */
export function getPointerWatcher() {
    pointerWatcher ??= new PointerWatcher();
    return pointerWatcher;
}

/**
 * Drop every watch and release the signal handler or timeout.
 * Called from stackoverlay's disable().
 */
export function destroyPointerWatcher() {
    pointerWatcher?.destroy();
    pointerWatcher = null;
}

class PointerWatch {
    constructor(watcher, interval, callback) {
        this.watcher = watcher;
        this.interval = interval;
        this.callback = callback;
    }

    remove() {
        this.watcher.removeWatch(this);
    }
}

class PointerWatcher {
    constructor() {
        this._watches = [];
        // Mutter emits position-invalidated for every pointer motion only
        // under Wayland. On X11 (GNOME 45-48) it fires only while mutter
        // itself tracks the position, so poll there instead.
        this._useSignal = Meta.is_wayland_compositor();
        this._cursorTracker = this._useSignal
            ? global.backend.get_cursor_tracker() : null;
        this._positionInvalidatedId = 0;
        this._timeoutId = 0;
        this._timeoutInterval = 0;
        this._pointerX = null;
        this._pointerY = null;
    }

    addWatch(interval, callback) {
        // Avoid calling a new watch for the pointer's current position.
        this._updatePointer();

        const watch = new PointerWatch(this, interval, callback);
        this._watches.push(watch);

        if (this._useSignal)
            this._connectSignal();
        else
            this._startPolling(interval);

        return watch;
    }

    /**
     * Remove a watch. This only releases resources: the source is removed
     * with the last watch, and is never created or replaced here.
     *
     * @param {PointerWatch} watch
     */
    removeWatch(watch) {
        const index = this._watches.indexOf(watch);
        if (index === -1)
            return;

        this._watches.splice(index, 1);
        if (this._watches.length === 0)
            this._removeSource();
    }

    destroy() {
        this._watches = [];
        this._removeSource();
        this._cursorTracker = null;
    }

    _connectSignal() {
        if (this._positionInvalidatedId)
            return;

        this._positionInvalidatedId = this._cursorTracker.connect(
            'position-invalidated', () => this._updatePointer());
    }

    _startPolling(interval) {
        // The running poll is already fast enough for this watch.
        if (this._timeoutId && interval >= this._timeoutInterval)
            return;

        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);

        this._timeoutInterval = interval;
        this._timeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            interval,
            () => {
                this._updatePointer();
                return GLib.SOURCE_CONTINUE;
            });
        GLib.Source.set_name_by_id(
            this._timeoutId, '[paperwm] pointer watcher');
    }

    _removeSource() {
        if (this._positionInvalidatedId) {
            this._cursorTracker.disconnect(this._positionInvalidatedId);
            this._positionInvalidatedId = 0;
        }

        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
            this._timeoutInterval = 0;
        }
    }

    _getPointer() {
        if (this._useSignal) {
            const [point] = this._cursorTracker.get_pointer();
            return [point.x, point.y];
        }

        return global.get_pointer();
    }

    _updatePointer() {
        const [x, y] = this._getPointer();
        if (this._pointerX === x && this._pointerY === y)
            return;

        this._pointerX = x;
        this._pointerY = y;

        // A callback may remove itself, so only advance while the same watch
        // remains at the current index.
        for (let i = 0; i < this._watches.length;) {
            const watch = this._watches[i];
            watch.callback(x, y);
            if (watch === this._watches[i])
                i++;
        }
    }
}
