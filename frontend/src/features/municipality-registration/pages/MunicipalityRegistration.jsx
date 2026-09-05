import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, CheckCircle2, FileCheck2, MapPin, ShieldCheck } from "lucide-react";
import GovSeal from "@/components/branding/GovSeal";
import { municipalityOnboardingApi } from "@/services/api/municipalityOnboardingApi";

const MUNICIPALITIES = [
  { name: "Municipality of Pili", status: "available" },
  { name: "Municipality of Naga", status: "coming-soon" },
  { name: "Municipality of Calabanga", status: "coming-soon" },
  { name: "Municipality of Iriga", status: "coming-soon" },
];

const FORM_FIELDS = [
  ["municipalityAddress", "Municipality Address", "text", "Complete municipality address"],
  ["rhuName", "Rural Health Unit (RHU) Name", "text", "RHU name"],
  ["municipalHealthOffice", "Municipal Health Office", "text", "Office name"],
  ["rhuAddress", "RHU Address", "text", "Complete RHU address"],
  ["rhuContact", "RHU Contact Number", "tel", "09XX XXX XXXX"],
  ["municipalEmail", "Official Municipal Email", "email", "office@municipality.gov.ph"],
  ["mho", "Municipal Health Officer (MHO)", "text", "Full name"],
  ["mhoEmail", "MHO Official Email", "email", "mho@municipality.gov.ph"],
  ["phnName", "PHN Name", "text", "Full name"],
  ["phnEmail", "PHN Official Email", "email", "phn@municipality.gov.ph"],
  ["barangays", "Number of Barangays", "number", "e.g. 26"],
  ["registeredBarangays", "Registered Barangays", "text", "Comma-separated barangay names"],
  ["representative", "Authorized Representative", "text", "Full name"],
  ["position", "Representative Position", "text", "Position or office"],
  ["contact", "Contact Number", "tel", "09XX XXX XXXX"],
  ["email", "Email Address", "email", "representative@email.gov.ph"],
];

const initialForm = Object.fromEntries(FORM_FIELDS.map(([name]) => [name, ""]));
const labelClass = "text-[12px] font-bold text-brand-ink";
const inputClass = "mt-1.5 w-full rounded-input border border-brand-border bg-white px-3 py-2.5 text-[13px] text-brand-ink outline-none transition focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20 placeholder:text-brand-gray/50";
/** @type {Record<string, string>} */
const statusLabels = { pending_mho_verification: "Pending MHO Verification", under_mho_review: "Under MHO Review", under_phn_verification: "Pending PHN Verification", returned_for_correction: "Correction Required", approved: "Approved", rejected: "Rejected" };

function RootMark() {
  return (
    <div className="flex items-center gap-3">
      <GovSeal height={44} eager onDark />
      <div><p className="font-display text-lg font-bold leading-tight text-white">KALUSAGAP</p><p className="text-[9px] font-semibold uppercase tracking-gov text-white/65">Community Health System</p></div>
    </div>
  );
}

