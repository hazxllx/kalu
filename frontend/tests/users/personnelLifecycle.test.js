import assert from "node:assert/strict";
import test from "node:test";
import {
  PERSONNEL_ROLES, isPersonnelRole, personnelState, notificationMeta, legacyApprovalMessage, auditActorLabel,
  canRetryPersonnelEmail, personnelActions, personnelActionMessage, personnelOperation, personnelCreationOperation, clearPersonnelCreationOperation,
  stationAssignmentPatch, stationAssignmentError, coverageAssignmentPatch, lifecyclePayload,
} from "../../src/features/users/personnelLifecycle.js";

const approved = (patch = {}) => ({
  id: "personnel-1", role: "rhu_personnel", status: "disabled", approvalStatus: "approved",
  setupRequired: true, activationRequested: true, suspendedAt: null, notification: null, ...patch,
});
const admin = { isAdmin: true, canApprove: true, canDeactivate: true, canResetAccess: true };
const stations = [{ id: "triage", name: "Triage" }, { id: "consultation", name: "Consultation" }];

test("health personnel roles exclude administrator and resident identities", () => {
  assert.deepEqual(PERSONNEL_ROLES, ["mho", "phn", "health_supervisor", "rhu_personnel", "bhw"]);
  for (const role of PERSONNEL_ROLES) assert.equal(isPersonnelRole(role), true);
  for (const role of ["admin", "resident", "resident-limited", null]) assert.equal(isPersonnelRole(role), false);
  assert.equal(personnelState({ role: "resident", approvalStatus: null, status: "active" }), null);
});

test("lifecycle precedence never treats approval or a raw active status as completed setup", () => {
  assert.equal(personnelState(approved({ approvalStatus: "pending", status: "active" })), "pending");
  assert.equal(personnelState(approved({ approvalStatus: "rejected", suspendedAt: "2026-10-31T00:00:00Z" })), "rejected");
  assert.equal(personnelState(approved({ suspendedAt: "2026-10-31T00:00:00Z" })), "suspended");
  assert.equal(personnelState(approved({ status: "active" })), "awaiting_setup");
  assert.equal(personnelState(approved({ setupRequired: false, status: "active" })), "active");
  assert.equal(personnelState(approved({ setupRequired: false, activationRequested: false })), "approved_inactive");
  assert.equal(personnelState(approved({ setupRequired: false, status: "active", activationRequested: false })), "approved_inactive");
  assert.equal(personnelState(approved({ setupRequired: false, status: "active", activationRequested: undefined })), "unknown");
  assert.equal(personnelState(approved({ setupRequired: undefined, status: "active" })), "unknown");
  assert.equal(personnelState(approved({ approvalStatus: null })), "unknown");
});

test("sent means mail-server acceptance, never inbox delivery", () => {
  const meta = notificationMeta({ status: "sent" });
  assert.equal(meta.label, "Accepted by mail server");
  assert.match(meta.message, /does not confirm delivery/);
  assert.equal(canRetryPersonnelEmail(approved({ notification: { status: "sent" } })), false);
});

test("only definitive failed email is safe to retry and unknown outcomes require review", () => {
  assert.equal(canRetryPersonnelEmail(approved({ notification: { status: "failed" } })), true);
  for (const status of ["pending", "processing", "sending", "sent", "delivery_unknown", "cancelled", "unrecognized"]) {
    assert.equal(canRetryPersonnelEmail(approved({ notification: { status } })), false, status);
  }
  assert.equal(canRetryPersonnelEmail(approved()), false);
  assert.match(notificationMeta({ status: "delivery_unknown" }).message, /Manual review.*retry is disabled/);
  assert.match(notificationMeta({ status: "pending" }).message, /not yet been accepted/);
  assert.match(notificationMeta({ status: "unrecognized" }).message, /No delivery or safe retry is inferred/);
});

