import GLib from 'gi://GLib';

let pointerWatcher = null;

/**
 * Return a pointer watcher that works before and after GNOME Shell 51.
 *
 * GNOME Shell 51 removed its private pointerWatcher.js module in favour of
 * Meta.CursorTracker's position-invalidated signal. Older Shell releases do
 * not expose that signal, so use the former polling behaviour as a fallback.
 *
 * @returns {PointerWatcher}
 */
export function getPointerWatcher() {
    pointerWatcher ??= new PointerWatcher();
    return pointerWatcher;
}

class PointerWatch {
    constructor(watcher, interval, callback) {
        this.watcher = watcher;
        this.interval = interval;
        this.callback = callback;
    }

    remove() {
        this.watcher._removeWatch(this);
    }
}

class PointerWatcher {
    constructor() {
        this._watches = [];
        this._cursorTracker = null;
        this._positionInvalidatedId = 0;
        this._timeoutId = 0;
        this._pointerX = null;
        this._pointerY = null;
    }

    addWatch(interval, callback) {
        // Avoid calling a new watch for the pointer's current position.
        this._updatePointer();

        const watch = new PointerWatch(this, interval, callback);
        this._watches.push(watch);
        this._updateSource();
        return watch;
    }

    _removeWatch(watch) {
        const index = this._watches.indexOf(watch);
        if (index === -1)
            return;

        this._watches.splice(index, 1);
        this._updateSource();
    }

    _updateSource() {
        this._removeSource();
        if (this._watches.length === 0)
            return;

        // This is the GNOME Shell 51 path. Connecting can fail on older
        // releases where CursorTracker does not yet expose this signal.
        try {
            this._cursorTracker = global.backend.get_cursor_tracker();
            this._positionInvalidatedId = this._cursorTracker.connect(
                'position-invalidated', () => this._updatePointer());
            return;
        } catch {
            this._cursorTracker = null;
            this._positionInvalidatedId = 0;
        }

        const interval = Math.min(...this._watches.map(watch => watch.interval));
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

        this._cursorTracker = null;

        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
    }

    _getPointer() {
        if (this._cursorTracker) {
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
