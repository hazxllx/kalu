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
  mobileCards = true,
  compact = false,
  stickyHeader = false,
  maxHeight = null,
  emptyText = "No records found.",
  striped = false,
}) {
  const cellValue = (column, row) => column.render ? column.render(row) : renderCell ? renderCell(column.key, row) : row[column.key];
  const alignClass = (column) => column.align === "right" ? "text-right" : column.align === "center" ? "text-center" : "text-left";
  return (
    <div
      style={maxHeight ? { "--data-table-max-height": maxHeight } : undefined}
      className={`ui-data-table table-scroll min-w-0 ${maxHeight ? "overflow-x-auto md:max-h-[var(--data-table-max-height)] md:overflow-auto" : "overflow-x-auto"} rounded-2xl border border-slate-200 bg-white dark:bg-card dark:border-border shadow-card ${className}`}
    >
      {/* Desktop Table View */}
      <table className={`${mobileCards ? "hidden md:table" : ""} ${fitContainer ? "min-w-0 w-full" : "min-w-[640px]"} text-sm ${tableClassName}`}>
        <thead className={stickyHeader ? "sticky top-0 z-10" : ""}>
          <tr className="bg-slate-50 dark:bg-card-nested text-left">
            {columns.map((c) => (
              <th key={c.key} className={`${compact ? "px-3 py-2" : "px-5 py-3.5"} ${alignClass(c)} ${c.headerClassName || ""} font-semibold text-slate-600 dark:text-slate-400 text-xs uppercase tracking-[0.12em] whitespace-nowrap`}>
              <th key={c.key} className={`${compact ? "px-3 py-2" : "px-5 py-3.5"} ${alignClass(c)} ${c.headerClassName || ""} font-semibold text-slate-600 dark:text-slate-400 text-xs uppercase tracking-[0.12em] whitespace-nowrap`}>
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
              className={`border-t border-slate-200 transition-colors hover:bg-brand-light/50 dark:border-border dark:hover:bg-hover ${striped ? "even:bg-slate-50/40 dark:even:bg-card-nested/40" : ""}`}
            >
              {columns.map((c) => (
                 <td key={c.key} className={`${compact ? "px-3 py-2" : "px-5 py-4"} ${alignClass(c)} ${c.wrap ? "whitespace-normal break-words leading-snug" : "whitespace-nowrap"} ${c.className || ""} text-slate-700 dark:text-slate-300`}>
                   {cellValue(c, row)}
                 </td>
              ))}
            </motion.tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={columns.length} className={`${compact ? "px-3 py-6" : "px-5 py-10"} text-center text-sm text-brand-gray`}>{emptyText}</td></tr>
          )}
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
               className={`p-4 transition-colors hover:bg-brand-light/50 dark:hover:bg-hover ${striped && i % 2 === 1 ? "bg-slate-50/40 dark:bg-card-nested/40" : ""}`}
            >
              <dl className="grid grid-cols-1 gap-3">
                {columns.filter(c => !c.hideOnMobile).map((c) => (
                  <div key={c.key} className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-1">
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {c.mobileLabel || c.label}
                    </dt>
                     <dd className={`text-sm text-slate-700 dark:text-slate-300 break-words ${c.align === "right" ? "sm:text-right" : ""}`}>
                       {cellValue(c, row)}
                    </dd>
                  </div>
           ))}
               </dl>
             </motion.div>
           ))}
          {rows.length === 0 && <div className="p-6 text-center text-sm text-brand-gray">{emptyText}</div>}
        </div>
      )}
    </div>
  );
}
