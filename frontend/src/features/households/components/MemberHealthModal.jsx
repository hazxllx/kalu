import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, Activity, HeartPulse, NotebookPen, Lock, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/common/Card";
import EmptyState from "@/components/common/EmptyState";
import ErrorState from "@/components/common/ErrorState";
import { SkeletonList } from "@/components/common/Skeleton";
import { householdsApi } from "@/services/api";

/**
 * BHW Member Health Profile.
 *
 * A compact editor for the currently-implemented member-health fields
 * (anthropometrics + server-computed BMI, mortality, trans-out, remarks). It
 * lives inside the existing Household Profiling detail modal — opened per
 * member — and reuses `householdsApi.getMemberHealth` / `saveMemberHealth`.
 *
 * Member identity (name / birthday / age / sex / relationship) is READ-ONLY
 * here: it comes from the household member record and is edited through the
 * existing household member workflow, never duplicated.
 *
 * BMI is never typed. A live client preview is shown as the user edits, but the
 * BACKEND remains authoritative: on save the server recomputes BMI from
 * height/weight (clearing it to null — never 0 — when a measurement is
 * missing), and the server value is what we display and keep afterwards.
 *
 * No BMI classification (Underweight/Normal/…) or clinical interpretation is
 * shown — this phase records a calculated value only.
 */

const today = () => new Date().toISOString().slice(0, 10);

/** Live BMI preview (client only). Blank unless height AND weight are > 0. */
const previewBmi = (heightCm, weightKg) => {
  const h = Number(heightCm);
  const w = Number(weightKg);
  if (!heightCm || !weightKg || !Number.isFinite(h) || !Number.isFinite(w) || h <= 0 || w <= 0) {
    return "";
  }
  const hM = h / 100;
  return (Math.round((w / (hM * hM)) * 10) / 10).toFixed(1);
};

const EMPTY_FORM = {
  heightCm: "",
  weightKg: "",
  dateOfDeath: "",
  causeOfDeath: "",
  transOut: false,
  remarks: "",
};

const numberOrBlank = (v) => (v === null || v === undefined ? "" : String(v));

const inputCls =
  "mt-1.5 w-full rounded-input border border-brand-border bg-white px-3.5 py-2.5 text-sm text-brand-ink outline-none transition-colors focus:border-brand-blue disabled:cursor-not-allowed disabled:bg-brand-bg disabled:text-brand-gray";

const roField = (label, value) => (
  <div>
    <p className="text-[11px] uppercase tracking-wide text-brand-gray">{label}</p>
    <p className="mt-0.5 text-sm font-medium text-brand-ink">{value || "—"}</p>
  </div>
);

