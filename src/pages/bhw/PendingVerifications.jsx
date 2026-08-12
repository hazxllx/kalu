import React, { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import PageHeader from "@/components/shared/PageHeader";
import { Card } from "@/components/shared/Card";
import VerificationBadge from "@/components/shared/VerificationBadge";
import { Search, ChevronRight, CheckCircle2 } from "lucide-react";

const PENDING = [
  { id: 1, name: "Juan Dela Cruz Reyes", barangay: "San Jose", registered: "July 5, 2026", ref: "KSG-2026-00428", status: "Pending" },
  { id: 2, name: "Maria Santos Lopez", barangay: "San Jose", registered: "July 4, 2026", ref: "KSG-2026-00427", status: "Pending" },
  { id: 3, name: "Roberto Aguilar Cruz", barangay: "San Jose", registered: "July 4, 2026", ref: "KSG-2026-00425", status: "Pending" },
  { id: 4, name: "Ana Patricia Lim", barangay: "San Jose", registered: "July 3, 2026", ref: "KSG-2026-00421", status: "Pending" },
  { id: 5, name: "Fernando Garcia Jr.", barangay: "San Jose", registered: "July 3, 2026", ref: "KSG-2026-00419", status: "Pending" },
];

export default function PendingVerifications() {
  const [query, setQuery] = useState("");

  const filtered = PENDING.filter((r) =>
    r.name.toLowerCase().includes(query.toLowerCase()) ||
    r.ref.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <>
      <PageHeader
        crumbs={["Home", "Dashboard", "Pending Verifications"]}
        title="Pending Resident Verifications"
        subtitle={`${PENDING.length} residents awaiting identity verification in Barangay San Jose.`}
      />

      <Card className="overflow-hidden">
        {/* Search bar */}
        <div className="px-6 py-4 border-b border-brand-border">
          <div className="flex items-center gap-2 bg-brand-bg border border-brand-border rounded-input px-3.5 py-2.5 max-w-sm">
            <Search className="w-4 h-4 text-brand-gray" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or reference..."
              className="bg-transparent text-sm outline-none w-full placeholder:text-brand-gray/70"
            />
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-brand-bg text-left">
                <th className="px-6 py-3 font-medium text-brand-gray">Resident</th>
                <th className="px-6 py-3 font-medium text-brand-gray">Barangay</th>
                <th className="px-6 py-3 font-medium text-brand-gray">Registered</th>
                <th className="px-6 py-3 font-medium text-brand-gray">Reference</th>
                <th className="px-6 py-3 font-medium text-brand-gray">Status</th>
                <th className="px-6 py-3 font-medium text-brand-gray text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border">
              {filtered.map((r, i) => (
                <motion.tr
                  key={r.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="hover:bg-brand-bg/50 transition-colors"
                >
                  <td className="px-6 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-brand-light text-brand-blue flex items-center justify-center text-xs font-heading font-semibold">
                        {r.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                      </div>
                      <span className="font-medium text-brand-ink">{r.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-3.5 text-brand-gray">{r.barangay}</td>
                  <td className="px-6 py-3.5 text-brand-gray">{r.registered}</td>
                  <td className="px-6 py-3.5">
                    <span className="font-stat font-medium text-brand-ink text-xs">{r.ref}</span>
                  </td>
                  <td className="px-6 py-3.5">
                    <VerificationBadge status="pending" size="sm" />
                  </td>
                  <td className="px-6 py-3.5 text-right">
                    <Link
                      to="/app/bhw/verification/review"
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-blue hover:underline"
                    >
                      Review <ChevronRight className="w-3.5 h-3.5" />
                    </Link>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <div className="px-6 py-16 text-center">
            <div className="w-14 h-14 rounded-full bg-brand-bg flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-7 h-7 text-brand-gray" strokeWidth={1.5} />
            </div>
            <p className="mt-4 text-sm font-medium text-brand-ink">No pending verifications</p>
            <p className="text-xs text-brand-gray mt-1">All caught up.</p>
          </div>
        )}
      </Card>
    </>
  );
}