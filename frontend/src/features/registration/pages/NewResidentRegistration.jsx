import React, { useState, useMemo, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Eye, EyeOff, ArrowRight, ArrowLeft, Check, MapPin, ChevronDown, Shield, Loader2, Mail, Camera,
  CheckCircle2, AlertTriangle, XCircle, FileText,
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
import { guardianLinksApi } from "@/services/api/guardianLinksApi";
import UploadComponent from "@/features/registration/components/UploadComponent";
import {
  SLOT_STATUS,
  SLOT_DOCUMENT_TYPE,
  REQUIRED_DOCUMENT_SLOTS,
  initialSlotState,
  initialScreeningState,
  slotStateFromScreening,
  isSlotEligible,
  canSubmitDocuments,
  firstBlockingSlot,
  updateSlotForCurrentRequest,
  slotStatusLabel,
  slotStatusTone,
  blockingSlotError,
} from "@/features/registration/documentScreening";
import { isPasswordReuseError } from "@/features/registration/passwordErrors";
import {
  normalizeRegistrationEmail,
  signupResponseIssue,
} from "@/features/registration/signupResponse";
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
import { BARANGAYS } from "@/lib/barangays";

// Fallback barangays for the Pili deployment. The live list is loaded from the
// backend (public.barangays) on mount so this is only a resilience fallback and
// is never the source of truth. BUG-022: reuse the canonical list instead of a
// duplicate hardcoded copy.
const FALLBACK_BARANGAYS = [...BARANGAYS];

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

const screeningRequestErrorMessage = (error, pair = false) => {
  const status = Number(error?.status);
  if (status === 404) {
    return "The document-screening service is unavailable. Your ID has not been marked invalid. Please retry shortly or contact support.";
  }
  if (status === 401) {
    return "Your session has expired. Sign in again before retrying screening.";
  }
  if (status === 403) {
    return "Your account is not authorized to screen these documents. Your files have not been marked invalid.";
  }
  if (status === 413) {
    return "Each ID image must be 10 MB or smaller. Your files have not been screened.";
  }
  if (status === 415) {
    return "Use a supported PDF, JPG, or PNG file. Your files have not been screened.";
  }
  if (!status || status >= 500) {
    return pair
      ? "We could not reach the document-screening service. Your files have not been marked invalid. Please retry."
      : "We could not reach the document-screening service. This file has not been marked invalid. Please retry.";
  }
  if (status === 400) {
    return error?.message || (pair
      ? "The screening request could not be processed. Check that both ID sides and the ID type are selected."
      : "The screening request could not be processed. Check the selected file and try again.");
  }
  return error?.message || (pair
    ? "We could not screen both ID sides. Your files have not been marked invalid. Please retry."
    : "We could not screen this document. It has not been marked invalid. Please retry.");
};

// Supabase Auth email OTP length for New Resident Registration. This is the
// registration-only constant and is deliberately kept separate from the Transfer
// of Residency OTP (a custom 4-digit backend code). See features/registration/otp.js.
const OTP_LENGTH = REGISTRATION_OTP_LENGTH;

function calcAge(dob) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob || "")) return "";
  const [year, month, day] = dob.split("-").map(Number);
  const birth = new Date(Date.UTC(year, month - 1, day));
  if (
    birth.getUTCFullYear() !== year
    || birth.getUTCMonth() !== month - 1
    || birth.getUTCDate() !== day
  ) return "";
  const now = new Date();
  let age = now.getUTCFullYear() - year;
  if (
    now.getUTCMonth() < month - 1
    || (now.getUTCMonth() === month - 1 && now.getUTCDate() < day)
  ) age -= 1;
  return age >= 0 && age <= 120 ? String(age) : "";
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
  { num: 3, title: "Identity Verification", subtitle: "Provide your government-issued ID and identity photo for review." },
  { num: 4, title: "Review Your Information", subtitle: "Please verify all details before submitting." },
];

const STEPS = [
  { num: 1, label: "Personal" },
  { num: 2, label: "Account & Contact" },
  { num: 3, label: "Identity" },
  { num: 4, label: "Review" },
];

// Semantic status treatments for the review page. Keep backgrounds subtle so
// text stays readable (the previous washed-out header reduced contrast).
const REVIEW_TONE = {
  success: "border-emerald-200 bg-emerald-50/70 text-emerald-800",
  warning: "border-amber-200 bg-amber-50/70 text-amber-800",
  danger: "border-brand-danger/25 bg-brand-danger/5 text-brand-danger",
  neutral: "border-slate-200 bg-slate-100 text-slate-600",
};

/** Plain label/value review row. */
function ReviewPlainRow({ label, value }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3.5 sm:flex-row sm:items-start sm:gap-4">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500 sm:w-40 sm:shrink-0 sm:pt-0.5">
        {label}
      </p>
      <p className="min-w-0 break-words text-[13px] font-medium text-brand-ink">{value || "—"}</p>
    </div>
  );
}

