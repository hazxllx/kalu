import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { Bell } from "lucide-react";
import { ICONS, CATEGORIES } from "@/services/mock/notificationData";
import {
  useWorkflowStore,
  markNotificationRead,
  markRoleNotificationsRead,
  clearRoleNotifications,
} from "@/services/mock/mockWorkflowStore";
import { filterRowsByScope } from "@/lib/phnScope";
import { useAuth } from "@/context/AuthContext";

export default function NotificationsPage({ crumbs = ["Home", "Notifications"], roleKey = "resident" }) {
  const { user } = useAuth();
  const store = useWorkflowStore();
  const [filter, setFilter] = useState("all");

  // Notifications live in the shared workflow store so triage → PHN hand-offs
  // and "mark as read" actions stay consistent with the bell count and survive
  // page navigation. PHN scope rules are applied before anything renders.
  const roleNotifications = useMemo(
    () => filterRowsByScope(store.notifications[roleKey] || [], user),
    [store.notifications, roleKey, user]
  );

  const filteredNotifications = roleNotifications.filter((n) => {
    if (filter === "all") return true;
    if (filter === "unread") return !n.read;
    return n.category === filter;
  });

  const markAsRead = (id) => {
    markNotificationRead(roleKey, id);
  };

  const markAllAsRead = () => {
    markRoleNotificationsRead(roleKey);
  };

  const clearAll = () => {
    clearRoleNotifications(roleKey);
  };

  const getCategoryColor = (category) => {
    return CATEGORIES[category]?.color || "bg-brand-gray/10 text-brand-gray";
  };

  const getCategoryIcon = (category) => {
    const iconName = CATEGORIES[category]?.icon || "Bell";
    return ICONS[iconName] || Bell;
  };

  const groupNotifications = (notifs) => {
    const groups = { today: [], yesterday: [], earlier: [] };
    notifs.forEach((n) => {
      const t = String(n.time || "").toLowerCase();
      if (t.includes("now") || t.includes("hour") || t.includes("minute")) {
        groups.today.push(n);
      } else if ((t.includes("day") && !t.includes("days")) || t.includes("yesterday")) {
        groups.yesterday.push(n);
      } else {
        groups.earlier.push(n);
      }
    });
    return groups;
  };

  const grouped = groupNotifications(filteredNotifications);

  if (roleNotifications.length === 0) {
    return (
      <>
        <PageHeader crumbs={crumbs} title="Notifications" subtitle="Stay updated on reminders, alerts, and advisories." />
        <Card className="p-12 text-center">
          <div className="w-16 h-16 rounded-full bg-brand-bg flex items-center justify-center mx-auto mb-4">
            <Bell className="w-8 h-8 text-brand-gray" strokeWidth={1.8} />
          </div>
          <h3 className="font-semibold text-brand-ink mb-2">No Notifications</h3>
          <p className="text-sm text-brand-gray">You're all caught up! Check back later for updates.</p>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        crumbs={crumbs}
        title="Notifications"
        subtitle="Stay updated on reminders, alerts, and advisories."
      />

      {/* Compact Toolbar */}
      <Card className="p-3 mb-4">
        <div className="flex items-center justify-end gap-3">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="bg-white border border-brand-border rounded-btn px-3 py-2 text-sm outline-none"
          >
            <option value="all">All</option>
            <option value="unread">Unread</option>
            <option value="information">Information</option>
            <option value="reminder">Reminder</option>
            <option value="alert">Alert</option>
            <option value="success">Success</option>
            <option value="warning">Warning</option>
          </select>
          <button
            onClick={markAllAsRead}
            className="text-sm font-medium text-brand-blue hover:underline"
          >
            Mark all as read
          </button>
          <button
            onClick={clearAll}
            className="text-sm font-medium text-brand-danger hover:underline"
          >
            Clear all
          </button>
        </div>
      </Card>

      {/* Notifications List */}
      {filteredNotifications.length === 0 ? (
        <Card className="p-12 text-center">
          <div className="w-16 h-16 rounded-full bg-brand-bg flex items-center justify-center mx-auto mb-4">
            <Bell className="w-8 h-8 text-brand-gray" strokeWidth={1.8} />
          </div>
          <h3 className="font-semibold text-brand-ink mb-2">No Notifications Found</h3>
          <p className="text-sm text-brand-gray">Try adjusting your filter or search to see more notifications.</p>
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
                      <motion.div
                        key={n.id}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.03 }}
                      >
                        <div
                          className={`flex items-start gap-3 p-3 rounded-btn transition-all hover:shadow-sm hover:bg-brand-light ${
                            !n.read ? "bg-brand-blue/5" : ""
                          }`}
                        >
                          <div
                            className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${getCategoryColor(
                              n.category
                            )}`}
                          >
                            <CategoryIcon className="w-4 h-4" strokeWidth={1.8} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className={`text-sm font-medium text-brand-ink ${!n.read ? "font-semibold" : ""}`}>
                                    {n.title}
                                  </p>
                                  {!n.read && <span className="w-2 h-2 rounded-full bg-brand-blue shrink-0" />}
                                </div>
                                <p className="text-xs text-brand-gray mt-0.5 line-clamp-2">{n.desc}</p>
                              </div>
                              <div className="flex flex-col items-end gap-1 shrink-0">
                                <span className="text-xs text-brand-gray whitespace-nowrap">{n.time}</span>
                                <span
                                  className={`text-xs px-2 py-0.5 rounded-full ${getCategoryColor(
                                    n.category
                                  )}`}
                                >
                                  {CATEGORIES[n.category]?.label || n.category}
                                </span>
                              </div>
                            </div>
                            {!n.read && (
                              <button
                                onClick={() => markAsRead(n.id)}
                                className="mt-2 text-xs font-medium text-brand-blue hover:underline"
                              >
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
  );
}
