import assert from "node:assert/strict";
import test from "node:test";
import {
  isManagedPersonnelSession, resolvePasswordSetup, saveResetPassword, personnelSetupOutcome, passwordWasSaved, personnelSetupBlocked, personnelPasswordError,
} from "../../src/features/authentication/personnelPasswordSetup.js";

const session = (managed = true) => ({
  access_token: "isolated-session-token",
  user: { id: "own-profile", app_metadata: { personnel_managed: managed } },
});
const complete = (patch = {}) => ({ passwordSaved: true, setupComplete: true, active: true, approvalStatus: "approved", activationRequested: true, ...patch });
const setup = (patch = {}) => ({ setupRequired: true, approvalStatus: "approved", activationRequested: true, suspended: false, active: false, ...patch });

const dependencies = () => {
  const calls = [];
  return {
    calls,
    auth: { updateUser: async (payload) => { calls.push(["ordinary", payload]); return { error: null }; } },
    personnelSetup: async (...args) => { calls.push(["personnel", ...args]); return complete(); },
    activateResident: async () => { calls.push(["residentActivation"]); },
  };
};

test("only trusted app metadata marks a managed personnel session", () => {
  assert.equal(isManagedPersonnelSession(session()), true);
  assert.equal(isManagedPersonnelSession(session(false)), false);
  assert.equal(isManagedPersonnelSession({ user: { user_metadata: { personnel_managed: true } } }), false);
});

test("managed personnel setup fails closed during a server outage or malformed response", async () => {
  await assert.rejects(resolvePasswordSetup(session(), async () => { throw new Error("Service unavailable"); }), /Service unavailable/);
  await assert.rejects(resolvePasswordSetup(session(), async () => ({})), /did not confirm/);
  await assert.rejects(resolvePasswordSetup(null, async () => ({ setupRequired: false })), /missing or expired/);
});

test("ordinary resident reset can retain the legacy flow during an outage, but not after rejection", async () => {
  assert.deepEqual(await resolvePasswordSetup(session(false), async () => { throw new Error("Service unavailable"); }), { setupRequired: false });
  for (const status of [401, 403]) {
    await assert.rejects(resolvePasswordSetup(session(false), async () => { throw Object.assign(new Error("Rejected session"), { status }); }), /Rejected session/);
  }
});

test("setup requirements are fetched using the real session bearer", async () => {
  const tokens = [];
  const result = await resolvePasswordSetup(session(), async (token) => { tokens.push(token); return setup(); });
  assert.deepEqual(tokens, ["isolated-session-token"]);
  assert.equal(result.setupRequired, true);
});

test("personnel setup uses the server own-account password endpoint, never updateUser or resident activation", async () => {
  const deps = dependencies();
  const result = await saveResetPassword({ ...deps, session: session(), password: "ValidPassword1!", setupStatus: setup() });
  assert.deepEqual(deps.calls, [["personnel", "ValidPassword1!", "isolated-session-token"]]);
  assert.match(result.message, /approved account is active/);
});

test("existing completed personnel and resident resets keep their ordinary Supabase password flow", async () => {
  for (const managed of [false, true]) {
    const deps = dependencies();
    await saveResetPassword({ ...deps, session: session(managed), password: "ValidPassword1!", setupStatus: { setupRequired: false } });
    assert.deepEqual(deps.calls, [["ordinary", { password: "ValidPassword1!" }], ["residentActivation"]]);
  }
});

test("resident activation stays best-effort after a genuine ordinary password save", async () => {
  const deps = dependencies();
  const result = await saveResetPassword({ ...deps, activateResident: async () => { throw new Error("Resident activation unavailable"); }, session: session(false), password: "ValidPassword1!", setupStatus: { setupRequired: false } });
  assert.match(result.message, /password has been changed successfully/);
  deps.auth.updateUser = async () => ({ error: new Error("Password rejected") });
  await assert.rejects(saveResetPassword({ ...deps, session: session(false), password: "Invalid", setupStatus: { setupRequired: false } }), /Password rejected/);
});

test("HTTP 200 password-saved partial finalization is not a completed setup", async () => {
  const deps = dependencies();
  deps.personnelSetup = async () => complete({ setupComplete: false, active: false, message: "Password saved; activation finalization failed." });
  await assert.rejects(saveResetPassword({ ...deps, session: session(), password: "ValidPassword1!", setupStatus: setup() }), (error) => {
    assert.equal(passwordWasSaved(error), true);
    assert.match(error.message, /finalization failed/);
    return true;
  });
  assert.deepEqual(deps.calls, []);
});

