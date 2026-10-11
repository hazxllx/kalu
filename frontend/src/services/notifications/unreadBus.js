/**
 * Tiny cross-component signal for notification unread-state changes.
 *
 * The notification bell/badge lives in the shared DashboardLayout while the
 * read/unread actions happen inside the NotificationsPage (a routed child).
 * They do not share React state, so after marking a notification read the badge
 * would otherwise only refresh on the next navigation. This bus lets the page
 * tell the badge to re-sync immediately, keeping the dropdown entry point, the
 * full page, and the unread count consistent.
 *
 * It carries no payload — listeners re-fetch the authoritative count from the
 * server so the badge always reflects persisted state, never an optimistic
 * guess that could drift on failure.
 */
const EVENT_NAME = "kalusagap:notifications-unread-changed";

/** Announce that the unread set may have changed (mark read / mark all read). */
export const notifyUnreadChanged = () => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
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
