# KALUSAGAP Offline — Development Environment Setup Checklist

**Purpose:** Prepare a safe, non-production environment for live verification of the
offline household workflow (real PostgreSQL + authenticated browser) **without
modifying the production Supabase project `lblawqeoixojyytkmfqy`**.

**Hard rule:** Production is read-only forever. Nothing in this document applies to
`lblawqeoixojyytkmfqy`. Do not link, migrate, seed, reset, or write to it. If any
step would touch it, STOP.

---

## 0. Current repository state (verified 2026-10-07)

- Linked Supabase project (read from `supabase/.temp/project-ref`): `lblawqeoixojyytkmfqy`
  (production). **Do not run `supabase db push` while this link is active.**
- Migration `supabase/migrations/20261006130000_offline_sync_operations.sql` is
  **NOT yet applied** to any project (verified in `docs/offline/README.md` and by
  inspection: no `sync_operations` schema object exists yet in any checked target).
- Offline layer status:
  - Unit tests (mocked / `fake-indexeddb`): **pass**.
  - Production PWA build + unauthenticated offline navigation: **passed** in
    Chromium (see `frontend/tests/offline/offline-pwa.spec.js`).
  - Real-database integration and authenticated E2E: **NOT run** (blocked — no dev
    project, no test BHW). This checklist unblocks them.

---

## 1. Create a dedicated development Supabase project

1. In the Supabase dashboard (or `supabase projects create`), create a project named
   `kalusagap-dev`. It MUST NOT be the production project.
2. Record its project reference (e.g. `abcdefghijklmnopqrst`). You will need it for
   every command below.
3. From **Project Settings → API**, copy:
   - **Project URL:** `https://abcdefghijklmnopqrst.supabase.co`
   - **anon public key** (the `anon` / `publishable` key)
   - **service_role secret key** — this is a server-only secret; never commit it.

**Safety check before continuing:**

```powershell
# From the repo root
Get-Content supabase\.temp\project-ref
# MUST print the DEV ref, NOT lblawqeoixojyytkmfqy, before any write step.
```

---

## 2. Apply migrations to the DEVELOPMENT project only

```powershell
# Unlink production (read-only; does not modify it)
supabase unlink

# Link the dev project
supabase link --project-ref <DEV_REF>

# Verify the link BEFORE pushing
Get-Content supabase\.temp\project-ref   # must show <DEV_REF>

# Push ALL migrations, including 20261006130000_offline_sync_operations.sql
supabase db push

# Verify the offline migration applied
supabase migration list    # 20261006130000 should show APPLIED
```

Verify database objects exist (connect with `supabase db connect` or Studio):

```sql
select to_regclass('public.sync_operations') as sync_ops,
       to_regclass('public.households')       as households;
-- both should be non-null

select column_name from information_schema.columns
where table_schema='public' and table_name='households'
  and column_name in ('revision','client_operation_key');
-- must return both rows

select proname from pg_proc where proname='create_household_with_members';
-- must return 1 row

select indexname from pg_indexes
where tablename='households' and indexname like '%client_operation_key%';
-- households_client_operation_key_unique
```

**Warning:** If `supabase migration list` ever shows `20261006130000` as applied on
the PRODUCTION-linked project, STOP and contact the team. It must remain unapplied
there.

---

## 3. Seed synthetic development data

The repo now ships `supabase/seed-dev.sql` (development-only reference data:
municipality `Taguig Test`, barangay `Test Poblacion`, plus facilities) and a
provisioning script that creates the auth user + BHW profile together.

**Order matters:** the auth user must exist before the profile row (the profile
references `auth.users`), and the profile must exist before the BHW can log in.

```powershell
# 1) Seed reference data via the Supabase CLI (uses the linked dev project)
supabase db execute --file supabase/seed-dev.sql
# or: psql "<DEV_DB_URL>" -f supabase/seed-dev.sql

# 2) Create the test BHW auth user + profile (refuses the production ref)
$env:SUPABASE_DEV_URL="https://<DEV_REF>.supabase.co"
$env:SUPABASE_DEV_SERVICE_ROLE_KEY="<DEV_SERVICE_ROLE_KEY>"
$env:KALUSAGAP_TEST_BHW_PASSWORD="<choose a strong test password>"
node backend/scripts/provision-test-bhw.mjs --apply
```

