# Local development migration and verification

Report date: November 19, 2026.

## Status

Local isolation has been implemented. Complete functional acceptance is **blocked**:
Docker/Podman and the host `psql` client are unavailable on the audited machine.
Supabase CLI 2.118.0 and Node.js 22.19.0 are installed. No production database,
Auth account, storage object, or email service was used for verification.

The frontend can render locally with authentication explicitly unavailable until
local credentials are configured. The backend development entry point refuses
to start without local Supabase keys and an OTP pepper. It does not replace the
database or authentication with mock functionality. Existing unrelated changes
were present before this migration and continued during verification.

## Local services

| Component | Development destination |
| --- | --- |
| Frontend and email links | `http://localhost:5173` |
| Express API | `http://localhost:5000/api` |
| Supabase Auth, REST, Storage, Realtime | `http://127.0.0.1:54321` |
| PostgreSQL 17 | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| Supabase Studio | `http://127.0.0.1:54323` |
| Local email inbox | `http://127.0.0.1:54324` |
| Backend SMTP capture | `127.0.0.1:54325`, without SMTP authentication |

The database password above is for the disposable local stack, never a hosted
database. The application uses the Supabase SDK rather than a direct SQL driver;
`DATABASE_URL` documents and validates the direct local database destination.

## Preserved deployment configuration

- Existing `backend/.env` and `frontend/.env` were preserved byte-for-byte in
  ignored `.env.production` files, without printing their values. The originals
  were retained and are no longer loaded by development commands.
- The original `supabase/config.toml` was copied to ignored
  `supabase/config.production.toml` before editing. Supabase CLI does not load
  that preservation copy automatically.
- `.env*` files remain ignored except `.env.example`. Supabase `.temp` and
  `.branches` state is now ignored. Existing linked metadata was not read,
  altered, or used for a remote operation.
- Production build/deployment paths remain separate. Do not use a production
  bundle for local preview, since it can contain public deployment endpoints.
- No secret has been added to a tracked template, report, or browser bundle.
  The setup helper obtains only local keys and prints no credential values.

## Files changed for this migration

The list below identifies migration changes only. The worktree also contains
unrelated pre-existing and concurrent application changes, which were retained.

```text
.gitignore
README.md
package.json
scripts/configure-local.mjs
docs/database/README.md
docs/LOCAL_DEVELOPMENT.md
supabase/config.toml
backend/.env.example
backend/package.json
backend/src/dev.js
backend/src/server.js
backend/src/config/env.js
backend/src/config/localSafety.js
backend/src/config/supabase.js
backend/src/services/email.service.js
backend/src/services/personnelNotifications.service.js
backend/src/services/documentVerification.service.js
backend/src/services/aiProvider/config.js
backend/scripts/local-safety.mjs
backend/scripts/check-auth-connectivity.mjs
backend/scripts/diagnose-resident-notifications.mjs
backend/scripts/generate-staging-test-data.mjs
backend/scripts/provision-official-accounts.mjs
backend/scripts/provision-test-bhw.mjs
backend/scripts/remove_resident_document_storage_objects.mjs
backend/scripts/reset-password.mjs
backend/scripts/verify-live-workflows.mjs
backend/scripts/verify-reports-workflow.mjs
backend/test/localSafety.test.js
backend/test/helpers/localEnv.js
backend/test/helpers/testMode.js
backend/test/authConnectivity.test.js
backend/test/m1-database-validation.test.js
backend/test/personnelAccounts.test.js
backend/test/personnelRepository.test.js
backend/test/personnelRoutes.test.js
backend/test/supabaseVisitSchemaCompatibility.test.js
frontend/.env.example
frontend/package.json
frontend/playwright.config.js
frontend/index.html
frontend/vite.config.js
frontend/config/localDevelopment.js
frontend/src/main.jsx
frontend/src/lib/localSafety.js
frontend/src/lib/supabase.js
frontend/src/lib/pwa.js
frontend/src/services/api/apiBaseUrl.js
frontend/src/services/api/apiClient.js
frontend/src/styles/index.css
frontend/src/features/analytics/components/CommunityHealthMap.jsx
frontend/tests/safety/localDevelopment.test.js
frontend/tests/safety/localNetworkSmoke.mjs
frontend/tests/safety/isolationGate.test.js
frontend/tests/e2e/helpers/isolation.js
frontend/tests/e2e/helpers/env.js
```

