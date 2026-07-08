import React from "react";
import { motion } from "framer-motion";

export default function DataTable({ columns, rows, renderCell }) {
  return (
    <div className="overflow-x-auto rounded-table border border-brand-border bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-brand-bg text-left">
            {columns.map((c) => (
              <th key={c.key} className="px-5 py-3.5 font-semibold text-brand-gray text-xs uppercase tracking-wide whitespace-nowrap">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <motion.tr key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
              className="border-t border-brand-border hover:bg-brand-bg/60 transition-colors">
              {columns.map((c) => (
                <td key={c.key} className="px-5 py-4 text-brand-ink whitespace-nowrap">
                  {renderCell ? renderCell(c.key, row) : row[c.key]}
                </td>
              ))}
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}