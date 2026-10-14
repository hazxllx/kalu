# KALUSAGAP

## Community Health Risk Monitoring and Early Intervention System

KALUSAGAP is a web application for the Municipal Health Office of Pili,
Camarines Sur. It supports residents and authorized municipal health personnel
with resident registration, household and community monitoring, health-risk
workflows, referrals, follow-up, and municipality-level analytics.

The system is intended for residents, barangay health workers, RHU personnel,
public health nurses, health supervisors, the Municipal Health Officer, and
system administrators. It brings community health information and follow-up
workflows into one role-scoped application while limiting access to personal
and clinical records.

## System Overview

The repository contains a React frontend, an Express API, and Supabase/PostgreSQL
migrations. The API validates requests, derives authorization and geographic
scope from the authenticated profile, and returns aggregate analytics without
exposing resident-level details in map summaries.

The implemented application includes:

- Supabase Auth sign-in with server-side role and profile checks
- Resident registration, document submission, manual verification, and transfer
  requests
- Household profiling, household-member health profiles, and barangay review
- RHU intake and PHN submission processing
- Consultation, referral, and follow-up workflows
- Notifications and operational records
- FHSIS M1 reporting
- Early-warning analytics and a barangay community health map
- Resident, household, and document APIs with scope-aware access

The actual behavior available in a deployment depends on its Supabase
configuration and applied migrations. The migration state of any linked remote
project must be checked separately.

## User Roles

The canonical role identifiers are defined in `backend/src/config/roles.js` and
mirrored by the frontend.

| Role | Main responsibilities |
| --- | --- |
| `admin` | User, role, and system administration |
| `mho` | Municipality-wide resident, referral, reporting, M1, and community analytics access |
| `phn` | Clinical workflows, resident verification, referrals, follow-up, intake processing, and municipality-wide analytics |
| `health_supervisor` | Barangay-scoped resident, household, verification, clinical, intake, triage, referral, follow-up, and analytics workflows |
| `rhu_personnel` | RHU intake, triage, and authorized reporting workflows |
| `bhw` | Household and community data collection, intake, and permitted M1 data entry |
| `resident` | Own profile, registration and verification status, and authorized resident self-service |

`resident-limited` is a restricted account state for residents awaiting
verification, not a separate staff role.

## Technology Stack

- **Frontend:** React 18, JavaScript, Vite, Tailwind CSS, React Router, React
  Query, Recharts, React Leaflet, and Lucide React
- **Backend:** Node.js 22+, JavaScript ES modules, Express, Multer, Nodemailer,
  and the Supabase JavaScript client
- **Database and identity:** Supabase Auth and PostgreSQL, with versioned SQL
  migrations and Row Level Security policies
- **Validation:** Node.js built-in test runner, ESLint, TypeScript type
  checking, and the Vite production build

## Repository Structure

```text
frontend/   React application, feature pages, and API clients
backend/    Express API, services, and repositories
supabase/   Supabase configuration, seed data, and ordered SQL migrations
docs/       Database, backend, and integration documentation
```

The Express API is organized by route, controller, service, and repository.
Frontend feature modules call backend endpoints through shared API clients.

## Setup

### Requirements

- Node.js 22 or newer (the locked Supabase client dependencies require Node 22+)
- npm
- A Supabase project for authentication and database-backed workflows
- Supabase CLI for linking a project and applying migrations

### Install

```bash
git clone <repository-url>
cd KALUSAGAP
npm run install:all
```

`install:all` installs both the frontend and backend dependencies.

### Configure environment

Copy the safe templates:

```powershell
Copy-Item frontend\.env.example frontend\.env
Copy-Item backend\.env.example backend\.env
```

Set the API base URL and public Supabase values in `frontend/.env`:

```env
VITE_API_URL=http://localhost:5000/api
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Set the matching project URL and server credentials in `backend/.env`:

```env
PORT=5000
CLIENT_URL=http://localhost:5173
NODE_ENV=development
TRUST_PROXY=loopback
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