The script prints exactly what it created and refuses to run against the production
ref. It uses a fixed synthetic profile:

| Field | Value |
| --- | --- |
| email | `test-bhw@kalusagap-dev.local` |
| role | `bhw` |
| status | `active` |
| municipality | `Taguig Test` |
| barangay | `Test Poblacion` |

The same email/password must be provided to the Playwright suite through
environment variables (never source files).

### Why `Taguig Test` and not `Pili`?

- The production seed (`supabase/seed.sql`, applied on live) creates `Pili` /
  `San Isidro` / `San Antonio` / `Old San Roque`. Seeding the SAME names into a dev
  project is harmless, but using distinctly synthetic names (`Taguig Test` /
  `Test Poblacion`) makes it impossible to mistake dev records for real ones when
  reviewing the database, and keeps the two projects visually distinct.
- `seed-dev.sql` is **idempotent** (ON CONFLICT DO NOTHING / DO UPDATE), so it can
  be re-run safely.

### Verify the test account can sign in

```powershell
# from backend/
$env:SUPABASE_URL="https://<DEV_REF>.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="<DEV_SERVICE_ROLE_KEY>"
$env:SUPABASE_ANON_KEY="<DEV_ANON_KEY>"
node scripts/provision-test-bhw.mjs          # check-only; no --apply
# Output should show: email exists, password valid, profile role= bhw, status= active
```

---

## 4. Environment variables (both apps must point at the DEV project)

### Backend — create `backend/.env.development`

```env
PORT=5001
CLIENT_URL=http://localhost:5173
NODE_ENV=development
SUPABASE_URL=https://<DEV_REF>.supabase.co
SUPABASE_ANON_KEY=<DEV_ANON_KEY>
SUPABASE_SERVICE_ROLE_KEY=<DEV_SERVICE_ROLE_KEY>
```

### Frontend — create `frontend/.env.development`

```env
VITE_API_URL=http://localhost:5001/api
VITE_SUPABASE_URL=https://<DEV_REF>.supabase.co
VITE_SUPABASE_ANON_KEY=<DEV_ANON_KEY>
```

### Integration tests — environment snapshot (run in a shell; never commit)

```powershell
$env:ALLOW_OFFLINE_INTEGRATION_TESTS="1"
$env:TEST_SUPABASE_URL="https://<DEV_REF>.supabase.co"
$env:TEST_SUPABASE_SERVICE_ROLE_KEY="<DEV_SERVICE_ROLE_KEY>"
$env:TEST_SUPABASE_ANON_KEY="<DEV_ANON_KEY>"
```

### Playwright authenticated E2E — environment snapshot (never commit)

```powershell
$env:VITE_API_URL="http://localhost:5001/api"
$env:VITE_SUPABASE_URL="https://<DEV_REF>.supabase.co"
$env:VITE_SUPABASE_ANON_KEY="<DEV_ANON_KEY>"
$env:KALUSAGAP_TEST_BHW_EMAIL="test-bhw@kalusagap-dev.local"
$env:KALUSAGAP_TEST_BHW_PASSWORD="<the chosen test password>"
```

**Hygiene rules (existing repo standard, e.g. BUG-026):** credentials come from the
environment only. `.env.development`, `.env.test`, and any file containing keys are
git-ignored (frontend/backend `.gitignore` already cover `.env*`). Never put a real
password or service-role key in a file that is committed.

---

## 5. Start the dev stack

```powershell
# Terminal 1 — backend against the dev project
$env:NODE_ENV="development"
npm run start:backend        # listens on http://127.0.0.1:5001 (PORT from .env.development)

# Terminal 2 — frontend against the dev API
$env:VITE_API_URL="http://localhost:5001/api"
$env:VITE_SUPABASE_URL="https://<DEV_REF>.supabase.co"
$env:VITE_SUPABASE_ANON_KEY="<DEV_ANON_KEY>"
npm run dev --prefix frontend   # http://localhost:5173
```

Point the frontend at the dev backend on **port 5001** (`VITE_API_URL`) and at the
**dev Supabase project**. Keeps the production `.env` files untouched.

---

