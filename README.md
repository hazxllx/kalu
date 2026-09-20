# KALUSAGAP

**Community Health Risk Monitoring and Early Intervention System**
Municipal Health Office — Municipality of Pili, Camarines Sur

KALUSAGAP is a full-stack JavaScript application for community health: a React
single-page app used by residents and health personnel, backed by an
Express.js REST API and Supabase (PostgreSQL, Auth, and Row Level Security).
It supports resident registration and verification, household profiling,
health records, consultations, triage, referrals, follow-ups, reporting, and
role-based dashboards for the Municipal Health Office.

## About This Project

KALUSAGAP is designed for the Municipal Health Office of Pili, Camarines Sur.
It gives residents a way to register and submit identity documents, while
authorized health personnel can manage household information, review resident
registrations, monitor health risks, and coordinate follow-up care. The system
uses server-side validation, role-based access control, Supabase Auth, and
database-level Row Level Security to protect health information.

The repository contains two applications:

- `frontend/` — React and Vite web application.
- `backend/` — Express REST API that serves the frontend and connects to
  Supabase.

---

## Project Status

The frontend UI is complete and renders **live data only**: there are no mock,
demo or fabricated datasets in the application. Every page shows a skeleton
while its data (or its code chunk) is loading and an empty state when a query
returns nothing. The backend has a real authentication + role-based
authorization pipeline and a REST API surface; domain endpoints that are not
connected yet return `501 Not Implemented` until the **verified ERD** is
available, and the pages connected to them show their empty state rather than
inventing rows. This is deliberate: the code is *backend-ready*, not faking
database results.

| Area | Status | Notes |
| --- | --- | --- |
| Frontend (React + Vite + Tailwind + Recharts + Lucide) | ✅ Implemented | Route-level code splitting with skeleton fallbacks; wired to real auth + protected routes |
| Backend (Node + Express REST API) | ✅ Implemented | App, middleware, auth, RBAC, route/controller/service layout |
| Supabase integration | ✅ Active · 🔒 Requires configuration | Clients + Auth wired; set env vars to activate |
| Authentication (Supabase Auth) | ✅ Implemented | The only sign-in path — no local, demo or mock accounts |
| Authorization / RBAC | ✅ Implemented | Frontend `ProtectedRoute` + backend `authenticate`/`authorize` |
| Database (Supabase PostgreSQL) | ⚠️ Partial · REQUIRES VERIFIED ERD | Reference + account tables live; remaining domain endpoints return 501 |
| Row Level Security (RLS) | ✅ Implemented | Policies on the deployed registry, account and clinical tables |
| Mock / demo data | ✅ Removed | No fabricated datasets or demo credentials remain in the app |

---

## Technology Stack

### Frontend
- React
- Vite
- JavaScript
- JSX / HTML
- Tailwind CSS
- React Router DOM
- Recharts
- Lucide React

### Backend
- Node.js
- Express.js
- REST API
- Supabase integration (`@supabase/supabase-js`)

### Database / Backend Service
- Supabase
- PostgreSQL (provided by Supabase)
- Supabase Authentication
- Row Level Security (RLS) — *pending verified schema*

### Development Tools
- npm
- Git
- GitHub
- Postman
- Visual Studio Code

---

## System Architecture

```text
Frontend  (React + Vite, Tailwind, Recharts, Lucide)
      │   UI components -> feature API modules
      ▼
API Client  (src/services/api/apiClient.js — one place, attaches Bearer token)
      ▼
Express.js / Node.js REST API
      │   route -> authenticate -> authorize(role) -> controller -> service
      ▼
Supabase
      ▼
PostgreSQL

Authentication:   Supabase Auth (email/password; role read from the account)
Authorization:    Frontend ProtectedRoute  +  Express authorize() middleware  +  Supabase RLS
```

Layer responsibilities:
- **Frontend** renders role-appropriate UI and guards navigation with
  `ProtectedRoute`. It never trusts itself for security — it is a UX layer.
- **API Client** is the single HTTP entry point; feature modules
  (`residentsApi`, `healthRecordsApi`, …) build on it so components never call
  `fetch` directly.
- **Express API** authenticates the Supabase access token, enforces role
  permissions, then delegates to services. Controllers stay thin.
- **Supabase** provides Auth and the PostgreSQL database; **RLS** is the final,
  database-level guard so data is protected even if a layer above is bypassed.

---

## Project Structure

