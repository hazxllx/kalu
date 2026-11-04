export const PERSONNEL_ROLES = Object.freeze([
  "mho", "phn", "health_supervisor", "rhu_personnel", "bhw",
]);

export const isPersonnelRole = (role) => PERSONNEL_ROLES.includes(role);

export const PERSONNEL_STATE_META = Object.freeze({
  pending: { label: "Pending approval", tone: "amber", description: "An administrator must review this account before it can be activated." },
  rejected: { label: "Rejected", tone: "rose", description: "Approval was rejected. The account and its history are retained; access is denied." },
  suspended: { label: "Suspended", tone: "rose", description: "Access is suspended. The account and its history are retained." },
  awaiting_setup: { label: "Awaiting password setup", tone: "amber", description: "Approved, but the account owner must finish password setup before sign-in can be enabled." },
  active: { label: "Active", tone: "green", description: "Approved and active. The account can sign in with its existing credentials." },
  approved_inactive: { label: "Approved, inactive", tone: "slate", description: "Approved, but access is inactive. An administrator must authorize activation." },
  unknown: { label: "Lifecycle unavailable", tone: "slate", description: "The server has not supplied a verified personnel lifecycle. No access change is inferred." },
});

export function personnelState(account) {
  const role = account?.roleId || account?.role;
  if (!isPersonnelRole(role) && (role !== "admin" || !["pending", "approved", "rejected"].includes(account?.approvalStatus))) return null;
  if (account.approvalStatus === "pending") return "pending";
  if (account.approvalStatus === "rejected") return "rejected";
  if (account.approvalStatus !== "approved") return "unknown";
  if (account.suspendedAt) return "suspended";
  if (account.setupRequired === true) return "awaiting_setup";
  if (account.setupRequired !== false) return "unknown";
  if (typeof account.activationRequested !== "boolean") return "unknown";
  if ((account.statusId || account.status) === "active" && account.activationRequested) return "active";
  return "approved_inactive";
}

export function notificationMeta(notification) {
  const states = {
    pending: { label: "Email queued", tone: "amber", message: "Email is queued and has not yet been accepted by the mail server." },
    processing: { label: "Preparing email", tone: "amber", message: "Email preparation is in progress. No mail-server acceptance has been confirmed." },
    sending: { label: "Sending email", tone: "amber", message: "The send attempt is in progress. Its outcome has not yet been confirmed." },
    sent: { label: "Accepted by mail server", tone: "green", message: "The mail server accepted this email. This does not confirm delivery to the recipient's inbox." },
    failed: { label: "Email failed", tone: "rose", message: "The email definitively failed before acceptance. An authorized administrator may retry this email safely." },
    delivery_unknown: { label: "Email outcome uncertain", tone: "rose", message: "Mail-server acceptance is uncertain. Manual review is required; retry is disabled to avoid duplicate email." },
    cancelled: { label: "Email cancelled", tone: "slate", message: "This email was cancelled and will not be sent." },
  };
  if (!notification) return { label: "No email recorded", tone: "slate", message: "No notification has been recorded for this account." };
  return states[notification.status] || { label: "Email status unavailable", tone: "slate", message: "The email outcome is not known. Manual review is required. No delivery or safe retry is inferred." };
}

export const canRetryPersonnelEmail = (account) => account?.notification?.status === "failed";

export function personnelActions(account, { isAdmin = false, isSelf = false, canApprove = false, canDeactivate = false, canResetAccess = false } = {}) {
  if (!isAdmin) return [];
  const state = personnelState(account);
  if (!state || state === "unknown") return [];
  const actions = [];
  if (canApprove && !isSelf) {
    if (state === "pending") actions.push("approve", "reject");
    else if (state === "rejected") actions.push("approve");
  }
  if (account.approvalStatus === "approved" && canDeactivate && !isSelf) {
    if (state !== "suspended") actions.push("suspend");
    if (state !== "active") actions.push("reactivate");
  }
  if (canResetAccess) {
    const emailStatus = account.notification?.status;
    const newInviteAllowed = !account.notification || ["sent", "failed", "cancelled"].includes(emailStatus);
    if (account.approvalStatus === "approved" && account.setupRequired === true && !account.suspendedAt && newInviteAllowed) actions.push("invite");
    if (canRetryPersonnelEmail(account)) actions.push("retry_email");
  }
  return actions;
}

export function personnelActionMessage(action, account) {
  const prefix = {
    create: isPersonnelRole(account?.roleId || account?.role) ? "Personnel account created." : "Staff account created.", approve: "Approval recorded.", reject: "Rejection recorded.",
    suspend: "Suspension recorded.", reactivate: "Activation choice recorded.",
    invite: "New invitation requested.", retry_email: "Email retry requested.",
  }[action] || "Personnel account updated.";
  if (!account) return `${prefix} Refresh the account to check its current state.`;
  const state = personnelState(account);
  const activation = account.approvalStatus === "approved" && account.activationRequested === false
    ? " Activation is withheld." : "";
  return `${prefix} ${PERSONNEL_STATE_META[state || "unknown"].description}${activation} ${notificationMeta(account.notification).message}`;
}

