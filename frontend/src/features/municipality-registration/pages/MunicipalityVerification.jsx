import { useEffect, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { useParams } from "react-router-dom";
import GovSeal from "@/components/branding/GovSeal";
import { municipalityOnboardingApi } from "@/services/api/municipalityOnboardingApi";

/** @type {Record<string, string>} */
const labels = { pending_mho_verification: "Pending MHO Verification", under_mho_review: "Under MHO Review", under_phn_verification: "Pending PHN Verification", returned_for_correction: "Correction Required", approved: "Approved", rejected: "Rejected" };

export default function MunicipalityVerification() {
  const { token } = useParams();
  const [registration, setRegistration] = useState(/** @type {any} */ (null));
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [working, setWorking] = useState(false);

  useEffect(() => { municipalityOnboardingApi.getVerification(token).then(setRegistration).catch((requestError) => setError(requestError.message || "This verification link is unavailable.")); }, [token]);

  /** @param {string} decision */
  const decide = async (decision) => {
    if ((decision === "correction" || decision === "reject") && !reason.trim()) { setError("A reason is required for this action."); return; }
    setWorking(true); setError("");
    try { setRegistration(await municipalityOnboardingApi.decideVerification(token, { decision, reason })); } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Unable to record this decision."); } finally { setWorking(false); }
  };

  if (error && !registration) return <RestrictedShell><p role="alert" className="text-sm text-brand-danger">{error}</p></RestrictedShell>;
  if (!registration) return <RestrictedShell><p className="text-sm text-brand-gray">Loading verification details...</p></RestrictedShell>;
  const isMho = registration.verificationRole === "mho";
  const reviewComplete = registration.verificationCompleted;
  if (reviewComplete) return <RestrictedShell><p className="gov-kicker text-brand-blue">Restricted {isMho ? "MHO" : "PHN"} access</p><h1 className="mt-3 font-display text-3xl font-bold text-brand-dark">Verification already recorded</h1><p className="mt-3 text-sm leading-6 text-brand-gray">This {isMho ? "MHO" : "PHN"} verification has already been recorded. The registration is currently {labels[registration.status] || registration.status}.</p></RestrictedShell>;
  return <RestrictedShell><p className="gov-kicker text-brand-blue">Restricted {isMho ? "MHO" : "PHN"} access</p><h1 className="mt-3 font-display text-3xl font-bold text-brand-dark">KALUSAGAP Municipality Registration Verification</h1><p className="mt-3 text-sm leading-6 text-brand-gray">This page is only for reviewing this municipality registration. It does not provide access to the KALUSAGAP dashboard.</p><div className="mt-7 grid gap-3 border-y border-brand-border py-5 text-sm"><Detail label="Registration reference" value={registration.reference} /><Detail label="Municipality" value={`${registration.municipality}, ${registration.province}`} /><Detail label="Municipality address" value={registration.municipalityAddress} /><Detail label="RHU" value={`${registration.rhuName} | ${registration.rhuAddress}`} /><Detail label="Municipal Health Office" value={registration.municipalHealthOffice} /><Detail label="MHO" value={`${registration.mhoName} | ${registration.mhoEmail}`} /><Detail label="PHN" value={`${registration.phnName} | ${registration.phnEmail}`} /><Detail label="Registered barangays" value={registration.registeredBarangays.join(", ")} /></div><p className="mt-6 text-sm font-semibold text-brand-blue">Current status: {labels[registration.status] || registration.status}</p>{registration.status !== "approved" && registration.status !== "rejected" && <><label htmlFor="reason" className="mt-7 block text-xs font-bold text-brand-ink">Reason or comments for correction/rejection</label><textarea id="reason" value={reason} onChange={(event) => setReason(event.target.value)} rows={3} className="mt-2 w-full rounded-input border border-brand-border p-3 text-sm outline-none focus:border-brand-blue" placeholder="Required when requesting correction or rejecting" /><div className="mt-5 grid gap-3 sm:grid-cols-3"><ActionButton icon={CheckCircle2} label="Approve" onClick={() => decide("approve")} disabled={working} /><ActionButton icon={XCircle} label="Request Correction" onClick={() => decide("correction")} disabled={working} secondary /><ActionButton icon={XCircle} label="Reject" onClick={() => decide("reject")} disabled={working} danger /></div></>}{error && <p role="alert" className="mt-4 text-sm text-brand-danger">{error}</p>}</RestrictedShell>;
}

/** @param {{ children: React.ReactNode }} props */
function RestrictedShell({ children }) { return <div className="min-h-dvh bg-brand-bg text-brand-ink"><header className="gov-navy-panel border-b border-white/10"><div className="gov-hatch mx-auto flex max-w-content items-center px-4 py-5 md:px-8"><GovSeal height={44} eager onDark /><div className="ml-3"><p className="font-display text-lg font-bold text-white">KALUSAGAP</p><p className="text-[9px] uppercase tracking-gov text-white/65">Restricted verification</p></div></div><div className="gov-flag-rule h-1" /></header><main className="mx-auto max-w-3xl px-4 py-10 md:px-8"><section className="gov-sheet rounded-card p-6 shadow-deep sm:p-9">{children}</section></main></div>; }
/** @param {{ label: string, value?: string }} props */
function Detail({ label, value }) { return <div className="grid gap-1 sm:grid-cols-[190px_1fr]"><span className="text-brand-gray">{label}</span><strong className="text-brand-dark">{value || "Not provided"}</strong></div>; }
/** @param {{ icon: React.ElementType, label: string, onClick: () => void, disabled: boolean, secondary?: boolean, danger?: boolean }} props */
function ActionButton({ icon: Icon, label, onClick, disabled, secondary = false, danger = false }) { return <button type="button" onClick={onClick} disabled={disabled} className={`flex items-center justify-center gap-2 rounded-btn px-3 py-3 text-[11px] font-bold uppercase tracking-gov text-white disabled:opacity-60 ${danger ? "bg-brand-danger" : secondary ? "bg-brand-amber" : "bg-brand-green"}`}><Icon className="h-4 w-4" />{label}</button>; }