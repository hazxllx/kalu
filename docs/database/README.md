# Database and migrations

KALUSAGAP uses Supabase (PostgreSQL) for the database, authentication, and
Row Level Security. The SQL that defines the schema lives in
`supabase/migrations/` and the reference data lives in `supabase/seed.sql`.
That folder is the single source of truth — the Supabase CLI reads it directly.

## Migrations

Migrations are applied in filename (timestamp) order. Do not rename or reorder
existing files; add a new migration for every change.

Applied with the Supabase CLI from the repository root:

```bash
supabase link --project-ref <your-project-ref>
supabase migration list --linked   # review what is already applied
supabase db push                   # apply supabase/migrations in order
```

Or through the Supabase Dashboard: open **SQL Editor**, run each file in
`supabase/migrations/` in order, then run `supabase/seed.sql` (it is idempotent
and safe to re-run).

The reference seed creates the municipality of **Pili (Camarines Sur)**, its
barangays (**San Isidro / San Antonio / Old San Roque**), the RHU, and one
Barangay Health Center per barangay.

## Environment variables

Backend (`backend/.env`) — server only, never in the frontend:

```
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>
```

Frontend (`frontend/.env`) — public by design, protected by RLS:

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
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
