import React, { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft, ArrowRight, Building2, Check, CheckCircle2, Clock, FileText, IdCard,
  Landmark, MapPin, Phone, Mail, User, ShieldCheck, X,
} from "lucide-react";
import GovSeal from "@/components/branding/GovSeal";
import {
  municipalityStore,
  MUNICIPALITY_DOC_REQUIREMENTS,
  ACCEPTED_DOC_TYPES,
  MAX_DOC_SIZE,
} from "@/services/mock/municipalityStore";

const STEPS = [
  { num: 1, label: "Municipality" },
  { num: 2, label: "Authorized Rep" },
  { num: 3, label: "Legal Documents" },
  { num: 4, label: "Review & Submit" },
];

const inputCls = (error) =>
  `mt-1.5 w-full rounded-lg border bg-white px-3.5 py-2.5 text-[13.5px] outline-none transition-colors focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20 ${
    error ? "border-brand-danger" : "border-brand-border"
  }`;

const labelCls = "text-[12.5px] font-bold text-brand-ink";
const errorCls = "mt-1 text-[11.5px] text-brand-danger";

function Field({ label, required, error, children }) {
  return (
    <div>
      <label className={labelCls}>
        {label} {required && <span className="font-normal text-brand-danger">*</span>}
      </label>
      {children}
      {error && <p className={errorCls}>{error}</p>}
    </div>
  );
}

