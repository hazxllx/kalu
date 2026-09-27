# Backend overview

The backend is an Express API (Node.js, ES modules) that uses the Supabase
JavaScript client for authentication and PostgreSQL access. Every request goes
through the same layers:

```
route -> authenticate -> authorize(roles) -> controller -> service -> repository
```

- `authenticate` verifies the Supabase JWT and loads the caller's active profile
  (role, status, municipality/barangay). The role is always read from the
  database, never from client input.
- `authorize(roles)` checks the caller's role against the feature's allowed
  roles (`src/config/roles.js`).
- Services hold the business rules and barangay/municipality scope checks;
  repositories talk to the database (a Supabase driver, with a JSON file driver
  for local development when Supabase is not configured).

Routes are mounted under `/api` in `src/routes/index.js`. `/api/health` is
public; everything else requires authentication.

## Implemented API groups

- `/api/auth` — session and profile resolution.
- `/api/registration` — resident self-registration and linked resident record.
- `/api/verifications` — manual resident verification (Health Supervisor / PHN).
- `/api/residents` — master resident directory (PHN / Health Supervisor / MHO).
- `/api/households` — household profiling: BHW collection, Health Supervisor
  verification with reasons, server-computed risk, and an audit trail.
- `/api/consultations` — clinical consultations with server-side vitals and
  follow-up validation.
- `/api/operational` — follow-ups, TCL, maternal records, immunizations, and
  notifications (staff writes, per-recipient notification reads).
- `/api/resident` — resident self-service follow-ups (list/read own,
  approve/reject); ownership is derived from the session.
- `/api/referrals` — referral coordination (`health_referrals`), barangay-scoped.
- `/api/m1` — FHSIS M1 monthly report recording and aggregation.
- `/api/intake` and `/api/phn` — the RHU intake to PHN processing workflow.
- `/api/analytics` — barangay-level aggregates and early-warning signals for the
  community health map (aggregate-only, no resident-level detail).
- `/api/users` — admin user management on the `profiles` table.
- Document upload/review and residency-transfer requests.

## Audit trail

Domain actions are written to `health_audit_logs` (households, referrals,
operational records, M1). Resident verification and transfer decisions have
their own append-only log tables (`resident_verification_logs`,
`transfer_request_audit_logs`).

## Not yet backed by the API

A few admin/clinical screens still use the frontend mock stores under
`frontend/src/services/local/` and are not connected to storage yet. The
corresponding legacy resource routes return `501`:

- staff registration requests and Health Supervisor *account* verification
- medical certificate status history
- resident PhilPEN assessment results and resident health-record export

These are future work, not part of the current backend.

## Tests

Backend tests use the Node.js built-in test runner:

```bash
npm test --prefix backend
```
