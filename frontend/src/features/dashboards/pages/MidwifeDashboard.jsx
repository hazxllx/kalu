import React, { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import PageHeader from "@/components/common/PageHeader";
import StatCard from "@/components/common/StatCard";
import { Card } from "@/components/common/Card";
import StatusBadge from "@/components/common/StatusBadge";
import { Plus, FileHeart, Send, CalendarCheck, ClipboardList } from "lucide-react";
import useAuthorizedData from "@/hooks/useAuthorizedData";
import ErrorState from "@/components/common/ErrorState";
import { SkeletonStatGrid } from "@/components/common/Skeleton";
import { authorizedViewsApi } from "@/services/api/authorizedViewsApi";
import { healthServicesApi } from "@/services/api/healthServicesApi";
import { getBarangayHealthOverview } from "@/services/api/monitoringApi";
import { getAssignedBarangay } from "@/lib/barangayScope";
import { metricValue } from "@/lib/legacyAnalytics";
import { useAuth } from "@/context/AuthContext";

const actions = [
  { icon: Plus, label: "New Consultation" },
  { icon: CalendarCheck, label: "Record Follow-up" },
  { icon: ClipboardList, label: "Update TCLS" },
  { icon: FileHeart, label: "Update M1" },
  { icon: Send, label: "Refer Patient" },
];

export default function MidwifeDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const assignedBarangay = getAssignedBarangay(user);
  const load = useCallback(async (options) => getBarangayHealthOverview(assignedBarangay, { load: () => authorizedViewsApi.earlyWarning({ barangay: assignedBarangay }, options) }), [assignedBarangay]);
  const overview = useAuthorizedData(load);
  const serviceLoad = useCallback(async (options) => {
    const result = await healthServicesApi.list({ mine: true }, options);
    if (!Array.isArray(result?.rows)) throw new Error("The assigned health-service response was incomplete.");
    return result.rows;
  }, []);
  const services = useAuthorizedData(serviceLoad);
  const metrics = overview.data?.metrics;
  const midwifeStats = metrics ? [
    { label: "Registered Residents", value: metricValue(metrics.totalResidents), icon: "Users" },
    { label: "Consultations This Month", value: metricValue(metrics.consultationsThisMonth), icon: "Stethoscope" },
    { label: "Pending Referrals", value: metricValue(metrics.pendingReferrals), icon: "Send" },
    { label: "Active Follow-ups", value: metricValue(metrics.activeFollowUps), icon: "CalendarCheck" },
    { label: "Active Maternal Cases", value: metricValue(metrics.activeMaternalCases), icon: "Heart" },
    { label: "Immunization Records", value: metricValue(metrics.immunizationRecords), icon: "Syringe" },
  ] : [];
  const healthServices = services.data || [];
  const firstName = (user?.name || "").trim().split(" ")[0];
  // BUG-023: canonical role terminology is "Health Supervisor" (not "Midwife").
  // NOTE: this component is currently unrouted/dead (no AppRoutes reference); the
  // terminology is corrected in place rather than deleting unrouted code.
  const welcome = firstName ? `Welcome, ${firstName}` : "Welcome, Health Supervisor";
  return (
    <>
      <PageHeader crumbs={["Dashboard"]} title={welcome} subtitle="Authorized barangay health records and assigned service activity." />
      {overview.loading ? <SkeletonStatGrid count={6} /> : overview.error ? <ErrorState message={overview.error} onRetry={overview.refresh} /> : null}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4 mb-6">
        {midwifeStats.map((s, i) => <StatCard key={s.label} {...s} index={i} />)}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5">
        <Card className="p-4 sm:p-6 lg:col-span-2">
          <h3 className="font-semibold text-brand-ink text-sm sm:text-base mb-4">Ongoing Health Services</h3>
          <div className="space-y-3">
            {services.loading && <p className="text-sm text-brand-gray">Loading assigned services...</p>}
            {services.error && <ErrorState message={services.error} onRetry={services.refresh} />}
            {!services.loading && !services.error && healthServices.length === 0 && (
              <p className="text-sm text-brand-gray py-6 text-center">No health services available yet.</p>
            )}
            {healthServices.slice(0, 5).map((s) => (
              <div key={s.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between border border-brand-border rounded-btn px-4 py-3 gap-2">
                <div>
                  <p className="font-medium text-brand-ink text-sm">{s.name}</p>
                  <p className="text-xs text-brand-gray">{s.startDate || "Schedule not recorded"} {s.startTime || ""} · {s.category || "Category not recorded"}</p>
                </div>
                <StatusBadge value={s.status} />
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4 sm:p-6 h-fit">
          <h3 className="font-semibold text-brand-ink text-sm sm:text-base mb-4">Quick Actions</h3>
          <div className="space-y-2.5">
            {actions.map((a, index) => (
              <button key={a.label} disabled={!user} onClick={() => navigate(`/app/${user.role}/${["treatment", "followup-schedule", "tcl-register", "m1", "referrals"][index]}`)} className="w-full flex items-center gap-3 border border-brand-border rounded-btn px-4 py-3 text-sm font-medium text-brand-ink hover:border-brand-blue hover:bg-brand-light transition-colors">
                <a.icon className="w-4 h-4 text-brand-blue" /> {a.label}
              </button>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