The development API permits both `http://localhost:5173` and
`http://127.0.0.1:5173`; browsers treat those hostnames as different origins.
In production, set `CLIENT_URL` to the deployed frontend origin. `CORS_ORIGIN`
is an optional alias/additional-origin setting, not a second required variable.

Optional backend variables support a local JSON data directory for development
without Supabase; the full, annotated templates are in
[frontend/.env.example](frontend/.env.example) and
[backend/.env.example](backend/.env.example).

Never place the service-role key in frontend configuration or in a `VITE_`
variable. Real `.env` files are local and ignored by Git; only blank templates
belong in the repository. Supabase-backed sign-in and protected workflows
require the frontend and backend to use the same project.

### Apply database migrations

From the repository root, link the intended Supabase project and review its
migration state before applying changes:

```bash
supabase link --project-ref <project-ref>
supabase migration list --linked
supabase db push
```

`supabase db push` applies files in `supabase/migrations/` in version order; it
does not apply `supabase/seed.sql`. The seed file is for local database resets
and must not be run against production. Do not remove or reorder migration
history. The database and migration guide is in
[docs/database/README.md](docs/database/README.md); the manual resident-verification
workflow is documented in
[docs/integration/manual-resident-verification.md](docs/integration/manual-resident-verification.md).

### Run the applications

Start the API and frontend in separate terminals from the repository root:

```bash
npm run dev:backend
npm run dev:frontend
```

The API defaults to `http://localhost:5000`; Vite defaults to
`http://localhost:5173`.

## Development Commands

Run these from the repository root:

```bash
npm run dev:frontend
npm run dev:backend
npm run build
npm run preview
npm run lint
npm run start:backend
```

## Validation

Run lint, type-check, or build with:

```bash
npm run lint --prefix frontend
npm run typecheck --prefix frontend
npm run build --prefix frontend
```

The Vite production build provides the frontend production check; the backend
has no separate lint step. The `typecheck` script runs `tsc` in `checkJs` mode
over the JavaScript sources as an advisory diagnostic — the sources are plain
JavaScript, so it reports type-inference notices rather than gating the build.

## Security

- Supabase Auth identifies users; the backend resolves application roles and
  scope from the server-side profile, never from client input.
- Backend authorization and database Row Level Security are separate controls;
  frontend route guards are not security boundaries.
- The Supabase service-role key stays on the server. It bypasses RLS and must
  never be exposed to the browser.
- Analytics are aggregated by municipality or barangay and must not return
  resident-level personally identifiable information.
- Request logging omits query strings, bodies, headers, tokens, and health data.
- Registration documents live in a private storage bucket and are served only
  through backend-mediated signed URLs.

## Deployment

The frontend is a static Vite single-page application. `vercel.json` configures
Vercel to install the frontend from its lockfile, build it, serve
`frontend/dist`, and rewrite client-side routes to `index.html`.

The Express API in `backend/` is a separate Node.js service and is deployed and
scaled independently of the frontend. Set the frontend `VITE_API_URL` to the
deployed API origin **including `/api`** (for example,
`https://kalusagap.onrender.com/api`); the Express app mounts all routes under
`/api`, including `/api/auth/me` and `/api/roles/permissions`. The frontend also
normalizes a bare API origin by appending `/api`, but including the mount in the
deployment setting makes the contract explicit. Set the backend's `CLIENT_URL`
to the deployed frontend origin so CORS permits it. For the current deployment,
configure the hosting dashboards as follows. These settings are instructions
only; this repository change does not update either live service.

### Vercel

- Set the project root to the repository root and use Node.js 22.x.
- The checked-in `vercel.json` runs `npm ci --prefix frontend`,
  `npm run build --prefix frontend`, serves `frontend/dist`, and keeps SPA
  route rewrites.
