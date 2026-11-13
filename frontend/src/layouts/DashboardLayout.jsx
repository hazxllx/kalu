import React, { useState, useRef, useEffect, useMemo } from "react";
import { Outlet, useLocation, useNavigate, Link, Navigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bell,
  Menu,
  X,
  LogOut,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  User,
  Settings,
  Lock,
} from "lucide-react";
import Icon from "@/components/common/Icon";
import OfflineStatusIndicator from "@/features/offline/components/OfflineStatusIndicator";
import { LOGO_URL, ROLES } from "@/lib/brand";
import {
  NAV,
  filterNavByPermission,
  navPermissionsForPath,
  navStationForPath,
  stationAllows,
  navItemIsActive,
} from "@/lib/navConfig";
import { homeForRole } from "@/lib/roles";
import { notificationsApi } from "@/services/api";
import { onUnreadChanged } from "@/services/notifications/unreadBus";
import { useAuth } from "@/context/AuthContext";
import { usePermissions } from "@/context/PermissionsContext";
import { hasValidPermissionSnapshot, permissionNotice, routePermissionsAllowed } from "@/services/accessControl/permissionAccess";
import { isNavigatorOnline } from "@/services/offline/connectivity";
import { getSupervisorScope } from "@/lib/supervisorScope";

export default function DashboardLayout({ roleKey }) {
  const role = ROLES[roleKey];
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, refreshProfile } = useAuth();
  const { can, matrixLoadState, refreshMatrix } = usePermissions();
  const isSupervisor = roleKey === "health_supervisor";
  const assignedBarangay = getSupervisorScope(user)?.assignedBarangay;

  const sidebarPreferenceKey = `kalusagap.sidebar.collapsed.v1:${user?.id || roleKey}`;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(sidebarPreferenceKey) === "true";
    } catch {
      return false;
    }
  });
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState({});
  const menuRef = useRef(null);
  const [online, setOnline] = useState(isNavigatorOnline);
  const [recheckFeedback, setRecheckFeedback] = useState(null);
  const recheckInFlight = useRef(false);
  const recheckRequestRef = useRef(0);

  useEffect(() => {
    const updateOnline = () => setOnline(isNavigatorOnline());
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);

  useEffect(() => () => { recheckRequestRef.current += 1; }, [user?.id]);

  const recheckAccess = async () => {
    if (recheckInFlight.current) return;
    recheckInFlight.current = true;
    const requestId = ++recheckRequestRef.current;
    setRecheckFeedback({ userId: user?.id, status: "loading" });
    try {
      const verified = await refreshMatrix({ forceOnline: true });
      if (requestId === recheckRequestRef.current) {
        setRecheckFeedback({ userId: user?.id, status: verified ? "success" : "failure" });
      }
    } catch {
      if (requestId === recheckRequestRef.current) {
        setRecheckFeedback({ userId: user?.id, status: "failure" });
      }
    } finally {
      recheckInFlight.current = false;
    }
  };

  useEffect(() => {
    try {
      window.localStorage.setItem(sidebarPreferenceKey, String(sidebarCollapsed));
    } catch {
      // The sidebar remains usable when browser storage is unavailable.
    }
  }, [sidebarCollapsed, sidebarPreferenceKey]);

  useEffect(() => {
    const refreshPermissions = () => {
      if (document.visibilityState === "visible") {
        void refreshMatrix();
      }
    };
    window.addEventListener("focus", refreshPermissions);
    return () => window.removeEventListener("focus", refreshPermissions);
  }, [refreshMatrix]);

  // BHW gathers community/household data only, so the resident/record lookup
  // is not exposed to that role. Every other role keeps it.

  // Entries that declare a permission disappear once an administrator removes
  // that privilege from the role; everything else behaves exactly as before.
  const items = useMemo(
    () => filterNavByPermission(NAV[roleKey] || [], can, user),
    [roleKey, can, user]
  );
  // Tab switches inside a merged item (e.g. User & Personnel Management) keep
  // the tab strip mounted instead of replaying the page transition.
  const activeItem = items.find((item) => navItemIsActive(item, location.pathname));
  const pageTransitionKey = activeItem?.tabs
    ? `tabs:${activeItem.id}`
    : location.pathname;
  const routePermissions = useMemo(
    () => navPermissionsForPath(NAV[roleKey] || [], location.pathname),
    [roleKey, location.pathname]
  );
  // RHU station required for the current path (if any). Enforced here for direct
  // URL visits; the backend is the authoritative station gate on every API call.
  const routeStation = useMemo(
    () => navStationForPath(NAV[roleKey] || [], location.pathname),
    [roleKey, location.pathname]
  );
  const effectiveRole = user?.role === "resident-limited" ? "resident" : user?.role;
  const notice = permissionNotice(matrixLoadState, user?.id, online);
  const feedback = recheckFeedback?.userId === user?.id ? recheckFeedback?.status : null;
  const permissionsReady = hasValidPermissionSnapshot(
    matrixLoadState,
    user?.id,
    effectiveRole,
  );
  const routeStationAllowed = stationAllows(user, routeStation);
  const routeAllowed =
    routeStationAllowed &&
    routePermissionsAllowed({
      permissions: routePermissions,
      state: matrixLoadState,
      userId: user?.id,
      role: effectiveRole,
      can,
    });

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

  // Identity always comes from the authenticated account, never a demo person.
  const displayName = user?.name || role.name;
  const displayEmail =
    user?.email ||
    (isSupervisor ? "Email unavailable" : `${displayName.split(" ")[0].toLowerCase()}@pili.gov.ph`);

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

    const refreshUnread = () =>
      notificationsApi
        .list()
        .then((result) => {
          if (!active) return;

          const rows = result?.rows || result || [];
          setUnreadCount(rows.filter((n) => !n.read_at).length);
        })
        .catch(() => active && setUnreadCount(0));

    refreshUnread();

    // Re-sync the badge the instant the Notifications page marks something read
    // (or marks all read), without waiting for the next navigation.
    const unsubscribe = onUnreadChanged(refreshUnread);

    return () => {
      active = false;
      unsubscribe();
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

  const NavList = ({ collapsed = false } = {}) => {
    const adminNav = roleKey === "admin";
    const compact = roleKey === "health_supervisor";
    const rowSize = collapsed
      ? "min-h-10"
      : adminNav
        ? "min-h-10 py-2"
        : "min-h-9 py-1.5";
    const itemPadding = collapsed ? "justify-center px-0" : "gap-2.5 px-3";

    const isItemActive = (item) =>
      navItemIsActive(item, location.pathname);

    const renderItem = (it, depth = 0) => {
      if (it.locked) {
        return (
          <div
            key={it.label}
            className={`group flex ${rowSize} ${itemPadding} items-center rounded-md text-sm text-slate-400 dark:text-slate-500 cursor-not-allowed select-none`}
            title={collapsed ? `${it.label} — Available after account verification` : "Available after account verification"}
            aria-label={collapsed ? `${it.label} — Available after account verification` : undefined}
          >
            <Icon
              name={it.icon}
              className="w-[18px] h-[18px] shrink-0"
              strokeWidth={1.8}
            />
            <span className={collapsed ? "sr-only" : "flex-1 truncate"}>{it.label}</span>
            {!collapsed && (
              <Lock
                className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 shrink-0"
                strokeWidth={1.8}
              />
            )}
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
              aria-label={collapsed ? it.label : undefined}
              title={collapsed ? it.label : undefined}
              onClick={() =>
                setExpandedGroups((prev) => ({
                  ...prev,
                  [it.label]: !openGroup,
                }))
              }
              className={`supervisor-nav-item group flex ${rowSize} w-full ${itemPadding} items-center rounded-md text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-hover hover:text-slate-900 dark:hover:text-foreground transition-[color,background-color,padding,gap] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue`}
            >
              <Icon
                name={it.icon}
                className="w-[18px] h-[18px] shrink-0"
                strokeWidth={1.8}
              />

              <AnimatePresence initial={false}>
                {!collapsed && (
                  <motion.span
                    initial={{ opacity: 0, x: -5 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -5 }}
                    transition={{ duration: 0.16, ease: "easeOut" }}
                    className="flex-1 text-left truncate"
                  >
                    {it.label}
                  </motion.span>
                )}
              </AnimatePresence>

              {!collapsed && (
                <ChevronDown
                  className={`w-4 h-4 shrink-0 transition-transform ${
                    openGroup ? "rotate-180" : ""
                  }`}
                />
              )}
            </button>

            <AnimatePresence initial={false}>
              {openGroup && (
                <motion.div
                  initial={isSupervisor ? false : { height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={isSupervisor ? { duration: 0 } : undefined}
                  id={groupId}
                  className={`overflow-hidden ${collapsed ? "pt-1" : "pl-3 pt-1"} ${compact ? "space-y-0.5" : "space-y-1"}`}
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
          to={`${it.path}${it.search || ""}`}
          onClick={() => setOpen(false)}
          aria-label={collapsed ? it.label : undefined}
          aria-current={active ? "page" : undefined}
          title={collapsed || !adminNav ? it.label : undefined}
          className={`app-nav-item supervisor-nav-item group flex w-full min-w-0 ${rowSize} ${itemPadding} items-center rounded-md text-sm leading-5 transition-[color,background-color,padding,gap] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue ${
            active
              ? adminNav
                ? "bg-brand-light text-brand-blue font-medium dark:bg-brand-blue/20"
                : "bg-brand-blue/10 text-brand-blue font-medium dark:bg-brand-blue/15"
              : "text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-hover hover:text-slate-900 dark:hover:text-foreground"
          }`}
        >
          <Icon
            name={it.icon}
            className="w-[18px] h-[18px] shrink-0"
            strokeWidth={1.8}
          />
          <AnimatePresence initial={false}>
            {!collapsed && (
              <motion.span
                initial={{ opacity: 0, x: -5 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -5 }}
                transition={{ duration: 0.16, ease: "easeOut" }}
                className={adminNav ? "min-w-0 flex-1 whitespace-normal break-words" : "truncate"}
              >
                {it.label}
              </motion.span>
            )}
          </AnimatePresence>
        </Link>
      );
    };

    // Keep account destinations in the fixed footer so they remain easy to
    // reach without interrupting the role-specific feature navigation.
    const visibleItems = items.filter(
      (item) => !item.hidden && item.path !== profilePath && item.path !== settingsPath,
    );
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
      <div className={adminNav ? "space-y-2" : compact ? "space-y-0.5" : "space-y-1"}>
        {blocks.map((block, i) => (
          <div
            key={block.group || `block-${i}`}
            className={adminNav && i > 0 ? "border-t border-brand-border/60 pt-2 dark:border-border" : undefined}
          >
            {block.group && !collapsed && (
              <p className={`supervisor-nav-group px-3 ${adminNav ? "pb-1 text-[10px] text-brand-gray dark:text-slate-400" : `${i === 0 ? "pt-1" : compact ? "pt-3" : "pt-5"} pb-1.5 text-[11px] text-slate-500 dark:text-slate-500`} font-semibold uppercase tracking-[0.06em] select-none`}>
                {block.group}
              </p>
            )}

            <div className={`${adminNav || compact ? "space-y-0.5" : "space-y-1"} ${collapsed && !adminNav ? "space-y-1" : ""}`}>
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

  if (!routeStationAllowed || (routePermissions && permissionsReady && !routeAllowed)) {
    return <Navigate to={homeForRole(user?.role || roleKey)} replace />;
  }

  /**
   * Sidebar identity block: logo mark plus the system name.
   * The artwork is a square symbol, so the name is spelled out beside it —
   * mirroring the AgencyMark used on the public and auth pages.
   */
  const SidebarBrand = ({ collapsed = false } = {}) => (
    <div className={`flex min-w-0 items-center ${roleKey === "admin" ? "gap-2" : "gap-3"}`}>
      <img
        src={LOGO_URL}
        alt=""
        aria-hidden="true"
        className={`${collapsed || roleKey === "admin" ? "h-8 w-8" : "h-9 w-auto"} shrink-0 object-contain`}
      />

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ opacity: 0, x: -5 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -5 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className={roleKey === "admin" ? "min-w-0 flex-1" : "min-w-0"}
          >
            <p className="font-display text-[15px] font-bold leading-tight tracking-[0.03em] text-brand-dark dark:text-foreground">
              KALUSAGAP
            </p>
            <p className={`mt-0.5 font-medium uppercase leading-tight text-brand-gray dark:text-slate-400 ${roleKey === "admin" ? "text-[10px] tracking-[0.03em]" : "truncate text-[9.5px] tracking-[0.12em]"}`}>
              {isSupervisor ? "Municipal Health Office" : "Community Health System"}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  const SidebarAccountLinks = ({ collapsed = false } = {}) => (
    <div className="space-y-1">
      {[
        { label: "Profile", path: profilePath, IconComponent: User },
        { label: "Settings", path: settingsPath, IconComponent: Settings },
      ].map(({ label, path, IconComponent }) => {
        const active = location.pathname === path || location.pathname.startsWith(`${path}/`);
        return (
          <Link
            key={label}
            to={path}
            onClick={() => {
              setOpen(false);
              setMenuOpen(false);
            }}
            aria-label={collapsed ? label : undefined}
            title={collapsed ? label : undefined}
            className={`w-full min-h-10 flex items-center rounded-md py-2 text-sm transition-[color,background-color,padding,gap] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue ${collapsed ? "justify-center px-0" : "gap-2.5 px-3"} ${active ? "bg-brand-blue/10 font-semibold text-brand-blue dark:bg-brand-blue/15 dark:text-blue-300" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-hover dark:hover:text-foreground"}`}
          >
            <IconComponent className="w-[18px] h-[18px] shrink-0" strokeWidth={1.8} />
            <AnimatePresence initial={false}>
              {!collapsed && (
                <motion.span
                  initial={{ opacity: 0, x: -5 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -5 }}
                  transition={{ duration: 0.16, ease: "easeOut" }}
                >
                  {label}
                </motion.span>
              )}
            </AnimatePresence>
          </Link>
        );
      })}
    </div>
  );

  return (
    <div className={`kalusagap-shell min-h-screen bg-[color:#f5f7fa] dark:bg-background ${isSupervisor ? "supervisor-shell" : ""}`}>
      <aside
        className={`app-sidebar hidden lg:flex fixed left-0 top-0 z-30 h-screen max-h-[100dvh] flex-col overflow-visible border-r border-slate-200 bg-white transition-[width] duration-200 ease-out dark:border-border dark:bg-sidebar ${sidebarCollapsed ? "w-20" : isSupervisor ? "w-64" : "w-72"}`}
        data-sidebar-state={sidebarCollapsed ? "collapsed" : "expanded"}
      >
        {/* Brand header — fixed */}
        <div className={`relative shrink-0 flex h-16 items-center border-b border-slate-200 dark:border-border ${roleKey === "admin" ? `${sidebarCollapsed ? "justify-center px-2" : "px-4 pr-11"}` : `${sidebarCollapsed ? "justify-center gap-0 px-2" : isSupervisor ? "justify-between gap-3 px-4" : "justify-between gap-3 px-5"}`}`}>
          <div className={sidebarCollapsed ? "flex min-w-0 justify-center" : "min-w-0 flex-1"}>
            <SidebarBrand collapsed={sidebarCollapsed} />
          </div>
          <button
            type="button"
            onClick={() => setSidebarCollapsed((value) => !value)}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`flex shrink-0 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue dark:text-slate-300 dark:hover:bg-hover dark:hover:text-foreground ${roleKey === "admin" ? "absolute right-1.5 top-1.5 h-6 w-6" : sidebarCollapsed ? "absolute right-1 top-2 h-7 w-7 bg-white/90 dark:bg-sidebar/90" : "h-8 w-8"}`}
          >
            {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        {/* Scrollable navigation */}
        <nav
          aria-label="Main navigation"
          className={`nav-scroll min-h-0 flex-1 overflow-y-auto ${roleKey === "admin" ? "py-2" : "py-3"} ${sidebarCollapsed ? "overflow-x-visible px-2" : "px-3"}`}
        >
          <NavList collapsed={sidebarCollapsed} />

          {/* Bottom padding so the final nav item is always reachable */}
          <div className="h-2" aria-hidden="true" />
        </nav>

         {/* Fixed account footer */}
         <div className="shrink-0 p-2 border-t border-slate-200 dark:border-border bg-white dark:bg-sidebar">
           <SidebarAccountLinks collapsed={sidebarCollapsed} />
           <button
            onClick={() => logout()}
            aria-label={sidebarCollapsed ? "Log out" : undefined}
            title={sidebarCollapsed ? "Log out" : undefined}
            className={`w-full min-h-9 flex items-center rounded-md py-1.5 text-sm text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-hover dark:hover:text-foreground ${sidebarCollapsed ? "justify-center px-0" : "gap-2.5 px-3"}`}
          >
            <LogOut
              className="w-[18px] h-[18px] shrink-0"
              strokeWidth={1.8}
            />
            {!sidebarCollapsed && "Log out"}
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
              className="app-sidebar fixed inset-y-0 left-0 z-50 flex w-[min(18rem,calc(100vw-2rem))] flex-col bg-white dark:bg-sidebar lg:hidden"
            >
              <div className={`shrink-0 flex h-16 items-center justify-between border-b border-slate-200 dark:border-border ${roleKey === "admin" ? "gap-2 px-4" : "gap-3 px-4"}`}>
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
                className={`nav-scroll min-h-0 flex-1 overflow-y-auto px-3 ${roleKey === "admin" ? "py-2" : "py-3"}`}
              >
                <NavList />
                <div className="h-2" aria-hidden="true" />
              </nav>

              <div className="shrink-0 p-2 border-t border-slate-200 dark:border-border bg-white dark:bg-sidebar">
                <SidebarAccountLinks />
                <button
                  onClick={() => logout()}
                  className="w-full min-h-9 flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-hover hover:text-slate-900 dark:hover:text-foreground transition-colors"
                >
                  <LogOut
                    className="w-[18px] h-[18px] shrink-0"
                    strokeWidth={1.8}
                  />
                  Log out
                </button>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className={`min-w-0 transition-[padding] duration-200 ease-out ${sidebarCollapsed ? "lg:pl-20" : isSupervisor ? "lg:pl-64" : "lg:pl-72"}`}>
        <header className="app-header sticky top-0 z-30 h-16 bg-white/95 dark:bg-sidebar/95 backdrop-blur border-b border-slate-200 dark:border-border flex items-center gap-3 px-4 md:px-6">
          <button
            onClick={() => setOpen(true)}
            type="button"
            aria-label="Open navigation menu"
            aria-expanded={open}
            className="lg:hidden text-slate-600 dark:text-slate-300"
          >
            <Menu className="w-6 h-6" />
          </button>

          <div className="ml-auto flex items-center gap-2 md:gap-4">
            <OfflineStatusIndicator />
            <Link
              to={notificationsPath}
              aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"}
              className="relative w-10 h-10 rounded-md hover:bg-slate-50 dark:hover:bg-hover flex items-center justify-center"
            >
              <Bell
                className="w-5 h-5 text-slate-600 dark:text-slate-300"
                strokeWidth={1.8}
              />

              {unreadCount > 0 && (
                <span className="absolute top-2 right-2 w-[18px] h-[18px] bg-brand-danger text-white text-xs rounded-full flex items-center justify-center font-medium">
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
                type="button"
                aria-label="Account menu"
                aria-expanded={menuOpen}
                aria-haspopup="true"
                className="flex items-center gap-2 rounded-md hover:bg-slate-50 dark:hover:bg-hover px-2 py-1.5 transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-brand-blue text-white flex items-center justify-center text-sm font-semibold font-heading">
                  {initials}
                </div>

                  <div className="hidden md:block text-left">
                  <p className="text-[13px] font-semibold text-slate-900 dark:text-foreground leading-tight">
                    {displayName}
                  </p>

                  <p className="text-[11px] text-slate-500">
                    {role.label}
                  </p>
                </div>

                <ChevronDown className="hidden md:block w-3 h-3 text-slate-500 dark:text-slate-400" />
              </button>

              <AnimatePresence>
                {menuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.97 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 top-full mt-2 w-72 bg-white dark:bg-popover rounded-md border border-slate-200 dark:border-border shadow-soft overflow-hidden z-50"
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

                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                            {role.label}
                          </p>

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

        <main className={`app-main mx-auto min-w-0 ${isSupervisor ? "max-w-shell px-4 py-5 sm:px-5 md:px-6 md:py-6 xl:px-7" : "max-w-content px-3 py-5 sm:px-4 sm:py-6 md:px-8 md:py-8"}`}>
          {notice && (!routePermissions || permissionsReady) && (
            <div
              className={`mb-4 flex flex-wrap items-center justify-between gap-3 border px-4 py-2 text-xs ${permissionsReady ? "border-amber-300 bg-amber-50 text-amber-950" : "border-brand-danger/30 bg-white text-brand-ink"}`}
              role={permissionsReady ? "status" : "alert"}
            >
              <p className="text-xs" aria-live="polite">
                {notice === "auth"
                  ? "Your session has expired. Sign in again to continue."
                  : notice === "error"
                    ? matrixLoadState.failureKind === "forbidden"
                      ? "Access was denied. Contact an administrator."
                      : "Access could not be verified. Retry when connected."
                    : notice === "cached-offline"
                      ? "Offline. Using previously verified access."
                      : "Could not confirm access with the server. Using previously verified access."}
                {feedback === "loading" && " Checking access…"}
                {feedback === "failure" && " Recheck failed; access was not confirmed."}
              </p>
              {notice === "auth" ? (
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="min-h-9 border border-brand-border px-3 text-xs font-medium hover:bg-brand-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
                >
                  Sign in again
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void recheckAccess()}
                  disabled={feedback === "loading"}
                  className="min-h-9 border border-brand-border px-3 text-xs font-medium hover:bg-brand-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue disabled:opacity-50"
                >
                  {feedback === "loading" ? "Checking…" : "Recheck access"}
                </button>
              )}
            </div>
          )}
          {!notice && feedback === "success" && matrixLoadState.status === "ready" && matrixLoadState.source === "server" && (
            <p className="mb-4 text-xs text-brand-green" role="status">Access verified with the server.</p>
          )}
          {!notice && feedback === "failure" && matrixLoadState.source !== "server" && (!routePermissions || permissionsReady) && (
            <p className="mb-4 text-xs text-brand-danger" role="alert">Recheck failed; access was not confirmed.</p>
          )}
          <motion.div
            key={pageTransitionKey}
            initial={isSupervisor ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: isSupervisor ? 0 : 0.3 }}
           >
             {routePermissions && matrixLoadState.status === "loading" ? (
               <section
                 className="mx-auto max-w-xl border border-brand-border bg-white p-6 text-center"
                 aria-live="polite"
               >
                 <h1 className="text-base font-semibold text-brand-ink">
                   Checking page access…
                 </h1>
                 <p className="mt-2 text-sm text-brand-gray">
                   This page will open after access is verified.
                 </p>
               </section>
             ) : routePermissions && permissionsReady && !routeAllowed ? (
               <section
                 className="mx-auto max-w-xl border border-brand-border bg-white p-6 text-center"
                 aria-live="polite"
               >
                 <h1 className="text-base font-semibold text-brand-ink">
                   Access was denied
                 </h1>
                 <p className="mt-2 text-sm text-brand-gray">
                   You do not have permission to access this page. Contact an administrator if you believe this is an error.
                 </p>
               </section>
             ) : (
               <Outlet />
             )}
          </motion.div>
        </main>
      </div>
    </div>
  );
}
