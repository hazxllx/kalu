import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  AlertCircle, ArrowLeft, ArrowRight, Check, CheckCircle2, Clock, Eye, EyeOff,
  FileText, Loader2, ShieldCheck,
} from "lucide-react";
import {
  RegistrationShell,
  RegistrationCard,
  StepIndicator,
  PageHeading,
  Field,
  SelectField,
  inputCls,
  SectionKicker,
  InfoNote,
  ReviewBlock,
  btnPrimary,
  btnGhost,
} from "@/features/registration/components/RegistrationDesign";
import UploadComponent from "@/features/registration/components/UploadComponent";
import DatePicker from "@/components/common/DatePicker";
import { staffRequestStore } from "@/services/local/staffRequestStore";
import { BARANGAYS } from "@/lib/barangays";
import { CONSULTATION_LOCATIONS, barangayHealthCenter } from "@/lib/consultationLocations";

const TODAY = new Date().toISOString().slice(0, 10);

const STEPS = [
  { num: 1, label: "Personal" },
  { num: 2, label: "Account & Contact" },
  { num: 3, label: "Professional" },
  { num: 4, label: "Review & Submit" },
];

const STEPS_META = [
  { title: "Personal Information", subtitle: "Tell us about yourself." },
  { title: "Account & Contact", subtitle: "Set up your sign-in and contact details." },
  { title: "Professional Information", subtitle: "Your role, assignment, and supporting documents." },
  { title: "Review & Submit", subtitle: "Confirm every detail before submitting for verification." },
];

/**
 * Health personnel roles supported by KALUSAGAP. Ids match the canonical role
 * ids (`@/lib/roles` / backend `config/roles.js`). Licensed professions require
 * a PRC license; BHW and RHU personnel require different supporting documents.
 */
const ROLE_OPTIONS = [
  { id: "mho", label: "Municipal Health Officer (MHO)", licenseRequired: true },
  { id: "phn", label: "Public Health Nurse", licenseRequired: true },
  { id: "health_supervisor", label: "Health Supervisor (Barangay Nurse / Midwife)", licenseRequired: true },
  { id: "rhu_personnel", label: "Rural Health Unit (RHU) Personnel", licenseRequired: false, employmentDocRequired: true },
  { id: "bhw", label: "Barangay Health Worker (BHW)", licenseRequired: false, endorsementRequired: true },
];

/** Roles that are assigned to a barangay (mirrors adminUserStore scope rules). */
const BARANGAY_SCOPED_ROLES = ["health_supervisor", "bhw"];

const EMPLOYMENT_STATUSES = ["Permanent", "Contractual", "Job Order", "Casual", "Volunteer"];

const roleById = (id) => ROLE_OPTIONS.find((r) => r.id === id) || null;

/** Required document set for the selected role — never over-requires licenses. */
function docRequirementsFor(roleId) {
  const role = roleById(roleId);
  if (!role) return [];
  const reqs = [
    {
      key: "valid_id",
      label: "Valid Government-Issued ID",
      required: true,
      description: "Upload a valid government-issued ID (e.g. UMID, driver's license, passport).",
    },
  ];
  if (role.licenseRequired) {
    reqs.push({
      key: "license",
      label: "Professional License / PRC Registration",
      required: true,
      description: "Upload your professional license or PRC registration for your role.",
    });
  }
  if (role.employmentDocRequired) {
    reqs.push({
      key: "employment",
      label: "Certificate of Employment / Appointment",
      required: true,
      description: "Upload your certificate of employment or appointment order.",
    });
  }
  if (role.endorsementRequired) {
    reqs.push({
      key: "endorsement",
      label: "Barangay Endorsement",
      required: true,
      description: "Upload an endorsement from your barangay or assigned health unit.",
    });
  }
  return reqs;
}

function calcAge(dob) {
  if (!dob) return "";
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return "";
  const age = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 365.25));
  return age > 0 && age < 120 ? String(age) : "";
}

/** Philippine mobile number: 09XXXXXXXXX or +639XXXXXXXXX (spaces/dashes allowed). */
const isValidPHMobile = (value) => /^(?:\+?63|0)9\d{9}$/.test(String(value || "").replace(/[\s\-()]/g, ""));

