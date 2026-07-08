import React, { useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import PageHeader from "@/components/shared/PageHeader";
import { Card } from "@/components/shared/Card";
import StatusBadge from "@/components/shared/Badge";
import VerificationBadge from "@/components/shared/VerificationBadge";
import {
  ArrowLeft, User, MapPin, Calendar, Phone, Heart, FileText, ShieldCheck,
  CheckCircle2, XCircle, FileWarning, AlertTriangle, ImageIcon,
} from "lucide-react";

const RESIDENT = {
  name: "Juan Dela Cruz Reyes",
  email: "juan.reyes@email.com",
  barangay: "San Jose",
  registered: "July 5, 2026",
  ref: "KSG-2026-00428",
  age: 34,
  sex: "Male",
  civilStatus: "Married",
  mobile: "0917 234 5678",
  address: "Purok 5, Mabini St., San Jose, Pili, Camarines Sur",
  bloodType: "O+",
  height: "168 cm",
  weight: "72 kg",
  conditions: ["Hypertension"],
  allergies: "Penicillin",
  medications: "Amlodipine 5mg daily",
  documents: [
    { name: "National ID — Front", type: "image" },
    { name: "National ID — Back", type: "image" },
  ],
};

export default function ResidentVerification() {
  const [confirm, setConfirm] = useState(null); // "approve" | "reject" | "request"
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleConfirm = () => {
    setSubmitting(true);
    setTimeout(() => {
      setSubmitting(false);
      setConfirm(null);
    }, 1500);
  };

  return (
    <>
      <PageHeader
        crumbs={["Home", "Dashboard", "Verifications", "Review"]}
        title="Resident Verification"
        subtitle="Review the resident's submitted information and uploaded documents."
        action={
          <Link to="/app/bhw/verifications" className="flex items-center gap-2 text-sm font-medium text-brand-gray hover:text-brand-ink transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back to List
          </Link>
        }
      />

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Left Panel: Resident Details */}
        <div className="space-y-5">
          {/* Personal Info */}
          <Card className="p-6">
            <div className="flex items-center gap-4 mb-5">
              <div className="w-14 h-14 rounded-full bg-brand-blue text-white flex items-center justify-center text-lg font-heading font-semibold">
                {RESIDENT.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
              </div>
              <div>
                <h3 className="font-heading font-semibold text-brand-ink">{RESIDENT.name}</h3>
                <p className="text-xs text-brand-gray">{RESIDENT.email}</p>
                <div className="mt-1.5"><VerificationBadge status="pending" size="sm" /></div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Age", value: `${RESIDENT.age} years`, icon: User },
                { label: "Sex", value: RESIDENT.sex, icon: User },
                { label: "Civil Status", value: RESIDENT.civilStatus, icon: User },
                { label: "Mobile", value: RESIDENT.mobile, icon: Phone },
                { label: "Barangay", value: RESIDENT.barangay, icon: MapPin },
                { label: "Registered", value: RESIDENT.registered, icon: Calendar },
              ].map((f) => (
                <div key={f.label} className="bg-brand-bg rounded-btn p-3">
                  <div className="flex items-center gap-1.5">
                    <f.icon className="w-3.5 h-3.5 text-brand-gray" strokeWidth={1.8} />
                    <p className="text-[11px] text-brand-gray uppercase tracking-wide">{f.label}</p>
                  </div>
                  <p className="text-sm font-medium text-brand-ink mt-1">{f.value}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 bg-brand-bg rounded-btn p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <MapPin className="w-3.5 h-3.5 text-brand-gray" strokeWidth={1.8} />
                <p className="text-[11px] text-brand-gray uppercase tracking-wide">Address</p>
              </div>
              <p className="text-sm font-medium text-brand-ink">{RESIDENT.address}</p>
            </div>
          </Card>

          {/* Health Info */}
          <Card className="p-6">
            <h3 className="font-heading font-semibold text-brand-ink mb-4 flex items-center gap-2">
              <Heart className="w-4 h-4 text-brand-blue" strokeWidth={1.8} /> Health Information
            </h3>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-brand-bg rounded-btn p-3">
                <p className="text-[11px] text-brand-gray uppercase tracking-wide">Blood Type</p>
                <p className="text-sm font-stat font-bold text-brand-ink mt-1">{RESIDENT.bloodType}</p>
              </div>
              <div className="bg-brand-bg rounded-btn p-3">
                <p className="text-[11px] text-brand-gray uppercase tracking-wide">Height</p>
                <p className="text-sm font-stat font-bold text-brand-ink mt-1">{RESIDENT.height}</p>
              </div>
              <div className="bg-brand-bg rounded-btn p-3">
                <p className="text-[11px] text-brand-gray uppercase tracking-wide">Weight</p>
                <p className="text-sm font-stat font-bold text-brand-ink mt-1">{RESIDENT.weight}</p>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex items-start justify-between border-b border-brand-border/50 pb-2">
                <span className="text-brand-gray">Conditions</span>
                <span className="font-medium text-brand-ink">{RESIDENT.conditions.join(", ")}</span>
              </div>
              <div className="flex items-start justify-between border-b border-brand-border/50 pb-2">
                <span className="text-brand-gray">Allergies</span>
                <span className="font-medium text-brand-ink">{RESIDENT.allergies}</span>
              </div>
              <div className="flex items-start justify-between">
                <span className="text-brand-gray">Medications</span>
                <span className="font-medium text-brand-ink text-right">{RESIDENT.medications}</span>
              </div>
            </div>
          </Card>
        </div>

        {/* Right Panel: Document Preview & Actions */}
        <div className="space-y-5">
          {/* Documents */}
          <Card className="p-6">
            <h3 className="font-heading font-semibold text-brand-ink mb-4 flex items-center gap-2">
              <FileText className="w-4 h-4 text-brand-blue" strokeWidth={1.8} /> Uploaded Documents
            </h3>
            <div className="space-y-3">
              {RESIDENT.documents.map((doc, i) => (
                <div key={i} className="border border-brand-border rounded-btn p-4 hover:border-brand-blue/30 transition-colors cursor-pointer group">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-lg bg-brand-blue/10 flex items-center justify-center shrink-0">
                      <ImageIcon className="w-5 h-5 text-brand-blue" strokeWidth={1.8} />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-brand-ink">{doc.name}</p>
                      <p className="text-xs text-brand-gray">{doc.type.toUpperCase()} — Click to preview</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Verification Notes */}
          <Card className="p-6">
            <h3 className="font-heading font-semibold text-brand-ink mb-4 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-brand-blue" strokeWidth={1.8} /> Verification Notes
            </h3>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add notes about this verification (optional for approve, required for reject)..."
              rows={4}
              className="w-full bg-white border border-brand-border rounded-input px-3.5 py-2.5 text-sm text-brand-ink outline-none focus:border-brand-blue resize-none"
            />
            <div className="mt-4 space-y-2.5">
              <button
                onClick={() => setConfirm("approve")}
                className="w-full flex items-center justify-center gap-2 bg-brand-green text-white py-3 rounded-btn text-sm font-medium hover:bg-brand-green/90 transition-colors shadow-soft"
              >
                <CheckCircle2 className="w-4 h-4" /> Approve Registration
              </button>
              <button
                onClick={() => setConfirm("request")}
                className="w-full flex items-center justify-center gap-2 border border-brand-border bg-white text-brand-gray py-3 rounded-btn text-sm font-medium hover:bg-brand-bg transition-colors"
              >
                <FileWarning className="w-4 h-4" /> Request Additional Documents
              </button>
              <button
                onClick={() => setConfirm("reject")}
                className="w-full flex items-center justify-center gap-2 border border-brand-danger/30 bg-brand-danger/5 text-brand-danger py-3 rounded-btn text-sm font-medium hover:bg-brand-danger/10 transition-colors"
              >
                <XCircle className="w-4 h-4" /> Reject Registration
              </button>
            </div>
          </Card>
        </div>
      </div>

      {/* Confirmation Dialog */}
      <AnimatePresence>
        {confirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !submitting && setConfirm(null)}
            className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-card shadow-float w-full max-w-md p-6"
            >
              <div className="flex items-start gap-4">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
                  confirm === "approve" ? "bg-brand-green/15" : confirm === "reject" ? "bg-brand-danger/15" : "bg-brand-yellow/20"
                }`}>
                  {confirm === "approve" ? <CheckCircle2 className="w-6 h-6 text-brand-green" /> : confirm === "reject" ? <XCircle className="w-6 h-6 text-brand-danger" /> : <AlertTriangle className="w-6 h-6 text-brand-yellow" />}
                </div>
                <div>
                  <h3 className="font-heading font-semibold text-brand-ink">
                    {confirm === "approve" ? "Approve Registration?" : confirm === "reject" ? "Reject Registration?" : "Request Additional Documents?"}
                  </h3>
                  <p className="mt-1.5 text-sm text-brand-gray">
                    {confirm === "approve"
                      ? "This will verify the resident's account and grant dashboard access."
                      : confirm === "reject"
                        ? "This will reject the registration. The resident will be notified."
                        : "This will notify the resident to upload additional documents."}
                  </p>
                </div>
              </div>
              <div className="mt-6 flex items-center justify-end gap-3">
                <button
                  onClick={() => setConfirm(null)}
                  disabled={submitting}
                  className="px-5 py-2.5 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={submitting}
                  className={`px-5 py-2.5 rounded-btn text-sm font-medium text-white transition-colors flex items-center gap-2 disabled:opacity-60 ${
                    confirm === "approve" ? "bg-brand-green hover:bg-brand-green/90" : confirm === "reject" ? "bg-brand-danger hover:bg-brand-danger/90" : "bg-brand-blue hover:bg-brand-dark"
                  }`}
                >
                  {submitting ? "Processing..." : "Confirm"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}