```text
KALUSAGAP/
├── frontend/
│   ├── src/
│   │   ├── components/        shared UI: ui/, common/, tables/, branding/
│   │   ├── context/           AuthContext (Supabase Auth + dev fallback)
│   │   ├── features/          one folder per domain (pages/ + components/)
│   │   ├── layouts/           DashboardLayout
│   │   ├── lib/               roles.js (RBAC), supabase.js, brand.js, navConfig.js
│   │   ├── pages/             app-level pages (404, 403 Unauthorized)
│   │   ├── routes/            AppRoutes, ProtectedRoute, ScrollToTop
│   │   ├── services/
│   │   │   ├── api/           apiClient + feature API modules (real backend)
│   │   │   └── local/         empty in-session working sets (no demo data)
│   │   └── styles/            index.css (Tailwind)
│   └── package.json
│
├── backend/
│   ├── src/
│   │   ├── config/            env.js, supabase.js, roles.js
│   │   ├── routes/            index, auth, health (+ resource routers)
│   │   ├── controllers/       auth.controller, health.controller
│   │   ├── services/          auth.service, health.service
│   │   ├── middleware/        authenticate, authorize, validate, errorHandler, …
│   │   └── utils/             apiError, apiResponse, asyncHandler, resourceRouter, notImplemented
│   └── package.json
│
├── database/
│   ├── migrations/            (pending verified ERD)
│   └── seeds/
│
└── README.md
```

---

## Roles (RBAC)

The role is stored on the authenticated account and is **never** chosen at
login. Canonical ids live in `frontend/src/lib/roles.js` and
`backend/src/config/roles.js`.

| Role | Can access | Cannot access |
| --- | --- | --- |
| **admin** | Accounts, roles, access/permissions, system settings, audit, logs | Sensitive clinical records (least-privilege) |
| **mho** | Municipal dashboard, reports, health trends, referral monitoring | Direct clinical record editing |
| **phn** | Health records, assessments, referrals, follow-ups, reports | Admin/system, triage queue, household data collection |
| **health_supervisor** | Resident directory, verification, records, consultation, referrals, follow-ups, barangay monitoring / early warning, reports | Admin/system functions |
| **rhu_personnel** | Triage (dashboard + monitoring pages; dedicated triage UI pending), reports | Admin/system, unrelated admin functions |
| **bhw** | **Data collection only**: household profiling / community data | Resident directory, clinical records, consultation, triage, referrals, follow-ups, verification |
| **resident** | Own profile, own authorized records, services, consultations/referrals status, notifications | Any other resident's data; staff areas |

Enforcement is layered: `ProtectedRoute` (frontend) → `authenticate` +
`authorize` (backend) → Supabase RLS (database, pending schema).

---

## Authentication

- Primary: **Supabase Auth** (email + password). On success the app stores the
  session (Supabase persists + auto-refreshes it) and reads the application
  role from the account (`app_metadata.role`). Post-login redirect goes to the
  role's dashboard. Logout clears the session.
- Backend verifies the Bearer access token on every protected request via
  `authenticate`, then `authorize(roles)` checks the role. Requests fail closed
  (401/403), and when Supabase is not configured, protected endpoints return
  503 rather than allowing access.
- **No fallback accounts.** Supabase Auth is the only sign-in path. There are
  no demo, mock or shared test credentials in the repository. When
  `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are not set, the login page
  reports that authentication is not configured and refuses to sign in.
- **Loading states.** While the session is being restored the guarded routes
  render a skeleton; each route's page component is code-split and shows a
  skeleton while its chunk loads; and pages fetching API data show table/card
  skeletons until the request settles.

---

## Run The Project

### Requirements

- Node.js 18 or newer
- npm
- A Supabase project for authentication and database-backed features

### 1. Install dependencies

```bash
git clone <repository-url>
cd KALUSAGAP
npm run install:all
```

### 2. Create environment files

Each `.env` file is local and git-ignored. From the repository root, run the
matching command for your shell:

```powershell
# Windows PowerShell
Copy-Item frontend\.env.example frontend\.env
Copy-Item backend\.env.example backend\.env
```

```bash
# macOS / Linux
cp frontend/.env.example frontend/.env
cp backend/.env.example backend/.env
```

### 3. Configure environment variables

Frontend (`frontend/.env`) — browser-safe only:

```
VITE_API_URL=http://localhost:5000/api
VITE_SUPABASE_URL=            # Supabase project URL
VITE_SUPABASE_ANON_KEY=       # public anon key only; never use the service-role key
```

Backend (`backend/.env`) — server-side secrets:

```
PORT=5000
CLIENT_URL=http://localhost:5173
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=    # SERVER ONLY. Never expose to the frontend or commit it.
```

The frontend and backend must use the same Supabase project. Do not put the
backend service-role key in `frontend/.env`.

### 4. Start both applications

Open two terminals in the repository root:

```bash
# Terminal 1: API on http://localhost:5000
npm run dev:backend
```

```bash
# Terminal 2: web app on http://localhost:5173
npm run dev:frontend
```

Open `http://localhost:5173` in a browser. The backend health endpoint is
available at `http://localhost:5000/api/health`.

### Useful commands

