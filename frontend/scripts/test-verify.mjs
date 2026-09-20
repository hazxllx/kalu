// TEMPORARY DEV-ONLY SCRIPT — do not commit. Verifies a 6-digit email OTP via
// the real supabase-js client.
// Usage: node scripts/test-verify.mjs <email> <6-digit-code>
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const TEST_EMAIL = process.argv[2] || '';
const token = process.argv[3] || '';

if (!TEST_EMAIL || !/^\d{6}$/.test(token)) {
  console.error('Usage: node scripts/test-verify.mjs <email> <6-digit-code>  (code is not printed)');
  process.exit(1);
}

const envText = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const envName = (name) => {
  const line = envText.split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim() : '';
};

const url = envName('VITE_SUPABASE_URL').replace(/\/+$/, '');
const anonKey = envName('VITE_SUPABASE_ANON_KEY');
if (!url || !anonKey) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in frontend/.env');
  process.exit(1);
}

const supabase = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });

const { data, error } = await supabase.auth.verifyOtp({
  email: TEST_EMAIL,
  token,
  type: 'email',
});

if (error) {
  console.log('verifyOtp FAILED — code:', error.code, 'message:', error.message);
  process.exitCode = 1;
} else {
  console.log('verifyOtp SUCCEEDED');
  console.log('user id:', data.user?.id || '(none)');
  console.log('email_confirmed_at:', data.user?.email_confirmed_at ?? '(none)');
  console.log('session issued:', Boolean(data.session));
}
