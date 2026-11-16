import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Bell, CheckCheck, ChevronRight } from "lucide-react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import EmptyState from "@/components/common/EmptyState";
import { ICONS, CATEGORIES } from "@/services/local/notificationData";
import { notificationsApi } from "@/services/api";
import { notifyUnreadChanged } from "@/services/notifications/unreadBus";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/ui/use-toast";

/** Relative "time ago" label from an ISO timestamp. */
const relativeTime = (iso) => {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Math.max(0, Date.now() - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
const PRIORITIES = new Set(["emergency", "critical"]);

/** persisted notifications row → UI shape. */
const mapNotification = (row) => {
  const category = typeof row.category === "string" ? row.category : "";
  const priorityValue = String(row.priority || "").toLowerCase();
  const categoryPriority = category.toLowerCase();

  return {
    id: row.id,
    category,
    priority: PRIORITIES.has(priorityValue)
      ? priorityValue
      : PRIORITIES.has(categoryPriority)
        ? categoryPriority
        : "",
    title: row.title,
    desc: row.message || "",
    createdAt: row.created_at,
    time: relativeTime(row.created_at),
    read: Boolean(row.read_at),
    // Kept so the card can deep-link to the related record (e.g. a saved
    // consultation → My Health Records). Never contains clinical detail.
    relatedType: row.related_type || "",
    relatedId: row.related_id || null,
  };
};

/**
 * Resolve a notification's in-app destination from its related record.
 *
 * Only safe, resident-owned destinations are mapped. A "consultation saved"
 * notification links the resident to their My Health Records page (where the
 * Consultation History tab lives). Unknown types stay non-clickable.
 */
const destinationFor = (notification, role) => {
  if (!notification?.relatedType) return null;
  if (notification.relatedType === "consultation" && role === "resident") {
    return "/app/resident/record";
  }
  // Residency transfer requests. Staff reviewers deep-link to the Resident
  // Transfer Requests queue, pre-opening the specific request; a resident is
  // taken to their dashboard, where the transfer status banner shows the
  // decision and any resubmission instructions (no sensitive detail in-feed).
  if (["transfer_request", "transfer_request_resubmitted"].includes(notification.relatedType)) {
    const id = notification.relatedId ? `?request=${encodeURIComponent(notification.relatedId)}` : "";
    if (["health_supervisor", "phn", "mho", "admin"].includes(role)) {
      return `/app/${role}/transfer-requests${id}`;
    }
    if (role === "resident") return "/app/resident/dashboard";
  }
  return null;
};

/** Short, role-aware label for a notification's deep-link action button. */
const actionLabelFor = (notification, role) => {
  if (["transfer_request", "transfer_request_resubmitted"].includes(notification?.relatedType)) {
    return role === "resident" ? "View transfer status" : "Open transfer request";
  }
  return "View My Health Records";
};

/**
 * Notifications (all roles).
 *
 * Reads the authenticated user's own notifications from the database
 * (`/operational/notifications`) — the resident sees exactly the notifications
 * created for their account by Health Supervisor actions (verification
 * decisions, follow-up changes, new records). "Mark as read" persists to the
 * same row so the state survives refresh and re-login.
 */
export default function NotificationsPage({ crumbs = ["Notifications"] }) {
  const navigate = useNavigate();
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const { toast } = useToast();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [activeTab, setActiveTab] = useState("all");
  const notificationsRef = useRef([]);
  const pendingReadIds = useRef(new Set());
  const markAllPending = useRef(false);

  const updateNotifications = React.useCallback((updater) => {
    const next = typeof updater === "function" ? updater(notificationsRef.current) : updater;
    notificationsRef.current = next;
    setNotifications(next);
    return next;
  }, []);

  const unreadIn = (rows) => rows.filter((n) => !n.read).length;

  const load = React.useCallback(() => {
    setLoading(true);
    setLoadError(null);
    return notificationsApi
      .list()
      .then((result) => {
        const rows = result?.rows || result || [];
        const mappedRows = rows.map(mapNotification);
        updateNotifications(mappedRows);
        notifyUnreadChanged(unreadIn(mappedRows), { refresh: false });
      })
      .catch((err) => setLoadError(err?.message || "Unable to load notifications. Please try again."))
      .finally(() => setLoading(false));
  }, [updateNotifications]);

  useEffect(() => { load(); }, [load]);

  const unreadCount = unreadIn(notifications);
  const filteredNotifications = activeTab === "unread"
    ? notifications.filter((n) => !n.read)
    : notifications;

  const markAsRead = async (id) => {
    const target = notificationsRef.current.find((n) => n.id === id);
    if (!target) return false;
    if (target.read) return true;
    if (pendingReadIds.current.has(id) || markAllPending.current) return false;

    pendingReadIds.current.add(id);
    const optimisticRows = updateNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
    notifyUnreadChanged(unreadIn(optimisticRows), { refresh: false });

    try {
      const result = await notificationsApi.markRead(id);
      const row = result?.record || result;
      if (String(row?.id) !== String(id) || !row?.read_at) {
        throw new Error("The server did not confirm that this notification was marked as read.");
      }
      const reconciledRows = updateNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
      );
      notifyUnreadChanged(unreadIn(reconciledRows), { refresh: false });
      return true;
    } catch (err) {
      const restoredRows = updateNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: false } : n)),
      );
      notifyUnreadChanged(unreadIn(restoredRows), { refresh: false });
      toast({
        variant: "destructive",
        title: "Could not mark notification as read",
        description: err?.message || "Please try again.",
      });
      return false;
    } finally {
      pendingReadIds.current.delete(id);
    }
  };

  const markAllAsRead = async () => {
    const snapshot = notificationsRef.current;
    if (!snapshot.some((n) => !n.read) || markAllPending.current || pendingReadIds.current.size > 0) return;
    markAllPending.current = true;
    const optimisticRows = updateNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    notifyUnreadChanged(unreadIn(optimisticRows), { refresh: false });
    try {
      // One atomic server request marks every unread row read — no per-row race.
      const result = await notificationsApi.markAllRead();
      if (result?.updated === undefined) throw new Error("The server did not confirm the notifications update.");
      const reconciledRows = updateNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      notifyUnreadChanged(unreadIn(reconciledRows), { refresh: false });
    } catch (err) {
      // Restore the pre-click state, then reconcile with the server.
      updateNotifications(snapshot);
      notifyUnreadChanged(unreadIn(snapshot), { refresh: false });
      toast({
        variant: "destructive",
        title: "Could not mark all notifications as read",
        description: err?.message || "Please try again.",
      });
      load();
    } finally {
      markAllPending.current = false;
    }
  };

  // Open a notification: mark it read (so the unread count updates), then
  // navigate to its related record when one is mapped. An already-read
  // notification still navigates but creates no extra update.
  const openNotification = async (n) => {
    const current = notificationsRef.current.find((item) => item.id === n.id);
    if (!current) return;
    if (pendingReadIds.current.has(current.id)) return;
    if (!current.read && !(await markAsRead(current.id))) return;
    const destination = destinationFor(current, role);
    if (destination) navigate(destination);
  };

  const hasPriority = (notification) => PRIORITIES.has(notification.priority);
  const getCategoryColor = (notification) => hasPriority(notification)
    ? "border border-[#FECACA] bg-[#FEF2F2] text-[#DC2626] dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
    : CATEGORIES[notification.category]?.color || "bg-slate-100 text-slate-700 dark:bg-slate-700/50 dark:text-slate-200";
  const getCategoryIcon = (category) => {
    const iconName = CATEGORIES[category]?.icon || "Bell";
    return ICONS[iconName] || Bell;
  };
  function getCategoryLabel(category) {
    return CATEGORIES[category]?.label || category
      .split(/[_-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") || "Other";
  }

  const groupNotifications = (notifs) => {
    const groups = { today: [], yesterday: [], earlier: [] };
    const todayStart = startOfDay(new Date());
    const yesterdayStart = todayStart - 86400000;
    notifs.forEach((n) => {
      const t = n.createdAt ? startOfDay(n.createdAt) : 0;
      if (t >= todayStart) groups.today.push(n);
      else if (t >= yesterdayStart) groups.yesterday.push(n);
      else groups.earlier.push(n);
    });
    return groups;
  };

  const grouped = groupNotifications(filteredNotifications);

  const segmented = [
    { id: "all", label: "All", count: notifications.length },
    { id: "unread", label: "Unread", count: unreadCount },
  ];

  const toolbar = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-3">
        <div
          role="tablist"
          aria-label="Filter notifications"
          className="inline-flex items-center gap-1 rounded-[14px] border border-[#E2E8F0] bg-[#F1F5F9] p-1 dark:border-slate-700 dark:bg-slate-800"
        >
          {segmented.map((seg) => {
            const active = activeTab === seg.id;
            return (
              <button
                key={seg.id}
                role="tab"
                aria-selected={active}
                onClick={() => setActiveTab(seg.id)}
                className={`flex h-8 items-center gap-2 rounded-[10px] px-3 text-sm font-medium transition-colors ${
                  active
                    ? "bg-brand-blue text-white shadow-sm"
                    : "bg-transparent text-slate-600 hover:bg-white/70 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700"
                }`}
              >
                {seg.label}
                <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold tabular-nums ${
                  active
                    ? "bg-white/15 text-white"
                    : "bg-[#E2E8F0] text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                }`}>
                  {seg.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

    </div>
  );

  return (
    <div className="mx-auto w-full max-w-[900px]">
      <PageHeader
        management={isAdmin}
        crumbs={crumbs}
        title="Notifications"
        action={unreadCount > 0 ? (
          <button
            type="button"
            onClick={markAllAsRead}
            disabled={markAllPending.current || pendingReadIds.current.size > 0}
            className="inline-flex items-center gap-2 rounded-full border border-white/30 px-4 py-2 text-[12px] font-medium text-white transition-colors hover:bg-white/10 disabled:opacity-60"
          >
            <CheckCheck className="h-3.5 w-3.5" strokeWidth={1.9} /> Mark all as read
          </button>
        ) : null}
        subtitle={
          loading
            ? "Loading notifications..."
            : `${notifications.length} total notification${notifications.length === 1 ? "" : "s"} · ${unreadCount} unread`
        }
      />

      {loading ? (
        <Card>
          <EmptyState icon={Bell} title="Loading notifications..." description="Fetching your latest updates." />
        </Card>
      ) : loadError ? (
        <Card>
          <EmptyState
            icon={Bell}
            title="Unable to load notifications"
            description={loadError}
            action={
              <button onClick={load} className="rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark">
                Try again
              </button>
            }
          />
        </Card>
      ) : notifications.length === 0 ? (
        <Card>
          <EmptyState icon={Bell} title="No Notifications" description="You're all caught up! Check back later for updates." />
        </Card>
      ) : (
        <>
          <Card className="mb-4 p-3 sm:p-4">{toolbar}</Card>

          {filteredNotifications.length === 0 ? (
            <Card>
              <EmptyState
                icon={Bell}
                title="No Notifications Found"
                description={activeTab === "unread" ? "You're all caught up." : "No notifications are available."}
                action={activeTab === "unread" ? (
                  <button
                    onClick={() => setActiveTab("all")}
                    className="rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
                  >
                    Show all notifications
                  </button>
                ) : null}
              />
            </Card>
          ) : (
            <Card className="overflow-hidden p-0">
              {Object.entries(grouped).map(([group, items]) => {
                if (items.length === 0) return null;
                return (
                  <div key={group}>
                    <h4 className="border-b border-brand-border bg-brand-bg px-5 py-2 font-mono text-[9px] font-medium uppercase tracking-[0.13em] text-brand-gray">
                      {group === "today" ? "Today" : group === "yesterday" ? "Yesterday" : "Earlier"}
                    </h4>
                    <ul className="divide-y divide-brand-border">
                      {items.map((n, i) => {
                        const CategoryIcon = getCategoryIcon(n.category);
                        const priority = hasPriority(n) ? n.priority : "";
                        const destination = destinationFor(n, role);
                        const navigates = Boolean(destination);
                        // The whole card is interactive: clicking it marks the
                        // notification read (and navigates when a destination is
                        // mapped). An already-read, non-navigating card needs no
                        // action, so it is left non-interactive.
                        const interactive = navigates || !n.read;
                        const actionLabel = actionLabelFor(n, role);
                        const ariaLabel = navigates
                          ? `${n.title} — ${actionLabel.toLowerCase()}`
                          : `${n.title} — mark as read`;
                        return (
                          <motion.li key={n.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                            <div
                              className={`flex items-start gap-4 px-5 py-4 transition-colors ${
                                priority
                                  ? "border-l-2 border-l-brand-danger/30 bg-brand-danger/5 hover:bg-brand-danger/10"
                                  : n.read
                                    ? "hover:bg-brand-bg"
                                    : "bg-brand-blue/[0.035] hover:bg-brand-blue/[0.06]"
                              } ${interactive ? "cursor-pointer" : ""}`}
                              role={interactive ? "button" : undefined}
                              tabIndex={interactive ? 0 : undefined}
                              aria-label={interactive ? ariaLabel : undefined}
                              onClick={interactive ? () => { void openNotification(n); } : undefined}
                              onKeyDown={interactive ? (e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  void openNotification(n);
                                }
                              } : undefined}
                            >
                              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${getCategoryColor(n)}`}>
                                {priority
                                  ? <AlertTriangle className="h-4 w-4" strokeWidth={1.8} />
                                  : <CategoryIcon className="h-4 w-4" strokeWidth={1.8} />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <p className={`text-sm font-medium text-brand-ink ${!n.read ? "font-semibold" : ""}`}>{n.title}</p>
                                      {!n.read && <span className="w-2 h-2 rounded-full bg-brand-blue shrink-0" aria-label="Unread" />}
                                    </div>
                                    {priority && (
                                      <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-[#FECACA] bg-[#FEF2F2] px-2 py-0.5 text-[10px] font-bold tracking-wide text-[#991B1B] dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
                                        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                                        {priority.toUpperCase()}
                                      </span>
                                    )}
                                    <p className="text-xs text-brand-gray mt-0.5 line-clamp-2">{n.desc}</p>
                                  </div>
                                  <div className="flex flex-col items-end gap-1 shrink-0">
                                    <span className="text-xs text-brand-gray whitespace-nowrap">{n.time}</span>
                                    <span className={`text-xs px-2 py-0.5 rounded-full ${getCategoryColor(n)}`}>
                                      {getCategoryLabel(n.category)}
                                    </span>
                                  </div>
                                </div>
                                <div className="mt-2 flex items-center gap-4">
                                  {navigates && (
                                    <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-blue">
                                      {actionLabel} <ChevronRight className="h-3 w-3" />
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </motion.li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
