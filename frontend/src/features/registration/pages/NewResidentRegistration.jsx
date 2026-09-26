import React, { useState, useMemo, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Eye, EyeOff, ArrowRight, ArrowLeft, Check, MapPin, ChevronDown, Shield, Loader2, Mail, Camera,
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
import DatePicker from "@/components/common/DatePicker";
import { REGISTRATION_OTP_LENGTH, isValidRegistrationOtp } from "@/features/registration/otp";
import { supabase } from "@/lib/supabase";
import { registrationApi } from "@/services/api";
import { postFormData } from "@/services/api/apiClient";
import UploadComponent from "@/features/registration/components/UploadComponent";
import {
  CIVIL_STATUSES,
  NAME_SUFFIXES,
  SEX_OPTIONS,
  ZONE_VALUES,
  dateOfBirth,
  digitsOnly,
  email as validateEmail,
  enumValue,
  strictMobile as validateStrictMobile,
  zone as validateZone,
  required,
  validateFields,
} from "@/utils/validation";

// Fallback barangays for the Pili deployment. The live list is loaded from the
// backend (public.barangays) on mount so this is only a resilience fallback and
// is never the source of truth.
const FALLBACK_BARANGAYS = ["San Isidro", "San Antonio", "Old San Roque"];

// Government ID types selectable in Step 3. Values match the backend
// `GOVERNMENT_ID_TYPES` in backend/src/validators/documents.validators.js.
const GOVT_ID_TYPES = [
  { value: "philsys", label: "PhilSys / National ID" },
  { value: "drivers_license", label: "Driver's License" },
  { value: "passport", label: "Passport" },
  { value: "umid", label: "UMID" },
  { value: "prc_id", label: "PRC ID" },
  { value: "postal_id", label: "Postal ID" },
  { value: "other", label: "Other Government-Issued ID" },
];

const GOVT_ID_LABEL = Object.fromEntries(GOVT_ID_TYPES.map((o) => [o.value, o.label]));

// Supabase Auth email OTP length for New Resident Registration. This is the
// registration-only constant and is deliberately kept separate from the Transfer
// of Residency OTP (a custom 4-digit backend code). See features/registration/otp.js.
const OTP_LENGTH = REGISTRATION_OTP_LENGTH;

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
  { num: 3, title: "Identity Verification", subtitle: "Provide valid government-issued identification for Health Supervisor review." },
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
  const [possibleExisting, setPossibleExisting] = useState(false);
  const [barangayQuery, setBarangayQuery] = useState("");
  const [barangayOpen, setBarangayOpen] = useState(false);
  // Live barangay list from the backend (public.barangays for Pili). Falls back
  // to the canonical three if the lookup is unavailable, so the field always
  // works, but the DB is the source of truth.
  const [barangayList, setBarangayList] = useState(FALLBACK_BARANGAYS);
  /** @type {[Record<string, string>, Function]} */
  const [errors, setErrors] = useState({});

  // Load the real barangay list for the Municipality of Pili from the backend
  // (public.barangays is public-readable). This keeps the dropdown data-driven
  // instead of hard-coded in the component; the fallback list only applies if
  // the query is unavailable.
  useEffect(() => {
    let cancelled = false;
    if (!supabase) return undefined;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("barangays")
          .select("name, status, municipalities!inner(name)")
          .eq("municipalities.name", "Pili")
          .eq("status", "Active")
          .order("name", { ascending: true });
        if (!cancelled && !error && Array.isArray(data) && data.length) {
          setBarangayList(data.map((b) => b.name));
        }
      } catch {
        /* keep the fallback list */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Email verification (real Supabase Confirm Signup OTP — no local/fake OTP)
  // emailPhase: "idle" | "sending" | "sent" | "verifying" | "verified"
  const [emailPhase, setEmailPhase] = useState("idle");
  const [otpDigits, setOtpDigits] = useState(new Array(OTP_LENGTH).fill(""));
  const [otpError, setOtpError] = useState("");
  const [sendError, setSendError] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const otpRefs = useRef(new Array(OTP_LENGTH).fill(null));

  // 60-second resend cooldown
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  // Temporary random password used to trigger Supabase's Confirm Signup email.
  // Stored in sessionStorage (not localStorage) only until the resident's real
  // password is set at submission. Never rendered or logged.
  const tempPasswordRef = useRef(
    typeof sessionStorage !== "undefined" ? sessionStorage.getItem("pendingSignupTempPassword") || "" : ""
  );

  // Session returned by the successful email OTP verification. It is real Supabase
  // session state — never fake/local verification state.
  const verifiedSessionRef = useRef(null);

  const clearOtp = () => setOtpDigits(new Array(OTP_LENGTH).fill(""));

  const emailVerified = emailPhase === "verified";

  const sendCode = async () => {
    if (emailVerified || emailPhase === "sending" || emailPhase === "verifying") return;
    const emailErr = validateEmail(form.email, { label: "Email address" });
    if (emailErr) { setErrors((p) => ({ ...p, email: emailErr })); return; }
    if (!supabase) {
      setSendError("Authentication is not configured. Please try again later or contact the RHU.");
      return;
    }
    const isResend = emailPhase === "sent";
    setEmailPhase("sending");
    setSendError("");
    setOtpError("");
    try {
      if (isResend) {
        const { error } = await supabase.auth.resend({ type: "signup", email: form.email.trim() });
        if (error) throw error;
      } else {
        // Supabase's Confirm Signup email (with the {{ .Token }} OTP) is triggered
        // by signUp. Supabase requires a password at signup, so a random temporary
        // one is used; the resident's real password is set after OTP verification
        // (via updateUser) before the registration is submitted. No fake OTP is
        // ever created — the code always comes from Supabase Auth.
        const tempPassword = `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}K${Math.floor(Math.random() * 10)}`;
        // Held only in sessionStorage until the resident's real password is set
        // at submission. It never appears in the DOM, logs, or network payloads.
        sessionStorage.setItem("pendingSignupTempPassword", tempPassword);
        tempPasswordRef.current = tempPassword;
        const { error } = await supabase.auth.signUp({
          email: form.email.trim(),
          password: tempPassword,
          options: {
            data: {
              full_name: `${form.firstName} ${form.lastName}`.trim(),
              name: `${form.firstName} ${form.lastName}`.trim(),
            },
          },
        });
        if (error) throw error;
      }
      setEmailPhase("sent");
      clearOtp();
      setResendIn(60);
    } catch (err) {
      const msg = err?.message || "";
      setEmailPhase(/already registered/i.test(msg) ? "idle" : (isResend ? "sent" : "idle"));
      if (/email rate limit exceeded|frequency/i.test(msg)) {
        setSendError("Too many verification emails were sent recently. Please wait a minute, then request a new code.");
      } else if (/already registered/i.test(msg)) {
        setSendError("This email address is already registered. Please sign in, or use a different email address.");
      } else {
        setSendError(msg || "Could not send the verification code. Please try again.");
      }
    }
  };

  const verifyEmail = async () => {
    if (emailVerified || emailPhase === "verifying") return;
    // Keep the code as a STRING so leading zeros (e.g. "012345") are preserved.
    const code = otpDigits.join("");
    if (!isValidRegistrationOtp(code)) {
      setOtpError(`Please enter the complete ${OTP_LENGTH}-digit code from your email.`);
      return;
    }
    if (!supabase) {
      setOtpError("Authentication is not configured. Please try again later.");
      return;
    }
    setEmailPhase("verifying");
    setOtpError("");
    try {
      // The COMPLETE token from the email is passed through unmodified.
      const { data, error } = await supabase.auth.verifyOtp({
        email: form.email.trim(),
        token: code,
        type: "email",
      });
      if (error) throw error;
      verifiedSessionRef.current = data?.session || null;
      setEmailPhase("verified");
      clearOtp();
      setResendIn(0);
    } catch (err) {
      setEmailPhase("sent");
      const msg = err?.message || "";
      if (/expired|invalid otp/i.test(msg)) {
        setOtpError("This code is invalid or has expired. Please check the email and try again, or request a new code.");
      } else {
        setOtpError(msg || "Verification failed. Please check the code from the email and try again.");
      }
    }
  };

  const handleOtpChange = (i) => (e) => {
    const incoming = e.target.value.replace(/\D/g, "");
    const next = [...otpDigits];
    if (!incoming) {
      next[i] = "";
      setOtpDigits(next);
      return;
    }
    let pos = i;
    for (const d of incoming) {
      if (pos >= OTP_LENGTH) break;
      next[pos] = d;
      pos += 1;
    }
    setOtpDigits(next);
    if (pos < OTP_LENGTH) otpRefs.current[pos]?.focus();
    setOtpError("");
  };

  const handleOtpKeyDown = (i) => (e) => {
    if (e.key === "Backspace" && !otpDigits[i] && i > 0) {
      otpRefs.current[i - 1]?.focus();
    }
  };

  const handleOtpPaste = (e) => {
    e.preventDefault();
    const text = (e.clipboardData?.getData("text") || "").replace(/\D/g, "").slice(0, OTP_LENGTH);
    if (!text) return;
    const next = new Array(OTP_LENGTH).fill("");
    for (let i = 0; i < text.length; i += 1) next[i] = text[i];
    setOtpDigits(next);
    otpRefs.current[Math.min(text.length, OTP_LENGTH - 1)]?.focus();
    setOtpError("");
  };

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
    zone: transferData?.zone || "",
    street: transferData?.street || "",
    houseNo: transferData?.houseNo || "",
    landmark: transferData?.landmark || "",
    occupation: transferData?.occupation || "",
    email: "",
    password: "",
    confirmPassword: "",
    agree: false,
    agreePrivacy: false,
    agreeReview: false,
    // Step 3 — identity verification only. Files remain plain File objects
    // until submission; status is derived as Uploaded / Pending Review and is
    // never marked Verified during upload.
    identity: {
      governmentIdType: "",
      governmentIdTypeOther: "",
      identityNo: "",
      governmentIdFront: null,
      governmentIdBack: null,
      identityPhoto: null,
    },
  });

  const set = (key) => (e) => {
    const val = e.target ? e.target.value : e;
    if (key === "email") return setEmailValue(val);
    if (key === "mobile") {
      // Numeric-only, capped at 11 digits. Prevents letters, spaces, symbols
      // and paste of formatted numbers ever entering the field.
      const digits = digitsOnly(val).slice(0, 11);
      setForm((p) => ({ ...p, mobile: digits }));
      if (errors.mobile) setErrors((p) => ({ ...p, mobile: "" }));
      return;
    }
    if (key === "identity") {
      // Identity fields are set via targeted setters below.
      return;
    }
    setForm((p) => ({ ...p, [key]: val }));
    if (errors[key]) setErrors((p) => ({ ...p, [key]: "" }));
  };

  // Targeted identity-state setters so unrelated fields (e.g. password) do not
  // need to re-render the entire identity object.
  const setIdType = (e) => {
    setForm((p) => ({ ...p, identity: { ...p.identity, governmentIdType: e.target.value } }));
    setErrors((prev) => ({ ...prev, governmentIdType: "", governmentIdTypeOther: "" }));
  };
  const setIdTypeOther = (e) => {
    setForm((p) => ({ ...p, identity: { ...p.identity, governmentIdTypeOther: e.target.value } }));
    setErrors((prev) => ({ ...prev, governmentIdTypeOther: "" }));
  };
  const setIdentityNo = (e) => {
    setForm((p) => ({ ...p, identity: { ...p.identity, identityNo: e.target.value } }));
    setErrors((prev) => ({ ...prev, identityNo: "" }));
  };
  const setIdFront = (file) => {
    setForm((p) => ({ ...p, identity: { ...p.identity, governmentIdFront: file } }));
    setErrors((prev) => ({ ...prev, governmentIdFront: "" }));
  };
  const setIdBack = (file) => {
    setForm((p) => ({ ...p, identity: { ...p.identity, governmentIdBack: file } }));
    setErrors((prev) => ({ ...prev, governmentIdBack: "" }));
  };
  const setIdentityPhoto = (file) => {
    setForm((p) => ({ ...p, identity: { ...p.identity, identityPhoto: file } }));
    setErrors((prev) => ({ ...prev, identityPhoto: "" }));
  };

  // Changing the email invalidates any in-flight or completed verification.
  const setEmailValue = (val) => {
    setForm((p) => ({ ...p, email: val }));
    if (errors.email || errors.emailVerified) {
      setErrors((p) => ({ ...p, email: "", emailVerified: "" }));
    }
    if (emailPhase !== "idle") {
      setEmailPhase("idle");
      setOtpDigits(new Array(OTP_LENGTH).fill(""));
      setOtpError("");
      setSendError("");
      setResendIn(0);
    }
  };

  const pwStrength = useMemo(() => checkStrength(form.password), [form.password]);
  const filteredBarangays = barangayList.filter((b) => b.toLowerCase().includes(barangayQuery.toLowerCase()));

  // A successful verifyOtp() stores a real Supabase session in the browser
  // client. If the resident reloads the page mid-registration, restore the
  // verified state from that session (matched by email) instead of forcing a
  // second verification.
  useEffect(() => {
    const email = form.email.trim().toLowerCase();
    if (!email || emailPhase !== "idle" || !supabase) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      const ses = data?.session;
      if (ses?.user?.email?.toLowerCase() === email) {
        verifiedSessionRef.current = ses;
        setEmailPhase("verified");
      }
    });
    return () => { active = false; };
  }, [form.email, emailPhase]);

  const validateStep = (s) => {
    let errs = {};
    if (s === 1) {
      errs = validateFields(form, {
        firstName: (v) => required(v, "First name"),
        lastName: (v) => required(v, "Last name"),
        suffix: (v) => (v ? enumValue(v, NAME_SUFFIXES, { label: "suffix" }) : ""),
        dob: (v) => dateOfBirth(v, { label: "Date of birth" }),
        sex: (v) => enumValue(v, SEX_OPTIONS, { label: "sex" }),
        civilStatus: (v) => enumValue(v, CIVIL_STATUSES, { label: "civil status" }),
      });
    }
    if (s === 2) {
      errs = validateFields(form, {
        email: (v) => validateEmail(v, { label: "Email address" }),
        password: (v) => required(v, "Password"),
        mobile: (v) => validateStrictMobile(v, { label: "Mobile number" }),
        barangay: (v) => required(v, "Barangay"),
        zone: (v) => validateZone(v, { label: "Zone" }),
      });
      if (form.password !== form.confirmPassword) errs.confirmPassword = "Passwords do not match";
      if (!emailVerified) errs.emailVerified = "Please verify your email address before continuing.";
      if (!form.agree || !form.agreePrivacy) errs.agree = "You must accept Terms and Privacy Policy";
    }
    if (s === 3) {
      const idt = form.identity;
      if (!idt.governmentIdType) errs.governmentIdType = "Select your government-issued ID.";
      if (!idt.identityNo.trim()) errs.identityNo = "Enter the number shown on your government ID.";
      if (idt.governmentIdType === "other" && !idt.governmentIdTypeOther.trim()) {
        errs.governmentIdTypeOther = "Please specify the type of government-issued ID.";
      }
      if (!idt.governmentIdFront) errs.governmentIdFront = "Upload the front of your government ID.";
      if (!idt.governmentIdBack) errs.governmentIdBack = "Upload the back of your government ID.";
      if (!idt.identityPhoto) errs.identityPhoto = "Upload your identity photo holding the ID.";
      if (!form.agreeReview) errs.agreeReview = "Please confirm your information for review to continue";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const next = () => { if (validateStep(step)) setStep((p) => Math.min(p + 1, 4)); };
  const back = () => setStep((p) => Math.max(p - 1, 1));
  const goTo = (s) => setStep(s);

  const submit = async () => {
    if (submitting) return; // guard against duplicate submissions
    setSubmitting(true);
    setErrors({});

    try {
      const isSupabase = !!supabase;
      if (!isSupabase) {
        throw new Error('Authentication is not configured. Please try again later or contact the RHU.');
      }

      const idt = form.identity;
      const govTypeDisplay =
        idt.governmentIdType === "other"
          ? `Other: ${idt.governmentIdTypeOther.trim()}`
          : (GOVT_ID_LABEL[idt.governmentIdType] || idt.governmentIdType || "");

      const address = [
        form.houseNo.trim(),
        form.street.trim(),
        form.zone ? `Zone ${form.zone}` : "",
        `Barangay ${form.barangay}`,
        form.municipality,
        form.province,
      ].filter(Boolean).join(', ');

      const payload = {
        resident: {
          firstName: form.firstName.trim(),
          middleName: form.middleName.trim(),
          lastName: form.lastName.trim(),
          suffix: form.suffix.trim(),
          birthDate: form.dob || '',
          sex: form.sex,
          civilStatus: form.civilStatus,
          currentAddress: address,
          permanentAddress: address,
          cellphoneNo: form.mobile.trim(),
          barangay: form.barangay,
          zone: form.zone ? Number(form.zone) : undefined,
          // Identity metadata so the Health Supervisor can see the selected ID
          // type and the submitted identity documents. The individual files are
          // uploaded separately to the documents API below.
          identity: {
            governmentIdType: idt.governmentIdType,
            governmentIdTypeOther: idt.governmentIdType === "other" ? idt.governmentIdTypeOther.trim() : "",
            identityNo: idt.identityNo.trim(),
            governmentIdTypeDisplay: govTypeDisplay,
          },
          identityNo: idt.identityNo.trim(),
        },
      };

      // The email was already verified in Step 2 via Supabase's real email OTP
      // (Confirm Signup). verifyOtp() stored a real Supabase session in the
      // browser client, so it is restored here across page reloads.
      let session = verifiedSessionRef.current || null;
      if (!session?.user) {
        const { data: existing } = await supabase.auth.getSession();
        session = existing?.session?.user?.email?.toLowerCase() === form.email.trim().toLowerCase()
          ? existing.session
          : null;
      }
      if (!session?.user && tempPasswordRef.current) {
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
          email: form.email.trim(),
          password: tempPasswordRef.current,
        });
        if (signInError) throw signInError;
        session = signInData?.session || null;
      }

      if (!session) {
        throw new Error('Your email could not be used to sign in. Please verify your email and try again.');
      }
      sessionStorage.removeItem('pendingSignupTempPassword');
      tempPasswordRef.current = '';

      // The Supabase account was created in Step 2 with a temporary password
      // (required to trigger the Confirm Signup OTP email). Now that we hold a
      // valid session for the confirmed account, set the resident's real
      // chosen password.
      const { error: setPwError } = await supabase.auth.updateUser({ password: form.password });
      if (setPwError) throw setPwError;

      const resident = await registrationApi.registerResident(payload);
      if (!resident?.id) {
        throw new Error('Registration failed. Please try again.');
      }

      // Upload each identity document through the real upload endpoint. Each
      // file becomes its own documents record with verification_status
      // 'pending' (Uploaded → Pending Review). Status is never 'Verified' at
      // upload time — only Health Supervisor review can set that. Any failed
      // upload throws, so the form never falsely reports success.
      const uploads = [
        idt.governmentIdFront && { file: idt.governmentIdFront, documentType: 'government_id_front', label: 'the front of your government ID', needsIdType: true },
        idt.governmentIdBack && { file: idt.governmentIdBack, documentType: 'government_id_back', label: 'the back of your government ID', needsIdType: true },
        idt.identityPhoto && { file: idt.identityPhoto, documentType: 'identity_photo', label: 'your identity photo', needsIdType: false },
      ].filter(Boolean);

      for (const u of uploads) {
        const fd = new FormData();
        fd.append('file', u.file);
        fd.append('documentType', u.documentType);
        fd.append('residentId', resident.id);
        if (u.needsIdType) {
          fd.append('governmentIdType', idt.governmentIdType);
          if (idt.governmentIdType === 'other' && idt.governmentIdTypeOther.trim()) {
            fd.append('governmentIdTypeOther', idt.governmentIdTypeOther.trim());
          }
        }
        const docResp = await postFormData('/resident-documents/upload', fd);
        if (!docResp?.document) {
          throw new Error(`We could not upload ${u.label}. Please go back and try again.`);
        }
      }

      // The account is already authenticated from the signup verification.
      // Go straight to the limited resident dashboard; the verification banner
      // there is the post-registration confirmation state.
      navigate('/app/resident-limited/dashboard');
    } catch (err) {
      // Preserve the exact technical error for developers without exposing it
      // to residents. The backend now returns a real message in the standard
      // { error: { message, details } } envelope (see apiClient), so this is
      // the actual validation/processing failure, not a generic status string.
      if (import.meta.env?.DEV) {
        // eslint-disable-next-line no-console
        console.error('Registration submit failed:', err?.status, err?.message, err?.payload);
      }

      const status = err?.status;
      const backendMessage = typeof err?.message === 'string' ? err.message : '';
      const isGenericStatusOnly = /^Request failed with status/i.test(backendMessage);

      let message;
      if (status === 409) {
        message = backendMessage && !isGenericStatusOnly
          ? backendMessage
          : 'This account may already have a registration on file. Please sign in or verify your identity.';
      } else if (backendMessage && !isGenericStatusOnly) {
        message = backendMessage;
      } else {
        message =
          'Your registration could not be submitted because some registration information could not be processed. Please review your information and try again.';
      }

      setPossibleExisting(status === 409);
      setErrors((prev) => ({ ...prev, submit: message }));
      setSubmitting(false);
    }
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
                <Field label="Suffix" optional error={errors.suffix}>
                  <select
                    value={form.suffix}
                    onChange={set("suffix")}
                    className={`${inputCls(errors.suffix)} cursor-pointer`}
                  >
                    <option value="">None</option>
                    {NAME_SUFFIXES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Birth Date" required error={errors.dob}>
                  <DatePicker
                    value={form.dob}
                    max={new Date().toISOString().slice(0, 10)}
                    error={Boolean(errors.dob)}
                    placeholder="Select birth date..."
                    onChange={(v) => { setForm({ ...form, dob: v }); if (errors.dob) setErrors({ ...errors, dob: "" }); }}
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
                  {emailPhase === "idle" || emailPhase === "sending" ? (
                    <div className="space-y-2.5">
                      <input
                        type="email"
                        placeholder="you@example.com"
                        value={form.email}
                        onChange={set("email")}
                        className={inputCls(errors.email)}
                        disabled={emailPhase === "sending"}
                      />
                      <div className="flex flex-wrap items-center gap-2.5">
                        <button
                          type="button"
                          onClick={sendCode}
                          disabled={emailPhase === "sending" || resendIn > 0 && emailPhase === "sent"}
                          className="inline-flex items-center gap-2 rounded-lg bg-brand-blue px-4 py-2 text-[12.5px] font-semibold text-white shadow-[0_10px_22px_-14px_rgba(42,125,225,0.9)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {emailPhase === "sending" ? (
                            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Sending</>
                          ) : (
                            <><Mail className="h-3.5 w-3.5" /> {emailPhase === "sent" ? "Send Code Again" : "Send Verification Code"}</>
                          )}
                        </button>
                        {emailPhase === "sent" && resendIn > 0 && (
                          <span className="text-[12px] font-medium text-slate-500 tabular-nums">Resend code in {resendIn}s</span>
                        )}
                      </div>
                      {sendError && <p className="text-[11.5px] font-medium text-brand-danger">{sendError}</p>}
                      {errors.emailVerified && <p className="text-[11.5px] font-medium text-brand-danger">{errors.emailVerified}</p>}
                    </div>
                  ) : null}

                  {(emailPhase === "sent" || emailPhase === "verifying" || emailPhase === "verified") && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                      {emailPhase === "verified" ? (
                        <div className="flex items-center gap-2.5 text-[12.5px] font-semibold text-brand-green">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-green/15">
                            <Check className="h-3.5 w-3.5" strokeWidth={3} />
                          </span>
                          Email address verified
                        </div>
                      ) : (
                        <>
                          <div className="flex items-start gap-3">
                            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-blue/10">
                              <Mail className="h-[18px] w-[18px] text-brand-blue" strokeWidth={1.9} />
                            </span>
                            <div>
                              <p className="text-[13px] font-bold text-brand-ink">Check your email</p>
                              <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500">
                                We've sent a verification code to{" "}
                                <span className="font-semibold text-slate-700">{form.email}</span>.
                              </p>
                            </div>
                          </div>

                          <div className="mt-4 flex gap-1.5" onPaste={handleOtpPaste}>
                            {otpDigits.map((d, i) => (
                              <input
                                key={i}
                                ref={(el) => { otpRefs.current[i] = el; }}
                                type="text"
                                inputMode="numeric"
                                autoComplete="one-time-code"
                                maxLength={1}
                                value={d}
                                onChange={handleOtpChange(i)}
                                onKeyDown={handleOtpKeyDown(i)}
                                aria-label={`Verification digit ${i + 1}`}
                                className={`h-12 w-full rounded-lg border bg-white text-center font-stat text-lg font-bold text-brand-ink outline-none transition-colors focus:border-brand-blue ${
                                  otpError ? "border-brand-danger/60" : "border-slate-300"
                                }`}
                              />
                            ))}
                          </div>

                          {otpError && <p className="mt-2 text-[11.5px] font-medium text-brand-danger">{otpError}</p>}

                          <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
                            <button
                              type="button"
                              onClick={verifyEmail}
                              disabled={emailPhase === "verifying"}
                              className="inline-flex items-center gap-2 rounded-lg bg-brand-blue px-4 py-2 text-[12.5px] font-semibold text-white shadow-[0_10px_22px_-14px_rgba(42,125,225,0.9)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {emailPhase === "verifying"
                                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Verifying</>
                                : <><Check className="h-3.5 w-3.5" strokeWidth={2.5} /> Verify Email</>}
                            </button>
                            <button
                              type="button"
                              onClick={sendCode}
                              disabled={emailPhase === "verifying" || resendIn > 0}
                              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-[12.5px] font-semibold text-brand-ink transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend Code"}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
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
                      <input
                        type="tel"
                        inputMode="numeric"
                        autoComplete="tel"
                        pattern="[0-9]*"
                        maxLength={11}
                        placeholder="09381829120"
                        value={form.mobile}
                        onChange={set("mobile")}
                        onKeyDown={(e) => {
                          // Block anything that is not a digit or an editing key.
                          const allowed = ["Backspace", "Delete", "Tab", "ArrowLeft", "ArrowRight", "Home", "End"];
                          if (allowed.includes(e.key) || e.ctrlKey || e.metaKey) return;
                          if (!/^[0-9]$/.test(e.key)) e.preventDefault();
                        }}
                        className={inputCls(errors.mobile)}
                      />
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
                      <SelectField
                        label="Zone"
                        required
                        error={errors.zone}
                        value={form.zone}
                        onChange={set("zone")}
                      >
                        <option value="">Select or search zone</option>
                        {ZONE_VALUES.map((z) => (
                          <option key={z} value={String(z)}>{`Zone ${z}`}</option>
                        ))}
                      </SelectField>
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
                  <p className="text-[12px] font-bold uppercase tracking-[0.08em] text-brand-dark">
                    Identity Verification
                  </p>
                  <p className="mt-1">
                    Select a valid government-issued ID and upload both the front and back sides. You must also provide an
                    identity photo so the Health Supervisor can review your registration.
                  </p>
                </InfoNote>

                {/* 1. Government ID Type */}
                <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-5">
                  <SectionKicker className="mb-3.5">1. Government ID Type</SectionKicker>
                  <Field label="Government ID Type" required error={errors.governmentIdType}>
                    <div className="relative">
                      <select
                        value={form.identity.governmentIdType}
                        onChange={setIdType}
                        className={`${inputCls(errors.governmentIdType)} cursor-pointer appearance-none pr-10`}
                      >
                        <option value="">Select your government-issued ID</option>
                        {GOVT_ID_TYPES.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                      <ChevronDown
                        className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                        aria-hidden="true"
                      />
                    </div>
                  </Field>

                  <div className="mt-4">
                    <Field label="Government ID Number" required error={errors.identityNo} hint="Used privately to prevent duplicate resident records.">
                      <input
                        type="text"
                        value={form.identity.identityNo}
                        onChange={setIdentityNo}
                        className={inputCls(errors.identityNo)}
                        autoComplete="off"
                      />
                    </Field>
                  </div>

                  {form.identity.governmentIdType === "other" && (
                    <div className="mt-4">
                      <Field label="Specify ID Type" required error={errors.governmentIdTypeOther}>
                        <input
                          type="text"
                          placeholder="Enter ID type"
                          value={form.identity.governmentIdTypeOther}
                          onChange={setIdTypeOther}
                          className={inputCls(errors.governmentIdTypeOther)}
                        />
                      </Field>
                    </div>
                  )}
                </div>

                {/* 2 & 3. Government ID — Front / Back */}
                <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-5">
                  <SectionKicker className="mb-3.5">2. Government ID — Front &amp; Back</SectionKicker>
                  <div className="space-y-5">
                    <UploadComponent
                      label="Government ID — Front"
                      optional={false}
                      file={form.identity.governmentIdFront}
                      onFile={setIdFront}
                      onRemove={() => setIdFront(null)}
                    />
                    {errors.governmentIdFront && (
                      <p className="-mt-3 text-[11.5px] font-medium text-brand-danger">{errors.governmentIdFront}</p>
                    )}
                    <UploadComponent
                      label="Government ID — Back"
                      optional={false}
                      file={form.identity.governmentIdBack}
                      onFile={setIdBack}
                      onRemove={() => setIdBack(null)}
                    />
                    {errors.governmentIdBack && (
                      <p className="-mt-3 text-[11.5px] font-medium text-brand-danger">{errors.governmentIdBack}</p>
                    )}
                  </div>
                </div>

                {/* 4. Identity Photo */}
                <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-5">
                  <SectionKicker className="mb-3.5">3. Identity Photo</SectionKicker>
                  <div className="mb-4 flex items-start gap-3 rounded-lg border border-brand-blue/15 bg-brand-light/40 px-3.5 py-3 text-[12px] leading-relaxed text-slate-500">
                    <Camera className="mt-0.5 h-4 w-4 shrink-0 text-brand-blue" strokeWidth={1.9} />
                    <p>
                      Take a clear photo of yourself holding the same government ID uploaded above. The Health Supervisor
                      will use it to confirm that the ID belongs to you.
                    </p>
                  </div>
                  <UploadComponent
                    label="Identity Photo (you holding your ID)"
                    optional={false}
                    file={form.identity.identityPhoto}
                    onFile={setIdentityPhoto}
                    onRemove={() => setIdentityPhoto(null)}
                  />
                  {errors.identityPhoto && (
                    <p className="mt-1.5 text-[11.5px] font-medium text-brand-danger">{errors.identityPhoto}</p>
                  )}
                </div>

                {/* 4. Applicant Acknowledgment */}
                <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-5">
                  <SectionKicker className="mb-3.5">4. Applicant Acknowledgment</SectionKicker>
                  <label className="flex cursor-pointer items-start gap-3 text-[12.5px] leading-relaxed text-slate-600">
                    <input
                      type="checkbox"
                      checked={form.agreeReview}
                      onChange={(e) => { setForm({ ...form, agreeReview: e.target.checked }); setErrors({ ...errors, agreeReview: "" }); }}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-brand-blue focus:ring-brand-blue/30"
                    />
                    <span>
                      I confirm that the government ID and identity photo I uploaded belong to me and that the information I
                      provided is accurate. I understand that my registration documents will be reviewed by the Health
                      Supervisor before my account is approved.
                    </span>
                  </label>
                  {errors.agreeReview && <p className="mt-3 text-[12px] font-medium text-brand-danger">{errors.agreeReview}</p>}
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
                  ["Address", `${form.houseNo ? form.houseNo + ", " : ""}${form.street ? form.street + ", " : ""}${form.zone ? "Zone " + form.zone + ", " : ""}Barangay ${form.barangay}, ${form.municipality}, ${form.province}`],
                  ["Nearest Landmark", form.landmark || "N/A"],
                ]} />
                <ReviewBlock title="Identity Verification" onEdit={() => goTo(3)} items={[
                  ["Government ID Type", form.identity.governmentIdType === "other"
                    ? `Other: ${form.identity.governmentIdTypeOther || "—"}`
                    : (GOVT_ID_LABEL[form.identity.governmentIdType] || "—")],
                  ["ID Front", form.identity.governmentIdFront?.name || "—"],
                  ["ID Back", form.identity.governmentIdBack?.name || "—"],
                  ["Identity Photo", form.identity.identityPhoto?.name || "—"],
                  ["Document Status", "Uploaded — Pending Review"],
                ]} />
                <ReviewBlock title="Verification" onEdit={() => goTo(3)} items={[
                  ["Method", "Health Supervisor review"],
                  ["Status", "Pending Verification after submission"],
                ]} />
              </div>
            )}
          </motion.div>

          {/* Submit error (network, duplicate account, validation from API) */}
          {errors.submit && (
            <div role="alert" className="mt-6 flex items-start gap-2.5 rounded-xl border border-brand-danger/25 bg-brand-danger/5 px-4 py-3">
              <Shield className="mt-0.5 h-4 w-4 shrink-0 text-brand-danger" strokeWidth={1.9} />
              <div className="min-w-0">
                <p className="text-[12.5px] leading-relaxed text-brand-danger">{errors.submit}</p>
                {possibleExisting && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link to="/login" className="rounded-lg bg-brand-blue px-3 py-2 text-xs font-bold text-white">Sign in</Link>
                    <Link to="/register/transfer" className="rounded-lg border border-brand-blue/25 px-3 py-2 text-xs font-bold text-brand-blue">Verify my identity</Link>
                    <Link to="/register" className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600">Cancel</Link>
                  </div>
                )}
              </div>
            </div>
          )}

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