export default function MunicipalityRegistration() {
  const [municipality, setMunicipality] = useState("");
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [registration, setRegistration] = useState(/** @type {{ reference: string, municipality: string, province: string, status: string, municipalityAddress?: string, rhuName?: string, rhuAddress?: string, rhuContact?: string, municipalHealthOffice?: string, mhoName?: string, mhoEmail?: string, phnName?: string, phnEmail?: string, registeredBarangays?: string[], verificationLinks?: { mho: string, phn: string } } | null} */ (null));
  const [editingReference, setEditingReference] = useState(/** @type {string | null} */ (null));

  /** @param {React.ChangeEvent<HTMLInputElement>} event */
  const updateField = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  /** @param {React.FormEvent<HTMLFormElement>} event */
  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const payload = {
        municipalityName: municipality,
        province: "Camarines Sur",
        municipalHealthOffice: form.municipalHealthOffice,
        rhuName: form.rhuName,
        municipalityAddress: form.municipalityAddress,
        rhuAddress: form.rhuAddress,
        rhuContact: form.rhuContact,
        barangayCount: form.barangays,
        authorizedRepresentative: form.representative,
        representativePosition: form.position,
        representativeContact: form.contact,
        representativeEmail: form.email,
        officialMunicipalEmail: form.municipalEmail,
        mhoName: form.mho,
        mhoEmail: form.mhoEmail,
        phnName: form.phnName,
        phnEmail: form.phnEmail,
        registeredBarangays: form.registeredBarangays,
      };
      const result = editingReference ? await municipalityOnboardingApi.resubmit(editingReference, payload) : await municipalityOnboardingApi.submit(payload);
      setRegistration(result);
      setEditingReference(null);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to submit registration. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (registration) return <RegistrationStatus registration={registration} onEdit={() => { setMunicipality(registration.municipality); setForm((current) => ({ ...current, municipalityAddress: registration.municipalityAddress || current.municipalityAddress, rhuName: registration.rhuName || current.rhuName, rhuAddress: registration.rhuAddress || current.rhuAddress, rhuContact: registration.rhuContact || current.rhuContact, municipalHealthOffice: registration.municipalHealthOffice || current.municipalHealthOffice, mho: registration.mhoName || current.mho, mhoEmail: registration.mhoEmail || current.mhoEmail, phnName: registration.phnName || current.phnName, phnEmail: registration.phnEmail || current.phnEmail, registeredBarangays: Array.isArray(registration.registeredBarangays) ? registration.registeredBarangays.join(", ") : current.registeredBarangays })); setEditingReference(registration.reference); setRegistration(null); }} />;

  return (
    <div className="min-h-dvh bg-brand-bg text-brand-ink">
      <header className="gov-navy-panel border-b border-white/10">
        <div className="gov-hatch mx-auto flex max-w-content items-center justify-between px-4 py-5 md:px-8"><RootMark /><span className="hidden text-right text-[10px] font-bold uppercase tracking-gov text-white/65 sm:block">Municipality onboarding<br />Camarines Sur</span></div>
        <div className="gov-flag-rule h-1" aria-hidden="true" />
      </header>

      <main className="mx-auto max-w-content px-4 py-10 md:px-8 md:py-14">
        <div className="grid gap-8 lg:grid-cols-[0.72fr_1.28fr] lg:items-start">
          <section className="lg:sticky lg:top-8">
            <p className="gov-kicker text-brand-blue">A shared public health record</p>
            <h1 className="gov-underline mt-3 max-w-lg font-display text-3xl font-bold leading-tight text-brand-dark md:text-4xl">Register Your Municipality</h1>
            <p className="mt-7 max-w-xl text-[15px] leading-7 text-brand-gray">KALUSAGAP is a community health risk monitoring and early intervention system designed to support local health units in managing, monitoring, and improving community health information.</p>
            <p className="mt-5 border-l-4 border-brand-gold bg-brand-goldpale px-4 py-3 text-[13px] font-semibold leading-6 text-brand-amber">Municipalities in Camarines Sur with an available Rural Health Unit (RHU) may register their municipality with KALUSAGAP.</p>
            <div className="mt-9 grid gap-4 border-t border-brand-border pt-6 text-[12px] text-brand-gray"><div className="flex gap-3"><ShieldCheck className="h-5 w-5 shrink-0 text-brand-green" /><span>Registration details are reviewed by the KALUSAGAP team.</span></div><div className="flex gap-3"><MapPin className="h-5 w-5 shrink-0 text-brand-blue" /><span>Built for municipalities and rural health units across Camarines Sur.</span></div></div>
          </section>

          <section className="gov-sheet overflow-hidden rounded-card shadow-deep">
            <div className="border-b border-brand-border bg-white px-5 py-5 sm:px-8"><div className="flex items-start gap-3"><FileCheck2 className="mt-0.5 h-5 w-5 shrink-0 text-brand-blue" /><div><h2 className="font-display text-xl font-bold text-brand-dark">Municipality registration</h2><p className="mt-1 text-[12px] text-brand-gray">Provide the official details for your municipality and RHU.</p></div></div></div>
            <form onSubmit={submit} className="space-y-6 px-5 py-6 sm:px-8 sm:py-8">
              {error && <p role="alert" className="border border-brand-danger/25 bg-brand-danger/5 px-3 py-2.5 text-[12px] font-semibold text-brand-danger">{error}</p>}
              <div className="grid gap-4 sm:grid-cols-2">
                <div><label htmlFor="municipality" className={labelClass}>Municipality Name <span className="text-brand-danger">*</span></label><select id="municipality" required value={municipality} onChange={(event) => { setMunicipality(event.target.value); setError(""); }} className={inputClass}><option value="">Select municipality</option>{MUNICIPALITIES.map((item) => <option key={item.name} value={item.name} disabled={item.status !== "available"}>{item.name}{item.status !== "available" ? " - coming soon" : ""}</option>)}</select></div>
                <div><label htmlFor="province" className={labelClass}>Province <span className="text-brand-danger">*</span></label><input id="province" value="Camarines Sur" readOnly className={`${inputClass} bg-brand-light/60`} /></div>
              </div>
              <div className="border-t border-brand-border pt-5"><p className="gov-kicker text-brand-blue">Municipality and RHU information</p><div className="mt-4 grid gap-4 sm:grid-cols-2">{FORM_FIELDS.slice(0, 12).map(([name, label, type, placeholder]) => <Field key={name} name={name} label={label} type={type} placeholder={placeholder} value={form[name]} onChange={updateField} />)}</div></div>
              <div className="border-t border-brand-border pt-5"><p className="gov-kicker text-brand-blue">Authorized representative</p><div className="mt-4 grid gap-4 sm:grid-cols-2">{FORM_FIELDS.slice(12).map(([name, label, type, placeholder]) => <Field key={name} name={name} label={label} type={type} placeholder={placeholder} value={form[name]} onChange={updateField} />)}</div></div>
              <div className="flex items-start gap-3 border-t border-brand-border pt-5"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-green" /><p className="text-[11px] leading-5 text-brand-gray">By submitting, you confirm that these are official municipality details and that the authorized representative may be contacted for verification.</p></div>
              <button type="submit" disabled={submitting} className="group flex w-full items-center justify-center gap-2 rounded-btn bg-brand-blue px-5 py-3.5 text-[12px] font-bold uppercase tracking-gov text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60">{submitting ? "Submitting registration..." : "Submit registration"} {!submitting && <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />}</button>
            </form>
          </section>
        </div>
      </main>
    </div>
  );
}