test("known required setup never falls back to ordinary reset even for a legacy session during an outage", async () => {
  await assert.rejects(resolvePasswordSetup(session(false), async () => { throw new Error("Service unavailable"); }, { knownRequired: true }), /Service unavailable/);
  await assert.rejects(resolvePasswordSetup(session(false), async () => ({ setupRequired: true })), /approval and activation/);
});

test("pending, rejected, or suspended setup cannot mutate a password", async () => {
  const deps = dependencies();
  for (const status of [setup({ approvalStatus: "pending" }), setup({ approvalStatus: "rejected" }), setup({ suspended: true })]) {
    assert.equal(personnelSetupBlocked(status), true);
    await assert.rejects(saveResetPassword({ ...deps, session: session(), password: "ValidPassword1!", setupStatus: status }), /on hold/);
  }
  assert.deepEqual(deps.calls, []);
});

test("new personnel setup matches the server's stronger policy without changing ordinary reset policy", () => {
  assert.equal(personnelPasswordError("ValidPassword1!"), "");
  for (const password of ["short1!", "UPPERCASE1!", "lowercase1!", "NoDigitsHere!", "NoSpecial1 ", "A1!".repeat(70)]) assert.match(personnelPasswordError(password), /8 to 200 characters/);
});

test("a saved-password retry can finish from newly verified completed setup without changing the password again", async () => {
  const deps = dependencies();
  const result = await saveResetPassword({ ...deps, session: session(), password: "ValidPassword1!", passwordPreviouslySaved: true, setupStatus: { ...setup(), setupRequired: false, active: false, activationRequested: false } });
  assert.deepEqual(deps.calls, []);
  assert.match(result.message, /activation is withheld/);
});

test("ordinary managed-account recovery reports known inactive access without activating staff", async () => {
  const deps = dependencies();
  const result = await saveResetPassword({ ...deps, session: session(), password: "ValidPassword1!", setupStatus: { ...setup(), setupRequired: false, active: false, activationRequested: false } });
  assert.deepEqual(deps.calls, [["ordinary", { password: "ValidPassword1!" }], ["residentActivation"]]);
  assert.match(result.message, /activation is withheld/);
  assert.doesNotMatch(result.message, /can now log in/);
});

test("password-saved error envelopes are recognized without treating an unsaved failure as success", () => {
  assert.equal(passwordWasSaved({ payload: { data: { passwordSaved: true } } }), true);
  assert.equal(passwordWasSaved({ payload: { data: { passwordSaved: false } } }), false);
  assert.throws(() => personnelSetupOutcome({ passwordSaved: true, setupComplete: false }), (error) => passwordWasSaved(error));
  assert.throws(() => personnelSetupOutcome({ passwordSaved: false, setupComplete: false }), (error) => !passwordWasSaved(error));
  assert.throws(() => personnelSetupOutcome(complete({ approvalStatus: "rejected", active: true })), (error) => passwordWasSaved(error));
  assert.throws(() => personnelSetupOutcome(complete({ activationRequested: false, active: true })), (error) => passwordWasSaved(error));
});

test("successful setup distinguishes an active account from approved activation-withheld and other inactive states", () => {
  assert.match(personnelSetupOutcome(complete()).message, /can now log in/);
  const withheld = personnelSetupOutcome(complete({ active: false, activationRequested: false }));
  assert.match(withheld.message, /activation is withheld/);
  assert.doesNotMatch(withheld.message, /can now log in/);
  for (const approvalStatus of ["pending", "rejected"]) {
    const inactive = personnelSetupOutcome(complete({ active: false, approvalStatus }));
    assert.match(inactive.message, /not active/);
    assert.doesNotMatch(inactive.message, /account is approved|can now log in/);
  }
});

test("no password mutation is attempted without verified setup requirements", async () => {
  const deps = dependencies();
  await assert.rejects(saveResetPassword({ ...deps, session: session(), password: "ValidPassword1!", setupStatus: null }), /not been verified/);
  assert.deepEqual(deps.calls, []);
});

test("a managed orphan or incomplete lifecycle cannot bypass setup through an ordinary false status", async () => {
  await assert.rejects(resolvePasswordSetup(session(), async () => ({ setupRequired: false, approvalStatus: null, activationRequested: false, suspended: false, active: false })), /approval and activation/);
  const completed = { ...setup(), setupRequired: false, active: true };
  assert.deepEqual(await resolvePasswordSetup(session(), async () => completed), completed, "verified completed personnel retain ordinary recovery");
});
