import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import PageHeader from "@/components/common/PageHeader";
import StatCard from "@/components/common/StatCard";
import { Card } from "@/components/common/Card";
import DataTable from "@/components/tables/DataTable";
import StatusBadge from "@/components/common/StatusBadge";
import { SkeletonList } from "@/components/common/Skeleton";
import { usePhnWorkflow } from "@/hooks/usePhnWorkflow";
import { CHECKUP_STATUS } from "@/lib/phnWorkflowMap";
import { Activity, HeartPulse, FileText, Calendar } from "lucide-react";

/**
 * RHU Personnel overview.
 *
 * The RHU role is the triage front door: statistics and the queue are derived
 * live from the caller's own intake submissions (GET /intake/visits via
 * usePhnWorkflow), the same authoritative source the Triage page uses. No
 * placeholder/mock data is shown — tiles reflect the real pipeline or an
 * empty/loading state.
 */

const QUICK_ACTIONS = [
  { icon: Activity, label: "Triage", description: "Send a patient to the PHN for check-up", path: "/app/rhu_personnel/triage" },
  { icon: HeartPulse, label: "Health Programs", description: "Manage health programs and initiatives", path: "/app/rhu_personnel/programs" },
  { icon: FileText, label: "Medical Certificates", description: "Prepare and review resident certificates", path: "/app/rhu_personnel/certificates" },
  { icon: Calendar, label: "Notifications", description: "Check your notifications", path: "/app/rhu_personnel/notifications" },
];

const formatDate = (iso) => {
  if (!iso) return "";
  const d = new Date(String(iso).length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

export default function RHUDashboard() {
  const { patients, loading, error } = usePhnWorkflow({ source: "intake" });

  const counts = useMemo(() => {
    const list = Array.isArray(patients) ? patients : [];
    return {
      total: list.length,
      waiting: list.filter((p) => p.status === CHECKUP_STATUS.WAITING).length,
      inCheckup: list.filter((p) => p.status === CHECKUP_STATUS.IN_CHECKUP).length,
      completed: list.filter((p) => p.status === CHECKUP_STATUS.COMPLETED).length,
    };
  }, [patients]);

  const waitingPatients = useMemo(
    () => (Array.isArray(patients) ? patients.filter((p) => p.status === CHECKUP_STATUS.WAITING) : []),
    [patients],
  );

  // Most recent hand-offs first for the activity table.
  const recent = useMemo(() => {
    const list = Array.isArray(patients) ? [...patients] : [];
    return list
      .sort((a, b) => String(b.visitDate || "").localeCompare(String(a.visitDate || "")))
      .slice(0, 8);
  }, [patients]);

  const fmt = (n) => (loading ? "—" : Number(n).toLocaleString());
  const stats = [
    { icon: "ClipboardList", label: "Triage Patients", value: fmt(counts.total), tone: "accent" },
    { icon: "CalendarClock", label: "Waiting for PHN", value: fmt(counts.waiting), tone: "yellow" },
    { icon: "Stethoscope", label: "In Check-up", value: fmt(counts.inCheckup), tone: "blue" },
    { icon: "CheckCircle2", label: "Completed", value: fmt(counts.completed), tone: "green" },
  ];

  const columns = [
    { key: "patient", label: "Patient" },
    { key: "barangay", label: "Barangay" },
    { key: "reason", label: "Reason" },
    { key: "status", label: "Status" },
  ];

  const renderCell = (row, column) => {
    if (column.key === "status") return <StatusBadge value={row.status} />;
    if (column.key === "barangay") return row.barangay || "—";
    if (column.key === "reason") return row.reason || "—";
    return row[column.key];
  };

  return (
    <>
      <PageHeader
        crumbs={["Dashboard"]}
        title="RHU Overview"
        subtitle="Triage hand-offs to the PHN check-up queue."
      />

      {error && <Card className="mb-5 p-4 text-sm text-brand-danger">{error}</Card>}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 mb-6">
        {stats.map((s, i) => (
          <StatCard key={s.label} {...s} index={i} />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5">
        <Card className="p-4 sm:p-6 lg:col-span-2">
          <h3 className="font-semibold text-brand-ink text-sm sm:text-base mb-4">Recent Triage Hand-offs</h3>
          {loading ? (
            <SkeletonList rows={5} />
          ) : recent.length === 0 ? (
            <p className="text-sm text-brand-gray py-6 text-center">No triage records yet.</p>
          ) : (
            <DataTable columns={columns} rows={recent} renderCell={renderCell} />
          )}
        </Card>

        <Card className="p-4 sm:p-6 h-fit">
          <h3 className="font-semibold text-brand-ink text-sm sm:text-base mb-4">Triage Queue</h3>
          {loading ? (
            <SkeletonList rows={4} />
          ) : waitingPatients.length === 0 ? (
            <p className="text-sm text-brand-gray py-6 text-center">No patients waiting for the PHN.</p>
          ) : (
            <div className="space-y-3">
              {waitingPatients.slice(0, 5).map((t) => (
                <div key={t.id} className="flex items-center justify-between py-2 border-b border-brand-border last:border-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-brand-ink truncate">{t.patient}</p>
                    <p className="text-xs text-brand-gray truncate">
                      {[t.barangay, formatDate(t.visitDate)].filter(Boolean).join(" • ")}
                    </p>
                  </div>
                  <StatusBadge value={t.status} />
                </div>
              ))}
            </div>
          )}
          <Link
            to="/app/rhu_personnel/triage"
            className="block w-full mt-4 text-center text-sm font-medium text-brand-blue hover:underline"
          >
            Open Triage Queue
          </Link>
        </Card>
      </div>

      {/* Quick Actions */}
      <div className="mt-6">
        <h3 className="font-semibold text-brand-ink text-sm sm:text-base mb-4">Quick Actions</h3>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {QUICK_ACTIONS.map((action) => (
            <Link key={action.label} to={action.path} className="block">
              <Card className="p-4 hover:border-brand-blue transition-colors cursor-pointer h-full">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-brand-blue/10 rounded-lg">
                    <action.icon className="w-5 h-5 text-brand-blue" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-brand-ink text-sm">{action.label}</h4>
                    <p className="text-xs text-brand-gray mt-1">{action.description}</p>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
