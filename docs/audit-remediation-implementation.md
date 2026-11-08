# KALUSAGAP Audit Remediation Implementation

Date: 2026-11-06. Branch: `v18`. Changes remain uncommitted.

## Outcome

The remaining documented integration, referral, analytics, offline synchronization,
revision and authentication issues have been implemented on the existing branch.
Production functionality requires the pending migrations and coordinated deployment;
this report is not a claim that a remote Supabase project has already been upgraded.
No remote migrations were applied, production records deleted, existing migrations
removed, or RLS disabled. Existing earlier-audit security fixes were retained.

## Referral Workflow

- `health_referrals` is the canonical writable referral model. PHN compatibility
  endpoints delegate to it rather than writing a second workflow to `referrals`.
- Actual profile UUIDs, registered facility IDs, personnel roles and stations control
  recipient routing. Names are display values, never recipient identity keys.
- Active authorized RHU Personnel, Health Supervisors/Midwives and PHNs receive their
  assigned cases. Incoming case visibility does not grant a general resident directory
  or unrestricted clinical submission access.
- Accept, reject, progress, complete and cancel transitions persist with version checks,
  immutable history and recipient-specific notifications. Rejection is distinct from
  sender cancellation. Completed, rejected and cancelled workflows are not reopened.
- Existing source visits and receiving encounters remain linked to the same canonical
  referral. Starting triage requires an authorized, accepted assigned case; repeated
  starts reuse its existing encounter. Originating personnel read the updated record.
- The migration preserves the legacy table, snapshots and foreign-key relationships.
  An idempotent legacy-to-canonical mapping prevents migration replay from duplicating
  cases. Orphans and uncertain or ambiguous historical routing are preserved for review,
  not guessed or discarded. New legacy-table writes are blocked.

## Offline Consultations

- A client operation UUID and encrypted write-ahead clinical payload are saved before
  the first create request. Reconnect and retry reuse that UUID and the original body.
- `visits.client_operation_key` is unique. Backend idempotency verifies the creator,
  resident, logical payload and current authorization; another account cannot reuse
  the key to appropriate a record.
- Follow-up, audit and notification side effects have a recoverable transactional
  completion path. A visit alone is not treated as successful synchronization when
  required effects are incomplete. A replay does not create a second visit or follow-up.
- Existing consultation-only offline drafts are adopted once into the safe-sync outbox.
  Dates, recording instants, resident references and clinical details survive adoption.
  RHU triage drafts remain a separate manual-review workflow, not silently auto-submitted.
- Invalid, null or mismatched successful HTTP responses do not mark work synchronized.
  Failed or conflicting clinical payloads remain encrypted on the device. Attempted
  payloads cannot be silently overwritten or deleted to hide failures.
- `GET /consultations/:id` now retrieves a real scoped visit. The retained
  `/health-records` API delegates to the same consultation routes and data model;
  clinical history is not hard-deletable.

## Real Data Integration

- `/households/workers` returns a least-privilege active personnel directory scoped by
  municipality and, where applicable, barangay. Add Household and Risk Action dialogs
  no longer offer fabricated worker names.
- TCL reads all requested server resident pages, selects stable resident IDs, validates
  a real BHW assignment and uses the returned record after saving. Enrollment does not
  invent a completed visit or last-visit date.
- Typed worker foreign keys and name/role snapshots preserve historical assignments.
  Database guards reject fabricated names, inactive accounts and cross-scope assignments.
  Deleting a profile relationship does not erase the recorded name snapshot.
- PHN Health Records loads real consultations and registered residents. Add and edit
  use real visit IDs and preserve full clinical details. No synthetic IDs, numeric-ID
  heuristic or state-only success path remains.
- Municipal Submissions consumes real incoming report/submission records and persisted
  review decisions. Review rows are not fabricated into submissions and decisions are
  not posted twice. Only confirmed backend outcomes advance the UI.
- Retained Analytics, Barangays, Community Monitoring and Midwife Dashboard components
  use authorized APIs with loading/error/empty states. The repaired pages no longer
  use legacy session/localStorage records as their backend. Static labels, API-derived
  transient UI working sets and explicit reset helpers remain where appropriate;
  legitimate offline records remain in Dexie rather than those legacy stores.

## Analytics

