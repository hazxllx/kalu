import React, { useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Mail, Lock, Eye, EyeOff, ArrowRight, ArrowLeft, Check,
  User, Phone, MapPin, Calendar, ChevronDown, Shield, FileText, ArrowLeftCircle,
} from "lucide-react";
import { LOGO_URL } from "@/lib/brand";
import StepIndicator from "@/components/register/StepIndicator";
import StepWrapper from "@/components/register/StepWrapper";
import { TextField, SelectField } from "@/components/register/FormFields";
import UploadComponent from "@/components/register/UploadComponent";

const BARANGAYS = ["San Jose", "San Isidro", "Old San Roque", "Sta. Cruz", "Bagong Silang", "San Antonio", "San Vicente", "Santo Niño"];

function calcAge(dob) {
  if (!dob) return "";
  const d = new Date(dob);
  const diff = Date.now() - d.getTime();
  const age = Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
  return age > 0 && age < 120 ? String(age) : "";
}

function checkPasswordStrength(pw) {
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
  { num: 1, title: "Create Your KALUSAGAP Account", subtitle: "Start by setting up your login credentials.", icon: Shield },
  { num: 2, title: "Personal Information", subtitle: "Tell us about yourself.", icon: User },
  { num: 3, title: "Residential Address", subtitle: "Where do you currently reside?", icon: MapPin },
  { num: 4, title: "Identity Verification", subtitle: "Upload a valid government-issued ID.", icon: FileText },
];

const ACCEPTED_IDS = [
  "Philippine National ID", "Driver's License", "Passport", "PhilHealth ID",
  "Postal ID", "UMID", "Voter's ID", "Senior Citizen ID", "Barangay ID", "Student ID",
];

