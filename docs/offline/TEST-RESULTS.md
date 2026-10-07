# KALUSAGAP Offline — Test Results

**Status: LIVE/REAL-DATABASE VERIFICATION IS BLOCKED — no development Supabase
project or test BHW account exists yet.**

This file records what has been verified and what is still blocked. It is the
living record of the offline milestone's verification; update it as each row is
actually run (never mark a real-DB row as passed until it runs against the dev
project).

Last updated: 2026-10-07.

---

## 1. Unit-level (mocked / no database) — PASS

These use the Node test runner; the Dexie-backed ones use `fake-indexeddb`, and
the backend service tests inject a fake repository. No real database is touched.

| Suite | Covers | Result |
| --- | --- | --- |
| `backend/test/offline.offlineSync.test.js` | idempotency-key fingerprint binding; idempotent create replay; concurrent 23505 reconciliation; optimistic-concurrency 409 on stale/racing writes; atomic household+members create path; sequential fallback | **PASS** |
| `frontend/test/offline.syncCore.test.js` | backoff math + jitter; dependency ordering; error classification + retryability | **PASS** |
| `frontend/test/offline.engine.test.js` | at-rest encryption round-trip; atomic queue/draft write; successful pass reconciles server id; network failure backs off; 422 terminal; conflict recorded; interrupted-upload recovery; dependency order; malformed op fails; logout purge | **PASS** |
| `frontend/test/offline.crypto.test.js` | encrypted envelope with no plaintext; persisted key decrypts after reload; random IV | **PASS** |

All 21 offline unit tests pass on the current tree.

## 2. Production build + unauthenticated PWA (Chromium) — PASS

| Suite | Covers | Result |
| --- | --- | --- |
| `frontend/tests/offline/offline-pwa.spec.js` (via `playwright.offline.config.js`) | SW registration + manifest; offline deep-link serves the precached shell; standalone `/offline.html` fallback; API/authorized requests are never cached | **PASS** |

## 3. Real-database integration (repo/API level) — BLOCKED (not yet run)

Opt-in guarded: these are **skipped** unless `ALLOW_OFFLINE_INTEGRATION_TESTS=1`
is set and `TEST_SUPABASE_URL` points at a non-production project.

| Suite | Covers | Prerequisite to run |
| --- | --- | --- |
| `backend/test/offline.integration.test.js` | atomic household+members create; idempotent replay (exactly one row); key-reuse-with-different-payload → 409; stale-revision conditional update → 409; out-of-scope denial; anon RLS denial on `sync_operations`; `create_household_with_members` RPC exists/callable | Dev project + migrations applied + `seed-dev.sql` + provisioned test BHW |
| `backend/test/offline.http.integration.test.js` | full HTTP path: 401 without token; BHW create + `Idempotency-Key` replay writes one ledger row + one household; key-reuse-different-payload → 409; stale `If-Match` → 409 + no overwrite; anon RLS denial; authorized scoped list + cross-barangay 403 | Dev project + running app + test-BHW sign-in |

**Neither suite has been run against a real database.** They are skipped cleanly
in a normal `npm test` (no writes, no network). Do not mark them passed until run
against the dev project.

## 4. Authenticated end-to-end (Playwright, real dev backend + Supabase) — BLOCKED (not yet run)

| Suite | Covers |
| --- | --- |
| `frontend/tests/offline/offline-authenticated.spec.js` (via `playwright.offline.auth.config.js`) | online create saved directly; offline create queued + encrypted; reload persistence; reconnect auto-sync → exactly one DB row; logout purge of IndexedDB |

Requires: dev backend running on the port `VITE_API_URL` points to, dev Supabase
project, and the test-BHW credentials in the environment. Not run.

## 5. How to unblock

Follow `docs/offline/DEV-CHECKLIST.md` in order:

1. Create a dedicated dev Supabase project (never production `lblawqeoixojyytkmfqy`).
2. Link it, `supabase db push` all migrations, confirm
   `20261006130000_offline_sync_operations.sql` applied.
3. `supabase db execute --file supabase/seed-dev.sql`.
4. `node backend/scripts/provision-test-bhw.mjs --apply` (refuses production).
5. Set the env vars (section 4 of the checklist).
6. Run section 6 (integration) and section 7 (E2E).
7. Re-append the actual pass/fail/skip rows here with the exact setup used.