- The four production analytics endpoints use scoped PostgreSQL aggregate RPCs rather
  than downloading capped resident/visit collections to Node. Monitoring uses a single
  aggregate source; source failures do not become successful empty metrics.
- Directory/detail risk, risk summaries, high-risk pagination and configuration
  recalculation also use the SQL evaluator. Recalculation covers the full eligible
  dataset and writes only changed risk fields, avoiding gratuitous revision increments.
- Tests cover more than 6,000 records, unique resident/TB grouping, current configured
  risk rules, cross-municipality restrictions and inclusive Manila calendar boundaries.
- The actual `early-warning.activity` contract is connected to retained chart shapes.
  Completion ratios use summed numerators/denominators, not averaged percentages.
  A zero denominator remains unknown (`null`), never an invented zero-percent rate.
- Immunization charts display recorded rows, including Due/Missed records, not administered
  doses or official coverage. Minor/senior charts use age at encounter. TCL charts show
  unique recorded enrollment/participation counts within a reported month, not invented
  official program compliance. Count axes are no longer clipped to percentage ranges.
- Reporting month ranges use `Asia/Manila`; current partial months and year transitions
  are explicit. Official submitted report snapshots remain distinct from live analytics.

## Cache and Synchronization Safety

- The disposable cache has a seven-day TTL and 500-record owner-specific LRU bound.
  TTL is based on the saved snapshot, not extended indefinitely by reads; LRU tracks
  successful access.
- Pending, failed, syncing and conflicted records, local clinical drafts and their
  resident/household/member/operation dependencies are protected from eviction.
  Protected records may exceed the disposable limit. Undecodable work fails retention
  closed rather than risking loss.
- Synchronization uses `syncLock:<ownerId>`, unique fencing tokens, lease renewal and
  compare-and-set operation updates. Expired or refreshed workers cannot commit another
  worker's result. Interrupted operations recover using their existing operation IDs.
- Requests bind the intended owner to the actual Supabase token before dispatch and
  reject late responses after account changes. Multipart uploads use the same guard.
- Logout, session expiry and account switching clear sensitive disposable caches and
  legacy working sets without deleting encrypted pending/conflicted work or the keys
  needed to recover it. Stale-session failures stop a pass rather than churning all rows.
- Retry notifications distinguish pending work, conflicts, server errors and authorization
  failures. Resident conflicts link to the actual authorized comparison workflow.

## Resident Revisions

- Server-owned `residents.revision` increments on every write, including non-directory
  writers. The trigger also maintains `updated_at` for timestamp-client compatibility.
- HTTP edits require `If-Match`; integer revisions are compared atomically in PostgreSQL.
  Existing encrypted queues with timestamp tokens remain supported. Stale edits return
  `409 STALE_REVISION` rather than silently overwriting newer data.
- An authorized conflict review fetches the latest server version and allows explicitly
  keeping it or resubmitting selected local fields. A replacement has a fresh operation
  UUID/current revision, while the original encrypted payload remains retained as resolved
  history. Another server change requires a new comparison.
- Municipality and same-named cross-municipality barangay boundaries remain enforced.
  Missing production municipality scope fails closed rather than becoming a wildcard.

## Authentication

- Public personnel self-signup remains prohibited. The legacy personnel URL explains
  the administrator provisioning/invitation/approval/password-setup process and does not
  submit a signup or choose a role, barangay or facility.
- The unsupported decorative Remember Me checkbox was removed. Existing Supabase session
  persistence remains intact; role selection or an alternate mock login was not added.
- The confirmed-unused `app-params.js` URL access-token handling was removed.
- Backend logout revocation, profile verification and account-specific cleanup remain in
  place. Cached permissions are not substituted for a rejected live account profile.
- Raw internal 5xx SQL/error details are not returned to clients. Safe validation and
  revision-conflict details remain available.

## Migrations

Apply in chronological order after confirming the project's existing migration history.
All six current remediation files and the carried-forward security file are pending remote
deployment; none was silently applied to a live database.