Ignored machine-local files created/preserved: `backend/.env.development`,
`frontend/.env.development`, both `.env.production` copies, and
`supabase/config.production.toml`. No existing production file was deleted.

## Production references removed from local execution

| Former source or dependency | Local execution behavior |
| --- | --- |
| Deployment API URLs in legacy frontend `.env` | Ignored; `VITE_API_URL` uses local backend port 5000 |
| Hosted Supabase project URLs/keys in legacy `.env` files | Ignored; local URL/issuer guards require local Auth/DB/Storage configuration |
| Render/Vercel browser origins | Preserved for deployment only; local CORS rejects public origins |
| Production email callback/site URLs | Local canonical site and explicit reset redirects use frontend port 5173 |
| Hosted SMTP configuration | Development accepts loopback capture only and rejects SMTP credentials |
| Hosted file signing/upload destinations | Existing SDK/storage logic uses the guarded local Supabase endpoint |
| Google Fonts styles/preconnections | Replaced with local/system font resolution |
| Hardcoded map style | Environment configurable, with the public map exception documented |
| Standalone scripts loading legacy deployment `.env` | Centralized mode loading plus unconditional local script guards |

There was no blind replacement of production strings. Production defaults and
denylist fixtures were retained where they serve deployment or safety purposes.

## Startup procedure

1. Install/start Docker Desktop with Linux containers, or the local container
   runtime supported by the installed Supabase CLI. Install `psql`, or use the
   local Studio SQL editor for the explicitly reviewed reference seed.
2. Confirm the local project identifier in `supabase/config.toml` is
   `kalusagap-local`. Use a fresh disposable local stack. Never run linked or
   remote database commands for this workflow.
3. From the repository root run:

```powershell
supabase start
npm run local:configure
```

`supabase start` bootstraps the migration history on first initialization. The
historical migration files were preserved unchanged by this migration. They contain destructive
DDL, including dropping `medicine_facility_availability`; do not reset or replay
the chain against existing populated data. Review pending SQL before manually
applying updates to an existing local development database:

```powershell
supabase migration list --local
npm run local:db:migrate
```

Automatic seeding is disabled. Load only canonical geography and facilities
after reviewing `supabase/seed.sql`:

```powershell
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/seed.sql
```

The reference seed inserts Pili, the approved barangays, and their facilities;
it supplies no residents, clinical records, users, or fake application data.
Do not use `seed-dev.sql`: its `Test Barangay` conflicts with current guards.
Do not run maintenance cleanup SQL or staging data generators during setup.

4. Start the servers in separate terminals:

```powershell
npm run dev:backend
```

```powershell
npm run dev:frontend
```

5. Open `http://localhost:5173`. Confirm the DEVELOPMENT ENVIRONMENT indicator,
   then inspect the local health endpoint and local inbox. No production
   credentials are necessary. If Docker or local Supabase is unavailable, stop
   here; never substitute a hosted project.

The local configuration helper writes ignored `.env.development` files from
`supabase status --output json`. It keeps the server key exclusively in the
backend, creates a random OTP pepper, and preserves an existing generated
pepper on reruns. It never links projects, runs migrations, resets, seeds, or
provisions accounts. If local status fails, development files are not overwritten.
Rerunning the helper regenerates the managed configuration; retain any optional
map configuration separately before rerunning it.

## Environment variables and safeguards

| Scope | Variables |
| --- | --- |
| Frontend origins | `VITE_APP_BASE_URL`, `VITE_API_URL` |
| Browser Auth | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |
| Optional map style | `VITE_MAP_STYLE_URL` |
| Backend origins | `NODE_ENV`, `PORT`, `CLIENT_URL`, `CORS_ORIGIN` |
| Database/Auth/Storage | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` |
| Local mail and OTP | `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, `OTP_PEPPER`; empty `SMTP_USER`/`SMTP_PASSWORD` |
| Notification worker | `PERSONNEL_NOTIFICATION_INTERVAL_SECONDS` |

- Backend development explicitly sets development mode, so an inherited
  `NODE_ENV=production` cannot select deployment credentials through `npm run dev`.
- Backend non-production configuration accepts exact loopback service hosts,
  validates database aliases, and rejects hosted Supabase credentials. Local
  keys must be legacy JWTs from local `supabase status` with issuer
  `supabase-demo` and the expected anon/service-role role. Opaque cloud keys are
  rejected rather than guessed to be safe.
