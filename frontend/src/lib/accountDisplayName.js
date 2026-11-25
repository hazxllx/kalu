// Presentation-only account labels. Role ids, profile names, Auth metadata,
// permissions, and email addresses remain unchanged.
const ACCOUNT_DISPLAY_NAMES = Object.freeze({
  'admin_kalusagap@gmail.com': 'Sys Admin',
  'vorimop692@comzx.com': 'RHU Triage',
  'decikax149@aahzz.com': 'RHU Consultation',
});

export const accountDisplayName = (account = {}) => {
  const email = String(account.email || '').trim().toLowerCase();
  return ACCOUNT_DISPLAY_NAMES[email] || account.name || account.fullName || account.full_name || '';
};

export default accountDisplayName;
