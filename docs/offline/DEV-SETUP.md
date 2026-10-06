# KALUSAGAP Offline — Development Environment Setup

**Purpose:** Live verification of the offline household workflow against a **non-production** Supabase database and test BHW account.

**Safety:** This document assumes you have a **dedicated development/staging Supabase project** separate from production `lblawqeoixojyytkmfqy`. Never apply these steps to the live project.

---

## Prerequisites

### Option A: Remote Development Project (Recommended)
1. A **separate Supabase project** (e.g., `kalusagap-dev` or `kalusagap-staging`).
2. Project reference (e.g., `abcdefghijklmnopqrst`).
3. Service role key for the dev project.
4. Anon key for the dev project.

### Option B: Local Supabase (Docker)
1. Docker Desktop installed and running.
2. WSL2 enabled (Windows) or native Docker (macOS/Linux).
3. Supabase CLI installed: `npm install -g supabase`.

---

## Step 1: Verify Current State (Safety Check)

**Before making any changes:**

```bash
cd C:\Users\Hazel\Desktop\final

# Confirm the currently linked project
supabase status
cat supabase\.temp\project-ref
# Should show: lblawqeoixojyytkmfqy (production)

# Verify migration is unapplied
supabase migration list
# 20261006130000_offline_sync_operations.sql should show as NOT APPLIED
```

**If migration is already applied to production, STOP.** Contact the team before proceeding.

---

## Step 2: Set Up Development Project

### Option A: Link to Remote Dev Project

```bash
# Unlink production (does not modify production data)
supabase unlink

# Link to your development project
supabase link --project-ref <DEV_PROJECT_REF>
# Example: supabase link --project-ref abcdefghijklmnopqrst

# Verify the link
cat supabase\.temp\project-ref
# Should show your DEV ref, NOT lblawqeoixojyytkmfqy
```

### Option B: Start Local Supabase

```bash
# Start local stack (requires Docker)
supabase start

# This creates:
# - API URL: http://localhost:54321
# - DB URL: postgresql://postgres:postgres@localhost:54322/postgres
# - Studio URL: http://localhost:54323
# - anon key, service_role key (printed to console)
```

**Save the output keys and URLs** — you'll need them for environment variables.

---

## Step 3: Configure Environment Variables

### Backend `.env.development` (create new file)

```env
# Development Supabase project (remote OR local)
SUPABASE_URL=https://<DEV_REF>.supabase.co
# OR for local: SUPABASE_URL=http://localhost:54321

SUPABASE_SERVICE_ROLE_KEY=<DEV_SERVICE_ROLE_KEY>

# Use development project
NODE_ENV=development

# Server
PORT=5001

# CORS for local frontend
CORS_ORIGIN=http://localhost:5173
```

### Frontend `.env.development` (create new file)

```env
VITE_API_URL=http://localhost:5001/api
VITE_SUPABASE_URL=https://<DEV_REF>.supabase.co
# OR for local: VITE_SUPABASE_URL=http://localhost:54321

VITE_SUPABASE_ANON_KEY=<DEV_ANON_KEY>
```

### Test Environment `.env.test` (for integration tests)

```env
# Same as .env.development but clearly marked
TEST_SUPABASE_URL=https://<DEV_REF>.supabase.co
TEST_SUPABASE_SERVICE_ROLE_KEY=<DEV_SERVICE_ROLE_KEY>
TEST_BHW_EMAIL=test-bhw@kalusagap-dev.local
TEST_BHW_PASSWORD=<secure_test_password>
```

---

## Step 4: Apply Migrations to Development

```bash
# Verify you're linked to DEV (not production)
supabase status

# Push all migrations to development database
supabase db push

# Verify migrations applied
supabase migration list
# All should show APPLIED, including 20261006130000_offline_sync_operations.sql

# Optional: Open Studio to inspect
supabase db studio
# Verify:
# - sync_operations table exists
# - households.client_operation_key column exists
# - create_household_with_members function exists
```

---

## Step 5: Seed Development Data

Create `supabase/seed-dev.sql`:

```sql
-- Development test data (municipalities, barangays, test users)
-- Run: psql <DEV_DB_URL> -f supabase/seed-dev.sql

BEGIN;

-- Municipality (Taguig example)
INSERT INTO public.municipalities (id, name, province, region)
VALUES ('11111111-1111-1111-1111-111111111111', 'Taguig Test', 'NCR', 'NCR')
ON CONFLICT (id) DO NOTHING;

-- Barangay
INSERT INTO public.barangays (id, municipality_id, name)
VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Test Poblacion')
ON CONFLICT (id) DO NOTHING;

-- Test BHW profile (linked to auth.users via trigger)
-- Auth user must be created via Supabase Dashboard or signup flow first
-- This just sets the profile after user exists

COMMIT;
```

