# Architecture

KALUSAGAP is a full-stack JavaScript application split into two deployable
parts plus shared database and documentation folders.

```text
KALUSAGAP/
├── frontend/   React 18 + Vite + Tailwind single-page app
├── backend/    Express.js API (skeleton)
├── database/   Supabase/PostgreSQL migrations, seeds, RLS notes
└── docs/       architecture, api, database
```

## Current state

The React app is complete as a UI and renders from local mock datasets in
`frontend/src/services/mock/`. The backend is a working skeleton exposing only
`GET /api/health`; Supabase is not wired up yet, and login navigates by selected
role instead of authenticating. Treat every "service" boundary below as the
place where real data access is meant to land.

## Intended request flow

```text
React component
  └─ feature service (frontend/src/features/<feature>/services or src/services)
       └─ apiClient (frontend/src/services/apiClient.js)
            └─ Express route  (backend/src/routes)
                 └─ controller (backend/src/controllers)
                      └─ service (backend/src/services)
                           └─ Supabase / PostgreSQL
```

Rules that keep this flow intact:

- Components do not call `fetch` directly.
- Routes contain no business logic.
- Controllers translate HTTP to service calls and back — nothing else.
- Services own the logic and are the only layer that talks to the database.

## Frontend organization

```text
frontend/src/
├── assets/       images and illustrations imported by components
├── components/   shared, feature-agnostic UI
│   ├── ui/         shadcn/ui primitives (generated — do not restructure)
│   ├── common/     Card, Icon, PageHeader, StatCard, StatusBadge
│   ├── tables/     DataTable
│   └── branding/   GovSeal, GovChrome, GovIllustration, GovInfoBar
├── context/      React context providers (AuthContext)
├── features/     one folder per domain, each with pages/ and components/
├── hooks/        shared hooks
├── layouts/      DashboardLayout (role shell), AuthLayout
├── lib/          app-wide config and constants (brand, navConfig, utils)
├── pages/        app-level standalone pages (NotFoundPage)
├── routes/       AppRoutes (route table), ProtectedRoute, ScrollToTop
├── services/     data access — apiClient + mock/ datasets
├── styles/       index.css (Tailwind layers and CSS variables)
└── utils/        small pure helpers
```

Features present today: `analytics`, `appointments`, `authentication`,
`consultations`, `dashboards`, `follow-ups`, `health-records`,
`health-services`, `households`, `landing`, `notifications`, `referrals`,
`registration`, `reports`, `residents`, `settings`, `users`, `verification`.

Where a component belongs:

- Used by two or more features and domain-agnostic → `src/components/`.
- Specific to one domain → `src/features/<feature>/components/`.
- A routed screen → `src/features/<feature>/pages/`.

Add `services/`, `hooks/`, or `utils/` inside a feature only when that feature
actually needs them. Empty placeholder folders are not created.

## Routing and roles

`frontend/src/routes/AppRoutes.jsx` is the single route table. Public routes sit
at the top level; authenticated areas are nested under `/app/<role>` and render
inside `DashboardLayout`, which resolves the sidebar for the role from
`frontend/src/lib/navConfig.js`.

Roles: resident (verified), resident-limited (pending verification), bhw,
midwife, rhu, mho, admin. Definitions live in `frontend/src/lib/brand.js`
(labels and base paths). The server has no role table yet — add one under
`backend/src/config/` with the first authenticated endpoint, and keep it in sync
with the frontend list.

Authentication and authorization are deliberately separate concerns:

```text
Authentication → identify the user → resolve their role
Authorization  → check the role against the resource → allow or deny
```

Neither is implemented yet. When they are, authentication belongs in a
middleware that sets `req.user`, and authorization in a separate middleware that
checks `req.user.role` — so the two can be changed and tested independently.
Note that the frontend route guard and `ProtectedRoute` are UX, not security
boundaries; the database (RLS) and the API are.

## Notifications

`frontend/src/features/notifications/` renders the in-system notification feed,
currently backed by `frontend/src/services/mock/notificationData.js`.

The structure is ready for expansion without rework: add
`backend/src/services/notification.service.js` plus
`backend/src/routes/notifications.routes.js`, keep every notification type
(in-system, follow-up reminders, health alerts) flowing through that one
service, and have the frontend read it through `apiClient`. Web push can then be
added as one more delivery channel inside the service. No push provider is
installed.