| File in `supabase/migrations/` | Purpose |
| --- | --- |
| `20261106000000_harden_health_referrals_write_rls.sql` | Carried forward from the earlier audit: write-policy hardening and personnel function EXECUTE restrictions. |
| `20261106010000_canonical_referral_recipients.sql` | Canonical recipient routing, legacy mapping/quarantine, history, version checks, scoped mutations and receiving-encounter guards. |
| `20261106020000_consultation_operation_idempotency.sql` | Unique visit operation keys, retained clinical details, logical creation fingerprints and recoverable side-effect completion. |
| `20261106030000_scoped_aggregate_analytics.sql` | Scoped aggregate RPCs, shared risk evaluation, monitoring/activity contracts and supporting indexes. |
| `20261106040000_resident_revision_concurrency.sql` | Server-owned resident revision and timestamp trigger. |
| `20261106041000_bounded_resident_risk.sql` | Bounded risk detail, aggregate summaries, high-risk identities and full SQL recalculation. |
| `20261106042000_authorized_worker_assignments.sql` | Worker foreign keys/snapshots, exact-ID historical linking and scope/role guards. |

Migration compatibility and preservation are exercised with PostgreSQL-compatible PGlite,
including the entire actual migration chain. Platform Auth/Storage shims are test fixtures,
not production replacements. Reversible guard/function steps are documented in migration
comments. After new data is written, rollback must retain mappings, history, operation keys,
clinical details and assignment snapshots; blindly dropping additive columns would lose data.

## Deployment

1. Back up the target database and verify its applied migration history and existing role
   matrix. Apply the pending files first to an explicitly isolated local/staging project.
2. Review quarantined or ambiguous legacy referrals and unlinked name-only assignments.
   Only authorized staff should choose actual recipient/personnel IDs; do not auto-match
   duplicate names or invent missing resident/visit relationships.
3. Configure approved active personnel with correct municipality, barangay, facility and
   RHU station assignments. New referral responses require appropriate existing role
   permissions. Explicit saved denials are preserved; in particular review Health Supervisor
   matrices created by older partial bootstrap migrations and RHU recipient/analytics rights.
4. Schedule an appropriate migration window: transactional index builds and backfills can
   block concurrent writes. Test permissions and refresh query statistics after bulk loads.
5. Deploy backend changes before frontend adapters. The application intentionally surfaces
   missing RPC/schema failures instead of pretending that data sources are empty.
6. Keep service-role credentials server-only, configure the required backend anon key,
   and verify API/CORS URLs and Supabase Auth redirect/email delivery configuration.
7. Serve the PWA over HTTPS and retain IndexedDB/WebCrypto support. Reload upgraded clients
   and close stale tabs for IndexedDB schema updates. Do not clear site storage, delete
   encryption keys or change origins while unsynchronized work still needs recovery.
8. Smoke-test the deployed flows with dedicated test accounts/data: assigned referral
   acceptance/rejection/completion, sender status/history, response-loss retry, reconnect,
   logout/account switch, resident conflict resolution and large-data scoped reports.

## Verification and Limits

| Check | Result |
| --- | --- |
| Complete backend regression suite | 655 passed; zero failed, cancelled or skipped. |
| Complete frontend unit/integration suite after activity wiring | 364 passed; zero failed, cancelled or skipped. |
| Combined automated regressions | 1,019 passed. |
| Frontend lint | Passed (`npm run lint --prefix frontend`). |
| Vite production and PWA service-worker build | Passed (`npm run build --prefix frontend`). |
| Patch whitespace | Passed; Windows Git may warn about future LF/CRLF normalization. |
| Advisory JavaScript `checkJs` typecheck | Still reports codebase-wide diagnostics; this worktree is not claimed type-clean. |
| Live Supabase/SMTP and browser E2E against deployed services | Not run or claimed verified. An explicit isolated target and authorized test accounts are required. |

Automated coverage includes PostgreSQL migration replay/history preservation, recipient
authorization/role/facility/status/version checks, actual backend consultation response-loss
replay, duplicate protection and side-effect recovery, owner/fencing/expiry/switch recovery,
TTL/LRU dependency preservation, resident compare-and-swap, and SQL-to-chart contracts.

Intentional safeguards are not hidden successes: ambiguous unkeyed clinical response-loss
records and uncertain legacy recipients require review; RHU triage drafts are not auto-replayed;
clinical history is not hard-deletable; official vaccination coverage/program compliance
requires definitions/eligibility data absent from these recorded activity measures.
Offline snapshots can be stale until the server is reachable. Browser encryption is defense
in depth and does not make a compromised same-origin application or a full device/profile
extraction safe; device security and operational access controls still matter.

## File Inventory

