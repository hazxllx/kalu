import React, { useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Eye, EyeOff, ArrowRight, ArrowLeft, Check, MapPin, ChevronDown, Shield, Loader2,
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
import FaceVerification from "@/features/registration/components/FaceVerification";
import UploadComponent from "@/features/registration/components/UploadComponent";

const BARANGAYS = ["San Isidro", "San Antonio", "Old San Roque"];

function calcAge(dob) {
  if (!dob) return "";
  const d = new Date(dob);
  const age = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 365.25));
  return age > 0 && age < 120 ? String(age) : "";
}

function checkStrength(pw) {
  const checks = [
    { label: "At least 8 characters", pass: pw.length >= 8 },
    { label: "Uppercase letter", pass: /[A-Z]/.test(pw) },
    { label: "Lowercase letter", pass: /[a-z]/.test(pw) },
    { label: "Number", pass: /\d/.test(pw) },
    { label: "Special character", pass: /[^A-Za-z0-9]/.test(pw) },
  ];
  const score = checks.filter((c) => c.pass).length;
  return { checks, score, label: ["Very Weak", "Weak", "Fair", "Good", "Strong"][score - 1] || "", color: ["#E74C3C", "#E74C3C", "#F5B400", "#2A7DE1", "#28B463"][score - 1] || "#E5EAF1" };
}

const STEPS_META = [
  { num: 1, title: "Personal Information", subtitle: "Tell us about yourself." },
  { num: 2, title: "Account & Contact", subtitle: "Set up your login and contact details." },
  { num: 3, title: "Identity Verification", subtitle: "Capture or upload a photo for identity verification." },
  { num: 4, title: "Review Your Information", subtitle: "Please verify all details before submitting." },
];

const STEPS = [
  { num: 1, label: "Personal" },
  { num: 2, label: "Account & Contact" },
  { num: 3, label: "Identity" },
  { num: 4, label: "Review" },
];

