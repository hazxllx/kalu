/**
 * Pure, UI-free helpers for the RHU Triage workflow.
 *
 * These are extracted from RhuTriage.jsx so the submission/cleanup contract and
 * the incoming-referral filtering can be unit-tested with `node --test` without
 * a browser or a React renderer. They contain no React, no network, and no DOM
 * access — the component injects the real `send`/`reset`/`notify`/`refresh`
 * behaviours.
 */

/**
 * Referral statuses that are terminal and therefore excluded from the ACTIVE
 * triage "Incoming Barangay Referrals" list. The underlying referral records
 * are never deleted — a completed/cancelled referral simply drops out of the
 * active queue and remains available to history and the downstream consultation
 * workflow.
 */
export const CLOSED_REFERRAL_STATUSES = Object.freeze(["Completed", "Cancelled"]);

/**
 * Return only the referrals that are still open for triage. Input is never
 * mutated; terminal referrals are filtered out of the active view, not removed
 * from the source data.
 *
 * @param {Array<{status?: string}>} rows
 * @returns {Array<{status?: string}>}
 */
export function filterOpenReferrals(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return list.filter((r) => !CLOSED_REFERRAL_STATUSES.includes(r?.status));
}

/**
 * Default user-facing messages for a triage submission. Kept here so the
 * component and the tests share one source of truth.
 */
export const TRIAGE_MESSAGES = Object.freeze({
  success: "Triage completed. Patient sent to the consultation queue.",
  offline:
    "Triage saved offline. Reconnect and submit it to the consultation queue.",
  failure:
    "Could not send the patient to the consultation queue. Please try again.",
});

/**
 * Orchestrate a single triage submission with a strict success/failure
 * contract:
 *
 *  - Only the API call (`send`) can mark the attempt as failed. A real failure
 *    preserves the wizard/referral state (no reset) and reports the error.
 *  - Once `send` resolves, the submission is a CONFIRMED success. Post-success
 *    cleanup (`reset`) and list refresh (`refresh`) can never turn a confirmed
 *    success into a false failure toast — their errors are swallowed.
 *  - `send` resolves to a truthy value when the triage was saved offline
 *    (queued) rather than delivered; that is still a success, with a distinct
 *    message.
 *
 * @param {object} args
 * @param {() => Promise<any>} args.send        Performs the API call; resolves truthy when queued offline.
 * @param {() => void} [args.reset]             Resets the wizard + clears the active referral (success only).
 * @param {(result: {ok: boolean, offline?: boolean, message: string}) => void} args.notify  Surfaces a toast.
 * @param {() => (void | Promise<any>)} [args.refresh]  Refetches the incoming referral list (success only).
 * @param {{success: string, offline: string, failure: string}} [args.messages]
 * @returns {Promise<{ok: boolean, offline?: boolean, error?: any}>}
 */
export async function submitTriage({
  send,
  reset,
  notify,
  refresh,
  messages = TRIAGE_MESSAGES,
}) {
  if (typeof send !== "function") {
    throw new TypeError("submitTriage requires a `send` function.");
  }
  if (typeof notify !== "function") {
    throw new TypeError("submitTriage requires a `notify` function.");
  }

  let wasOffline;
  try {
    wasOffline = await send();
  } catch (err) {
    // Genuine API failure: keep the current referral/wizard state intact.
    notify({ ok: false, message: err?.message || messages.failure });
    return { ok: false, error: err };
  }

  // Beyond this point the submission is a confirmed success. Nothing here may
  // produce a failure toast.
  const offline = Boolean(wasOffline);

  if (typeof reset === "function") {
    try {
      reset();
    } catch {
      /* Local cleanup must not surface as a send failure. */
    }
  }

  notify({
    ok: true,
    offline,
    message: offline ? messages.offline : messages.success,
  });

  if (typeof refresh === "function") {
    try {
      await refresh();
    } catch {
      /* A stale/failed list refresh is non-fatal to the submission. */
    }
  }

  return { ok: true, offline };
}

export default submitTriage;