- SMTP is limited to a loopback capture server. Local SMTP credentials and
  hosted AI API keys cause startup failure. Production SMTP retains TLS and
  authentication; local capture needs neither.
- Supabase HTTP requests and operational script fetches disable redirects, so
  a local response cannot silently redirect application credentials to a host.
- Development frontend configuration ignores legacy `.env` and `.env.local`,
  takes literal values from the selected mode files, rejects inherited `VITE_`
  variables, and validates destinations before serving or building.
- The frontend has a local content security policy for API, Auth, images,
  fonts, sockets, and embedded documents. The intentional map provider is the
  documented public exception. A development banner remains visible.
- Operational provisioning, diagnostics, reset, storage cleanup, and live
  verification scripts have unconditional loopback checks, even if invoked in
  production mode. Provisioning no longer implies `--apply` through npm.
- Guards inspect configuration, not the implementation of another process
  listening on loopback. Do not place a proxy to production on these ports.

## Authentication, email, storage, and jobs

The existing Supabase authentication flows remain in use. Registration, OTP,
login/logout, account activation, password recovery, temporary passwords, and
staff setup all use local Auth. Email confirmations are enabled, with six-digit
registration OTPs and the existing five-minute expiry. Recovery and invitation
links return to the local reset-password route. Both Auth emails and backend
transfer/personnel/reset emails are captured locally.

Create new local accounts through real registration and administration flows.
For the initial administrator, create a local Auth identity through local Studio,
confirm it using local tools, and explicitly assign its matching profile the
admin role, active status, and seeded municipality in local Studio. Verify the
identity before changing its local role. Never reuse or download production
resident identities or clinical data. Staff accounts must be created through the
existing administrator workflow so lifecycle, scopes, and notifications are
actually exercised. No accounts were created automatically by this migration.

The existing private `documents` bucket and document prefixes are retained,
with the bucket and policies defined by migrations in the local database.
Government IDs, transfer documents, personnel documents, health attachments,
official logos, and generated outputs keep their existing functionality and
authorization. Signed URLs must be issued by local Supabase. No production
files were copied. Local OCR uses the existing `backend/eng.traineddata` and
installed Tesseract packages; it does not download language models during local
requests. Existing manual-review behavior still handles unavailable OCR.

The personnel notification worker starts only with the real backend server,
uses the same guarded local Supabase client, and sends through local SMTP.
No scheduled SQL HTTP calls or hosted webhooks were identified in migrations.

## Public and optional external dependencies

- OpenFreeMap is an intentional public basemap provider, not a production
  KALUSAGAP service. It remains available and configurable through
  `VITE_MAP_STYLE_URL`. A completely air-gapped map needs a separately provisioned
  local style, vector tiles, glyphs, and sprites; none were fabricated.
- External Anthropic/OpenAI execution is disabled in local development.
  No mock AI result replaces unavailable functionality.
- Public information links to government websites remain user-initiated links.
  The unused Spline illustration cannot load its remote frame under local CSP.
- Google font requests were removed from the main page/styles; existing local
  font assets and system fallbacks are used.
- npm packages and container images may need internet access during installation.
  These are setup dependencies, not hosted application database/auth services.

## Verification results and remaining issues

- `supabase start`: blocked before service startup because Docker/Podman is not
  installed/on PATH. No schema or records were modified by that attempt.
- `node scripts/configure-local.mjs --preserve-only`: passed; deployment files
  preserved without outputting credentials.
- `node scripts/configure-local.mjs`: correctly failed because local status is
  unavailable; existing local files were not overwritten.
- `node backend/src/dev.js`: correctly failed before opening its HTTP listener
  because real local keys and OTP configuration are unavailable.
- Focused backend regression: **136 passed, 0 failed**. Covers local environment
  safeguards, production configuration compatibility, CORS, authentication
  connectivity, personnel lifecycle and temporary passwords, email worker
  behavior, SDK transport contracts, and storage-related schema compatibility.
- Operational `.mjs` scripts passed syntax checks and isolated guard checks.
- Bounded full backend regression: **808 passed, 0 assertion failures, 2
  file-level timeouts** at 45 seconds per test file. The two affected files,
  `aggregateAnalytics.database.test.js` and `residentRiskSql.test.js`, both
  passed on the subsequent extended run: **22 tests passed, 0 failed**. These
  counts overlap and must not be added together. Embedded PostgreSQL cases use
  disposable test fixtures, not a production or resident database.