The following lists the complete uncommitted remediation worktree, including retained
earlier-audit fixes. `backend/src/config/supabase.js`, `backend/src/services/healthServices.service.js`,
`backend/src/services/programForms.service.js` and the `000000` security migration include
carried-forward work rather than new replacements. No unrelated binary/archive or production
environment file is included.

### Modified Backend Files

```text
backend/src/config/roles.js
backend/src/config/supabase.js
backend/src/controllers/analytics.controller.js
backend/src/controllers/consultations.controller.js
backend/src/controllers/households.controller.js
backend/src/controllers/municipalSubmissions.controller.js
backend/src/controllers/phnQueue.controller.js
backend/src/controllers/referrals.controller.js
backend/src/controllers/reports.controller.js
backend/src/controllers/residents.controller.js
backend/src/middleware/errorHandler.js
backend/src/middleware/idempotency.js
backend/src/repositories/fileRepository.js
backend/src/repositories/supabaseRepository.js
backend/src/routes/consultations.routes.js
backend/src/routes/households.routes.js
backend/src/routes/index.js
backend/src/routes/phnQueue.routes.js
backend/src/routes/referrals.routes.js
backend/src/services/analytics.service.js
backend/src/services/consultations.service.js
backend/src/services/healthServices.service.js
backend/src/services/householdRiskWorkflow.service.js
backend/src/services/households.service.js
backend/src/services/intake.service.js
backend/src/services/municipalSubmissions.service.js
backend/src/services/operational.service.js
backend/src/services/phnQueue.service.js
backend/src/services/programForms.service.js
backend/src/services/referrals.service.js
backend/src/services/reports.service.js
backend/src/services/residentRisk.service.js
backend/src/services/residents.service.js
backend/test/communityMapFilters.test.js
backend/test/offlineDuplicateGuards.test.js
backend/test/referralsScope.test.js
```

### Added Backend Tests

```text
backend/test/workerDirectory.test.js
backend/tests/aggregateAnalytics.database.test.js
backend/tests/aggregateAnalytics.test.js
backend/tests/canonicalReferralMigration.test.js
backend/tests/canonicalReferralWorkflow.test.js
backend/tests/consultationIdempotency.test.js
backend/tests/consultationIdempotencyMiddleware.test.js
backend/tests/consultationIdempotencyMigration.test.js
backend/tests/consultationIdempotencySchema.test.js
backend/tests/privateErrorResponses.test.js
backend/tests/residentRevisionConcurrency.test.js
backend/tests/residentRiskMigrationChain.test.js
backend/tests/residentRiskSql.test.js
backend/tests/workerAssignmentPersistence.test.js
```

### Modified Frontend Files

