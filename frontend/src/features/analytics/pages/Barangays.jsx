import React, { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import StatCard from "@/components/common/StatCard";
import ErrorState from "@/components/common/ErrorState";
import { SkeletonStatGrid } from "@/components/common/Skeleton";
import {
  MapPin, Users, AlertTriangle, Syringe, Plus, X, ShieldAlert, LifeBuoy,
  Home, HeartPulse, CalendarClock, Send, Activity, ClipboardCheck,
} from "lucide-react";
import { barangayOverview } from "@/services/local/dashboardData";
import { getBarangayHealthOverview } from "@/services/api/monitoringApi";
import { useAuth } from "@/context/AuthContext";
import { isHealthSupervisor, getSupervisorScope } from "@/lib/supervisorScope";

/**
 * Barangay health profiles.
 *
 * - Health Supervisor (barangay-assigned): a single "My Barangay" view showing
 *   ONLY the supervisor's assigned barangay. Adding barangays is a municipality
 *   administration function, so no Add button is offered.
 * - Health Supervisor (no assignment): an empty state that asks the
 *   municipality administrator for an assignment â€” never a fallback list of
 *   every barangay.
 * - Municipality-level roles (e.g. MHO): the existing multi-barangay overview
 *   and registration flow, unchanged.
 */
export default function Barangays() {
  const { user } = useAuth();
  const supervisor = isHealthSupervisor(user);
  const scope = supervisor ? getSupervisorScope(user) : null;
  const assignedBarangay = scope && scope.level === "barangay" ? scope.assignedBarangay : null;

  const [barangays, setBarangays] = useState(barangayOverview);
  const [showAddModal, setShowAddModal] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    municipality: "",
    province: "",
    captain: "",
    contact: "",
    healthStation: "",
    bhw: "",
    status: "Active",
  });
  /** @type {[Record<string, string>, Function]} */
  const [errors, setErrors] = useState({});

  // Barangay registration is a municipality administration function.
  const canAddBarangay = !supervisor;

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: "" }));
    }
  };

  const validateForm = () => {
    const newErrors = {};
    if (!formData.name.trim()) newErrors.name = "Barangay Name is required";
    if (!formData.municipality.trim()) newErrors.municipality = "Municipality is required";
    if (!formData.province.trim()) newErrors.province = "Province is required";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSaveBarangay = () => {
    if (!validateForm()) return;

    const newBarangay = {
      name: formData.name,
      residents: 0,
      highRisk: 0,
      coverage: "0%",
    };

    setBarangays((prev) => [...prev, newBarangay]);
    setShowAddModal(false);
    setFormData({
      name: "",
      municipality: "",
      province: "",
      captain: "",
      contact: "",
      healthStation: "",
      bhw: "",
      status: "Active",
    });
    setErrors({});
  };

  const handleCancel = () => {
    setShowAddModal(false);
    setFormData({
      name: "",
      municipality: "",
      province: "",
      captain: "",
      contact: "",
      healthStation: "",
      bhw: "",
      status: "Active",
    });
    setErrors({});
  };

  /* ----------------- Health Supervisor: single-barangay view ---------------- */

  if (supervisor) {
    return <SupervisorBarangayView assignedBarangay={assignedBarangay} />;
  }

  /* ----------------- Municipality-level view (unchanged) ------------------- */

  return (
    <>
      <PageHeader
        crumbs={["Barangays"]}
        title="Barangays"
        subtitle="Health profile of every connected barangay."
        action={
          canAddBarangay ? (
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 bg-brand-blue text-white px-4 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors"
            >
              <Plus className="w-4 h-4" /> Add Barangay
            </button>
          ) : undefined
        }
      />
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-5">
        {barangays.map((b, i) => (
          <motion.div key={b.name} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }} whileHover={{ y: -4 }}>
            <Card className="p-6">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-brand-light text-brand-blue flex items-center justify-center"><MapPin className="w-5 h-5" /></div>
                <h3 className="font-semibold text-brand-ink">Brgy. {b.name}</h3>
              </div>
              <div className="mt-5 space-y-3 text-sm">
                <p className="flex items-center justify-between"><span className="flex items-center gap-2 text-brand-gray"><Users className="w-4 h-4" /> Residents</span><span className="font-medium text-brand-ink">{b.residents.toLocaleString()}</span></p>
                <p className="flex items-center justify-between"><span className="flex items-center gap-2 text-brand-gray"><AlertTriangle className="w-4 h-4" /> High Risk</span><span className="font-medium text-brand-danger">{b.highRisk}</span></p>
                <p className="flex items-center justify-between"><span className="flex items-center gap-2 text-brand-gray"><Syringe className="w-4 h-4" /> Vax Coverage</span><span className="font-medium text-brand-green">{b.coverage}</span></p>
              </div>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Add Barangay Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-brand-ink">Add New Barangay</h3>
                <button
                  onClick={handleCancel}
                  className="text-brand-gray hover:text-brand-ink"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Barangay Name *</label>
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    placeholder="Enter barangay name"
                    className={`w-full bg-white border ${errors.name ? "border-brand-danger" : "border-brand-border"} rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue`}
                  />
                  {errors.name && <p className="text-xs text-brand-danger mt-1">{errors.name}</p>}
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Municipality *</label>
                  <input
                    type="text"
                    name="municipality"
                    value={formData.municipality}
                    onChange={handleInputChange}
                    placeholder="Enter municipality"
                    className={`w-full bg-white border ${errors.municipality ? "border-brand-danger" : "border-brand-border"} rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue`}
                  />
                  {errors.municipality && <p className="text-xs text-brand-danger mt-1">{errors.municipality}</p>}
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Province *</label>
                  <input
                    type="text"
                    name="province"
                    value={formData.province}
                    onChange={handleInputChange}
                    placeholder="Enter province"
                    className={`w-full bg-white border ${errors.province ? "border-brand-danger" : "border-brand-border"} rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue`}
                  />
                  {errors.province && <p className="text-xs text-brand-danger mt-1">{errors.province}</p>}
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Barangay Captain</label>
                  <input
                    type="text"
                    name="captain"
                    value={formData.captain}
                    onChange={handleInputChange}
                    placeholder="Enter barangay captain name"
                    className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Barangay Contact Number</label>
                  <input
                    type="text"
                    name="contact"
                    value={formData.contact}
                    onChange={handleInputChange}
                    placeholder="Enter contact number"
                    className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Barangay Health Station Name</label>
                  <input
                    type="text"
                    name="healthStation"
                    value={formData.healthStation}
                    onChange={handleInputChange}
                    placeholder="Enter health station name"
                    className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Assigned BHW</label>
                  <input
                    type="text"
                    name="bhw"
                    value={formData.bhw}
                    onChange={handleInputChange}
                    placeholder="Enter assigned BHW name"
                    className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Status</label>
                  <select
                    name="status"
                    value={formData.status}
                    onChange={handleInputChange}
                    className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={handleCancel}
                  className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveBarangay}
                  className="px-4 py-2 rounded-btn text-sm font-medium bg-brand-blue text-white hover:bg-brand-dark transition-colors"
                >
                  Save Barangay
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

/* ========================================================================== */
/* Health Supervisor — assigned-barangay Health Monitoring Summary            */
/* ========================================================================== */

const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : null);

/**
 * Community Monitoring for a barangay-assigned Health Supervisor.
 *
 * KALUSAGAP does not use maps: this view is a HEALTH monitoring summary plus a
 * community health risk overview for the supervisor's own barangay. All figures
 * come from the barangay-scoped backend endpoints (see `monitoringApi`); the
 * server resolves the scope from the session, so the numbers are always the
 * assigned barangay's real records and never another barangay's.
 */
function SupervisorBarangayView({ assignedBarangay }) {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(Boolean(assignedBarangay));
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    if (!assignedBarangay) return undefined;
    setLoading(true);
    setError(null);
    let cancelled = false;
    getBarangayHealthOverview(assignedBarangay)
      .then((data) => { if (!cancelled) setOverview(data); })
      .catch((err) => { if (!cancelled) setError(err?.message || "Unable to load community health data."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [assignedBarangay]);

  useEffect(() => load(), [load]);

  // Genuine "no assignment" — keep the existing empty state.
  if (!assignedBarangay) {
    return (
      <>
        <PageHeader crumbs={["Community Monitoring"]} title="My Barangay" subtitle="Your assigned barangay's health profile." />
        <Card className="p-10 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-yellow/15">
            <ShieldAlert className="h-7 w-7 text-[#B07E00]" />
          </div>
          <h3 className="mt-4 text-lg font-semibold text-brand-ink">No Assigned Barangay</h3>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-brand-gray">
            You currently have no barangay assigned to your account.
          </p>
          <p className="mx-auto mt-1 flex max-w-md items-center justify-center gap-1.5 text-sm text-brand-gray">
            <LifeBuoy className="h-4 w-4 shrink-0 text-brand-blue" />
            Contact your municipality administrator for assistance.
          </p>
        </Card>
      </>
    );
  }

  const header = (
    <PageHeader
      crumbs={["Community Monitoring"]}
      title="My Barangay"
      subtitle={`Brgy. ${assignedBarangay} — health profile and community health information for your assigned barangay.`}
      action={
        <div className="flex items-center gap-2 rounded-btn border border-brand-border bg-brand-light/40 px-3 py-2 text-sm font-medium text-brand-ink" title="Your account is assigned to this barangay">
          <MapPin className="w-4 h-4 text-brand-blue" /> Brgy. {assignedBarangay}
        </div>
      }
    />
  );

  if (loading) {
    return (
      <>
        {header}
        <SkeletonStatGrid count={4} />
        <div className="mt-6"><SkeletonStatGrid count={4} /></div>
      </>
    );
  }

  if (error) {
    return (
      <>
        {header}
        <Card className="p-4">
          <ErrorState title="Unable to load community health data" message={error} onRetry={load} />
        </Card>
      </>
    );
  }

  const m = overview?.metrics || {};
  const rr = m.residentRisk || { high: 0, moderate: 0, low: 0, assessed: 0 };
  const hr = m.householdRisk || { High: 0, Moderate: 0, Low: 0 };
  const highPct = pct(rr.high, rr.assessed);

  const summaryCards = [
    { icon: "Users", tone: "blue", label: "Registered Residents", value: m.totalResidents ?? 0 },
    { icon: "ShieldCheck", tone: "green", label: "Verified Residents", value: m.verifiedResidents ?? 0 },
    { icon: "Home", tone: "accent", label: "Households", value: m.totalHouseholds ?? 0 },
    { icon: "Stethoscope", tone: "blue", label: "Consultations This Month", value: m.consultationsThisMonth ?? 0 },
    { icon: "Baby", tone: "danger", label: "Maternal / M1 Cases", value: m.maternalCases ?? 0 },
    { icon: "Syringe", tone: "green", label: "Immunization Records", value: m.immunizationRecords ?? 0 },
    { icon: "CalendarClock", tone: "yellow", label: "Active Follow-ups", value: m.activeFollowUps ?? 0 },
    { icon: "Send", tone: "accent", label: "Referrals This Month", value: m.referralsThisMonth ?? 0 },
  ];

  const hasAnyRecord =
    (m.totalResidents ?? 0) > 0 ||
    (m.totalHouseholds ?? 0) > 0 ||
    (m.maternalCases ?? 0) > 0 ||
    (m.immunizationRecords ?? 0) > 0 ||
    (m.activeFollowUps ?? 0) > 0 ||
    (m.totalReferrals ?? 0) > 0;

  return (
    <>
      {header}

      {!hasAnyRecord ? (
        <Card className="p-10 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-bg">
            <HeartPulse className="h-7 w-7 text-brand-blue" />
          </div>
          <h3 className="mt-4 text-lg font-semibold text-brand-ink">No community health records yet</h3>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-brand-gray">
            No residents, households or health-service records have been recorded for Brgy. {assignedBarangay} yet.
            As data is captured, this summary updates automatically.
          </p>
        </Card>
      ) : (
        <>
          {/* Health Monitoring Summary */}
          <section aria-label="Health monitoring summary">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 sm:gap-5">
              {summaryCards.map((c, i) => (
                <StatCard key={c.label} icon={c.icon} label={c.label} value={c.value} tone={c.tone} index={i} />
              ))}
            </div>
          </section>

          {/* Community Health Risk Overview */}
          <section aria-label="Community health risk overview" className="mt-8">
            <h2 className="text-lg font-semibold text-brand-ink">Community Health Risk Overview</h2>
            <p className="mt-1 text-sm text-brand-gray">Health conditions and situations needing attention in Brgy. {assignedBarangay}.</p>

            <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-3">
              {/* High-risk residents */}
              <Card className="p-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-danger/10 text-brand-danger"><AlertTriangle className="h-5 w-5" /></div>
                  <div>
                    <h3 className="font-semibold text-brand-ink">High-Risk Residents</h3>
                    <p className="text-xs text-brand-gray">Based on latest recorded vitals</p>
                  </div>
                </div>
                <div className="mt-5 flex items-baseline gap-2">
                  <p className="text-3xl font-stat font-bold text-brand-ink">{rr.high}</p>
                  {highPct != null && <span className="text-sm font-medium text-brand-danger">{highPct}% of assessed</span>}
                </div>
                <div className="mt-4 space-y-2 text-sm">
                  <p className="flex items-center justify-between"><span className="text-brand-gray">Moderate risk</span><span className="font-medium text-brand-ink">{rr.moderate}</span></p>
                  <p className="flex items-center justify-between"><span className="text-brand-gray">Low risk</span><span className="font-medium text-brand-ink">{rr.low}</span></p>
                  <p className="flex items-center justify-between border-t border-brand-border pt-2"><span className="text-brand-gray">Residents assessed</span><span className="font-medium text-brand-ink">{rr.assessed}</span></p>
                </div>
                {rr.assessed === 0 && (
                  <p className="mt-3 text-xs text-brand-gray">No consultations with vitals have been recorded yet, so no risk levels can be computed.</p>
                )}
              </Card>

              {/* Follow-up alerts */}
              <Card className="p-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-yellow/15 text-[#B07E00]"><CalendarClock className="h-5 w-5" /></div>
                  <div>
                    <h3 className="font-semibold text-brand-ink">Follow-up Alerts</h3>
                    <p className="text-xs text-brand-gray">Scheduling that needs attention</p>
                  </div>
                </div>
                <div className="mt-5 space-y-2.5 text-sm">
                  <p className="flex items-center justify-between"><span className="flex items-center gap-2 text-brand-gray"><AlertTriangle className="h-4 w-4 text-brand-danger" /> Overdue follow-ups</span><span className="font-medium text-brand-danger">{m.overdueFollowUps ?? 0}</span></p>
                  <p className="flex items-center justify-between"><span className="flex items-center gap-2 text-brand-gray"><CalendarClock className="h-4 w-4 text-brand-blue" /> Upcoming follow-ups</span><span className="font-medium text-brand-ink">{m.upcomingFollowUps ?? 0}</span></p>
                  <p className="flex items-center justify-between"><span className="flex items-center gap-2 text-brand-gray"><Send className="h-4 w-4 text-brand-accent" /> Pending referrals</span><span className="font-medium text-brand-ink">{m.pendingReferrals ?? 0}</span></p>
                </div>
                {(m.overdueFollowUps ?? 0) === 0 && (m.upcomingFollowUps ?? 0) === 0 && (m.pendingReferrals ?? 0) === 0 && (
                  <p className="mt-3 text-xs text-brand-gray">No overdue or upcoming follow-ups and no pending referrals.</p>
                )}
              </Card>

              {/* Health trend / household risk */}
              <Card className="p-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-blue/10 text-brand-blue"><Activity className="h-5 w-5" /></div>
                  <div>
                    <h3 className="font-semibold text-brand-ink">Health Trend Alerts</h3>
                    <p className="text-xs text-brand-gray">From recorded service data</p>
                  </div>
                </div>
                <div className="mt-5 space-y-2.5 text-sm">
                  <div className="rounded-btn bg-brand-bg px-3.5 py-2.5">
                    <p className="text-[11px] uppercase tracking-wide text-brand-gray">Most reported condition</p>
                    <p className="mt-0.5 font-medium text-brand-ink">
                      {m.topCondition && m.topConditionCases > 0 ? `${m.topCondition} · ${m.topConditionCases} case${m.topConditionCases === 1 ? "" : "s"}` : "Not enough data"}
                    </p>
                  </div>
                  <p className="flex items-center justify-between"><span className="flex items-center gap-2 text-brand-gray"><Home className="h-4 w-4" /> High-risk households</span><span className="font-medium text-brand-danger">{hr.High}</span></p>
                  <p className="flex items-center justify-between"><span className="flex items-center gap-2 text-brand-gray"><Home className="h-4 w-4" /> Moderate-risk households</span><span className="font-medium text-brand-ink">{hr.Moderate}</span></p>
                  <p className="flex items-center justify-between"><span className="flex items-center gap-2 text-brand-gray"><ClipboardCheck className="h-4 w-4" /> Active maternal cases</span><span className="font-medium text-brand-ink">{m.activeMaternalCases ?? 0}</span></p>
                </div>
              </Card>
            </div>
          </section>
        </>
      )}
    </>
  );
}
