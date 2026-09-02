import React, { useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { Search, Plus, Calendar, MapPin, User, X } from "lucide-react";

const FOLLOW_UPS = [
  {
    id: 1,
    resident: "Ana Villanueva",
    age: 32,
    sex: "Female",
    barangay: "San Jose",
    contact: "0917 123 4567",
    purpose: "Prenatal Check-up",
    assignedMidwife: "Maria Dela Cruz",
    scheduledDate: "July 12, 2026",
    scheduledTime: "9:00 AM",
    location: "Barangay Health Station",
    priority: "High",
    status: "Scheduled",
    remarks: "",
  },
  {
    id: 2,
    resident: "Maria Santos",
    age: 28,
    sex: "Female",
    barangay: "San Jose",
    contact: "0918 234 5678",
    purpose: "Postnatal Check-up",
    assignedMidwife: "Maria Dela Cruz",
    scheduledDate: "July 13, 2026",
    scheduledTime: "10:00 AM",
    location: "Home Visit",
    priority: "High",
    status: "Today",
    remarks: "",
  },
  {
    id: 3,
    resident: "Elena Garcia",
    age: 25,
    sex: "Female",
    barangay: "San Jose",
    contact: "0919 345 6789",
    purpose: "Immunization Follow-up",
    assignedMidwife: "Maria Dela Cruz",
    scheduledDate: "July 8, 2026",
    scheduledTime: "2:00 PM",
    location: "Barangay Health Station",
    priority: "Medium",
    status: "Completed",
    remarks: "Blood pressure improving. Medication completed.",
  },
  {
    id: 4,
    resident: "Carmen Reyes",
    age: 30,
    sex: "Female",
    barangay: "San Jose",
    contact: "0920 456 7890",
    purpose: "High-Risk Pregnancy Monitoring",
    assignedMidwife: "Grace Aquino",
    scheduledDate: "July 15, 2026",
    scheduledTime: "11:00 AM",
    location: "Barangay Health Station",
    priority: "High",
    status: "Upcoming",
    remarks: "",
  },
  {
    id: 5,
    resident: "Lourdes Mendoza",
    age: 35,
    sex: "Female",
    barangay: "San Jose",
    contact: "0921 567 8901",
    purpose: "Tetanus Toxoid Booster",
    assignedMidwife: "Grace Aquino",
    scheduledDate: "July 10, 2026",
    scheduledTime: "3:00 PM",
    location: "Barangay Health Station",
    priority: "Low",
    status: "Missed",
    remarks: "Resident unavailable during visit.",
  },
];

const STATUS_COLORS = {
  Scheduled: "bg-brand-blue/10 text-brand-blue",
  Today: "bg-brand-accent/10 text-brand-accent",
  Completed: "bg-brand-green/10 text-brand-green",
  Missed: "bg-brand-danger/10 text-brand-danger",
  Upcoming: "bg-brand-gray/10 text-brand-gray",
  Ongoing: "bg-brand-purple/10 text-brand-purple",
  Cancelled: "bg-brand-gray/10 text-brand-gray",
};

const PRIORITY_COLORS = {
  High: "bg-brand-danger/10 text-brand-danger",
  Medium: "bg-brand-yellow/15 text-[#B07E00]",
  Low: "bg-brand-green/10 text-brand-green",
};

export default function MidwifeFollowUp() {
  const [followUps, setFollowUps] = useState(FOLLOW_UPS);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [priorityFilter, setPriorityFilter] = useState("All");
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const [showRecordVisitModal, setShowRecordVisitModal] = useState(false);
  const [showUpdateStatusModal, setShowUpdateStatusModal] = useState(false);
  const [showRemarksModal, setShowRemarksModal] = useState(false);
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false);
  const [selectedFollowUp, setSelectedFollowUp] = useState(null);

  const stats = {
    total: followUps.length,
    today: followUps.filter((f) => f.status === "Today").length,
    upcoming: followUps.filter((f) => f.status === "Upcoming").length,
    completed: followUps.filter((f) => f.status === "Completed").length,
  };

  const filteredFollowUps = followUps.filter((f) => {
    const matchesSearch = searchQuery === "" || f.resident.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "All" || f.status === statusFilter;
    const matchesPriority = priorityFilter === "All" || f.priority === priorityFilter;
    return matchesSearch && matchesStatus && matchesPriority;
  });

  const handleView = (followUp) => {
    setSelectedFollowUp(followUp);
    setShowDetailPanel(true);
  };

  const handleRecordVisit = (followUp) => {
    setSelectedFollowUp(followUp);
    setShowRecordVisitModal(true);
  };

  const handleUpdateStatus = (followUp) => {
    setSelectedFollowUp(followUp);
    setShowUpdateStatusModal(true);
  };

  const handleAddRemarks = (followUp) => {
    setSelectedFollowUp(followUp);
    setShowRemarksModal(true);
  };

  const handleCompleteFollowUp = (followUp) => {
    setSelectedFollowUp(followUp);
    setShowCompleteConfirm(true);
  };

  const confirmComplete = () => {
    setFollowUps((prev) =>
      prev.map((f) => (f.id === selectedFollowUp.id ? { ...f, status: "Completed" } : f))
    );
    setShowCompleteConfirm(false);
    setSelectedFollowUp(null);
    alert("Follow-up marked as completed!");
  };

  const handleStatusUpdate = (newStatus) => {
    setFollowUps((prev) =>
      prev.map((f) => (f.id === selectedFollowUp.id ? { ...f, status: newStatus } : f))
    );
    setShowUpdateStatusModal(false);
    setSelectedFollowUp(null);
    alert(`Status updated to ${newStatus}`);
  };

  const handleSaveRemarks = (remarks) => {
    setFollowUps((prev) =>
      prev.map((f) => (f.id === selectedFollowUp.id ? { ...f, remarks: remarks } : f))
    );
    setShowRemarksModal(false);
    setSelectedFollowUp(null);
    alert("Remarks saved successfully!");
  };

  const handleSaveVisit = (visitData) => {
    setFollowUps((prev) =>
      prev.map((f) => (f.id === selectedFollowUp.id ? { ...f, ...visitData, status: "Completed" } : f))
    );
    setShowRecordVisitModal(false);
    setSelectedFollowUp(null);
    alert("Visit recorded successfully!");
  };

  return (
    <>
      <PageHeader
        crumbs={["Home", "Follow-ups"]}
        title="Follow-up Management"
        subtitle="Manage scheduled follow-up visits and monitor resident outcomes."
        action={
          <button
            onClick={() => setShowScheduleModal(true)}
            className="flex items-center gap-2 bg-brand-blue text-white px-4 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors"
          >
            <Plus className="w-4 h-4" /> Schedule Follow-up
          </button>
        }
      />

      {/* Summary Cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Total Follow-ups", value: stats.total, subtitle: "Active follow-up records" },
          { label: "Today's Follow-ups", value: stats.today, subtitle: "Scheduled for today" },
          { label: "Upcoming", value: stats.upcoming, subtitle: "Next within 7 days" },
          { label: "Completed", value: stats.completed, subtitle: "Finished this week" },
        ].map((stat) => (
          <Card key={stat.label} className="p-5">
            <p className="text-sm text-brand-gray">{stat.label}</p>
            <p className="text-2xl font-semibold text-brand-blue mt-1">{stat.value}</p>
            <p className="text-xs text-brand-gray mt-1">{stat.subtitle}</p>
          </Card>
        ))}
      </div>

      {/* Search & Filters */}
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
            <div className="flex items-center gap-1">
              {["All", "Today", "Upcoming", "Completed", "Missed"].map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`px-3 py-1.5 rounded-btn text-sm font-medium transition-colors ${
                    statusFilter === status
                      ? "bg-brand-blue text-white"
                      : "text-brand-gray hover:bg-brand-bg"
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
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

      {/* Follow-up Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-brand-bg border-b border-brand-border">
              <tr>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Resident Name</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Purpose</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Assigned Midwife</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Scheduled Date</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Location</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Priority</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Status</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredFollowUps.map((f) => (
                <tr key={f.id} className="border-b border-brand-border hover:bg-brand-bg/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-brand-blue text-white flex items-center justify-center text-xs font-semibold">
                        {f.resident.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-brand-ink">{f.resident}</p>
                        <p className="text-xs text-brand-gray">{f.barangay}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-brand-ink">{f.purpose}</td>
                  <td className="px-4 py-3 text-sm text-brand-ink">{f.assignedMidwife}</td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-brand-ink">{f.scheduledDate}</div>
                    <div className="text-xs text-brand-gray">{f.scheduledTime}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-brand-ink flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-brand-gray" />
                    {f.location}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${PRIORITY_COLORS[f.priority]}`}>
                      {f.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[f.status]}`}>
                      {f.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleView(f)}
                        className="text-sm font-medium text-brand-blue hover:underline"
                      >
                        View
                      </button>
                      {f.status !== "Completed" && (
                        <>
                          <button
                            onClick={() => handleRecordVisit(f)}
                            className="text-sm font-medium text-brand-blue hover:underline"
                          >
                            Record Visit
                          </button>
                          <button
                            onClick={() => handleUpdateStatus(f)}
                            className="text-sm font-medium text-brand-blue hover:underline"
                          >
                            Update Status
                          </button>
                          <button
                            onClick={() => handleAddRemarks(f)}
                            className="text-sm font-medium text-brand-blue hover:underline"
                          >
                            Add Remarks
                          </button>
                          <button
                            onClick={() => handleCompleteFollowUp(f)}
                            className="text-sm font-medium text-brand-green hover:underline"
                          >
                            Complete
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Detail Panel */}
      {showDetailPanel && selectedFollowUp && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="p-5">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-base font-semibold text-brand-ink">Follow-up Details</h3>
                <button
                  onClick={() => setShowDetailPanel(false)}
                  className="text-brand-gray hover:text-brand-ink"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="mb-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full bg-brand-blue text-white flex items-center justify-center text-sm font-semibold">
                    {selectedFollowUp.resident.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-brand-ink">{selectedFollowUp.resident}</p>
                    <p className="text-xs text-brand-gray">{selectedFollowUp.sex} • {selectedFollowUp.age} years old</p>
                  </div>
                </div>
                <div className="space-y-1 text-xs">
                  <p className="text-brand-gray">Barangay {selectedFollowUp.barangay}</p>
                  <p className="text-brand-gray">{selectedFollowUp.contact}</p>
                </div>
              </div>

              <div className="mb-4 space-y-3">
                <div>
                  <p className="text-xs text-brand-gray mb-1">Purpose</p>
                  <p className="text-sm font-medium text-brand-ink">{selectedFollowUp.purpose}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar className="w-3.5 h-3.5 text-brand-gray" />
                  <p className="text-sm text-brand-ink">{selectedFollowUp.scheduledDate} • {selectedFollowUp.scheduledTime}</p>
                </div>
                <div className="flex items-center gap-2">
                  <MapPin className="w-3.5 h-3.5 text-brand-gray" />
                  <p className="text-sm text-brand-ink">{selectedFollowUp.location}</p>
                </div>
                <div className="flex items-center gap-2">
                  <User className="w-3.5 h-3.5 text-brand-gray" />
                  <p className="text-sm text-brand-ink">{selectedFollowUp.assignedMidwife}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_COLORS[selectedFollowUp.priority]}`}>
                    {selectedFollowUp.priority}
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[selectedFollowUp.status]}`}>
                    {selectedFollowUp.status}
                  </span>
                </div>
              </div>

              {selectedFollowUp.remarks && (
                <div className="mb-5">
                  <p className="text-xs text-brand-gray mb-1">Remarks</p>
                  <p className="text-sm text-brand-ink">{selectedFollowUp.remarks}</p>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* Record Visit Modal */}
      {showRecordVisitModal && selectedFollowUp && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-brand-ink">Record Visit</h3>
                <button
                  onClick={() => setShowRecordVisitModal(false)}
                  className="text-brand-gray hover:text-brand-ink"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-4">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-brand-ink block mb-1.5">Visit Date</label>
                    <input
                      type="date"
                      className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-brand-ink block mb-1.5">Visit Time</label>
                    <input
                      type="time"
                      className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Resident Condition</label>
                  <select className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue">
                    <option>Stable</option>
                    <option>Improving</option>
                    <option>Worsening</option>
                    <option>Critical</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Findings</label>
                  <textarea
                    rows={3}
                    placeholder="Enter findings..."
                    className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue resize-none"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Treatment Provided</label>
                  <textarea
                    rows={2}
                    placeholder="Enter treatment..."
                    className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue resize-none"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Advice Given</label>
                  <textarea
                    rows={2}
                    placeholder="Enter advice..."
                    className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue resize-none"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Next Visit Date</label>
                  <input
                    type="date"
                    className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => setShowRecordVisitModal(false)}
                  className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleSaveVisit({})}
                  className="px-4 py-2 rounded-btn text-sm font-medium bg-brand-blue text-white hover:bg-brand-dark transition-colors"
                >
                  Save Visit
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Update Status Modal */}
      {showUpdateStatusModal && selectedFollowUp && (
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
              <p className="text-sm text-brand-gray mb-4">Select new status for {selectedFollowUp.resident}'s follow-up:</p>
              <div className="space-y-2">
                {["Scheduled", "Ongoing", "Completed", "Missed", "Cancelled"].map((status) => (
                  <button
                    key={status}
                    onClick={() => handleStatusUpdate(status)}
                    className="w-full flex items-center gap-3 border border-brand-border rounded-btn px-4 py-3 text-sm font-medium text-brand-ink hover:border-brand-blue hover:bg-brand-light transition-colors"
                  >
                    <span className={`w-3 h-3 rounded-full ${STATUS_COLORS[status].split(" ")[0]}`} />
                    {status}
                  </button>
                ))}
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Remarks Modal */}
      {showRemarksModal && selectedFollowUp && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-brand-ink">Add Remarks</h3>
                <button
                  onClick={() => setShowRemarksModal(false)}
                  className="text-brand-gray hover:text-brand-ink"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="mb-4">
                <label className="text-sm font-medium text-brand-ink block mb-1.5">Remarks</label>
                <textarea
                  rows={4}
                  placeholder="Enter remarks..."
                  defaultValue={selectedFollowUp.remarks}
                  className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue resize-none"
                />
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowRemarksModal(false)}
                  className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleSaveRemarks("Updated remarks")}
                  className="px-4 py-2 rounded-btn text-sm font-medium bg-brand-blue text-white hover:bg-brand-dark transition-colors"
                >
                  Save
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Complete Confirmation Modal */}
      {showCompleteConfirm && selectedFollowUp && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-brand-ink mb-4">Complete Follow-up</h3>
              <p className="text-sm text-brand-gray mb-6">
                Are you sure you want to mark <span className="font-medium text-brand-ink">{selectedFollowUp.resident}</span>'s follow-up as completed? This action cannot be undone.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowCompleteConfirm(false)}
                  className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmComplete}
                  className="px-4 py-2 rounded-btn text-sm font-medium bg-brand-blue text-white hover:bg-brand-dark transition-colors"
                >
                  Complete
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
