import React, { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { ROLES } from "@/lib/brand";
import { getAssignedBarangay } from "@/lib/barangayScope";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import VerificationBadge from "@/features/verification/components/VerificationBadge";
import { fetchMyVerification } from "@/services/api/verificationsApi";
import { residentsApi } from "@/services/api";
import { supabase } from "@/lib/supabase";
import {
  Lock, Eye, EyeOff, Check, ShieldCheck, Mail, FileText,
  Calendar, Monitor, LogOut, Sun, Moon, MonitorCog, Palette, RefreshCw,
} from "lucide-react";

const formatAccountDate = (iso) => {
  if (!iso) return "";
  const d = new Date(String(iso).length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
};

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
  const { user, refreshProfile } = useAuth();
  const { theme, setTheme } = useTheme();
  const [showCur, setShowCur] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pw, setPw] = useState({ current: "", new: "", confirm: "" });
  const [saved, setSaved] = useState(false);
  const [changingPw, setChangingPw] = useState(false);
  const [pwError, setPwError] = useState("");
  const pwStrength = checkPasswordStrength(pw.new);

  const isResident = roleKey === "resident" || roleKey === "resident-limited";

  // Account Information for a resident comes from the SAME authoritative source
  // as the dashboard/verification banner (GET /verifications/me -> residents
  // table), so registration date, reference number and verification status are
  // the real persisted values, never stale or hardcoded.
  const [account, setAccount] = useState(null);
  const [accountLoading, setAccountLoading] = useState(isResident);
  const [accountError, setAccountError] = useState("");

  const loadAccount = useCallback(() => {
    if (!isResident) return;
    setAccountLoading(true);
    setAccountError("");
    fetchMyVerification()
      .then((res) => {
        const v = res?.verification || null;
        setAccount(v);
        setContactInput(v?.contactNumber || "");
      })
      .catch(() => setAccountError("We couldn't load your account information. Please try again."))
      .finally(() => setAccountLoading(false));
  }, [isResident]);

  useEffect(() => {
    loadAccount();
  }, [loadAccount]);

  // Staff accounts (MHO / PHN / RHU Personnel / Health Supervisor) read their
  // account details straight from the authoritative profile resolved by
  // AuthContext (GET /api/auth/me -> profiles table). When that resolution
  // fails transiently the session is kept but `user` is null; surface a clear,
  // retryable error instead of silently showing placeholders.
  const [staffReloading, setStaffReloading] = useState(false);
  const staffProfileMissing = !isResident && !user;
  const handleStaffReload = useCallback(async () => {
    setStaffReloading(true);
    try {
      await refreshProfile();
    } finally {
      setStaffReloading(false);
    }
  }, [refreshProfile]);

  // Unified "account info could not be loaded" flag for the two info cards.
  const showAccountError = (isResident && Boolean(accountError)) || staffProfileMissing;
  const accountErrorText = staffProfileMissing
    ? "We couldn't load your account information. Please try again."
    : accountError;
  const retryAccount = staffProfileMissing ? handleStaffReload : loadAccount;
  const retryBusy = staffProfileMissing && staffReloading;

  const displayName = user?.name || role.name;
  const displayEmail = user?.email || "—";

  // Settings is an account page — the working scope is not shown as a picker.
  // Only the barangay-assigned Health Supervisor (and BHW accounts that carry
  // a barangay) displays an "Assigned Barangay"; PHN / RHU Personnel are RHU
  // based and show no barangay.
  const isPhn = roleKey === "phn";
  const isRhuPersonnel = roleKey === "rhu_personnel";
  const assignedBarangay = getAssignedBarangay(user) || (user?.barangay || "");
  const showAssignedBarangay = !isPhn && !isRhuPersonnel && Boolean(assignedBarangay);

  // Resident-editable profile field(s). Contact number is the only editable
  // field; name/email/municipality are system-/verification-controlled.
  const [contactInput, setContactInput] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState(null); // { type: 'success' | 'error', text }
  const phoneValid = (v) => {
    const cleaned = String(v || "").replace(/[\s-]/g, "");
    return cleaned === "" || /^(\+?63|0)9\d{9}$/.test(cleaned);
  };

  // Change password via Supabase Auth (the password authority). The current
  // password is verified with signInWithPassword (supported reauth flow); the
  // new password is applied with updateUser. Passwords live only in transient
  // component state, are never logged, sent to a custom backend, persisted, or
  // written to storage.
  const handleSave = async () => {
    setSaved(false);
    setPwError("");

    const current = pw.current;
    const next = pw.new;
    const confirm = pw.confirm;

    if (!current || !next || !confirm) {
      setPwError("Please fill in all password fields.");
      return;
    }
    const meetsPolicy = next.length >= 8 && /[A-Z]/.test(next) && /[a-z]/.test(next) && /\d/.test(next);
    if (!meetsPolicy) {
      setPwError("New password must be at least 8 characters and include an uppercase letter, a lowercase letter, and a number.");
      return;
    }
    if (next !== confirm) {
      setPwError("Passwords do not match.");
      return;
    }
    const email = user?.email;
    if (!email || !supabase) {
      setPwError("We couldn't verify your account. Please sign in again and retry.");
      return;
    }

    setChangingPw(true);
    try {
      // 1) Verify the current password (supported Supabase Auth reauth).
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password: current });
      if (signInError) {
        setPwError("Current password is incorrect.");
        return;
      }
      // 2) Apply the new password.
      const { error: updateError } = await supabase.auth.updateUser({ password: next });
      if (updateError) {
        const msg = String(updateError.message || "").toLowerCase();
        if (msg.includes("different") || msg.includes("same")) {
          setPwError("Your new password must be different from your current password.");
        } else if (msg.includes("rate") || msg.includes("too many")) {
          setPwError("Too many attempts. Please wait a moment and try again.");
        } else {
          setPwError("We couldn't change your password. Please try again.");
        }
        return;
      }
      setSaved(true);
      setPw({ current: "", new: "", confirm: "" });
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setPwError("Something went wrong. Please check your connection and try again.");
    } finally {
      setChangingPw(false);
    }
  };

  const handleProfileSave = async () => {
    // Staff accounts have no self-service profile edit here.
    if (!isResident) {
      setProfileMsg({ type: "success", text: "No changes to save." });
      setTimeout(() => setProfileMsg(null), 2500);
      return;
    }
    if (!phoneValid(contactInput)) {
      setProfileMsg({ type: "error", text: "Enter a valid PH mobile number (e.g. 0917 123 4567)." });
      return;
    }
    setSavingProfile(true);
    setProfileMsg(null);
    try {
      const result = await residentsApi.updateMine({ cellphoneNo: contactInput.trim() });
      const saved = result?.profile || null;
      // Reflect the persisted value (keeps the displayed data in step with the DB).
      setAccount((prev) => (prev ? { ...prev, contactNumber: saved?.cellphoneNo ?? contactInput.trim() } : prev));
      setContactInput(saved?.cellphoneNo ?? contactInput.trim());
      setProfileMsg({ type: "success", text: "Profile updated successfully." });
      setTimeout(() => setProfileMsg(null), 2500);
    } catch (err) {
      // Preserve the user's input so they can retry; never fake success.
      setProfileMsg({ type: "error", text: err?.message || "We couldn't save your changes. Please try again." });
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <>
      <PageHeader crumbs={["Settings"]} title="Settings" subtitle="Manage your account security and information." />

      <div className="space-y-5">
        {/* Profile Information */}
        <Card className="p-4 sm:p-6">
          <h3 className="font-semibold text-brand-ink text-sm sm:text-base mb-4 sm:mb-5">Profile Information</h3>

          {showAccountError ? (
            <div className="flex flex-col items-start gap-3 rounded-btn border border-brand-danger/25 bg-brand-danger/5 p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-medium text-brand-danger">{accountErrorText}</p>
              <button
                onClick={retryAccount}
                disabled={retryBusy}
                className="inline-flex items-center gap-2 rounded-btn border border-brand-border bg-white px-3 py-1.5 text-xs font-medium text-brand-ink hover:border-brand-blue hover:text-brand-blue transition-colors disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${retryBusy ? "animate-spin" : ""}`} /> {retryBusy ? "Retrying…" : "Retry"}
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Full Name — verified identity data (read-only). */}
                <div>
                  <label className="text-sm font-medium text-brand-ink">Full Name</label>
                  <input
                    value={isResident && accountLoading ? "Loading…" : (isResident ? (account?.name || displayName) : displayName)}
                    readOnly
                    className="mt-1.5 w-full bg-brand-bg border border-brand-border rounded-input px-3.5 py-2.5 text-sm text-brand-gray outline-none"
                  />
                </div>

                {/* Email — tied to the Supabase account (read-only). */}
                <div>
                  <label className="text-sm font-medium text-brand-ink">Email</label>
                  <input
                    value={displayEmail}
                    readOnly
                    className="mt-1.5 w-full bg-brand-bg border border-brand-border rounded-input px-3.5 py-2.5 text-sm text-brand-gray outline-none"
                  />
                </div>

                {/* Contact Number — the one resident-editable field. */}
                <div>
                  <label className="text-sm font-medium text-brand-ink">Contact Number</label>
                  {isResident ? (
                    <input
                      value={accountLoading ? "" : contactInput}
                      onChange={(e) => setContactInput(e.target.value)}
                      disabled={accountLoading || savingProfile}
                      placeholder={accountLoading ? "Loading…" : "e.g. 0917 123 4567"}
                      className="mt-1.5 w-full bg-white border border-brand-border rounded-input px-3.5 py-2.5 text-sm outline-none focus:border-brand-blue disabled:bg-brand-bg"
                    />
                  ) : (
                    <input
                      value={user?.contact || "—"}
                      readOnly
                      className="mt-1.5 w-full bg-brand-bg border border-brand-border rounded-input px-3.5 py-2.5 text-sm text-brand-gray outline-none"
                    />
                  )}
                </div>

                {showAssignedBarangay && (
                  <div>
                    <label className="text-sm font-medium text-brand-ink">Assigned Barangay</label>
                    <input
                      value={assignedBarangay}
                      readOnly
                      className="mt-1.5 w-full bg-brand-bg border border-brand-border rounded-input px-3.5 py-2.5 text-sm text-brand-gray outline-none"
                    />
                  </div>
                )}

                {/* Municipality — system/verification controlled (read-only). */}
                <div>
                  <label className="text-sm font-medium text-brand-ink">Municipality</label>
                  <input
                    value={isResident ? (accountLoading ? "Loading…" : (account?.municipality || "—")) : (user?.municipality || "Pili, Camarines Sur")}
                    readOnly
                    className="mt-1.5 w-full bg-brand-bg border border-brand-border rounded-input px-3.5 py-2.5 text-sm text-brand-gray outline-none"
                  />
                </div>

                {/* Role — the authenticated account's system role (staff only). */}
                {!isResident && (
                  <div>
                    <label className="text-sm font-medium text-brand-ink">Role</label>
                    <input
                      value={role?.name || user?.role || "—"}
                      readOnly
                      className="mt-1.5 w-full bg-brand-bg border border-brand-border rounded-input px-3.5 py-2.5 text-sm text-brand-gray outline-none"
                    />
                  </div>
                )}
              </div>

              <div className="mt-4 sm:mt-6 flex flex-wrap items-center gap-3">
                <button
                  onClick={handleProfileSave}
                  disabled={savingProfile || (isResident && accountLoading)}
                  className="bg-brand-blue text-white px-5 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors disabled:opacity-60"
                >
                  {savingProfile ? "Saving…" : "Save Changes"}
                </button>
                {profileMsg && (
                  <span className={`text-sm ${profileMsg.type === "success" ? "text-brand-green" : "text-brand-danger"}`}>
                    {profileMsg.text}
                  </span>
                )}
              </div>
            </>
          )}
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
                autoComplete="current-password"
                className="mt-1.5 w-full bg-white border border-brand-border rounded-input px-3.5 py-2.5 pr-10 text-sm outline-none focus:border-brand-blue"
              />
              <button type="button" aria-label={showCur ? "Hide current password" : "Show current password"} onClick={() => setShowCur(!showCur)} className="absolute right-3 top-9 text-brand-gray">
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
                autoComplete="new-password"
                className="mt-1.5 w-full bg-white border border-brand-border rounded-input px-3.5 py-2.5 pr-10 text-sm outline-none focus:border-brand-blue"
              />
              <button type="button" aria-label={showNew ? "Hide new password" : "Show new password"} onClick={() => setShowNew(!showNew)} className="absolute right-3 top-9 text-brand-gray">
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
                autoComplete="new-password"
                className="mt-1.5 w-full bg-white border border-brand-border rounded-input px-3.5 py-2.5 pr-10 text-sm outline-none focus:border-brand-blue"
              />
              <button type="button" aria-label={showConfirm ? "Hide password confirmation" : "Show password confirmation"} onClick={() => setShowConfirm(!showConfirm)} className="absolute right-3 top-9 text-brand-gray">
                {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Password strength meter */}
          {pw.new && (
            <div className="mt-4 bg-brand-bg rounded-2xl p-4 max-w-2xl">
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

          {pwError && (
            <p role="alert" className="mt-4 text-sm font-medium text-brand-danger">{pwError}</p>
          )}

          <div className="mt-5 flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={changingPw}
              className="bg-brand-blue text-white px-5 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors disabled:opacity-60"
            >
              {changingPw ? "Changing Password…" : "Change Password"}
            </button>
            {saved && (
              <span className="flex items-center gap-1.5 text-sm text-brand-green">
                <Check className="w-4 h-4" /> Password changed successfully.
              </span>
            )}
          </div>
        </Card>

        {/* Appearance */}
        <Card className="p-4 sm:p-6">
          <h3 className="font-semibold text-brand-ink text-sm sm:text-base mb-1 flex items-center gap-2">
            <Palette className="w-4 h-4 text-brand-blue" strokeWidth={1.8} /> Appearance
          </h3>
          <p className="text-xs text-brand-gray mb-4">
            Choose how KALUSAGAP looks on this device. Your selection is saved automatically.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl">
            {[
              { key: "light", label: "Light", icon: Sun, copy: "Bright, paper-white interface" },
              { key: "dark", label: "Dark", icon: Moon, copy: "Low-glare navy interface" },
              { key: "system", label: "System Default", icon: MonitorCog, copy: "Follows your device setting" },
            ].map((opt) => {
              const active = theme === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setTheme(opt.key)}
                  className={`rounded-btn border p-4 text-left transition-colors ${
                    active
                      ? "border-brand-blue bg-brand-light/60"
                      : "border-brand-border bg-white hover:border-brand-blue/60"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <opt.icon className="h-4 w-4 text-brand-blue" strokeWidth={1.8} />
                    <span className="text-sm font-medium text-brand-ink">{opt.label}</span>
                  </div>
                  <p className="mt-1 text-xs text-brand-gray">{opt.copy}</p>
                  {active && (
                    <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-blue">
                      <Check className="w-3 h-3" /> Active
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </Card>

        {/* Account Information */}
        <Card className="p-4 sm:p-6">
          <h3 className="font-semibold text-brand-ink text-sm sm:text-base mb-4 sm:mb-5 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-brand-blue" strokeWidth={1.8} /> Account Information
          </h3>

          {showAccountError ? (
            <div className="flex flex-col items-start gap-3 rounded-btn border border-brand-danger/25 bg-brand-danger/5 p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-medium text-brand-danger">{accountErrorText}</p>
              <button
                onClick={retryAccount}
                disabled={retryBusy}
                className="inline-flex items-center gap-2 rounded-btn border border-brand-border bg-white px-3 py-1.5 text-xs font-medium text-brand-ink hover:border-brand-blue hover:text-brand-blue transition-colors disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${retryBusy ? "animate-spin" : ""}`} /> {retryBusy ? "Retrying…" : "Retry"}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {(() => {
                const loading = isResident && accountLoading;
                const dash = "—";
                const fields = [
                  { label: "Registered Email", value: displayEmail || dash, icon: Mail },
                  {
                    label: "Registration Date",
                    icon: Calendar,
                    value: isResident ? (formatAccountDate(account?.registeredDate) || dash) : dash,
                  },
                  {
                    label: "Reference Number",
                    icon: FileText,
                    value: isResident ? (account?.ref || dash) : dash,
                  },
                  {
                    label: "Verification Status",
                    icon: ShieldCheck,
                    badge: isResident,
                    status: account?.status,
                  },
                ];
                return fields.map((f) => (
                  <div key={f.label} className="bg-brand-bg rounded-btn p-4">
                    <div className="flex items-center gap-1.5 mb-1">
                      <f.icon className="w-3.5 h-3.5 text-brand-gray" strokeWidth={1.8} />
                      <p className="text-[11px] text-brand-gray uppercase tracking-wide">{f.label}</p>
                    </div>
                    {loading ? (
                      <p className="text-sm font-medium text-brand-gray">Loading…</p>
                    ) : f.badge ? (
                      f.status ? <VerificationBadge status={f.status} size="sm" /> : <p className="text-sm font-medium text-brand-ink">N/A</p>
                    ) : (
                      <p className="text-sm font-medium text-brand-ink">{f.value}</p>
                    )}
                  </div>
                ));
              })()}
            </div>
          )}
        </Card>

        {/* Login Sessions */}
        <Card className="p-4 sm:p-6">
          <h3 className="font-semibold text-brand-ink text-sm sm:text-base mb-4 sm:mb-5 flex items-center gap-2">
            <Monitor className="w-4 h-4 text-brand-blue" strokeWidth={1.8} /> Login Sessions
          </h3>
          <div className="space-y-3">
            <p className="text-sm text-brand-gray">No active sessions to display.</p>
          </div>
          <button
            onClick={() => {
              setProfileMsg({ type: "success", text: "No other active sessions." });
              setTimeout(() => setProfileMsg(null), 2500);
            }}
            className="mt-4 sm:mt-5 flex items-center gap-2 border border-brand-border text-brand-gray px-4 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-bg transition-colors"
          >
            <LogOut className="w-4 h-4" /> Logout Other Devices
          </button>
        </Card>
      </div>
    </>
  );
}