```bash
npm run build                         # build the frontend for production
npm run preview                       # preview the production frontend build
npm run lint                          # lint the frontend
npm run start:backend                 # start the backend without watching
npm test --prefix backend             # run backend tests
npm run typecheck --prefix frontend   # check frontend types/configuration
```

To run the frontend and backend in production-like mode:

```bash
# Terminal 1
npm run build
npm run preview

# Terminal 2
npm run start:backend
```

### Troubleshooting

- **Port already in use:** stop the process using port `5000` or `5173`, or
  change `PORT` in `backend/.env` and `VITE_API_URL` in `frontend/.env` to
  match.
- **Authentication unavailable:** check that all Supabase variables are set
  in both environment files, then restart both development servers.
- **API requests fail from the browser:** confirm the backend is running and
  that `VITE_API_URL` ends with `/api`.
- **Database errors:** apply the required Supabase migrations and confirm the
  backend service-role key belongs to the configured project.

---

## Authentication & Registration UI

### Login page
A single, centered login card (fits a 1366×768 viewport without scrolling):
KALUSAGAP branding, "Sign in to the portal", email + password, remember me /
forgot password, Sign In, and a "Register here" link. There are no demo
credentials and no account switcher: the role is always resolved from the
authenticated Supabase account. File:
`frontend/src/features/authentication/pages/Login.jsx`.

### Registration UI
Step 1 is a compact type selector with a clean two-step progress indicator
(Step 1 Registration Type → Step 2 Registration Information). The registration
form options (New resident, Transfer of residency, Health personnel account)
sit on the left; the selected form's short description, a compact requirements
preview, and the **Continue** button sit on the right — all within a normal
desktop viewport. File:
`frontend/src/features/registration/pages/RegistrationTypeSelection.jsx`.

### Creating accounts
Accounts are created in Supabase Auth (dashboard, CLI, or the admin API). A
trigger creates the matching `profiles` row; an administrator then sets the
account's `role` and `status`. Sign in with the account's email and password —
the portal derives the role from the `profiles` table.

### Loading & empty states
- Session restore: guarded routes render a skeleton until the session and the
  account profile are resolved.
- Navigation: each page is code-split; its chunk loads behind a skeleton.
- Data: tables, cards and charts show skeletons while their API request is in
  flight, and an explicit empty state when the query returns no rows.

### UI/UX changes summary
- Removed the large "Who uses this portal" role panel from login.
- Removed the demo-account switcher and all mock credentials.
- Redesigned login and registration as a modern **split card** on a deep-navy
  KALUSAGAP background: left = the form (login) or the type selector +
  requirements (registration); right = a navy visual storytelling panel with a
  short KALUSAGAP message and an existing community/health illustration
  (`team-spirit` / `medicine`). The visual panel is desktop-only; on mobile both
  pages collapse to a single clean column (no side-by-side columns, no
  horizontal overflow).
- Rounded card, soft shadow, subtle input focus rings, and a faint guilloche +
  radial background depth for a premium institutional feel.
- Registration keeps its two-step progress indicator, three selectable form
  cards, "What you'll need" requirements, and a "Processing time" note.

---

## API


`GET /api/health` is public. `POST /api/auth/login`, `GET /api/auth/me`,
`POST /api/auth/logout` use Supabase Auth.

Connected groups (real database-backed endpoints, role-scoped):
`/api/residents`, `/api/households`, `/api/intake`, `/api/phn`,
`/api/verifications`, `/api/analytics`.

Groups whose verified schema is not connected yet are protected and
role-scoped but return **501** (BACKEND READY / DATABASE PENDING — REQUIRES
VERIFIED ERD): `/api/users`, `/api/health-records`, `/api/assessments`,
`/api/consultations`, `/api/triage`, `/api/referrals`, `/api/follow-ups`,
`/api/reports`, `/api/notifications`. Screens backed by those groups render
their loading skeleton and then an empty state — never fabricated rows.

---

## Security

- Never commit `.env`. Only `.env.example` belongs in Git.
- Only `VITE_`-prefixed variables reach the browser; anything in them is public.
- The Supabase **service-role key** is backend-only. It must never appear in
  `frontend/`, in a `VITE_` variable, or in a commit.
- Validate every API input on the server; client-side checks are for UX only.
- Enforce access with backend `authorize()` plus Supabase Row Level Security.
- Return only the fields a screen needs; never log passwords, tokens, or health
  information.
- Use Supabase Auth for credentials — do not store or hash passwords manually.
- No demo, sample or shared credentials are committed. Sign-in is Supabase Auth
  only, and a deployment without Supabase configuration refuses to sign in.

## Documentation

- [Architecture](docs/architecture/README.md)
- [API](docs/api/README.md)
- [Database](database/README.md)
- [Backend](backend/README.md)