test("approval and rejection require admin authority and never permit self-approval", () => {
  const pending = approved({ approvalStatus: "pending" });
  assert.deepEqual(personnelActions(pending, admin), ["approve", "reject"]);
  assert.deepEqual(personnelActions(pending, { ...admin, isSelf: true }), []);
  assert.deepEqual(personnelActions(pending, { ...admin, isAdmin: false }), []);
  assert.deepEqual(personnelActions(pending, { ...admin, canApprove: false }), []);
  assert.deepEqual(personnelActions({ ...pending, role: "resident" }, admin), []);
  assert.deepEqual(personnelActions({ role: "admin", status: "active", approvalStatus: null }, admin), []);
  assert.deepEqual(personnelActions(approved({ approvalStatus: null }), admin), []);
});

test("general administrator accounts use lifecycle controls only when the server supplies managed lifecycle state", () => {
  assert.equal(personnelState({ role: "admin", status: "active", approvalStatus: null }), null);
  assert.equal(isPersonnelRole("admin"), false);
  assert.deepEqual(personnelActions(approved({ role: "admin", approvalStatus: "pending" }), admin), ["approve", "reject"]);
  assert.deepEqual(personnelActions(approved({ role: "admin" }), { ...admin, isSelf: true }), ["invite"]);
});

test("legacy approval feedback needs verified server state to claim sign-in availability", () => {
  assert.match(legacyApprovalMessage("Health Worker", { active: true, profileStatus: "active" }), /Verified account access is active/);
  assert.match(legacyApprovalMessage("Health Worker", { active: false, profileStatus: "disabled" }), /remains inactive/);
  assert.match(legacyApprovalMessage("Health Worker", {}), /verify activation/);
  assert.doesNotMatch(legacyApprovalMessage("Health Worker", { active: true, profileStatus: "disabled" }), /access is active/);
});

test("rejected staff can be reconsidered without re-registration, but never by the account owner", () => {
  const rejected = approved({ approvalStatus: "rejected" });
  assert.deepEqual(personnelActions(rejected, admin), ["approve"]);
  assert.deepEqual(personnelActions(rejected, { ...admin, canApprove: false }), []);
  assert.deepEqual(personnelActions(rejected, { ...admin, isSelf: true }), []);
});

test("audit actors prefer immutable name snapshots and survive deleted administrator profiles", () => {
  assert.equal(auditActorLabel({ actorId: null, actorName: null, metadata: { actor: { id: "deleted-admin", name: "Recorded Administrator" } } }), "Recorded Administrator");
  assert.equal(auditActorLabel({ actorId: "live-admin", actorName: "Current Name", metadata: { actor: { name: "Historical Name" } } }), "Historical Name");
  assert.equal(auditActorLabel({ actorId: "legacy-admin", actorName: "Legacy Administrator", metadata: {} }), "Legacy Administrator");
  assert.equal(auditActorLabel({ actorId: null, metadata: { actor: { id: "deleted-admin" } } }), "deleted-admin");
  assert.equal(auditActorLabel({ actorId: null, metadata: {} }), "Not recorded");
  assert.equal(auditActorLabel({ actorId: null, metadata: { performed_by: "personnel_notification_worker", actor: { name: "Requesting Administrator" } } }), "System notification worker", "initiator must not be misreported as the system performer");
});

test("approved accounts can be suspended before setup and reactivation never implies setup", () => {
  assert.deepEqual(personnelActions(approved(), admin), ["suspend", "reactivate", "invite"]);
  assert.deepEqual(personnelActions(approved({ suspendedAt: "2026-10-31T00:00:00Z" }), admin), ["reactivate"]);
  assert.deepEqual(personnelActions(approved({ setupRequired: false, status: "active" }), admin), ["suspend"]);
  assert.deepEqual(personnelActions(approved({ setupRequired: false, status: "active" }), { ...admin, isSelf: true }), []);
  assert.deepEqual(lifecyclePayload("reactivate", { activate: false }), { action: "reactivate", activate: false });
});

