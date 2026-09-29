# KALUSAGAP — Final Release Check

Repository cleanup, GitHub release-safety audit, and README update.
No application logic, RLS, database, or permission behavior was changed.
No credentials were rotated. No database was reset. No commits or pushes were made.

> Important context: the working tree already contained a large amount of
> uncommitted application development from the completed QA/feature phase (new
> backend controllers/services/routes/validators, new frontend features, and new
> Supabase migrations, plus the removal of Household Risk Clusters). That work is
> **not** part of this cleanup. The only changes this cleanup introduced are the
> items listed under sections A, E, and F below.

## A. Removed artifacts

| Item | Type | Tracked in Git? | Action |
| --- | --- | --- | --- |
| `evidence1/` (dir) | QA evidence: role walkthrough text, screenshots, PDFs, `test-results/`, JSON QA output | Untracked | Deleted |
| `qa/` (dir) | QA scripts + `.secrets.env` (local runtime test credentials), RLS probes, provisioners | Git-ignored | Deleted |
| `frontend/tests/kalusagap-major-features/client-presentation-qa.spec.js` | One-off QA browser walkthrough that writes screenshots to `evidence1/` | Untracked | Deleted |
| `frontend/tests/kalusagap-major-features/pdf-export-qa.spec.js` | One-off QA PDF-generation probe that writes PDFs to `evidence1/` | Untracked | Deleted |

Verification after removal: no `evidence`, `evidence1`, or `qa` directories
remain (outside `node_modules`/`.git`). `./evidence/` did not exist.
No AI/agent artifacts were present (`.kilo/`, `.kilocode/`, `.roo/`,
`.clinerules/`, agent worktrees, `.tmp`/`.temp`/`.cache` scratch files) — none
found in the tree. `supabase/.temp/` is Supabase CLI local state and is already
git-ignored (left in place; it is not committed).

## B. Files preserved (inspected, classified as legitimate — kept)

- All frontend and backend source code.
- Permanent unit tests: `backend/test/` (36 files) and `frontend/test/` (4 files).
- Retained Playwright E2E suite: `frontend/playwright.config.js`,
  `frontend/tests/helpers/test-helpers.js`, and the two tracked specs
  `password-recovery.spec.js` and `resident-household.spec.js` (env-driven).
- `backend/scripts/*.mjs` — operator tooling referenced by `package.json`
  (`verify:live`, `provision:accounts`) plus `reset-password.mjs` /
  `diagnose-resident-notifications.mjs`. All read credentials from the
  environment; none hardcode secrets.
- All Supabase migrations, including `20260929120000_qa_rls_hardening.sql` —
  despite the "qa" in its name this is a real, applied RLS security migration
  and is in sync with the remote (removing it would desync migrations).
- `supabase/config.toml`, `supabase/seed.sql`, `.env.example` templates, `docs/`,
  `vercel.json`, `package.json` / `package-lock.json`.

## C. Comment cleanup

No changes required. Audit results:
- `console.log` in `frontend/src`: **0**.
- `console.log` in `backend/src`: only the request logger and the server startup
  banner — intentional production/operational logging (no secrets, no bodies).
- No `debugger` statements, and no `QA ONLY` / `DEMO ONLY` / `REMOVE BEFORE` /
  test-button markers in source.
- `TODO`/`FIXME`/`HACK`/`XXX` hits were all false positives (phone-format
  placeholders like `09XXXXXXXXX` and PNG binary bytes) — no real debt markers.

## D. Dead-code cleanup

- Confirmed the deleted modules have no dangling references:
  `frontend/src/lib/householdRiskLevel.js`,
  `frontend/src/features/households/pages/HouseholdRiskClusters.jsx`,
  `frontend/test/householdRiskLevel.test.js`.