function StepIndicator({ current }) {
  return (
    <div>
      <div className="flex items-baseline justify-between border-b border-brand-border pb-2.5">
        <p className="gov-kicker text-brand-blue">Municipality Registration · Step {String(current).padStart(2, "0")} of 04</p>
        <p className="font-stat text-[11px] font-bold tracking-[0.1em] text-brand-gray">
          {Math.round(((current - 1) / 3) * 100)}% Complete
        </p>
      </div>
      <div className="mt-5 flex items-start justify-between">
        {STEPS.map((step, i) => {
          const isActive = current === step.num;
          const isComplete = current > step.num;
          const isLast = i === STEPS.length - 1;
          return (
            <div key={step.num} className="flex flex-1 items-start last:flex-none">
              <div className="flex w-[60px] flex-col items-center gap-2 sm:w-[78px]">
                <motion.div
                  animate={{
                    backgroundColor: isComplete ? "#12518F" : isActive ? "#12518F" : "#FFFFFF",
                    borderColor: isActive || isComplete ? "#12518F" : "#DCE4EE",
                  }}
                  transition={{ duration: 0.3 }}
                  className="flex h-8 w-8 items-center justify-center border-2"
                >
                  {isComplete ? (
                    <Check className="h-4 w-4 text-white" strokeWidth={3} />
                  ) : (
                    <span className={`font-stat text-[12px] font-bold ${isActive ? "text-white" : "text-brand-gray"}`}>
                      {String(step.num).padStart(2, "0")}
                    </span>
                  )}
                </motion.div>
                <span className={`whitespace-nowrap text-[9.5px] font-bold uppercase tracking-[0.08em] sm:text-[10px] sm:tracking-[0.1em] ${isActive ? "text-brand-blue" : isComplete ? "text-brand-ink" : "text-brand-gray/70"}`}>
                  {step.label}
                </span>
              </div>
              {!isLast && <div className={`mt-[15px] h-px flex-1 ${isComplete ? "bg-brand-blue" : "bg-brand-border"}`} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Reusable sensitive document upload with client-side validation + chip. */
function DocUpload({ req, file, onFile, onRemove }) {
  const inputRef = useRef(null);
  const [error, setError] = useState("");

  const handleFile = (f) => {
    setError("");
    if (!f) return;
    if (!ACCEPTED_DOC_TYPES.includes(f.type)) {
      setError("Unsupported format. Use PDF, PNG, or JPG.");
      return;
    }
    if (f.size > MAX_DOC_SIZE) {
      setError("File exceeds the 10 MB limit.");
      return;
    }
    onFile({ name: f.name, type: f.type, size: f.size });
  };

  return (
    <div className="rounded-btn border border-brand-border bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-blue/10 text-brand-blue">
            {req.required ? <IdCard className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
          </span>
          <div>
            <p className="text-[13px] font-semibold text-brand-ink">
              {req.label}
              {req.required ? (
                <span className="ml-1.5 text-[10.5px] font-bold uppercase text-brand-danger">Required</span>
              ) : (
                <span className="ml-1.5 text-[10.5px] font-bold uppercase text-brand-gray">Optional</span>
              )}
            </p>
            <p className="mt-0.5 text-[11.5px] text-brand-gray">PDF, PNG, JPG — up to 10 MB</p>
          </div>
        </div>
      </div>

      {!file ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-btn border border-dashed border-brand-rule bg-brand-paper px-4 py-2.5 text-[12.5px] font-semibold text-brand-blue transition-colors hover:border-brand-blue hover:bg-brand-light"
        >
          <IdCard className="h-4 w-4" /> Upload document
        </button>
      ) : (
        <div className="mt-3 flex items-center gap-3 rounded-btn border border-brand-border bg-brand-bg/60 px-3 py-2.5">
          <FileText className="h-5 w-5 shrink-0 text-brand-blue" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-medium text-brand-ink">{file.name}</p>
            <p className="text-[11px] text-brand-gray">{file.type.split("/")[1]?.toUpperCase() || "FILE"} · {(file.size / 1024).toFixed(0)} KB</p>
          </div>
          <CheckCircle2 className="h-4 w-4 shrink-0 text-brand-green" />
          <button type="button" onClick={() => { onRemove(); }} aria-label="Remove document" className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-brand-gray transition-colors hover:bg-brand-danger/10 hover:text-brand-danger">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {error && <p className="mt-1.5 text-[11.5px] text-brand-danger">{error}</p>}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_DOC_TYPES.join(",")}
        className="hidden"
        onChange={(e) => {
          handleFile(e.target.files[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}

const emptyForm = () => ({
  municipalityName: "",
  province: "",
  region: "",
  address: "",
  contact: "",
  email: "",
  representative: "",
  position: "",
  repEmail: "",
  repContact: "",
  documents: {},
});

export default function MunicipalityRegistration() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState({});
  const [submitted, setSubmitted] = useState(null);

  const set = (key) => (value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: "" }));
  };

  const setDoc = (key) => (file) => {
    setForm((prev) => ({ ...prev, documents: { ...prev.documents, [key]: file } }));
    if (errors[`doc_${key}`]) setErrors((prev) => ({ ...prev, [`doc_${key}`]: "" }));
  };

  const validateStep = (s) => {
    const next = {};
    if (s === 1) {
      if (!form.municipalityName.trim()) next.municipalityName = "Municipality name is required.";
      if (!form.province.trim()) next.province = "Province is required.";
      if (!form.region.trim()) next.region = "Region is required.";
      if (!form.address.trim()) next.address = "Official address is required.";
      if (!form.contact.trim()) next.contact = "Official contact number is required.";
      if (!form.email.trim()) next.email = "Official email is required.";
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) next.email = "Enter a valid email address.";
    } else if (s === 2) {
      if (!form.representative.trim()) next.representative = "Full name is required.";
      if (!form.position.trim()) next.position = "Position/designation is required.";
      if (!form.repEmail.trim()) next.repEmail = "Official email is required.";
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.repEmail.trim())) next.repEmail = "Enter a valid email address.";
      if (!form.repContact.trim()) next.repContact = "Official contact number is required.";
    } else if (s === 3) {
      MUNICIPALITY_DOC_REQUIREMENTS.filter((r) => r.required).forEach((r) => {
        if (!form.documents[r.key]) next[`doc_${r.key}`] = `Please upload: ${r.label}`;
      });
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const goNext = () => {
    if (!validateStep(step)) return;
    setStep((s) => Math.min(4, s + 1));
  };
  const goBack = () => setStep((s) => Math.max(1, s - 1));

  const handleSubmit = () => {
    if (!validateStep(4) && step === 4) {
      // Step 4 has no free fields; validate docs as well before submitting.
      const docErrors = {};
      MUNICIPALITY_DOC_REQUIREMENTS.filter((r) => r.required).forEach((r) => {
        if (!form.documents[r.key]) docErrors[`doc_${r.key}`] = `Please upload: ${r.label}`;
      });
      if (Object.keys(docErrors).length > 0) {
        setErrors(docErrors);
        setStep(3);
        return;
      }
    }
    const app = municipalityStore.addApplication(form);
    setSubmitted(app);
  };

  const docCount = Object.keys(form.documents).filter((k) => form.documents[k]).length;

  const summaryRows = [
    { icon: Landmark, label: "Municipality", value: `${form.municipalityName} — ${form.province}, ${form.region}` },
    { icon: MapPin, label: "Official Address", value: form.address },
    { icon: Phone, label: "Contact", value: form.contact },
    { icon: Mail, label: "Email", value: form.email },
    { icon: User, label: "Authorized Representative", value: `${form.representative} — ${form.position}` },
    { icon: ShieldCheck, label: "Documents", value: `${docCount} of ${MUNICIPALITY_DOC_REQUIREMENTS.length} uploaded` },
  ];

  return (
    <div className="relative flex min-h-dvh w-full flex-col items-center justify-center gov-navy-panel px-4 py-5 sm:py-7">
      <div className="pointer-events-none absolute inset-0 gov-guilloche opacity-60" aria-hidden="true" />
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="relative flex w-full max-w-3xl flex-col"
      >
        <div className="mb-3 flex items-center justify-center gap-3">
          <GovSeal height={38} eager onDark />
          <div className="text-left">
            <p className="font-display text-[16px] font-bold leading-tight tracking-[0.02em] text-white">KALUSAGAP</p>
            <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/70">Community Health System</p>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl bg-white shadow-[0_24px_70px_-30px_rgba(3,20,45,0.65)] ring-1 ring-white/10">
          {submitted ? (
            /* Success / pending confirmation */
            <div className="px-6 py-8 text-center sm:px-10">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-green/10">
                <CheckCircle2 className="h-7 w-7 text-brand-green" strokeWidth={1.8} />
              </div>
              <h1 className="mt-4 font-display text-[21px] font-bold text-brand-dark">Application Submitted</h1>
              <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-brand-gray">
                Your municipality registration for <span className="font-semibold text-brand-ink">{submitted.municipalityName}</span> has been
                received. It is now <span className="font-semibold text-brand-amber">Pending Verification</span>. The submitted
                documents will be reviewed by the System Administrator.
              </p>
              <div className="mx-auto mt-4 inline-flex items-center gap-2 rounded-full border border-brand-border bg-brand-bg px-3.5 py-1.5 text-[12px] text-brand-gray">
                <Clock className="h-3.5 w-3.5 text-brand-blue" /> Reference: <span className="font-semibold text-brand-ink">{submitted.id}</span>
              </div>
              <p className="mx-auto mt-4 max-w-md rounded-lg border border-brand-blue/15 bg-brand-light/50 px-4 py-3 text-[12px] leading-relaxed text-brand-gray">
                You will be notified once the application is approved. Municipality-level features remain
                locked until approval.
              </p>
              <div className="mt-6 flex flex-col-reverse items-center justify-center gap-3 sm:flex-row">
                <Link to="/" className="text-[12.5px] font-medium text-brand-gray underline underline-offset-4 hover:text-brand-blue">
                  Return to portal home
                </Link>
                <button
                  onClick={() => navigate("/login")}
                  className="rounded-lg bg-brand-blue px-5 py-2.5 text-[12.5px] font-bold uppercase tracking-[0.1em] text-white transition-colors hover:bg-brand-dark"
                >
                  Go to Sign In
                </button>
              </div>
            </div>
          ) : (
            <div className="px-5 py-5 sm:px-8 sm:py-6">
              <StepIndicator current={step} />

              <div className="mt-4 flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-blue text-white">
                  <Building2 className="h-[17px] w-[17px]" strokeWidth={1.9} />
                </span>
                <div>
                  <p className="gov-kicker text-brand-blue">Municipality / LGU Registration</p>
                  <h1 className="mt-0.5 font-display text-[19px] font-bold text-brand-dark sm:text-[21px]">
                    Register a Municipality
                  </h1>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-brand-gray">
                    For local government units registering in KALUSAGAP. Submission creates a{" "}
                    <span className="font-semibold text-brand-amber">Pending Verification</span> application.
                  </p>
                </div>
              </div>

              <motion.div key={step} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.28 }} className="mt-5 space-y-4">
                {step === 1 && (
                  <>
                    <p className="gov-kicker flex items-center gap-2 text-brand-blue">
                      <span className="h-px w-5 bg-brand-blue/45" /> A · Municipality Information
                    </p>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <Field label="Municipality name" required error={errors.municipalityName}>
                        <input type="text" value={form.municipalityName} onChange={(e) => set("municipalityName")(e.target.value)} placeholder="e.g. Pili" className={inputCls(errors.municipalityName)} />
                      </Field>
                      <Field label="Province" required error={errors.province}>
                        <input type="text" value={form.province} onChange={(e) => set("province")(e.target.value)} placeholder="e.g. Camarines Sur" className={inputCls(errors.province)} />
                      </Field>
                      <Field label="Region" required error={errors.region}>
                        <input type="text" value={form.region} onChange={(e) => set("region")(e.target.value)} placeholder="e.g. Region V (Bicol)" className={inputCls(errors.region)} />
                      </Field>
                      <Field label="Official contact number" required error={errors.contact}>
                        <input type="text" value={form.contact} onChange={(e) => set("contact")(e.target.value)} placeholder="e.g. (054) 123-4567" className={inputCls(errors.contact)} />
                      </Field>
                      <Field label="Official email address" required error={errors.email}>
                        <input type="email" value={form.email} onChange={(e) => set("email")(e.target.value)} placeholder="e.g. lgu@example.gov.ph" className={inputCls(errors.email)} />
                      </Field>
                      <div className="sm:col-span-2">
                        <Field label="Official municipality / LGU address" required error={errors.address}>
                          <input type="text" value={form.address} onChange={(e) => set("address")(e.target.value)} placeholder="Municipal hall / official address" className={inputCls(errors.address)} />
                        </Field>
                      </div>
                    </div>
                  </>
                )}

                {step === 2 && (
                  <>
                    <p className="gov-kicker flex items-center gap-2 text-brand-blue">
                      <span className="h-px w-5 bg-brand-blue/45" /> B · Authorized Representative
                    </p>
                    <p className="text-[12.5px] text-brand-gray">
                      The person authorized to submit this application on behalf of the municipality.
                    </p>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <Field label="Full name" required error={errors.representative}>
                        <input type="text" value={form.representative} onChange={(e) => set("representative")(e.target.value)} placeholder="e.g. Josefa Ramirez" className={inputCls(errors.representative)} />
                      </Field>
                      <Field label="Position / designation" required error={errors.position}>
                        <input type="text" value={form.position} onChange={(e) => set("position")(e.target.value)} placeholder="e.g. Municipal Administrator" className={inputCls(errors.position)} />
                      </Field>
                      <Field label="Official email" required error={errors.repEmail}>
                        <input type="email" value={form.repEmail} onChange={(e) => set("repEmail")(e.target.value)} placeholder="e.g. admin@example.gov.ph" className={inputCls(errors.repEmail)} />
                      </Field>
                      <Field label="Official contact number" required error={errors.repContact}>
                        <input type="text" value={form.repContact} onChange={(e) => set("repContact")(e.target.value)} placeholder="e.g. 0917 000 1234" className={inputCls(errors.repContact)} />
                      </Field>
                    </div>
                    <div className="rounded-lg border border-brand-gold/40 bg-brand-goldpale px-4 py-3 text-[12px] leading-relaxed text-brand-amber">
                      The authorized representative&apos;s identity and authority are verified from the
                      documents submitted in the next step.
                    </div>
                  </>
                )}

                {step === 3 && (
                  <>
                    <p className="gov-kicker flex items-center gap-2 text-brand-blue">
                      <span className="h-px w-5 bg-brand-blue/45" /> C · Legal / Supporting Documents
                    </p>
                    <p className="text-[12.5px] text-brand-gray">
                      Uploads are treated as sensitive. Required documents are marked — the requirement list is
                      configurable by the System Administrator.
                    </p>
                    <div className="space-y-3">
                      {MUNICIPALITY_DOC_REQUIREMENTS.map((req) => (
                        <DocUpload
                          key={req.key}
                          req={req}
                          file={form.documents[req.key] || null}
                          onFile={setDoc(req.key)}
                          onRemove={() => setForm((prev) => ({ ...prev, documents: { ...prev.documents, [req.key]: null } }))}
                        />
                      ))}
                      {errors.doc_other && <p className="text-[11.5px] text-brand-danger">{errors.doc_other}</p>}
                    </div>
                  </>
                )}

                {step === 4 && (
                  <>
                    <p className="gov-kicker flex items-center gap-2 text-brand-blue">
                      <span className="h-px w-5 bg-brand-blue/45" /> D · Review &amp; Submit
                    </p>
                    <p className="text-[12.5px] text-brand-gray">
                      Review the details before submitting. You can go back to correct anything.
                    </p>
                    <div className="divide-y divide-brand-border rounded-lg border border-brand-border">
                      {summaryRows.map((r) => (
                        <div key={r.label} className="flex items-start gap-3 px-4 py-3">
                          <r.icon className="mt-0.5 h-4 w-4 shrink-0 text-brand-blue" strokeWidth={1.8} />
                          <div className="min-w-0">
                            <p className="text-[10.5px] font-bold uppercase tracking-gov text-brand-gray">{r.label}</p>
                            <p className="mt-0.5 text-[13px] font-medium text-brand-ink">{r.value || "—"}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="rounded-lg border border-brand-blue/15 bg-brand-light/50 px-4 py-3 text-[12px] leading-relaxed text-brand-gray">
                      By submitting, you confirm that the municipality is authorized to register and that the
                      information and documents provided are accurate. The application will be reviewed before
                      municipality-level access is granted.
                    </div>
                  </>
                )}
              </motion.div>

              <div className="mt-6 flex items-center justify-between gap-3 border-t border-brand-border pt-4">
                <div>
                  {step > 1 ? (
                    <button onClick={goBack} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12.5px] font-semibold text-brand-gray transition-colors hover:bg-brand-bg">
                      <ArrowLeft className="h-4 w-4" /> Back
                    </button>
                  ) : (
                    <Link to="/register" className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12.5px] font-semibold text-brand-gray transition-colors hover:bg-brand-bg">
                      <ArrowLeft className="h-4 w-4" /> All forms
                    </Link>
                  )}
                </div>
                {step < 4 ? (
                  <button onClick={goNext} className="inline-flex items-center gap-2 rounded-lg bg-brand-blue px-5 py-2.5 text-[12.5px] font-bold uppercase tracking-[0.1em] text-white transition-colors hover:bg-brand-dark">
                    Continue <ArrowRight className="h-4 w-4" />
                  </button>
                ) : (
                  <button onClick={handleSubmit} className="inline-flex items-center gap-2 rounded-lg bg-brand-blue px-5 py-2.5 text-[12.5px] font-bold uppercase tracking-[0.1em] text-white transition-colors hover:bg-brand-dark">
                    <Check className="h-4 w-4" /> Submit Application
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <p className="mt-4 text-center">
          <Link to="/" className="text-[12px] font-medium text-white/70 underline decoration-white/30 underline-offset-4 transition-colors hover:text-white hover:decoration-white">
            Return to portal home
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
