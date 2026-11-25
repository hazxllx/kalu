import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Check, CheckCircle2, Circle, Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { authApi } from "@/services/api";
import { homeForRole, landingFor } from "@/lib/roles";
import { personnelPasswordError, personnelPasswordRequirements } from "@/features/authentication/personnelPasswordSetup";

export default function ChangeTemporaryPassword() {
  const navigate = useNavigate();
  const {
    session, role, isAuthenticated, isLoadingAuth, authChecked,
    isResolvingProfile, refreshProfile, logout,
  } = useAuth();
  const [status, setStatus] = useState("checking");
  const [accountStatus, setAccountStatus] = useState(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isLoadingAuth || !authChecked || isResolvingProfile) return;
    if (!isAuthenticated || !session?.access_token) {
      navigate("/login", { replace: true });
      return;
    }
    let active = true;
    setStatus("checking");
    authApi.personnelSetupStatus(session.access_token)
      .then((result) => {
        if (!active) return;
        setAccountStatus(result);
        if (result?.mustChangePassword !== true) {
          navigate(landingFor(role) || homeForRole(role) || "/login", { replace: true });
        } else {
          setStatus(result.approvalStatus === "approved" && !result.suspended ? "ready" : "blocked");
        }
      })
      .catch((failure) => {
        if (!active) return;
        setError(failure?.message || "Password-change status could not be verified. Please retry.");
        setStatus("error");
      });
    return () => { active = false; };
  }, [authChecked, isAuthenticated, isLoadingAuth, isResolvingProfile, navigate, role, session?.access_token]);

  const requirements = useMemo(() => personnelPasswordRequirements(password), [password]);
  const allRequirementsMet = requirements.every(({ valid }) => valid);

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    const policyError = personnelPasswordError(password);
    if (policyError) { setError(policyError); return; }
    if (password !== confirmation) { setError("The passwords do not match."); return; }
    if (!session?.access_token) { setError("Your session is missing or expired. Sign in again."); return; }

    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const result = await authApi.temporaryPersonnelPasswordChange(password, session.access_token);
      if (result?.passwordChanged !== true) throw new Error("The server did not confirm the password change.");
      setPassword("");
      setConfirmation("");
      if (result.active) {
        const nextRole = await refreshProfile();
        setSuccess("Your permanent password has been saved. Your account is ready.");
        navigate(landingFor(nextRole || role) || homeForRole(nextRole || role), { replace: true });
      } else {
        setSuccess("Your permanent password has been saved, but account activation is still withheld. Contact your administrator before signing in again.");
        setStatus("inactive");
      }
    } catch (failure) {
      setError(failure?.message || "Your password could not be changed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await logout(false);
    navigate("/login", { replace: true });
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-brand-bg px-4 py-6 sm:py-8">
      <div className="w-full max-w-md">
        <header className="mb-5 border-b border-brand-border px-1 pb-4">
          <p className="font-display text-[17px] font-bold leading-tight tracking-[0.03em] text-brand-dark">KALUSAGAP</p>
          <p className="mt-1 text-[10px] font-semibold tracking-[0.16em] text-brand-gray">HEALTH PERSONNEL PORTAL</p>
        </header>

        <section className="rounded-lg border border-brand-border bg-white p-5 shadow-sm sm:p-6" aria-labelledby="change-password-title">
          <div className="mb-3 inline-flex items-center gap-2 border border-brand-blue/20 bg-brand-light px-2.5 py-1 text-[10px] font-bold tracking-[0.12em] text-brand-blue">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-blue" aria-hidden="true" />
            FIRST-TIME ACCOUNT SETUP
          </div>
          <h1 id="change-password-title" className="font-display text-[22px] font-bold leading-tight text-brand-dark">Set up your password</h1>
          <p className="mt-2 text-[13px] leading-5 text-brand-gray">
            Before accessing your account, create a new permanent password.
          </p>

          {status === "checking" && <p role="status" className="mt-4 flex items-center gap-2 text-sm text-brand-gray"><Loader2 className="h-4 w-4 animate-spin" /> Checking your password-change status...</p>}
          {status === "blocked" && (
            <div className="mt-4 flex items-start gap-2 border border-amber-200 bg-amber-50 p-3 text-[13px] leading-5 text-amber-900" role="status">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Your account must be approved and not suspended before you can create a permanent password. Your administrator will need to complete the account review.</span>
            </div>
          )}
          {status === "error" && (
            <div className="mt-4 flex items-start gap-2 border border-brand-danger/30 bg-brand-danger/5 p-3 text-[13px] leading-5 text-brand-danger" role="alert">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span>
            </div>
          )}
          {success && <div role="status" className="mt-4 flex items-start gap-2 border border-emerald-200 bg-emerald-50 p-3 text-[13px] leading-5 text-emerald-800"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><span>{success}</span></div>}
          {error && status !== "error" && <div role="alert" className="mt-4 flex items-start gap-2 border border-brand-danger/30 bg-brand-danger/5 p-3 text-[13px] leading-5 text-brand-danger"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}

          {status === "ready" && (
            <form onSubmit={submit} className="mt-5 space-y-4">
              <div>
                <label htmlFor="permanent-password" className="text-[13px] font-semibold text-brand-ink">New Password</label>
                <div className="mt-1 flex rounded-input border border-brand-border bg-white focus-within:border-brand-blue focus-within:ring-2 focus-within:ring-brand-blue/15">
                  <input
                    id="permanent-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => { setPassword(event.target.value); setError(""); }}
                    disabled={busy}
                    className="min-w-0 w-full rounded-l-input bg-transparent px-3 py-2.5 text-sm text-brand-ink outline-none"
                    required
                  />
                  <button type="button" aria-label={showPassword ? "Hide new password" : "Show new password"} aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)} className="flex shrink-0 items-center justify-center px-3 text-brand-gray hover:text-brand-dark">
                    {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                  </button>
                </div>
                <ul className="mt-2 grid grid-cols-1 gap-1 text-[11px] leading-4 sm:grid-cols-2" aria-label="Password requirements" aria-live="polite">
                {requirements.map(({ key, label, valid }) => (
                    <li key={key} className={`flex items-center gap-1.5 ${valid ? "text-emerald-700" : "text-brand-gray"}`}>
                      {valid ? <Check className="h-3 w-3 shrink-0" aria-hidden="true" /> : <Circle className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />}
                      {label}
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <label htmlFor="confirm-permanent-password" className="text-[13px] font-semibold text-brand-ink">Confirm Password</label>
                <div className="mt-1 flex rounded-input border border-brand-border bg-white focus-within:border-brand-blue focus-within:ring-2 focus-within:ring-brand-blue/15">
                  <input
                    id="confirm-permanent-password"
                    type={showConfirmation ? "text" : "password"}
                    autoComplete="new-password"
                    value={confirmation}
                    onChange={(event) => { setConfirmation(event.target.value); setError(""); }}
                    disabled={busy}
                    className="min-w-0 w-full rounded-l-input bg-transparent px-3 py-2.5 text-sm text-brand-ink outline-none"
                    required
                  />
                  <button type="button" aria-label={showConfirmation ? "Hide confirmation password" : "Show confirmation password"} aria-pressed={showConfirmation} onClick={() => setShowConfirmation((value) => !value)} className="flex shrink-0 items-center justify-center px-3 text-brand-gray hover:text-brand-dark">
                    {showConfirmation ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                  </button>
                </div>
                {confirmation && <p className={`mt-1 text-xs ${password === confirmation ? "text-emerald-700" : "text-brand-danger"}`} role="status">{password === confirmation ? "Passwords match." : "Passwords do not match."}</p>}
              </div>

              <button type="submit" disabled={busy || !allRequirementsMet || !password || !confirmation || password !== confirmation} className="flex w-full items-center justify-center gap-2 rounded-btn bg-brand-blue px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
                {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving password...</> : <><KeyRound className="h-4 w-4" /> Save new password</>}
              </button>
            </form>
          )}
          {status === "inactive" && <button type="button" onClick={signOut} className="mt-4 rounded-btn bg-brand-blue px-4 py-2.5 text-sm font-semibold text-white">Sign out</button>}
          {(status === "error" || status === "blocked") && <button type="button" onClick={signOut} className="mt-4 rounded-btn border border-brand-border px-4 py-2.5 text-sm font-medium text-brand-ink">Sign out</button>}
          {accountStatus?.approvalStatus && <p className="mt-3 text-xs text-brand-gray">Account approval status: {accountStatus.approvalStatus.replace(/_/g, " ")}.</p>}

          <div className="mt-5 border-t border-brand-border pt-3">
            <p className="text-[11px] leading-4 text-brand-gray">Your account is protected. Your new password replaces your temporary credentials.</p>
          </div>
        </section>
      </div>
    </main>
  );
}
