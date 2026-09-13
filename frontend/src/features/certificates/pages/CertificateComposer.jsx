import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { useAuth } from "@/context/AuthContext";
import { ROLES } from "@/lib/brand";
import { useResidents } from "@/services/mock/residentStore";
import {
  medicalCertificateStore,
  CERT_PURPOSES,
} from "@/services/mock/medicalCertificateStore";
import MedicalCertificateDocument from "../components/MedicalCertificateDocument";
import { useCertificatePrint } from "../components/useCertificatePrint.jsx";
import {
  Search, ChevronRight, ShieldAlert, Eye, Printer, RotateCcw, CheckCircle2, Users,
} from "lucide-react";

/** Roles authorized to prepare and print medical certificates. */
const AUTHORIZED_ROLES = ["mho", "phn", "rhu_personnel"];

const CIVIL_STATUSES = ["Single", "Married", "Widowed", "Separated"];

const todayIso = () => new Date().toISOString().slice(0, 10);

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
  orNumber: "",
  amount: "",
  paymentDate: "",
});

export default function CertificateComposer() {
  const { user } = useAuth();
  const residents = useResidents();

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
    />
  );
}

function ComposerContent({ base, roleLabel, residents }) {
  const { user } = useAuth();
  const { printCertificate, portal } = useCertificatePrint();

  const [patientQuery, setPatientQuery] = useState("");
  const [resident, setResident] = useState(null);
  const [form, setForm] = useState(() => ({ ...defaultForm(), certificateNumber: medicalCertificateStore.nextReference() }));
  const [errors, setErrors] = useState({});
  const [previewOpen, setPreviewOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [savedId, setSavedId] = useState(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  };

  const residentOptions = useMemo(
    () =>
      [...residents]
        .sort((a, b) => a.name.localeCompare(b.name))
        .filter(
          (r) =>
            !patientQuery.trim() ||
            r.name.toLowerCase().includes(patientQuery.trim().toLowerCase()) ||
            String(r.id).toLowerCase().includes(patientQuery.trim().toLowerCase())
        )
        .slice(0, 6),
    [residents, patientQuery]
  );

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
    purpose: CERT_PURPOSES[0],
    certificateNumber: form.certificateNumber.trim(),
    civilStatus: form.civilStatus,
    dateOfExamination: form.dateExamined,
    findings: form.diagnosis.trim(),
    recommendation: form.recommendation.trim(),
    remarks: form.remarks.trim(),
    issuedAt: form.issuedAt,
    orNumber: form.orNumber.trim(),
    amount: form.amount.trim(),
    paymentDate: form.paymentDate,
    preparedBy: user?.name || roleLabel,
    preparedByRole: roleLabel,
    medicalOfficer: officerName,
    licenseNumber: "",
  });

  const validate = () => {
    const next = {};
    if (!resident) next.resident = "Please select a resident.";
    if (!form.certificateNumber.trim()) next.certificateNumber = "Certificate number is required.";
    if (!form.dateExamined) next.dateExamined = "Date examined is required.";
    if (!form.diagnosis.trim()) next.diagnosis = "Diagnosis / medical impression is required.";
    if (!form.issuedAt) next.issuedAt = "Issuance date is required.";
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

  const handlePrint = () => {
    const cert = buildCertificate();
    if (savedId) {
      medicalCertificateStore.updateCertificate(savedId, cert);
    } else {
      // The MHO can issue directly; other roles submit for MHO review.
      const record = medicalCertificateStore.createCertificate({
        ...cert,
        status: user?.role === "mho" ? "Issued" : "For Review",
      });
      setSavedId(record.id);
    }
    showToast("Certificate saved to the register.");
    printCertificate(cert, officerName);
  };

  const handleReset = () => {
    setResident(null);
    setPatientQuery("");
    setForm({ ...defaultForm(), certificateNumber: medicalCertificateStore.nextReference() });
    setErrors({});
    setSavedId(null);
    setPreviewOpen(false);
    showToast("Form reset.");
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
                      {r.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-brand-ink">{r.name}</span>
                      <span className="block text-xs text-brand-gray">
                        {r.id} · {r.age} yrs · {r.gender} · {r.barangay}
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
              <Field label="Certificate No." required error={errors.certificateNumber}>
                <input
                  type="text"
                  value={form.certificateNumber}
                  onChange={(e) => set("certificateNumber")(e.target.value)}
                  placeholder="e.g. MC-2026-0006"
                  className={inputCls(errors.certificateNumber)}
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
              <Field label="Issuance Date" required error={errors.issuedAt}>
                <input
                  type="date"
                  value={form.issuedAt}
                  onChange={(e) => set("issuedAt")(e.target.value)}
                  className={inputCls(errors.issuedAt)}
                />
              </Field>
              <Field label="O.R. No." hint="Payment details (optional).">
                <input
                  type="text"
                  value={form.orNumber}
                  onChange={(e) => set("orNumber")(e.target.value)}
                  placeholder="Official receipt number..."
                  className={inputCls()}
                />
              </Field>
              <Field label="Amount">
                <input
                  type="text"
                  value={form.amount}
                  onChange={(e) => set("amount")(e.target.value)}
                  placeholder="e.g. 50.00"
                  className={inputCls()}
                />
              </Field>
              <Field label="Payment Date">
                <input
                  type="date"
                  value={form.paymentDate}
                  onChange={(e) => set("paymentDate")(e.target.value)}
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
                className="inline-flex items-center gap-2 rounded-btn bg-brand-blue px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
              >
                <Eye className="h-4 w-4" /> Preview Certificate
              </button>
            </div>
          </Card>

          <p className="text-center text-xs text-brand-gray">
            Preview the certificate before printing. Printing saves the certificate to the register
            {user?.role === "mho" ? " and issues it under the MHO's authorization." : " and submits it for MHO review."}
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
                  className="inline-flex items-center gap-1.5 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
                >
                  <Printer className="h-4 w-4" /> Print Certificate
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