/** @param {{ name: string, label: string, type: string, placeholder: string, value: string, onChange: (event: React.ChangeEvent<HTMLInputElement>) => void }} props */
function Field({ name, label, type, placeholder, value, onChange }) {
  return <div><label htmlFor={name} className={labelClass}>{label} <span className="text-brand-danger">*</span></label><input id={name} name={name} type={type} required placeholder={placeholder} value={value} onChange={onChange} className={inputClass} /></div>;
}

/** @param {{ registration: { reference: string, municipality: string, province: string, status: string, municipalityAddress?: string, rhuName?: string, rhuAddress?: string, rhuContact?: string, municipalHealthOffice?: string, mhoName?: string, mhoEmail?: string, phnName?: string, phnEmail?: string, registeredBarangays?: string[], verificationLinks?: { mho: string, phn: string } }, onEdit: () => void }} props */
function RegistrationStatus({ registration, onEdit }) {
  const [current, setCurrent] = useState(registration);
  const [checking, setChecking] = useState(false);
  const [statusError, setStatusError] = useState("");
  const checkStatus = async () => {
    setChecking(true);
    setStatusError("");
    try { setCurrent(await municipalityOnboardingApi.getStatus(current.reference)); } catch (error) { setStatusError(error instanceof Error ? error.message : "Unable to refresh status."); } finally { setChecking(false); }
  };
  const steps = /** @type {Array<[string, boolean]>} */ ([
    ["Registration Submitted", true],
    ["MHO Verification", ["under_mho_review", "under_phn_verification", "approved"].includes(current.status)],
    ["PHN Verification", ["under_phn_verification", "approved"].includes(current.status)],
    ["Approval", current.status === "approved"],
  ]);
  if (current.status === "approved") return <ApprovedRegistrationStatus registration={current} />;
  return <div className="min-h-dvh bg-brand-bg text-brand-ink"><header className="gov-navy-panel border-b border-white/10"><div className="gov-hatch mx-auto flex max-w-content items-center px-4 py-5 md:px-8"><RootMark /></div><div className="gov-flag-rule h-1" aria-hidden="true" /></header><main className="mx-auto max-w-2xl px-4 py-12 md:px-8"><section className="gov-sheet rounded-card p-6 shadow-deep sm:p-9"><p className="gov-kicker text-brand-blue">Municipality registration</p><h1 className="mt-3 font-display text-3xl font-bold text-brand-dark">Registration received</h1><p className="mt-3 text-sm leading-6 text-brand-gray">Your municipality is not active yet. Verification must be completed before the KALUSAGAP environment is enabled.</p><div className="mt-8 grid gap-4 border-y border-brand-border py-5 text-sm"><div className="flex justify-between gap-4"><span className="text-brand-gray">Reference</span><strong className="font-mono text-brand-dark">{current.reference}</strong></div><div className="flex justify-between gap-4"><span className="text-brand-gray">Municipality</span><strong className="text-right text-brand-dark">{current.municipality}, {current.province}</strong></div><div className="flex justify-between gap-4"><span className="text-brand-gray">Status</span><strong className="text-right text-brand-blue">{statusLabels[current.status] || current.status}</strong></div></div><div className="mt-8 space-y-4">{steps.map(([label, complete], index) => <div key={label} className="flex items-center gap-3 text-sm"><span className={`flex h-6 w-6 items-center justify-center rounded-full border ${complete ? "border-brand-green bg-brand-green text-white" : "border-brand-border text-brand-gray"}`}>{complete ? "✓" : index + 1}</span><span className={complete ? "font-semibold text-brand-ink" : "text-brand-gray"}>{label}</span></div>)}</div>{current.status === "returned_for_correction" && <button type="button" onClick={onEdit} className="mt-6 w-full rounded-btn bg-brand-blue px-5 py-3 text-[12px] font-bold uppercase tracking-gov text-white hover:bg-brand-dark">Edit and resubmit</button>}{import.meta.env.DEV && current.verificationLinks && <div className="mt-6 border-t border-brand-border pt-5 text-xs text-brand-gray"><p className="font-bold text-brand-ink">Development verification links</p><a className="mt-2 block truncate text-brand-blue underline" href={current.verificationLinks.mho}>MHO verification link</a><a className="mt-1 block truncate text-brand-blue underline" href={current.verificationLinks.phn}>PHN verification link</a></div>}{statusError && <p role="alert" className="mt-4 text-center text-xs text-brand-danger">{statusError}</p>}<button type="button" onClick={checkStatus} disabled={checking} className="mt-9 w-full rounded-btn border border-brand-blue px-5 py-3 text-[12px] font-bold uppercase tracking-gov text-brand-blue transition-colors hover:bg-brand-light disabled:opacity-60">{checking ? "Checking status..." : "Check registration status"}</button></section></main></div>;
}

