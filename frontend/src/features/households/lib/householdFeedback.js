// Presentation validation only; the API remains authoritative.
export function validateHouseholdField(field, value, { member = false, adding = false } = {}) {
  const text = String(value ?? '').trim();
  const required = member ? ['name', ...(adding ? ['relationship', 'sex'] : [])] : ['headName', 'purok', 'streetAddress'];
  if (required.includes(field) && !text) return 'This field is required.';
  if (field === 'visitReason' && !['Initial Profiling', 'Updating Household Information', 'Verification', 'Follow-up', 'Monitoring', 'Other'].includes(text)) return 'Select a visit reason.';
  if (field === 'visitDate' || (field === 'birthday' && text)) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00Z`) : null;
    if (!date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) return 'Enter a valid calendar date.';
  }
  if (field === 'contact' && text && !/^(?:\+63|0)9\d{9}$/.test(text.replace(/[\s()\-.]/g, ''))) return 'Enter a valid PH mobile number (09 or +639).';
  if (text && ['families', 'monthlyIncome', 'age'].includes(field)) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 'Enter a valid number.';
    if (field === 'families' && (!Number.isInteger(n) || n < 1 || n > 50)) return 'Enter a whole number from 1 to 50.';
    if (field === 'age' && (n < 0 || n > 120)) return 'Enter an age from 0 to 120.';
    if (field === 'monthlyIncome' && (n < 0 || n > 100000000)) return 'Enter an amount from 0 to 100,000,000.';
  }
  const limits = { headName: 120, name: 120, purok: 60, streetAddress: 200, respondentFirst: 120, respondentLast: 120, respondentMaiden: 120, philhealthId: 120, nhts: 120, ip: 120 };
  if (limits[field] && text.length > limits[field]) return `Use ${limits[field]} characters or fewer.`;
  return '';
}

const technical = /postgres|supabase|sql|constraint|stack|relation[ "]|column|schema|ECONN|TypeError|\/src\/|\\src\\/i;
export function safeHouseholdError(error, fallback = 'Could not save. Your entries are unchanged. Please try again.') {
  const status = Number(error?.status);
  const message = error?.message;
  if (status === 401) return 'Your session has expired. Sign in again to continue.';
  if (status === 409) return 'This record changed. Reload the latest version before saving again.';
  if (!(status >= 400 && status < 500 && typeof message === 'string' && !technical.test(message))) return fallback;
  const details = error?.payload?.error?.details;
  const readable = Array.isArray(details) ? [...new Set(details.filter((item) => typeof item === 'string' && !technical.test(item)))] : [];
  return readable.length ? `${message} ${readable.join('; ')}` : message;
}
export function householdFieldErrors(error) {
  if (Number(error?.status) >= 500) return {};
  const body = error?.payload?.error;
  const raw = body?.errors || body?.details;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => {
    const field = key === 'members[0]' ? 'name' : key.replace(/^(?:members\[\d+\]\.|member\.|household\.|visit\.)/, '');
    return [field, typeof value === 'string' && !technical.test(value) ? value : 'Check this value.'];
  }));
}
