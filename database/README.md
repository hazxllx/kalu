# Database

KALUSAGAP uses **Supabase (PostgreSQL)**. There is no second database — do not
add MySQL or a local Postgres schema alongside this.

**Current state: no schema is checked in yet.** This folder is the one and only
place database SQL belongs, so the schema never ends up duplicated across the
repo, a chat thread, and the Supabase dashboard.

```text
database/
├── migrations/   ordered, forward-only SQL — the source of truth for the schema
├── seeds/        sample/reference data for local development only
└── README.md
```

## Conventions

- One migration per change, named `YYYYMMDDHHMMSS_short_description.sql`
  (e.g. `20260817090000_create_residents.sql`).
- Migrations are append-only. To change something, add a new migration; never
  edit one that has already been applied.
- Tables and columns in `snake_case`, table names plural (`residents`,
  `health_records`, `follow_ups`).
- Seeds contain **fabricated** data only. Never commit real resident names,
  addresses, or health information.

## Workflow with the Supabase CLI

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>

npx supabase migration new create_residents   # writes into supabase/migrations
npx supabase db push                          # apply to the linked project
```

If you adopt the Supabase CLI, keep its `supabase/migrations` folder as the
real one and let this folder hold only what the CLI does not manage (seeds and
notes), or point the CLI at this folder — pick one and record the choice here.
Two competing migration folders is the failure mode to avoid.

## Row Level Security

RLS is the main safeguard for health data and is enforced in the database, not
in the React app:

- Enable RLS on every table that holds resident or health data.
- A resident may read only their own rows.
- BHW, midwife, and RHU roles are scoped to their assigned barangay or facility.
- MHO and admin get municipality-wide read access; write access stays narrow.
- Write the policies as SQL in a migration so they are reviewable and
  reproducible, not clicked together in the dashboard.
