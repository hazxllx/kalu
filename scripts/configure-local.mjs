import { copyFileSync, existsSync, readFileSync, writeFileSync, constants } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { assertLocalUrl, assertLocalKey } from '../backend/src/config/localSafety.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const originalConfig = resolve(root, 'supabase/config.production.toml');
if (!existsSync(originalConfig)) {
  copyFileSync(resolve(root, 'supabase/config.toml'), originalConfig, constants.COPYFILE_EXCL);
}
if (process.argv.includes('--preserve-only')) {
  console.log('Existing environment and Supabase configuration preserved without displaying credentials.');
  process.exit(0);
}

// Status inspects the local Docker stack only. Never link, push, reset, or seed.
const result = spawnSync('supabase', ['status', '--output', 'json'], {
  cwd: root, encoding: 'utf8', shell: process.platform === 'win32', windowsHide: true,
});
if (result.status !== 0) {
  throw new Error('Local Supabase is unavailable. Start Docker and run supabase start before configuring local credentials. No development files were overwritten.');
}
let status;
try { status = JSON.parse(result.stdout); } catch { throw new Error('Could not read local Supabase status.'); }
assertLocalUrl(status.API_URL, 'Supabase API');
assertLocalUrl(status.DB_URL, 'Supabase database', ['postgres:', 'postgresql:']);
assertLocalKey(status.ANON_KEY, 'Local anon key');
assertLocalKey(status.SERVICE_ROLE_KEY, 'Local service key');
if (!status.API_URL || !status.DB_URL || !status.ANON_KEY || !status.SERVICE_ROLE_KEY) {
  throw new Error('Local Supabase status is incomplete. Legacy local anon/service-role JWTs are required.');
}
if (process.argv.includes('--status')) {
  console.log('Local Supabase is available. API, database and key metadata passed local validation. No credentials displayed.');
  process.exit(0);
}
const backendPath = resolve(root, 'backend/.env');
const previous = existsSync(backendPath) ? readFileSync(backendPath, 'utf8') : '';
const pepper = previous.match(/^OTP_PEPPER=([a-f0-9]{64})$/m)?.[1] || randomBytes(32).toString('hex');
writeFileSync(backendPath, `NODE_ENV=development\nPORT=5000\nCLIENT_URL=http://localhost:5173\nCORS_ORIGIN=http://127.0.0.1:5173\nSUPABASE_URL=${status.API_URL}\nSUPABASE_ANON_KEY=${status.ANON_KEY}\nSUPABASE_SERVICE_ROLE_KEY=${status.SERVICE_ROLE_KEY}\nDATABASE_URL=${status.DB_URL}\nSMTP_HOST=127.0.0.1\nSMTP_PORT=54325\nSMTP_USER=\nSMTP_PASSWORD=\nSMTP_FROM=noreply@kalusagap.test\nOTP_PEPPER=${pepper}\n`, { mode: 0o600 });
writeFileSync(resolve(root, 'frontend/.env'), `VITE_APP_BASE_URL=http://localhost:5173\nVITE_API_URL=http://localhost:5000/api\nVITE_SUPABASE_URL=${status.API_URL}\nVITE_SUPABASE_ANON_KEY=${status.ANON_KEY}\nVITE_ANALYTICS_ENABLED=false\n`, { mode: 0o600 });
console.log('Configured ignored development files from local Supabase. No credentials were logged. Restart both development servers.');
