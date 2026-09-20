// TEMPORARY DEV-ONLY SCRIPT — do not commit. Tests Supabase Auth signUp using
// the real supabase-js client (the Confirm Signup email is triggered here).
// Usage: node scripts/test-signup.mjs <email>
// No secrets or passwords are printed. The password is generated in-memory.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const TEST_EMAIL = process.argv[2] || '';

if (!TEST_EMAIL) {
  console.error('Usage: node scripts/test-signup.mjs <test-email>');
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

console.log('targeting test email:', TEST_EMAIL);

const { data, error } = await supabase.auth.signUp({
  email: TEST_EMAIL,
  password: crypto.randomBytes(12).toString('hex'), // temporary, in-memory only
  options: { data: { full_name: 'Email Pipeline Test' } },
});

if (error) {
  console.log('signUp FAILED — code:', error.code, 'message:', error.message);
  if (error.message && /already/i.test(error.message)) {
    console.log('NOTE: this email is already registered in Supabase Auth.');
    console.log('A Confirm Signup OTP is NOT re-sent for an existing account.');
    console.log('Use a fresh (never-registered) test email, or trigger a new signup via the app.');
  }
  process.exitCode = 1;
} else {
  console.log('signUp OK — Confirm Signup email should be in flight to Brevo');
  console.log('user id:', data.user?.id || '(none)');
  console.log('email_confirmed_at:', data.user?.email_confirmed_at ?? '(null — expect null until OTP verified)');
  console.log('NEXT: check the mailbox, read the 6-digit code, then run:');
  console.log(`  node scripts/test-verify.mjs ${TEST_EMAIL} <6-DIGIT-CODE>`);
}
