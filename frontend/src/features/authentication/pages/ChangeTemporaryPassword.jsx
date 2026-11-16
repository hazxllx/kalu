import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Eye, EyeOff, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { authApi } from "@/services/api";
import { homeForRole, landingFor } from "@/lib/roles";
import { personnelPasswordError } from "@/features/authentication/personnelPasswordSetup";

const REQUIREMENTS = [
  ["length", "8 to 200 characters", (value) => value.length >= 8 && value.length <= 200],
  ["uppercase", "At least one uppercase letter", (value) => /[A-Z]/.test(value)],
  ["lowercase", "At least one lowercase letter", (value) => /[a-z]/.test(value)],
  ["number", "At least one number", (value) => /\d/.test(value)],
  ["special", "At least one non-whitespace special character", (value) => /[^A-Za-z0-9\s]/.test(value)],
];

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

  const requirements = useMemo(
    () => Object.fromEntries(REQUIREMENTS.map(([key, , check]) => [key, check(password)])),
    [password],
  );
  const allRequirementsMet = Object.values(requirements).every(Boolean);

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
    <main className="flex min-h-dvh items-center justify-center bg-brand-bg px-4 py-8">
      <section className="w-full max-w-lg rounded-2xl border border-brand-border bg-white p-6 shadow-card sm:p-8" aria-labelledby="change-password-title">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-brand-blue/10 text-brand-blue">
          <ShieldCheck className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 id="change-password-title" className="text-2xl font-semibold text-brand-ink">Create Your Permanent Password</h1>
        <p className="mt-2 text-sm leading-relaxed text-brand-gray">
          Your administrator provided a temporary password. For your security, create a new password before continuing to your account.
        </p>

        {status === "checking" && <p role="status" className="mt-6 flex items-center gap-2 text-sm text-brand-gray"><Loader2 className="h-4 w-4 animate-spin" /> Checking your password-change status...</p>}
        {status === "blocked" && (
          <div className="mt-6 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Your account must be approved and not suspended before you can create a permanent password. Your administrator will need to complete the account review.</span>
          </div>
        )}
        {status === "error" && (
          <div className="mt-6 flex items-start gap-2 rounded-lg border border-brand-danger/30 bg-brand-danger/5 p-3 text-sm text-brand-danger" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span>
          </div>
        )}
        {success && <div role="status" className="mt-5 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><span>{success}</span></div>}
        {error && status !== "error" && <div role="alert" className="mt-5 flex items-start gap-2 rounded-lg border border-brand-danger/30 bg-brand-danger/5 p-3 text-sm text-brand-danger"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}

        {status === "ready" && (
          <form onSubmit={submit} className="mt-6 space-y-5">
            <div>
              <label htmlFor="permanent-password" className="text-sm font-medium text-brand-ink">New Password</label>
              <div className="mt-1 flex rounded-btn border border-slate-200 focus-within:border-brand-blue">
                <input
                  id="permanent-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => { setPassword(event.target.value); setError(""); }}
                  disabled={busy}
                  className="w-full rounded-l-btn px-3 py-2.5 text-sm outline-none"
                  required
                />
                <button type="button" aria-label={showPassword ? "Hide new password" : "Show new password"} onClick={() => setShowPassword((value) => !value)} className="px-3 text-brand-gray">
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <ul className="mt-2 space-y-1 text-xs" aria-label="Password requirements">
                {REQUIREMENTS.map(([key, label]) => (
                  <li key={key} className={requirements[key] ? "text-emerald-700" : "text-brand-gray"}>
                    <span aria-hidden="true">{requirements[key] ? "✓" : "•"} </span>{label}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <label htmlFor="confirm-permanent-password" className="text-sm font-medium text-brand-ink">Confirm New Password</label>
              <div className="mt-1 flex rounded-btn border border-slate-200 focus-within:border-brand-blue">
                <input
                  id="confirm-permanent-password"
                  type={showConfirmation ? "text" : "password"}
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(event) => { setConfirmation(event.target.value); setError(""); }}
                  disabled={busy}
                  className="w-full rounded-l-btn px-3 py-2.5 text-sm outline-none"
                  required
                />
                <button type="button" aria-label={showConfirmation ? "Hide confirmation password" : "Show confirmation password"} onClick={() => setShowConfirmation((value) => !value)} className="px-3 text-brand-gray">
                  {showConfirmation ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {confirmation && <p className={`mt-1 text-xs ${password === confirmation ? "text-emerald-700" : "text-brand-danger"}`}>{password === confirmation ? "Passwords match." : "Passwords do not match."}</p>}
            </div>

            <button type="submit" disabled={busy || !allRequirementsMet || !password || !confirmation || password !== confirmation} className="flex w-full items-center justify-center gap-2 rounded-btn bg-brand-blue px-4 py-3 text-sm font-semibold text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60">
              {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving password...</> : <><KeyRound className="h-4 w-4" /> Save Permanent Password</>}
            </button>
          </form>
        )}
        {status === "inactive" && <button type="button" onClick={signOut} className="mt-5 rounded-btn bg-brand-blue px-4 py-2.5 text-sm font-semibold text-white">Sign out</button>}
        {(status === "error" || status === "blocked") && <button type="button" onClick={signOut} className="mt-5 rounded-btn border border-slate-200 px-4 py-2.5 text-sm font-medium text-brand-ink">Sign out</button>}
        {accountStatus?.approvalStatus && <p className="mt-5 text-xs text-brand-gray">Account approval status: {accountStatus.approvalStatus.replace(/_/g, " ")}.</p>}
      </section>
    </main>
  );
}
