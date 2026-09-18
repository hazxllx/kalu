# API

Base URL: `http://localhost:5000/api` in development, configured in the frontend
through `VITE_API_URL`.

## Implemented

| Method | Endpoint | Description | Auth |
| ------ | ------------- | ---------------------------------- | ---- |
| GET    | `/api/health` | Confirms the API process is running | none |
| POST   | `/api/auth/login` | Email + password → Supabase session + profile user | none |
| GET    | `/api/auth/me` | Current user: role, status, municipality/barangay/facility scope (from `profiles`) | Bearer |
| POST   | `/api/auth/logout` | Revokes the current session | Bearer |
| GET    | `/api/residents` | Directory listing + search (`?q=&barangay=&limit=&offset=`), scope-enforced | HS / PHN / MHO |
| POST   | `/api/residents` | Register a resident (validated 422, scope-checked 403, duplicate 409) | HS / PHN / MHO |
| GET    | `/api/residents/:id` | Single resident within the caller's scope | HS / PHN / MHO |
| PUT    | `/api/residents/:id` | Permitted demographic corrections (identity keys locked) | PHN / HS |
| GET    | `/api/households` | Household listing + search (`?q=&barangay=&limit=&offset=`), scope-enforced | BHW / HS / PHN |
| POST   | `/api/households` | Register a household (server-allocated `HH-` id, server-computed risk, duplicate 409) | BHW / HS / PHN |
| GET    | `/api/households/:id` | Household detail incl. members (out-of-scope = 404) | BHW / HS / PHN |
| PUT    | `/api/households/:id` | Field updates; verification outcomes HS-only | BHW / HS / PHN |
| POST   | `/api/households/:id/members` | Add a member (existing resident or free-form; duplicate member 409) | BHW / HS / PHN |
| DELETE | `/api/households/:id/members/:memberId` | Remove a household member | BHW / HS / PHN |
| GET    | `/api/intake/residents/search` | Identity prefill lookup for the intake form | BHW / RHU / HS |
| POST   | `/api/intake/visits` | Create a draft visit submission (vitals; BMI computed server-side) | BHW / RHU / HS |
| POST   | `/api/intake/visits/:id/submit` | Validate + lock + hand off to the PHN queue | BHW / RHU / HS |
| GET/PUT | `/api/phn/submissions…` | PHN queue listing + processing | PHN |
| GET    | `/api/verifications/queue?status=` | Resident verification queue: pending/approved/rejected/resubmission_required (barangay-scoped) | HS / PHN |
| GET    | `/api/verifications/pending` / `history` | Pending queue / recent decisions (compat) | HS / PHN |
| GET    | `/api/verifications/:id` (+ `/:id/history`) | One resident's verification record + audit history | HS / PHN |
| PATCH  | `/api/verifications/:id/approve` | Approve a resident (activates the account) | HS / PHN |
| PATCH  | `/api/verifications/:id/reject` | Reject a resident (`reason` required) | HS / PHN |
| PATCH  | `/api/verifications/:id/request-resubmission` | Send a registration back for correction (`reason` required) | HS / PHN |
| POST   | `/api/verifications/:ref/decision` | Legacy approve/reject alias | HS / PHN |
| GET    | `/api/verifications/me` | Resident's own verification status + history | Resident |
| PATCH  | `/api/verifications/:id/resubmit` | Resident resubmits own rejected registration | Resident |
| GET    | `/api/analytics/early-warning` | Early-warning aggregates (barangay-scoped) | MHO / HS |

Status codes: `401` missing/invalid token · `403` authenticated but unauthorized
(role, account state, or scope) · `404` unavailable/out-of-scope record · `409`
duplicate · `422` validation errors (`error.details` lists field messages) ·
`500` unexpected server error.

## Planned endpoints

Keep these names exactly as written so the frontend, docs, and Postman
collection do not drift apart:

```text
/api/auth              /api/consultations       /api/reports
/api/users             /api/health-records      /api/notifications
/api/residents         /api/risk-assessments
/api/households        /api/follow-ups
```

## Conventions

- Plural, kebab-case paths: `/api/health-records`, `/api/follow-ups`.
- `GET` read · `POST` create · `PUT` replace · `PATCH` partial update · `DELETE` remove.
- Collection: `GET /api/residents`. Single item: `GET /api/residents/:id`.
  Nested: `GET /api/residents/:id/health-records`.
- Filtering, paging, and sorting go in the query string:
  `?barangay=san-jose&page=2&limit=20&sort=-created_at`.
- No verbs in paths. `POST /api/follow-ups/:id/complete` is acceptable for a
  state transition that is not a plain update; `POST /api/getResidents` is not.

## Response shape

Success:

```json
{ "data": { } }
```

Error (produced by `backend/src/middleware/errorHandler.js`):

```json
{ "error": { "message": "Resident not found" } }
```

Status codes: `200` ok · `201` created · `204` deleted · `400` validation ·
`401` not authenticated · `403` wrong role · `404` missing · `409` conflict ·
`500` unexpected.

## Privacy

Return only the fields a screen needs — never spread a whole database row into a
response. List endpoints for wide audiences should omit identifiers such as full
address, contact number, and diagnosis details. Never place personal or health
information in a URL path or query string, since those end up in server logs.

## Postman

Keep one collection per feature group, using a `{{baseUrl}}` variable rather than
hardcoded hosts, and store tokens in a Postman environment — not in the exported
collection file.
