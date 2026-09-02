# KALUSAGAP

**Community Health Risk Monitoring and Early Intervention System**
Municipal Health Office — Municipality of Pili, Camarines Sur

KALUSAGAP is a full-stack JavaScript application for community health: a React
single-page app used by residents and health personnel, backed by an
Express.js REST API and Supabase (PostgreSQL, Auth, and Row Level Security).
It supports resident registration and verification, household profiling,
health records, consultations, triage, referrals, follow-ups, reporting, and
role-based dashboards for the Municipal Health Office.

---

## Project Status

The frontend UI is complete and, during development, renders from small local
mock datasets. The backend now has a real authentication + role-based
authorization pipeline and a full REST API surface, but the domain endpoints
are intentionally not wired to the database yet — they return `501 Not
Implemented` until the **verified ERD** is available. This is deliberate: the
code is *backend-ready*, not faking database results.

| Area | Status | Notes |
| --- | --- | --- |
| Frontend (React + Vite + Tailwind + Recharts + Lucide) | ✅ Implemented | Preserved existing UI; wired to real auth + protected routes |
| Backend (Node + Express REST API) | ✅ Implemented | App, middleware, auth, RBAC, route/controller/service layout |
| Supabase integration | ⚠️ Partial · 🔒 Requires configuration | Clients + Auth wired; set env vars to activate |
| Authentication (Supabase Auth) | ✅ Implemented (🔒 needs Supabase to go live) | Dev-auth fallback for local testing without Supabase |
| Authorization / RBAC | ✅ Implemented | Frontend `ProtectedRoute` + backend `authenticate`/`authorize` |
| Database (Supabase PostgreSQL) | ❌ Not implemented · REQUIRES VERIFIED ERD | No tables/queries invented; endpoints return 501 |
| Row Level Security (RLS) | ❌ Not implemented · REQUIRES VERIFIED ERD | Architecture prepared; policies pending schema |
| Mock data (development only) | ✅ Implemented | Minimal, clearly-fake datasets + test accounts |

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
│   │   │   └── mock/          minimal dev datasets + mockAccounts
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
- **Development fallback:** when `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
  are not set, the UI signs in against the local test accounts (see below). The
  role still comes from the matched account — no role picker, no hard-coded
  successful login. This path disappears automatically once Supabase env vars
  are provided.

---

## Requirements

Node.js 18 or newer, npm, and Git.

## Setup

```bash
git clone <repository-url>
cd KALUSAGAP
npm run install:all
```

Create the local environment files (each `.env` is git-ignored):

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

### Environment variables

Frontend (`frontend/.env`) — browser-safe only:

```
VITE_API_URL=http://localhost:5000/api
VITE_SUPABASE_URL=            # leave blank to use the dev-auth fallback
VITE_SUPABASE_ANON_KEY=       # public anon key ONLY — never the service-role key
```

Backend (`backend/.env`) — server-side secrets:

```
PORT=5000
CLIENT_URL=http://localhost:5173
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=    # SERVER ONLY. Never expose to the frontend or commit it.
```

## Run

```bash
# terminal 1 — API on http://localhost:5000
npm run dev:backend

# terminal 2 — web app on http://localhost:5173
npm run dev:frontend
```

Other scripts:

```bash
npm run build          # production build of the frontend into frontend/dist
npm run preview        # serve that build locally
npm run lint           # ESLint over the frontend
npm run start:backend  # run the API without file watching
```

---

## Authentication & Registration UI

### Login page
A single, centered login card (fits a 1366×768 viewport without scrolling):
KALUSAGAP branding, "Sign in to the portal", email + password, remember me /
forgot password, Sign In, and a "Register here" link. The former large blue
"Who uses this portal" panel was removed; its support contact now lives in a
small footer under the card. A collapsed-by-default **Demo Accounts** switcher
sits at the bottom of the card (see below). File:
`frontend/src/features/authentication/pages/Login.jsx`.

### Registration UI
Step 1 is a compact type selector with a clean two-step progress indicator
(Step 1 Registration Type → Step 2 Registration Information). The registration
form options (New resident, Transfer of residency, Health personnel account)
sit on the left; the selected form's short description, a compact requirements
preview, and the **Continue** button sit on the right — all within a normal
desktop viewport. File:
`frontend/src/features/registration/pages/RegistrationTypeSelection.jsx`.

### Demo Accounts (development / presentation only)
The login page has a collapsed **Demo Accounts** section. Expanding it lists the
test roles with a **Use Account** button that autofills the email and password
into the form — it does **not** auto-submit. The role is derived from the
account, never picked by the user. Accounts are defined once in
`frontend/src/services/mock/mockAccounts.js` (the same source used by the
dev-auth fallback). These are committed development credentials — never reuse
them in production.

| Role | Email |
| --- | --- |
| Administrator | admin@kalusagap.test |
| Municipal Health Officer | mho@kalusagap.test |
| Public Health Nurse | phn@kalusagap.test |
| Health Supervisor | supervisor@kalusagap.test |
| RHU Personnel | rhu@kalusagap.test |
| Barangay Health Worker | bhw@kalusagap.test |
| Resident 1 | resident1@kalusagap.test |
| Resident 2 | resident2@kalusagap.test |
| Resident 3 | resident3@kalusagap.test |

Passwords for these dev accounts are configured alongside the emails in
`frontend/src/services/mock/mockAccounts.js`. When Supabase is configured, sign
in with any account created in the Supabase dashboard (set the `role` in the
user's `app_metadata`); the dev-auth fallback (any password) applies only when
Supabase env vars are absent.

### Role visualization (for presentations)
1. Open the login page.
2. Expand **Demo Accounts**.
3. Click **Use Account** for a role (e.g. Health Supervisor).
4. Email and password populate automatically.
5. Click **Sign In**.
6. That role's dashboard opens. Unauthorized areas remain blocked by
   `ProtectedRoute` and the backend `authorize` middleware.

### UI/UX changes summary
- Removed the large "Who uses this portal" role panel from login.
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
- Kept the collapsed, keyboard-accessible demo-account switcher (autofill only)
  in the left login column.

---

## API


`GET /api/health` is public. `POST /api/auth/login`, `GET /api/auth/me`,
`POST /api/auth/logout` use Supabase Auth. Every other group is protected and
role-scoped and currently returns **501** (BACKEND READY / DATABASE PENDING —
REQUIRES VERIFIED ERD): `/api/users`, `/api/households`, `/api/residents`,
`/api/health-records`, `/api/assessments`, `/api/consultations`, `/api/triage`,
`/api/referrals`, `/api/follow-ups`, `/api/reports`, `/api/analytics`,
`/api/notifications`.

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

## Documentation

- [Architecture](docs/architecture/README.md)
- [API](docs/api/README.md)
- [Database](database/README.md)
- [Backend](backend/README.md)
