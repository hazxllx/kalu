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
- **Backend:** Node.js 18+, JavaScript ES modules, Express, Multer, Nodemailer,
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

- Node.js 18 or newer
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
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

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

The CLI applies files in `supabase/migrations/` in version order and then the
reference data in `supabase/seed.sql`. Do not remove or reorder migration
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
a Vercel deployment that installs and builds the frontend, serves
`frontend/dist`, and rewrites all routes to `index.html` for client-side
routing. Set the `VITE_` environment variables in the hosting project settings.

The Express API in `backend/` is a separate Node.js service and is deployed and
scaled independently of the frontend. Set the frontend `VITE_API_URL` to the
deployed API origin **including `/api`** (for example,
`https://kalusagap.onrender.com/api`); the Express app mounts all routes under
`/api`, including `/api/auth/me` and `/api/roles/permissions`. The frontend also
normalizes a bare API origin by appending `/api`, but including the mount in the
deployment setting makes the contract explicit. Set the backend's `CLIENT_URL`
to the deployed frontend origin so CORS permits it. For the current production
deployment, use `VITE_API_URL=https://kalusagap.onrender.com/api` in Vercel and
`CLIENT_URL=https://kalu-zeta.vercel.app` in Render. The Supabase project
provides authentication and the PostgreSQL database for both.

## Scope and Limitations

- The application is online-only; it requires network access to the backend API
  and the Supabase project and has no offline mode.
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
