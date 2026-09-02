import React, { useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { TrendingUp, Download, Send, Check } from "lucide-react";
import { monthlyConsultations } from "@/services/mock/mockData";
import { ResponsiveContainer, BarChart, Bar, XAxis, Tooltip, CartesianGrid } from "recharts";

const summaryCards = [
  { label: "Total Prenatal Patients", value: "48" },
  { label: "Active Follow-ups", value: "23" },
  { label: "Completed Follow-ups", value: "86" },
  { label: "Referrals Submitted", value: "9" },
  { label: "Monthly Consultations", value: "312" },
  { label: "High-risk Pregnancies", value: "12" },
];

const REPORTS = [
  { id: 1, name: "Monthly Maternal Report", type: "Monthly Maternal Report", period: "June 2026", status: "Submitted to RHU", date: "July 1, 2026", submittedDate: "July 1, 2026", submittedTime: "9:30 AM" },
  { id: 2, name: "Follow-up Report", type: "Follow-up Report", period: "July 2026", status: "Generated", date: "July 10, 2026" },
  { id: 3, name: "Referral Report", type: "Referral Report", period: "June 2026", status: "Draft", date: "June 28, 2026" },
  { id: 4, name: "Immunization Report", type: "Immunization Report", period: "June 2026", status: "Submitted to RHU", date: "June 25, 2026", submittedDate: "June 25, 2026", submittedTime: "2:15 PM" },
];

const STATUS_COLORS = {
  Draft: "bg-brand-gray/10 text-brand-gray",
  Generated: "bg-brand-blue/10 text-brand-blue",
  "Submitted to RHU": "bg-brand-green/10 text-brand-green",
};

export default function ReportsPage({ roleKey = "midwife" }) {
  const [reports, setReports] = useState(REPORTS);
  const [selectedReportType, setSelectedReportType] = useState("All");
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [reportToSubmit, setReportToSubmit] = useState(null);
  const [reportForm, setReportForm] = useState({
    reportType: "",
    period: "",
    barangay: "Brgy. San Jose",
  });

  const filteredReports = reports.filter((r) =>
    selectedReportType === "All" || r.type === selectedReportType
  );

  const handleGenerateReport = () => {
    if (!reportForm.reportType || !reportForm.period) {
      alert("Please fill in all required fields.");
      return;
    }
    const newReport = {
      id: reports.length + 1,
      name: `${reportForm.reportType}`,
      type: reportForm.reportType,
      period: reportForm.period,
      status: "Generated",
      date: new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
    };
    setReports([newReport, ...reports]);
    setShowGenerateModal(false);
    setReportForm({ reportType: "", period: "", barangay: "Brgy. San Jose" });
    alert(`${reportForm.reportType} generated successfully!`);
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
    alert("Report submitted to RHU successfully!");
  };

  return (
    <>
      <PageHeader
        crumbs={["Home", "Reports"]}
        title="Reports"
        subtitle="Generate and submit monthly health reports to the RHU."
      />

      <div className="grid lg:grid-cols-3 gap-5 mb-6">
        <Card className="p-6 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-brand-ink">Monthly Consultations</h3>
            <span className="flex items-center gap-1 text-sm text-brand-green"><TrendingUp className="w-4 h-4" /> +17%</span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={monthlyConsultations}>
              <CartesianGrid vertical={false} stroke="#E5EAF1" />
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#5B6472", fontSize: 12 }} />
              <Tooltip cursor={{ fill: "#EDF6FF" }} contentStyle={{ borderRadius: 12, border: "1px solid #E5EAF1" }} />
              <Bar dataKey="value" fill="#0B5CAD" radius={[6, 6, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card className="p-6 h-fit">
          <h3 className="font-semibold text-brand-ink mb-4">Report Summary</h3>
          {summaryCards.map((s) => (
            <div key={s.label} className="flex justify-between py-3 border-b border-brand-border last:border-0">
              <span className="text-sm text-brand-gray">{s.label}</span>
              <span className="font-stat font-bold text-brand-ink">{s.value}</span>
            </div>
          ))}
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
              <option value="Monthly Maternal Report">Monthly Maternal Report</option>
              <option value="Follow-up Report">Follow-up Report</option>
              <option value="Referral Report">Referral Report</option>
              <option value="Immunization Report">Immunization Report</option>
            </select>
            <button
              onClick={() => setShowGenerateModal(true)}
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
                  <td className="px-4 py-3 text-sm text-brand-gray">{report.date}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[report.status]}`}>
                      {report.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      {report.status === "Generated" && (
                        <button
                          onClick={() => handleSubmitToRHU(report)}
                          className="flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline"
                        >
                          <Send className="w-4 h-4" /> Submit to RHU
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
                        <span className="text-xs text-brand-gray">Edit</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Generate Report Modal */}
      {showGenerateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-brand-ink mb-4">Generate Report</h3>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Report Type</label>
                  <select
                    value={reportForm.reportType}
                    onChange={(e) => setReportForm({ ...reportForm, reportType: e.target.value })}
                    className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
                  >
                    <option value="">Select report type...</option>
                    <option value="Monthly Maternal Report">Monthly Maternal Report</option>
                    <option value="Follow-up Report">Follow-up Report</option>
                    <option value="Referral Report">Referral Report</option>
                    <option value="Immunization Report">Immunization Report</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Reporting Period</label>
                  <input
                    type="month"
                    value={reportForm.period}
                    onChange={(e) => setReportForm({ ...reportForm, period: e.target.value })}
                    className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Barangay</label>
                  <input
                    type="text"
                    value={reportForm.barangay}
                    disabled
                    className="w-full bg-brand-bg border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none text-brand-gray"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => {
                    setShowGenerateModal(false);
                    setReportForm({ reportType: "", period: "", barangay: "Brgy. San Jose" });
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
              <h3 className="text-lg font-semibold text-brand-ink mb-4">Submit Report to RHU</h3>
              <p className="text-sm text-brand-gray mb-6">
                Are you sure you want to submit <span className="font-medium text-brand-ink">{reportToSubmit.name}</span> to the RHU? This action cannot be undone.
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