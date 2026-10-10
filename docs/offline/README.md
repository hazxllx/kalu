# Offline-First Support

This document describes the offline-first layer added to KALUSAGAP. It is
additive: Supabase Auth, the Express API, Row Level Security, existing roles,
routes, and all online workflows remain authoritative. Offline support is
layered on top of the existing `@/services/api/*` clients — components still
never call `fetch` directly.

## Architecture

```
React component (e.g. AddHouseholdPage)
        │  calls
        ▼
Offline-aware service  (src/services/offline/householdOfflineService.js)
        │  online: existing authorized API call (unchanged behavior)
        │  offline/transport failure: queue locally
        ▼
Dexie / IndexedDB       (src/services/offline/db.js)
  drafts · outbox · records · syncMeta · keys
        ▲
        │  read/written by
Sync engine             (syncEngine.js → syncRunner.js → handlers.js)
        │  sends SAFE_SYNC through a registered handler and existing API
        ▼
Express API → Supabase (current authentication, role, scope, validation)
```

## Mutation tiers and current coverage

The role-by-role mutation inventory is maintained in
[`ROLE-AUDIT.md`](./ROLE-AUDIT.md). It is incremental and does not mean every
role or workflow is offline-ready.

`SAFE_SYNC`, `OFFLINE_DRAFT`, and `ONLINE_ONLY` classify behavior; they are not
roles or permissions. No tier grants API access. A mutation only synchronizes
through a registered handler and the existing authenticated endpoint, which
re-reads the current profile and applies its route/service authorization. The
frontend defaults mutations to online-only. It does not mirror or replace the
backend permission matrix.

| Existing workflow / role | Current access and server scope | Offline classification |
| --- | --- | --- |
| Household creation and factual household edits — BHW, Health Supervisor, PHN | Existing `/households` role/permission checks; BHW and Health Supervisor are bound to their assigned barangay, PHN to their municipality. | Create and allow-listed factual updates: `SAFE_SYNC`. Verification, approval, status decisions, deletes, and scope/identity fields are never queued. |
| Follow-up schedule creation and factual edits — Health Supervisor and PHN | Existing `/operational/followups` permission and resident-scope checks; idempotency middleware protects retries. | Create and non-terminal schedule edits: `SAFE_SYNC`. Completion, cancellation, rejection, and other consequential status decisions remain online-only unless the server accepts the queued transition. |
| Household member measurements — BHW, Health Supervisor, PHN, subject to the existing `residents.edit` permission and household scope | Same household route gate; service rechecks the parent household and verified-household restrictions. BMI is recomputed by the server. | Height, weight, and factual remarks: `SAFE_SYNC`. Death/trans-out fields remain online-only. |
| Household member add/remove — BHW, Health Supervisor, PHN | Add uses the existing create permission and parent scope; remove uses create/verify permission. | Not currently registered as an offline handler. Remove is destructive and online-only. |
| M1, resident verification, risk-workflow and other community workflows — BHW/Health Supervisor/PHN as individually authorized | Existing route role/permission checks plus barangay or municipality filtering and corresponding RLS policies. | Online-only until a workflow-specific retry-safe handler is audited and registered. Review/approval/escalation actions must not be automatically committed. |
| Intake, triage, and consultation — BHW/RHU Personnel/Health Supervisor and PHN/RHU Personnel according to the individual route | Existing intake-owner rules, facility binding where applicable, and current route/service checks. | No offline handler is currently registered. Clinical data may only be an `OFFLINE_DRAFT` when the feature has a server draft endpoint that preserves draft state; no draft is finalized by the sync runner. |
| Referral, follow-up, reports, certificates, account/role/permission administration — each route's existing role gate | Existing API validation and record/municipality/barangay/facility scope; the route and RLS policies remain authoritative. | Online-only for submission, approval/rejection, notifications, account/permission changes, deletes, and other consequential actions. Preparation is not auto-submitted. |
| Resident self-service | Owner-only endpoints; registration/transfer/follow-up state transitions use their existing staff/server review flows. | No offline mutation handler is currently registered. Locally prepared drafts must not be submitted or treated as approved offline. |
| Midwife | Not present in the canonical backend role list, route role map, or current profile role enum. | No offline access is granted. |

## Existing role authorization audit

This summarizes the existing online API contract relevant to offline work.
Route-level role/permission checks and service-level record checks are the API
authority; RLS is an additional database boundary. The service-role API client
bypasses RLS, so backend scope checks must not be replaced by client filtering.