test("new invitations are explicit and cannot duplicate an in-progress or uncertain email", () => {
  for (const status of ["pending", "processing", "sending", "delivery_unknown", "unrecognized"]) {
    const actions = personnelActions(approved({ notification: { status } }), admin);
    assert.equal(actions.includes("invite"), false, status);
    assert.equal(actions.includes("retry_email"), false, status);
  }
  const sentActions = personnelActions(approved({ notification: { status: "sent" } }), admin);
  assert.equal(sentActions.includes("invite"), true, "sent email may be replaced only through an explicit new invitation");
  assert.equal(sentActions.includes("retry_email"), false);
  const failedActions = personnelActions(approved({ notification: { status: "failed" } }), admin);
  assert.equal(failedActions.includes("retry_email"), true);
  assert.equal(personnelActions(approved({ setupRequired: false }), admin).includes("invite"), false);
  assert.equal(personnelActions(approved({ approvalStatus: "pending" }), admin).includes("invite"), false);
});

test("reject and suspend require reasons and approval can withhold activation", () => {
  for (const action of ["reject", "suspend"]) assert.throws(() => lifecyclePayload(action, { reason: "  " }), /reason is required/);
  assert.deepEqual(lifecyclePayload("reject", { reason: "  Assignment not authorized.  " }), { action: "reject", reason: "Assignment not authorized." });
  assert.deepEqual(lifecyclePayload("approve", { activate: false }), { action: "approve", activate: false });
  assert.throws(() => lifecyclePayload("delete"), /supported personnel action/);
});

test("station assignments require a valid RHU station but are optional for Health Supervisors", () => {
  assert.match(stationAssignmentError("rhu_personnel", [], stations), /at least one/);
  assert.match(stationAssignmentError("rhu_personnel", ["unknown"], stations), /valid RHU station/);
  assert.equal(stationAssignmentError("rhu_personnel", ["triage"], stations), "");
  assert.equal(stationAssignmentError("health_supervisor", [], stations), "");
  assert.equal(stationAssignmentError("health_supervisor", ["consultation"], stations), "");
  for (const role of ["mho", "phn", "bhw"]) assert.deepEqual(stationAssignmentPatch(role, ["triage"], null), { rhuStations: [] });
});

test("unrelated edits preserve omitted, existing, and legacy stations and coverage", () => {
  assert.deepEqual(stationAssignmentPatch("rhu_personnel", [], { roleId: "rhu_personnel" }), {});
  assert.equal(stationAssignmentError("rhu_personnel", [], [], { roleId: "rhu_personnel" }), "");
  assert.deepEqual(stationAssignmentPatch("phn", ["legacy"], { roleId: "phn", rhuStations: ["legacy"] }), {});
  assert.deepEqual(stationAssignmentPatch("health_supervisor", [], { roleId: "health_supervisor", rhuStations: ["triage"] }), { rhuStations: [] });
  const existing = { roleId: "health_supervisor", municipalityId: "m1", barangayId: "historic-b1" };
  const unchanged = { municipalityId: "m1", barangayId: "historic-b1", facilityId: null };
  assert.deepEqual(coverageAssignmentPatch("health_supervisor", unchanged, existing), {});
  assert.deepEqual(coverageAssignmentPatch("health_supervisor", { ...unchanged, barangayId: "b2" }, existing), { barangayId: "b2" });
  assert.deepEqual(coverageAssignmentPatch("bhw", unchanged, existing), unchanged);
});