- Set these variables for the **Production** environment:

  ```env
  VITE_API_URL=https://kalusagap.onrender.com/api
  VITE_SUPABASE_URL=https://<project-ref>.supabase.co
  VITE_SUPABASE_ANON_KEY=<public-anon-key>
  ```

  `VITE_API_URL` has a code fallback to the Render API, but setting it
  explicitly avoids an accidental build against an unintended API. Supabase
  URL and anon key must belong to the same project as Render. The anon key is
  public; **never** set `SUPABASE_SERVICE_ROLE_KEY` or any database credential
  in Vercel or a `VITE_` variable. A production Vite build now fails early if
  either Supabase value is missing. Use separate non-production credentials
  for Preview deployments if previews are enabled.

### Render

- Create/use a Node web service with repository root as its root directory,
  Node.js 22.x, build command `npm ci --prefix backend`, and start command
  `npm run start --prefix backend`.
- Set the health-check path to `/api/health`. Render supplies `PORT`; do not
  hard-code a production port.
- Set these runtime variables:

  ```env
  NODE_ENV=production
  CLIENT_URL=https://kalu-zeta.vercel.app
  TRUST_PROXY=1
  SUPABASE_URL=https://<project-ref>.supabase.co
  SUPABASE_ANON_KEY=<public-anon-key>
  SUPABASE_SERVICE_ROLE_KEY=<server-only-service-role-key>
  ```

  `TRUST_PROXY=1` trusts the single Render edge proxy hop so Express can use
  the client IP for rate limits. Do not use `true` or a larger hop count unless
  the full proxy chain is verified and strips client-supplied forwarding
  headers. Add `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM` if the
  transfer-OTP email workflow is configured.

### Supabase dashboard and database

- In **Authentication → URL Configuration**, set the Site URL to
  `https://kalu-zeta.vercel.app` and allow the exact redirect URLs
  `https://kalu-zeta.vercel.app` and
  `https://kalu-zeta.vercel.app/reset-password`. Add any separately deployed
  custom frontend domain explicitly.
- Use the same Supabase project URL and matching anon/service-role keys across
  the two services. Store the service-role key only as a Render secret.
- Before rollout, review `supabase migration list --linked` against the
  intended project and back up/review pending SQL. Applying migrations with
  `supabase db push` changes the remote database; do that only with explicit
  authorization and the project's approved change procedure. No production
  migration or data operation is performed by these deployment instructions.

After setting dashboard values, trigger deployments and verify Vercel's
production build, `https://kalusagap.onrender.com/api/health`, browser sign-in,
role-scoped pages, CORS requests, and the approved database workflows. The
health endpoint only confirms the API process is responding; it does not prove
that Supabase connectivity, migrations, credentials, or user workflows are
healthy. The API URL also has a frontend production fallback, but explicitly
setting it in Vercel is recommended. Do not treat a cold-start response or a
successful health check as an end-to-end verification.

## Scope and Limitations

- Selected workflows support encrypted offline drafts and owner-scoped
  synchronization in IndexedDB. Authentication, server-authoritative reads,
  and mutations not explicitly marked safe for offline synchronization still
  require a network connection; this is not a full offline application.
- Access is strictly role-scoped and enforced server-side. Frontend route guards
  hide navigation but are not the security boundary.
- Resident and personnel onboarding is by application plus manual review; there
  is no self-service account provisioning that bypasses verification.
- Community and map analytics are aggregated by municipality or barangay and do
  not expose resident-level personally identifiable information.
- The user-facing "Household Risk Clusters" view has been removed; household
  profiling and the retained household risk overview/detail pages remain.
- Resident document uploads pass through **rule-based automated document
  screening** (allowed file type, readable-image and text checks) before queued
  manual review. This is a readability pre-check only — it is **not AI document
  authentication** and **not automatic government ID verification**. Final
  document and identity verification always remains with authorized KALUSAGAP
  personnel, and an automated flag never prevents a staff member from reviewing
  a document.



- [Database and migrations](docs/database/README.md)
- [Backend overview](docs/backend/README.md)
- [Manual resident verification](docs/integration/manual-resident-verification.md)
