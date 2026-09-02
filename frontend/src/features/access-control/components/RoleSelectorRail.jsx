import React from "react";
import { Lock } from "lucide-react";

import Icon from "@/components/common/Icon";
import { ALL_PERMISSION_IDS, ROLE_POLICY, countGranted } from "@/lib/permissions";

/**
 * Role picker for the Role & Permissions control centre.
 *
 * Vertical rail on desktop, horizontally scrollable row on small screens.
 * Each card reports how much of the catalogue the role currently holds so an
 * administrator can see least-privilege at a glance.
 */
export default function RoleSelectorRail({ roles, selectedRoleId, dirtyRoleId, permissionsForRole, onSelect }) {
  const total = ALL_PERMISSION_IDS.length;

  return (
    <div
      className="flex gap-3 overflow-x-auto pb-2 no-scrollbar lg:flex-col lg:overflow-visible lg:pb-0"
      role="tablist"
      aria-label="System roles"
    >
      {roles.map((role) => {
        const granted = countGranted(permissionsForRole(role.id));
        const pct = total === 0 ? 0 : Math.round((granted / total) * 100);
        const selected = role.id === selectedRoleId;
        const restricted = Boolean(ROLE_POLICY[role.id]);

        return (
          <button
            key={role.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(role.id)}
            className={`relative w-[248px] shrink-0 overflow-hidden rounded-2xl border p-4 text-left transition-colors lg:w-full ${
              selected
                ? "border-brand-blue bg-brand-light/70 shadow-card"
                : "border-slate-200 bg-white hover:border-brand-rule hover:bg-slate-50"
            }`}
          >
            {selected && <span className="absolute inset-y-0 left-0 w-[3px] bg-brand-gold" aria-hidden="true" />}

            <div className="flex items-start gap-3">
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                  selected ? "bg-brand-blue text-white" : "bg-slate-100 text-brand-gray"
                }`}
              >
                <Icon name={role.icon} className="h-[18px] w-[18px]" strokeWidth={1.8} />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className={`truncate text-sm font-semibold ${selected ? "text-brand-dark" : "text-slate-900"}`}>
                    {role.label}
                  </p>
                  {restricted && (
                    <Lock
                      className="h-3 w-3 shrink-0 text-brand-gold"
                      strokeWidth={2.2}
                      aria-label="This role has fixed guard-rails"
                    />
                  )}
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500">{role.description}</p>
              </div>
            </div>

            <div className="mt-3.5 flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full ${selected ? "bg-brand-blue" : "bg-brand-rule"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="num shrink-0 text-[11px] font-semibold text-slate-500">
                {granted}/{total}
              </span>
            </div>

            {dirtyRoleId === role.id && (
              <span className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-brand-goldpale px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-amber">
                <span className="h-1.5 w-1.5 rounded-full bg-brand-gold" />
                Unsaved
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
