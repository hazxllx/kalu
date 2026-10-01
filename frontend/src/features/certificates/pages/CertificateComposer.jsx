import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { useAuth } from "@/context/AuthContext";
import { ROLES } from "@/lib/brand";
import { residentsApi, medicalCertificatesApi } from "@/services/api";
import { useCertificateMeta } from "@/features/certificates/hooks/useCertificateRegister";
import MedicalCertificateDocument from "../components/MedicalCertificateDocument";
import { useCertificatePrint } from "../components/useCertificatePrint.jsx";
import {
  Search, ChevronRight, ShieldAlert, Eye, Printer, RotateCcw, CheckCircle2, Users, Loader2, AlertCircle,
} from "lucide-react";

/** Roles authorized to prepare and print medical certificates. */
const AUTHORIZED_ROLES = ["mho", "phn", "rhu_personnel"];

const CIVIL_STATUSES = ["Single", "Married", "Widowed", "Separated"];

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * The resident directory API returns domain-shaped rows (firstName/middleName/
 * lastName, sex, birthDate) — not name/age/gender. Derive the display fields the
 * certificate UI needs so searching or selecting a resident can never crash on
 * an undefined `name`/`age`/`gender`.
 */
const residentFullName = (r) =>
  [r?.firstName, r?.middleName, r?.lastName, r?.suffix]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

const ageFromBirthDate = (iso) => {
  if (!iso) return "";
  const born = new Date(String(iso).length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(born.getTime())) return "";
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const m = now.getMonth() - born.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < born.getDate())) age -= 1;
  return age >= 0 && age < 200 ? age : "";
};

const initialsOf = (name) => {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return parts.map((p) => p[0]).slice(0, 2).join("").toUpperCase();
};

/**
 * Normalize an API resident row into the display shape the composer renders.
 * Existing name/age/gender values are respected; otherwise they are derived
 * from the canonical firstName/lastName/birthDate/sex fields.
 */
const normalizeResident = (r) => {
  if (!r) return r;
  const name = r.name || residentFullName(r) || String(r.id || "").trim() || "Unnamed resident";
  const age = r.age ?? ageFromBirthDate(r.birthDate);
  const gender = r.gender || r.sex || "";
  return { ...r, name, age, gender };
};

const inputCls = (error) =>
  `mt-1.5 w-full rounded-btn border bg-white px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-brand-blue dark:bg-input dark:text-foreground ${
    error ? "border-brand-danger" : "border-slate-200 dark:border-border"
  }`;
const labelCls = "text-sm font-medium text-brand-ink";

function Field({ label, required, error, hint, children }) {
  return (
    <div>
      <label className={labelCls}>
        {label} {required && <span className="text-brand-danger">*</span>}
      </label>
      {children}
      {error ? (
        <p className="mt-1 text-xs text-brand-danger">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-brand-gray">{hint}</p>
      ) : null}
    </div>
  );
}

const defaultForm = () => ({
  certificateNumber: "",
  civilStatus: "Single",
  dateExamined: todayIso(),
  diagnosis: "",
  recommendation: "",
  remarks: "",
  issuedAt: todayIso(),
});

export default function CertificateComposer() {
  const { user } = useAuth();
  const meta = useCertificateMeta();
  const [residents, setResidents] = useState([]);
  const [residentsError, setResidentsError] = useState("");

  // Real resident directory, scoped by the API to the caller's
  // barangay/municipality. No browser-local resident list.
  useEffect(() => {
    let active = true;
    residentsApi
      .list({ limit: 500 })
      .then((payload) => {
        if (active) setResidents(payload?.rows || payload?.records || []);
      })
      .catch((err) => active && setResidentsError(err?.message || "The resident directory could not be loaded."));
    return () => {
      active = false;
    };
  }, []);

  // Authorized healthcare personnel only — the route already sits inside the
  // role's protected area; this guard is a second line of defense.
  if (!AUTHORIZED_ROLES.includes(user?.role)) {
    return (
      <>
        <PageHeader crumbs={["Medical Certificates"]} title="Medical Certificate" subtitle="Prepare, preview, and print an official medical certificate." />
        <Card className="p-10 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-danger/10">
            <ShieldAlert className="h-7 w-7 text-brand-danger" />
          </div>
          <h3 className="mt-4 text-lg font-semibold text-brand-ink">Unauthorized</h3>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-brand-gray">
            Only authorized healthcare personnel can prepare medical certificates.
          </p>
        </Card>
      </>
    );
  }

  const base = `/app/${user.role}`;
  const roleLabel = ROLES[user.role]?.label || user.role;

  return (
    <ComposerContent
      base={base}
      roleLabel={roleLabel}
      residents={residents}
      residentsError={residentsError}
      purposes={meta.purposes}
    />
  );
}