export default function MemberHealthModal({ householdId, member, verificationStatus, currentRole, onClose }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef(null);

  // The backend locks a verified household to the BHW; mirror that in the UI so
  // the collector sees a clear locked state instead of a raw 403. The backend
  // remains authoritative — this is UX only.
  const lockedForBhw = verificationStatus === "Verified" && currentRole === "bhw";

  const applyProfile = useCallback((p) => {
    setProfile(p || null);
    setForm({
      heightCm: numberOrBlank(p?.heightCm),
      weightKg: numberOrBlank(p?.weightKg),
      dateOfDeath: p?.dateOfDeath || "",
      causeOfDeath: p?.causeOfDeath || "",
      transOut: Boolean(p?.transOut),
      remarks: p?.remarks || "",
    });
  }, []);

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setSaveError(null);
    setSaved(false);
    try {
      const result = await householdsApi.getMemberHealth(householdId, member.id);
      applyProfile(result?.profile || null);
    } catch (err) {
      setLoadError(err?.message || "Unable to load health profile.");
    } finally {
      setLoading(false);
    }
  }, [householdId, member.id, applyProfile]);

  useEffect(() => {
    fetchProfile();
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, [fetchProfile]);

  const setField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const livePreview = useMemo(() => previewBmi(form.heightCm, form.weightKg), [form.heightCm, form.weightKg]);
  // Show the authoritative server BMI when the edited measurements still match
  // what was saved; otherwise show the live preview so the user sees the effect
  // of their edit before saving.
  const savedMatches =
    profile &&
    numberOrBlank(profile.heightCm) === String(form.heightCm ?? "") &&
    numberOrBlank(profile.weightKg) === String(form.weightKg ?? "");
  const bmiDisplay = savedMatches && profile?.bmi != null ? Number(profile.bmi).toFixed(1) : livePreview;

  const handleSave = async () => {
    if (saving || lockedForBhw) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const profileResult = await householdsApi.saveMemberHealth(householdId, member.id, {
        heightCm: form.heightCm === "" ? null : Number(form.heightCm),
        weightKg: form.weightKg === "" ? null : Number(form.weightKg),
        dateOfDeath: form.dateOfDeath || null,
        causeOfDeath: form.causeOfDeath,
        transOut: form.transOut,
        remarks: form.remarks,
      });
      // Re-display from the server response so the persisted, server-computed
      // BMI is what the user sees (never the client preview).
      applyProfile(profileResult?.profile || profileResult || null);
      setSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 3200);
    } catch (err) {
      if (err?.status === 403) {
        setSaveError(
          "Verified household — editing is locked. Ask the Health Supervisor to return it for correction before editing."
        );
      } else if (err?.status === 422) {
        const details = err?.payload?.error?.details;
        setSaveError(Array.isArray(details) && details.length ? details.join(" ") : err?.message || "Please correct the highlighted fields.");
      } else {
        setSaveError(err?.message || "Unable to save health profile.");
      }
    } finally {
      setSaving(false);
    }
  };

  const memberMeta = [member.relationship, member.sex, member.age != null ? `${member.age} yrs` : ""]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <Card className="max-h-[90vh] w-full max-w-xl overflow-y-auto">
        <div onClick={(e) => e.stopPropagation()} className="p-6">
          <div className="mb-5 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="gov-kicker text-[11px] text-brand-gray">Member Health Profile</p>
              <h3 className="truncate text-lg font-semibold text-brand-ink">{member.name}</h3>
              {memberMeta && <p className="mt-0.5 text-xs text-brand-gray">{memberMeta}</p>}
            </div>
            <button onClick={onClose} className="text-brand-gray hover:text-brand-ink" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>

          {loading && <SkeletonList rows={5} />}

          {!loading && loadError && (
            <ErrorState title="Unable to load health profile" message={loadError} onRetry={fetchProfile} />
          )}

          {!loading && !loadError && (
            <>
              {lockedForBhw && (
                <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>Verified household — editing is locked. The Health Supervisor must return it for correction before changes can be made.</span>
                </div>
              )}

              {!profile && !lockedForBhw && (
                <div className="mb-4">
                  <EmptyState
                    icon={HeartPulse}
                    title="No health profile recorded yet"
                    description="Enter the member's measurements and information below, then save."
                    className="py-4"
                  />
                </div>
              )}

              {/* Member Information (read-only) */}
              <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-5">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-gray">Member Information</p>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  {roField("Name", member.name)}
                  {roField("Birthday", member.birthday)}
                  {roField("Age", member.age != null ? `${member.age}` : "—")}
                  {roField("Sex", member.sex)}
                  {roField("Relationship", member.relationship)}
                  {roField("Linked Resident", member.residentId || "—")}
                </div>
                <p className="mt-3 text-[11px] text-brand-gray">
                  Identity details are read-only here. Edit them through the household member workflow.
                </p>
              </section>

              {/* Health Measurements */}
              <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-5">
                <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-brand-gray">
                  <Activity className="h-4 w-4 text-brand-blue" /> Health Measurements
                </p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <label className="text-sm font-medium text-brand-ink" htmlFor="mh-height">Height (cm)</label>
                    <input
                      id="mh-height"
                      type="number"
                      min="0"
                      step="0.1"
                      inputMode="decimal"
                      value={form.heightCm}
                      disabled={lockedForBhw}
                      onChange={(e) => setField("heightCm", e.target.value)}
                      className={inputCls}
                      placeholder="e.g. 170"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-brand-ink" htmlFor="mh-weight">Weight (kg)</label>
                    <input
                      id="mh-weight"
                      type="number"
                      min="0"
                      step="0.1"
                      inputMode="decimal"
                      value={form.weightKg}
                      disabled={lockedForBhw}
                      onChange={(e) => setField("weightKg", e.target.value)}
                      className={inputCls}
                      placeholder="e.g. 70"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-brand-ink" htmlFor="mh-bmi">BMI (auto)</label>
                    <input
                      id="mh-bmi"
                      type="text"
                      value={bmiDisplay || ""}
                      readOnly
                      disabled
                      tabIndex={-1}
                      className={`${inputCls} font-stat`}
                      placeholder="—"
                      aria-describedby="mh-bmi-hint"
                    />
                  </div>
                </div>
                <p id="mh-bmi-hint" className="mt-2 text-[11px] text-brand-gray">
                  BMI is calculated automatically from height and weight and cannot be entered manually. It is blank when either measurement is missing. The saved value is computed by the server.
                </p>
              </section>

              {/* Other Information */}
              <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-5">
                <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-brand-gray">
                  <NotebookPen className="h-4 w-4 text-brand-blue" /> Other Information
                </p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium text-brand-ink" htmlFor="mh-dod">Date of Death</label>
                    <input
                      id="mh-dod"
                      type="date"
                      max={today()}
                      value={form.dateOfDeath}
                      disabled={lockedForBhw}
                      onChange={(e) => setField("dateOfDeath", e.target.value)}
                      className={inputCls}
                    />
                    <p className="mt-1 text-[11px] text-brand-gray">Leave blank for living members.</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-brand-ink" htmlFor="mh-cod">Cause of Death</label>
                    <input
                      id="mh-cod"
                      type="text"
                      value={form.causeOfDeath}
                      disabled={lockedForBhw}
                      onChange={(e) => setField("causeOfDeath", e.target.value)}
                      className={inputCls}
                      placeholder="Recorded cause, if applicable"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="flex items-center gap-2.5 text-sm font-medium text-brand-ink">
                      <input
                        type="checkbox"
                        checked={form.transOut}
                        disabled={lockedForBhw}
                        onChange={(e) => setField("transOut", e.target.checked)}
                        className="h-4 w-4 accent-brand-blue"
                      />
                      Trans-out (for future deletion)
                    </label>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-sm font-medium text-brand-ink" htmlFor="mh-remarks">Remarks</label>
                    <textarea
                      id="mh-remarks"
                      rows={3}
                      value={form.remarks}
                      disabled={lockedForBhw}
                      onChange={(e) => setField("remarks", e.target.value)}
                      className={`${inputCls} resize-y`}
                      placeholder="Household/member notes"
                    />
                  </div>
                </div>
              </section>

              {saveError && (
                <p role="alert" className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-medium text-rose-700">
                  {saveError}
                </p>
              )}

              <div className="flex items-center justify-end gap-3">
                {saved && (
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-green">
                    <CheckCircle2 className="h-4 w-4" /> Saved
                  </span>
                )}
                <button
                  onClick={onClose}
                  className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg"
                >
                  Close
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || lockedForBhw}
                  className="rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save Health Profile"}
                </button>
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