| Role | Modules and records visible | Create / update | Delete | Facility / municipality / barangay scope | Existing enforcement |
| --- | --- | --- | --- | --- | --- |
| **BHW** | Household profiles and members in the assigned barangay; identity-only resident search/intake; allowed M1 entry; assigned health-service catalog; own notifications. Not the resident clinical directory. | Household/roster collection, member health facts (subject to permissions and verification lock), intake draft, permitted M1 records. | Household itself has no hard-delete route; member removal and permitted M1 deletion are destructive and stay online-only. | No facility-wide access; household and community writes must stay in the assigned barangay. | `FEATURE_ROLES`, `/households`, `/intake`, `/m1`, service scope guards; households/member/M1 RLS. |
| **Midwife** | No canonical profile role or backend feature mapping, even though a frontend screen uses a Midwife label. | None through the current backend role system. | None. | No scope is assigned by the canonical authorization layer. | `backend/src/config/roles.js`; unsupported roles are rejected by `authenticate`/`authorize`; no RLS role branch. |
| **PHN** | Municipality resident directory and authorized clinical/household records; verification, consultation queue, referrals/follow-ups, M1, reports, health services and analytics. | Only the shared allow-listed factual household handlers are currently `SAFE_SYNC`; clinical, referral, report, and administrative mutations remain online-only. | Only endpoint-specific destructive actions; no household hard delete. | Municipality-wide within the authenticated profile; may filter to a barangay but cannot cross municipality. | `FEATURE_ROLES`, route `authorize()` gates, service scope checks; household, visit, operational and M1 RLS. |
| **Health Supervisor** | Assigned-barangay households, resident/verification/clinical queues, triage, consultations, referral/follow-up workflows, reports, analytics and staff-account review queues. | Only the shared allow-listed factual household handlers are currently `SAFE_SYNC`; verification and workflow decisions remain online-only. | Household hard delete is unavailable; member removals and other delete endpoints remain online-only. | Exactly the currently assigned barangay for barangay records; municipality-wide access is not implied by the role. | `FEATURE_ROLES`, `resolveBarangayScope`, service record checks and verification guards; household, verification and operational RLS. |
| **RHU Personnel** | Facility/intake, triage and consultation records assigned to the facility; permitted M1 reads and assigned health-service catalog. Not the community analytics role. | No RHU automatic sync handler is registered; intake may be an offline draft only after a draft handler exists, and consultation completion/submission is online-only. | No offline delete. Existing endpoint-specific delete operations remain online-only. | Facility-bound on facility workflows using the authenticated profile; municipality checks apply where the route/table is municipality-scoped. No client-selected facility may widen access. | `FEATURE_ROLES`, `withinFacilityScope`, intake/consultation services and visit RLS. |
| **MHO** | Municipality residents/referrals, reports and review queues, certificates, health-service management, analytics, M1 reports and notifications. Household API role gates do not grant direct MHO household CRUD. | MHO mutations are audited but remain online-only; no MHO automatic sync handler is registered. | No offline deletes; route-specific destructive changes remain online-only. | Municipality from the authenticated profile; no client-selected municipality or barangay may widen access. | `FEATURE_ROLES`, route/service municipality checks; reports, municipal-submission, referral and M1 RLS. |
| **Resident** | Own resident profile, registration/verification status, own transfer/follow-up/document workflows and own notifications; not staff/community records. | No resident automatic sync handler is registered; profile editing is only a future narrow candidate, while submissions, consent, and staff-review transitions stay online-only. | No offline deletes. | Owner-only record access; no facility, municipality, or other resident scope is granted. | `FEATURE_ROLES.residentSelf`, `authenticate`, owner checks in services and resident/transfer RLS. |

Concrete route gates are maintained in
[`backend/src/config/roles.js`](../../backend/src/config/roles.js) and
[`backend/src/routes/`](../../backend/src/routes/). Database policies are in
the ordered files under [`supabase/migrations/`](../../supabase/migrations/);
notable household and member policies are in
[`20260915100200_create_households.sql`](../../supabase/migrations/20260915100200_create_households.sql),
and offline idempotency support is in
[`20261006130000_offline_sync_operations.sql`](../../supabase/migrations/20261006130000_offline_sync_operations.sql).
The table is an audit summary, not a second permission source. Endpoint-specific
checks and migrations remain authoritative where a workflow has narrower rules.

`offline_draft` rows are encrypted in IndexedDB and do not enter the automatic
write outbox. A workflow must provide a handler that explicitly sends to its
existing server-side draft endpoint and confirms the returned record is still a
draft before it may be synchronized. In the absence of that audited integration,
the draft stays local for online review. `ONLINE_ONLY` actions are rejected
before transport when offline and cannot be inserted through the queue helpers.

Deletes are not queueable. No request is translated into a create/update. Soft
archive or status transitions must be audited separately rather than assumed to
be safe.

