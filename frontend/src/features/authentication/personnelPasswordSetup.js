// frontend/src/features/authentication/personnelPasswordSetup.js
export const isManagedPersonnelSession = (session) => session?.user?.app_metadata?.personnel_managed === true;

// Handles resolvePasswordSetup logic.
export async function resolvePasswordSetup(session, loadStatus, { knownRequired = false } = {}) {
  if (!session?.user?.id || !session.access_token) throw new Error("Your password-reset session is missing or expired.");
  let requiresSetup = knownRequired;
  try {
    const result = await loadStatus(session.access_token);
    if (result?.setupRequired === true || isManagedPersonnelSession(session)) {
      requiresSetup = true;
      if (!["pending", "approved", "rejected"].includes(result.approvalStatus)
        || typeof result.activationRequested !== "boolean" || typeof result.suspended !== "boolean" || typeof result.active !== "boolean") {
        throw new Error("The server did not confirm the account's approval and activation requirements.");
      }
    }
    if (typeof result?.setupRequired !== "boolean") throw new Error("The server did not confirm the account's password-setup requirements.");
    return result;
  } catch (error) {
    // Only ordinary accounts can retain the legacy reset flow during an outage.
    if (requiresSetup || isManagedPersonnelSession(session) || [401, 403].includes(error?.status)) throw error;
    return { setupRequired: false };
  }
}

export const passwordWasSaved = (error) => error?.passwordSaved === true || error?.payload?.data?.passwordSaved === true;

export const personnelSetupBlocked = (status) => status?.setupRequired === true && (status.approvalStatus !== "approved" || status.suspended === true);

export const personnelPasswordRequirements = (password = "") => {
  const value = typeof password === "string" ? password : String(password ?? "");
  return [
    { key: "minLength", label: "At least 8 characters", valid: value.length >= 8 },
    { key: "maxLength", label: "No more than 200 characters", valid: value.length <= 200 },
    { key: "uppercase", label: "At least one uppercase letter (A–Z)", valid: /[A-Z]/.test(value) },
    { key: "lowercase", label: "At least one lowercase letter (a–z)", valid: /[a-z]/.test(value) },
    { key: "number", label: "At least one number (0–9)", valid: /[0-9]/.test(value) },
    { key: "special", label: "At least one special character (!, @, #, $, %, etc.)", valid: /[^A-Za-z0-9\s]/.test(value) },
    { key: "noWhitespace", label: "No whitespace characters", valid: !/\s/.test(value) },
  ];
};

// Handles personnelPasswordError logic.
export function personnelPasswordError(password) {
  if (personnelPasswordRequirements(password).some(({ valid }) => !valid)) {
    return "Use 8 to 200 characters with uppercase, lowercase, a number, a special character, and no whitespace.";
  }
  return "";
}

// Handles personnelSetupOutcome logic.
export function personnelSetupOutcome(result) {
  if (result?.passwordSaved !== true || result?.setupComplete !== true || typeof result.active !== "boolean"
    || !["pending", "approved", "rejected"].includes(result.approvalStatus) || typeof result.activationRequested !== "boolean"
    || (result.active && (result.approvalStatus !== "approved" || result.activationRequested !== true))) {
    const error = Object.assign(new Error(result?.message || "The server did not confirm complete account setup. Your account may still be inactive."), { passwordSaved: result?.passwordSaved === true });
    throw error;
  }
  if (result.active && result.approvalStatus === "approved") {
    return { title: "Password Setup Complete", message: "Your password has been saved and your approved account is active. You can now log in using your new password." };
  }
  if (result.approvalStatus === "approved" && result.activationRequested === false) {
    return { title: "Password Setup Complete", message: "Your password has been saved and your account is approved, but activation is withheld. An administrator must activate your account before you can sign in." };
  }
  return { title: "Password Setup Complete", message: "Your password has been saved, but your account is not active. An administrator must review its approval or activation before you can sign in." };
}

// Handles saveResetPassword logic.
export async function saveResetPassword({ session, password, setupStatus, passwordPreviouslySaved = false, recoverySecret = null, auth, personnelSetup, activateResident }) {
  if (!session?.user?.id || (!session.access_token && !recoverySecret)) throw new Error("Your password-reset session is missing or expired.");
  if (setupStatus?.setupRequired === true) {
    if (personnelSetupBlocked(setupStatus)) throw new Error("Account setup is on hold until an administrator reviews approval or suspension.");
    const passwordError = personnelPasswordError(password);
    if (passwordError) throw new Error(passwordError);
    const result = setupStatus.mustChangePassword === true
      ? await personnelSetup(password, session.access_token, recoverySecret)
      : await personnelSetup(password, session.access_token);
    return personnelSetupOutcome(result);
  }
  if (setupStatus?.setupRequired !== false) throw new Error("Password-setup requirements have not been verified. Try checking your link again.");
  if (passwordPreviouslySaved && isManagedPersonnelSession(session)) {
    return personnelSetupOutcome({ ...setupStatus, passwordSaved: true, setupComplete: true });
  }
  const { error } = await auth.updateUser({ password });
  if (error) throw error;
  try {
    await activateResident();
  } catch {
    // Existing resident activation is also recoverable through verification.
  }
  if (["pending", "approved", "rejected"].includes(setupStatus.approvalStatus)) {
    return { ...personnelSetupOutcome({ ...setupStatus, passwordSaved: true, setupComplete: true }), title: "Password Updated Successfully" };
  }
  return { title: "Password Updated Successfully", message: "Your password has been changed successfully. You can now log in using your new password." };
}
