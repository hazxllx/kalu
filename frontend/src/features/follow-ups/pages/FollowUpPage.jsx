import React, { useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { Search, Plus, Eye, Calendar, MapPin, User, X, RefreshCw, Cloud, CloudOff } from "lucide-react";

const FOLLOW_UPS = [
  {
    id: 1,
    resident: "Juan Dela Cruz",
    age: 45,
    sex: "Male",
    barangay: "San Jose",
    contact: "0917 123 4567",
    purpose: "Blood Pressure Monitoring",
    assignedBHW: "Maria Cruz",
    scheduledDate: "July 12, 2026",
    scheduledTime: "9:00 AM",
    location: "Home Visit",
    priority: "High",
    status: "Scheduled",
    availability: "Waiting for Confirmation",
  },
  {
    id: 2,
    resident: "Maria Santos",
    age: 28,
    sex: "Female",
    barangay: "San Jose",
    contact: "0918 234 5678",
    purpose: "Prenatal Follow-up",
    assignedBHW: "Maria Cruz",
    scheduledDate: "July 13, 2026",
    scheduledTime: "10:00 AM",
    location: "Barangay Health Station",
    priority: "High",
    status: "Today",
    availability: "Available",
  },
  {
    id: 3,
    resident: "Pedro Reyes",
    age: 52,
    sex: "Male",
    barangay: "San Jose",
    contact: "0919 345 6789",
    purpose: "Diabetes Monitoring",
    assignedBHW: "Maria Cruz",
    scheduledDate: "July 8, 2026",
    scheduledTime: "2:00 PM",
    location: "Home Visit",
    priority: "Medium",
    status: "Completed",
    availability: "Available",
  },
  {
    id: 4,
    resident: "Ana Villanueva",
    age: 32,
    sex: "Female",
    barangay: "San Jose",
    contact: "0920 456 7890",
    purpose: "Postnatal Check-up",
    assignedBHW: "Grace Aquino",
    scheduledDate: "July 15, 2026",
    scheduledTime: "11:00 AM",
    location: "Barangay Health Station",
    priority: "High",
    status: "Upcoming",
    availability: "Waiting for Confirmation",
  },
  {
    id: 5,
    resident: "Carlos Mendoza",
    age: 38,
    sex: "Male",
    barangay: "San Jose",
    contact: "0921 567 8901",
    purpose: "Hypertension Follow-up",
    assignedBHW: "Grace Aquino",
    scheduledDate: "July 10, 2026",
    scheduledTime: "3:00 PM",
    location: "Home Visit",
    priority: "Medium",
    status: "Missed",
    availability: "Not Available",
  },
  {
    id: 6,
    resident: "Elena Garcia",
    age: 25,
    sex: "Female",
    barangay: "San Jose",
    contact: "0922 678 9012",
    purpose: "Immunization Follow-up",
    assignedBHW: "Maria Cruz",
    scheduledDate: "July 14, 2026",
    scheduledTime: "9:30 AM",
    location: "Barangay Health Station",
    priority: "Low",
    status: "Upcoming",
    availability: "Waiting for Confirmation",
  },
];

const STATUS_COLORS = {
  Scheduled: "bg-brand-blue/10 text-brand-blue",
  Today: "bg-brand-accent/10 text-brand-accent",
  Completed: "bg-brand-green/10 text-brand-green",
  Missed: "bg-brand-danger/10 text-brand-danger",
  Upcoming: "bg-brand-gray/10 text-brand-gray",
  "Pending Sync": "bg-amber-100 text-amber-700",
};

const AVAILABILITY_COLORS = {
  Available: "bg-brand-green/10 text-brand-green",
  "Not Available": "bg-brand-danger/10 text-brand-danger",
  "Waiting for Confirmation": "bg-brand-yellow/15 text-[#B07E00]",
};

const PRIORITY_COLORS = {
  High: "bg-brand-danger/10 text-brand-danger",
  Medium: "bg-brand-yellow/15 text-[#B07E00]",
  Low: "bg-brand-green/10 text-brand-green",
};

export default function FollowUpPage() {
  const [followUps, setFollowUps] = useState(FOLLOW_UPS);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [priorityFilter, setPriorityFilter] = useState("All");
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const [selectedFollowUp, setSelectedFollowUp] = useState(null);
  const [syncStatus, setSyncStatus] = useState("offline"); // offline, syncing, connected
  const [toast, setToast] = useState(null);

  const stats = {
    total: followUps.length,
    today: followUps.filter((f) => f.status === "Today").length,
    upcoming: followUps.filter((f) => f.status === "Upcoming").length,
    completed: followUps.filter((f) => f.status === "Completed").length,
    pendingSync: followUps.filter((f) => f.status === "Pending Sync").length,
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

  const handleMarkCompleted = (id) => {
    setFollowUps((prev) => prev.map((f) => (f.id === id ? { ...f, status: "Completed" } : f)));
  };

  const handleReschedule = (id) => {
    alert("Reschedule modal would open here");
  };

  const handleCancel = (id) => {
    setFollowUps((prev) => prev.filter((f) => f.id !== id));
  };

  const handleSync = () => {
    setSyncStatus("syncing");
    setTimeout(() => {
      setSyncStatus("connected");
      setFollowUps((prev) =>
        prev.map((f) => (f.status === "Pending Sync" ? { ...f, status: "Scheduled" } : f))
      );
      setToast("Synchronization Complete - All pending records have been uploaded successfully.");
      setTimeout(() => setToast(null), 3000);
    }, 2000);
  };

  const handleScheduleFollowUp = (followUpData) => {
    const newFollowUp = {
      id: followUps.length + 1,
      ...followUpData,
      status: "Pending Sync",
    };
    setFollowUps([newFollowUp, ...followUps]);
    setShowScheduleModal(false);
    setToast("Saved Offline - This record will automatically synchronize once an internet connection becomes available.");
    setTimeout(() => setToast(null), 3000);
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

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-4 right-4 bg-brand-ink text-white px-4 py-3 rounded-btn shadow-lg flex items-center gap-2 z-50 animate-in slide-in-from-bottom-2">
          <RefreshCw className="w-4 h-4 text-brand-green" />
          <span className="text-sm">{toast}</span>
        </div>
      )}

      {/* Synchronization Status */}
      <Card className="p-4 mb-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {syncStatus === "offline" && (
              <>
                <CloudOff className="w-5 h-5 text-amber-600" />
                <div>
                  <p className="text-sm font-semibold text-brand-ink">Offline Mode</p>
                  <p className="text-xs text-brand-gray">{stats.pendingSync} follow-ups waiting to sync</p>
                </div>
              </>
            )}
            {syncStatus === "syncing" && (
              <>
                <RefreshCw className="w-5 h-5 text-brand-blue animate-spin" />
                <div>
                  <p className="text-sm font-semibold text-brand-ink">Syncing...</p>
                  <p className="text-xs text-brand-gray">Uploading follow-up records...</p>
                </div>
              </>
            )}
            {syncStatus === "connected" && (
              <>
                <Cloud className="w-5 h-5 text-brand-green" />
                <div>
                  <p className="text-sm font-semibold text-brand-ink">Connected</p>
                  <p className="text-xs text-brand-gray">All follow-ups synchronized</p>
                </div>
              </>
            )}
          </div>
          {syncStatus === "offline" && stats.pendingSync > 0 && (
            <button
              onClick={handleSync}
              className="flex items-center gap-2 bg-brand-blue text-white px-4 py-2 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors"
            >
              <RefreshCw className="w-4 h-4" /> Sync Now
            </button>
          )}
        </div>
      </Card>

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
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Assigned BHW</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Scheduled Date</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Location</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Priority</th>
                <th className="text-left text-xs font-semibold text-brand-gray uppercase tracking-wide px-4 py-3">Availability</th>
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
                  <td className="px-4 py-3 text-sm text-brand-ink">{f.assignedBHW}</td>
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
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${AVAILABILITY_COLORS[f.availability]}`}>
                      {f.availability}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[f.status]}`}>
                      {f.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleView(f)}
                      className="flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline"
                    >
                      <Eye className="w-4 h-4" /> View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Schedule Follow-up Modal */}
      {showScheduleModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-brand-ink mb-4">Schedule Follow-up</h3>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Resident</label>
                  <select className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue">
                    <option>Select resident...</option>
                    <option>Juan Dela Cruz</option>
                    <option>Maria Santos</option>
                    <option>Pedro Reyes</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Purpose</label>
                  <input
                    type="text"
                    placeholder="Enter purpose..."
                    className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
                  />
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-brand-ink block mb-1.5">Date</label>
                    <input
                      type="date"
                      className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-brand-ink block mb-1.5">Time</label>
                    <input
                      type="time"
                      className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Location</label>
                  <select className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue">
                    <option>Barangay Health Station</option>
                    <option>Home Visit</option>
                  </select>
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
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Assigned Barangay Health Worker</label>
                  <select className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue">
                    <option>Maria Cruz</option>
                    <option>Grace Aquino</option>
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
                  onClick={() => setShowScheduleModal(false)}
                  className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleScheduleFollowUp({})}
                  className="px-4 py-2 rounded-btn text-sm font-medium bg-brand-blue text-white hover:bg-brand-dark transition-colors"
                >
                  Save Schedule
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}

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

              {/* Resident Information */}
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

              {/* Follow-up Details */}
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
                  <p className="text-sm text-brand-ink">{selectedFollowUp.assignedBHW}</p>
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

              {/* Visit Notes */}
              <div className="mb-5">
                <p className="text-xs text-brand-gray mb-1">Visit Notes</p>
                <p className="text-sm text-brand-ink">No notes have been added.</p>
              </div>

              {/* Visit Outcome */}
              {selectedFollowUp.status === "Completed" && (
                <div className="mb-5">
                  <p className="text-xs text-brand-gray mb-2">Visit Outcome</p>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-brand-gray">Blood Pressure</span>
                      <span className="text-brand-ink">120/80 mmHg</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-brand-gray">Temperature</span>
                      <span className="text-brand-ink">36.8°C</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-brand-gray">Weight</span>
                      <span className="text-brand-ink">65 kg</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-brand-gray">Next Follow-up</span>
                      <span className="text-brand-ink">July 20, 2026</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="pt-4 border-t border-brand-border">
                {selectedFollowUp.status !== "Completed" ? (
                  <>
                    <button
                      onClick={() => handleMarkCompleted(selectedFollowUp.id)}
                      className="w-full mb-3 px-4 py-2 rounded-btn text-sm font-medium bg-brand-blue text-white hover:bg-brand-dark transition-colors"
                    >
                      Complete Follow-up
                    </button>
                    <div className="flex justify-between gap-2">
                      <button
                        onClick={() => handleReschedule(selectedFollowUp.id)}
                        className="flex-1 px-3 py-2 rounded-btn text-sm font-medium text-brand-blue hover:bg-brand-light transition-colors"
                      >
                        Reschedule
                      </button>
                      <button
                        onClick={() => handleCancel(selectedFollowUp.id)}
                        className="flex-1 px-3 py-2 rounded-btn text-sm font-medium text-brand-danger hover:bg-brand-danger/5 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                    <button
                      onClick={() => alert("Update notes modal would open here")}
                      className="w-full mt-2 px-3 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors"
                    >
                      Update Notes
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => alert("Update notes modal would open here")}
                    className="w-full px-3 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors"
                  >
                    Update Notes
                  </button>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}