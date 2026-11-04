import React, { useMemo } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import Icon from "@/components/common/Icon";
import { NAV, filterNavByPermission, navItemIsActive } from "@/lib/navConfig";
import { useAuth } from "@/context/AuthContext";
import { usePermissions } from "@/context/PermissionsContext";

/**
 * Shared shell for a merged sidebar item (a nav item that declares `tabs`).
 *
 * It renders a labeled tab strip above the existing page for the active tab.
 * Each tab is a real link to that page's original route, so deep links,
 * bookmarks and the browser back button keep working, and the existing page
 * components are rendered untouched through <Outlet />.
 *
 * Only tabs the signed-in role is permitted to see are shown; route access
 * itself is still enforced by DashboardLayout using the same tab permissions.
 */
export default function NavTabsLayout({ roleKey, navId }) {
  const location = useLocation();
  const { user } = useAuth();
  const { can } = usePermissions();

  const item = useMemo(
    () =>
      filterNavByPermission(NAV[roleKey] || [], can, user).find(
        (entry) => entry.id === navId,
      ),
    [roleKey, navId, can, user],
  );

  if (!item) return <Outlet />;
  const compact = navId === "user-personnel";

  return (
    <>
      <div className="mb-4">
        {!compact && <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-brand-gray dark:text-slate-400">
          {item.label}
        </p>}
        <nav
          aria-label={`${item.label} sections`}
          className="nav-scroll -mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0"
        >
          <ul className="flex min-w-max gap-1 border-b border-slate-200 dark:border-border">
            {item.tabs.map((tab) => {
              const active = navItemIsActive(tab, location.pathname);
              return (
                <li key={tab.path}>
                  <Link
                    to={tab.path}
                    aria-current={active ? "page" : undefined}
                    className={`-mb-px inline-flex items-center whitespace-nowrap border-b-2 px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue ${compact ? "min-h-9" : "min-h-10 gap-2"} ${
                      active
                        ? "border-brand-blue font-medium text-brand-blue"
                        : "border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:text-slate-300 dark:hover:text-foreground"
                    }`}
                  >
                    {!compact && <Icon
                      name={tab.icon}
                      className="h-4 w-4 shrink-0"
                      strokeWidth={1.8}
                      aria-hidden="true"
                    />}
                    {tab.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
      <Outlet />
    </>
  );
}
