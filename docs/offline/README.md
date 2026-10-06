# Offline-First Support

This document describes the offline-first layer added to KALUSAGAP. It is
additive: Supabase Auth, the Express API, Row Level Security, existing roles,
routes, and all online workflows are unchanged. Offline support is layered on
top of the existing `@/services/api/*` clients — components still never call
`fetch` directly.

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
        │  sends each op through the existing API with Idempotency-Key (+ If-Match)
        ▼
Express API → Supabase (RLS + service layer re-validate user, role, scope, record)
```

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
  terminal errors (422 validation, 403 authorization, 401 auth, malformed) are
  exhausted immediately and wait for the user.
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

- Supabase RLS and backend authorization are untouched and remain authoritative.
  Every synchronized write goes through the existing authenticated endpoints; the
  server re-validates user, role, barangay/municipality scope and permissions.
- The service-role key never reaches the browser. No passwords or auth tokens are
  written to IndexedDB or local storage — only the minimal queued record payloads.
- Local payloads are encrypted at rest with a per-device AES-GCM key. In browsers
  the key is persisted as a **non-extractable `CryptoKey`** (its bytes cannot be
  read back); environments that cannot structured-clone a `CryptoKey` (the
  `fake-indexeddb` test runner) fall back to raw key bytes. See the threat note in
  `src/services/offline/crypto.js`: this is defense-in-depth only — the key is
  co-located with the ciphertext, so it does not defend against same-origin script
  or a full IndexedDB dump, and it is not a substitute for device disk encryption
  or the server-side RLS/authorization controls.
- On logout and on account switch, `OfflineSyncProvider` purges the entire
  offline database and invalidates the key, so a shared device never leaves one
  user's queued health data for the next user. A cached session can never drive a
  sync under a different account (ops are filtered by `ownerId`).

## Verification status

- Migration `20261006130000_offline_sync_operations.sql` is **not yet applied** to
  any project. The only linked Supabase project (`lblawqeoixojyytkmfqy`) is the
  live/real database, so the migration must be applied to a dedicated
  development/staging project (or a local Supabase started with Docker) first.
- **Unit-verified** (Node test runner): sync ordering/backoff/error
  classification, Dexie encryption round-trip, queue/outbox/recovery, interrupted
  operation recovery, idempotency-key fingerprint binding, service-level create
  deduplication, the atomic household+members create path (mocked repository),
  and conditional revision conflicts. See
  `frontend/test/offline.*.test.js` and `backend/test/offline.offlineSync.test.js`.
- **Live-verified**: production PWA build (service worker, manifest, offline
  fallback, cache rules) and non-authenticated offline navigation in Chromium.
- **NOT live-verified** (requires a non-production Supabase project and/or test
  accounts): real Supabase integration (RLS, the unique constraint, ledger
  replay), authenticated offline save → reconnect → sync, duplicate-retry record
  count, and revision conflicts against the database.

## Commands

```bash
npm run install:all                 # install frontend + backend deps
npm run dev:backend                 # API on http://localhost:5000
npm run dev:frontend                # Vite on http://localhost:5173
npm run build --prefix frontend     # production build incl. PWA/service worker
npm test --prefix frontend          # frontend unit tests
npm test --prefix backend           # backend unit tests
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

- Only the **Household creation** workflow is wired end-to-end offline (per the
  incremental delivery requirement). Resident/assessment/maternal/follow-up/
  referral drafts require the same audited handler + service wiring.
- Offline **reads** are cached only via `records` and are not yet surfaced in the
  household list UI; queued drafts are shown through the sync indicator.
- Device inactivity locking / re-authentication on resume is not implemented; the
  app relies on Supabase session expiry and the logout purge. Recommended before
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
