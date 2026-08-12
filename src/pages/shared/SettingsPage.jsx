import React, { useState } from "react";
import PageHeader from "@/components/shared/PageHeader";
import { Card } from "@/components/shared/Card";
import { ROLES } from "@/lib/brand";
import VerificationBadge from "@/components/shared/VerificationBadge";
import {
  Lock, Eye, EyeOff, Check, ShieldCheck, Mail, MapPin, FileText,
  Calendar, Monitor, Smartphone, LogOut,
} from "lucide-react";

function checkPasswordStrength(pw) {
  const checks = [
    { label: "Minimum 8 characters", pass: pw.length >= 8 },
    { label: "Uppercase letter", pass: /[A-Z]/.test(pw) },
    { label: "Lowercase letter", pass: /[a-z]/.test(pw) },
    { label: "Number", pass: /\d/.test(pw) },
    { label: "Special character", pass: /[^A-Za-z0-9]/.test(pw) },
  ];
  const score = checks.filter((c) => c.pass).length;
  return { checks, score };
}

export default function SettingsPage({ roleKey = "resident" }) {
  const role = ROLES[roleKey];
  const [showCur, setShowCur] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pw, setPw] = useState({ current: "", new: "", confirm: "" });
  const [saved, setSaved] = useState(false);
  const pwStrength = checkPasswordStrength(pw.new);

  const isResident = roleKey === "resident";

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    setPw({ current: "", new: "", confirm: "" });
  };

  return (
    <>
      <PageHeader crumbs={["Home", "Settings"]} title="Settings" subtitle="Manage your account security and information." />

      <div className="space-y-5">
        {/* Profile Information */}
        <Card className="p-4 sm:p-6">
          <h3 className="font-semibold text-brand-ink text-sm sm:text-base mb-4 sm:mb-5">Profile Information</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { label: "Full Name", value: role.name },
              { label: "Role", value: role.label },
              { label: "Email", value: `${role.name.split(" ")[0].toLowerCase()}@pili.gov.ph` },
              { label: "Contact Number", value: "0917 123 4567" },
              { label: "Barangay", value: "San Jose" },
              { label: "Municipality", value: "Pili, Camarines Sur" },
            ].map((f) => (
              <div key={f.label}>
                <label className="text-sm font-medium text-brand-ink">{f.label}</label>
                <input defaultValue={f.value} className="mt-1.5 w-full bg-white border border-brand-border rounded-input px-3.5 py-2.5 text-sm outline-none focus:border-brand-blue" />
              </div>
            ))}
          </div>
          <button className="mt-4 sm:mt-6 bg-brand-blue text-white px-5 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors">Save Changes</button>
        </Card>

        {/* Security: Change Password */}
        <Card className="p-4 sm:p-6">
          <h3 className="font-semibold text-brand-ink text-sm sm:text-base mb-4 sm:mb-5 flex items-center gap-2">
            <Lock className="w-4 h-4 text-brand-blue" strokeWidth={1.8} /> Change Password
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl">
            <div className="relative">
              <label className="text-sm font-medium text-brand-ink">Current Password</label>
              <input
                type={showCur ? "text" : "password"}
                value={pw.current}
                onChange={(e) => setPw({ ...pw, current: e.target.value })}
                placeholder="••••••••"
                className="mt-1.5 w-full bg-white border border-brand-border rounded-input px-3.5 py-2.5 pr-10 text-sm outline-none focus:border-brand-blue"
              />
              <button onClick={() => setShowCur(!showCur)} className="absolute right-3 top-9 text-brand-gray">
                {showCur ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <div className="relative">
              <label className="text-sm font-medium text-brand-ink">New Password</label>
              <input
                type={showNew ? "text" : "password"}
                value={pw.new}
                onChange={(e) => setPw({ ...pw, new: e.target.value })}
                placeholder="••••••••"
                className="mt-1.5 w-full bg-white border border-brand-border rounded-input px-3.5 py-2.5 pr-10 text-sm outline-none focus:border-brand-blue"
              />
              <button onClick={() => setShowNew(!showNew)} className="absolute right-3 top-9 text-brand-gray">
                {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <div className="relative">
              <label className="text-sm font-medium text-brand-ink">Confirm Password</label>
              <input
                type={showConfirm ? "text" : "password"}
                value={pw.confirm}
                onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
                placeholder="••••••••"
                className="mt-1.5 w-full bg-white border border-brand-border rounded-input px-3.5 py-2.5 pr-10 text-sm outline-none focus:border-brand-blue"
              />
              <button onClick={() => setShowConfirm(!showConfirm)} className="absolute right-3 top-9 text-brand-gray">
                {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Password strength meter */}
          {pw.new && (
            <div className="mt-4 bg-brand-bg rounded-card p-4 max-w-2xl">
              <div className="flex gap-1 mb-3">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex-1 h-1.5 rounded-full overflow-hidden bg-brand-border">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: i < pwStrength.score ? "100%" : "0%", background: ["#E74C3C", "#E74C3C", "#F5B400", "#2A7DE1", "#28B463"][pwStrength.score - 1] }}
                    />
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1.5">
                {pwStrength.checks.map((c, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-xs">
                    <div className={`w-3.5 h-3.5 rounded-full flex items-center justify-center ${c.pass ? "bg-brand-green/15" : "bg-brand-border"}`}>
                      {c.pass && <Check className="w-2.5 h-2.5 text-brand-green" strokeWidth={3} />}
                    </div>
                    <span className={c.pass ? "text-brand-ink" : "text-brand-gray"}>{c.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-5 flex items-center gap-3">
            <button
              onClick={handleSave}
              className="bg-brand-blue text-white px-5 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors"
            >
              Update Password
            </button>
            {saved && (
              <span className="flex items-center gap-1.5 text-sm text-brand-green">
                <Check className="w-4 h-4" /> Password updated successfully.
              </span>
            )}
          </div>
        </Card>

        {/* Account Information */}
        <Card className="p-4 sm:p-6">
          <h3 className="font-semibold text-brand-ink text-sm sm:text-base mb-4 sm:mb-5 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-brand-blue" strokeWidth={1.8} /> Account Information
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { label: "Registered Email", value: `${role.name.split(" ")[0].toLowerCase()}@pili.gov.ph`, icon: Mail },
              { label: "Registration Date", value: "January 15, 2026", icon: Calendar },
              { label: "Assigned Barangay", value: "San Jose", icon: MapPin },
              { label: "Reference Number", value: "KSG-2026-00012", icon: FileText },
              { label: "Verification Status", value: isResident ? "Verified" : "N/A", icon: ShieldCheck, badge: isResident },
            ].map((f) => (
              <div key={f.label} className="bg-brand-bg rounded-btn p-4">
                <div className="flex items-center gap-1.5 mb-1">
                  <f.icon className="w-3.5 h-3.5 text-brand-gray" strokeWidth={1.8} />
                  <p className="text-[11px] text-brand-gray uppercase tracking-wide">{f.label}</p>
                </div>
                {f.badge
                  ? <VerificationBadge status="verified" size="sm" />
                  : <p className="text-sm font-medium text-brand-ink">{f.value}</p>}
              </div>
            ))}
          </div>
        </Card>

        {/* Login Sessions */}
        <Card className="p-4 sm:p-6">
          <h3 className="font-semibold text-brand-ink text-sm sm:text-base mb-4 sm:mb-5 flex items-center gap-2">
            <Monitor className="w-4 h-4 text-brand-blue" strokeWidth={1.8} /> Login Sessions
          </h3>
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border border-brand-blue/30 bg-brand-blue/5 rounded-btn px-4 py-3.5 gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-brand-blue/15 flex items-center justify-center shrink-0">
                  <Monitor className="w-5 h-5 text-brand-blue" strokeWidth={1.8} />
                </div>
                <div>
                  <p className="text-sm font-medium text-brand-ink">Windows PC — Chrome</p>
                  <p className="text-xs text-brand-gray">Chrome on Windows 11 — Last login: July 6, 2026, 8:32 AM</p>
                </div>
              </div>
              <span className="text-xs font-medium text-brand-blue bg-brand-blue/10 px-2.5 py-1 rounded-full shrink-0">Current</span>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border border-brand-border rounded-btn px-4 py-3.5 gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-brand-bg flex items-center justify-center shrink-0">
                  <Smartphone className="w-5 h-5 text-brand-gray" strokeWidth={1.8} />
                </div>
                <div>
                  <p className="text-sm font-medium text-brand-ink">iPhone 14 — Safari</p>
                  <p className="text-xs text-brand-gray">Safari on iOS 17 — Last login: July 4, 2026, 6:15 PM</p>
                </div>
              </div>
              <button className="text-xs font-medium text-brand-danger hover:underline shrink-0">Logout</button>
            </div>
          </div>
          <button className="mt-4 sm:mt-5 flex items-center gap-2 border border-brand-border text-brand-gray px-4 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-bg transition-colors">
            <LogOut className="w-4 h-4" /> Logout Other Devices
          </button>
        </Card>
      </div>
    </>
  );
}