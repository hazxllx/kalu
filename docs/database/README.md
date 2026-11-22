# Database and migrations

KALUSAGAP uses Supabase (PostgreSQL) for the database, authentication, and
Row Level Security. The SQL that defines the schema lives in
`supabase/migrations/` and the reference data lives in `supabase/seed.sql`.
That folder is the single source of truth — the Supabase CLI reads it directly.

## Migrations

Migrations are applied in filename (timestamp) order. Do not rename or reorder
existing files; add a new migration for every change.

For development, use a dedicated hosted Supabase development project or the
existing approved project through its native hosting configuration. Auth,
Storage, PostgreSQL, and RLS remain the same managed services.

Never link development to production. Production settings belong in the hosting
platform's environment variables. `supabase/config.production.toml` is a local
preservation copy and is not loaded by the CLI.
Historical migrations contain destructive DDL, including removal of
`medicine_facility_availability`. Review pending SQL and do not reset or replay
the chain on populated data. No production SQL is needed for local setup.

The reference seed creates the municipality of **Pili (Camarines Sur)**, its
approved barangays (**San Antonio / San Isidro / Old San Roque**), the RHU, and
one Barangay Health Center per active barangay. Historical non-approved
barangay rows are retained as inactive; resident and health records are not
renamed or deleted.

## Environment variables

Backend (`backend/.env`) - server only, never in the frontend:

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<public anon or publishable key>
SUPABASE_SERVICE_ROLE_KEY=<server-only service-role key>
SUPABASE_MODE=hosted-development
```

Frontend (`frontend/.env`) - public by design, protected by RLS:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<public anon or publishable key>
VITE_SUPABASE_MODE=hosted-development
```

The service-role key bypasses RLS, so it must stay on the server and never
appear in a `VITE_` variable.

## Security model

- Authentication is Supabase Auth only; no passwords are stored in custom tables.
- `profiles` (one row per `auth.users` id) holds the role, status, and
  municipality/barangay assignment. A guard trigger blocks self-service changes
  to a user's own role, status, or assignment.
- Row Level Security is the database boundary:
  - `admin` — full access
  - `mho` / `phn` / `rhu_personnel` — their own municipality
  - `health_supervisor` / `bhw` — their one assigned barangay
  - `resident` — only rows linked to their own account
- The Express API verifies the Supabase JWT, loads the profile, and enforces the
  role and barangay scope in middleware. It uses the service-role client for
  trusted writes; RLS remains the defense for any direct user-token access.
- Calendar activity requests use a user-scoped Supabase client so the owner-only
  table policies apply to API reads and writes as well.
- `calendar_activities` is private to its creating Health Supervisor: RLS checks
  the active session, role, owner, and active barangay assignment. Optional
  resident links must remain within that barangay; linked residents do not gain
  access to activity notes.
- Public registration can insert an account application only in the `pending`
  state; reads and decisions are staff-only, so self-approval is not possible.
- Uploaded documents live in a private storage bucket and are reached only
  through backend-mediated signed URLs.

## Notes

- Resident verification is manual (Health Supervisor review). See
  [manual resident verification](../integration/manual-resident-verification.md).
- Clinical tables keep human-readable text ids (`RES-`, `SUB-`, `REF-`,
  `HH-`) minted by `record_counters`; newer tables use UUID primary keys.
- `residents.barangay` (free text) is kept in sync with `barangay_id` /
  `municipality_id` by a trigger for compatibility with the API repository.
