import React, { useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Mail, Lock, Eye, EyeOff, ArrowRight, ArrowLeft, Check, User, Phone,
  MapPin, Calendar, ChevronDown, Shield, Camera, FileText, Edit3, ShieldCheck, AlertCircle, CreditCard,
} from "lucide-react";
import { LOGO_URL } from "@/lib/brand";
import StepIndicator4 from "@/components/register/StepIndicator4";
import { TextField, SelectField } from "@/components/register/FormFields";
import FaceVerification from "@/components/register/FaceVerification";
import UploadComponent from "@/components/register/UploadComponent";

const BARANGAYS = ["San Jose", "San Isidro", "Old San Roque", "Sta. Cruz", "Bagong Silang", "San Antonio", "San Vicente", "Santo Niño"];

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
      <div className="w-full max-w-2xl">
        <div className="text-center mb-6">
          <img src={LOGO_URL} alt="KALUSAGAP" className="h-16 w-auto mx-auto mb-6" />
          <StepIndicator4 current={step} completed={completed} />
        </div>

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-card border border-brand-border shadow-float p-5 md:p-6">

          <div className="mb-6">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-7 h-7 rounded-lg bg-brand-blue/10 flex items-center justify-center">
                <meta.icon className="w-4 h-4 text-brand-blue" strokeWidth={1.8} />
              </div>
              <span className="text-xs font-body font-medium text-brand-gray">Step {step} of 4</span>
            </div>
            <h1 className="text-lg md:text-xl font-heading font-semibold text-brand-ink tracking-tight">{meta.title}</h1>
            <p className="mt-0.5 text-xs text-brand-gray">{meta.subtitle}</p>
          </div>

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
                <div className="bg-brand-bg rounded-card p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-body font-medium text-brand-gray">Password Strength</span>
                    <span className="text-xs font-stat font-bold" style={{ color: pwStrength.color }}>{pwStrength.label}</span>
                  </div>
                  <div className="flex gap-1">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <div key={i} className="flex-1 h-1.5 rounded-full overflow-hidden bg-brand-border">
                        <motion.div initial={false} animate={{ width: i < pwStrength.score ? "100%" : "0%" }} transition={{ duration: 0.3 }} className="h-full rounded-full" style={{ background: pwStrength.color }} />
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 pt-1">
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
              <div className="relative">
                <TextField label="Confirm Password" type={showConfirm ? "text" : "password"} icon={Lock} placeholder="Re-enter password" value={form.confirmPassword} onChange={set("confirmPassword")} error={errors.confirmPassword} />
                <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="absolute right-3 top-9 text-brand-gray">
                  {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              <div className="border-t border-brand-border pt-6 mt-6">
                <h3 className="font-semibold text-brand-ink mb-4">Contact Information</h3>
                <div className="space-y-4">
                  <TextField label="Mobile Number" type="tel" icon={Phone} placeholder="09XX XXX XXXX" value={form.mobile} onChange={set("mobile")} error={errors.mobile} />
                  <div className="grid sm:grid-cols-2 gap-4">
                    <TextField label="Province" icon={MapPin} value={form.province} onChange={set("province")} />
                    <TextField label="Municipality" icon={MapPin} value={form.municipality} onChange={set("municipality")} />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-brand-ink">Barangay <span className="text-brand-danger">*</span></label>
                    <div className="relative mt-1.5">
                      <button type="button" onClick={() => setBarangayOpen(!barangayOpen)}
                        className={`w-full flex items-center gap-2 bg-white border rounded-input px-3.5 py-2.5 text-sm transition-colors ${errors.barangay ? "border-brand-danger" : "border-brand-border focus:border-brand-blue"}`}>
                        <MapPin className="w-4 h-4 text-brand-gray shrink-0" />
                        <span className={form.barangay ? "text-brand-ink" : "text-brand-gray/50"}>{form.barangay || "Search and select your barangay"}</span>
                        <ChevronDown className="w-4 h-4 text-brand-gray ml-auto" />
                      </button>
                      {barangayOpen && (
                        <div className="absolute z-20 mt-1 w-full bg-white border border-brand-border rounded-input shadow-float overflow-hidden">
                          <div className="p-2 border-b border-brand-border">
                            <input autoFocus value={barangayQuery} onChange={(e) => setBarangayQuery(e.target.value)} placeholder="Type to search..."
                              className="w-full bg-brand-bg border border-brand-border rounded-btn px-3 py-2 text-sm outline-none focus:border-brand-blue" />
                          </div>
                          <div className="max-h-48 overflow-y-auto">
                            {filteredBarangays.map((b) => (
                              <button key={b} type="button" onClick={() => { setForm({ ...form, barangay: b }); setBarangayOpen(false); setBarangayQuery(""); setErrors({ ...errors, barangay: "" }); }}
                                className="w-full text-left px-4 py-2.5 text-sm text-brand-ink hover:bg-brand-bg transition-colors">{b}</button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    {errors.barangay && <p className="mt-1 text-xs text-brand-danger">{errors.barangay}</p>}
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <TextField label="Sitio / Purok" icon={MapPin} placeholder="Purok 5" value={form.sitio} onChange={set("sitio")} error={errors.sitio} />
                    <TextField label="Street" icon={MapPin} optional placeholder="Mabini St." value={form.street} onChange={set("street")} />
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <TextField label="House Number" icon={MapPin} optional placeholder="Leave blank if not applicable" value={form.houseNo} onChange={set("houseNo")} />
                    <TextField label="Nearest Landmark" icon={MapPin} optional placeholder="Near San Jose Chapel" value={form.landmark} onChange={set("landmark")} />
                  </div>
                  <TextField label="Occupation" icon={User} optional placeholder="Farmer" value={form.occupation} onChange={set("occupation")} />
                </div>
              </div>

              <div className="space-y-2.5 pt-4">
                <label className="flex items-start gap-2.5 text-sm text-brand-gray cursor-pointer">
                  <input type="checkbox" checked={form.agree} onChange={(e) => { setForm({ ...form, agree: e.target.checked }); setErrors({ ...errors, agree: "" }); }} className="mt-0.5 rounded border-brand-border text-brand-blue" />
                  <span>I agree to the <a href="#" className="text-brand-blue font-medium hover:underline">Terms and Conditions</a>.</span>
                </label>
                <label className="flex items-start gap-2.5 text-sm text-brand-gray cursor-pointer">
                  <input type="checkbox" checked={form.agreePrivacy} onChange={(e) => { setForm({ ...form, agreePrivacy: e.target.checked }); setErrors({ ...errors, agree: "" }); }} className="mt-0.5 rounded border-brand-border text-brand-blue" />
                  <span>I acknowledge the <a href="#" className="text-brand-blue font-medium hover:underline">Privacy Policy</a> and consent to the processing of my personal and health data.</span>
                </label>
                {errors.agree && <p className="text-xs text-brand-danger">{errors.agree}</p>}
              </div>
            </div>
          )}

          {/* STEP 3: Identity Verification */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="bg-brand-blue/5 border border-brand-blue/15 rounded-card p-4 flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-brand-blue/10 flex items-center justify-center shrink-0">
                  <Shield className="w-4 h-4 text-brand-blue" strokeWidth={1.8} />
                </div>
                <div>
                  <p className="text-sm font-medium text-brand-ink">Identity Verification</p>
                  <p className="text-xs text-brand-gray mt-0.5">
                    Capture a selfie or upload a clear photo of your face. This will be reviewed by your assigned Barangay Health Worker before your account receives full access.
                  </p>
                </div>
              </div>
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-semibold text-brand-ink mb-3">Face Photo</h3>
                  <FaceVerification
                    captured={form.facePhoto}
                    onCapture={(f) => { setForm({ ...form, facePhoto: f }); setErrors({ ...errors, facePhoto: "" }); }}
                    onRemove={() => setForm({ ...form, facePhoto: null })}
                    error={errors.facePhoto}
                  />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-brand-ink mb-3">Government ID</h3>
                  <UploadComponent
                    label="Upload ID (SSS, UMID, Driver's License, etc.)"
                    file={form.idPhoto}
                    onFile={(f) => { setForm({ ...form, idPhoto: f }); setErrors({ ...errors, idPhoto: "" }); }}
                    onRemove={() => setForm({ ...form, idPhoto: null })}
                  />
                  {errors.idPhoto && <p className="mt-1 text-xs text-brand-danger">{errors.idPhoto}</p>}
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
        </motion.div>

        {/* Navigation */}
        <div className="flex items-center justify-between mt-7 pt-5 border-t border-brand-border">
          {step > 1 ? (
            <button onClick={back} className="flex items-center gap-2 text-sm font-body font-medium text-brand-gray hover:text-brand-ink transition-colors">
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
          ) : (
            <Link to="/register" className="flex items-center gap-2 text-sm font-body font-medium text-brand-gray hover:text-brand-ink transition-colors">
              <ArrowLeft className="w-4 h-4" /> Back to options
            </Link>
          )}
          {step < 4 ? (
            <button onClick={next} className="flex items-center gap-2 bg-brand-blue text-white px-6 py-2.5 rounded-btn text-sm font-body font-medium hover:bg-brand-dark transition-colors shadow-soft">
              Continue <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button onClick={submit} disabled={submitting}
              className="flex items-center gap-2 bg-brand-green text-white px-6 py-2.5 rounded-btn text-sm font-body font-medium hover:bg-brand-green/90 transition-colors shadow-soft disabled:opacity-70">
              {submitting ? (
                <>
                  <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}>
                    <Shield className="w-4 h-4" />
                  </motion.div>
                  Submitting...
                </>
              ) : (
                <>Submit Registration <Check className="w-4 h-4" /></>
              )}
            </button>
          )}
        </div>

        <p className="mt-6 text-center text-sm text-brand-gray">
          Already have an account? <Link to="/login" className="text-brand-blue font-medium hover:underline">Login</Link>
        </p>
      </div>
    </Shell>
  );
}

function ReviewSection({ title, items, onEdit }) {
  return (
    <div className="border border-brand-border rounded-card overflow-hidden">
      <div className="flex items-center justify-between bg-brand-bg px-5 py-3 border-b border-brand-border">
        <h3 className="text-sm font-heading font-semibold text-brand-ink">{title}</h3>
        <button onClick={onEdit} className="flex items-center gap-1.5 text-xs text-brand-blue font-medium hover:underline">
          <Edit3 className="w-3.5 h-3.5" /> Edit
        </button>
      </div>
      <div className="px-5 py-3 space-y-2">
        {items.map(([label, value]) => (
          <div key={label} className="flex items-start gap-4 text-sm">
            <span className="text-brand-gray w-36 shrink-0">{label}</span>
            <span className="text-brand-ink font-medium">{value || "N/A"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Shell({ children }) {
  return (
    <div className="w-full bg-gradient-to-br from-brand-bg via-brand-blue/5 to-brand-yellow/3 p-4 md:p-6">
      <div className="absolute top-0 left-0 w-[500px] h-[500px] bg-brand-blue/8 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
      <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-brand-yellow/8 rounded-full blur-3xl translate-x-1/2 translate-y-1/2" />
      <div className="absolute top-1/3 left-1/4 w-96 h-96 bg-brand-green/5 rounded-full blur-2xl" />
      <div className="relative flex flex-col items-center justify-center px-4 py-8">
        {children}
      </div>
    </div>
  );
}