export default function Register() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [show, setShow] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [barangayQuery, setBarangayQuery] = useState("");
  const [barangayOpen, setBarangayOpen] = useState(false);
  const [errors, setErrors] = useState({});

  const [form, setForm] = useState({
    email: "", password: "", confirmPassword: "", agree: false, agreePrivacy: false,
    firstName: "", middleName: "", lastName: "", suffix: "", dob: "", age: "",
    sex: "", civilStatus: "", occupation: "", mobile: "",
    province: "Camarines Sur", municipality: "Pili", barangay: "", sitio: "",
    street: "", houseNo: "", landmark: "", householdNo: "",
    idDocument: null,
  });

  const set = (key) => (e) => {
    const val = e.target ? e.target.value : e;
    setForm((p) => ({ ...p, [key]: val }));
    if (errors[key]) setErrors((p) => ({ ...p, [key]: "" }));
  };

  const pwStrength = useMemo(() => checkPasswordStrength(form.password), [form.password]);
  const filteredBarangays = BARANGAYS.filter((b) => b.toLowerCase().includes(barangayQuery.toLowerCase()));

  const validateStep = (s) => {
    const errs = {};
    if (s === 1) {
      if (!form.email) errs.email = "Email is required";
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = "Enter a valid email address";
      if (!form.password) errs.password = "Password is required";
      if (form.password !== form.confirmPassword) errs.confirmPassword = "Passwords do not match";
      if (!form.agree || !form.agreePrivacy) errs.agree = "You must accept Terms and Privacy Policy to continue";
    }
    if (s === 2) {
      if (!form.firstName) errs.firstName = "First name is required";
      if (!form.lastName) errs.lastName = "Last name is required";
      if (!form.dob) errs.dob = "Date of birth is required";
      if (!form.sex) errs.sex = "Sex is required";
      if (!form.civilStatus) errs.civilStatus = "Civil status is required";
      if (!form.mobile) errs.mobile = "Mobile number is required";
    }
    if (s === 3) {
      if (!form.barangay) errs.barangay = "Barangay is required";
      if (!form.sitio) errs.sitio = "Sitio / Purok is required";
    }
    if (s === 4) {
      if (!form.idDocument) errs.idDocument = "Please upload one side of your valid ID";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const next = () => {
    if (!validateStep(step)) return;
    setStep((p) => Math.min(p + 1, 4));
  };
  const back = () => setStep((p) => Math.max(p - 1, 1));

  const submit = () => {
    if (!validateStep(4)) return;
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
          <StepIndicator current={step} completed={completed} />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-card border border-brand-border shadow-float p-6 md:p-8"
        >
          <StepWrapper step={step}>
            {/* Step header */}
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-7 h-7 rounded-lg bg-brand-blue/10 flex items-center justify-center">
                  <meta.icon className="w-4 h-4 text-brand-blue" strokeWidth={1.8} />
                </div>
                <span className="text-xs font-body font-medium text-brand-gray">Step {step} of 4</span>
              </div>
              <h1 className="text-xl md:text-2xl font-heading font-semibold text-brand-ink tracking-tight">{meta.title}</h1>
              <p className="mt-1 text-sm text-brand-gray">{meta.subtitle}</p>
            </div>

            {/* STEP 1: Account */}
            {step === 1 && (
              <div className="space-y-4">
                <TextField label="Email Address" type="email" icon={Mail} placeholder="you@example.com" value={form.email} onChange={set("email")} error={errors.email} required />
                <div className="relative">
                  <TextField label="Password" type={show ? "text" : "password"} icon={Lock} placeholder="Create a password" value={form.password} onChange={set("password")} error={errors.password} required />
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
                  <TextField label="Confirm Password" type={showConfirm ? "text" : "password"} icon={Lock} placeholder="Re-enter password" value={form.confirmPassword} onChange={set("confirmPassword")} error={errors.confirmPassword} required />
                  <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="absolute right-3 top-9 text-brand-gray">
                    {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <div className="space-y-2.5 pt-1">
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

            {/* STEP 2: Personal Information */}
            {step === 2 && (
              <div className="space-y-4">
                <div className="grid sm:grid-cols-2 gap-4">
                  <TextField label="First Name" icon={User} placeholder="Juan" value={form.firstName} onChange={set("firstName")} error={errors.firstName} required />
                  <TextField label="Middle Name" icon={User} optional placeholder="Reyes" value={form.middleName} onChange={set("middleName")} />
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <TextField label="Last Name" icon={User} placeholder="Dela Cruz" value={form.lastName} onChange={set("lastName")} error={errors.lastName} required />
                  <TextField label="Suffix" icon={User} optional placeholder="Jr." value={form.suffix} onChange={set("suffix")} />
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <TextField label="Birth Date" type="date" icon={Calendar} value={form.dob} onChange={(e) => { const v = e.target.value; setForm({ ...form, dob: v, age: calcAge(v) }); }} error={errors.dob} required />
                  <TextField label="Age" icon={User} value={calcAge(form.dob)} readOnly placeholder="Auto-calculated" />
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <SelectField label="Sex" value={form.sex} onChange={set("sex")} error={errors.sex} required>
                    <option value="">Select sex</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                  </SelectField>
                  <SelectField label="Civil Status" value={form.civilStatus} onChange={set("civilStatus")} error={errors.civilStatus} required>
                    <option value="">Select status</option>
                    <option value="Single">Single</option>
                    <option value="Married">Married</option>
                    <option value="Widowed">Widowed</option>
                    <option value="Separated">Separated</option>
                  </SelectField>
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <TextField label="Mobile Number" type="tel" icon={Phone} placeholder="09XX XXX XXXX" value={form.mobile} onChange={set("mobile")} error={errors.mobile} required />
                  <TextField label="Occupation" icon={User} optional placeholder="Farmer" value={form.occupation} onChange={set("occupation")} />
                </div>
                {/* Profile picture upload (optional) */}
                <div>
                  <label className="text-sm font-medium text-brand-ink">Profile Picture <span className="text-brand-gray font-normal">(Optional)</span></label>
                  <label className="mt-1.5 flex items-center gap-3 border border-dashed border-brand-border rounded-input px-4 py-3 cursor-pointer hover:border-brand-blue/40 hover:bg-brand-bg transition-colors">
                    <div className="w-10 h-10 rounded-full bg-brand-blue/10 flex items-center justify-center">
                      <User className="w-5 h-5 text-brand-blue" strokeWidth={1.8} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-brand-ink">Upload a profile photo</p>
                      <p className="text-xs text-brand-gray">PNG, JPG up to 5 MB</p>
                    </div>
                    <input type="file" accept="image/png,image/jpeg" className="hidden" />
                  </label>
                </div>
              </div>
            )}

            {/* STEP 3: Address */}
            {step === 3 && (
              <div className="space-y-4">
                <div className="grid sm:grid-cols-2 gap-4">
                  <TextField label="Province" icon={MapPin} value={form.province} onChange={set("province")} required />
                  <TextField label="Municipality" icon={MapPin} value={form.municipality} onChange={set("municipality")} required />
                </div>
                {/* Searchable Barangay Dropdown */}
                <div>
                  <label className="text-sm font-medium text-brand-ink">Barangay <span className="text-brand-danger">*</span></label>
                  <div className="relative mt-1.5">
                    <button
                      type="button"
                      onClick={() => setBarangayOpen(!barangayOpen)}
                      className={`w-full flex items-center gap-2 bg-white border rounded-input px-3.5 py-2.5 text-sm transition-colors ${errors.barangay ? "border-brand-danger" : "border-brand-border focus:border-brand-blue"}`}
                    >
                      <MapPin className="w-4 h-4 text-brand-gray shrink-0" />
                      <span className={form.barangay ? "text-brand-ink" : "text-brand-gray/50"}>{form.barangay || "Search and select your barangay"}</span>
                      <ChevronDown className="w-4 h-4 text-brand-gray ml-auto" />
                    </button>
                    {barangayOpen && (
                      <div className="absolute z-20 mt-1 w-full bg-white border border-brand-border rounded-input shadow-float overflow-hidden">
                        <div className="p-2 border-b border-brand-border">
                          <input
                            autoFocus
                            value={barangayQuery}
                            onChange={(e) => setBarangayQuery(e.target.value)}
                            placeholder="Type to search..."
                            className="w-full bg-brand-bg border border-brand-border rounded-btn px-3 py-2 text-sm outline-none focus:border-brand-blue"
                          />
                        </div>
                        <div className="max-h-48 overflow-y-auto">
                          {filteredBarangays.map((b) => (
                            <button
                              key={b}
                              type="button"
                              onClick={() => { setForm({ ...form, barangay: b }); setBarangayOpen(false); setBarangayQuery(""); setErrors({ ...errors, barangay: "" }); }}
                              className="w-full text-left px-4 py-2.5 text-sm text-brand-ink hover:bg-brand-bg transition-colors"
                            >
                              {b}
                            </button>
                          ))}
                          {filteredBarangays.length === 0 && (
                            <p className="px-4 py-3 text-sm text-brand-gray">No barangays found.</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  {errors.barangay && <p className="mt-1 text-xs text-brand-danger">{errors.barangay}</p>}
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <TextField label="Sitio / Purok" icon={MapPin} placeholder="Purok 5" value={form.sitio} onChange={set("sitio")} error={errors.sitio} required />
                  <TextField label="Street" icon={MapPin} optional placeholder="Mabini St." value={form.street} onChange={set("street")} />
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <TextField label="House Number" icon={MapPin} optional placeholder="Leave blank if not applicable" value={form.houseNo} onChange={set("houseNo")} />
                  <TextField label="Nearest Landmark" icon={MapPin} optional placeholder="Near San Jose Chapel" value={form.landmark} onChange={set("landmark")} />
                </div>
                <div>
                  <TextField label="Household Number" icon={MapPin} optional placeholder="Leave blank if unknown" value={form.householdNo} onChange={set("householdNo")} />
                  <p className="mt-1.5 text-xs text-brand-gray flex items-start gap-1.5">
                    <span className="text-brand-blue">Info:</span>
                    If you do not know your Household Number, your assigned Barangay Health Worker will update it during household profiling.
                  </p>
                </div>
              </div>
            )}

            {/* STEP 4: Identity Verification */}
            {step === 4 && (
              <div className="space-y-5">
                <div className="bg-brand-blue/5 border border-brand-blue/15 rounded-card p-4 flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-brand-blue/10 flex items-center justify-center shrink-0">
                    <Shield className="w-4 h-4 text-brand-blue" strokeWidth={1.8} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-brand-ink">Identity Verification</p>
                    <p className="text-xs text-brand-gray mt-0.5">
                      Upload one valid government-issued identification card to verify your identity.
                      Your assigned Barangay Health Worker will review your registration before activating your account.
                    </p>
                  </div>
                </div>

                <div>
                  <p className="text-sm font-medium text-brand-ink mb-2">Accepted IDs</p>
                  <div className="flex flex-wrap gap-2">
                    {ACCEPTED_IDS.map((id) => (
                      <span key={id} className="text-xs font-body bg-brand-bg text-brand-gray border border-brand-border rounded-full px-2.5 py-1">{id}</span>
                    ))}
                  </div>
                </div>

                <UploadComponent
                  label="Upload ID (Front or Back)"
                  file={form.idDocument}
                  onFile={(f) => { setForm({ ...form, idDocument: f }); setErrors({ ...errors, idDocument: "" }); }}
                  onRemove={() => setForm({ ...form, idDocument: null })}
                  error={errors.idDocument}
                />

                <p className="text-xs text-brand-gray flex items-start gap-1.5">
                  <span className="text-brand-blue">Note:</span>
                  Only one upload is required. Either the front or back of your ID is acceptable as long as the resident's information is clearly visible. If the uploaded identification is unclear, the Barangay Health Worker may request another copy during verification.
                </p>
              </div>
            )}
          </StepWrapper>

          {/* Navigation */}
          <div className="flex items-center justify-between mt-7 pt-5 border-t border-brand-border">
            {step > 1 ? (
              <button onClick={back} className="flex items-center gap-2 text-sm font-body font-medium text-brand-gray hover:text-brand-ink transition-colors">
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
            ) : (
              <Link to="/login" className="flex items-center gap-2 text-sm font-body font-medium text-brand-gray hover:text-brand-ink transition-colors">
                <ArrowLeftCircle className="w-4 h-4" /> Back to Login
              </Link>
            )}
            {step < 4 ? (
              <button onClick={next} className="flex items-center gap-2 bg-brand-blue text-white px-6 py-2.5 rounded-btn text-sm font-body font-medium hover:bg-brand-dark transition-colors shadow-soft">
                Continue <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={submitting}
                className="flex items-center gap-2 bg-brand-green text-white px-6 py-2.5 rounded-btn text-sm font-body font-medium hover:bg-brand-green/90 transition-colors shadow-soft disabled:opacity-70"
              >
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
        </motion.div>

        <p className="mt-6 text-center text-sm text-brand-gray">
          Already have an account?{" "}
          <Link to="/login" className="text-brand-blue font-medium hover:underline">Login</Link>
        </p>
      </div>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-bg p-6 md:p-10">
      <div className="absolute top-0 left-0 w-96 h-96 bg-brand-blue/5 rounded-full blur-3xl -translate-x-1/3 -translate-y-1/3" />
      <div className="absolute bottom-0 right-0 w-96 h-96 bg-brand-yellow/5 rounded-full blur-3xl translate-x-1/3 translate-y-1/3" />
      <div className="relative w-full flex items-center justify-center">{children}</div>
    </div>
  );
}