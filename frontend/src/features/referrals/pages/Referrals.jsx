import React, { useEffect, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import StatusBadge from "@/components/common/StatusBadge";
import ResidentSearchSelect from "@/components/common/ResidentSearchSelect";
import { residents } from "@/services/mock/mockData";
import { phnReferrals, phnResidents, REFERRAL_STATUSES } from "@/services/mock/mockPhnData";
import {
  filterRowsByScope,
  phnFilterOptions,
  rowMatchesOption,
  scopeLabel,
} from "@/lib/phnScope";
import { ROLES } from "@/lib/brand";
import { useAuth } from "@/context/AuthContext";
import { Plus, Eye, Edit2, RefreshCw, X, Search, Check, CheckCircle2, Download, Trash2 } from "lucide-react";

const REFERRALS = [
  {
    id: 1,
    referralNo: "RH-2026-000001",
    resident: "Ana Villanueva",
    age: 32,
    sex: "Female",
    barangay: "San Isidro",
    date: "July 10, 2026",
    reason: "High-risk Pregnancy",
    facility: "RHU Pili",
    priority: "High",
    status: "Pending",
    notes: "Requires specialized maternal care due to elevated blood pressure.",
  },
  {
    id: 2,
    referralNo: "RH-2026-000002",
    resident: "Maria Santos",
    age: 28,
    sex: "Female",
    barangay: "San Antonio",
    date: "July 8, 2026",
    reason: "Abnormal Ultrasound Findings",
    facility: "Bicol Medical Center",
    priority: "High",
    status: "Accepted",
    notes: "Ultrasound showed placenta previa. Referral for specialist evaluation.",
  },
  {
    id: 3,
    referralNo: "RH-2026-000003",
    resident: "Grace Aquino",
    age: 24,
    sex: "Female",
    barangay: "Old San Roque",
    date: "July 5, 2026",
    reason: "Postpartum Follow-up",
    facility: "RHU Pili",
    priority: "Medium",
    status: "Completed",
    notes: "Post-delivery monitoring completed. Mother and baby in good condition.",
  },
];

const emptyReferralForm = () => ({
  date: new Date().toISOString().slice(0, 10),
  facility: "RHU Pili",
  reason: "",
  priority: "High",
  notes: "",
});

const PRIORITY_COLORS = {
  High: "bg-brand-danger/10 text-brand-danger",
  Medium: "bg-brand-yellow/15 text-[#B07E00]",
  Low: "bg-brand-green/10 text-brand-green",
};

export default function Referrals({ roleKey } = {}) {
  const { user } = useAuth();
  const isPhn = roleKey === "phn";

  const statusOptions = isPhn
    ? REFERRAL_STATUSES
    : ["For Review", "Pending", "Accepted", "Follow-up Required", "Completed", "Cancelled"];

  // PHN scope: seed only the referrals the signed-in PHN may see (RHU-level
  // plus, if assigned, their own barangay). Other roles keep their dataset.
  const [referrals, setReferrals] = useState(() =>
    isPhn ? filterRowsByScope(phnReferrals, user) : REFERRALS
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [priorityFilter, setPriorityFilter] = useState("All");
  const [barangayFilter, setBarangayFilter] = useState("All");
  const [showNewReferralModal, setShowNewReferralModal] = useState(false);
  const [showViewDetailsModal, setShowViewDetailsModal] = useState(false);
  const [showEditReferralModal, setShowEditReferralModal] = useState(false);
  const [showUpdateStatusModal, setShowUpdateStatusModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [selectedReferral, setSelectedReferral] = useState(null);
  const [toast, setToast] = useState(null);
  const [newStatus, setNewStatus] = useState("");
  const [selectedResident, setSelectedResident] = useState(null);
  const [newReferralForm, setNewReferralForm] = useState(emptyReferralForm);
  const [submittedReferral, setSubmittedReferral] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [formErrors, setFormErrors] = useState({});
  const [residentPool] = useState(
    isPhn ? filterRowsByScope(phnResidents, user) : residents
  );

  const filterOptions = phnFilterOptions(user);

  const filteredReferrals = referrals.filter((r) => {
    const matchesSearch = searchQuery === "" || r.resident.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "All" || r.status === statusFilter;
    const matchesPriority = priorityFilter === "All" || r.priority === priorityFilter;
    const matchesBarangay = rowMatchesOption(r, barangayFilter, user);
    return matchesSearch && matchesStatus && matchesPriority && matchesBarangay;
  });

  const anyModalOpen =
    showNewReferralModal ||
    showViewDetailsModal ||
    showEditReferralModal ||
    showUpdateStatusModal ||
    showDeleteConfirm ||
    Boolean(submittedReferral);

  useEffect(() => {
    if (!anyModalOpen) return undefined;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [anyModalOpen]);

  useEffect(() => {
    if (!anyModalOpen) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      setShowNewReferralModal(false);
      setShowViewDetailsModal(false);
      setShowEditReferralModal(false);
      setShowUpdateStatusModal(false);
      setShowDeleteConfirm(false);
      setSubmittedReferral(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [anyModalOpen]);

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  const handleViewDetails = (referral) => {
    setSelectedReferral(referral);
    setShowViewDetailsModal(true);
  };

  const handleEditReferral = (referral) => {
    setSelectedReferral(referral);
    setEditForm({
      reason: referral.reason || "",
      facility: referral.facility || "RHU Pili",
      priority: referral.priority || "High",
      notes: referral.notes || "",
    });
    setFormErrors({});
    setShowEditReferralModal(true);
  };

  const handleUpdateStatus = (referral) => {
    setSelectedReferral(referral);
    setNewStatus(referral.status);
    setShowUpdateStatusModal(true);
  };

  const handleStatusUpdate = () => {
    setReferrals((prev) =>
      prev.map((r) => (r.id === selectedReferral.id ? { ...r, status: newStatus } : r))
    );
    setShowUpdateStatusModal(false);
    setSelectedReferral(null);
    setNewStatus("");
    showToast("Referral updated successfully.");
  };

  const handleDeleteRequest = (referral) => {
    setSelectedReferral(referral);
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = () => {
    setReferrals((prev) => prev.filter((r) => r.id !== selectedReferral.id));
    setShowDeleteConfirm(false);
    setSelectedReferral(null);
    showToast("Referral deleted successfully.");
  };

  const validateNewReferral = () => {
    const errors = {};
    if (!selectedResident) errors.resident = "Please select a resident.";
    if (!newReferralForm.reason.trim()) errors.reason = "Referral reason is required.";
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSaveReferral = () => {
    if (!validateNewReferral()) return;

    const now = new Date();
    const seq =
      referrals.reduce((acc, r) => {
        const match = /(\d+)\s*$/.exec(String(r.referralNo || ""));
        return match ? Math.max(acc, parseInt(match[1], 10)) : acc;
      }, 0) + 1;
    const newReferral = {
      id: referrals.reduce((acc, r) => Math.max(acc, r.id || 0), 0) + 1,
      referralNo: `RH-${now.getFullYear()}-${String(seq).padStart(6, "0")}`,
      resident: selectedResident ? selectedResident.name : "",
      residentId: selectedResident ? selectedResident.id : undefined,
      age: selectedResident ? selectedResident.age : undefined,
      sex: selectedResident ? selectedResident.gender : undefined,
      barangay: selectedResident ? selectedResident.barangay : undefined,
      date: newReferralForm.date
        ? new Date(newReferralForm.date).toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })
        : "",
      createdAt: now.toISOString(),
      facility: newReferralForm.facility,
      reason: newReferralForm.reason.trim(),
      priority: newReferralForm.priority,
      notes: newReferralForm.notes,
      referringPersonnel: user ? user.name : "",
      referringPersonnelRole:
        user && user.role && ROLES[user.role] ? ROLES[user.role].label : user ? user.role : "",
      status: "Pending",
    };
    setReferrals([newReferral, ...referrals]);
    setShowNewReferralModal(false);
    setSelectedResident(null);
    setSubmittedReferral(newReferral);
    showToast("Referral added successfully.");
  };

  const handleDownloadPdf = async (referral) => {
    try {
      const { downloadReferralPdf } = await import("../lib/referralPdf");
      await downloadReferralPdf(referral, { residents: residentPool });
      showToast("Referral PDF downloaded.");
    } catch {
      showToast("Could not generate the referral PDF.");
    }
  };

  const handleSaveEditReferral = () => {
    if (!editForm.reason.trim()) {
      setFormErrors({ reason: "Referral reason is required." });
      return;
    }
    setReferrals((prev) =>
      prev.map((r) => (r.id === selectedReferral.id ? { ...r, ...editForm, reason: editForm.reason.trim() } : r))
    );
    setShowEditReferralModal(false);
    setSelectedReferral(null);
    showToast("Referral updated successfully.");
  };

  return (
    <>
      <PageHeader
        crumbs={["Home", "Referrals"]}
        title={isPhn ? "Referral Coordination" : "Referrals"}
        subtitle={
          isPhn
            ? "Review, validate, and coordinate referrals from San Isidro, San Antonio and Old San Roque."
            : "Manage resident referrals to RHU and higher-level healthcare facilities."
        }
        action={
          <button
            onClick={() => {
              setSelectedResident(null);
              setNewReferralForm(emptyReferralForm());
              setFormErrors({});
              setShowNewReferralModal(true);
            }}
            className="flex items-center gap-2 bg-brand-blue text-white px-4 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors"
          >
            <Plus className="w-4 h-4" /> New Referral
          </button>
        }
      />

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-4 right-4 bg-brand-ink text-white px-4 py-3 rounded-btn shadow-lg flex items-center gap-2 z-50 animate-in slide-in-from-bottom-2">
          <Check className="w-4 h-4 text-brand-green" />
          <span className="text-sm">{toast}</span>
        </div>
      )}

      {/* Filters */}
      <Card className="p-4 mb-5">
        <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
          <div className="flex items-center gap-2 bg-brand-bg border border-brand-border rounded-btn px-3 py-2 flex-1 max-w-md">
            <Search className="w-4 h-4 text-brand-gray" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search resident..."
              className="bg-transparent text-sm outline-none w-full placeholder:text-brand-gray/70"
            />
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={barangayFilter}
              onChange={(e) => setBarangayFilter(e.target.value)}
              className="bg-white border border-brand-border rounded-btn px-3 py-2 text-sm outline-none"
            >
              {filterOptions.map((b) => (
                <option key={b} value={b}>{b === "All" ? "All Barangays" : b}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-white border border-brand-border rounded-btn px-3 py-2 text-sm outline-none"
            >
              <option value="All">All Statuses</option>
              {statusOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className="bg-white border border-brand-border rounded-btn px-3 py-2 text-sm outline-none"
            >
              <option value="All">All Priorities</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Referral Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-brand-bg border-b border-brand-border">
              <tr>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Resident Name</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Age</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Barangay</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Referral Date</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Referral Reason</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Receiving Facility</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Priority</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Status</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredReferrals.map((r) => (
                <tr key={r.id} className="border-b border-brand-border hover:bg-brand-bg/50 transition-colors">
                  <td className="px-4 py-3 text-sm font-medium text-brand-ink">{r.resident}</td>
                  <td className="px-4 py-3 text-sm text-brand-ink">{r.age}</td>
                  <td className="px-4 py-3 text-sm text-brand-ink">{isPhn ? scopeLabel(r, user) : r.barangay}</td>
                  <td className="px-4 py-3 text-sm text-brand-ink">{r.date}</td>
                  <td className="px-4 py-3 text-sm text-brand-ink">{r.reason}</td>
                  <td className="px-4 py-3 text-sm text-brand-ink">{r.facility}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${PRIORITY_COLORS[r.priority]}`}>
                      {r.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge value={r.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleViewDetails(r)}
                        className="p-1.5 text-brand-blue hover:bg-brand-light rounded transition-colors"
                        title="View Details"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleEditReferral(r)}
                        className="p-1.5 text-brand-blue hover:bg-brand-light rounded transition-colors"
                        title="Edit Referral"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      {r.status !== "Completed" && (
                        <button
                          onClick={() => handleUpdateStatus(r)}
                          className="p-1.5 text-brand-blue hover:bg-brand-light rounded transition-colors"
                          title="Update Status"
                        >
                          <RefreshCw className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteRequest(r)}
                        className="p-1.5 text-brand-danger hover:bg-brand-danger/10 rounded transition-colors"
                        title="Delete Referral"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredReferrals.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-sm text-brand-gray">
                    No referrals match the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* New Referral Modal */}
      {showNewReferralModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card
            role="dialog"
            aria-modal="true"
            aria-label="New Referral"
            className="flex max-h-[90vh] w-full max-w-[600px] flex-col overflow-hidden"
          >
            {/* Fixed header */}
            <div className="flex shrink-0 items-center justify-between border-b border-brand-border px-6 py-4">
              <h3 className="text-lg font-semibold text-brand-ink">New Referral</h3>
              <button
                onClick={() => setShowNewReferralModal(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-brand-gray transition-colors hover:bg-brand-bg hover:text-brand-ink"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scrollable form body */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <div className="space-y-3.5">
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">
                    Select Resident <span className="text-brand-danger">*</span>
                  </label>
                  <ResidentSearchSelect
                    residents={residentPool}
                    value={selectedResident}
                    onChange={(r) => {
                      setSelectedResident(r);
                      if (formErrors.resident) setFormErrors((prev) => ({ ...prev, resident: "" }));
                    }}
                  />
                  {formErrors.resident && <p className="text-xs text-brand-danger mt-1">{formErrors.resident}</p>}
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Referral Date</label>
                  <input
                    type="date"
                    value={newReferralForm.date}
                    onChange={(e) => setNewReferralForm({ ...newReferralForm, date: e.target.value })}
                    className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Receiving Facility</label>
                  <select
                    value={newReferralForm.facility}
                    onChange={(e) => setNewReferralForm({ ...newReferralForm, facility: e.target.value })}
                    className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
                  >
                    <option>RHU Pili</option>
                    <option>Bicol Medical Center</option>
                    <option>Bicol Regional Training and Teaching Hospital</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">
                    Referral Reason <span className="text-brand-danger">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="Enter reason..."
                    value={newReferralForm.reason}
                    onChange={(e) => {
                      setNewReferralForm({ ...newReferralForm, reason: e.target.value });
                      if (formErrors.reason) setFormErrors((prev) => ({ ...prev, reason: "" }));
                    }}
                    className={`w-full bg-white border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue ${
                      formErrors.reason ? "border-brand-danger" : "border-brand-border"
                    }`}
                  />
                  {formErrors.reason && <p className="text-xs text-brand-danger mt-1">{formErrors.reason}</p>}
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Priority</label>
                  <select
                    value={newReferralForm.priority}
                    onChange={(e) => setNewReferralForm({ ...newReferralForm, priority: e.target.value })}
                    className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
                  >
                    <option>High</option>
                    <option>Medium</option>
                    <option>Low</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Notes</label>
                  <textarea
                    rows={3}
                    placeholder="Additional notes..."
                    value={newReferralForm.notes}
                    onChange={(e) => setNewReferralForm({ ...newReferralForm, notes: e.target.value })}
                    className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue resize-none"
                  />
                </div>
              </div>
            </div>

            {/* Fixed footer */}
            <div className="flex shrink-0 justify-end gap-3 border-t border-brand-border bg-white px-6 py-4">
              <button
                onClick={() => setShowNewReferralModal(false)}
                className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveReferral}
                className="px-4 py-2 rounded-btn text-sm font-medium bg-brand-blue text-white hover:bg-brand-dark transition-colors"
              >
                Save Referral
              </button>
            </div>
          </Card>
        </div>
      )}

      {/* Submission Success Modal */}
      {submittedReferral && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setSubmittedReferral(null)}
        >
          <Card
            role="dialog"
            aria-modal="true"
            aria-label="Referral submitted successfully"
            className="w-full max-w-md overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 pb-5 pt-6 text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-brand-green/10">
                <CheckCircle2 className="h-7 w-7 text-brand-green" />
              </div>
              <h3 className="text-lg font-semibold text-brand-ink">Referral Submitted Successfully</h3>
              <p className="mt-1 text-sm text-brand-gray">
                The referral has been saved and routed to the RHU Public Health Nurse for review.
              </p>
              <div className="mt-4 rounded-btn border border-brand-border bg-brand-bg px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-brand-gray">Referral No.</p>
                <p className="mt-0.5 font-heading text-lg font-semibold text-brand-ink">
                  {submittedReferral.referralNo}
                </p>
                {submittedReferral.resident && (
                  <p className="mt-0.5 text-xs text-brand-gray">Resident: {submittedReferral.resident}</p>
                )}
              </div>
            </div>
            <div className="flex flex-col-reverse gap-3 border-t border-brand-border bg-white px-6 py-4 sm:flex-row sm:items-center sm:justify-end">
              <button
                onClick={() => setSubmittedReferral(null)}
                className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors"
              >
                Close
              </button>
              <button
                onClick={() => {
                  setSelectedReferral(submittedReferral);
                  setSubmittedReferral(null);
                  setShowViewDetailsModal(true);
                }}
                className="flex items-center justify-center gap-2 rounded-btn border border-brand-border bg-white px-4 py-2 text-sm font-medium text-brand-ink transition-colors hover:border-brand-blue hover:bg-brand-light"
              >
                <Eye className="w-4 h-4" /> View Referral
              </button>
              <button
                onClick={() => handleDownloadPdf(submittedReferral)}
                className="flex items-center justify-center gap-2 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
              >
                <Download className="w-4 h-4" /> Download PDF
              </button>
            </div>
          </Card>
        </div>
      )}

      {/* Edit Referral Modal */}
      {showEditReferralModal && selectedReferral && editForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-brand-ink">Edit Referral</h3>
                <button
                  onClick={() => setShowEditReferralModal(false)}
                  className="text-brand-gray hover:text-brand-ink"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Resident Name</label>
                  <input
                    type="text"
                    value={selectedReferral.resident}
                    readOnly
                    className="w-full bg-brand-bg border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none text-brand-gray"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Receiving Facility</label>
                  <select
                    value={editForm.facility}
                    onChange={(e) => setEditForm({ ...editForm, facility: e.target.value })}
                    className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
                  >
                    <option>RHU Pili</option>
                    <option>Bicol Medical Center</option>
                    <option>Bicol Regional Training and Teaching Hospital</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">
                    Referral Reason <span className="text-brand-danger">*</span>
                  </label>
                  <input
                    type="text"
                    value={editForm.reason}
                    onChange={(e) => {
                      setEditForm({ ...editForm, reason: e.target.value });
                      if (formErrors.reason) setFormErrors((prev) => ({ ...prev, reason: "" }));
                    }}
                    className={`w-full bg-white border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue ${
                      formErrors.reason ? "border-brand-danger" : "border-brand-border"
                    }`}
                  />
                  {formErrors.reason && <p className="text-xs text-brand-danger mt-1">{formErrors.reason}</p>}
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Priority</label>
                  <select
                    value={editForm.priority}
                    onChange={(e) => setEditForm({ ...editForm, priority: e.target.value })}
                    className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
                  >
                    <option>High</option>
                    <option>Medium</option>
                    <option>Low</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Notes</label>
                  <textarea
                    rows={3}
                    value={editForm.notes}
                    onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                    className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue resize-none"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => setShowEditReferralModal(false)}
                  className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEditReferral}
                  className="px-4 py-2 rounded-btn text-sm font-medium bg-brand-blue text-white hover:bg-brand-dark transition-colors"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* View Details Modal */}
      {showViewDetailsModal && selectedReferral && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card
            role="dialog"
            aria-modal="true"
            aria-label="Referral Details"
            className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden"
          >
            {/* Fixed header */}
            <div className="flex shrink-0 items-center justify-between border-b border-brand-border px-6 py-4">
              <h3 className="text-base font-semibold text-brand-ink">Referral Details</h3>
              <button
                onClick={() => setShowViewDetailsModal(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-brand-gray transition-colors hover:bg-brand-bg hover:text-brand-ink"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <div className="space-y-4">
                <div>
                  <h4 className="text-xs font-semibold text-brand-gray uppercase tracking-wide mb-3">Resident Information</h4>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <p className="text-brand-gray">Name: <span className="text-brand-ink">{selectedReferral.resident}</span></p>
                    <p className="text-brand-gray">Age: <span className="text-brand-ink">{selectedReferral.age}</span></p>
                    <p className="text-brand-gray">Sex: <span className="text-brand-ink">{selectedReferral.sex}</span></p>
                    <p className="text-brand-gray">Barangay: <span className="text-brand-ink">{selectedReferral.barangay}</span></p>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-semibold text-brand-gray uppercase tracking-wide mb-3">Referral Information</h4>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <p className="text-brand-gray">Referral No.: <span className="text-brand-ink">{selectedReferral.referralNo}</span></p>
                    <p className="text-brand-gray">Date: <span className="text-brand-ink">{selectedReferral.date}</span></p>
                    <p className="text-brand-gray">Reason: <span className="text-brand-ink">{selectedReferral.reason}</span></p>
                    <p className="text-brand-gray">Facility: <span className="text-brand-ink">{selectedReferral.facility}</span></p>
                    <p className="text-brand-gray">Priority: <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_COLORS[selectedReferral.priority]}`}>{selectedReferral.priority}</span></p>
                    <p className="text-brand-gray">Status: <StatusBadge value={selectedReferral.status} /></p>
                  </div>
                </div>

                {selectedReferral.notes && (
                  <div>
                    <h4 className="text-xs font-semibold text-brand-gray uppercase tracking-wide mb-2">Notes</h4>
                    <p className="text-sm text-brand-ink">{selectedReferral.notes}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Fixed footer */}
            <div className="flex shrink-0 justify-end gap-3 border-t border-brand-border bg-white px-6 py-4">
              <button
                onClick={() => setShowViewDetailsModal(false)}
                className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors"
              >
                Close
              </button>
              <button
                onClick={() => handleDownloadPdf(selectedReferral)}
                className="flex items-center gap-2 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
              >
                <Download className="w-4 h-4" /> Download PDF
              </button>
            </div>
          </Card>
        </div>
      )}

      {/* Update Status Modal */}
      {showUpdateStatusModal && selectedReferral && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-brand-ink">Update Status</h3>
                <button
                  onClick={() => setShowUpdateStatusModal(false)}
                  className="text-brand-gray hover:text-brand-ink"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-brand-gray mb-1">Current Status</p>
                  <StatusBadge value={selectedReferral.status} />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">New Status</label>
                  <select
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value)}
                    className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
                  >
                    {statusOptions.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => setShowUpdateStatusModal(false)}
                  className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleStatusUpdate}
                  className="px-4 py-2 rounded-btn text-sm font-medium bg-brand-blue text-white hover:bg-brand-dark transition-colors"
                >
                  Update
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && selectedReferral && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-danger/10 shrink-0">
                  <Trash2 className="h-5 w-5 text-brand-danger" />
                </div>
                <h3 className="text-lg font-semibold text-brand-ink">Delete this referral?</h3>
              </div>
              <p className="text-sm text-brand-gray">
                Referral for {selectedReferral.resident} ({selectedReferral.barangay}) will be removed. This action cannot be undone.
              </p>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmDelete}
                  className="px-4 py-2 rounded-btn text-sm font-medium bg-brand-danger text-white hover:opacity-90 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
