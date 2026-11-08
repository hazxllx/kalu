const resets = new Set();
const legacyKey = /^kalusagap\.(?:residents|households|consultations|tcls|followup-schedule|household-risk|municipal-submissions|admin-users|audit|workflow)\.(?:session\.)?v\d+$/;

export const registerWorkingSetReset = (reset) => {
  resets.add(reset);
  return () => resets.delete(reset);
};

/** Only legacy plaintext working sets; never Supabase auth or encrypted queues. */
export const resetLegacyWorkingSets = (browser = typeof window === 'undefined' ? null : window) => {
  for (const kind of ['sessionStorage', 'localStorage']) {
    try {
      const storage = browser?.[kind];
      if (!storage) continue;
      const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
      keys.filter((key) => legacyKey.test(key || '')).forEach((key) => storage.removeItem(key));
    } catch { /* Storage may be disabled; in-memory resets still run. */ }
  }
  resets.forEach((reset) => { try { reset(); } catch { /* Reset other loaded stores even if a subscriber fails. */ } });
};