/** @param {{ registration: { reference: string, municipality: string, province: string, status: string } }} props */
function ApprovedRegistrationStatus({ registration }) {
  const navigate = useNavigate();
  const destination = registration.municipality === "Municipality of Pili" ? "/pili" : "/login";
  return <div className="min-h-dvh bg-brand-bg text-brand-ink"><header className="gov-navy-panel border-b border-white/10"><div className="gov-hatch mx-auto flex max-w-content items-center px-4 py-5 md:px-8"><RootMark /></div><div className="gov-flag-rule h-1" aria-hidden="true" /></header><main className="mx-auto max-w-2xl px-4 py-12 md:px-8"><section className="gov-sheet rounded-card p-6 shadow-deep sm:p-9"><p className="gov-kicker text-brand-green">Registration approved</p><h1 className="mt-3 font-display text-3xl font-bold text-brand-dark">Registration Approved</h1><p className="mt-4 text-sm leading-7 text-brand-gray">Your municipality has been successfully verified and approved. You may now sign in to KALUSAGAP.</p><div className="mt-7 grid gap-3 border-y border-brand-border py-5 text-sm"><div className="flex justify-between gap-4"><span className="text-brand-gray">Reference</span><strong className="font-mono text-brand-dark">{registration.reference}</strong></div><div className="flex justify-between gap-4"><span className="text-brand-gray">Municipality</span><strong className="text-right text-brand-dark">{registration.municipality}, {registration.province}</strong></div><div className="flex justify-between gap-4"><span className="text-brand-gray">Status</span><strong className="text-brand-green">Approved</strong></div></div><button type="button" onClick={() => navigate("/login", { state: { from: destination } })} className="mt-7 w-full rounded-btn bg-brand-blue px-5 py-3.5 text-[12px] font-bold uppercase tracking-gov text-white transition-colors hover:bg-brand-dark">Proceed to Login</button></section></main></div>;
}