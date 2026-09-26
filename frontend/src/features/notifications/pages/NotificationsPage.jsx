import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Bell, CheckCheck, RefreshCw } from "lucide-react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import EmptyState from "@/components/common/EmptyState";
import { ICONS, CATEGORIES } from "@/services/local/notificationData";
import { notificationsApi } from "@/services/api";

const CATEGORY_FILTERS = ["information", "reminder", "alert", "success", "warning"];

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

/** persisted notifications row → UI shape. */
const mapNotification = (row) => ({
  id: row.id,
  category: row.category || "information",
  title: row.title,
  desc: row.message || "",
  createdAt: row.created_at,
  time: relativeTime(row.created_at),
  read: Boolean(row.read_at),
});

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
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [filter, setFilter] = useState("all");

  const load = React.useCallback(() => {
    setLoading(true);
    setLoadError(null);
    return notificationsApi
      .list()
      .then((result) => {
        const rows = result?.rows || result || [];
        setNotifications(rows.map(mapNotification));
      })
      .catch((err) => setLoadError(err?.message || "Unable to load notifications. Please try again."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const filteredNotifications = notifications.filter((n) => {
    if (filter === "all") return true;
    if (filter === "unread") return !n.read;
    return n.category === filter;
  });

  const markAsRead = async (id) => {
    // Optimistic — revert on failure.
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    try {
      await notificationsApi.update(id, {});
    } catch {
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: false } : n)));
    }
  };

  const markAllAsRead = async () => {
    const unread = notifications.filter((n) => !n.read);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    try {
      await Promise.all(unread.map((n) => notificationsApi.update(n.id, {})));
    } catch {
      load();
    }
  };

  const getCategoryColor = (category) => CATEGORIES[category]?.color || "bg-brand-gray/10 text-brand-gray";
  const getCategoryIcon = (category) => {
    const iconName = CATEGORIES[category]?.icon || "Bell";
    return ICONS[iconName] || Bell;
  };

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
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Filter notifications" className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-0.5 dark:border-border dark:bg-card-nested">
          {segmented.map((seg) => {
            const active = filter === seg.id;
            return (
              <button
                key={seg.id}
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(seg.id)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  active ? "bg-white text-brand-ink shadow-sm dark:bg-card dark:text-foreground" : "text-brand-gray hover:text-brand-ink dark:hover:text-foreground"
                }`}
              >
                {seg.label}
                <span className={`rounded-full px-1.5 py-0.5 text-[11px] tabular-nums ${active ? "bg-brand-blue/10 text-brand-blue" : "bg-slate-200/70 text-brand-gray dark:bg-slate-700/60 dark:text-slate-300"}`}>
                  {seg.count}
                </span>
              </button>
            );
          })}
        </div>

        <select
          aria-label="Filter by category"
          value={CATEGORY_FILTERS.includes(filter) ? filter : "all"}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-brand-ink outline-none transition-colors hover:border-brand-blue focus:border-brand-blue dark:border-border dark:bg-input dark:text-foreground"
        >
          <option value="all">All categories</option>
          {CATEGORY_FILTERS.map((c) => (
            <option key={c} value={c}>{CATEGORIES[c]?.label || c}</option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={load}
          className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-brand-gray transition-colors hover:bg-slate-100 dark:hover:bg-hover"
        >
          <RefreshCw className="h-4 w-4" strokeWidth={1.9} /> Refresh
        </button>
        <button
          onClick={markAllAsRead}
          disabled={unreadCount === 0}
          className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-brand-blue transition-colors hover:bg-brand-blue/5 disabled:cursor-not-allowed disabled:text-slate-400 dark:disabled:text-slate-500"
        >
          <CheckCheck className="h-4 w-4" strokeWidth={1.9} /> Mark all as read
        </button>
      </div>
    </div>
  );

  return (
    <>
      <PageHeader
        crumbs={crumbs}
        title="Notifications"
        subtitle={
          loading
            ? "Loading notifications..."
            : notifications.length === 0
              ? "Stay updated on reminders, alerts, and advisories."
              : unreadCount > 0
                ? `You have ${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}.`
                : "You're all caught up."
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
                description="Try adjusting your filter to see more notifications."
                action={
                  <button onClick={() => setFilter("all")} className="rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark">
                    Show all notifications
                  </button>
                }
              />
            </Card>
          ) : (
            <Card className="p-4">
              {Object.entries(grouped).map(([group, items]) => {
                if (items.length === 0) return null;
                return (
                  <div key={group} className="mb-6 last:mb-0">
                    <h4 className="text-xs font-semibold text-brand-gray uppercase tracking-wide mb-3">
                      {group === "today" ? "Today" : group === "yesterday" ? "Yesterday" : "Earlier"}
                    </h4>
                    <div className="space-y-2">
                      {items.map((n, i) => {
                        const CategoryIcon = getCategoryIcon(n.category);
                        return (
                          <motion.div key={n.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                            <div className={`flex items-start gap-3 p-3 rounded-btn transition-all hover:shadow-sm hover:bg-brand-light ${!n.read ? "bg-brand-blue/5" : ""}`}>
                              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${getCategoryColor(n.category)}`}>
                                <CategoryIcon className="w-4 h-4" strokeWidth={1.8} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <p className={`text-sm font-medium text-brand-ink ${!n.read ? "font-semibold" : ""}`}>{n.title}</p>
                                      {!n.read && <span className="w-2 h-2 rounded-full bg-brand-blue shrink-0" aria-label="Unread" />}
                                    </div>
                                    <p className="text-xs text-brand-gray mt-0.5 line-clamp-2">{n.desc}</p>
                                  </div>
                                  <div className="flex flex-col items-end gap-1 shrink-0">
                                    <span className="text-xs text-brand-gray whitespace-nowrap">{n.time}</span>
                                    <span className={`text-xs px-2 py-0.5 rounded-full ${getCategoryColor(n.category)}`}>
                                      {CATEGORIES[n.category]?.label || n.category}
                                    </span>
                                  </div>
                                </div>
                                {!n.read && (
                                  <button onClick={() => markAsRead(n.id)} className="mt-2 text-xs font-medium text-brand-blue hover:underline">
                                    Mark as read
                                  </button>
                                )}
                              </div>
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </Card>
          )}
        </>
      )}
    </>
  );
}