function ComposerContent({ base, roleLabel, residents, residentsError, purposes }) {
  const { user } = useAuth();
  const { printCertificate, portal } = useCertificatePrint();

  const [patientQuery, setPatientQuery] = useState("");
  const [resident, setResident] = useState(null);
  const [form, setForm] = useState(() => ({ ...defaultForm(), certificateNumber: "" }));
  const [errors, setErrors] = useState({});
  const [previewOpen, setPreviewOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [savedId, setSavedId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // The certificate number is allocated by the API from real stored
  // references, so it is pre-filled rather than typed by the user.
  useEffect(() => {
    let active = true;
    medicalCertificatesApi
      .nextReference()
      .then((payload) => active && setForm((p) => ({ ...p, certificateNumber: payload?.reference || "" })))
      .catch(() => active && setForm((p) => ({ ...p, certificateNumber: "" })));
    return () => {
      active = false;
    };
  }, []);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  };

  const residentOptions = useMemo(() => {
    const q = patientQuery.trim().toLowerCase();
    return (Array.isArray(residents) ? residents : [])
      .map(normalizeResident)
      .filter(
        (r) =>
          !q ||
          r.name.toLowerCase().includes(q) ||
          String(r.id ?? "").toLowerCase().includes(q)
      )
      .slice(0, 6);
  }, [residents, patientQuery]);

  const set = (key) => (value) => {
    setForm((p) => ({ ...p, [key]: value }));
    if (errors[key]) setErrors((p) => ({ ...p, [key]: "" }));
  };

  /**
   * Authorized signatory — always the logged-in demo account's name (updates
   * when switching accounts). No name is invented; the account data carries
   * its own title (e.g. "Dr. Maria L. Santos") where applicable.
   */
  const officerName = String(user?.name || "").trim();

  /** Certificate payload assembled from the selected resident + form values. */
  const buildCertificate = () => ({
    patient: resident.name,
    patientId: resident.id,
    age: resident.age,
    sex: resident.gender,
    barangay: resident.barangay,
    address: resident.address || resident.barangay,
    purpose: purposes?.[0] || "General Medical Certificate",
    certificateNumber: form.certificateNumber.trim(),
    civilStatus: form.civilStatus,
    dateOfExamination: form.dateExamined,
    findings: form.diagnosis.trim(),
    recommendation: form.recommendation.trim(),
    remarks: form.remarks.trim(),
    // Print-only field: the official issuance date is stamped by the API when a
    // reviewer issues the certificate, but the preview shows the chosen date.
    issuedAt: form.issuedAt,
    preparedBy: user?.name || roleLabel,
    preparedByRole: roleLabel,
    medicalOfficer: officerName,
    licenseNumber: "",
  });

  /** The subset of fields the API accepts on create/update. */
  const writePayload = () => ({
    residentId: resident.id,
    purpose: purposes?.[0] || "General Medical Certificate",
    civilStatus: form.civilStatus,
    dateOfExamination: form.dateExamined,
    findings: form.diagnosis.trim(),
    recommendation: form.recommendation.trim(),
    remarks: form.remarks.trim(),
    medicalOfficer: officerName,
  });

  const validate = () => {
    const next = {};
    if (!resident) next.resident = "Please select a resident.";
    if (!form.dateExamined) next.dateExamined = "Date examined is required.";
    if (!form.diagnosis.trim()) next.diagnosis = "Diagnosis / medical impression is required.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handlePreview = () => {
    if (!validate()) {
      showToast("Please complete the required fields before previewing.");
      return;
    }
    setPreviewOpen(true);
  };

  /**
   * Print the certificate. Printing only persists the document data — it NEVER
   * changes the certificate status. The status workflow lives in the register:
   * Draft → For Review → Approved | Rejected → Issued, and only a PHN or the MHO
   * can move a certificate past "For Review".
   */
  const handlePrint = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      if (savedId) {
        await medicalCertificatesApi.update(savedId, writePayload());
      } else {
        const { record } = await medicalCertificatesApi.create(writePayload());
        setSavedId(record.id);
      }
      showToast("Certificate saved as Draft — printing does not issue the certificate.");
      printCertificate(buildCertificate(), officerName);
    } catch (err) {
      showToast(err?.message || "The certificate could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setResident(null);
    setPatientQuery("");
    setForm({ ...defaultForm(), certificateNumber: "" });
    setErrors({});
    setSavedId(null);
    setPreviewOpen(false);
    medicalCertificatesApi
      .nextReference()
      .then((payload) => setForm((p) => ({ ...p, certificateNumber: payload?.reference || "" })))
      .catch(() => {});
    showToast("Form reset.");
  };

  /**
   * Submit the certificate to the PHN / MHO for review and issuance. The
   * preparer (RHU Personnel / PHN) never issues a certificate directly: this
   * saves the document (creating it when needed) and moves it Draft → For
   * Review. Approval (MHO) and issuance are performed by the reviewer in the
   * register. The server re-validates both the role and the transition.
   */
  const handleSubmitForReview = async () => {
    if (!validate()) {
      showToast("Please complete the required fields before submitting.");
      return;
    }
    setSubmitting(true);
    try {
      let id = savedId;
      if (id) {
        await medicalCertificatesApi.update(id, writePayload());
      } else {
        const { record } = await medicalCertificatesApi.create(writePayload());
        id = record.id;
        setSavedId(id);
      }
      await medicalCertificatesApi.submitForReview(id);
      showToast("Certificate submitted to the PHN/MHO for review and issuance.");
      // Clear the form so the next certificate starts fresh and the submitted
      // one is not accidentally re-submitted or edited here.
      setResident(null);
      setPatientQuery("");
      setForm({ ...defaultForm(), certificateNumber: "" });
      setErrors({});
      setSavedId(null);
      setPreviewOpen(false);
      medicalCertificatesApi
        .nextReference()
        .then((payload) => setForm((p) => ({ ...p, certificateNumber: payload?.reference || "" })))
        .catch(() => {});
    } catch (err) {
      showToast(err?.message || "The certificate could not be submitted for review.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader
        crumbs={["Medical Certificates", "Issue Certificate"]}
        title="Medical Certificate"
        subtitle="Prepare, preview, and print an official medical certificate for the Municipality of Pili."
        action={
          <Link
            to={`${base}/certificates`}
            className="inline-flex items-center gap-2 rounded-btn border border-brand-border bg-white px-4 py-2.5 text-sm font-medium text-brand-gray transition-colors hover:bg-brand-bg dark:bg-card dark:hover:bg-hover"
          >
            <ChevronRight className="h-4 w-4 rotate-180" /> Back to Register
          </Link>
        }
      />

      {toast && (
        <div className="fixed bottom-4 right-4 z-[90] flex items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 text-white shadow-lg">
          <CheckCircle2 className="h-4 w-4 text-brand-green" />
          <span className="text-sm">{toast}</span>
        </div>
      )}

      {/* Patient selection */}
      <Card className="p-5 mb-5">
        <h3 className="mb-1 text-sm font-semibold text-brand-ink sm:text-base">Patient</h3>
        <p className="mb-3 text-xs text-brand-gray">Select a resident; their information auto-populates the certificate.</p>

        {!resident ? (
          <>
            <div className="flex items-center gap-2 rounded-input border border-slate-200 bg-brand-bg/60 px-3.5 py-2.5 dark:border-border dark:bg-input">
              <Search className="h-4 w-4 shrink-0 text-brand-gray" />
              <input
                value={patientQuery}
                onChange={(e) => setPatientQuery(e.target.value)}
                placeholder="Search resident by name or ID..."
                className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
              />
            </div>
            {residentsError && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-brand-danger">
                <AlertCircle className="h-3.5 w-3.5" /> {residentsError}
              </p>
            )}
            {patientQuery.trim() && (
              <div className="mt-2 max-h-56 overflow-y-auto rounded-btn border border-slate-200 divide-y divide-slate-200 dark:border-border dark:divide-border">
                {residentOptions.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => { setResident(r); setPatientQuery(""); if (errors.resident) setErrors((p) => ({ ...p, resident: "" })); }}
                    className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-brand-light dark:hover:bg-hover"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-light text-brand-blue text-xs font-semibold">
                      {initialsOf(r.name)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-brand-ink">{r.name}</span>
                      <span className="block text-xs text-brand-gray">
                        {[r.id, r.age !== "" ? `${r.age} yrs` : null, r.gender, r.barangay]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  </button>
                ))}
                {residentOptions.length === 0 && (
                  <p className="px-3.5 py-3 text-sm text-brand-gray">No residents found.</p>
                )}
              </div>
            )}
            {errors.resident && <p className="mt-2 text-xs text-brand-danger">{errors.resident}</p>}
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-btn border border-emerald-200 bg-emerald-50/70 px-3.5 py-2.5 dark:border-emerald-500/30 dark:bg-emerald-500/10">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400">
                <Users className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-brand-ink">{resident.name}</p>
                <p className="text-xs text-brand-gray">
                  {resident.id} · {resident.age} yrs · {resident.gender} · {resident.barangay}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setResident(null)}
              className="shrink-0 text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
            >
              Change patient
            </button>
          </div>
        )}
      </Card>

      {/* Certificate form */}
      {!resident ? (
        <Card className="p-10 text-center">
          <Eye className="mx-auto h-10 w-10 text-brand-gray/50" />
          <p className="mt-3 text-sm font-medium text-brand-ink">No Patient Selected</p>
          <p className="mt-1 text-xs text-brand-gray">
            Select a resident above to auto-populate patient information and continue with the certificate.
          </p>
        </Card>
      ) : (
        <>
          <Card className="p-5 mb-5">
            <h3 className="mb-4 text-sm font-semibold text-brand-ink sm:text-base">Certificate Information</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Certificate No." hint="Allocated automatically by the register.">
                <input
                  type="text"
                  readOnly
                  value={form.certificateNumber || "Allocating..."}
                  className={`${inputCls()} bg-brand-bg/60 dark:bg-card-nested`}
                />
              </Field>
              <Field label="Date Examined" required error={errors.dateExamined}>
                <input
                  type="date"
                  value={form.dateExamined}
                  onChange={(e) => set("dateExamined")(e.target.value)}
                  className={inputCls(errors.dateExamined)}
                />
              </Field>
              <Field label="Civil Status">
                <select value={form.civilStatus} onChange={(e) => set("civilStatus")(e.target.value)} className={`${inputCls()} cursor-pointer`}>
                  {CIVIL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Examining Healthcare Professional">
                <input
                  readOnly
                  value={`${user?.name || ""} — ${roleLabel}`}
                  className={`${inputCls()} bg-brand-bg/60 dark:bg-card-nested`}
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Diagnosis / Medical Impression" required error={errors.diagnosis}>
                  <textarea
                    rows={2}
                    value={form.diagnosis}
                    onChange={(e) => set("diagnosis")(e.target.value)}
                    placeholder="Clinical findings or medical impression to certify..."
                    className={`${inputCls(errors.diagnosis)} resize-none`}
                  />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Recommendation" hint="Printed on the certificate's recommendation lines.">
                  <textarea
                    rows={3}
                    value={form.recommendation}
                    onChange={(e) => set("recommendation")(e.target.value)}
                    placeholder="e.g. Rest for three days and follow up at the health station..."
                    className={`${inputCls()} resize-none`}
                  />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Remarks">
                  <input
                    type="text"
                    value={form.remarks}
                    onChange={(e) => set("remarks")(e.target.value)}
                    placeholder="Optional remarks..."
                    className={inputCls()}
                  />
                </Field>
              </div>
              <Field label="Issuance Date" hint="Stamped automatically when a reviewer issues the certificate.">
                <input
                  type="date"
                  value={form.issuedAt}
                  onChange={(e) => set("issuedAt")(e.target.value)}
                  className={inputCls()}
                />
              </Field>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 pt-4 dark:border-border">
              <button
                onClick={handleReset}
                className="inline-flex items-center gap-1.5 rounded-btn border border-brand-border bg-white px-4 py-2.5 text-sm font-medium text-brand-gray transition-colors hover:bg-brand-bg dark:bg-card dark:hover:bg-hover"
              >
                <RotateCcw className="h-4 w-4" /> Reset Form
              </button>
              <button
                onClick={handlePreview}
                className="inline-flex items-center gap-2 rounded-btn border border-brand-border bg-white px-5 py-2.5 text-sm font-medium text-brand-blue transition-colors hover:bg-brand-bg dark:bg-card dark:hover:bg-hover"
              >
                <Eye className="h-4 w-4" /> Preview Certificate
              </button>
              <button
                onClick={handleSubmitForReview}
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-btn bg-brand-blue px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Submit for Review
              </button>
            </div>
          </Card>

          <p className="text-center text-xs text-brand-gray">
            Submitting sends the certificate to the PHN / MHO for review and issuance. Preview and print produce a
            working copy and save it as a Draft — only a PHN or the MHO can approve and issue the official certificate.
          </p>
        </>
      )}

      {/* Certificate preview (formal A4 document) */}
      {previewOpen && resident && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4">
          <div className="flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-card">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-border">
              <div>
                <h3 className="text-base font-semibold text-brand-ink">Certificate Preview</h3>
                <p className="text-xs text-brand-gray">A4 official document — exactly what will be printed.</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handlePrint}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-btn border border-brand-border bg-white px-4 py-2 text-sm font-medium text-brand-blue transition-colors hover:bg-brand-bg disabled:opacity-60 dark:bg-card dark:hover:bg-hover"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />} Print Draft
                </button>
                <button
                  onClick={handleSubmitForReview}
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Submit for Review
                </button>
                <button onClick={() => setPreviewOpen(false)} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg dark:hover:bg-hover">
                  Close Preview
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto bg-slate-100 p-4 dark:bg-background">
              <MedicalCertificateDocument certificate={buildCertificate()} signatoryName={officerName} />
            </div>
          </div>
        </div>
      )}

      {/* Print copy (portalled outside the app for a clean A4 page) */}
      {portal}
    </>
  );
}
