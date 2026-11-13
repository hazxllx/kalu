import React from "react";
import { motion } from "framer-motion";

/**
 * DataTable - Responsive data table with automatic mobile card layout
 * 
 * Features:
 * - Desktop: Standard table layout with horizontal scroll
 * - Mobile (<768px): Automatic conversion to stacked card layout
 * - Configurable mobile behavior via mobileCards prop
 * - Support for custom cell rendering
 * - Smooth animations on row appearance
 * 
 * Props:
 * - columns: Array of {key, label, mobileLabel?, hideOnMobile?}
 * - rows: Array of data objects
 * - renderCell: Optional custom cell renderer (key, row) => ReactNode
 * - mobileCards: boolean (default true) - Enable mobile card layout
 * - dense: boolean - Disable animations for performance
 * - fitContainer: boolean - Table fills container width
 * - className: Additional wrapper classes
 * - tableClassName: Additional table classes
 */
export default function DataTable({ 
  columns, 
  rows, 
  renderCell, 
  dense = false, 
  className = "", 
  tableClassName = "", 
  fitContainer = false,
  mobileCards = true 
}) {
  return (
    <div className={`ui-data-table table-scroll min-w-0 overflow-x-auto rounded-lg border border-slate-200 bg-white dark:bg-card dark:border-border shadow-card ${className}`}>
      {/* Desktop Table View */}
      <table className={`${mobileCards ? "hidden md:table" : ""} ${fitContainer ? "min-w-0 w-full" : "min-w-[640px]"} text-sm ${tableClassName}`}>
        <thead>
          <tr className="bg-slate-50/80 dark:bg-card-nested text-left">
            {columns.map((c) => (
              <th key={c.key} className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-400 text-[11px] uppercase tracking-[0.08em] whitespace-nowrap">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <motion.tr 
              key={row.id ?? i} 
              initial={dense ? false : { opacity: 0 }} 
              animate={{ opacity: 1 }} 
              transition={{ delay: dense ? 0 : i * 0.03 }}
              className="border-t border-slate-200 dark:border-border hover:bg-slate-50/70 dark:hover:bg-hover transition-colors"
            >
              {columns.map((c) => (
                <td key={c.key} className="px-4 py-3.5 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                  {renderCell ? renderCell(c.key, row) : row[c.key]}
                </td>
              ))}
            </motion.tr>
          ))}
        </tbody>
      </table>

      {/* Mobile Card View */}
      {mobileCards && (
        <div className="md:hidden divide-y divide-slate-200 dark:divide-border">
          {rows.map((row, i) => (
            <motion.div
              key={row.id ?? i}
              initial={dense ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: dense ? 0 : i * 0.03 }}
              className="p-4 hover:bg-slate-50/70 dark:hover:bg-hover transition-colors"
            >
              <dl className="grid grid-cols-1 gap-3">
                {columns.filter(c => !c.hideOnMobile).map((c) => (
                  <div key={c.key} className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-1">
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {c.mobileLabel || c.label}
                    </dt>
                    <dd className="text-sm text-slate-700 dark:text-slate-300 sm:text-right break-words">
                      {renderCell ? renderCell(c.key, row) : row[c.key]}
                    </dd>
                  </div>
                ))}
              </dl>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
