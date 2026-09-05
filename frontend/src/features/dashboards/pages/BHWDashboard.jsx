import React from "react";
import { Link } from "react-router-dom";
import PageHeader from "@/components/common/PageHeader";
import StatCard from "@/components/common/StatCard";
import { Card } from "@/components/common/Card";
import StatusBadge from "@/components/common/StatusBadge";
import { bhwDashboard, households } from "@/services/mock/mockData";
import { ChevronRight } from "lucide-react";

function riskLevel(score) {
  if (score >= 60) return "High";
  if (score >= 40) return "Medium";
  return "Low";
}

// Household-level concerns, aggregated across the barangay. Community data only —
// no individual resident is identified.
const concernSummary = Object.entries(
  households.reduce((acc, h) => {
    h.concerns.forEach((c) => {
      acc[c] = (acc[c] || 0) + 1;
    });
    return acc;
  }, {})
).sort((a, b) => b[1] - a[1]).slice(0, 4);

export default function BHWDashboard() {
  return (
    <>
      <PageHeader crumbs={["Home", "Dashboard"]} title="Good morning, Maria" subtitle="Here's what needs your attention today in San Isidro." />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3 sm:gap-4 mb-6">
        {bhwDashboard.map((s, i) => <StatCard key={s.label} {...s} index={i} />)}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
        <Card className="p-4 sm:p-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h3 className="font-semibold text-brand-ink text-sm sm:text-base">Recent Household Profiles</h3>
            <Link to="/app/bhw/households" className="flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline shrink-0">
              View All <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="space-y-3">
            {households.slice(0, 4).map((h) => (
              <div key={h.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between border border-brand-border rounded-btn px-4 py-3 gap-2">
                <div>
                  <p className="font-medium text-brand-ink text-sm">{h.address}</p>
                  <p className="text-xs text-brand-gray">{h.id} · {h.members} members</p>
                </div>
                <StatusBadge value={riskLevel(h.riskScore)} />
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-4 sm:p-6">
          <h3 className="font-semibold text-brand-ink text-sm sm:text-base mb-4">Household Health Concerns</h3>
          <div className="space-y-3">
            {concernSummary.map(([concern, count]) => (
              <div key={concern} className="flex flex-col sm:flex-row sm:items-center sm:justify-between border border-brand-border rounded-btn px-4 py-3 gap-2">
                <div>
                  <p className="font-medium text-brand-ink text-sm">{concern}</p>
                  <p className="text-xs text-brand-gray">Reported during household profiling</p>
                </div>
                <span className="text-xs bg-brand-light text-brand-blue px-2.5 py-1 rounded-full shrink-0">
                  {count} {count === 1 ? "household" : "households"}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
