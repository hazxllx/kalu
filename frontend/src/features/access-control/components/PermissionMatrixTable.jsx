import React from "react";
import { Check, ChevronRight, Minus } from "lucide-react";

import Icon from "@/components/common/Icon";
import {
  ACTION_LABEL,
  ACTION_ORDER,
  PERMISSION_MODULES,
  countGrantedInModule,
  moduleActionState,
} from "@/lib/permissions";

/**
 * Module x action overview for the selected role.
 *
 * Columns come from `ACTION_ORDER` and rows from `PERMISSION_MODULES`, so the
 * table grows on its own when the catalogue is extended. A cell is a shortcut:
 * clicking it opens the matching module below.
 */
const Cell = ({ state, on, total }) => {
  if (state === "na") {
    return <span className="text-sm text-slate-300">&middot;</span>;
  }
  if (state === "on") {
    return (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-brand-blue text-white">
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </span>
    );
  }
  if (state === "partial") {
    return (
      <span className="num inline-flex h-6 min-w-[34px] items-center justify-center rounded-md bg-brand-goldpale px-1.5 text-[11px] font-bold text-brand-amber">
        {on}/{total}
      </span>
    );
  }
  return (
    <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-slate-100 text-slate-400">
      <Minus className="h-3.5 w-3.5" strokeWidth={2.4} />
    </span>
  );
};

export default function PermissionMatrixTable({ role, permissions, onOpenModule }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
      <header className="flex flex-col gap-1 border-b border-slate-200 px-5 py-4 md:flex-row md:items-center md:justify-between md:px-6">
        <div>
          <p className="gov-kicker text-brand-gray">Access overview</p>
          <h2 className="mt-1 font-heading text-base font-semibold text-slate-900">
            Role: <span className="text-brand-blue">{role.label}</span>
          </h2>
        </div>
        <p className="text-xs text-slate-500">Select a cell to jump to that module.</p>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <caption className="sr-only">
            Permissions granted to {role.label}, grouped by module and action.
          </caption>
          <thead>
            <tr className="bg-slate-50 text-left">
              <th scope="col" className="px-5 py-3.5 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600 md:px-6">
                Module
              </th>
              {ACTION_ORDER.map((action) => (
                <th
                  key={action}
                  scope="col"
                  className="px-3 py-3.5 text-center text-xs font-semibold uppercase tracking-[0.16em] text-slate-600"
                >
                  {ACTION_LABEL[action]}
                </th>
              ))}
              <th scope="col" className="px-5 py-3.5 text-right text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">
                Granted
              </th>
            </tr>
          </thead>
          <tbody>
            {PERMISSION_MODULES.map((mod) => {
              const { on, total } = countGrantedInModule(mod.id, permissions);
              return (
                <tr key={mod.id} className="border-t border-slate-200 transition-colors hover:bg-slate-50/70">
                  <th scope="row" className="px-5 py-3.5 text-left font-normal md:px-6">
                    <button
                      type="button"
                      onClick={() => onOpenModule(mod.id)}
                      className="group flex items-center gap-3 text-left"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-light text-brand-blue">
                        <Icon name={mod.icon} className="h-4 w-4" strokeWidth={1.8} />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-slate-900 group-hover:text-brand-blue">
                          {mod.label}
                        </span>
                      </span>
                    </button>
                  </th>

                  {ACTION_ORDER.map((action) => {
                    const cell = moduleActionState(mod.id, action, permissions);
                    const label = `${mod.label} — ${ACTION_LABEL[action]}`;
                    return (
                      <td key={action} className="px-3 py-3.5 text-center">
                        {cell.state === "na" ? (
                          <Cell {...cell} />
                        ) : (
                          <button
                            type="button"
                            onClick={() => onOpenModule(mod.id)}
                            title={`${label}: ${cell.on} of ${cell.total} granted`}
                            aria-label={`${label}: ${cell.on} of ${cell.total} granted`}
                            className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2"
                          >
                            <Cell {...cell} />
                          </button>
                        )}
                      </td>
                    );
                  })}

                  <td className="px-5 py-3.5 text-right">
                    <button
                      type="button"
                      onClick={() => onOpenModule(mod.id)}
                      className="inline-flex items-center gap-1.5 text-slate-600 hover:text-brand-blue"
                    >
                      <span className="num text-sm font-semibold">
                        {on}
                        <span className="text-slate-400">/{total}</span>
                      </span>
                      <ChevronRight className="h-4 w-4" strokeWidth={2} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <footer className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-200 bg-slate-50/70 px-5 py-3 text-xs text-slate-500 md:px-6">
        <span className="inline-flex items-center gap-2">
          <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-brand-blue text-white">
            <Check className="h-2.5 w-2.5" strokeWidth={3.5} />
          </span>
          All granted
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="num inline-flex h-4 items-center rounded bg-brand-goldpale px-1 text-[9px] font-bold text-brand-amber">
            1/2
          </span>
          Partly granted
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-slate-100 text-slate-400">
            <Minus className="h-2.5 w-2.5" strokeWidth={3} />
          </span>
          Not granted
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="text-slate-300">&middot;</span>
          Not applicable
        </span>
      </footer>
    </section>
  );
}