function checkStrength(pw) {
  const checks = [
    { label: "At least 8 characters", pass: pw.length >= 8 },
    { label: "Uppercase letter", pass: /[A-Z]/.test(pw) },
    { label: "Lowercase letter", pass: /[a-z]/.test(pw) },
    { label: "Number", pass: /\d/.test(pw) },
    { label: "Special character", pass: /[^A-Za-z0-9]/.test(pw) },
  ];
  const score = checks.filter((c) => c.pass).length;
  return {
    checks,
    score,
    label: ["Very Weak", "Weak", "Fair", "Good", "Strong"][score - 1] || "",
    color: ["#E74C3C", "#E74C3C", "#F5B400", "#2A7DE1", "#28B463"][score - 1] || "#E5EAF1",
  };
}

export default function PersonnelRegistration() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [show, setShow] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(null);
  const [showStatus, setShowStatus] = useState(false);
  /** @type {[Record<string, string>, Function]} */
  const [errors, setErrors] = useState({});

  const [form, setForm] = useState({
    // Step 1 — personal
    firstName: "",
    middleName: "",
    lastName: "",
    suffix: "",
    dob: "",
    sex: "",
    civilStatus: "",
    // Step 2 — account & contact
    email: "",
    username: "",
    contact: "",
    password: "",
    confirmPassword: "",
    // Step 3 — professional
    roleId: "",
    licenseNumber: "",
    licenseExpiry: "",
    municipality: "Pili",
    barangay: "",
    facility: "RHU",
    position: "",
    department: "",
    employmentStatus: "",
    yearsOfService: "",
    documents: {},
    // Step 4 — confirmation
    confirm: false,
  });

  const set = (key) => (e) => {
    const value = e && e.target ? e.target.value : e;
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: "" }));
  };

  const setDoc = (key) => (file) => {
    setForm((prev) => ({ ...prev, documents: { ...prev.documents, [key]: file } }));
    if (errors[`doc_${key}`]) setErrors((prev) => ({ ...prev, [`doc_${key}`]: "" }));
  };

  const pwStrength = useMemo(() => checkStrength(form.password), [form.password]);
  const role = roleById(form.roleId);
  const documentList = useMemo(() => docRequirementsFor(form.roleId), [form.roleId]);
  const isBarangayScoped = BARANGAY_SCOPED_ROLES.includes(form.roleId);
  const composedName = [form.firstName, form.middleName, form.lastName, form.suffix].filter(Boolean).join(" ").trim();

  /** Pure validation: returns an error map for a step (does not mutate state). */
  const computeErrors = (s) => {
    const errs = {};
    if (s === 1) {
      if (!form.firstName.trim()) errs.firstName = "First name is required.";
      if (!form.lastName.trim()) errs.lastName = "Last name is required.";
      if (!form.dob) errs.dob = "Date of birth is required.";
      else {
        const d = new Date(form.dob);
        if (Number.isNaN(d.getTime())) errs.dob = "Enter a valid date of birth.";
        else if (d.getTime() > Date.now()) errs.dob = "Date of birth cannot be in the future.";
      }
      if (!form.sex) errs.sex = "Sex is required.";
      if (!form.civilStatus) errs.civilStatus = "Civil status is required.";
    }

    if (s === 2) {
      if (!form.email.trim()) errs.email = "Official email is required.";
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errs.email = "Enter a valid email address.";
      else if (staffRequestStore.hasEmail(form.email)) errs.email = "This email is already registered.";
      if (!form.contact.trim()) errs.contact = "Contact number is required.";
      else if (!isValidPHMobile(form.contact)) errs.contact = "Enter a valid Philippine mobile number (e.g. 0917 123 4567).";
      if (!form.password) errs.password = "Password is required.";
      else if (pwStrength.score < 5) errs.password = "Password must meet all the requirements below.";
      if (!form.confirmPassword) errs.confirmPassword = "Please confirm your password.";
      else if (form.password !== form.confirmPassword) errs.confirmPassword = "Passwords do not match.";
    }

    if (s === 3) {
      if (!form.roleId) errs.roleId = "Health personnel role is required.";
      if (role?.licenseRequired) {
        if (!form.licenseNumber.trim()) errs.licenseNumber = "License number is required for this role.";
        else if (staffRequestStore.hasLicense(form.licenseNumber)) errs.licenseNumber = "This license number is already registered.";
        if (!form.licenseExpiry) errs.licenseExpiry = "License expiration date is required.";
        else {
          const d = new Date(form.licenseExpiry);
          if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) errs.licenseExpiry = "Enter a valid future expiration date.";
        }
      }
      if (!form.municipality.trim()) errs.municipality = "Municipality / LGU is required.";
      if (isBarangayScoped) {
        if (!form.barangay) errs.barangay = "Barangay is required for this role.";
      } else if (!form.facility) {
        errs.facility = "Health facility is required.";
      }
      if (!form.position.trim()) errs.position = "Position / designation is required.";
      if (!form.employmentStatus) errs.employmentStatus = "Employment status is required.";
      documentList.filter((r) => r.required).forEach((r) => {
        if (!form.documents[r.key]) errs[`doc_${r.key}`] = `Please upload: ${r.label}`;
      });
    }

    return errs;
  };

  const validateStep = (s) => {
    const errs = computeErrors(s);
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const firstInvalidStep = () => {
    for (const s of [1, 2, 3]) {
      if (Object.keys(computeErrors(s)).length > 0) return s;
    }
    return 0;
  };

  const allRequiredComplete = [1, 2, 3].every((s) => Object.keys(computeErrors(s)).length === 0);
  const missingItems = [1, 2, 3].flatMap((s) => Object.values(computeErrors(s)));

  const next = () => { if (validateStep(step)) setStep((p) => Math.min(p + 1, 4)); };
  const back = () => setStep((p) => Math.max(p - 1, 1));
  const goTo = (s) => { setErrors(computeErrors(s)); setStep(s); };

  const buildPayload = () => {
    const documents = documentList
      .filter((r) => form.documents[r.key])
      .map((r) => `${r.label} — ${form.documents[r.key].name}`);
    return {
      name: composedName,
      firstName: form.firstName.trim(),
      middleName: form.middleName.trim(),
      lastName: form.lastName.trim(),
      suffix: form.suffix.trim(),
      dob: form.dob,
      sex: form.sex,
      civilStatus: form.civilStatus,
      email: form.email.trim(),
      username: form.username.trim(),
      contact: form.contact.trim(),
      roleId: form.roleId,
      role: role?.label || "",
      position: form.position.trim(),
      licenseNumber: role?.licenseRequired ? form.licenseNumber.trim() : "",
      licenseExpiry: role?.licenseRequired ? form.licenseExpiry : "",
      municipality: form.municipality.trim(),
      barangay: isBarangayScoped ? form.barangay : "",
      facility: isBarangayScoped ? barangayHealthCenter(form.barangay) : form.facility,
      department: form.department.trim(),
      employmentStatus: form.employmentStatus,
      yearsOfService: form.yearsOfService.trim(),
      documents,
      // NOTE: password / confirmPassword are intentionally NOT included — the
      // account is provisioned by the administrator after verification and the
      // plaintext credential is never persisted with the application.
    };
  };

  const submit = () => {
    if (!form.confirm) {
      setErrors((prev) => ({ ...prev, confirm: "Please confirm that the information provided is accurate and complete." }));
      return;
    }
    const invalid = firstInvalidStep();
    if (invalid) {
      setErrors(computeErrors(invalid));
      setStep(invalid);
      return;
    }
    setSubmitting(true);
    setTimeout(() => {
      const record = staffRequestStore.addRequest(buildPayload());
      setSubmitting(false);
      setSubmitted(record);
    }, 900);
  };

  /* ----------------------------- success view ----------------------------- */
  if (submitted) {
    const summary = [
      ["Application ID", submitted.id],
      ["Account Type", "Health Personnel"],
      ["Status", "Pending Verification"],
      ["Municipality / LGU", submitted.municipality || "—"],
      ["Official Email", submitted.email],
    ];
    return (
      <RegistrationShell footer={null}>
        <RegistrationCard>
          <div className="px-6 py-10 text-center sm:px-12 sm:py-12">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-green/10 ring-8 ring-brand-green/5">
              <CheckCircle2 className="h-8 w-8 text-brand-green" strokeWidth={1.8} />
            </div>
            <h1 className="mt-5 font-display text-[22px] font-bold text-brand-dark">Registration Submitted Successfully</h1>
            <div className="mx-auto mt-2 h-[3px] w-14 rounded-full bg-brand-gold" aria-hidden="true" />
            <p className="mx-auto mt-4 max-w-md text-[13px] leading-relaxed text-slate-500">
              Your Health Personnel account has been submitted for verification. It is now{" "}
              <span className="font-semibold text-brand-amber">Pending Verification</span> and will be reviewed by the
              System Administrator before account access is granted.
            </p>

            <dl className="mx-auto mt-6 grid max-w-lg grid-cols-1 gap-3 text-left sm:grid-cols-2">
              {summary.map(([label, value]) => (
                <div key={label} className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
                  <dt className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400">{label}</dt>
                  <dd className="mt-1 break-words text-[13px] font-semibold text-brand-ink">{value}</dd>
                </div>
              ))}
            </dl>

            {showStatus && (
              <div className="mx-auto mt-4 max-w-lg rounded-xl border border-brand-blue/15 bg-brand-light/40 px-4 py-4 text-left">
                <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">Application Timeline</p>
                <ul className="mt-3 space-y-2.5">
                  {[
                    ["Submitted", "Your application was received."],
                    ["Pending Verification", "Awaiting review by the System Administrator."],
                    ["Verified", "Your account is activated and you may sign in."],
                  ].map(([title, copy], i) => (
                    <li key={title} className="flex items-start gap-2.5">
                      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${i === 0 ? "bg-brand-blue text-white" : "border border-slate-300 bg-white text-slate-400"}`}>
                        {i + 1}
                      </span>
                      <div>
                        <p className="text-[12.5px] font-semibold text-brand-ink">{title}</p>
                        <p className="text-[11.5px] leading-relaxed text-slate-500">{copy}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="mx-auto mt-5 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-[12px] text-slate-500">
              <Clock className="h-3.5 w-3.5 text-brand-blue" /> Estimated review: 2–3 working days
            </p>

            <div className="mt-7 flex flex-col-reverse items-center justify-center gap-3 sm:flex-row">
              <button type="button" onClick={() => setShowStatus((v) => !v)} className={btnGhost}>
                {showStatus ? "Hide Application Status" : "View Application Status"}
              </button>
              <button type="button" onClick={() => navigate("/login")} className={btnPrimary}>
                Back to Login
              </button>
            </div>
            <p className="mt-5">
              <Link to="/" className="text-[12px] font-medium text-slate-500 underline underline-offset-4 transition-colors hover:text-brand-blue">
                Return to portal home
              </Link>
            </p>
          </div>
        </RegistrationCard>
      </RegistrationShell>
    );
  }

  /* ------------------------------- form view ------------------------------ */
  return (
    <RegistrationShell
      footer={
        <div className="mt-5 flex flex-col items-center gap-1.5 text-center">
          <p className="text-[12.5px] text-white/70">
            Already have an account?{" "}
            <Link to="/login" className="font-semibold text-white underline decoration-white/30 underline-offset-4 transition-colors hover:decoration-white">
              Sign in to the portal
            </Link>
          </p>
          <p className="text-[11.5px] text-white/50">Staff accounts are activated only after verification.</p>
        </div>
      }
    >
      <RegistrationCard>
        <div className="px-5 py-6 sm:px-10 sm:py-8">
          <StepIndicator current={step} steps={STEPS} flowLabel="Health Personnel Registration" />

          <motion.div
            key={step}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.28 }}
            className="mt-6 space-y-5"
          >
            <PageHeading title={STEPS_META[step - 1].title} subtitle={STEPS_META[step - 1].subtitle} />

            {/* STEP 1 — Personal Information */}
            {step === 1 && (
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field label="First Name" required error={errors.firstName}>
                  <input type="text" placeholder="Juan" value={form.firstName} onChange={set("firstName")} className={inputCls(errors.firstName)} />
                </Field>
                <Field label="Middle Name" optional>
                  <input type="text" placeholder="Reyes" value={form.middleName} onChange={set("middleName")} className={inputCls()} />
                </Field>
                <Field label="Last Name" required error={errors.lastName}>
                  <input type="text" placeholder="Dela Cruz" value={form.lastName} onChange={set("lastName")} className={inputCls(errors.lastName)} />
                </Field>
                <Field label="Suffix" optional>
                  <input type="text" placeholder="Jr." value={form.suffix} onChange={set("suffix")} className={inputCls()} />
                </Field>
                <Field label="Birth Date" required error={errors.dob}>
                  <DatePicker
                    value={form.dob}
                    max={TODAY}
                    error={Boolean(errors.dob)}
                    placeholder="Select birth date..."
                    onChange={(v) => { setForm((p) => ({ ...p, dob: v })); if (errors.dob) setErrors((p) => ({ ...p, dob: "" })); }}
                  />
                </Field>
                <Field label="Age" hint="Calculated automatically from the date of birth.">
                  <input type="text" value={calcAge(form.dob)} readOnly placeholder="Auto-calculated" className={`${inputCls()} cursor-not-allowed text-slate-500`} />
                </Field>
                <SelectField label="Sex" required error={errors.sex} value={form.sex} onChange={set("sex")}>
                  <option value="">Select sex</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </SelectField>
                <SelectField label="Civil Status" required error={errors.civilStatus} value={form.civilStatus} onChange={set("civilStatus")}>
                  <option value="">Select status</option>
                  <option value="Single">Single</option>
                  <option value="Married">Married</option>
                  <option value="Widowed">Widowed</option>
                  <option value="Separated">Separated</option>
                </SelectField>
              </div>
            )}

            {/* STEP 2 — Account & Contact */}
            {step === 2 && (
              <div className="space-y-5">
                <Field label="Official Email Address" required error={errors.email} hint="Used to sign in once your account is verified.">
                  <input type="email" placeholder="name@example.gov.ph" value={form.email} onChange={set("email")} className={inputCls(errors.email)} />
                </Field>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <Field label="Contact Number" required error={errors.contact}>
                    <input type="tel" placeholder="0917 123 4567" value={form.contact} onChange={set("contact")} className={inputCls(errors.contact)} />
                  </Field>
                  <Field label="Username" optional hint="Sign-in uses your official email; a username is optional.">
                    <input type="text" placeholder="e.g. j.delacruz" value={form.username} onChange={set("username")} className={inputCls()} />
                  </Field>
                </div>

                <Field
                  label="Password"
                  required
                  error={errors.password}
                  trailing={
                    <button
                      type="button"
                      onClick={() => setShow(!show)}
                      aria-label={show ? "Hide password" : "Show password"}
                      className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-brand-ink"
                    >
                      {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  }
                >
                  <input type={show ? "text" : "password"} placeholder="Create a password" value={form.password} onChange={set("password")} className={`${inputCls(errors.password)} pr-12`} />
                </Field>

                {form.password && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">Password Strength</span>
                      <span className="font-stat text-[11.5px] font-bold uppercase tracking-[0.08em]" style={{ color: pwStrength.color }}>
                        {pwStrength.label}
                      </span>
                    </div>
                    <div className="mt-2.5 flex gap-1">
                      {[0, 1, 2, 3, 4].map((i) => (
                        <div key={i} className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
                          <motion.div
                            initial={false}
                            animate={{ width: i < pwStrength.score ? "100%" : "0%" }}
                            transition={{ duration: 0.3 }}
                            className="h-full rounded-full"
                            style={{ background: pwStrength.color }}
                          />
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
                      {pwStrength.checks.map((c, i) => (
                        <div key={i} className="flex items-center gap-2 text-[12px]">
                          <div className={`flex h-3.5 w-3.5 items-center justify-center rounded-sm ${c.pass ? "bg-brand-green" : "border border-slate-300 bg-white"}`}>
                            {c.pass && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3.5} />}
                          </div>
                          <span className={c.pass ? "text-brand-ink" : "text-slate-500"}>{c.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <Field
                  label="Confirm Password"
                  required
                  error={errors.confirmPassword}
                  trailing={
                    <button
                      type="button"
                      onClick={() => setShowConfirm(!showConfirm)}
                      aria-label={showConfirm ? "Hide password" : "Show password"}
                      className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-brand-ink"
                    >
                      {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  }
                >
                  <input type={showConfirm ? "text" : "password"} placeholder="Re-enter password" value={form.confirmPassword} onChange={set("confirmPassword")} className={`${inputCls(errors.confirmPassword)} pr-12`} />
                </Field>

                <InfoNote icon={ShieldCheck}>
                  Sign-in credentials are provisioned by the System Administrator after your account is verified.
                  Passwords entered here are validated for strength and are never stored with your application.
                </InfoNote>
              </div>
            )}

            {/* STEP 3 — Professional Information */}
            {step === 3 && (
              <div className="space-y-5">
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <Field label="Full Name" hint="Composed from your personal information.">
                    <input type="text" readOnly value={composedName} className={`${inputCls()} cursor-not-allowed text-slate-500`} />
                  </Field>
                  <SelectField label="Health Personnel Role" required error={errors.roleId} value={form.roleId} onChange={set("roleId")}>
                    <option value="">Select role</option>
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r.id} value={r.id}>{r.label}</option>
                    ))}
                  </SelectField>
                </div>

                {role?.licenseRequired && (
                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <Field label="Professional License Number" required error={errors.licenseNumber}>
                      <input type="text" placeholder="e.g. PRC-0012345" value={form.licenseNumber} onChange={set("licenseNumber")} className={inputCls(errors.licenseNumber)} />
                    </Field>
                    <Field label="License Expiration Date" required error={errors.licenseExpiry}>
                      <DatePicker
                        value={form.licenseExpiry}
                        min={TODAY}
                        error={Boolean(errors.licenseExpiry)}
                        placeholder="Select expiration date..."
                        onChange={(v) => set("licenseExpiry")(v)}
                      />
                    </Field>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <SelectField label="Municipality / LGU" required error={errors.municipality} value={form.municipality} onChange={set("municipality")}>
                    <option value="Pili">Pili, Camarines Sur</option>
                  </SelectField>
                  {isBarangayScoped ? (
                    <SelectField label="Barangay" required error={errors.barangay} value={form.barangay} onChange={set("barangay")}>
                      <option value="">Select barangay</option>
                      {BARANGAYS.map((b) => (
                        <option key={b} value={b}>{b}</option>
                      ))}
                    </SelectField>
                  ) : (
                    <SelectField label="Health Facility" required error={errors.facility} value={form.facility} onChange={set("facility")}>
                      {CONSULTATION_LOCATIONS.map((f) => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                    </SelectField>
                  )}
                </div>

                {isBarangayScoped && (
                  <Field label="Assigned Facility" hint="Derived from your selected barangay.">
                    <input type="text" readOnly value={barangayHealthCenter(form.barangay)} className={`${inputCls()} cursor-not-allowed text-slate-500`} />
                  </Field>
                )}

                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <Field label="Position / Designation" required error={errors.position}>
                    <input type="text" placeholder="e.g. Public Health Nurse" value={form.position} onChange={set("position")} className={inputCls(errors.position)} />
                  </Field>
                  <SelectField label="Employment Status" required error={errors.employmentStatus} value={form.employmentStatus} onChange={set("employmentStatus")}>
                    <option value="">Select status</option>
                    {EMPLOYMENT_STATUSES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </SelectField>
                  <Field label="Department / Office" optional>
                    <input type="text" placeholder="e.g. Rural Health Unit 1" value={form.department} onChange={set("department")} className={inputCls()} />
                  </Field>
                  <Field label="Years of Service" optional>
                    <input type="number" min="0" max="80" placeholder="e.g. 5" value={form.yearsOfService} onChange={set("yearsOfService")} className={inputCls()} />
                  </Field>
                </div>

                <div className="border-t border-slate-100 pt-5">
                  <SectionKicker>Supporting Documents</SectionKicker>
                  <div className="mt-4 space-y-4">
                    <InfoNote icon={FileText}>
                      Accepted formats: PDF, PNG, JPG — up to 10 MB per document. Required documents depend on the role you selected.
                    </InfoNote>
                    {documentList.length === 0 ? (
                      <InfoNote>Select a health personnel role to see the required documents.</InfoNote>
                    ) : (
                      documentList.map((req) => (
                        <div key={req.key}>
                          <UploadComponent
                            label={req.label}
                            file={form.documents[req.key] || null}
                            onFile={setDoc(req.key)}
                            onRemove={() => setForm((prev) => ({ ...prev, documents: { ...prev.documents, [req.key]: null } }))}
                          />
                          {req.description && <p className="mt-1.5 text-[11.5px] leading-relaxed text-slate-400">{req.description}</p>}
                          {errors[`doc_${req.key}`] && <p className="mt-1.5 text-[11.5px] font-medium text-brand-danger">{errors[`doc_${req.key}`]}</p>}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* STEP 4 — Review & Submit */}
            {step === 4 && (
              <div className="space-y-5">
                {missingItems.length > 0 && (
                  <InfoNote tone="danger" icon={AlertCircle}>
                    <p className="font-semibold">Some required information is still missing:</p>
                    <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
                      {missingItems.map((m, i) => <li key={`${i}-${m}`}>{m}</li>)}
                    </ul>
                  </InfoNote>
                )}

                <ReviewBlock title="Personal Information" onEdit={() => goTo(1)} items={[
                  ["Full Name", composedName || "—"],
                  ["Birth Date", form.dob || "—"],
                  ["Age", calcAge(form.dob) || "—"],
                  ["Sex", form.sex || "—"],
                  ["Civil Status", form.civilStatus || "—"],
                ]} />

                <ReviewBlock title="Account & Contact" onEdit={() => goTo(2)} items={[
                  ["Official Email", form.email || "—"],
                  ["Contact Number", form.contact || "—"],
                  ["Username", form.username || "—"],
                ]} />

                <ReviewBlock title="Professional Information" onEdit={() => goTo(3)} items={[
                  ["Full Name", composedName || "—"],
                  ["Health Personnel Role", role?.label || "—"],
                  ["Professional License No.", role?.licenseRequired ? (form.licenseNumber || "—") : "Not applicable"],
                  ["License Expiration", role?.licenseRequired ? (form.licenseExpiry || "—") : "Not applicable"],
                  ["Municipality / LGU", form.municipality ? `${form.municipality}, Camarines Sur` : "—"],
                  [isBarangayScoped ? "Barangay" : "Health Facility", isBarangayScoped ? (form.barangay || "—") : (form.facility || "—")],
                  ["Department / Office", form.department || "—"],
                  ["Position / Designation", form.position || "—"],
                  ["Employment Status", form.employmentStatus || "—"],
                  ["Years of Service", form.yearsOfService || "—"],
                ]} />

                <ReviewBlock
                  title="Documents"
                  onEdit={() => goTo(3)}
                  items={
                    documentList.length === 0
                      ? [["Documents", "Select a role to determine required documents"]]
                      : documentList.map((r) => [r.label, form.documents[r.key]?.name || "Not uploaded"])
                  }
                />

                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4 text-[12.5px] leading-relaxed text-slate-600">
                  <input
                    type="checkbox"
                    checked={form.confirm}
                    onChange={(e) => { setForm((prev) => ({ ...prev, confirm: e.target.checked })); if (errors.confirm) setErrors((prev) => ({ ...prev, confirm: "" })); }}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-brand-blue focus:ring-brand-blue/30"
                  />
                  <span>I confirm that the information provided is accurate and complete.</span>
                </label>
                {errors.confirm && <p className="text-[12px] font-medium text-brand-danger">{errors.confirm}</p>}
              </div>
            )}
          </motion.div>

          {/* Navigation */}
          <div className="mt-8 flex items-center justify-between gap-3 border-t border-slate-100 pt-5">
            {step > 1 ? (
              <button onClick={back} className={btnGhost}>
                <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" /> Back
              </button>
            ) : (
              <Link to="/register" className={btnGhost}>
                <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" /> All forms
              </Link>
            )}

            {step < 4 ? (
              <button onClick={next} className={btnPrimary}>
                Continue <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={submitting || !allRequiredComplete || !form.confirm}
                className={btnPrimary}
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Submitting
                  </>
                ) : (
                  <>
                    Submit Registration <Check className="h-4 w-4" strokeWidth={2.5} />
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </RegistrationCard>
    </RegistrationShell>
  );
}
