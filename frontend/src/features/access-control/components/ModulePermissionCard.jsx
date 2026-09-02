import React from "react";
import { motion } from "framer-motion";
import { CheckCheck, Lock, ShieldAlert, XSquare } from "lucide-react";

import Icon from "@/components/common/Icon";
import { Switch } from "@/components/ui/switch";
import {
  ACTION,
  ACTION_LABEL,
  countGrantedInModule,
  getModule,
  isPermissionLocked,
  isPermissionLockedOn,
  permissionLockReason,
} from "@/lib/permissions";

const ACTION_PILL = {
  [ACTION.VIEW]: "bg-slate-100 text-slate-600",
  [ACTION.CREATE]: "bg-brand-light text-brand-blue",
  [ACTION.EDIT]: "bg-brand-accent/10 text-brand-accent",
  [ACTION.APPROVE]: "bg-brand-goldpale text-brand-amber",
  [ACTION.DELETE]: "bg-brand-danger/10 text-brand-danger",
};

/**
 * One module of the catalogue, with an on/off switch per permission.
 *
 * Rows come straight from the registry, so a new permission appears here
 * without any change to this component. Permissions fixed by policy render as
 * a locked chip with the reason attached instead of an operable switch.
 */
export default function ModulePermissionCard({
  module,
  role,
  permissions,
  highlighted,
  index = 0,
  onToggle,
  onBulk,
}) {
  const { on, total } = countGrantedInModule(module.id, permissions);

  // `module` may arrive filtered by the page's search box, so counts and the
  // bulk actions always work from the registry definition instead.
  const fullModule = getModule(module.id) || module;
  const filtered = module.permissions.length !== fullModule.permissions.length;

  const operable = fullModule.permissions.filter((perm) => !isPermissionLocked(role.id, perm.id));
  const canEnableAll = operable.some((perm) => !permissions[perm.id]);
  const canDisableAll = operable.some((perm) => permissions[perm.id]);

  return (
    <motion.section
      id={`permission-module-${module.id}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.04, 0.2) }}
      className={`scroll-mt-24 overflow-hidden rounded-2xl border bg-white shadow-card transition-colors ${
        highlighted ? "border-brand-blue ring-1 ring-brand-blue/30" : "border-slate-200"
      }`}
      aria-labelledby={`permission-module-heading-${module.id}`}
    >
      <header className="flex flex-col gap-4 border-b border-slate-200 px-5 py-4 md:flex-row md:items-center md:justify-between md:px-6">
        <div className="flex items-start gap-3.5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-light text-brand-blue">
            <Icon name={module.icon} className="h-[18px] w-[18px]" strokeWidth={1.8} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3
                id={`permission-module-heading-${module.id}`}
                className="font-heading text-[15px] font-semibold text-slate-900"
              >
                {module.label}
              </h3>
              <span className="num rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                {on}/{total}
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">{module.description}</p>
            {filtered && (
              <p className="mt-1 text-[11px] font-medium text-brand-amber">
                Showing {module.permissions.length} of {fullModule.permissions.length} permissions — bulk actions still
                apply to the whole module.
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={!canEnableAll}
            onClick={() => onBulk(module, true)}
            className="inline-flex items-center gap-1.5 rounded-btn border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:border-brand-blue hover:text-brand-blue disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-300 disabled:hover:text-slate-700"
          >
            <CheckCheck className="h-3.5 w-3.5" strokeWidth={2} />
            Enable all
          </button>
          <button
            type="button"
            disabled={!canDisableAll}
            onClick={() => onBulk(module, false)}
            className="inline-flex items-center gap-1.5 rounded-btn border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:border-brand-danger hover:text-brand-danger disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-300 disabled:hover:text-slate-700"
          >
            <XSquare className="h-3.5 w-3.5" strokeWidth={2} />
            Disable all
          </button>
        </div>
      </header>

      <ul className="divide-y divide-slate-100">
        {module.permissions.map((perm) => {
          const granted = Boolean(permissions[perm.id]);
          const locked = isPermissionLocked(role.id, perm.id);
          const lockedOn = isPermissionLockedOn(role.id, perm.id);
          const reason = locked ? permissionLockReason(role.id, perm.id) : "";
          const switchId = `perm-${perm.id}`;

          return (
            <li
              key={perm.id}
              className={`flex items-start gap-4 px-5 py-3.5 md:px-6 ${locked ? "bg-slate-50/60" : "hover:bg-slate-50/60"}`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <label
                    htmlFor={locked ? undefined : switchId}
                    className={`text-sm font-medium ${locked ? "text-slate-500" : "cursor-pointer text-slate-900"}`}
                  >
                    {perm.label}
                  </label>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] ${ACTION_PILL[perm.action]}`}
                  >
                    {ACTION_LABEL[perm.action]}
                  </span>
                  {perm.sensitive && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-brand-goldpale px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-brand-amber">
                      <ShieldAlert className="h-3 w-3" strokeWidth={2.2} />
                      Sensitive
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">{perm.description}</p>
                {reason && (
                  <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-brand-amber">
                    <Lock className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={2.2} />
                    {reason}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-2.5 pt-0.5">
                <span
                  className={`num hidden w-16 text-right text-[11px] font-semibold uppercase tracking-[0.1em] sm:block ${
                    granted ? "text-brand-blue" : "text-slate-400"
                  }`}
                >
                  {granted ? "Allowed" : "Denied"}
                </span>
                {locked ? (
                  <span
                    title={reason}
                    className={`inline-flex h-5 w-9 items-center justify-center rounded-full ${
                      lockedOn ? "bg-brand-blue/25 text-brand-dark" : "bg-slate-200 text-slate-500"
                    }`}
                  >
                    <Lock className="h-3 w-3" strokeWidth={2.4} />
                  </span>
                ) : (
                  <Switch
                    id={switchId}
                    checked={granted}
                    onCheckedChange={(next) => onToggle(perm, next)}
                    aria-label={`${perm.label} for ${role.label}`}
                    className="data-[state=checked]:bg-brand-blue"
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </motion.section>
  );
}