```text
frontend/package.json
frontend/src/context/AuthContext.jsx
frontend/src/features/analytics/pages/Analytics.jsx
frontend/src/features/analytics/pages/Barangays.jsx
frontend/src/features/analytics/pages/CommunityMonitoring.jsx
frontend/src/features/analytics/pages/HealthTrends.jsx
frontend/src/features/authentication/pages/Login.jsx
frontend/src/features/consultations/pages/TreatmentConsultation.jsx
frontend/src/features/dashboards/pages/MidwifeDashboard.jsx
frontend/src/features/dashboards/pages/RHUDashboard.jsx
frontend/src/features/health-records/pages/PhnHealthRecords.jsx
frontend/src/features/health-records/pages/TCLS.jsx
frontend/src/features/households/components/RiskActionModals.jsx
frontend/src/features/households/lib/riskClusterAdapter.js
frontend/src/features/households/pages/AddHouseholdPage.jsx
frontend/src/features/households/pages/HouseholdRiskDetail.jsx
frontend/src/features/offline/OfflineSyncProvider.jsx
frontend/src/features/offline/components/OfflineStatusIndicator.jsx
frontend/src/features/referrals/lib/referralPdfRenderer.js
frontend/src/features/referrals/lib/referralTrackingActions.js
frontend/src/features/referrals/pages/HealthReferrals.jsx
frontend/src/features/registration/pages/PersonnelRegistration.jsx
frontend/src/features/registration/pages/RegistrationTypeSelection.jsx
frontend/src/features/residents/pages/ResidentsPage.jsx
frontend/src/features/submissions/pages/MunicipalSubmissions.jsx
frontend/src/features/triage/lib/triageWorkflow.js
frontend/src/features/triage/pages/IncomingReferrals.jsx
frontend/src/features/triage/pages/RhuTriage.jsx
frontend/src/lib/navConfig.js
frontend/src/lib/permissions.js
frontend/src/routes/AppRoutes.jsx
frontend/src/services/api/apiClient.js
frontend/src/services/api/authApi.js
frontend/src/services/api/barangaysApi.js
frontend/src/services/api/consultationsApi.js
frontend/src/services/api/earlyWarningApi.js
frontend/src/services/api/healthRecordsApi.js
frontend/src/services/api/healthServicesApi.js
frontend/src/services/api/householdsApi.js
frontend/src/services/api/monitoringApi.js
frontend/src/services/api/municipalSubmissionsApi.js
frontend/src/services/api/referralsApi.js
frontend/src/services/api/reportsApi.js
frontend/src/services/api/residentsApi.js
frontend/src/services/local/adminUserStore.js
frontend/src/services/local/auditStore.js
frontend/src/services/local/consultationStore.js
frontend/src/services/local/followUpScheduleStore.js
frontend/src/services/local/householdRiskStore.js
frontend/src/services/local/householdStore.js
frontend/src/services/local/municipalSubmissionsStore.js
frontend/src/services/local/residentStore.js
frontend/src/services/local/tclStore.js
frontend/src/services/local/workflowStore.js
frontend/src/services/offline/consultationOfflineService.js
frontend/src/services/offline/db.js
frontend/src/services/offline/drafts.js
frontend/src/services/offline/handlers.js
frontend/src/services/offline/householdOfflineService.js
frontend/src/services/offline/meta.js
frontend/src/services/offline/outbox.js
frontend/src/services/offline/queue.js
frontend/src/services/offline/records.js
frontend/src/services/offline/residentOfflineService.js
frontend/src/services/offline/syncCore.js
frontend/src/services/offline/syncEngine.js
frontend/src/services/offline/syncRunner.js
frontend/tests/offline/consultationDraft.test.js
frontend/tests/offline/dbMigration.test.js
frontend/tests/offline/engine.test.js
frontend/tests/offline/permissionsAndHouseholds.test.js
frontend/tests/registration/residentOnlyRoutes.test.js
frontend/tests/triage/triageWorkflow.test.js
```

### Added Frontend Files

```text
frontend/src/features/health-records/lib/phnRecords.js
frontend/src/features/health-records/lib/tclData.js
frontend/src/features/referrals/components/ReferralHistory.jsx
frontend/src/features/residents/components/ResidentConflictReview.jsx
frontend/src/features/submissions/lib/municipalReports.js
frontend/src/hooks/useAuthorizedData.js
frontend/src/hooks/useHouseholdWorkers.js
frontend/src/lib/legacyAnalytics.js
frontend/src/lib/serverRows.js
frontend/src/services/api/authorizedViewsApi.js
frontend/src/services/auth/authOwnerLifecycle.js
frontend/src/services/local/accountWorkingSets.js
frontend/src/services/offline/residentConflictService.js
frontend/src/services/offline/residentRevision.js
frontend/tests/analytics/activityCharts.test.js
frontend/tests/analytics/aggregatePayload.test.js
frontend/tests/api/ownerBinding.test.js
frontend/tests/households/workerDirectory.test.js
frontend/tests/offline/cacheRetention.test.js
frontend/tests/offline/consultationSync.test.js
frontend/tests/offline/consultationSyncEndToEnd.test.js
frontend/tests/offline/ownerLocks.test.js
frontend/tests/offline/residentRevision.test.js
frontend/tests/referrals/referralRoutingActions.test.js
```

### Removed File

```text
frontend/src/lib/app-params.js
```

### Added Migration and Report Files

```text
supabase/migrations/20261106000000_harden_health_referrals_write_rls.sql
supabase/migrations/20261106010000_canonical_referral_recipients.sql
supabase/migrations/20261106020000_consultation_operation_idempotency.sql
supabase/migrations/20261106030000_scoped_aggregate_analytics.sql
supabase/migrations/20261106040000_resident_revision_concurrency.sql
supabase/migrations/20261106041000_bounded_resident_risk.sql
supabase/migrations/20261106042000_authorized_worker_assignments.sql
docs/audit-remediation-implementation.md
```
