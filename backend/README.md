# KALUSAGAP Backend (API)

Express.js API for **KALUSAGAP: Community Health Risk Monitoring and Early
Intervention System** (Municipal Health Office, Pili, Camarines Sur).

## Purpose

This is the backend **foundation**. It boots, answers a health check, applies
CORS, and establishes the folder layout and conventions that the real endpoints
will follow. It contains no database code and no business logic, because the
PostgreSQL schema and ERD are still being finalized by the team.

The React app in `frontend/` continues to run on its local mock datasets and
does not call this API yet.

## Technologies

| Package    | Why                                                        |
| ---------- | ---------------------------------------------------------- |
| Node.js 18+| Runtime (ES Modules, `"type": "module"`)                     |
| Express.js | HTTP server, routing, middleware                            |
| cors       | Allow the React dev server to call the API                  |
| dotenv     | Load `.env` so no configuration is hardcoded                |
| nodemon    | Dev-only auto-restart on file changes                       |

No other dependencies. No Supabase client, no auth library, no ORM yet.

## Installation

```bash
cd backend
npm install
cp .env.example .env      # PowerShell: Copy-Item .env.example .env
```

## Environment variables

`.env` is git-ignored. Only `.env.example` is committed, and it holds no real
values.

| Variable     | Default                 | Purpose                              |
| ------------ | ----------------------- | ------------------------------------ |
| `PORT`       | `5000`                  | Port the API listens on              |
| `CLIENT_URL` | `http://localhost:5173` | Allowed CORS origin(s), comma-separated |
| `NODE_ENV`   | `development`           | `development` \| `test` \| `production` |

Database variables are deliberately absent until the real Supabase project
exists. When it does, add them to `.env` and `.env.example` (keys empty) and read
them through `src/config/env.js`.

## Commands

```bash
npm run dev     # development — nodemon restarts on save
npm start       # production — plain node
```

Startup output:

```text
KALUSAGAP backend running in development mode
Listening on http://localhost:5000
Health check:  http://localhost:5000/api/health
Allowed origins: http://localhost:5173
```

## Endpoints

### `GET /api/health`

The only endpoint. Confirms the process is running; returns no user or health
data.

```bash
curl http://localhost:5000/api/health
```

```json
{
  "status": "ok",
  "message": "KALUSAGAP backend is running"
}
```

Unknown routes return JSON, not an HTML error page:

```bash
curl -i http://localhost:5000/api/nonexistent
# HTTP/1.1 404 Not Found
# {"error":{"message":"Route GET /api/nonexistent does not exist"}}
```

## Structure

```text
backend/src/
├── config/       env.js — the only place process.env is read
├── controllers/  health.controller.js — HTTP in / HTTP out, no logic
├── lib/          (empty) future third-party clients, e.g. lib/supabase.js
├── middleware/   errorHandler.js, notFoundHandler.js, requestLogger.js
├── routes/       index.js (central router) + health.routes.js
├── services/     health.service.js — business logic lives here
├── utils/        apiError.js, asyncHandler.js
├── validators/   (empty) future request validation
├── app.js        builds and exports the Express app
└── server.js     starts the HTTP listener
```

`lib/` and `validators/` are intentionally empty — the layout is documented so
the first real feature has an obvious home, without placeholder code that
pretends to do something.

## Adding a feature (once the ERD is final)

```text
Route → Controller → Service → Supabase/PostgreSQL
```

1. `routes/residents.routes.js` — endpoints only, handlers wrapped in `asyncHandler`.
2. `controllers/residents.controller.js` — read `req`, call the service, send JSON.
3. `services/resident.service.js` — the logic and the data access.
4. `validators/resident.validator.js` — validate input before the controller runs.
5. Mount the router in `routes/index.js`.

Conventions:

- Files: `camelCase.routes.js`, `camelCase.controller.js`, `camelCase.service.js`.
- Endpoints: plural, kebab-case — `/api/health-records`, `/api/follow-ups`.
- Methods: `GET` read · `POST` create · `PUT` replace · `PATCH` partial · `DELETE` remove.
- Errors: `throw ApiError.notFound('Resident not found')`. Never hand-build an
  error response in a controller; `middleware/errorHandler.js` formats them all.

Planned endpoint names, reserved but **not implemented**:

```text
/api/auth        /api/consultations      /api/reports
/api/users       /api/health-records     /api/notifications
/api/residents   /api/risk-assessments
/api/households  /api/follow-ups
```

## Security practices

- Never commit `.env`; never hardcode passwords, keys, or tokens.
- CORS is restricted to `CLIENT_URL` — never `origin: "*"`.
- Stack traces and internal error messages are suppressed when
  `NODE_ENV=production`; clients get a generic 500 message.
- `requestLogger` logs method, path, status, and duration only — never bodies,
  headers, tokens, or health information.
- When Supabase is added: the **service-role key stays server-side only**. It must
  never appear in `frontend/`, in a `VITE_` variable, or in a commit. Use Supabase
  Auth for credentials rather than hashing passwords here, and enforce access with
  Row Level Security in addition to API checks.
- Return only the fields a screen needs — do not spread whole database rows into
  responses.

## Current limitations

Intentionally **not** implemented, pending the finalized PostgreSQL schema/ERD:

- PostgreSQL tables and migrations
- Supabase connection and `src/lib/supabase.js`
- Authentication and role-based authorization
- Residents, households, consultations, health-records, risk-assessments,
  follow-ups, notifications, reports, and users endpoints
- Request validation (no request bodies to validate yet)
- Automated tests

Database functionality will be implemented after the PostgreSQL/ERD schema is
finalized by the team member handling it.