- Frontend safety tests: **28 passed, 0 failed** at the final verified run.
- Chromium local network smoke: passed at the final verified run. Rendered the
  landing/login pages; blocked hosted fetch/image/frame probes; intercepted the
  public map exception without sending public requests. This is not a full
  authenticated workflow test.
- Development frontend build: **passed**, using
  `npm --prefix frontend run build -- --mode development`.
- Full frontend unit suite: **629 passed, 11 failed** out of 640 tests. Remaining
  failures are in `supervisorExactDesign.test.js` (dashboard source contract),
  `m1-catalog-validation.test.js` (missing Vitest dependency),
  `healthSupervisorModules.test.js` (five React data-URL resolver failures and one
  source assertion), `clinicalUiIntegration.test.js` (two TCLS fixtures), and
  `referralRoutingActions.test.js` (source assertion). These are unresolved;
  no assertion was deleted or weakened to make the migration pass.
- Final Playwright suite: **12 passed, 13 safely skipped, 0 failed** using
  `npm --prefix frontend run test:e2e -- --workers=1 --timeout=120000 --reporter=line`
  with a separate output directory under the approved local temporary folder.
  All passing cases are local browser/component fixtures. The 13 skipped cases
  require verified local application accounts/services and were not accepted as
  functional passes. An earlier fixture timeout passed on retry; an earlier
  trace-file collision in the shared artifact directory was eliminated by
  assigning this run its own output directory.
- Scoped ESLint across changed frontend config/isolation files and the map,
  JavaScript syntax checks, `.gitignore` checks for local
  and preserved credentials, and final `git diff --check`: **passed**.

Test evidence is retained under the local temporary directory:
`kalusagap-local-backend.tap`, `kalusagap-local-db-retry.tap`,
`frontend-local-isolation-final.tap`, and `kalusagap-local-migration-e2e-20261119/`.
Counts from focused, broad, and retried suites overlap.

The frontend development server was started on port 5173 at handoff; its HTTP
response was verified as 200 with a local API CSP and no hosted Supabase origin.
The backend
remains intentionally stopped until local Supabase credentials and the OTP
pepper can be generated. Backend HTTP/CORS tests used ephemeral loopback
listeners and isolated transports; they do not establish live Auth availability.

Actual local registration, OTP delivery and consumption, resident/staff login,
logout, password reset, activation, role assignment, attachment upload/download,
and background mail delivery remain **unverified against running Supabase**.
So do the resident, BHW, supervisor, PHN, midwife, RHU, MHO, and administrator
workflows, dashboards, monitoring, household/risk/follow-up modules, transfers,
analytics/heatmaps, exports/reports, M1 maternal reports, and TCL records.
Unit and embedded PostgreSQL tests provide regression evidence, not acceptance
of these flows against a real local stack.

After installing prerequisites, explicitly inspect database RLS policies,
enabled triggers, functions, indexes, foreign keys/check constraints, table
grants, the private bucket, and user-scoped access in local Studio. Existing
PGlite tests shim Supabase platform schemas and grants, so their results cannot
prove actual PostgREST/Auth/Storage permission parity.

Examples of read-only local Studio checks (inspect results, do not disable RLS):

```sql
select schemaname, tablename, rowsecurity
from pg_tables where schemaname = 'public' order by tablename;

select schemaname, tablename, policyname, roles, cmd
from pg_policies where schemaname in ('public', 'storage')
order by schemaname, tablename, policyname;

select event_object_table, trigger_name, event_manipulation
from information_schema.triggers where trigger_schema = 'public'
order by event_object_table, trigger_name;

select tablename, indexname from pg_indexes
where schemaname = 'public' order by tablename, indexname;

select conrelid::regclass as table_name, conname, contype, convalidated
from pg_constraint where connamespace = 'public'::regnamespace
order by conrelid::regclass::text, conname;

select proname, prosecdef, proconfig from pg_proc
where pronamespace = 'public'::regnamespace order by proname;

select id, name, public from storage.buckets where id = 'documents';
```

Check both authorized and denied access using actual local user tokens. A
service-role-only smoke cannot establish that resident and staff RLS works.

No production migrations, deletes, uploads, password resets, or emails were
performed. Production was not queried to attest its state independently.
