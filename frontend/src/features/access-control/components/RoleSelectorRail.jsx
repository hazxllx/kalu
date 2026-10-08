import React from "react";
import { Lock } from "lucide-react";

import { ALL_PERMISSION_IDS, ROLE_POLICY, countGranted } from "@/lib/permissions";

export default function RoleSelectorRail({ roles, selectedRoleId, dirtyRoleId, permissionsForRole, onSelect }) {
  const total = ALL_PERMISSION_IDS.length;
  const selectedRole = roles.find((role) => role.id === selectedRoleId);

  return (
    <>
      <label className="sr-only" htmlFor="role-selector">
        Select a role
      </label>
      <select
        id="role-selector"
        value={selectedRoleId}
        onChange={(event) => onSelect(event.target.value)}
        className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-brand-dark focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/20 lg:hidden"
      >
        {roles.map((role) => {
          const granted = countGranted(permissionsForRole(role.id));
          return (
            <option key={role.id} value={role.id}>
              {role.label} — {granted}/{total}
            </option>
          );
        })}
      </select>

      <div className="hidden lg:block">
        <div className="mb-2 grid grid-cols-[minmax(0,1fr)_auto] px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          <span>Role</span>
          <span>Granted</span>
        </div>
        <div className="divide-y divide-slate-200 border-y border-slate-200 bg-white">
          {roles.map((role) => {
            const granted = countGranted(permissionsForRole(role.id));
            const selected = role.id === selectedRoleId;
            const restricted = Boolean(ROLE_POLICY[role.id]);

            return (
              <button
                key={role.id}
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect(role.id)}
                className={`relative flex min-h-[52px] w-full items-center justify-between gap-3 px-3 py-1.5 text-left transition-colors ${
                  selected
                    ? "bg-[#EEF2F6] text-brand-dark"
                    : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                {selected && <span className="absolute inset-y-0 left-0 w-0.5 bg-brand-gold" aria-hidden="true" />}
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-semibold">{role.label}</span>
                    {restricted && (
                      <Lock
                        className="h-3 w-3 shrink-0 text-brand-gold"
                        strokeWidth={2.2}
                        aria-label="This role has fixed guard-rails"
                      />
                    )}
                    {dirtyRoleId === role.id && (
                      <span className="shrink-0 rounded bg-brand-goldpale px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-brand-amber">
                        Unsaved
                      </span>
                    )}
                  </span>
                  {selected && selectedRole?.description && (
                    <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                      {selectedRole.description}
                    </span>
                  )}
                </span>
                <span className="num shrink-0 text-xs font-semibold text-slate-500">
                  {granted}/{total}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