## 6. Run the real-database integration tests

```powershell
cd backend
$env:ALLOW_OFFLINE_INTEGRATION_TESTS="1"
$env:TEST_SUPABASE_URL="https://<DEV_REF>.supabase.co"
$env:TEST_SUPABASE_SERVICE_ROLE_KEY="<DEV_SERVICE_ROLE_KEY>"
$env:TEST_SUPABASE_ANON_KEY="<DEV_ANON_KEY>"
npm test test/offline.integration.test.js
```

Expected: all tests pass against the real dev database, including:
- atomic household + members create (single transaction),
- retried operation returns the same household (exactly one row),
- idempotency-key reuse with a different payload → 409,
- stale-revision conditional update → 409,
- out-of-scope user → 403/404,
- anon/authenticated RLS denial on `sync_operations`,
- `create_household_with_members` RPC exists and is callable.

**Never** claim these passed unless they were actually run with
`ALLOW_OFFLINE_INTEGRATION_TESTS=1` against the dev project. When they are, record
results in `docs/offline/TEST-RESULTS.md`.

---

## 7. Run the authenticated Playwright E2E

```powershell
cd frontend
# backend on :5001 + dev Supabase env (see section 5)
npx playwright test tests/offline/offline-authenticated.spec.js --config playwright.offline.auth.config.js
```

Expected scenarios (all against the real dev DB, authenticated as the test BHW):
1. **Online create** → household saved directly; `source=server`, no pending queue.
2. **Offline create** → draft queued locally, badge shows "offline", IndexedDB
   payload is encrypted.
3. **Reload persistence** → offline page reload keeps the pending draft.
4. **Reconnect synchronization** → queued household syncs; exactly one DB row;
   pending count returns to 0.
5. **Idempotent retry** → toggling offline/online mid-upload produces one row.
6. **Revision conflict** → second-device edit + offline update → conflict surfaced,
   server row not overwritten.
7. **Logout purge** → `kalusagap-offline` IndexedDB deleted; next user sees no
   residual data.

---

## 8. Verify database state after a run

```sql
-- Exactly one household per client operation key (no duplicates)
select client_operation_key, count(*)
from public.households
where client_operation_key is not null
group by client_operation_key
having count(*) > 1;
-- Expected: 0 rows

-- Ledger replay recorded for the completed idempotent creates
select idempotency_key, status, response_status
from public.sync_operations
order by created_at desc limit 10;
```

---

## 9. Cleanup and restore the production link

```powershell
supabase unlink                       # unlink dev
supabase link --project-ref lblawqeoixojyytkmfqy   # re-link production (read-only)
Get-Content supabase\.temp\project-ref             # must show lblawqeoixojyytkmfqy
supabase migration list               # 20261006130000 must still show NOT APPLIED
```

Optionally remove the dev env files (`backend/.env.development`,
`frontend/.env.development`). `.env.development` files are git-ignored; removing
them is cleanup, not safety.

---

## 10. Safety checklist (before ANY write command)

- [ ] `supabase/.temp/project-ref` shows the DEV ref, not `lblawqeoixojyytkmfqy`.
- [ ] `supabase migration list` on the production-linked project shows
      `20261006130000` as **NOT APPLIED**.
- [ ] Scripts enforce the production-ref guard themselves (they do — see
      `backend/scripts/provision-test-bhw.mjs` and
      `backend/test/offline.integration.test.js`).
- [ ] Test BHW credentials come from env vars, never from committed files.
- [ ] Synthetic data only; no real PII. Names like `Taguig Test` / `Test Poblacion`
      are unambiguous.
- [ ] No service-role key in any `VITE_`/committed file.
- [ ] No writes of any kind were made to `lblawqeoixojyytkmfqy`.

---

## Next steps once unblocked

1. Run section 6 (integration) and section 7 (E2E) against the dev project.
2. Record actual pass/fail/skip results and the exact setup used in
   `docs/offline/TEST-RESULTS.md` (create the file; it is referenced by
   `docs/offline/DEV-SETUP.md` and is not yet present).
3. Update `docs/offline/README.md` "Verification status" section from the results.
4. Only then plan a production rollout of the offline migration (separate task,
   with explicit approval and monitoring) — never as part of dev testing.