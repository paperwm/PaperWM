/**
  Some of Gnome Shell's default behavior is really sub-optimal when using
  paperWM. This is a collection of monkey patches and preferences which works
  around these problems.
 */

var Extension = imports.misc.extensionUtils.extensions['paperwm@hedning:matrix.org'];

var Meta = imports.gi.Meta;
var Main = imports.ui.main;
var prefs = Extension.imports.settings.prefs;
var utils = Extension.imports.utils;

function overrideHotCorners() {
    for (let corner of Main.layoutManager.hotCorners) {
        if (!corner)
            return;

        corner._toggleOverview = function() {
        };

        corner._pressureBarrier._trigger = function() {
            this._isTriggered = true;
            Extension.imports.topbar.show();
            this._reset();
        };
    }
}

var orgUpdateState;
var signals;
function init() {
    orgUpdateState = imports.ui.messageTray.MessageTray.prototype._updateState;
    signals = new utils.Signals();
}

function enable() {

    if (prefs.override_hot_corner) {
        overrideHotCorners();
        signals.connect(Main.layoutManager, 'hot-corners-changed', overrideHotCorners);
    }

    // Don't hide notifications when there's fullscreen windows in the workspace.
    // Fullscreen windows aren't special in paperWM and might not even be
    // visible, so hiding notifications makes no sense.
    with (imports.ui.messageTray) {
        MessageTray.prototype._updateState
            = function () {
                let hasMonitor = Main.layoutManager.primaryMonitor != null;
                this.actor.visible = !this._bannerBlocked && hasMonitor && this._banner != null;
                if (this._bannerBlocked || !hasMonitor)
                    return;

                // If our state changes caused _updateState to be called,
                // just exit now to prevent reentrancy issues.
                if (this._updatingState)
                    return;

                this._updatingState = true;

                // Filter out acknowledged notifications.
                let changed = false;
                this._notificationQueue = this._notificationQueue.filter(function(n) {
                    changed = changed || n.acknowledged;
                    return !n.acknowledged;
                });

                if (changed)
                    this.emit('queue-changed');

                let hasNotifications = Main.sessionMode.hasNotifications;

                if (this._notificationState == State.HIDDEN) {
                    let nextNotification = this._notificationQueue[0] || null;
                    if (hasNotifications && nextNotification) {
                        // Monkeypatch here
                        let limited = this._busy;
                        let showNextNotification = (!limited || nextNotification.forFeedback || nextNotification.urgency == Urgency.CRITICAL);
                        if (showNextNotification)
                            this._showNotification();
                    }
                } else if (this._notificationState == State.SHOWN) {
                    let expired = (this._userActiveWhileNotificationShown &&
                                   this._notificationTimeoutId == 0 &&
                                   this._notification.urgency != Urgency.CRITICAL &&
                                   !this._banner.focused &&
                                   !this._pointerInNotification) || this._notificationExpired;
                    let mustClose = (this._notificationRemoved || !hasNotifications || expired);

                    if (mustClose) {
                        let animate = hasNotifications && !this._notificationRemoved;
                        this._hideNotification(animate);
                    } else if (this._pointerInNotification && !this._banner.expanded) {
                        this._expandBanner(false);
                    } else if (this._pointerInNotification) {
                        this._ensureBannerFocused();
                    }
                }

                this._updatingState = false;

                // Clean transient variables that are used to communicate actions
                // to updateState()
                this._notificationExpired = false;
            };
    }
}

function disable() {
    imports.ui.messageTray.MessageTray.prototype._updateState = orgUpdateState;

    Main.layoutManager._updateHotCorners();
    signals.destroy();
}
