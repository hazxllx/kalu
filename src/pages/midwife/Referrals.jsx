import React, { useState } from "react";
import PageHeader from "@/components/shared/PageHeader";
import { Card } from "@/components/shared/Card";
import StatusBadge from "@/components/shared/Badge";
import { Plus, Eye, Edit2, RefreshCw, X, Search, Check } from "lucide-react";

const REFERRALS = [
  {
    id: 1,
    resident: "Ana Villanueva",
    age: 32,
    sex: "Female",
    barangay: "San Jose",
    date: "July 10, 2026",
    reason: "High-risk Pregnancy",
    facility: "RHU Pili",
    priority: "High",
    status: "Pending",
    notes: "Requires specialized maternal care due to elevated blood pressure.",
  },
  {
    id: 2,
    resident: "Maria Santos",
    age: 28,
    sex: "Female",
    barangay: "San Jose",
    date: "July 8, 2026",
    reason: "Abnormal Ultrasound Findings",
    facility: "Bicol Medical Center",
    priority: "High",
    status: "Accepted",
    notes: "Ultrasound showed placenta previa. Referral for specialist evaluation.",
  },
  {
    id: 3,
    resident: "Grace Aquino",
    age: 24,
    sex: "Female",
    barangay: "San Jose",
    date: "July 5, 2026",
    reason: "Postpartum Follow-up",
    facility: "RHU Pili",
    priority: "Medium",
    status: "Completed",
    notes: "Post-delivery monitoring completed. Mother and baby in good condition.",
  },
];

const PRIORITY_COLORS = {
  High: "bg-brand-danger/10 text-brand-danger",
  Medium: "bg-brand-yellow/15 text-[#B07E00]",
  Low: "bg-brand-green/10 text-brand-green",
};

const STATUS_COLORS = {
  Pending: "bg-brand-accent/10 text-brand-accent",
  Accepted: "bg-brand-blue/10 text-brand-blue",
  Completed: "bg-brand-green/10 text-brand-green",
  Cancelled: "bg-brand-gray/10 text-brand-gray",
};

export default function Referrals() {
  const [referrals, setReferrals] = useState(REFERRALS);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [priorityFilter, setPriorityFilter] = useState("All");
  const [showNewReferralModal, setShowNewReferralModal] = useState(false);
  const [showViewDetailsModal, setShowViewDetailsModal] = useState(false);
  const [showEditReferralModal, setShowEditReferralModal] = useState(false);
  const [showUpdateStatusModal, setShowUpdateStatusModal] = useState(false);
  const [selectedReferral, setSelectedReferral] = useState(null);
  const [toast, setToast] = useState(null);
  const [newStatus, setNewStatus] = useState("");

  const filteredReferrals = referrals.filter((r) => {
    const matchesSearch = searchQuery === "" || r.resident.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "All" || r.status === statusFilter;
    const matchesPriority = priorityFilter === "All" || r.priority === priorityFilter;
    return matchesSearch && matchesStatus && matchesPriority;
  });

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
    showToast("Status updated successfully.");
  };

  const handleSaveReferral = (referralData) => {
    const newReferral = {
      id: referrals.length + 1,
      ...referralData,
      status: "Pending",
    };
    setReferrals([newReferral, ...referrals]);
    setShowNewReferralModal(false);
    showToast("Referral saved successfully.");
  };

  const handleSaveEditReferral = (updatedData) => {
    setReferrals((prev) =>
      prev.map((r) => (r.id === selectedReferral.id ? { ...r, ...updatedData } : r))
    );
    setShowEditReferralModal(false);
    setSelectedReferral(null);
    showToast("Referral updated successfully.");
  };

  return (
    <>
      <PageHeader
        crumbs={["Home", "Referrals"]}
        title="Referrals"
        subtitle="Manage resident referrals to RHU and higher-level healthcare facilities."
        action={
          <button
            onClick={() => setShowNewReferralModal(true)}
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
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-white border border-brand-border rounded-btn px-3 py-2 text-sm outline-none"
            >
              <option value="All">All Statuses</option>
              <option value="Pending">Pending</option>
              <option value="Accepted">Accepted</option>
              <option value="Completed">Completed</option>
              <option value="Cancelled">Cancelled</option>
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
                  <td className="px-4 py-3 text-sm text-brand-ink">{r.barangay}</td>
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
                      {r.status === "Pending" && (
                        <button
                          onClick={() => handleEditReferral(r)}
                          className="p-1.5 text-brand-blue hover:bg-brand-light rounded transition-colors"
                          title="Edit Referral"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                      )}
                      {r.status !== "Completed" && r.status !== "Cancelled" && (
                        <button
                          onClick={() => handleUpdateStatus(r)}
                          className="p-1.5 text-brand-blue hover:bg-brand-light rounded transition-colors"
                          title="Update Status"
                        >
                          <RefreshCw className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* New Referral Modal */}
      {showNewReferralModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-brand-ink">New Referral</h3>
                <button
                  onClick={() => setShowNewReferralModal(false)}
                  className="text-brand-gray hover:text-brand-ink"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Select Resident</label>
                  <select className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue">
                    <option>Select resident...</option>
                    <option>Ana Villanueva</option>
                    <option>Maria Santos</option>
                    <option>Grace Aquino</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Referral Date</label>
                  <input
                    type="date"
                    className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Receiving Facility</label>
                  <select className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue">
                    <option>RHU Pili</option>
                    <option>Bicol Medical Center</option>
                    <option>Bicol Regional Training and Teaching Hospital</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Referral Reason</label>
                  <input
                    type="text"
                    placeholder="Enter reason..."
                    className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Priority</label>
                  <select className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue">
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
                    className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue resize-none"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => setShowNewReferralModal(false)}
                  className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleSaveReferral({})}
                  className="px-4 py-2 rounded-btn text-sm font-medium bg-brand-blue text-white hover:bg-brand-dark transition-colors"
                >
                  Save Referral
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Edit Referral Modal */}
      {showEditReferralModal && selectedReferral && (
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
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Referral Date</label>
                  <input
                    type="date"
                    defaultValue={selectedReferral.date}
                    className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Receiving Facility</label>
                  <select
                    defaultValue={selectedReferral.facility}
                    className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
                  >
                    <option>RHU Pili</option>
                    <option>Bicol Medical Center</option>
                    <option>Bicol Regional Training and Teaching Hospital</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Referral Reason</label>
                  <input
                    type="text"
                    defaultValue={selectedReferral.reason}
                    className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Priority</label>
                  <select
                    defaultValue={selectedReferral.priority}
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
                    defaultValue={selectedReferral.notes}
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
                  onClick={() => handleSaveEditReferral({})}
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-base font-semibold text-brand-ink">Referral Details</h3>
                <button
                  onClick={() => setShowViewDetailsModal(false)}
                  className="text-brand-gray hover:text-brand-ink"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

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
                    <option value="Pending">Pending</option>
                    <option value="Accepted">Accepted</option>
                    <option value="Completed">Completed</option>
                    <option value="Cancelled">Cancelled</option>
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
    </>
  );
}