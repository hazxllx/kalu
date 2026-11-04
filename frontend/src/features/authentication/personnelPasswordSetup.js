export const isManagedPersonnelSession = (session) => session?.user?.app_metadata?.personnel_managed === true;

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

export function personnelPasswordError(password) {
  if (password.length < 8 || password.length > 200 || !/[A-Z]/.test(password) || !/[a-z]/.test(password)
    || !/\d/.test(password) || !/[^A-Za-z0-9\s]/.test(password)) {
    return "Use 8 to 200 characters with an uppercase letter, a lowercase letter, a number, and a non-whitespace special character.";
  }
  return "";
}

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

export async function saveResetPassword({ session, password, setupStatus, passwordPreviouslySaved = false, auth, personnelSetup, activateResident }) {
  if (!session?.user?.id || !session.access_token) throw new Error("Your password-reset session is missing or expired.");
  if (setupStatus?.setupRequired === true) {
    if (personnelSetupBlocked(setupStatus)) throw new Error("Account setup is on hold until an administrator reviews approval or suspension.");
    const passwordError = personnelPasswordError(password);
    if (passwordError) throw new Error(passwordError);
    const result = await personnelSetup(password, session.access_token);
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