/** Review row that shows the document's OWN automated screening status. */
function ReviewDocRow({ label, slot, fileName }) {
  const tone = slotStatusTone(slot);
  const Icon =
    tone === "success" ? CheckCircle2 : tone === "warning" ? AlertTriangle : tone === "danger" ? XCircle : FileText;
  return (
    <div className="flex flex-col gap-1 px-4 py-3.5 sm:flex-row sm:items-start sm:gap-4">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500 sm:w-40 sm:shrink-0 sm:pt-0.5">
        {label}
      </p>
      <div className="min-w-0">
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${REVIEW_TONE[tone]}`}>
          <Icon className="h-3.5 w-3.5" /> {slotStatusLabel(slot)}
        </span>
        {fileName && <p className="mt-1 truncate text-[12px] text-slate-500">{fileName}</p>}
        {slot?.message && (
          <p className="mt-1 text-[12px] text-brand-ink">{slot.message}</p>
        )}
        {slot?.crossVerificationMessage && slot.crossVerificationMessage !== slot.message && (
          <p className="mt-1 text-[12px] text-brand-ink">{slot.crossVerificationMessage}</p>
        )}
      </div>
    </div>
  );
}

export default function NewResidentRegistration() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [show, setShow] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [possibleExisting, setPossibleExisting] = useState(false);
  // "Already registered by a BHW / Health Personnel?" claim flow. When enabled,
  // the resident may supply the Resident ID of the profile a health worker
  // created for them so the new account links to that EXISTING profile instead
  // of creating a duplicate. Blank is allowed — the server then matches on the
  // submitted name + date of birth.
  const [claimMode, setClaimMode] = useState(false);
  const [claimResidentId, setClaimResidentId] = useState("");
  const [barangayQuery, setBarangayQuery] = useState("");
  const [barangayOpen, setBarangayOpen] = useState(false);
  // Live barangay list from the backend (public.barangays for Pili). Falls back
  // to the canonical three if the lookup is unavailable, so the field always
  // works, but the DB is the source of truth.
  const [barangayList, setBarangayList] = useState(FALLBACK_BARANGAYS);
  /**
   * @typedef {Object} RegistrationErrors
   * @property {string} [confirmPassword]
   * @property {string} [emailVerified]
   * @property {string} [agree]
   * @property {string} [governmentIdType]
   * @property {string} [identityNo]
   * @property {string} [governmentIdTypeOther]
   * @property {string} [agreeReview]
   * @property {string} [submit]
   * @property {string} [email]
   * @property {string} [mobile]
   * @property {string} [dob]
   * @property {string} [barangay]
   * @property {string} [zone]
   * @property {string} [governmentIdFront]
   * @property {string} [governmentIdBack]
   * @property {string} [identityPhoto]
   * @property {string} [residentId]
   * @property {string} [firstName]
   * @property {string} [lastName]
   * @property {string} [suffix]
   * @property {string} [sex]
   * @property {string} [civilStatus]
   * @property {string} [password]
   */
  /** @type {[RegistrationErrors, React.Dispatch<React.SetStateAction<RegistrationErrors>>]} */
  const [errors, setErrors] = useState({});

  // Automated screening state, one entry per required slot. Both ID sides are
  // screened independently and cross-checked when both current files exist.
  const [screening, setScreening] = useState(initialScreeningState);
  // Per-slot request sequence so an out-of-order response from a previous file
  // can never overwrite the result of a newer replacement.
  const screeningSeq = useRef({
    governmentIdFront: 0,
    governmentIdBack: 0,
    identityPhoto: 0,
  });
  const governmentIdPairSeq = useRef(0);

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
  const [emailPhase, setEmailPhase] = useState(/** @type {string} */ ("idle"));
  const [otpDigits, setOtpDigits] = useState(new Array(OTP_LENGTH).fill(""));
  const [otpError, setOtpError] = useState("");
  const [sendError, setSendError] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const otpRefs = useRef(new Array(OTP_LENGTH).fill(null));
  const signupInFlightRef = useRef(false);

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
    if (signupInFlightRef.current || emailVerified || emailPhase === "sending" || emailPhase === "verifying") return;
    const normalizedEmail = normalizeRegistrationEmail(form.email);
    const emailErr = validateEmail(normalizedEmail, { label: "Email address" });
    if (emailErr) { setErrors((p) => ({ ...p, email: emailErr })); return; }
    setForm((p) => ({ ...p, email: normalizedEmail }));
    setErrors((p) => ({ ...p, email: "", emailVerified: "" }));
    if (!supabase) {
      setSendError("Authentication is not configured. Please try again later or contact the RHU.");
      return;
    }
    const isResend = emailPhase === "sent";
    signupInFlightRef.current = true;
    setEmailPhase("sending");
    setSendError("");
    setOtpError("");
    try {
      if (isResend) {
        const { error } = await supabase.auth.resend({ type: "signup", email: normalizedEmail });
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
        const { data, error } = await supabase.auth.signUp({
          email: normalizedEmail,
          password: tempPassword,
          options: {
            data: {
              full_name: `${form.firstName} ${form.lastName}`.trim(),
              name: `${form.firstName} ${form.lastName}`.trim(),
            },
          },
        });
        const responseIssue = signupResponseIssue({ data, error, email: normalizedEmail });
        if (responseIssue === "duplicate_email") {
          sessionStorage.removeItem("pendingSignupTempPassword");
          tempPasswordRef.current = "";
          setEmailPhase("idle");
          setErrors((p) => ({
            ...p,
            email: "This email address is already registered. Please log in or use a different email address.",
          }));
          return;
        }
        if (responseIssue) {
          if (error) throw error;
          throw new Error("We could not verify the signup response. Please try again.");
        }
      }
      setEmailPhase("sent");
      clearOtp();
      setResendIn(60);
    } catch (err) {
      const msg = err?.message || "";
      const duplicateEmail =
        err?.code === "user_already_exists"
        || err?.code === "email_exists"
        || /already registered|already exists|user already/i.test(String(msg));
      setEmailPhase(duplicateEmail ? "idle" : (isResend ? "sent" : "idle"));
      if (duplicateEmail && !isResend) {
        sessionStorage.removeItem("pendingSignupTempPassword");
        tempPasswordRef.current = "";
      }
      if (/email rate limit exceeded|frequency/i.test(msg)) {
        setSendError("Too many verification emails were sent recently. Please wait a minute, then request a new code.");
      } else if (duplicateEmail) {
        setErrors((p) => ({
          ...p,
          email: "This email address is already registered. Please log in or use a different email address.",
        }));
        setSendError("");
      } else {
        setSendError(msg || "Could not send the verification code. Please try again.");
      }
    } finally {
      signupInFlightRef.current = false;
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
        email: normalizeRegistrationEmail(form.email),
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
    minorVerificationMethod: "",
    parentLinkChoice: "skip",
    guardianEmail: "",
    guardianRelationshipType: "",
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
      studentId: null,
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

  const setDateOfBirth = (value) => {
    const oldAge = calcAge(form.dob);
    const nextAge = calcAge(value);
    const crossedMinorBoundary =
      (oldAge !== "" && Number(oldAge) < 18) !== (nextAge !== "" && Number(nextAge) < 18);
    if (crossedMinorBoundary) {
      for (const slot of Object.keys(screeningSeq.current)) screeningSeq.current[slot] += 1;
      governmentIdPairSeq.current += 1;
      setScreening(initialScreeningState());
      setForm((previous) => ({
        ...previous,
        dob: value,
        minorVerificationMethod: "",
        identity: {
          ...previous.identity,
          governmentIdFront: null,
          governmentIdBack: null,
          identityPhoto: null,
          studentId: null,
        },
      }));
    } else {
      setForm((previous) => ({ ...previous, dob: value }));
    }
    setErrors((previous) => ({
      ...previous,
      dob: "",
      governmentIdFront: "",
      governmentIdBack: "",
      identityPhoto: "",
      studentId: "",
      minorVerificationMethod: "",
    }));
  };

  // Targeted identity-state setters so unrelated fields (e.g. password) do not
  // need to re-render the entire identity object.
  const setIdType = (e) => {
    const selectedType = e.target.value;
    governmentIdPairSeq.current += 1;
    setForm((p) => ({ ...p, identity: { ...p.identity, governmentIdType: selectedType } }));
    setErrors((prev) => ({ ...prev, governmentIdType: "", governmentIdTypeOther: "" }));
    // The selected type changes the screening rules. Re-screen the current
    // front/back files and invalidate any in-flight response from the old type.
    const frontFile = form.identity.governmentIdFront;
    const backFile = form.identity.governmentIdBack;
    if (frontFile && backFile) {
      screenGovernmentIdPair(frontFile, backFile, selectedType);
      return;
    }
    for (const [slot, file] of [
      ["governmentIdFront", frontFile],
      ["governmentIdBack", backFile],
    ]) {
      if (file) {
        const seq = ++screeningSeq.current[slot];
        screenSingleDocument(slot, file, selectedType, seq);
      } else {
        screeningSeq.current[slot] += 1;
        setScreening((p) => ({ ...p, [slot]: initialSlotState() }));
      }
    }
  };
  const setIdTypeOther = (e) => {
    setForm((p) => ({ ...p, identity: { ...p.identity, governmentIdTypeOther: e.target.value } }));
    setErrors((prev) => ({ ...prev, governmentIdTypeOther: "" }));
  };
  const setIdentityNo = (e) => {
    setForm((p) => ({ ...p, identity: { ...p.identity, identityNo: e.target.value } }));
    setErrors((prev) => ({ ...prev, identityNo: "" }));
  };
  /**
   * Set/clear one identity document slot and run the automated screen on it.
   * Passing `null` clears BOTH the file and its screening result, so a replaced
   * file can never inherit a stale result. Every document slot keeps its own
   * file reference and result.
   */
  const screenSingleDocument = (slot, file, selectedGovernmentIdType, seq) => {
    setScreening((p) => ({
      ...p,
      [slot]: { ...initialSlotState(), status: SLOT_STATUS.CHECKING, requestId: seq },
    }));
    (async () => {
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("documentType", SLOT_DOCUMENT_TYPE[slot]);
        if (selectedGovernmentIdType && (slot === "governmentIdFront" || slot === "governmentIdBack")) {
          fd.append("governmentIdType", selectedGovernmentIdType);
        }
        const resp = await postFormData("/resident-documents/screen", fd);
        setScreening((p) => updateSlotForCurrentRequest(
          p,
          slot,
          seq,
          screeningSeq.current[slot],
          slotStateFromScreening(resp?.screening, seq),
        ));
      } catch (err) {
        setScreening((p) => updateSlotForCurrentRequest(
          p,
          slot,
          seq,
          screeningSeq.current[slot],
          {
            status: SLOT_STATUS.ERROR,
            requestId: seq,
            reason: "SCREENING_ERROR",
            message: screeningRequestErrorMessage(err),
            result: null,
          },
        ));
      }
    })();
  };

  const screenGovernmentIdPair = (frontFile, backFile, selectedGovernmentIdType) => {
    const pairRequest = ++governmentIdPairSeq.current;
    const frontSeq = ++screeningSeq.current.governmentIdFront;
    const backSeq = ++screeningSeq.current.governmentIdBack;
    setScreening((p) => ({
      ...p,
      governmentIdFront: { ...initialSlotState(), status: SLOT_STATUS.CHECKING, requestId: frontSeq },
      governmentIdBack: { ...initialSlotState(), status: SLOT_STATUS.CHECKING, requestId: backSeq },
    }));

    (async () => {
      try {
        const fd = new FormData();
        fd.append("governmentIdFront", frontFile);
        fd.append("governmentIdBack", backFile);
        fd.append("governmentIdType", selectedGovernmentIdType);
        const resp = await postFormData("/resident-documents/screen-id-pair", fd);
        if (
          pairRequest !== governmentIdPairSeq.current
          || frontSeq !== screeningSeq.current.governmentIdFront
          || backSeq !== screeningSeq.current.governmentIdBack
        ) return;
        setScreening((p) => ({
          ...p,
          governmentIdFront: slotStateFromScreening(resp?.governmentIdFront, frontSeq),
          governmentIdBack: slotStateFromScreening(resp?.governmentIdBack, backSeq),
        }));
      } catch (err) {
        if (
          pairRequest !== governmentIdPairSeq.current
          || frontSeq !== screeningSeq.current.governmentIdFront
          || backSeq !== screeningSeq.current.governmentIdBack
        ) return;
        const message = screeningRequestErrorMessage(err, true);
        setScreening((p) => ({
          ...p,
          governmentIdFront: {
            status: SLOT_STATUS.ERROR,
            requestId: frontSeq,
            reason: "SCREENING_ERROR",
            message,
            result: null,
          },
          governmentIdBack: {
            status: SLOT_STATUS.ERROR,
            requestId: backSeq,
            reason: "SCREENING_ERROR",
            message,
            result: null,
          },
        }));
      }
    })();
  };

  const retryDocumentScreening = (slot) => {
    if (slot === "governmentIdFront" || slot === "governmentIdBack") {
      const frontFile = form.identity.governmentIdFront;
      const backFile = form.identity.governmentIdBack;
      if (frontFile && backFile) {
        screenGovernmentIdPair(frontFile, backFile, form.identity.governmentIdType);
      } else {
        const file = form.identity[slot];
        if (file) {
          const seq = ++screeningSeq.current[slot];
          screenSingleDocument(slot, file, form.identity.governmentIdType, seq);
        }
      }
      return;
    }
    const file = form.identity[slot];
    if (file) {
      const seq = ++screeningSeq.current[slot];
      screenSingleDocument(slot, file, form.identity.governmentIdType, seq);
    }
  };

  const handleDocumentFile = (slot, file, selectedGovernmentIdType = form.identity.governmentIdType) => {
    const errorKey = slot; // form.identity keys match the slot keys
    const nextIdentity = { ...form.identity, [slot]: file };
    setForm((p) => ({ ...p, identity: { ...p.identity, [slot]: file } }));
    setErrors((prev) => ({ ...prev, [errorKey]: "" }));

    // Clear the previous result immediately and mark this slot as the newest.
    const seq = (screeningSeq.current[slot] || 0) + 1;
    screeningSeq.current[slot] = seq;
    setScreening((p) => ({ ...p, [slot]: initialSlotState() }));

    const idSlots = ["governmentIdFront", "governmentIdBack"];
    if (idSlots.includes(slot)) {
      const otherSlot = slot === "governmentIdFront" ? "governmentIdBack" : "governmentIdFront";
      const otherSeq = ++screeningSeq.current[otherSlot];
      const frontFile = nextIdentity.governmentIdFront;
      const backFile = nextIdentity.governmentIdBack;
      governmentIdPairSeq.current += 1;
      setScreening((p) => ({ ...p, [otherSlot]: initialSlotState() }));

      if (frontFile && backFile) {
        screenGovernmentIdPair(frontFile, backFile, selectedGovernmentIdType);
      } else {
        if (file) screenSingleDocument(slot, file, selectedGovernmentIdType, seq);
        if (nextIdentity[otherSlot]) {
          screenSingleDocument(otherSlot, nextIdentity[otherSlot], selectedGovernmentIdType, otherSeq);
        }
      }
      return;
    }

    if (file) screenSingleDocument(slot, file, selectedGovernmentIdType, seq);
  };

  const setIdFront = (file) => handleDocumentFile("governmentIdFront", file);
  const setIdBack = (file) => handleDocumentFile("governmentIdBack", file);
  const setIdentityPhoto = (file) => handleDocumentFile("identityPhoto", file);

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
  const applicantAge = calcAge(form.dob);
  const isMinorApplicant = applicantAge !== "" && Number(applicantAge) < 18;
  const isAdultApplicant = applicantAge !== "" && Number(applicantAge) >= 18;
  const filteredBarangays = barangayList.filter((b) => b.toLowerCase().includes(barangayQuery.toLowerCase()));

  // A successful verifyOtp() stores a real Supabase session in the browser
  // client. If the resident reloads the page mid-registration, restore the
  // verified state from that session (matched by email) instead of forcing a
  // second verification.
  useEffect(() => {
    const email = normalizeRegistrationEmail(form.email);
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
    /** @type {RegistrationErrors} */
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
      if (isMinorApplicant) {
        if (!["student_id", "staff_alternative"].includes(form.minorVerificationMethod)) {
          errs.minorVerificationMethod = "Choose student ID or request staff-approved alternative verification.";
        } else if (form.minorVerificationMethod === "student_id" && !idt.studentId) {
          errs.studentId = "Upload your current student ID, or choose staff-approved alternative verification.";
        }
        if (form.parentLinkChoice === "link") {
          const emailError = validateEmail(form.guardianEmail, { label: "Parent or guardian email" });
          if (emailError) errs.guardianEmail = emailError;
          if (!form.guardianRelationshipType) errs.guardianRelationshipType = "Select the relationship.";
        }
      } else if (isAdultApplicant) {
        if (!idt.governmentIdType) errs.governmentIdType = "Select your government-issued ID.";
        if (!idt.identityNo.trim()) errs.identityNo = "Enter the number shown on your government ID.";
        if (idt.governmentIdType === "other" && !idt.governmentIdTypeOther.trim()) {
          errs.governmentIdTypeOther = "Please specify the type of government-issued ID.";
        }
        const slotFiles = {
          governmentIdFront: idt.governmentIdFront,
          governmentIdBack: idt.governmentIdBack,
          identityPhoto: idt.identityPhoto,
        };
        for (const slot of REQUIRED_DOCUMENT_SLOTS) {
          if (!slotFiles[slot]) {
            const missingMessages = {
              governmentIdFront: "Upload the front of your government ID.",
              governmentIdBack: "Upload the back of your government ID.",
              identityPhoto: "Upload your identity photo holding the ID.",
            };
            errs[slot] = missingMessages[slot];
          } else if (!isSlotEligible(screening[slot])) {
            errs[slot] = blockingSlotError(screening[slot]);
          }
        }
      }
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

    // Never submit while a required document is missing, rejected, unchecked or
    // still being checked. The backend enforces this again when each file is
    // uploaded, but this prevents even attempting an invalid submission.
    const missingSlot = isMinorApplicant
      ? form.minorVerificationMethod === "student_id" && !form.identity.studentId
      : !isAdultApplicant
        || REQUIRED_DOCUMENT_SLOTS.some((slot) => !form.identity[slot])
        || Boolean(firstBlockingSlot(screening));
    if (missingSlot) {
      setErrors((prev) => ({
        ...prev,
        submit: isMinorApplicant
          ? "Upload your student ID or select the staff-approved alternative verification path."
          : "Upload and complete screening for both ID sides and your identity photo before submitting.",
      }));
      setStep(3);
      return;
    }

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
          ...(isMinorApplicant ? { minorVerificationMethod: form.minorVerificationMethod } : {}),
          ...(isMinorApplicant ? { guardianLinkChoice: form.parentLinkChoice === "link" ? "request" : "skip" } : {}),
          sex: form.sex,
          civilStatus: form.civilStatus,
          currentAddress: address,
          permanentAddress: address,
          cellphoneNo: form.mobile.trim(),
          barangay: form.barangay,
          zone: form.zone ? Number(form.zone) : undefined,
          // Optional claim reference: link this account to an existing profile a
          // health worker already created, instead of creating a duplicate.
          ...(claimMode && claimResidentId.trim() ? { residentId: claimResidentId.trim() } : {}),
          // Identity metadata so the Health Supervisor can see the selected ID
          // type and the submitted identity documents. The individual files are
          // uploaded separately to the documents API below.
          ...(!isMinorApplicant ? { identity: {
            governmentIdType: idt.governmentIdType,
            governmentIdTypeOther: idt.governmentIdType === "other" ? idt.governmentIdTypeOther.trim() : "",
            identityNo: idt.identityNo.trim(),
            governmentIdTypeDisplay: govTypeDisplay,
          } } : {}),
          identityNo: isMinorApplicant ? "" : idt.identityNo.trim(),
        },
      };

      // The email was already verified in Step 2 via Supabase's real email OTP
      // (Confirm Signup). verifyOtp() stored a real Supabase session in the
      // browser client, so it is restored here across page reloads.
      let session = verifiedSessionRef.current || null;
      if (!session?.user) {
        const { data: existing } = await supabase.auth.getSession();
        session = normalizeRegistrationEmail(existing?.session?.user?.email) === normalizeRegistrationEmail(form.email)
          ? existing.session
          : null;
      }
      if (!session?.user && tempPasswordRef.current) {
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
          email: normalizeRegistrationEmail(form.email),
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
      // chosen password. On a retry the account may already carry this exact
      // password, so Supabase's password-CHANGE rule ("should be different from
      // the old password") is treated as success here: it only means the
      // password is already set, which is the desired end state for
      // registration. Genuine errors (weak/blocked) are still surfaced.
      const { error: setPwError } = await supabase.auth.updateUser({ password: form.password });
      if (setPwError && !isPasswordReuseError(setPwError.message)) throw setPwError;

      const resident = await registrationApi.registerResident(payload);
      if (!resident?.id) {
        throw new Error('Registration failed. Please try again.');
      }

      // Upload each identity document through the real upload endpoint. Each
      // file becomes its own documents record with verification_status
      // 'pending' (Uploaded → Pending Review). Status is never 'Verified' at
      // upload time — only Health Supervisor review can set that. Any failed
      // upload throws, so the form never falsely reports success.
      const uploads = isMinorApplicant
        ? (form.minorVerificationMethod === 'student_id' && idt.studentId
          ? [{ slot: 'studentId', file: idt.studentId, documentType: 'student_id', label: 'your student ID', needsIdType: false }]
          : [])
        : [
            idt.governmentIdFront && { slot: 'governmentIdFront', file: idt.governmentIdFront, documentType: SLOT_DOCUMENT_TYPE.governmentIdFront, label: 'the front of your government ID', needsIdType: true },
            idt.identityPhoto && { slot: 'identityPhoto', file: idt.identityPhoto, documentType: SLOT_DOCUMENT_TYPE.identityPhoto, label: 'your identity photo', needsIdType: false },
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
          if (u.documentType === SLOT_DOCUMENT_TYPE.governmentIdFront && idt.governmentIdBack) {
            fd.append('governmentIdFront', idt.governmentIdFront);
            fd.append('governmentIdBack', idt.governmentIdBack);
          }
        }
        const docResp = await postFormData('/resident-documents/upload', fd);
        if (!docResp?.document) {
          throw new Error(`We could not upload ${u.label}. Please go back and try again.`);
        }
        // Rule-based automated screening (readability only — never an
        // authenticity decision). The backend returns a resident-safe message;
        // a rejected upload keeps the resident on this step so they can replace
        // the file. Technical reason codes are never shown to residents.
        const screening = docResp.document.screening;
        const counterpartSlot = screening?.counterpartScreening
          ? Object.keys(SLOT_DOCUMENT_TYPE).find(
            (slot) => SLOT_DOCUMENT_TYPE[slot] === screening.counterpartScreening.documentType,
          )
          : null;
        setScreening((previous) => ({
          ...previous,
          [u.slot]: slotStateFromScreening(screening, screeningSeq.current[u.slot]),
          ...(counterpartSlot ? {
            [counterpartSlot]: slotStateFromScreening(
              {
                ...screening.counterpartScreening,
                crossVerificationMessage: screening.counterpartScreening.crossVerificationMessage,
              },
              screeningSeq.current[counterpartSlot],
            ),
          } : {}),
        }));
        if (screening?.status === 'automated_rejected') {
          throw new Error(screening.message || 'The uploaded file does not meet the document requirements. Please upload a clear copy of your identification document.');
        }
      }

      if (isMinorApplicant && form.parentLinkChoice === 'link') {
        try {
          await guardianLinksApi.request({
            email: form.guardianEmail.trim(),
            relationshipType: form.guardianRelationshipType,
          });
        } catch (error) {
          console.error('Optional guardian link request failed:', error);
          sessionStorage.setItem(
            'guardianLinkNotice',
            'Your registration was saved, but the optional parent/guardian link request could not be sent. You can retry it from Verification Status.',
          );
        }
      }

      // The account is already authenticated from the signup verification.
      // Go straight to the limited resident dashboard; the verification banner
      // there is the post-registration confirmation state.
      navigate('/app/resident-limited/dashboard');
    } catch (err) {
      const status = err?.status;
      const backendMessage = typeof err?.message === 'string' ? err.message : '';
      const isGenericStatusOnly = /^Request failed with status/i.test(backendMessage);

      // A 422 from the document upload path is the deterministic screening
      // result: the file was rejected and the registration cannot proceed.
      // Show the resident-safe message; never a technical reason code.
      const rejectedPair = err?.payload?.details?.screening;
      if (status === 422 && rejectedPair?.governmentIdFront && rejectedPair?.governmentIdBack) {
        const front = rejectedPair.governmentIdFront;
        const back = rejectedPair.governmentIdBack;
        setScreening((previous) => ({
          ...previous,
          governmentIdFront: slotStateFromScreening(front, screeningSeq.current.governmentIdFront),
          governmentIdBack: slotStateFromScreening(back, screeningSeq.current.governmentIdBack),
        }));
        setErrors((previous) => ({
          ...previous,
          submit: front.status === 'automated_rejected'
            ? front.message
            : back.message || 'One or both government ID images need to be replaced.',
        }));
        setStep(3);
        setSubmitting(false);
        return;
      }
      if (status === 422 && typeof err?.payload?.details?.screening?.message === 'string') {
        setErrors((prev) => ({ ...prev, submit: err.payload.details.screening.message }));
        setStep(3);
        setSubmitting(false);
        return;
      }

      let message;
      if (status === 401) {
        message = "Your session expired. Sign in again before submitting registration.";
      } else if (status === 403) {
        message = "Your account is not authorized to submit this registration.";
      } else if (status === 404) {
        message = "The registration or document-upload service is unavailable. No ID decision was made; contact support before trying to register again.";
      } else if (status === 413) {
        message = "An uploaded file exceeds the 10 MB limit. Replace it with a smaller file and retry.";
      } else if (status === 415) {
        message = isMinorApplicant
          ? "The student ID file format is not supported. Use a PDF, JPG, or PNG."
          : "An uploaded file format is not supported. Use a PDF, JPG, or PNG document, and a JPG or PNG identity photo.";
      } else if (status >= 500) {
        message = "The server returned an error while processing registration. This is not an ID decision; some registration data may already be saved. Please retry once, and contact support if the problem continues.";
      } else if (!status) {
        message = "The registration service could not be reached or is temporarily unavailable. No ID decision was made; please retry or contact support.";
      } else if (status === 409) {
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

  // Submission is only enabled when every required document has been uploaded
  // AND passed its own automated check. This is a UX guard; the backend
  // independently rejects rejected/stale documents.
  const documentsSubmittable = isMinorApplicant
    ? form.minorVerificationMethod === "staff_alternative"
      || (form.minorVerificationMethod === "student_id" && Boolean(form.identity.studentId))
    : isAdultApplicant
      && canSubmitDocuments(screening)
      && REQUIRED_DOCUMENT_SLOTS.every((slot) => Boolean(form.identity[slot]));
  const canSubmit = documentsSubmittable && !submitting;
  const blockingSlot = isAdultApplicant ? firstBlockingSlot(screening) : null;

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
                <div className="sm:col-span-2 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      checked={claimMode}
                      onChange={(e) => setClaimMode(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-brand-blue"
                    />
                    <span className="text-[13px] leading-relaxed text-slate-700">
                      <span className="font-semibold text-brand-ink">
                        Already registered by a Barangay Health Worker or Health Personnel?
                      </span>
                      <br />
                      Tick this if a health worker already created your record. We will link this account to your
                      existing profile instead of creating a new one.
                    </span>
                  </label>
                  {claimMode && (
                    <div className="mt-3">
                      <Field label="Resident ID" optional error={errors.residentId}>
                        <input
                          type="text"
                          placeholder="e.g. RES-000123"
                          value={claimResidentId}
                          onChange={(e) => setClaimResidentId(e.target.value)}
                          className={inputCls(errors.residentId)}
                        />
                      </Field>
                      <p className="mt-1 text-[11.5px] text-slate-500">
                        Enter the Resident ID from your record for an exact match. If you don&apos;t have it, continue —
                        we&apos;ll match your record using your name and date of birth. Your identity is confirmed before
                        linking, so your existing health records stay with the same Resident ID.
                      </p>
                    </div>
                  )}
                </div>
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
                    onChange={setDateOfBirth}
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
                          disabled={emailPhase === "sending" || resendIn > 0 && /** @type {string} */ (emailPhase) === "sent"}
                          className="inline-flex items-center gap-2 rounded-lg bg-brand-blue px-4 py-2 text-[12.5px] font-semibold text-white shadow-[0_10px_22px_-14px_rgba(42,125,225,0.9)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {emailPhase === "sending" ? (
                            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Sending</>
                          ) : (
                            <><Mail className="h-3.5 w-3.5" /> {/** @type {string} */ (emailPhase) === "sent" ? "Send Code Again" : "Send Verification Code"}</>
                          )}
                        </button>
                        {/** @type {string} */ (emailPhase) === "sent" && resendIn > 0 && (
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
                    <Field label="Mobile Number" required error={errors.mobile} hint="Enter your 11-digit Philippine mobile number (must start with 09).">
                        <input
                          type="tel"
                          inputMode="numeric"
                          autoComplete="tel"
                          pattern="[0-9]*"
                          maxLength={11}
                          placeholder="09XXXXXXXXX"
                          value={form.mobile}
                          onChange={set("mobile")}
                          onKeyDown={(e) => {
                            // Block anything that is not a digit or an editing key.
                            const allowed = ["Backspace", "Delete", "Tab", "ArrowLeft", "ArrowRight", "Home", "End"];
                            if (allowed.includes(e.key) || e.ctrlKey || e.metaKey) return;
                            if (!/^[0-9]$/.test(e.key)) e.preventDefault();
                          }}
                          className={`${inputCls(errors.mobile)} tabular-nums`}
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
                        {/* BUG-021: no standalone Terms page exists yet, so this is plain
                            emphasized text rather than a dead "#" link. */}
                        <span className="font-semibold text-brand-blue">Terms and Conditions</span> of this portal.
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
                    {isMinorApplicant ? "Minor Registration" : "Identity Verification"}
                  </p>
                  <p className="mt-1">
                    {isMinorApplicant
                      ? "Upload a student ID for staff review, or request the staff-approved alternative verification path. Parent or guardian linking is optional."
                      : isAdultApplicant
                        ? "Select a valid government-issued ID and upload its front and back plus an identity photo. A Health Supervisor reviews the submitted documents."
                        : "Enter a valid date of birth to see the verification requirements for your age."}
                  </p>
                </InfoNote>

                {isMinorApplicant ? (
                  <>
                    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-5">
                      <SectionKicker className="mb-2">Student ID Verification</SectionKicker>
                      <p className="mb-4 text-sm leading-relaxed text-slate-600">
                        Upload a clear image of your current student ID for staff verification. It is not treated as proof of identity or school enrollment until reviewed.
                      </p>
                      <div className="mb-4 space-y-3">
                        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700">
                          <input
                            type="radio"
                            name="minorVerificationMethod"
                            value="student_id"
                            checked={form.minorVerificationMethod === "student_id"}
                            onChange={() => setForm((p) => ({ ...p, minorVerificationMethod: "student_id" }))}
                            className="mt-1"
                          />
                          <span>Use a student ID</span>
                        </label>
                        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700">
                          <input
                            type="radio"
                            name="minorVerificationMethod"
                            value="staff_alternative"
                            checked={form.minorVerificationMethod === "staff_alternative"}
                            onChange={() => setForm((p) => ({ ...p, minorVerificationMethod: "staff_alternative" }))}
                            className="mt-1"
                          />
                          <span> I do not have a student ID. Request staff-approved alternative verification.</span>
                        </label>
                      </div>
                      {errors.minorVerificationMethod && <p className="mb-3 text-xs text-brand-danger">{errors.minorVerificationMethod}</p>}
                      {form.minorVerificationMethod === "student_id" && (
                        <>
                          <UploadComponent
                            label="Student ID Verification"
                            file={form.identity.studentId}
                            onFile={(file) => setForm((p) => ({ ...p, identity: { ...p.identity, studentId: file } }))}
                            onRemove={() => setForm((p) => ({ ...p, identity: { ...p.identity, studentId: null } }))}
                            screening={screening.studentId}
                            accept=".png,.jpg,.jpeg,.pdf"
                            allowedExts={["png", "jpg", "jpeg", "pdf"]}
                            hint="PDF, PNG, or JPG — up to 10 MB"
                          />
                          {errors.studentId && <p className="mt-2 text-xs text-brand-danger">{errors.studentId}</p>}
                        </>
                      )}
                      {form.minorVerificationMethod === "staff_alternative" && (
                        <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
                          Your registration can continue, but a Health Supervisor or PHN must approve the alternative verification path before approving your resident record.
                        </p>
                      )}
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-5">
                      <SectionKicker className="mb-2">Parent / Guardian Link (Optional)</SectionKicker>
                      <p className="mb-4 text-sm leading-relaxed text-slate-600">
                        Link an existing parent or guardian account to help associate your resident record with your family. You may skip this step and complete registration without linking an account.
                      </p>
                      <div className="space-y-3">
                        <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700">
                          <input
                            type="radio"
                            name="parentLinkChoice"
                            checked={form.parentLinkChoice === "skip"}
                            onChange={() => setForm((p) => ({ ...p, parentLinkChoice: "skip" }))}
                          />
                          Skip parent/guardian linking
                        </label>
                        <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700">
                          <input
                            type="radio"
                            name="parentLinkChoice"
                            checked={form.parentLinkChoice === "link"}
                            onChange={() => setForm((p) => ({ ...p, parentLinkChoice: "link" }))}
                          />
                          Request a link to an existing account
                        </label>
                      </div>
                      {form.parentLinkChoice === "link" && (
                        <div className="mt-4 space-y-4">
                          <Field label="Parent or guardian registered email" required error={errors.guardianEmail}>
                            <input
                              type="email"
                              autoComplete="email"
                              value={form.guardianEmail}
                              onChange={(e) => setForm((p) => ({ ...p, guardianEmail: e.target.value }))}
                              className={inputCls(errors.guardianEmail)}
                            />
                          </Field>
                          <SelectField
                            label="Relationship to applicant"
                            required
                            error={errors.guardianRelationshipType}
                            value={form.guardianRelationshipType}
                            onChange={(e) => setForm((p) => ({ ...p, guardianRelationshipType: e.target.value }))}
                          >
                            <option value="">Select relationship</option>
                            <option value="father">Father</option>
                            <option value="mother">Mother</option>
                            <option value="legal_guardian">Legal guardian</option>
                            <option value="grandparent">Grandparent</option>
                            <option value="other_family_member">Other family member</option>
                            <option value="other">Other</option>
                          </SelectField>
                          <p className="text-xs leading-relaxed text-slate-500">
                            The account holder must sign in and accept. Staff must verify the relationship. Entering an email does not grant access to your records, and we do not confirm whether an email is registered.
                          </p>
                        </div>
                      )}
                    </div>
                  </>
                ) : isAdultApplicant ? (
                  <>
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
                      screening={screening.governmentIdFront}
                      onRetry={() => retryDocumentScreening("governmentIdFront")}
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
                      screening={screening.governmentIdBack}
                      onRetry={() => retryDocumentScreening("governmentIdBack")}
                    />
                    {errors.governmentIdBack && (
                      <p className="-mt-3 text-[11.5px] font-medium text-brand-danger">{errors.governmentIdBack}</p>
                    )}
                  </div>
                </div>

                {/* 3. Identity Photo */}
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
                    accept=".png,.jpg,.jpeg"
                    allowedExts={["png", "jpg", "jpeg"]}
                    screening={screening.identityPhoto}
                  />
                  {errors.identityPhoto && (
                    <p className="mt-1.5 text-[11.5px] font-medium text-brand-danger">{errors.identityPhoto}</p>
                  )}
                </div>
                  </>
                ) : (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
                    A valid date of birth is required before selecting identity verification documents.
                  </div>
                )}

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
                      {isMinorApplicant
                        ? "I confirm that the information I provided is accurate. I understand that my student ID or requested alternative verification and my registration will be reviewed by authorized staff before my resident record is approved."
                        : "I confirm that the government ID and identity photo I uploaded belong to me and that the information I provided is accurate. I understand that my registration documents will be reviewed by the Health Supervisor before my account is approved."}
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
                <ReviewBlock title={isMinorApplicant ? "Minor Verification" : "Identity Verification"} onEdit={() => goTo(3)} items={isMinorApplicant ? [
                  ["Method", form.minorVerificationMethod === "student_id" ? "Student ID" : form.minorVerificationMethod === "staff_alternative" ? "Staff-approved alternative requested" : "—"],
                  ["Parent / Guardian Link", form.parentLinkChoice === "link" ? "Request sent for account-holder acceptance and staff review" : "Skipped"],
                  ...(form.parentLinkChoice === "link" ? [["Relationship", form.guardianRelationshipType.replace(/_/g, " ")]] : []),
                ] : [
                  ["Government ID Type", form.identity.governmentIdType === "other"
                    ? `Other: ${form.identity.governmentIdTypeOther || "—"}`
                    : (GOVT_ID_LABEL[form.identity.governmentIdType] || "—")],
                  ["Government ID Number", form.identity.identityNo ? "••••••••••" : "—"],
                ]} />
                {/* Document status is tied to each file's OWN automated screening
                    result, never a hardcoded "Uploaded — Pending Review". */}
                <div className="overflow-hidden rounded-xl border border-slate-200">
                  <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-100/80 px-4 py-3">
                    <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-brand-ink">Document Status</p>
                    <button
                      type="button"
                      onClick={() => goTo(3)}
                      className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-brand-blue transition-colors hover:text-brand-dark"
                    >
                      Edit
                    </button>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {isMinorApplicant ? (
                      form.minorVerificationMethod === "student_id"
                        ? <ReviewDocRow label="Student ID Verification" slot={screening.studentId} fileName={form.identity.studentId?.name} />
                        : <ReviewPlainRow label="Alternative path" value="Pending staff review" />
                    ) : (
                      <>
                        <ReviewDocRow label="Government ID — Front" slot={screening.governmentIdFront} fileName={form.identity.governmentIdFront?.name} />
                        <ReviewDocRow label="Government ID — Back" slot={screening.governmentIdBack} fileName={form.identity.governmentIdBack?.name} />
                        <ReviewDocRow label="Identity Photo" slot={screening.identityPhoto} fileName={form.identity.identityPhoto?.name} />
                      </>
                    )}
                  </div>
                </div>
                <ReviewBlock title="Verification" onEdit={() => goTo(3)} items={[
                  ["Method", "Health Supervisor review"],
                  ["Status", documentsSubmittable ? "Ready to submit for staff review" : "Complete the selected verification method before submitting."],
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
              <>
                {!documentsSubmittable && (
                  <p className="mr-auto text-left text-[12px] leading-snug text-brand-danger">
                    {blockingSlot ? blockingSlotError(screening[blockingSlot]) : "Upload all required documents before submitting."}
                  </p>
                )}
                <button
                  onClick={submit}
                  disabled={!canSubmit}
                  className={`${btnPrimary} disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Checking document...
                    </>
                  ) : (
                    <>
                      Submit Registration {documentsSubmittable && <Check className="h-4 w-4" strokeWidth={2.5} />}
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </RegistrationCard>
    </RegistrationShell>
  );
}