### Local stores

| Store      | Purpose |
| ---------- | ------- |
| `drafts`   | locally created records waiting for server confirmation |
| `outbox`   | the synchronization write-ahead log (one row per queued write) |
| `records`  | a minimal, authorized cache of records for offline reads |
| `syncMeta` | last sync time and the single-worker lock |
| `keys`     | the device's AES-GCM key material (at-rest encryption) |

Every row is namespaced by `ownerId` (the Supabase user id) and payloads are
encrypted at rest. The schema is versioned (`OFFLINE_DB_VERSION`); adding a
store requires a new `.version(n)` block with an upgrade function.

### Synchronization

- Triggered by connectivity changes, the tab becoming visible, and the manual
  retry action. It also runs whenever the app is open — it does not rely on the
  Background Sync API (not used).
- One pass at a time: an in-memory guard plus a database lock prevent a second
  tab from processing the same operation concurrently.
- `pending → syncing → synced | failed | conflict`. An op is `synced` only after
  a confirmed, durable server response (`markSynced` is never called on error).
- Bounded exponential backoff with jitter for retryable errors (network, 5xx);
  terminal errors (422 validation, 403 permission/scope changes, 401 auth,
  malformed) are exhausted immediately and wait for the user.
- A 403 from a sync is retained locally and labeled exactly
  `Sync failed — permission changed`; the next attempt, if the user retries,
  must pass current server authorization again.
- `ONLINE_ONLY` operations are never sent by the runner. `OFFLINE_DRAFT`
  operations are deferred unless a handler is explicitly marked draft-only, and
  synchronization is accepted only when the server confirms draft state.
- 409 conflicts are surfaced for review and never silently overwrite data.
- Dependencies (`dependsOn`) are processed in order (e.g. a household before its
  dependent records).
- A `syncing` row older than the stale window is recovered to `pending` on the
  next start, so an interrupted upload is retried (idempotently) rather than
  lost.

### Server-side guarantees

- `Idempotency-Key` (migration `20261006130000_offline_sync_operations.sql`,
  middleware `backend/src/middleware/idempotency.js`) records the completed
  response per `(user_id, key)` in `public.sync_operations` and replays it on
  retry, so a re-upload creates no duplicate. Each key is bound to a SHA-256
  fingerprint of `(method, path, canonical body)`; reusing a key with a different
  request is rejected with 409 instead of replaying an unrelated response. The
  table is RLS-enabled with no policies: service-role (backend) only.
- Household idempotency replay is performed only after the current route
  permission and household scope checks. For create replays, the current
  authenticated user must still be able to access the returned household.
- Client-provided `facilityId`, `municipalityId`, `barangayId`, recorder/
  responsible-personnel ids, role, and authorization scope are not accepted as
  update authority. The household service derives organization and attribution
  fields from the authenticated profile/current database record.
- **Database-enforced create idempotency**: the `Idempotency-Key` is carried into
  `households.client_operation_key`, which has a unique (partial) index. Even if
  the ledger update is lost to a crash, a retried create hits the unique
  constraint and the service returns the already-created household instead of
  inserting a duplicate. This closes the crash window that a ledger-only design
  leaves open.
