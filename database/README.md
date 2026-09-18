# Database

Supabase/PostgreSQL migrations, seeds and RLS notes for KALUSAGAP.

**Canonical executable location: `supabase/migrations/` + `supabase/seed.sql`**
(what the Supabase CLI reads — `supabase db push`). This folder holds
non-executable database documentation and the development-only fabricated
demo seed.

## Order

Migrations live in `supabase/migrations/` and must be applied in filename order:

| # | File | Contents |
|---|------|----------|
| 1 | `20260903120000_create_rhu_patient_workflow.sql` | `residents`, `visits`, `referrals`, `record_counters` + first RLS pass (role-only; superseded by migration 3) |
| 2 | `20260915100000_create_core_org_and_profiles.sql` | `app_role` enum, `municipalities`, `barangays`, `facilities`, `profiles` (+ auth trigger), `role_permissions`, RLS helper functions, registry/account policies |
| 3 | `20260915100100_accounts_documents_and_clinical_scope.sql` | `account_applications`, `documents`, clinical-table scope columns (`municipality_id`, `barangay_id`, `auth_user_id`, `verification_status`, `blood_sugar`, `status_history`), scope-aware RLS replacing the first pass, private `documents` storage bucket, tightened counter grants |
| 4 | `20260915100200_create_households.sql` | `households` (HH- ids via `record_counters`, WASH/socioeconomic profiling fields, server-computed risk, HS verification workflow, BHW verification-write guard) + `household_members` (optional resident link, duplicate-membership constraint) with barangay/municipality RLS |
| 5 | `20260918100000_create_identity_verification.sql` | **DEPRECATED** — former Didit identity-verification (KYC) tables (`identity_verifications`, `didit_webhook_events`) and residents KYC columns. The Didit integration was removed; these objects are left in place but are no longer written or read by the application. Do not use for new work |
| 6 | `20260919100000_manual_resident_verification.sql` | **Manual resident verification**: moves `residents.verification_status` to `pending / approved / rejected / resubmission_required` (migrating `unverified`→`pending`, `verified`→`approved`), adds `verified_by`, `verified_at`, `rejection_reason`, `submitted_for_verification_at`, and the immutable `resident_verification_logs` audit table with read-only RLS (writes are service-role only) |

Seeds:

| # | File | Contents |
|---|------|----------|
| 1 | `supabase/seed.sql` (canonical reference seed) | Municipality **Pili (Camarines Sur, Region V)**, canonical barangays **San Isidro / San Antonio / Old San Roque**, `RHU` + one Barangay Health Center per barangay |

> The earlier fabricated demo seed (`database/seeds/001_fabricated_rhu_demo_data.sql`)
> has been removed — the application must never serve fabricated records.

## Applying

### Option A — Supabase CLI (linked project)

```bash
supabase link --project-ref <your-project-ref>
supabase db push               # applies supabase/migrations in order
```

The reference seed is applied afterwards — either through the SQL Editor, or
idempotently through the backend helper:

```bash
cd backend && node scripts/verify-database.mjs   # verifies tables + seeds reference data
```

### Option B — Supabase Dashboard (SQL Editor)

1. Open the project → **SQL Editor**.
2. Paste and run each migration from `supabase/migrations/` **in order** (1 → 2 → 3).
3. Run `supabase/seed.sql` (idempotent — safe to re-run).

## Environment variables

Backend (`backend/.env`) — server only, never in the frontend:

```
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>   # NEVER in any VITE_ variable
```

> The Didit KYC integration was removed. There are no `DIDIT_*` or
> `VITE_DIDIT_*` variables. Resident registrations are verified manually by the
> Health Supervisor — see
> [`docs/integration/manual-resident-verification.md`](../docs/integration/manual-resident-verification.md).

Frontend (`frontend/.env`) — public by design, protected by RLS:

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```

## Security model

- **Authentication** is Supabase Auth only; no passwords are stored in any custom table.
- **`profiles`** (1:1 with `auth.users`) holds role, status and municipality/barangay assignment; a guard trigger blocks self-service changes to role/status/assignment.
- **RLS** is the database boundary:
  - `admin` — everything
  - `mho` / `phn` / `rhu_personnel` — own municipality
  - `health_supervisor` / `bhw` — exactly one assigned barangay
  - `resident` — only rows linked to their own account
- The **Express API** verifies the Supabase JWT, loads the profile, enforces role + barangay scope in middleware, and uses the service-role client (which bypasses RLS) — RLS remains the defense for any direct user-token access, and `getUserClient()` runs queries under the caller's identity where useful.
- **Account applications** can be inserted by anonymous users (public registration) only in `pending` state; reads/decisions are admin-only, so self-approval is structurally impossible.
- **Documents** live in the private `documents` bucket; access is mediated by the backend with signed URLs.

## Notes

- `residents.barangay` (free text) is retained for compatibility with the existing Express repository; the `residents_sync_scope` trigger keeps it in sync with `barangay_id`/`municipality_id` in both directions.
- Clinical tables keep their human-readable text PKs (`RES-`/`SUB-`/`REF-`) minted by `record_counters`; all newer tables use UUID primary keys.
