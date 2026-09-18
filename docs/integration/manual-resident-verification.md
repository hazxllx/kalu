# Manual resident verification

KALUSAGAP verifies resident registrations **manually**. A resident registers,
the Health Supervisor of their barangay reviews the submission, and approves or
rejects it. There is **no third-party KYC provider**.

> The former Didit KYC integration has been removed. Its database objects
> (`identity_verifications`, `didit_webhook_events`, and the `residents`
> `identity_*` / `didit_session_id` columns) are left in place but are
> deprecated and unused. No `DIDIT_*` environment variables are required.

## Workflow

```
Resident registers
  -> residents.verification_status = 'pending'   (submitted_for_verification_at set)
  -> Health Supervisor reviews (pending queue)
  -> approve  -> 'approved'  + profiles.status = 'active'             (full access)
     reject   -> 'rejected'  + profiles.status = 'pending_verification' (limited)
     resubmit request -> 'resubmission_required' + limited
  -> resident resubmits -> 'pending' again
```

Every approve/reject/resubmission/resubmit writes an immutable row to
`resident_verification_logs`.

## Resident status definitions

| Status | Meaning | Account access |
|---|---|---|
| `pending` | Submitted, awaiting review (default for new registrations) | Limited (`resident-limited`) |
| `approved` | Approved by the Health Supervisor | Full (`resident`) |
| `rejected` | Rejected with a required reason | Limited |
| `resubmission_required` | Reviewer asked for corrections | Limited |

Barangay/residency verification is the **same** concept here: approving a
resident confirms they belong to the barangay. Identity-document KYC is no
longer part of KALUSAGAP.

## Role permissions

| Role | May do |
|---|---|
| Resident / resident-limited | View own status + history; resubmit own rejected registration |
| Health Supervisor | List/read residents in their barangay; approve, reject, request resubmission |
| PHN | Same review rights as Health Supervisor, municipality-wide scope |
| BHW / RHU personnel | No approval rights (read access follows existing scope rules) |
| MHO / Admin | Oversight per existing policies; no manual bypass introduced |
| Service role (backend) | The only writer of `verification_status` and audit logs |

Authorization is enforced in the backend service **and** by RLS — hiding a
frontend button is never the control.

## API endpoints

Base: `/api/verifications` (replace `ref`/`id` with the resident id).

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/me` | resident | Own verification status + history |
| PATCH | `/:id/resubmit` | resident | Resubmit own rejected/resubmission registration |
| GET | `/queue?status=pending\|approved\|rejected\|resubmission_required\|all` | HS / PHN | Scoped queue |
| GET | `/pending` | HS / PHN | Pending queue (compat alias) |
| GET | `/history` | HS / PHN | Recent decisions |
| GET | `/:id` | HS / PHN | One resident's verification + history |
| GET | `/:id/history` | HS / PHN | One resident's history |
| PATCH | `/:id/approve` | HS / PHN | Approve |
| PATCH | `/:id/reject` | HS / PHN | Reject (`reason` required) |
| PATCH | `/:id/request-resubmission` | HS / PHN | Request resubmission (`reason` required) |
| POST | `/:ref/decision` | HS / PHN | Legacy `{decision: 'approved'\|'rejected'}` alias |

Transitions enforced server-side: `pending|resubmission_required → approved`,
`pending|resubmission_required → rejected`, `pending|rejected →
resubmission_required`, `rejected|resubmission_required → pending`. Anything
else returns `409`. The reviewer id always comes from the session.

## Database changes

Migration: `supabase/migrations/20260919100000_manual_resident_verification.sql`

- `residents.verification_status` default `'pending'`, check constrained to
  `pending / approved / rejected / resubmission_required`.
  Existing data migrated: `unverified → pending`, `verified → approved`.
- New columns: `verified_by` (FK `profiles`), `verified_at`, `rejection_reason`,
  `submitted_for_verification_at`.
- New table `resident_verification_logs`:
  `id, resident_id, reviewed_by, action (submitted|approved|rejected|resubmitted),
  reason, previous_status, new_status, created_at`, indexed by resident/reviewer/date.
- RLS: logs are **read-only** (resident reads own; HS/PHN/BHW read in scope;
  admin all). No insert/update/delete policies — only the service-role backend writes.
- Rollback block is at the bottom of the migration file.

## Applying the migration

```bash
supabase link --project-ref <your-project-ref>
supabase db push          # applies only pending migrations
```

Or paste the migration file into the Supabase **SQL Editor**. Do not re-apply
migrations that already ran.

## Required environment variables after Didit removal

`backend/.env` (server only):

```
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...   # never in a VITE_ variable
```

No Didit variables exist or are needed.

## Local testing

```bash
cd backend  && npm install && npm test && npm run dev     # :5000
cd frontend && npm install && npm run dev                 # :5173
```

Manual flow:

1. Register at `/register/new/step-1`; confirm the acknowledgment shows
   **Pending verification**.
2. Sign in as a **Health Supervisor** (profile `role = health_supervisor`,
   `status = active`, `barangay_id` set) and open
   `/app/health_supervisor/verifications`.
3. Review a pending resident, then **Approve** or **Reject** (reason required).
   Use **Request Resubmission** to send it back for correction.
4. As the resident, open **Verification Status**
   (`/app/resident-limited/verification` or `/app/resident/verification`) and
   refresh — the status and reason come from the database.

## Tests

```bash
cd backend && npm test
```

Covers: default pending, queue scoping, approve, reject-with/without reason,
duplicate decisions, audit-log creation, resident self-service, resident cannot
approve, unauthorized roles, cross-barangay denial, and status filter validation.

Frontend: `npm run lint`, `npm run build`.