- **Atomic household + members**: `public.create_household_with_members(...)`
  (same migration) inserts the household and every member in ONE transaction —
  either all are committed or none are — so a member failure can no longer leave
  a partial household with an empty roster. It also re-checks the operation key
  for idempotent replay. The backend calls it through the service-role client
  (the function's EXECUTE is revoked from PUBLIC/anon/authenticated); when the
  function is not deployed yet the service falls back to the previous sequential
  insert, so the online workflow is unaffected on an un-migrated database.
- `households.revision` / `residents.revision` provide optimistic concurrency.
  The client sends `If-Match`; the update is applied **conditionally**
  (`WHERE id = ? AND revision = ?`), so a concurrent edit cannot be silently
  overwritten — the loser matches zero rows and receives 409. Without `If-Match`,
  the existing last-write-wins online behavior is preserved.
- On a database where this migration has not been applied, the repository
  transparently omits the new columns (same fallback pattern already used for the
  document-screening columns), so the online household workflow is unaffected.

## Dependencies added (frontend)

| Package | Reason |
| ------- | ------ |
| `vite-plugin-pwa` (dev) | generates the manifest, service worker injection, and build integration |
| `workbox-core`, `workbox-precaching`, `workbox-routing`, `workbox-strategies`, `workbox-expiration`, `workbox-cacheable-response` (dev) | custom service worker (`src/sw.js`) |
| `dexie` | IndexedDB wrapper for versioned offline stores |
| `fake-indexeddb` (dev) | runs the Dexie-backed tests under `node --test` |

No new backend runtime dependencies.

## Privacy & security

- Supabase RLS and backend authorization remain authoritative. Every registered
  synchronized write goes through the existing authenticated endpoints; the
  server re-validates the current user, role, scope, and permissions.
- The service-role key never reaches the browser. No passwords or auth tokens are
  written to IndexedDB or local storage — only the minimal queued record payloads.
- Local payloads are encrypted at rest with a per-device AES-GCM key. In browsers
  the key is persisted as a **non-extractable `CryptoKey`** (its bytes cannot be
  read back). See the threat note in `src/services/offline/crypto.js`: this is
  defense-in-depth only — the key is co-located with the ciphertext, so it does
  not defend against same-origin script or a full IndexedDB dump, and it is not
  a substitute for device disk encryption or the server-side RLS/authorization
  controls.
- On logout and on account switch, `OfflineSyncProvider` stops the worker and
  rebinds it only after a valid authenticated session is available. Pending
  work is retained rather than silently discarded after session expiry, while
  every draft, operation, and cached record is filtered by `ownerId` and cache
  keys include the owner. A different account cannot read or synchronize the
  previous account's rows. Sites that require clearing all device data may call
  the explicit `purgeOfflineDb()` device-cleanup action.

## Verification status

- Migration `20261006130000_offline_sync_operations.sql` is **not yet applied** to
  any project. The only linked Supabase project (`lblawqeoixojyytkmfqy`) is the
  live/real database, so the migration must be applied to a dedicated
  development/staging project (or a local Supabase started with Docker) first.
- **Live-verified**: production PWA build (service worker, manifest, offline
  fallback, cache rules) and non-authenticated offline navigation in Chromium.

## Commands

```bash
npm run install:all                 # install frontend + backend deps
npm run dev:backend                 # API on http://localhost:5000
npm run dev:frontend                # Vite on http://localhost:5173
npm run build --prefix frontend     # production build incl. PWA/service worker
npm run lint --prefix frontend
supabase db push                    # apply supabase/migrations/*
```

## Manual offline testing procedure

Use a throwaway/test Supabase project. Do not touch production health data.

1. Build and preview the PWA over HTTPS or `localhost`:
   `npm run build --prefix frontend` then `npm run preview --prefix frontend`.
2. Sign in as a BHW (barangay-scoped) account with a valid barangay assignment.
3. Open **Household Profiling → Add Household**, fill the required fields and
   members, then submit once while online → confirm the household appears and the
   header shows "Saved directly to the database".
4. Device DevTools → **Network → Offline** (or disconnect Wi-Fi). Confirm the
   header indicator flips to **Offline**.
5. Add another household → the form badge shows "Offline — saved on this device,
   syncs later". The indicator badge increments the pending count.
6. Reload the page while still offline → the app shell loads from the service
   worker and the pending count is preserved.
7. Go back **Online** → synchronization runs automatically; the indicator shows
   progress then "Last successful synchronization: Just now" and the pending
   count returns to 0.
8. Verify in Supabase that the household exists **exactly once** (retry the same
   submission by toggling offline/online mid-request to exercise idempotency).
9. Open the browser **Application → IndexedDB → kalusagap-offline** and confirm
   `drafts`/`outbox` payload columns are encrypted envelopes (`{"enc":true,...}`),
   not plaintext.
10. Sign out → confirm the `kalusagap-offline` IndexedDB database is deleted.
11. Conflict check: edit the same household from a second device/browser, then
    submit the offline edit from the first → the operation is marked **Conflict**
    in the indicator and the server record is not overwritten.

## Known limitations

- Household creation, factual member measurements, and Health
  Supervisor/PHN follow-up schedule writes are wired end-to-end offline. The
  allow-listed household update service is not yet connected to an edit UI;
  member-add, resident/assessment/maternal/referral writes require their own
  audited handler + service wiring.
- Offline **reads** are cached only via `records`; household list data is
  refreshed after a confirmed synchronization. Other feature screens still
  require their own cache adapters.
- Device inactivity locking / re-authentication on resume is not implemented; the
  app relies on Supabase session expiry and owner-scoped local data. Recommended before
  enabling offline clinical data on shared devices.
- Background Sync is not used; synchronization requires the app to be open.
- Household **creation** is atomic once the migration is applied. Other household
  operations (e.g. `addHouseholdMember` after the fact, member-health upsert) are
  still separate single-statement writes.
- `public.sync_operations` has no retention/TTL; add a cleanup job before this is
  used at scale.
- `public.create_household_with_members` is `security invoker` and relies on the
  service-role connection (RLS is bypassed for that role). If it is ever called
  with a non-service role, the household RLS insert policy still applies.
