import React from "react";
import { Check, ChevronDown, ChevronRight, Minus } from "lucide-react";

import ModulePermissionCard from "@/features/access-control/components/ModulePermissionCard";
import {
  ACTION_LABEL,
  ACTION_ORDER,
  ALL_PERMISSION_IDS,
  countGranted,
  getModule,
  isPermissionLocked,
} from "@/lib/permissions";

const Cell = ({ state, on, total, module, action, role, onActionToggle }) => {
  if (state === "na") return <span className="text-slate-300">&middot;</span>;

  const enabled = state === "on";
  const mixed = state === "partial";
  const actionPermissions = module.permissions.filter((permission) => permission.action === action);
  const lockedCount = actionPermissions.filter((permission) => isPermissionLocked(role.id, permission.id)).length;
  const disabled = lockedCount === actionPermissions.length;
  const nextValue = !enabled;

  return (
    <input
      type="checkbox"
      checked={enabled}
      ref={(element) => {
        if (element) element.indeterminate = mixed;
      }}
      aria-checked={mixed ? "mixed" : enabled}
      aria-label={`${module.label}, ${ACTION_LABEL[action]}: ${on} of ${total} granted. Click to ${
        nextValue ? "enable" : "disable"
      } all ${ACTION_LABEL[action]} permissions${lockedCount ? `; ${lockedCount} locked` : ""}`}
      title={`${ACTION_LABEL[action]}: ${on} of ${total} granted. Click to ${nextValue ? "enable" : "disable"} all ${
        ACTION_LABEL[action]
      } permissions${lockedCount ? `; ${lockedCount} locked` : ""}.`}
      disabled={disabled}
      onChange={(event) => onActionToggle(module, action, actionPermissions, event.currentTarget.checked)}
      className="h-5 w-5 cursor-pointer rounded-[3px] border border-slate-400 accent-brand-dark transition-colors hover:outline hover:outline-2 hover:outline-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
    />
  );
};

export default function PermissionMatrixTable({
  role,
  permissions,
  modules,
  expandedModuleId,
  onOpenModule,
  onActionToggle,
  onToggle,
  onBulk,
}) {
  const granted = countGranted(permissions);
  const total = ALL_PERMISSION_IDS.length;

  return (
    <section className="overflow-hidden border border-slate-200 bg-white">
      <header className="border-b border-slate-200 px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Access overview</p>
            <h2 className="mt-0.5 text-base font-semibold text-brand-dark">
              {role.label}
              <span className="ml-2 text-xs font-medium text-slate-500">
                {granted}/{total} permissions granted
              </span>
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">{role.description}</p>
          </div>
          <p className="num rounded bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-600">
            {granted} / {total} granted
          </p>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <Check className="h-3.5 w-3.5 text-brand-blue" strokeWidth={2.5} />
            All granted
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="num font-semibold text-brand-amber">1/2</span>
            Partly granted
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Minus className="h-3.5 w-3.5 text-slate-300" />
            Not granted
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="text-slate-300">&middot;</span>
            Not applicable
          </span>
          <span className="ml-auto text-slate-500">Click a permission to enable or disable it.</span>
        </div>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm">
          <caption className="sr-only">
            Permissions granted to {role.label}, grouped by module and action.
          </caption>
          <thead>
            <tr className="h-9 bg-slate-50 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              <th scope="col" className="min-w-[220px] px-4 text-left sm:px-5">Module</th>
              {ACTION_ORDER.map((action) => (
                <th key={action} scope="col" className="px-2 text-center">{ACTION_LABEL[action]}</th>
              ))}
              <th scope="col" className="px-4 text-right sm:px-5">Granted</th>
            </tr>
          </thead>
          <tbody>
            {modules.map((module) => {
              const fullModule = getModule(module.id) || module;
              const moduleGranted = fullModule.permissions.filter((permission) => permissions[permission.id]).length;
              const moduleTotal = fullModule.permissions.length;
              const expanded = expandedModuleId === module.id;

              return (
                <React.Fragment key={module.id}>
                  <tr
                    id={`permission-module-${module.id}`}
                    className={`h-[48px] border-t border-slate-200 transition-colors ${
                      expanded ? "bg-[#EEF2F6]" : "hover:bg-slate-50/70"
                    }`}
                  >
                    <th scope="row" className="px-4 text-left font-medium sm:px-5">
                      <button
                        type="button"
                        onClick={() => onOpenModule(module.id)}
                        aria-expanded={expanded}
                        aria-controls={`permission-details-${module.id}`}
                        className="flex w-full items-center gap-2 text-left text-slate-900 hover:text-brand-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
                      >
                        {expanded ? (
                          <ChevronDown className="h-4 w-4 shrink-0 text-brand-blue" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                        )}
                        <span className="truncate">{module.label}</span>
                      </button>
                    </th>
                    {ACTION_ORDER.map((action) => {
                      const actionPermissions = module.permissions.filter((permission) => permission.action === action);
                      const actionGranted = actionPermissions.filter((permission) => permissions[permission.id]).length;
                      const cell = {
                        state:
                          actionPermissions.length === 0
                            ? "na"
                            : actionGranted === actionPermissions.length
                              ? "on"
                              : actionGranted === 0
                                ? "off"
                                : "partial",
                        on: actionGranted,
                        total: actionPermissions.length,
                      };
                      return (
                        <td key={action} className="px-2 text-center">
                          <Cell
                            {...cell}
                            module={module}
                            action={action}
                            role={role}
                            onActionToggle={onActionToggle}
                          />
                        </td>
                      );
                    })}
                    <td className="px-4 text-right sm:px-5">
                      <span className="num text-xs font-semibold text-slate-600">
                        {moduleGranted}<span className="text-slate-400">/{moduleTotal}</span>
                      </span>
                    </td>
                  </tr>
                  {expanded && (
                    <tr>
                      <td id={`permission-details-${module.id}`} colSpan={ACTION_ORDER.length + 2} className="p-0">
                        <ModulePermissionCard
                          module={module}
                          role={role}
                          permissions={permissions}
                          onToggle={onToggle}
                          onBulk={onBulk}
                        />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