- ESLint (with `eslint-plugin-unused-imports`) passes clean → no unused imports.
- One benign observation (left unchanged, conservative): an unused exported hook
  `useHouseholdRiskClusters` in `frontend/src/services/local/householdRiskStore.js:169`
  has no remaining callers. It is a single dead export (not a dead import, does
  not affect lint/build/tests). Not removed to avoid unnecessary churn on a
  file already modified by the feature phase; safe to delete later if desired.

## E. README changes (`README.md`)

The existing README was already accurate; it was extended, not rewritten.
- Added **Deployment** section (Vite SPA on Vercel per `vercel.json`; Express API
  deployed separately; how `VITE_API_URL` / `CLIENT_URL` / Supabase tie together).
- Added **Scope and Limitations** (online-only, no offline mode; role-scoped and
  server-enforced; application + manual verification onboarding; aggregated
  analytics with no resident-level PII; Household Risk Clusters removed).
- Added an **E2E testing** note (`npm run test:e2e`, requires running servers +
  env credentials; not part of the unit-test baseline).
- Softened the `typecheck` description to "advisory diagnostic" (see section J).
- Verified accuracy: roles table matches `backend/src/config/roles.js`
  (`admin`, `mho`, `phn`, `health_supervisor`, `rhu_personnel`, `bhw`,
  `resident` + `resident-limited` state); tech stack matches `package.json`;
  registration **is** in scope (routes exist in `AppRoutes.jsx`); no offline or
  removed-feature claims. All referenced docs exist.

## F. .gitignore changes

Root `.gitignore` extended (precise, no broad app-hiding globs):
- Added AI/agent artifacts: `.kilocode/`, `.roo/`, `.clinerules/` (kept `.kilo/`).
- Added QA/E2E run artifacts: `evidence/`, `evidence1/`, `test-results/`,
  `playwright-report/` (kept `qa/`).
- `frontend/.gitignore` already ignored `evidence/`, `test-results/`,
  `playwright-report/`; `.env` / `.env.*` with `!.env.example` already correct
  at root, frontend, and backend.

## G. Secret scan (working tree — tracked + untracked)

**CLEAN.** No JWTs, Supabase service-role/secret keys, SMTP/Brevo credentials,
bearer/refresh tokens, private keys, or connection strings with credentials in
tracked or untracked files. (Secret values are not reproduced here.)
- `frontend/tests/helpers/test-helpers.js` references only environment-variable
  **names** (e.g. `KALUSAGAP_ADMIN_PASSWORD`), never values.
- `backend/test/staffApprovalAuthority.test.js` has a synthetic fixture password
  (`QaPassw0rd`) inside a mocked validator test — not a real credential, grants
  access to nothing. Benign.
- The Supabase **project ref** appears in `supabase/config.toml` (standard,
  committed by convention) and `docs/live-verification-data.md`. A project ref is
  not a secret (it is part of the public API URL and ships with the anon key),
  but see "Remaining warnings" for the docs file.
- `.env.example` (frontend + backend) contain only blank keys and guidance; the
  service-role key is documented as server-only and never a `VITE_` variable.
- Frontend source contains no service-role key, DB password, SMTP password, or
  private token; only the public, RLS-guarded anon config is browser-side.

## H. Git history findings

**HISTORICAL CREDENTIAL EXPOSURE — not clean.**
- Commit `e829540` ("feat: finalize health role workflows and records") added
  `frontend/tests/helpers/test-helpers.js` with **hardcoded real test-account
  emails and passwords** as `process.env.* || '<literal>'` fallbacks.
- The current working tree removed those literals (env-only now, "BUG-026"), but
  that fix is **uncommitted**. The credentials still exist in commit `e829540`.
- `e829540` is the current `HEAD` **and equals `origin/v5`** — i.e. these
  credentials are **already pushed to the remote**.
- A new/forward commit that removes the file's literals does **not** remove them
  from history. Only history rewriting removes `e829540`'s contents.
- Scope of exposure in history: confined to
  `frontend/tests/helpers/test-helpers.js` in commit `e829540`. `qa/.secrets.env`
  and other `qa/` files were **never** tracked in any commit.

