import React, { useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Mail, Lock, Eye, EyeOff, ArrowRight, ArrowLeft, Check, User, Phone,
  MapPin, Calendar, ChevronDown, Shield, Camera, FileText, Edit3,
} from "lucide-react";
import StepIndicator4 from "@/features/registration/components/StepIndicatorFourSteps";
import { TextField, SelectField } from "@/features/registration/components/FormFields";
import FaceVerification from "@/features/registration/components/FaceVerification";
import UploadComponent from "@/features/registration/components/UploadComponent";
import { AgencyMark } from "@/components/branding/GovChrome";

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
  { num: 1, title: "Personal Information", subtitle: "Tell us about yourself.", icon: User },
  { num: 2, title: "Account & Contact", subtitle: "Set up your login and contact details.", icon: Phone },
  { num: 3, title: "Identity Verification", subtitle: "Capture or upload a photo for identity verification.", icon: Camera },
  { num: 4, title: "Review Your Information", subtitle: "Please verify all details before submitting.", icon: FileText },
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
  const completed = [];
  for (let i = 1; i < step; i++) completed.push(i);

  return (
    <Shell>
      <div className="w-full">
        <AgencyMark align="center" sealSize={44} />
        <div className="gov-sheet mt-7 bg-white p-6 md:p-9">
          <StepIndicator4 current={step} completed={completed} />
        </div>

        <motion.div
          key={step}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="gov-sheet mt-6 bg-white"
        >
          <div className="flex items-center justify-between gap-4 border-b border-brand-border bg-brand-paper px-7 py-5 md:px-9">
            <div className="flex items-center gap-3.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-brand-blue/20 bg-brand-light text-brand-blue">
                <meta.icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
              </div>
              <div>
                <h1 className="font-display text-[19px] font-bold leading-tight text-brand-dark md:text-[21px]">
                  {meta.title}
                </h1>
                <p className="mt-0.5 text-[12px] text-brand-gray">{meta.subtitle}</p>
              </div>
            </div>
            <span className="hidden shrink-0 border border-brand-border bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-gov text-brand-gray sm:block">
              Form A
            </span>
          </div>

          <div className="px-7 py-7 md:px-9">
            {/* STEP 1: Personal Information */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <TextField label="First Name" icon={User} placeholder="Juan" value={form.firstName} onChange={set("firstName")} error={errors.firstName} />
                <TextField label="Middle Name" icon={User} optional placeholder="Reyes" value={form.middleName} onChange={set("middleName")} />
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <TextField label="Last Name" icon={User} placeholder="Dela Cruz" value={form.lastName} onChange={set("lastName")} error={errors.lastName} />
                <TextField label="Suffix" icon={User} optional placeholder="Jr." value={form.suffix} onChange={set("suffix")} />
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <TextField label="Birth Date" type="date" icon={Calendar} value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} error={errors.dob} />
                <TextField label="Age" icon={User} value={calcAge(form.dob)} readOnly placeholder="Auto-calculated" />
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <SelectField label="Sex" value={form.sex} onChange={set("sex")} error={errors.sex}>
                  <option value="">Select sex</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </SelectField>
                <SelectField label="Civil Status" value={form.civilStatus} onChange={set("civilStatus")} error={errors.civilStatus}>
                  <option value="">Select status</option>
                  <option value="Single">Single</option>
                  <option value="Married">Married</option>
                  <option value="Widowed">Widowed</option>
                  <option value="Separated">Separated</option>
                </SelectField>
              </div>
            </div>
          )}

          {/* STEP 2: Account & Contact */}
          {step === 2 && (
            <div className="space-y-4">
              <TextField label="Email Address" type="email" icon={Mail} placeholder="you@example.com" value={form.email} onChange={set("email")} error={errors.email} />
              <div className="relative">
                <TextField label="Password" type={show ? "text" : "password"} icon={Lock} placeholder="Create a password" value={form.password} onChange={set("password")} error={errors.password} />
                <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-9 text-brand-gray">
                  {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {form.password && (
                <div className="border border-brand-border bg-brand-paper p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-brand-gray">
                      Password Strength
                    </span>
                    <span className="font-stat text-[11.5px] font-bold uppercase tracking-[0.08em]" style={{ color: pwStrength.color }}>
                      {pwStrength.label}
                    </span>
                  </div>
                  <div className="mt-2.5 flex gap-1">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <div key={i} className="h-1.5 flex-1 overflow-hidden bg-brand-border">
                        <motion.div
                          initial={false}
                          animate={{ width: i < pwStrength.score ? "100%" : "0%" }}
                          transition={{ duration: 0.3 }}
                          className="h-full"
                          style={{ background: pwStrength.color }}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
                    {pwStrength.checks.map((c, i) => (
                      <div key={i} className="flex items-center gap-2 text-[12px]">
                        <div className={`flex h-3.5 w-3.5 items-center justify-center ${c.pass ? "bg-brand-green" : "border border-brand-rule bg-white"}`}>
                          {c.pass && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3.5} />}
                        </div>
                        <span className={c.pass ? "text-brand-ink" : "text-brand-gray"}>{c.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="relative">
                <TextField label="Confirm Password" type={showConfirm ? "text" : "password"} icon={Lock} placeholder="Re-enter password" value={form.confirmPassword} onChange={set("confirmPassword")} error={errors.confirmPassword} />
                <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="absolute right-3 top-9 text-brand-gray">
                  {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              <div className="mt-7 border-t border-brand-border pt-6">
                <h3 className="gov-kicker text-brand-blue">Contact Information</h3>
                <div className="mt-5 space-y-4">
                  <TextField label="Mobile Number" type="tel" icon={Phone} placeholder="09XX XXX XXXX" value={form.mobile} onChange={set("mobile")} error={errors.mobile} />
                  <div className="grid sm:grid-cols-2 gap-4">
                    <TextField label="Province" icon={MapPin} value={form.province} onChange={set("province")} />
                    <TextField label="Municipality" icon={MapPin} value={form.municipality} onChange={set("municipality")} />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-brand-ink">Barangay <span className="text-brand-danger">*</span></label>
                    <div className="relative mt-1.5">
                      <button type="button" onClick={() => setBarangayOpen(!barangayOpen)}
                        className={`w-full flex items-center gap-2 bg-white border px-3.5 py-2.5 text-[13.5px] transition-colors ${errors.barangay ? "border-brand-danger" : "border-brand-border focus:border-brand-blue"}`}>
                        <MapPin className="w-4 h-4 text-brand-gray shrink-0" />
                        <span className={form.barangay ? "text-brand-ink" : "text-brand-gray/50"}>{form.barangay || "Search and select your barangay"}</span>
                        <ChevronDown className="w-4 h-4 text-brand-gray ml-auto" />
                      </button>
                      {barangayOpen && (
                        <div className="absolute z-20 mt-1 w-full border border-brand-border bg-white shadow-raise">
                          <div className="border-b border-brand-border bg-brand-paper p-2">
                            <input autoFocus value={barangayQuery} onChange={(e) => setBarangayQuery(e.target.value)} placeholder="Type to search..."
                              className="w-full border border-brand-border bg-white px-3 py-2 text-[13px] outline-none placeholder:text-brand-gray/45 focus:border-brand-blue" />
                          </div>
                          <div className="max-h-48 overflow-y-auto">
                            {filteredBarangays.map((b) => (
                              <button key={b} type="button" onClick={() => { setForm({ ...form, barangay: b }); setBarangayOpen(false); setBarangayQuery(""); setErrors({ ...errors, barangay: "" }); }}
                                className="w-full border-b border-brand-border/50 px-4 py-2.5 text-left text-[13px] text-brand-ink transition-colors last:border-b-0 hover:bg-brand-paper">{b}</button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    {errors.barangay && <p className="mt-1 text-[11.5px] text-brand-danger">{errors.barangay}</p>}
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <TextField label="Sitio / Purok" icon={MapPin} placeholder="Purok 5" value={form.sitio} onChange={set("sitio")} error={errors.sitio} />
                    <TextField label="Street" icon={MapPin} optional placeholder="Mabini St." value={form.street} onChange={set("street")} />
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <TextField label="House Number" icon={MapPin} optional placeholder="Leave blank if not applicable" value={form.houseNo} onChange={set("houseNo")} />
                    <TextField label="Nearest Landmark" icon={MapPin} optional placeholder="Near San Isidro Chapel" value={form.landmark} onChange={set("landmark")} />
                  </div>
                  <TextField label="Occupation" icon={User} optional placeholder="Farmer" value={form.occupation} onChange={set("occupation")} />
                </div>
              </div>

              <div className="mt-7 border border-brand-border bg-brand-paper p-5">
                <h3 className="gov-kicker text-brand-blue">Declaration and Consent</h3>
                <div className="mt-4 space-y-3">
                  <label className="flex cursor-pointer items-start gap-3 text-[12.5px] leading-relaxed text-brand-gray">
                    <input type="checkbox" checked={form.agree} onChange={(e) => { setForm({ ...form, agree: e.target.checked }); setErrors({ ...errors, agree: "" }); }} className="mt-0.5 h-4 w-4 shrink-0 rounded-none border-brand-rule text-brand-blue focus:ring-brand-blue/30" />
                    <span>
                      I certify that the information provided is true and correct, and I agree to the{" "}
                      <a href="#" className="font-semibold text-brand-blue underline decoration-brand-rule underline-offset-2">Terms and Conditions</a> of this portal.
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-3 text-[12.5px] leading-relaxed text-brand-gray">
                    <input type="checkbox" checked={form.agreePrivacy} onChange={(e) => { setForm({ ...form, agreePrivacy: e.target.checked }); setErrors({ ...errors, agree: "" }); }} className="mt-0.5 h-4 w-4 shrink-0 rounded-none border-brand-rule text-brand-blue focus:ring-brand-blue/30" />
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
            <div className="space-y-4">
              <div className="flex items-start gap-3.5 border-l-2 border-brand-blue bg-brand-light px-4 py-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center border border-brand-blue/25 bg-white">
                  <Shield className="h-4 w-4 text-brand-blue" strokeWidth={1.8} />
                </div>
                <div>
                  <p className="text-[12.5px] font-bold uppercase tracking-[0.08em] text-brand-dark">Identity Verification</p>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-brand-gray">
                    Capture a selfie or upload a clear photo of your face. This will be reviewed by your assigned Barangay
                    Health Worker before your account receives full access.
                  </p>
                </div>
              </div>
              <div className="space-y-7 pt-2">
                <div>
                  <h3 className="gov-kicker mb-3.5 text-brand-blue">Face Photo</h3>
                  <FaceVerification
                    captured={form.facePhoto}
                    onCapture={(f) => { setForm({ ...form, facePhoto: f }); setErrors({ ...errors, facePhoto: "" }); }}
                    onRemove={() => setForm({ ...form, facePhoto: null })}
                    error={errors.facePhoto}
                  />
                </div>
                <div>
                  <h3 className="gov-kicker mb-3.5 text-brand-blue">Government ID</h3>
                  <UploadComponent
                    label="Upload ID (SSS, UMID, Driver's License, etc.)"
                    file={form.idPhoto}
                    onFile={(f) => { setForm({ ...form, idPhoto: f }); setErrors({ ...errors, idPhoto: "" }); }}
                    onRemove={() => setForm({ ...form, idPhoto: null })}
                  />
                  {errors.idPhoto && <p className="mt-1 text-[11.5px] text-brand-danger">{errors.idPhoto}</p>}
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: Review Information */}
          {step === 4 && (
            <div className="space-y-4">
              <ReviewSection title="Personal Information" onEdit={() => goTo(1)} items={[
                ["Name", `${form.firstName} ${form.middleName} ${form.lastName} ${form.suffix}`.trim()],
                ["Birth Date", form.dob],
                ["Age", calcAge(form.dob)],
                ["Sex", form.sex],
                ["Civil Status", form.civilStatus],
                ["Occupation", form.occupation || "N/A"],
              ]} />
              <ReviewSection title="Contact Information" onEdit={() => goTo(2)} items={[
                ["Email", form.email],
                ["Mobile Number", form.mobile],
                ["Address", `${form.houseNo ? form.houseNo + ", " : ""}${form.street ? form.street + ", " : ""}Purok ${form.sitio}, Barangay ${form.barangay}, ${form.municipality}, ${form.province}`],
                ["Nearest Landmark", form.landmark || "N/A"],
              ]} />
              <ReviewSection title="Identity Verification" onEdit={() => goTo(3)} items={[
                ["Face Photo", form.facePhoto ? "Captured — pending review" : "Not captured"],
                ["Government ID", form.idPhoto ? `Uploaded — ${form.idPhoto.name}` : "Not uploaded"],
              ]} />
            </div>
          )}
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-between gap-4 border-t border-brand-border bg-brand-paper px-7 py-5 md:px-9">
            {step > 1 ? (
              <button
                onClick={back}
                className="flex items-center gap-2 text-[12.5px] font-bold uppercase tracking-[0.08em] text-brand-gray transition-colors hover:text-brand-blue"
              >
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
            ) : (
              <Link
                to="/register"
                className="flex items-center gap-2 text-[12.5px] font-bold uppercase tracking-[0.08em] text-brand-gray transition-colors hover:text-brand-blue"
              >
                <ArrowLeft className="h-4 w-4" /> Back to forms
              </Link>
            )}

            {step < 4 ? (
              <button
                onClick={next}
                className="group flex items-center gap-2.5 bg-brand-blue px-7 py-3 text-[12.5px] font-bold uppercase tracking-[0.11em] text-white transition-colors hover:bg-brand-dark"
              >
                Continue
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={submitting}
                className="flex items-center gap-2.5 bg-brand-green px-7 py-3 text-[12.5px] font-bold uppercase tracking-[0.11em] text-white transition-colors hover:brightness-110 disabled:opacity-70"
              >
                {submitting ? (
                  <>
                    <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}>
                      <Shield className="h-4 w-4" />
                    </motion.div>
                    Submitting
                  </>
                ) : (
                  <>
                    Submit Application <Check className="h-4 w-4" />
                  </>
                )}
              </button>
            )}
          </div>
        </motion.div>

        <div className="mt-6 flex flex-col items-center gap-2">
          <p className="text-[13px] text-brand-gray">
            Already registered?{" "}
            <Link
              to="/login"
              className="font-semibold text-brand-blue underline decoration-brand-rule underline-offset-4 hover:decoration-brand-blue"
            >
              Sign in to the portal
            </Link>
          </p>
          <p className="text-[11.5px] text-brand-gray/80">
            No fees are collected for registration.
          </p>
        </div>
      </div>
    </Shell>
  );
}

function ReviewSection({ title, items, onEdit }) {
  return (
    <div className="border border-brand-border">
      <div className="flex items-center justify-between border-b border-brand-border bg-brand-paper px-5 py-3">
        <h3 className="text-[12px] font-bold uppercase tracking-[0.1em] text-brand-dark">{title}</h3>
        <button
          onClick={onEdit}
          className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-[0.08em] text-brand-blue transition-colors hover:text-brand-dark"
        >
          <Edit3 className="h-3.5 w-3.5" /> Edit
        </button>
      </div>
      <dl className="divide-y divide-brand-border/70">
        {items.map(([label, value]) => (
          <div key={label} className="flex items-start gap-4 px-5 py-3">
            <dt className="w-40 shrink-0 text-[12.5px] text-brand-gray">{label}</dt>
            <dd className="text-[13px] font-semibold text-brand-ink">{value || "N/A"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-paper">
      <div className="mx-auto max-w-3xl px-5 py-10 md:px-8 md:py-14">{children}</div>
    </div>
  );
}
