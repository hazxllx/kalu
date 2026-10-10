import React, { useState, useRef, useEffect, useMemo } from "react";
import { Outlet, useLocation, Link, Navigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Bell,
  Menu,
  X,
  LogOut,
  ChevronDown,
  User,
  Settings,
  ShieldCheck,
  ShieldAlert,
  Lock,
} from "lucide-react";
import Icon from "@/components/common/Icon";
import VerificationBadge from "@/features/verification/components/VerificationBadge";
import OfflineStatusIndicator from "@/features/offline/components/OfflineStatusIndicator";
import { LOGO_URL, ROLES } from "@/lib/brand";
import {
  NAV,
  filterNavByPermission,
  navPermissionsForPath,
  navItemIsActive,
} from "@/lib/navConfig";
import { homeForRole } from "@/lib/roles";
import { notificationsApi } from "@/services/api";
import { useAuth } from "@/context/AuthContext";
import { usePermissions } from "@/context/PermissionsContext";

export default function DashboardLayout({ roleKey }) {
  const role = ROLES[roleKey];
  const location = useLocation();
  const { user, logout, refreshProfile } = useAuth();
  const { can, matrixLoadState, refreshMatrix } = usePermissions();

  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState({});
  const menuRef = useRef(null);

  useEffect(() => {
    const refreshPermissions = () => {
      if (document.visibilityState === "visible") {
        void refreshMatrix();
      }
    };
    window.addEventListener("focus", refreshPermissions);
    return () => window.removeEventListener("focus", refreshPermissions);
  }, [refreshMatrix]);

  const isResident =
    roleKey === "resident" || roleKey === "resident-limited";
  const verified = roleKey === "resident";

  // BHW gathers community/household data only, so the resident/record lookup
  // is not exposed to that role. Every other role keeps it.
  const showResidentSearch = roleKey !== "bhw";

  // Entries that declare a permission disappear once an administrator removes
  // that privilege from the role; everything else behaves exactly as before.
  const items = useMemo(
    () => filterNavByPermission(NAV[roleKey] || [], can),
    [roleKey, can]
  );
  const routePermissions = useMemo(
    () => navPermissionsForPath(NAV[roleKey] || [], location.pathname),
    [roleKey, location.pathname]
  );
  const permissionsReady =
    matrixLoadState.userId === user?.id && matrixLoadState.status === "ready";
  const routeAllowed =
    !routePermissions || (permissionsReady && routePermissions.some((permission) => can(permission)));

  // Keep an expandable submenu (e.g. Records) open while the user is on one
  // of its child pages — including on a direct URL visit — so the active child
  // stays visible and highlighted. Manual toggling still works: this only ever
  // opens the group that owns the current route, it never forces others closed.
  useEffect(() => {
    setExpandedGroups((prev) => {
      let changed = false;
      const next = { ...prev };

      const expandActiveGroups = (entries) => {
        entries.forEach((item) => {
          if (!item.children) return;

          const ownsRoute = item.children.some((child) => {
            const childOwnsRoute = (entry) =>
              navItemIsActive(entry, location.pathname) ||
              entry.children?.some(childOwnsRoute);

            return childOwnsRoute(child);
          });

          if (ownsRoute && !next[item.label]) {
            next[item.label] = true;
            changed = true;
          }

          expandActiveGroups(item.children);
        });
      };

      expandActiveGroups(items);

      return changed ? next : prev;
    });
  }, [location.pathname, items]);

  // The profile reflects the signed-in demo user (name/role per account),
  // falling back to the role's placeholder only when no user is available.
  const displayName = user?.name || role.name;
  const displayEmail =
    user?.email ||
    `${displayName.split(" ")[0].toLowerCase()}@pili.gov.ph`;

  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  // The bell reflects the signed-in user's own persisted notifications
  // (`/operational/notifications`), refreshed on navigation so the unread
  // count stays in step with the Notifications page and survives
  // refresh/re-login.
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let active = true;

    notificationsApi
      .list()
      .then((result) => {
        if (!active) return;

        const rows = result?.rows || result || [];
        setUnreadCount(rows.filter((n) => !n.read_at).length);
      })
      .catch(() => active && setUnreadCount(0));

    return () => {
      active = false;
    };
  }, [location.pathname]);

  const notificationsPath =
    roleKey === "resident-limited"
      ? "/app/resident-limited/announcements"
      : `/app/${roleKey}/notifications`;

  // A pending resident sitting in the limited area re-checks their
  // authoritative profile whenever they open or navigate within it.
  // The moment the Health Supervisor's approval sets profiles.status =
  // 'active', effectiveRole becomes 'resident' and the redirect below
  // moves them into the full resident area.
  useEffect(() => {
    if (roleKey === "resident-limited") {
      refreshProfile?.();
    }
  }, [roleKey, location.pathname, refreshProfile]);

  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handler);

    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    setOpen(false);
    setMenuOpen(false);
  }, [location.pathname]);

  const settingsPath = `/${
    roleKey === "rhu" ? "app/rhu" : `app/${roleKey}`
  }/settings`;

  // Build the profile path from the ROLE (like settingsPath), not from the
  // current location — otherwise the active subpage (e.g. /dashboard) is kept
  // and the link resolves to a non-existent /app/<role>/<subpage>/profile.
  const profilePath = `/${
    roleKey === "rhu" ? "app/rhu" : `app/${roleKey}`
  }/profile`;

  const NavList = () => {
    const compact = roleKey === "health_supervisor";
    const rowSize = compact
      ? "min-h-[40px] py-1.5"
      : "min-h-[42px] py-2";

    const isItemActive = (item) =>
      navItemIsActive(item, location.pathname);

    const renderItem = (it, depth = 0) => {
      if (it.locked) {
        return (
          <div
            key={it.label}
            className={`flex ${rowSize} items-center gap-2.5 px-3 rounded-xl text-sm text-slate-400 dark:text-slate-500 cursor-not-allowed select-none`}
            title="Available after account verification"
          >
            <Icon
              name={it.icon}
              className="w-5 h-5 shrink-0"
              strokeWidth={1.8}
            />
            <span className="flex-1 truncate">{it.label}</span>
            <Lock
              className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 shrink-0"
              strokeWidth={1.8}
            />
          </div>
        );
      }

      if (it.children) {
        const openGroup = expandedGroups[it.label];
        const groupId = `nav-group-${it.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

        return (
          <div key={it.label}>
            <button
              type="button"
              aria-expanded={Boolean(openGroup)}
              aria-controls={groupId}
              onClick={() =>
                setExpandedGroups((prev) => ({
                  ...prev,
                  [it.label]: !openGroup,
                }))
              }
              className={`flex ${rowSize} w-full items-center gap-2.5 px-3 rounded-xl text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-hover hover:text-slate-900 dark:hover:text-foreground transition-colors`}
            >
              <Icon
                name={it.icon}
                className="w-5 h-5 shrink-0"
                strokeWidth={1.8}
              />

              <span className="flex-1 text-left truncate">{it.label}</span>

              <ChevronDown
                className={`w-4 h-4 shrink-0 transition-transform ${
                  openGroup ? "rotate-180" : ""
                }`}
              />
            </button>

            <AnimatePresence initial={false}>
              {openGroup && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  id={groupId}
                  className={`overflow-hidden pl-3 pt-1 ${compact ? "space-y-0.5" : "space-y-1"}`}
                >
                  {it.children.filter((child) => !child.hidden).map((child) =>
                    renderItem(child, depth + 1)
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      }

      const active = isItemActive(it);

      return (
        <Link
          key={it.path}
          to={it.path}
          onClick={() => setOpen(false)}
          className={`flex ${rowSize} items-center gap-2.5 px-3 rounded-xl text-sm transition-colors ${
            active
              ? "bg-brand-blue/10 text-brand-blue font-medium dark:bg-brand-blue/15"
              : "text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-hover hover:text-slate-900 dark:hover:text-foreground"
          }`}
        >
          <Icon
            name={it.icon}
            className="w-5 h-5 shrink-0"
            strokeWidth={1.8}
          />
          <span className="truncate">{it.label}</span>
        </Link>
      );
    };

    const visibleItems = items.filter((item) => !item.hidden);
    const blocks = visibleItems.reduce((acc, it) => {
      const last = acc[acc.length - 1];

      if (it.group && last && last.group === it.group) {
        last.items.push(it);
      } else {
        acc.push({
          group: it.group || null,
          items: [it],
        });
      }
      return acc;
    }, []);

    return (
      <div className={compact ? "space-y-0.5" : "space-y-1"}>
        {blocks.map((block, i) => (
          <div
            key={block.group || `block-${i}`}
            className={block.group && i > 0 ? (compact ? "mt-2" : "mt-3") : ""}
          >
            {block.group && (
              <p className={`px-3 ${compact ? "pb-0.5" : "pb-1"} text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-500 select-none`}>
                {block.group}
              </p>
            )}

            <div className={compact ? "space-y-0.5" : "space-y-1"}>
              {block.items.filter((item) => !item.hidden).map((item) => renderItem(item))}
            </div>
          </div>
        ))}
      </div>
    );
  };

  // A verified resident (profiles.status = 'active' -> role 'resident')
  // must never render the limited/locked layout.
  //
  // If an approved account is still on the resident-limited area — such as
  // a session that predates approval, a stale link, or a post-login `from`
  // location that pointed here — send them to the full resident dashboard.
  //
  // The reverse, a limited account reaching /app/resident, is already blocked
  // by ProtectedRoute.
  if (roleKey === "resident-limited" && user?.role === "resident") {
    return <Navigate to="/app/resident/dashboard" replace />;
  }

  if (routePermissions && !permissionsReady) {
    const loadFailed = matrixLoadState.userId === user?.id && matrixLoadState.status === "error";
    return (
      <main className="flex min-h-screen items-center justify-center bg-brand-surface px-4">
        <div className="max-w-md border border-brand-border bg-white p-5 text-center">
          <p className="text-sm font-medium text-brand-ink">
            {loadFailed ? "Role permissions could not be verified." : "Loading role permissions…"}
          </p>
          <p className="mt-1 text-xs text-brand-gray">
            {loadFailed
              ? matrixLoadState.error || "Permission-gated features remain unavailable until permissions can be verified."
              : "This page will open when access has been checked."}
          </p>
          {loadFailed && (
            <button
              type="button"
              onClick={() => void refreshMatrix()}
              className="mt-4 min-h-9 border border-brand-border px-3 text-xs font-medium hover:bg-brand-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
            >
              Retry
            </button>
          )}
        </div>
      </main>
    );
  }

  if (!routeAllowed) {
    return <Navigate to={homeForRole(user?.role || roleKey)} replace />;
  }

  /**
   * Sidebar identity block: logo mark plus the system name.
   * The artwork is a square symbol, so the name is spelled out beside it —
   * mirroring the AgencyMark used on the public and auth pages.
   */
  const SidebarBrand = () => (
    <div className="flex min-w-0 items-center gap-3">
      <img
        src={LOGO_URL}
        alt=""
        aria-hidden="true"
        className="h-9 w-auto shrink-0 object-contain"
      />

      <div className="min-w-0">
        <p className="font-display text-[15px] font-bold leading-tight tracking-[0.03em] text-brand-dark dark:text-foreground">
          KALUSAGAP
        </p>

        <p className="mt-0.5 truncate text-[9.5px] font-medium uppercase leading-tight tracking-[0.12em] text-brand-gray dark:text-slate-400">
          Community Health System
        </p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[color:#f5f7fa] dark:bg-background">
      <aside className="hidden lg:flex fixed left-0 top-0 h-screen max-h-[100dvh] w-72 flex-col bg-white dark:bg-sidebar border-r border-slate-200 dark:border-border">
        {/* Brand header — fixed */}
        <div className="h-20 shrink-0 flex items-center px-5 border-b border-slate-200 dark:border-border">
          <SidebarBrand />
        </div>

        {/* Scrollable navigation */}
        <nav
          aria-label="Main navigation"
          className="nav-scroll min-h-0 flex-1 overflow-y-auto px-3 py-3"
        >
          <NavList />

          {/* Bottom padding so the final nav item is always reachable */}
          <div className="h-2" aria-hidden="true" />
        </nav>

        {/* Fixed account footer */}
        <div className="shrink-0 p-2 border-t border-slate-200 dark:border-border bg-white dark:bg-sidebar">
          <button
            onClick={() => logout()}
            className="w-full min-h-[42px] flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-hover hover:text-slate-900 dark:hover:text-foreground transition-colors"
          >
            <LogOut
              className="w-5 h-5 shrink-0"
              strokeWidth={1.8}
            />
            Log out
          </button>
        </div>
      </aside>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 bg-slate-900/40 z-40 lg:hidden"
            />

            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: "spring", damping: 26, stiffness: 240 }}
              aria-label="Mobile navigation"
              className="fixed inset-y-0 left-0 z-50 flex w-[min(18rem,calc(100vw-2rem))] flex-col bg-white dark:bg-sidebar lg:hidden"
            >
              <div className="h-20 shrink-0 flex items-center justify-between gap-3 px-5 border-b border-slate-200 dark:border-border">
                <SidebarBrand />

                <button
                  onClick={() => setOpen(false)}
                  aria-label="Close menu"
                  className="shrink-0"
                >
                  <X className="w-5 h-5 text-slate-600 dark:text-slate-400" />
                </button>
              </div>

              <nav
                aria-label="Main navigation"
                className="nav-scroll min-h-0 flex-1 overflow-y-auto px-3 py-3"
              >
                <NavList />
                <div className="h-2" aria-hidden="true" />
              </nav>

              <div className="shrink-0 p-2 border-t border-slate-200 dark:border-border bg-white dark:bg-sidebar">
                <button
                  onClick={() => logout()}
                  className="w-full min-h-[42px] flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-hover hover:text-slate-900 dark:hover:text-foreground transition-colors"
                >
                  <LogOut
                    className="w-5 h-5 shrink-0"
                    strokeWidth={1.8}
                  />
                  Log out
                </button>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="lg:pl-72">
        <header className="sticky top-0 z-30 h-16 bg-white/95 dark:bg-sidebar/95 backdrop-blur border-b border-slate-200 dark:border-border flex items-center gap-3 px-4 md:px-6">
          <button
            onClick={() => setOpen(true)}
            type="button"
            aria-label="Open navigation menu"
            aria-expanded={open}
            className="lg:hidden text-slate-600 dark:text-slate-300"
          >
            <Menu className="w-6 h-6" />
          </button>

          {showResidentSearch && (
            <div className="hidden md:flex items-center gap-2 bg-slate-50 dark:bg-input border border-slate-200 dark:border-border rounded-xl px-3 py-2 w-72">
              <Search className="w-4 h-4 text-slate-500 dark:text-slate-400" />

              <input
                placeholder="Search residents, records..."
                className="bg-transparent text-sm outline-none w-full placeholder:text-slate-400 dark:placeholder:text-slate-500"
              />
            </div>
          )}

          <div className="ml-auto flex items-center gap-2 md:gap-4">
            <OfflineStatusIndicator />
            <Link
              to={notificationsPath}
              className="relative w-10 h-10 rounded-xl hover:bg-slate-50 dark:hover:bg-hover flex items-center justify-center"
            >
              <Bell
                className="w-5 h-5 text-slate-600 dark:text-slate-300"
                strokeWidth={1.8}
              />

              {unreadCount > 0 && (
                <span className="absolute top-2 right-2 w-5 h-5 bg-brand-danger text-white text-xs rounded-full flex items-center justify-center font-medium">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </Link>

            <div
              ref={menuRef}
              className="relative flex items-center gap-2 pl-2 md:pl-3 md:border-l border-slate-200 dark:border-border"
            >
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="flex items-center gap-2 rounded-xl hover:bg-slate-50 dark:hover:bg-hover px-2 py-1.5 transition-colors"
              >
                <div className="w-9 h-9 rounded-full bg-brand-blue text-white flex items-center justify-center text-sm font-semibold font-heading">
                  {initials}
                </div>

                <div className="hidden md:block text-left">
                  <p className="text-sm font-medium text-slate-900 dark:text-foreground leading-tight">
                    {displayName}
                  </p>

                  <div className="flex items-center gap-1.5">
                    {isResident &&
                      (verified ? (
                        <ShieldCheck
                          className="w-3.5 h-3.5 text-brand-green"
                          strokeWidth={2}
                        />
                      ) : (
                        <ShieldAlert
                          className="w-3.5 h-3.5 text-brand-yellow"
                          strokeWidth={2}
                        />
                      ))}

                    <p className="text-xs text-slate-500">
                      {role.label}
                    </p>
                  </div>
                </div>

                <ChevronDown className="hidden md:block w-4 h-4 text-slate-500 dark:text-slate-400" />
              </button>

              <AnimatePresence>
                {menuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.97 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 top-full mt-2 w-72 bg-white dark:bg-popover rounded-xl border border-slate-200 dark:border-border shadow-soft overflow-hidden z-50"
                  >
                    <div className="px-4 py-4 border-b border-slate-200 dark:border-border bg-slate-50 dark:bg-card-nested">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-full bg-brand-blue text-white flex items-center justify-center text-sm font-heading font-semibold">
                          {initials}
                        </div>

                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-heading font-semibold text-slate-900 dark:text-foreground truncate">
                            {displayName}
                          </p>

                          <div className="flex items-center gap-1.5 mt-0.5">
                            {isResident &&
                              (verified ? (
                                <ShieldCheck
                                  className="w-4 h-4 text-brand-green shrink-0"
                                  strokeWidth={2}
                                />
                              ) : (
                                <ShieldAlert
                                  className="w-4 h-4 text-brand-yellow shrink-0"
                                  strokeWidth={2}
                                />
                              ))}

                            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                              {role.label}
                            </p>
                          </div>

                          {isResident && (
                            <div className="mt-1">
                              <VerificationBadge
                                status={verified ? "verified" : "pending"}
                                size="sm"
                              />
                            </div>
                          )}

                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 truncate">
                            {displayEmail}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="py-1.5">
                      {[
                        {
                          icon: User,
                          label: "Profile",
                          to: profilePath,
                        },
                        {
                          icon: Settings,
                          label: "Settings",
                          to: settingsPath,
                        },
                        // BUG-021: the "Help Center" item pointed at "#"
                        // (dead link). There is no Help Center destination,
                        // so it is removed rather than left as a misleading
                        // no-op link.
                      ].map((item) => (
                        <Link
                          key={item.label}
                          to={item.to}
                          onClick={() => setMenuOpen(false)}
                          className="flex items-center gap-3 px-4 py-2.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-hover hover:text-slate-900 dark:hover:text-foreground transition-colors"
                        >
                          <item.icon
                            className="w-4 h-4"
                            strokeWidth={1.8}
                          />
                          {item.label}
                        </Link>
                      ))}
                    </div>

                    <div className="py-1.5 border-t border-slate-200 dark:border-border">
                      <button
                        onClick={() => logout()}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-brand-danger hover:bg-brand-danger/5 transition-colors"
                      >
                        <LogOut
                          className="w-4 h-4"
                          strokeWidth={1.8}
                        />
                        Logout
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </header>

        <main className="mx-auto min-w-0 max-w-content px-3 py-5 sm:px-4 sm:py-6 md:px-8 md:py-8">
          {matrixLoadState.userId === user?.id && matrixLoadState.status === "error" && (
            <div
              className="mb-4 flex flex-wrap items-center justify-between gap-3 border border-brand-danger/30 bg-white px-4 py-3 text-sm text-brand-ink"
              role="alert"
            >
              <div>
                <p className="font-medium">Role permissions could not be loaded.</p>
                <p className="text-xs text-brand-gray">
                  {matrixLoadState.error || "Permission-gated features remain unavailable until permissions can be verified."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void refreshMatrix()}
                className="min-h-9 border border-brand-border px-3 text-xs font-medium hover:bg-brand-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
              >
                Retry
              </button>
            </div>
          )}
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <Outlet />
          </motion.div>
        </main>
      </div>
    </div>
  );
}