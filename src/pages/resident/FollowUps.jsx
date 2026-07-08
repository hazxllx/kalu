import React, { useState } from "react";
import { motion } from "framer-motion";
import PageHeader from "@/components/shared/PageHeader";
import StatusBadge from "@/components/shared/Badge";
import { Card } from "@/components/shared/Card";
import { Calendar, CheckCircle, XCircle, Clock, MapPin, Eye, X } from "lucide-react";

const FOLLOW_UPS = [
  {
    id: 1,
    purpose: "Blood Pressure Monitoring",
    date: "July 12, 2026",
    time: "9:00 AM",
    location: "Barangay Health Station",
    status: "Scheduled",
    remarks: "Bring your health record.",
    instructions: "Please arrive 15 minutes early. Bring your BP log if available.",
    healthWorkerNotes: "Regular BP monitoring for hypertension management.",
    availability: "Waiting for Confirmation",
  },
  {
    id: 2,
    purpose: "Prenatal Follow-up",
    date: "August 5, 2026",
    time: "10:00 AM",
    location: "Barangay Health Station",
    status: "Completed",
    remarks: "Next visit after one month.",
    instructions: "Bring prenatal records and ultrasound results.",
    healthWorkerNotes: "BP 120/80, fetal heartbeat normal. Continue prenatal vitamins.",
    availability: "Available",
  },
  {
    id: 3,
    purpose: "Diabetes Monitoring",
    date: "September 2, 2026",
    time: "1:00 PM",
    location: "Home Visit",
    status: "Upcoming",
    remarks: "Prepare medication list.",
    instructions: "Have your blood sugar log ready for review.",
    healthWorkerNotes: "Monthly diabetes check-up scheduled.",
    availability: "Waiting for Confirmation",
  },
  {
    id: 4,
    purpose: "Postnatal Check-up",
    date: "June 15, 2026",
    time: "11:00 AM",
    location: "Barangay Health Station",
    status: "Completed",
    remarks: "Mother and baby in good condition.",
    instructions: "Bring baby for check-up.",
    healthWorkerNotes: "BP stable, baby weight 3.2kg, breastfeeding well established.",
    availability: "Available",
  },
  {
    id: 5,
    purpose: "Immunization Follow-up",
    date: "May 20, 2026",
    time: "9:30 AM",
    location: "Barangay Health Station",
    status: "Missed",
    remarks: "Reschedule required.",
    instructions: "Bring immunization card.",
    healthWorkerNotes: "Patient did not show up for scheduled immunization.",
    availability: "Not Available",
  },
];

