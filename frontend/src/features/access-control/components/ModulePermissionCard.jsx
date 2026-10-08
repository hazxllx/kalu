import React from "react";
import { CheckCheck, Lock, ShieldAlert, XSquare } from "lucide-react";

import {
  ACTION_LABEL,
  getModule,
  isPermissionLocked,
  isPermissionLockedOn,
  permissionLockReason,
} from "@/lib/permissions";

export default function ModulePermissionCard({ module, role, permissions, onToggle, onBulk }) {
  const fullModule = getModule(module.id) || module;
  const filtered = module.permissions.length !== fullModule.permissions.length;

  const operable = fullModule.permissions.filter((perm) => !isPermissionLocked(role.id, perm.id));
  const canEnableAll = operable.some((perm) => !permissions[perm.id]);
  const canDisableAll = operable.some((perm) => permissions[perm.id]);

  return (
    <div className="border-t border-slate-200 bg-slate-50/50">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 sm:px-5">
        <div className="min-w-0">
          <p className="text-xs leading-relaxed text-slate-500">{module.description}</p>
          {filtered && (
            <p className="mt-0.5 text-[11px] font-medium text-brand-amber">
              Showing {module.permissions.length} of {fullModule.permissions.length} permissions; bulk actions apply
              to the whole module.
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            disabled={!canEnableAll}
            onClick={() => onBulk(module, true)}
            className="inline-flex h-8 items-center gap-1 rounded border border-slate-300 bg-white px-2.5 text-[11px] font-semibold text-slate-700 transition-colors hover:border-brand-blue hover:text-brand-blue disabled:cursor-not-allowed disabled:opacity-40"
          >
            <CheckCheck className="h-3.5 w-3.5" strokeWidth={2} />
            Enable all
          </button>
          <button
            type="button"
            disabled={!canDisableAll}
            onClick={() => onBulk(module, false)}
            className="inline-flex h-8 items-center gap-1 rounded border border-slate-300 bg-white px-2.5 text-[11px] font-semibold text-slate-700 transition-colors hover:border-brand-danger hover:text-brand-danger disabled:cursor-not-allowed disabled:opacity-40"
          >
            <XSquare className="h-3.5 w-3.5" strokeWidth={2} />
            Disable all
          </button>
        </div>
      </div>

      <ul className="divide-y divide-slate-200 border-t border-slate-200 bg-white">
        {module.permissions.map((perm) => {
          const granted = Boolean(permissions[perm.id]);
          const locked = isPermissionLocked(role.id, perm.id);
          const lockedOn = isPermissionLockedOn(role.id, perm.id);
          const reason = locked ? permissionLockReason(role.id, perm.id) : "";
          const switchId = `perm-${perm.id}`;

          return (
            <li
              key={perm.id}
              className={`flex min-h-[48px] items-center gap-3 px-4 py-2 sm:px-5 ${
                locked ? "bg-slate-50/60" : "hover:bg-slate-50/60"
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <label
                    htmlFor={locked ? undefined : switchId}
                    className={`text-[13px] font-medium leading-5 ${
                      locked ? "text-slate-500" : "cursor-pointer text-slate-900"
                    }`}
                  >
                    {perm.label}
                  </label>
                  <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                    {ACTION_LABEL[perm.action]}
                  </span>
                  {perm.sensitive && (
                    <span className="inline-flex items-center gap-1 rounded bg-brand-goldpale px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-brand-amber">
                      <ShieldAlert className="h-3 w-3" strokeWidth={2.2} />
                      Sensitive
                    </span>
                  )}
                </div>
                <p className="text-[11px] leading-4 text-slate-500">{perm.description}</p>
                {reason && (
                  <p className="mt-0.5 flex items-start gap-1 text-[10px] leading-4 text-brand-amber">
                    <Lock className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={2.2} />
                    {reason}
                  </p>
                )}
              </div>

              <div className="flex w-[72px] shrink-0 items-center justify-end">
                {locked ? (
                  <span
                    title={reason}
                    aria-label={`${perm.label} is locked ${lockedOn ? "on" : "off"}`}
                    className={`inline-flex h-5 w-9 items-center justify-center rounded-full ${
                      lockedOn ? "bg-brand-blue/25 text-brand-dark" : "bg-slate-200 text-slate-500"
                    }`}
                  >
                    <Lock className="h-3 w-3" strokeWidth={2.4} />
                  </span>
                ) : (
                  <input
                    type="checkbox"
                    id={switchId}
                    checked={granted}
                    onChange={(event) => onToggle(perm, event.currentTarget.checked)}
                    aria-label={`${perm.label} for ${role.label}`}
                    className="h-5 w-5 cursor-pointer rounded-[3px] border border-slate-400 accent-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2"
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