export function legacyApprovalMessage(name, result) {
  if (result?.active === true && result.profileStatus === "active") return `${name} approved. Verified account access is active; existing credentials are unchanged.`;
  if (result?.active === false && result.profileStatus !== "active") return `${name} approved. The account remains inactive; approval does not confirm password setup or activation.`;
  return `${name} approved. Refresh account details to verify activation and sign-in availability.`;
}

export const auditActorLabel = (entry) => entry?.metadata?.performed_by === "personnel_notification_worker"
  ? "System notification worker"
  : entry?.metadata?.actor?.name || entry?.actorName || entry?.metadata?.actor?.id || entry?.actorId || "Not recorded";

// Retain one operation ID for retries of the same payload, not for a different decision.
export function personnelOperation(previous, payload) {
  const signature = JSON.stringify(payload);
  if (previous?.signature === signature) return previous;
  if (!globalThis.crypto?.randomUUID) throw new Error("Secure request IDs are unavailable. Use a secure HTTPS connection.");
  return { signature, id: globalThis.crypto.randomUUID() };
}

export async function personnelCreationOperation(previous, payload, actorId, { storage = undefined, crypto = globalThis.crypto } = {}) {
  if (typeof actorId !== "string" || !actorId.trim()) throw new Error("The administrator identity has not been verified. Sign in again before creating an account.");
  const owner = actorId.trim().toLowerCase();
  const canonical = Object.fromEntries(Object.keys(payload).filter((key) => key !== "operationId").sort().map((key) => {
    let value = payload[key];
    if (typeof value === "string") value = key === "email" ? value.trim().toLowerCase() : value.trim();
    if (key === "rhuStations" && Array.isArray(value)) value = [...value].sort();
    return [key, value];
  }));
  const memory = personnelOperation(previous?.actorId === owner ? previous : null, canonical);
  let storageKey = previous?.actorId === owner && previous?.signature === memory.signature ? previous.storageKey : null;
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(memory.signature));
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    storageKey = `kalusagap:managed-create:v1:${owner}:${hash}`;
    const store = storage === undefined ? globalThis.sessionStorage : storage;
    const saved = store.getItem(storageKey);
    if (saved && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved)) throw new Error("Invalid saved creation reference.");
    const id = saved || memory.id;
    // Persist no profile fields, credentials, or canonical plaintext payload.
    if (!saved) store.setItem(storageKey, id);
    return { ...memory, id, actorId: owner, storageKey, persistent: true };
  } catch {
    return { ...memory, actorId: owner, storageKey, persistent: false };
  }
}

export function clearPersonnelCreationOperation(operation, { storage = undefined } = {}) {
  if (!operation?.storageKey) return false;
  try {
    const store = storage === undefined ? globalThis.sessionStorage : storage;
    store.removeItem(operation.storageKey);
    return true;
  } catch {
    return false;
  }
}

export function stationAssignmentPatch(role, stations, initial) {
  const selected = [...stations].sort();
  const existing = Array.isArray(initial?.rhuStations) ? [...initial.rhuStations].sort() : [];
  if (initial && role === initial.roleId && JSON.stringify(selected) === JSON.stringify(existing)) return {};
  return { rhuStations: role === "rhu_personnel" || role === "health_supervisor" ? selected : [] };
}

export function coverageAssignmentPatch(role, details, initial) {
  if (!initial || role !== initial.roleId) return details;
  return Object.fromEntries(Object.entries(details).filter(([key, value]) => value !== (initial[key] || null)));
}

export function stationAssignmentError(role, stations, choices, initial) {
  if (!Object.hasOwn(stationAssignmentPatch(role, stations, initial), "rhuStations")) return "";
  if (role !== "rhu_personnel" && role !== "health_supervisor") return "";
  if (role === "rhu_personnel" && stations.length === 0) return "Assign at least one RHU station.";
  if (stations.some((id) => !choices.some((station) => station.id === id))) return "Select a valid RHU station from the available choices.";
  return "";
}

export function lifecyclePayload(action, { reason = "", activate = true } = {}) {
  if (!["approve", "reject", "suspend", "reactivate", "invite", "retry_email"].includes(action)) throw new Error("Choose a supported personnel action.");
  const trimmed = reason.trim();
  if (["reject", "suspend"].includes(action) && !trimmed) throw new Error("A reason is required for rejection or suspension.");
  return {
    action,
    ...(trimmed ? { reason: trimmed } : {}),
    ...(["approve", "reactivate"].includes(action) ? { activate } : {}),
  };
}
