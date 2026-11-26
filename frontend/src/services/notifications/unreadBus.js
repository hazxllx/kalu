// frontend/src/services/notifications/unreadBus.js
/**
 * Tiny cross-component signal for notification unread-state changes.
 *
 * The notification bell/badge lives in the shared DashboardLayout while the
 * read/unread actions happen inside the NotificationsPage (a routed child).
 * This bus immediately synchronizes the badge and can request an authoritative
 * refresh after a mutation settles.
 */
const EVENT_NAME = "kalusagap:notifications-unread-changed";

/**
 * Announce an unread count change. An optimistic count can be supplied so the
 * shared badge updates immediately; listeners may then refresh after the
 * mutation settles to reconcile against the server.
 */
export const notifyUnreadChanged = (unreadCount, { refresh = true } = {}) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT_NAME, {
    detail: { unreadCount, refresh },
  }));
};

/**
 * Subscribe to unread-change signals. Returns an unsubscribe function suitable
 * for a React effect cleanup.
 */
export const onUnreadChanged = (handler) => {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
};

export default { notifyUnreadChanged, onUnreadChanged };