export default function NewResidentRegistration() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [show, setShow] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [barangayQuery, setBarangayQuery] = useState("");
  const [barangayOpen, setBarangayOpen] = useState(false);
  /** @type {[Record<string, string>, Function]} */
  const [errors, setErrors] = useState({});

  // Check if there's transfer data in sessionStorage
  const transferData = useMemo(() => {
    try {
      const data = sessionStorage.getItem("transferData");
      if (data) {
        sessionStorage.removeItem("transferData");
        return JSON.parse(data);
      }
    } catch (e) {
      console.error("Error parsing transfer data:", e);
    }
    return null;
  }, []);

  const [form, setForm] = useState({
    firstName: transferData?.firstName || "",
    middleName: transferData?.middleName || "",
    lastName: transferData?.lastName || "",
    suffix: transferData?.suffix || "",
    dob: transferData?.dob || "",
    sex: transferData?.sex || "",
    civilStatus: transferData?.civilStatus || "",
    mobile: transferData?.mobile || "",
    province: transferData?.province || "Camarines Sur",
    municipality: transferData?.municipality || "Pili",
    barangay: transferData?.barangay || "",
    sitio: transferData?.sitio || "",
    street: transferData?.street || "",
    houseNo: transferData?.houseNo || "",
    landmark: transferData?.landmark || "",
    occupation: transferData?.occupation || "",
    email: "",
    password: "",
    confirmPassword: "",
    agree: false,
    agreePrivacy: false,
    facePhoto: null,
    idPhoto: null,
  });

  const set = (key) => (e) => {
    const val = e.target ? e.target.value : e;
    setForm((p) => ({ ...p, [key]: val }));
    if (errors[key]) setErrors((p) => ({ ...p, [key]: "" }));
  };

  const pwStrength = useMemo(() => checkStrength(form.password), [form.password]);
  const filteredBarangays = BARANGAYS.filter((b) => b.toLowerCase().includes(barangayQuery.toLowerCase()));

  const validateStep = (s) => {
    const errs = {};
    if (s === 1) {
      if (!form.firstName) errs.firstName = "First name is required";
      if (!form.lastName) errs.lastName = "Last name is required";
      if (!form.dob) errs.dob = "Date of birth is required";
      if (!form.sex) errs.sex = "Sex is required";
      if (!form.civilStatus) errs.civilStatus = "Civil status is required";
    }
    if (s === 2) {
      if (!form.email) errs.email = "Email is required";
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = "Enter a valid email address";
      if (!form.password) errs.password = "Password is required";
      if (form.password !== form.confirmPassword) errs.confirmPassword = "Passwords do not match";
      if (!form.mobile) errs.mobile = "Mobile number is required";
      if (!form.barangay) errs.barangay = "Barangay is required";
      if (!form.sitio) errs.sitio = "Sitio / Purok is required";
      if (!form.agree || !form.agreePrivacy) errs.agree = "You must accept Terms and Privacy Policy";
    }
    if (s === 3) {
      if (!form.facePhoto) errs.facePhoto = "Please capture or upload a photo for verification";
      if (!form.idPhoto) errs.idPhoto = "Please upload a government ID for verification";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const next = () => { if (validateStep(step)) setStep((p) => Math.min(p + 1, 4)); };
  const back = () => setStep((p) => Math.max(p - 1, 1));
  const goTo = (s) => setStep(s);

  const submit = () => {
    setSubmitting(true);
    setTimeout(() => navigate("/registration-success"), 1800);
  };

  const meta = STEPS_META[step - 1];

  return (
    <RegistrationShell
      footer={
        <div className="mt-5 flex flex-col items-center gap-1.5 text-center">
          <p className="text-[12.5px] text-white/70">
            Already registered?{" "}
            <Link
              to="/login"
              className="font-semibold text-white underline decoration-white/30 underline-offset-4 transition-colors hover:decoration-white"
            >
              Sign in to the portal
            </Link>
          </p>
          <p className="text-[11.5px] text-white/50">No fees are collected for registration.</p>
        </div>
      }
    >
      <RegistrationCard>
        <div className="px-5 py-6 sm:px-10 sm:py-8">
          <StepIndicator current={step} steps={STEPS} flowLabel="Personal Registration" />

          <motion.div
            key={step}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.28 }}
            className="mt-6 space-y-5"
          >
            <PageHeading title={meta.title} subtitle={meta.subtitle} />

            {/* STEP 1: Personal Information */}
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
                  <input
                    type="date"
                    value={form.dob}
                    onChange={(e) => { setForm({ ...form, dob: e.target.value }); if (errors.dob) setErrors({ ...errors, dob: "" }); }}
                    className={inputCls(errors.dob)}
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

            {/* STEP 2: Account & Contact */}
            {step === 2 && (
              <div className="space-y-5">
                <Field label="Email Address" required error={errors.email}>
                  <input type="email" placeholder="you@example.com" value={form.email} onChange={set("email")} className={inputCls(errors.email)} />
                </Field>

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
                      <span className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">
                        Password Strength
                      </span>
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

                <div className="border-t border-slate-100 pt-5">
                  <SectionKicker>Contact Information</SectionKicker>
                  <div className="mt-5 space-y-5">
                    <Field label="Mobile Number" required error={errors.mobile}>
                      <input type="tel" placeholder="09XX XXX XXXX" value={form.mobile} onChange={set("mobile")} className={inputCls(errors.mobile)} />
                    </Field>
                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                      <Field label="Province">
                        <input type="text" value={form.province} onChange={set("province")} className={inputCls()} />
                      </Field>
                      <Field label="Municipality">
                        <input type="text" value={form.municipality} onChange={set("municipality")} className={inputCls()} />
                      </Field>
                    </div>

                    <Field label="Barangay" required error={errors.barangay}>
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setBarangayOpen(!barangayOpen)}
                          className={`${inputCls(errors.barangay)} flex cursor-pointer items-center gap-2 text-left`}
                        >
                          <MapPin className="h-4 w-4 shrink-0 text-slate-400" />
                          <span className={`min-w-0 flex-1 truncate ${form.barangay ? "text-brand-ink" : "text-slate-400"}`}>
                            {form.barangay || "Search and select your barangay"}
                          </span>
                          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                        </button>
                        {barangayOpen && (
                          <div className="absolute z-20 mt-1.5 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_18px_40px_-16px_rgba(9,30,66,0.35)]">
                            <div className="border-b border-slate-200 bg-slate-50/70 p-2">
                              <input
                                autoFocus
                                value={barangayQuery}
                                onChange={(e) => setBarangayQuery(e.target.value)}
                                placeholder="Type to search..."
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] outline-none placeholder:text-slate-400 focus:border-brand-blue"
                              />
                            </div>
                            <div className="max-h-48 overflow-y-auto">
                              {filteredBarangays.length === 0 && (
                                <p className="px-4 py-3 text-[12.5px] text-slate-400">No barangay found.</p>
                              )}
                              {filteredBarangays.map((b) => (
                                <button
                                  key={b}
                                  type="button"
                                  onClick={() => { setForm({ ...form, barangay: b }); setBarangayOpen(false); setBarangayQuery(""); setErrors({ ...errors, barangay: "" }); }}
                                  className="w-full border-b border-slate-100 px-4 py-2.5 text-left text-[13px] text-brand-ink transition-colors last:border-b-0 hover:bg-slate-50"
                                >
                                  {b}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </Field>

                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                      <Field label="Sitio / Purok" required error={errors.sitio}>
                        <input type="text" placeholder="Purok 5" value={form.sitio} onChange={set("sitio")} className={inputCls(errors.sitio)} />
                      </Field>
                      <Field label="Street" optional>
                        <input type="text" placeholder="Mabini St." value={form.street} onChange={set("street")} className={inputCls()} />
                      </Field>
                    </div>
                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                      <Field label="House Number" optional>
                        <input type="text" placeholder="Leave blank if not applicable" value={form.houseNo} onChange={set("houseNo")} className={inputCls()} />
                      </Field>
                      <Field label="Nearest Landmark" optional>
                        <input type="text" placeholder="Near San Isidro Chapel" value={form.landmark} onChange={set("landmark")} className={inputCls()} />
                      </Field>
                    </div>
                    <Field label="Occupation" optional>
                      <input type="text" placeholder="Farmer" value={form.occupation} onChange={set("occupation")} className={inputCls()} />
                    </Field>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-5">
                  <SectionKicker>Declaration and Consent</SectionKicker>
                  <div className="mt-4 space-y-3">
                    <label className="flex cursor-pointer items-start gap-3 text-[12.5px] leading-relaxed text-slate-600">
                      <input
                        type="checkbox"
                        checked={form.agree}
                        onChange={(e) => { setForm({ ...form, agree: e.target.checked }); setErrors({ ...errors, agree: "" }); }}
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-brand-blue focus:ring-brand-blue/30"
                      />
                      <span>
                        I certify that the information provided is true and correct, and I agree to the{" "}
                        <a href="#" className="font-semibold text-brand-blue underline underline-offset-2">Terms and Conditions</a> of this portal.
                      </span>
                    </label>
                    <label className="flex cursor-pointer items-start gap-3 text-[12.5px] leading-relaxed text-slate-600">
                      <input
                        type="checkbox"
                        checked={form.agreePrivacy}
                        onChange={(e) => { setForm({ ...form, agreePrivacy: e.target.checked }); setErrors({ ...errors, agree: "" }); }}
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-brand-blue focus:ring-brand-blue/30"
                      />
                      <span>
                        Pursuant to the Data Privacy Act of 2012 (RA 10173), I consent to the collection and processing of my
                        personal and health information for the delivery of municipal health services.
                      </span>
                    </label>
                  </div>
                  {errors.agree && <p className="mt-3 text-[12px] font-medium text-brand-danger">{errors.agree}</p>}
                </div>
              </div>
            )}

            {/* STEP 3: Identity Verification */}
            {step === 3 && (
              <div className="space-y-6">
                <InfoNote icon={Shield}>
                  <p className="text-[12px] font-bold uppercase tracking-[0.08em] text-brand-dark">Identity Verification</p>
                  <p className="mt-1">
                    Capture a selfie or upload a clear photo of your face. This will be reviewed by your assigned Barangay
                    Health Worker before your account receives full access.
                  </p>
                </InfoNote>
                <div>
                  <SectionKicker className="mb-3.5">Face Photo</SectionKicker>
                  <FaceVerification
                    captured={form.facePhoto}
                    onCapture={(f) => { setForm({ ...form, facePhoto: f }); setErrors({ ...errors, facePhoto: "" }); }}
                    onRemove={() => setForm({ ...form, facePhoto: null })}
                    error={errors.facePhoto}
                  />
                </div>
                <div>
                  <SectionKicker className="mb-3.5">Government ID</SectionKicker>
                  <UploadComponent
                    label="Upload ID (SSS, UMID, Driver's License, etc.)"
                    file={form.idPhoto}
                    onFile={(f) => { setForm({ ...form, idPhoto: f }); setErrors({ ...errors, idPhoto: "" }); }}
                    onRemove={() => setForm({ ...form, idPhoto: null })}
                  />
                  {errors.idPhoto && <p className="mt-1.5 text-[11.5px] font-medium text-brand-danger">{errors.idPhoto}</p>}
                </div>
              </div>
            )}

            {/* STEP 4: Review Information */}
            {step === 4 && (
              <div className="space-y-5">
                <ReviewBlock title="Personal Information" onEdit={() => goTo(1)} items={[
                  ["Name", `${form.firstName} ${form.middleName} ${form.lastName} ${form.suffix}`.trim()],
                  ["Birth Date", form.dob],
                  ["Age", calcAge(form.dob)],
                  ["Sex", form.sex],
                  ["Civil Status", form.civilStatus],
                  ["Occupation", form.occupation || "N/A"],
                ]} />
                <ReviewBlock title="Contact Information" onEdit={() => goTo(2)} items={[
                  ["Email", form.email],
                  ["Mobile Number", form.mobile],
                  ["Address", `${form.houseNo ? form.houseNo + ", " : ""}${form.street ? form.street + ", " : ""}Purok ${form.sitio}, Barangay ${form.barangay}, ${form.municipality}, ${form.province}`],
                  ["Nearest Landmark", form.landmark || "N/A"],
                ]} />
                <ReviewBlock title="Identity Verification" onEdit={() => goTo(3)} items={[
                  ["Face Photo", form.facePhoto ? "Captured — pending review" : "Not captured"],
                  ["Government ID", form.idPhoto ? `Uploaded — ${form.idPhoto.name}` : "Not uploaded"],
                ]} />
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
                Continue
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </button>
            ) : (
              <button onClick={submit} disabled={submitting} className={btnPrimary}>
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Submitting
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
