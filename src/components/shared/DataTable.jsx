import React from "react";
import { motion } from "framer-motion";

export default function DataTable({ columns, rows, renderCell }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50 text-left">
            {columns.map((c) => (
              <th key={c.key} className="px-5 py-3.5 font-semibold text-slate-600 text-xs uppercase tracking-[0.2em] whitespace-nowrap">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <motion.tr key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
              className="border-t border-slate-200 hover:bg-slate-50/70 transition-colors">
              {columns.map((c) => (
                <td key={c.key} className="px-5 py-4 text-slate-700 whitespace-nowrap">
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