export default function FollowUps() {
  const [selectedFollowUp, setSelectedFollowUp] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [followUps, setFollowUps] = useState(FOLLOW_UPS);

  const stats = {
    upcoming: followUps.filter((f) => f.status === "Upcoming" || f.status === "Scheduled").length,
    today: followUps.filter((f) => f.status === "Today").length,
    completed: followUps.filter((f) => f.status === "Completed").length,
    missed: followUps.filter((f) => f.status === "Missed").length,
  };

  const handleView = (followUp) => {
    setSelectedFollowUp(followUp);
    setShowDetailModal(true);
  };

  const handleAvailabilityChange = (followUpId, availability) => {
    setFollowUps(prev => prev.map(f => 
      f.id === followUpId ? { ...f, availability } : f
    ));
    if (selectedFollowUp && selectedFollowUp.id === followUpId) {
      setSelectedFollowUp({ ...selectedFollowUp, availability });
    }
  };

  return (
    <>
      <PageHeader
        crumbs={["Home", "Follow-ups"]}
        title="Follow-up Schedule"
        subtitle="View your upcoming and completed follow-up appointments with your Barangay Health Worker."
      />

      {/* Summary Cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card className="p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-brand-accent/10 flex items-center justify-center">
              <Calendar className="w-5 h-5 text-brand-accent" />
            </div>
            <div>
              <p className="text-sm text-brand-gray">Upcoming Follow-ups</p>
              <p className="text-2xl font-semibold text-brand-ink mt-1">{stats.upcoming}</p>
            </div>
          </div>
          <p className="text-xs text-brand-gray">Your next scheduled visit</p>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-brand-blue/10 flex items-center justify-center">
              <Clock className="w-5 h-5 text-brand-blue" />
            </div>
            <div>
              <p className="text-sm text-brand-gray">Today's Follow-up</p>
              <p className="text-2xl font-semibold text-brand-ink mt-1">{stats.today > 0 ? stats.today : "No Appointment"}</p>
            </div>
          </div>
          <p className="text-xs text-brand-gray">{stats.today > 0 ? `${stats.today} Today` : "No appointments today"}</p>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-brand-green/10 flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-brand-green" />
            </div>
            <div>
              <p className="text-sm text-brand-gray">Completed Follow-ups</p>
              <p className="text-2xl font-semibold text-brand-ink mt-1">{stats.completed}</p>
            </div>
          </div>
          <p className="text-xs text-brand-gray">Completed visits</p>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-brand-danger/10 flex items-center justify-center">
              <XCircle className="w-5 h-5 text-brand-danger" />
            </div>
            <div>
              <p className="text-sm text-brand-gray">Missed Follow-ups</p>
              <p className="text-2xl font-semibold text-brand-ink mt-1">{stats.missed}</p>
            </div>
          </div>
          <p className="text-xs text-brand-gray">{stats.missed > 0 ? "Reschedule required" : "No missed appointments"}</p>
        </Card>
      </div>

      {/* Follow-up List */}
      <Card className="p-6">
        <h3 className="font-semibold text-brand-ink mb-4">Your Follow-up Appointments</h3>
        
        {followUps.length === 0 ? (
          <div className="text-center py-12">
            <Calendar className="w-12 h-12 text-brand-gray mx-auto mb-4" />
            <p className="text-brand-gray">No follow-up appointments have been scheduled yet.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {followUps.map((f, i) => (
              <motion.div
                key={f.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="border border-brand-border rounded-xl p-4 hover:border-brand-blue/30 transition-colors cursor-pointer"
                onClick={() => handleView(f)}
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-brand-blue/10 flex items-center justify-center shrink-0">
                        <Calendar className="w-5 h-5 text-brand-blue" />
                      </div>
                      <div className="flex-1">
                        <h4 className="font-medium text-brand-ink">{f.purpose}</h4>
                        <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-brand-gray">
                          <div className="flex items-center gap-1">
                            <Calendar className="w-4 h-4" />
                            {f.date}
                          </div>
                          <div className="flex items-center gap-1">
                            <Clock className="w-4 h-4" />
                            {f.time}
                          </div>
                          <div className="flex items-center gap-1">
                            <MapPin className="w-4 h-4" />
                            {f.location}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 sm:mt-0 mt-3">
                    <StatusBadge value={f.status} />
                    <button className="p-2 text-brand-blue hover:bg-brand-light rounded-lg transition-colors">
                      <Eye className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                {f.remarks && (
                  <p className="text-sm text-brand-gray mt-3 ml-13">{f.remarks}</p>
                )}
                {f.availability && (
                  <div className="mt-3 pt-3 border-t border-brand-border ml-13">
                    <p className="text-xs text-brand-gray mb-1">Availability</p>
                    <div className="flex items-center gap-2">
                      {f.availability === "Available" && <div className="w-2 h-2 rounded-full bg-brand-green" />}
                      {f.availability === "Not Available" && <div className="w-2 h-2 rounded-full bg-brand-danger" />}
                      {f.availability === "Waiting for Confirmation" && <div className="w-2 h-2 rounded-full bg-brand-yellow" />}
                      <span className="text-sm text-brand-ink">{f.availability}</span>
                    </div>
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </Card>

      {/* Detail Modal */}
      {showDetailModal && selectedFollowUp && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-base font-semibold text-brand-ink">Follow-up Details</h3>
                <button
                  onClick={() => setShowDetailModal(false)}
                  className="text-brand-gray hover:text-brand-ink"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <p className="text-xs text-brand-gray mb-1">Purpose</p>
                  <p className="text-sm font-medium text-brand-ink">{selectedFollowUp.purpose}</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-brand-gray mb-1">Scheduled Date</p>
                    <p className="text-sm text-brand-ink">{selectedFollowUp.date}</p>
                  </div>
                  <div>
                    <p className="text-xs text-brand-gray mb-1">Time</p>
                    <p className="text-sm text-brand-ink">{selectedFollowUp.time}</p>
                  </div>
                </div>

                <div>
                  <p className="text-xs text-brand-gray mb-1">Location</p>
                  <p className="text-sm text-brand-ink flex items-center gap-2">
                    <MapPin className="w-4 h-4" />
                    {selectedFollowUp.location}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-brand-gray mb-1">Status</p>
                  <StatusBadge value={selectedFollowUp.status} />
                </div>

                {selectedFollowUp.instructions && (
                  <div>
                    <p className="text-xs text-brand-gray mb-1">Instructions</p>
                    <p className="text-sm text-brand-ink">{selectedFollowUp.instructions}</p>
                  </div>
                )}

                {selectedFollowUp.healthWorkerNotes && (
                  <div>
                    <p className="text-xs text-brand-gray mb-1">Health Worker Notes</p>
                    <p className="text-sm text-brand-ink">{selectedFollowUp.healthWorkerNotes}</p>
                  </div>
                )}

                {selectedFollowUp.remarks && (
                  <div>
                    <p className="text-xs text-brand-gray mb-1">Remarks</p>
                    <p className="text-sm text-brand-ink">{selectedFollowUp.remarks}</p>
                  </div>
                )}

                {(selectedFollowUp.status === "Upcoming" || selectedFollowUp.status === "Scheduled") && (
                  <div className="pt-4 border-t border-brand-border">
                    <p className="text-xs text-brand-gray mb-2">Availability</p>
                    <div className="flex gap-3">
                      <button
                        onClick={() => handleAvailabilityChange(selectedFollowUp.id, "Available")}
                        className={`flex-1 px-4 py-2 rounded-btn text-sm font-medium transition-colors ${
                          selectedFollowUp.availability === "Available"
                            ? "bg-brand-green text-white border-brand-green"
                            : "bg-white text-brand-green border border-brand-green hover:bg-brand-green/10"
                        }`}
                      >
                        ✓ Available
                      </button>
                      <button
                        onClick={() => handleAvailabilityChange(selectedFollowUp.id, "Not Available")}
                        className={`flex-1 px-4 py-2 rounded-btn text-sm font-medium transition-colors ${
                          selectedFollowUp.availability === "Not Available"
                            ? "bg-brand-danger text-white border-brand-danger"
                            : "bg-white text-brand-danger border border-brand-danger hover:bg-brand-danger/10"
                        }`}
                      >
                        ✕ Not Available
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-6 pt-4 border-t border-brand-border">
                <button
                  onClick={() => setShowDetailModal(false)}
                  className="w-full px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