Remediation (requires your authorization — NOT performed here):
1. Rewrite history to purge the credentials from `e829540`
   (`git filter-repo` or BFG), then force-update `origin/v5`; and/or
2. Rotate the exposed test-account passwords in Supabase.

## I. Test results

| Suite | Result |
| --- | --- |
| Backend (`npm test --prefix backend`, node:test) | **322 / 322 PASS** |
| Frontend unit (`npm test --prefix frontend`, node:test) | **32 / 32 PASS** |
| ESLint (`npm run lint --prefix frontend`) | **PASS** (exit 0) |

Test counts match the expected baseline. Removing the two QA-only Playwright
specs did not change these counts: those specs live in `frontend/tests/` (the
Playwright E2E dir), not in `frontend/test/` (the node:test unit dir the
`test` script runs).

## J. Build result

- `npm run build --prefix frontend` (Vite): **PASS** (built successfully, ~27s).
- `npm run typecheck --prefix frontend` (`tsc --checkJs`): **FAILS — 449 notices
  across 44 files.** This is a **pre-existing baseline** condition, not caused by
  cleanup: the sources are plain JavaScript checked with `checkJs: true`, and the
  error-bearing files are unmodified versus `HEAD` (so the committed repo fails
  the same way). These are type-inference notices (mostly `TS2339` on untyped
  objects), not runtime defects — the build passes and all unit tests pass. Not
  fixed here because doing so would require pervasive code annotation changes,
  which are out of scope for a cleanup task. The claimed "typecheck PASS"
  baseline does not match the actual repository state.

## K. Startup smoke test (non-destructive)

Dev servers were already running from the prior session; probed directly:
- Backend `http://localhost:5000/api/health` → **200** `{"status":"ok",...}`.
- Frontend `http://localhost:5173/` → **200**, serves the Vite app shell
  (`#root` + module script) — no startup crash, no import/module errors.
- Auth boundary works: unauthenticated `GET /api/residents` and
  `GET /api/households` → **401** (rejected server-side).

Not executed (requires a real browser + live credentials that were intentionally
removed with `qa/.secrets.env`): full authenticated per-role UI walkthrough
(login → dashboard → household → health record → report → logout). The server
and route-level checks above confirm the app boots and enforces auth; the
per-role UI flows should be re-verified interactively with local credentials.

## L. Migration status

`supabase migration list --linked`: **Local == Remote**, all **41** migrations in
sync, including the newest (`20260929130000`). No pending or drifted migrations.

## M. Remaining warnings

1. **Git history contains real test credentials** (section H) — the primary
   blocker for a public release. Already on `origin/v5`.
2. **Typecheck fails (449 pre-existing notices)** (section J) — advisory only;
   build and unit tests pass.
3. **`docs/live-verification-data.md`** (tracked) documents the QA
   live-verification harness, names QA test-account patterns
   (`*.qa.<ts>@kalusagap.test`), and prints the Supabase project ref. It is
   operator documentation for retained scripts, so it was **kept**, but you may
   prefer to trim or remove it before a public release. The project ref it shows
   is also (unavoidably) in `supabase/config.toml`.
4. **Untracked feature work is unstaged.** A large body of new controllers,
   services, routes, migrations, and frontend features is untracked/modified and
   will need to be reviewed and committed as application work (separate from this
   cleanup) before it reaches GitHub.

## N. Push decision

- **CURRENT WORKING TREE: SAFE** — no secrets in tracked or untracked files.
- **GIT HISTORY: HISTORICAL CREDENTIAL EXPOSURE** — real test-account passwords
  live in commit `e829540`, which is already on `origin/v5`.

### NOT SAFE TO PUSH (as a clean public release) until the git history is addressed.

Working tree is clean, but Git history contains previously committed test
credentials. A forward commit does not remove historical secrets, and the
affected commit is already published to `origin/v5`. Purge history (and/or rotate
the exposed test-account passwords) before publishing the repository publicly.
Both actions require your explicit authorization and were not performed here.
