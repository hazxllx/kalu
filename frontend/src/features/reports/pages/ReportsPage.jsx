import React, { useEffect, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { TrendingUp, Download, Send, Check, CheckCircle2, X } from "lucide-react";
import { phnMonthlyTrend } from "@/services/mock/mockPhnData";
import {
  filterRowsByScope,
  getPHNScope,
  normalizeBarangay,
  phnDefaultBarangay,
  phnWritableBarangays,
  scopeLabel,
} from "@/lib/phnScope";
import { useAuth } from "@/context/AuthContext";
import { monthlyConsultations } from "@/services/mock/mockData";
import { ResponsiveContainer, BarChart, Bar, XAxis, Tooltip, CartesianGrid, Legend } from "recharts";

const summaryCards = [
  { label: "Total Prenatal Patients", value: "48" },
  { label: "Active Follow-ups", value: "23" },
  { label: "Completed Follow-ups", value: "86" },
  { label: "Referrals Submitted", value: "9" },
  { label: "Monthly Consultations", value: "312" },
  { label: "High-risk Pregnancies", value: "12" },
];

const REPORTS = [
  { id: 1, name: "Monthly Maternal Report", type: "Monthly Maternal Report", period: "June 2026", status: "Submitted to RHU", date: "July 1, 2026", submittedDate: "July 1, 2026", submittedTime: "9:30 AM", barangay: "San Isidro" },
  { id: 2, name: "Follow-up Report", type: "Follow-up Report", period: "July 2026", status: "Generated", date: "July 10, 2026", barangay: "San Antonio" },
  { id: 3, name: "Referral Report", type: "Referral Report", period: "June 2026", status: "Draft", date: "June 28, 2026", barangay: "Old San Roque" },
  { id: 4, name: "Immunization Report", type: "Immunization Report", period: "June 2026", status: "Submitted to RHU", date: "June 25, 2026", submittedDate: "June 25, 2026", submittedTime: "2:15 PM", barangay: "San Isidro" },
];

// PHN reports. `barangay: null` means an RHU-level report (no barangay scope);
// the rest belong to a specific barangay and are scope-filtered below.
const PHN_REPORTS = [
  { id: 101, name: "RHU Health Records Summary", type: "Health Records", period: "August 2026", status: "Submitted to RHU", date: "September 1, 2026", submittedDate: "September 1, 2026", submittedTime: "8:45 AM", barangay: null },
  { id: 102, name: "RHU Referrals Report", type: "Referrals", period: "August 2026", status: "Generated", date: "September 3, 2026", barangay: null },
  { id: 103, name: "San Isidro Health Records", type: "Health Records", period: "August 2026", status: "Generated", date: "September 2, 2026", barangay: "San Isidro" },
  { id: 104, name: "San Isidro Referrals", type: "Referrals", period: "August 2026", status: "Generated", date: "September 4, 2026", barangay: "San Isidro" },
  { id: 105, name: "San Isidro Follow-ups", type: "Follow-ups", period: "August 2026", status: "Submitted to RHU", date: "September 2, 2026", submittedDate: "September 2, 2026", submittedTime: "10:15 AM", barangay: "San Isidro" },
  { id: 106, name: "San Antonio Follow-ups", type: "Follow-ups", period: "August 2026", status: "Generated", date: "September 5, 2026", barangay: "San Antonio" },
  { id: 107, name: "Old San Roque Health Services", type: "Health Services", period: "August 2026", status: "Draft", date: "September 5, 2026", barangay: "Old San Roque" },
];

const STATUS_COLORS = {
  Draft: "bg-brand-gray/10 text-brand-gray",
  Generated: "bg-brand-blue/10 text-brand-blue",
  "Submitted to RHU": "bg-brand-green/10 text-brand-green",
};

const REPORT_TYPE_LABELS = ["Health Records", "Referrals", "Follow-ups", "Health Services", "Community Health Trends"];

// RHU-level summary placeholders used for the unassigned PHN; counts shown are
// scope-neutral RHU aggregates (no barangay-specific figures are revealed).
const summaryCardsForScope = [
  { label: "RHU Consultations (Month)", value: "92" },
  { label: "RHU Referrals", value: "4" },
  { label: "RHU Follow-ups Due", value: "7" },
  { label: "RHU Health Services Today", value: "2" },
];

export default function ReportsPage({ roleKey = "midwife" }) {
  const { user } = useAuth();
  const isPhn = roleKey === "phn";
  const scope = getPHNScope(user);
  const assigned = scope && scope.level === "barangay" ? scope.assignedBarangay : null;

  const reportTypes = isPhn
    ? REPORT_TYPE_LABELS
    : ["Monthly Maternal Report", "Follow-up Report", "Referral Report", "Immunization Report"];

  // Seed only the reports this PHN is allowed to see.
  const [reports, setReports] = useState(() => (isPhn ? filterRowsByScope(PHN_REPORTS, user) : REPORTS));
  const [selectedReportType, setSelectedReportType] = useState("All");
  const [barangayFilter, setBarangayFilter] = useState("All");
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [reportToSubmit, setReportToSubmit] = useState(null);
  const [formErrors, setFormErrors] = useState({});
  const [toast, setToast] = useState(null);
  const [reportForm, setReportForm] = useState(() => ({
    reportType: "",
    period: "",
    barangay: phnDefaultBarangay(user),
  }));

  const writableBarangays = phnWritableBarangays(user);
  const filterBarangayOptions = isPhn
    ? assigned
      ? ["All", "RHU", assigned]
      : ["All"]
    : ["All"];

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  const anyModalOpen = showGenerateModal || showSubmitConfirm;

  useEffect(() => {
    if (!anyModalOpen) return undefined;
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      setShowGenerateModal(false);
      setShowSubmitConfirm(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [anyModalOpen]);

  const filteredReports = reports.filter((r) => {
    const matchesType = selectedReportType === "All" || r.type === selectedReportType;
    if (!isPhn) return matchesType;
    const scopeOfRow = scopeLabel(r, user);
    const matchesBarangay =
      barangayFilter === "All" ||
      (barangayFilter === "RHU" ? scopeOfRow === "RHU" : scopeOfRow === barangayFilter);
    return matchesType && matchesBarangay;
  });

  const handleGenerateReport = () => {
    const errors = {};
    if (!reportForm.reportType) errors.reportType = "Report type is required.";
    if (!reportForm.period) errors.period = "Reporting period is required.";
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const newReport = {
      id: reports.reduce((acc, r) => Math.max(acc, r.id || 0), 0) + 1,
      name: isPhn && normalizeBarangay(reportForm.barangay) ? `${reportForm.reportType} (${scopeLabel({ barangay: reportForm.barangay }, user)})` : `${reportForm.reportType} Report`,
      type: reportForm.reportType,
      period: reportForm.period,
      status: "Generated",
      date: new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
      barangay: isPhn ? normalizeBarangay(reportForm.barangay) : "San Isidro",
    };
    setReports([newReport, ...reports]);
    setShowGenerateModal(false);
    setReportForm({ reportType: "", period: "", barangay: phnDefaultBarangay(user) });
    showToast("Report generated successfully.");
  };

  const handleSubmitToRHU = (report) => {
    setReportToSubmit(report);
    setShowSubmitConfirm(true);
  };

  const confirmSubmit = () => {
    const now = new Date();
    setReports((prev) =>
      prev.map((r) => (r.id === reportToSubmit.id ? {
        ...r,
        status: "Submitted to RHU",
        submittedDate: now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
        submittedTime: now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
      } : r))
    );
    setShowSubmitConfirm(false);
    setReportToSubmit(null);
    showToast("Report submitted successfully.");
  };

  // Chart shows only the series this PHN may see (rhu + assigned barangay).
  const trendData = isPhn ? phnMonthlyTrend : monthlyConsultations;
  const chartSeries = isPhn
    ? ["rhu"].concat(assigned ? [assigned] : [])
    : [];
  const seriesConfig = {
    rhu: { fill: "#0B5CAD" },
    "San Isidro": { fill: "#2A7DE1" },
    "San Antonio": { fill: "#F5B400" },
    "Old San Roque": { fill: "#E67E22" },
  };

  // A PHN works at the RHU — reports are submitted upward to the MHO, while
  // barangay-level roles submit theirs to the RHU.
  const submitTarget = isPhn ? "MHO" : "RHU";
  const displayStatus = (report) =>
    isPhn && report.status === "Submitted to RHU" ? "Submitted to MHO" : report.status;

  return (
    <>
      <PageHeader
        crumbs={["Home", "Reports"]}
        title="Reports"
        subtitle={
          isPhn
            ? assigned
              ? `Generate and review reports for ${assigned} and the RHU.`
              : "Generate and review RHU-level reports."
            : "Generate and submit monthly health reports to the RHU."
        }
      />

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 bg-brand-ink text-white px-4 py-3 rounded-btn shadow-lg flex items-center gap-2 z-50 animate-in slide-in-from-bottom-2">
          <CheckCircle2 className="w-4 h-4 text-brand-green" />
          <span className="text-sm">{toast}</span>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-5 mb-6">
        <Card className="p-6 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-brand-ink">{isPhn ? "Active Health Cases by Barangay" : "Monthly Consultations"}</h3>
            <span className="flex items-center gap-1 text-sm text-brand-green"><TrendingUp className="w-4 h-4" /> {isPhn ? "+6%" : "+17%"}</span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            {isPhn ? (
              <BarChart data={trendData}>
                <CartesianGrid vertical={false} stroke="#E5EAF1" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#5B6472", fontSize: 12 }} />
                <Tooltip cursor={{ fill: "#EDF6FF" }} contentStyle={{ borderRadius: 12, border: "1px solid #E5EAF1" }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {chartSeries.map((key, i) => (
                  <Bar
                    key={key}
                    dataKey={key}
                    name={key === "rhu" ? "RHU" : key}
                    stackId="a"
                    fill={seriesConfig[key]?.fill || (i % 2 ? "#2A7DE1" : "#F5B400")}
                    radius={i === chartSeries.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                    maxBarSize={40}
                  />
                ))}
              </BarChart>
            ) : (
              <BarChart data={trendData}>
                <CartesianGrid vertical={false} stroke="#E5EAF1" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#5B6472", fontSize: 12 }} />
                <Tooltip cursor={{ fill: "#EDF6FF" }} contentStyle={{ borderRadius: 12, border: "1px solid #E5EAF1" }} />
                <Bar dataKey="value" fill="#0B5CAD" radius={[6, 6, 0, 0]} maxBarSize={40} />
              </BarChart>
            )}
          </ResponsiveContainer>
        </Card>
        <Card className="p-6 h-fit">
          <h3 className="font-semibold text-brand-ink mb-4">Report Summary</h3>
          {(isPhn ? summaryCardsForScope : summaryCards).map((s) => (
            <div key={s.label} className="flex justify-between py-3 border-b border-brand-border last:border-0">
              <span className="text-sm text-brand-gray">{s.label}</span>
              <span className="font-stat font-bold text-brand-ink">{s.value}</span>
            </div>
          ))}
          {isPhn && (
            <p className="text-xs text-brand-gray mt-3">
              {assigned ? `Scope: ${assigned} + RHU` : "Scope: RHU"}
            </p>
          )}
        </Card>
      </div>

      {/* Reports Table */}
      <Card className="p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 sm:mb-6 gap-4">
          <h3 className="font-semibold text-brand-ink text-base sm:text-base">Generated Reports</h3>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 w-full sm:w-auto">
            <select
              value={selectedReportType}
              onChange={(e) => setSelectedReportType(e.target.value)}
              className="w-full sm:w-auto bg-white border border-brand-border rounded-btn px-3 py-2 text-sm outline-none"
            >
              <option value="All">All Types</option>
              {reportTypes.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            {isPhn && (
              <select
                value={barangayFilter}
                onChange={(e) => setBarangayFilter(e.target.value)}
                className="w-full sm:w-auto bg-white border border-brand-border rounded-btn px-3 py-2 text-sm outline-none"
              >
                {filterBarangayOptions.map((b) => (
                  <option key={b} value={b}>{b === "All" ? "All Scopes" : b}</option>
                ))}
              </select>
            )}
            <button
              onClick={() => {
                setFormErrors({});
                setShowGenerateModal(true);
              }}
              className="w-full sm:w-auto flex items-center justify-center gap-2 bg-brand-blue text-white px-4 py-2 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors"
            >
              <Download className="w-4 h-4" /> Generate Report
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-brand-bg border-b border-brand-border">
              <tr>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Report Name</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Type</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Period</th>
                {isPhn && <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Barangay</th>}
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Date Generated</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Status</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredReports.map((report) => (
                <tr key={report.id} className="border-b border-brand-border hover:bg-brand-bg/50 transition-colors">
                  <td className="px-4 py-3 text-sm font-medium text-brand-ink">{report.name}</td>
                  <td className="px-4 py-3 text-sm text-brand-gray">{report.type}</td>
                  <td className="px-4 py-3 text-sm text-brand-gray">{report.period}</td>
                  {isPhn && <td className="px-4 py-3 text-sm text-brand-gray">{scopeLabel(report, user)}</td>}
                  <td className="px-4 py-3 text-sm text-brand-gray">{report.date}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[report.status]}`}>
                      {displayStatus(report)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      {report.status === "Generated" && (
                        <button
                          onClick={() => handleSubmitToRHU(report)}
                          className="flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline"
                        >
                          <Send className="w-4 h-4" /> Submit to {submitTarget}
                        </button>
                      )}
                      {report.status === "Submitted to RHU" && (
                        <div className="text-xs text-brand-gray">
                          <span className="flex items-center gap-1 text-brand-green">
                            <Check className="w-3 h-3" /> Submitted
                          </span>
                          <div className="mt-1">{report.submittedDate} • {report.submittedTime}</div>
                        </div>
                      )}
                      {report.status === "Draft" && (
                        <button
                          onClick={() => handleSubmitToRHU({ ...report, status: "Generated" })}
                          className="flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline"
                        >
                          <Send className="w-4 h-4" /> Finalize & Submit
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredReports.length === 0 && (
                <tr>
                  <td colSpan={isPhn ? 7 : 6} className="px-4 py-10 text-center text-sm text-brand-gray">
                    No reports match the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Generate Report Modal */}
      {showGenerateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-brand-ink">Generate Report</h3>
                <button
                  onClick={() => setShowGenerateModal(false)}
                  className="text-brand-gray hover:text-brand-ink"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Report Type <span className="text-brand-danger">*</span></label>
                  <select
                    value={reportForm.reportType}
                    onChange={(e) => {
                      setReportForm({ ...reportForm, reportType: e.target.value });
                      if (formErrors.reportType) setFormErrors((prev) => ({ ...prev, reportType: "" }));
                    }}
                    className={`w-full bg-white border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue ${
                      formErrors.reportType ? "border-brand-danger" : "border-brand-border"
                    }`}
                  >
                    <option value="">Select report type...</option>
                    {reportTypes.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  {formErrors.reportType && <p className="text-xs text-brand-danger mt-1">{formErrors.reportType}</p>}
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Reporting Period <span className="text-brand-danger">*</span></label>
                  <input
                    type="month"
                    value={reportForm.period}
                    onChange={(e) => {
                      setReportForm({ ...reportForm, period: e.target.value });
                      if (formErrors.period) setFormErrors((prev) => ({ ...prev, period: "" }));
                    }}
                    className={`w-full bg-white border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue ${
                      formErrors.period ? "border-brand-danger" : "border-brand-border"
                    }`}
                  />
                  {formErrors.period && <p className="text-xs text-brand-danger mt-1">{formErrors.period}</p>}
                </div>
                {isPhn && (
                  <div>
                    <label className="text-sm font-medium text-brand-ink block mb-1.5">Scope <span className="text-brand-danger">*</span></label>
                    <select
                      value={reportForm.barangay}
                      onChange={(e) => setReportForm({ ...reportForm, barangay: e.target.value })}
                      className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
                    >
                      {writableBarangays.map((b) => (
                        <option key={b} value={b}>{b === "RHU" ? "RHU (no barangay)" : b}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => {
                    setShowGenerateModal(false);
                    setReportForm({ reportType: "", period: "", barangay: phnDefaultBarangay(user) });
                    setFormErrors({});
                  }}
                  className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleGenerateReport}
                  className="px-4 py-2 rounded-btn text-sm font-medium bg-brand-blue text-white hover:bg-brand-dark transition-colors"
                >
                  Generate Report
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Submit Confirmation Modal */}
      {showSubmitConfirm && reportToSubmit && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-brand-ink mb-4">Submit Report to {submitTarget}</h3>
              <p className="text-sm text-brand-gray mb-6">
                Are you sure you want to submit <span className="font-medium text-brand-ink">{reportToSubmit.name}</span> to the {submitTarget}? This action cannot be undone.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowSubmitConfirm(false)}
                  className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmSubmit}
                  className="px-4 py-2 rounded-btn text-sm font-medium bg-brand-blue text-white hover:bg-brand-dark transition-colors"
                >
                  Submit
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