---

## Step 6: Create Test BHW Account

### Via Supabase Dashboard

1. Open Studio: `supabase db studio` or visit `https://supabase.com/dashboard/project/<DEV_REF>`.
2. Go to **Authentication > Users > Add User**.
3. Create:
   - Email: `test-bhw@kalusagap-dev.local`
   - Password: (secure test password)
   - Email confirmed: **Yes**
4. Note the user's UUID.

### Set Profile via SQL

```sql
-- Link profile to the auth user
INSERT INTO public.profiles (
  id, -- same as auth.users.id
  email,
  role,
  status,
  municipality_id,
  barangay_id
)
VALUES (
  '<AUTH_USER_UUID>',
  'test-bhw@kalusagap-dev.local',
  'bhw',
  'active',
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222'
)
ON CONFLICT (id) DO UPDATE SET
  role = EXCLUDED.role,
  barangay_id = EXCLUDED.barangay_id;
```

---

## Step 7: Run Backend Integration Tests

```bash
cd backend

# Run with development environment
NODE_ENV=development npm test test/offline.integration.test.js

# Expected: All integration tests pass against real dev database
```

---

## Step 8: Run Authenticated Playwright Tests

```bash
cd frontend

# Set dev environment
export VITE_API_URL=http://localhost:5001/api
export VITE_SUPABASE_URL=https://<DEV_REF>.supabase.co
export VITE_SUPABASE_ANON_KEY=<DEV_ANON_KEY>

# Start backend in development mode
cd ../backend && NODE_ENV=development npm start &

# Run authenticated E2E tests
cd ../frontend
npx playwright test tests/offline/offline-authenticated.spec.js

# Expected: Offline create, reload, sync, dedup, conflict scenarios pass
```

---

## Step 9: Verify Database State

After running tests:

```bash
# Connect to dev database
supabase db connect

# Or via psql
psql <DEV_DB_URL>
```

### Verification Queries

```sql
-- Check sync_operations RLS
SELECT tablename, policyname, roles, cmd
FROM pg_policies
WHERE tablename = 'sync_operations';
-- Expected: No rows (RLS enabled, but no policies = service_role only)

-- Check client_operation_key uniqueness
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'households' AND indexname LIKE '%client_operation_key%';
-- Expected: households_client_operation_key_unique

-- Check function exists and grants
SELECT proname, pronamespace::regnamespace, proacl
FROM pg_proc
WHERE proname = 'create_household_with_members';
-- Expected: public.create_household_with_members, service_role granted

-- Check test households created
SELECT id, head_name, client_operation_key, revision
FROM public.households
WHERE client_operation_key IS NOT NULL
ORDER BY created_at DESC
LIMIT 10;
-- Expected: Test households with unique client_operation_key values

-- Verify exactly one household per operation key (idempotency)
SELECT client_operation_key, COUNT(*)
FROM public.households
WHERE client_operation_key IS NOT NULL
GROUP BY client_operation_key
HAVING COUNT(*) > 1;
-- Expected: 0 rows (no duplicates)
```

---

## Step 10: Cleanup and Restore Production Link

**After testing is complete:**

```bash
# Unlink development
supabase unlink

# OR stop local Supabase
supabase stop

# Re-link to production (read-only)
supabase link --project-ref lblawqeoixojyytkmfqy

# Verify production is unchanged
supabase migration list
# 20261006130000 should still show NOT APPLIED on production

# Clean up dev env files (optional)
rm backend/.env.development frontend/.env.development .env.test
```

---

## Troubleshooting

### "Migration already applied" on production
**DO NOT PROCEED.** The migration was applied to production outside this workflow. Coordinate with the team.

### RLS denies insert on `sync_operations`
The table is service-role-only by design. Ensure backend uses `SUPABASE_SERVICE_ROLE_KEY`, not anon key.

### `create_household_with_members` returns 404
Function not exposed or PostgREST cache stale. Check:
```sql
SELECT proname FROM pg_proc WHERE proname = 'create_household_with_members';
```
If exists, run: `NOTIFY pgrst, 'reload schema';`

### Docker/WSL2 issues on Windows
See prior report — this environment cannot run local Supabase. Use a remote dev project instead.

---

## Safety Checklist

- [ ] Confirmed linked project is NOT `lblawqeoixojyytkmfqy` before `db push`.
- [ ] Verified production project remains unchanged after testing.
- [ ] Used dedicated test account, not production user credentials.
- [ ] Synthetic test data only (no real PII).
- [ ] Migration unapplied on production.
- [ ] Service role keys not committed to Git.

---

## Next Steps

Once this setup is complete and all tests pass:
1. Document actual test results in `docs/offline/TEST-RESULTS.md`.
2. Update main README with verified status.
3. Plan production rollout (separate task; requires approval + monitoring).