test("operation UUIDs remain stable across an identical retry, but change for a new decision", () => {
  const first = personnelOperation(null, { action: "approve", activate: true });
  assert.match(first.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(personnelOperation(first, { action: "approve", activate: true }), first);
  assert.notEqual(personnelOperation(first, { action: "approve", activate: false }).id, first.id);
});

test("creation feedback reports returned setup and email states without pretending an invitation was sent", () => {
  const message = personnelActionMessage("create", approved({ activationRequested: false, notification: { status: "pending" } }));
  assert.match(message, /must finish password setup/);
  assert.match(message, /Activation is withheld/);
  assert.match(message, /Email is queued/);
  assert.doesNotMatch(message, /Invitation sent|now active/);
  assert.match(personnelActionMessage("invite", null), /check its current state/);
});

const operationStorage = () => {
  const values = new Map();
  return { values, getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
};

test("creation request UUID survives dialog or page reload using only an actor-bound payload hash", async () => {
  const storage = operationStorage();
  const first = await personnelCreationOperation(null, { name: "Test Personnel", email: "worker@example.test", role: "rhu_personnel", rhuStations: ["triage", "consultation"], activate: true }, "admin-a", { storage });
  const reloaded = await personnelCreationOperation(null, { activate: true, rhuStations: ["consultation", "triage"], role: "rhu_personnel", email: " WORKER@EXAMPLE.TEST ", name: "Test Personnel" }, "admin-a", { storage });
  assert.equal(first.persistent, true);
  assert.equal(reloaded.id, first.id);
  assert.match(first.storageKey, /^kalusagap:managed-create:v1:admin-a:[0-9a-f]{64}$/);
  for (const [key, value] of storage.values) {
    assert.doesNotMatch(`${key}:${value}`, /Test Personnel|worker@example.test|rhu_personnel|consultation/);
    assert.equal(value, first.id);
  }
});

test("creation references never cross actors or adopt an existing email after a changed decision", async () => {
  const storage = operationStorage();
  const payload = { name: "Test Personnel", email: "worker@example.test", role: "phn", activate: true };
  const first = await personnelCreationOperation(null, payload, "admin-a", { storage });
  const otherActor = await personnelCreationOperation(first, payload, "admin-b", { storage });
  const changed = await personnelCreationOperation(first, { ...payload, activate: false }, "admin-a", { storage });
  assert.notEqual(otherActor.id, first.id);
  assert.notEqual(changed.id, first.id);
  assert.equal(storage.values.get(first.storageKey), first.id);
  assert.equal(clearPersonnelCreationOperation(changed, { storage }), true);
  assert.equal(storage.values.get(first.storageKey), first.id, "another unfinished creation must not be cleared");
  assert.equal(clearPersonnelCreationOperation(first, { storage }), true);
  assert.equal(storage.values.has(first.storageKey), false);
});

test("blocked storage or unavailable hashing retains stable in-memory creation retries", async () => {
  const blocked = { getItem: () => { throw new Error("Storage blocked"); } };
  const payload = { name: "Test Personnel", email: "worker@example.test", role: "phn" };
  const first = await personnelCreationOperation(null, payload, "admin-a", { storage: blocked });
  const retried = await personnelCreationOperation(first, payload, "admin-a", { storage: blocked });
  assert.equal(first.persistent, false);
  assert.equal(retried.id, first.id);
  const noHash = await personnelCreationOperation(retried, payload, "admin-a", { storage: operationStorage(), crypto: { subtle: { digest: async () => { throw new Error("Hash unavailable"); } } } });
  assert.equal(noHash.persistent, false);
  assert.equal(noHash.id, first.id);
  assert.equal(clearPersonnelCreationOperation(noHash, { storage: blocked }), false);
});

test("a storage write failure preserves the in-memory CREATE UUID without persisting personnel data", async () => {
  const storage = operationStorage();
  storage.setItem = () => { throw new Error("QuotaExceededError"); };
  const payload = { name: "Test Personnel", email: "worker@example.test", role: "phn", activate: false };
  const first = await personnelCreationOperation(null, payload, "admin-a", { storage });
  const retry = await personnelCreationOperation(first, payload, "admin-a", { storage });
  assert.equal(first.persistent, false);
  assert.equal(retry.persistent, false);
  assert.equal(retry.id, first.id);
  assert.equal(storage.values.size, 0);
});

test("creation persistence requires a verified actor and does not trust a malformed cached UUID", async () => {
  const payload = { email: "worker@example.test", role: "phn" };
  await assert.rejects(personnelCreationOperation(null, payload, null, { storage: operationStorage() }), /identity has not been verified/);
  const storage = operationStorage();
  const first = await personnelCreationOperation(null, payload, "admin-a", { storage });
  storage.values.set(first.storageKey, "not-a-safe-operation-id");
  const invalid = await personnelCreationOperation(null, payload, "admin-a", { storage });
  assert.equal(invalid.persistent, false);
  assert.notEqual(invalid.id, "not-a-safe-operation-id");
  assert.equal(storage.values.get(first.storageKey), "not-a-safe-operation-id", "retain unconfirmed state for manual review");
});
