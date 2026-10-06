# KALUSAGAP V10 — Health Supervisor Requirements and Repository Audit

## Authority and scope

- Authoritative requirements: the user-provided V10 Health Supervisor prompt, §§3–14. The project owner confirmed that no `Standard.pdf` or transcript exists and explicitly designated those sections as the source of truth.
- Do not infer adviser intent beyond §§3–14. Reuse codebase terminology, forms, policies, role boundaries, and data models where they exist.
- This document records the HS-1 inspection baseline and implementation order. Update it after each Health Supervisor wave together with `V10_IMPLEMENTATION_PROGRESS.md`.

## Required sequence

| Wave | Requirement | Scope boundary |
|---|---|---|
| HS-1 | Inspection, terminology, and progress documentation | Audit baseline; no feature implementation |
| HS-2 | Dashboard header | Title, assigned barangay, period/date controls, reliable last-updated value, report/export actions |
| HS-3 | Dashboard summary cards | Supported indicators only; accurate values and empty states |
| HS-4 | Community health map on the dashboard | Reuse the existing map, preserve server-side geographic scope, and remove no underlying feature |
| HS-5 | Health trends and hotspots | Use actual data and documented criteria; no invented hotspot or outbreak rules |
| HS-6 | Sidebar restructure | Remove the separate Community Health Monitoring destination and use “Consultations” without dropping workflows |
| HS-7 | Resident verification workspace | Authorized resident-review workflow only |
| HS-8 | Household verification workspace | Keep household verification distinct from resident identity verification |
| HS-9 | Consultations page | Organize existing consultation and follow-up workflows without adding clinical permissions |
| HS-10 | Reports and exports | Use actual data, authorized geography, selected period, and existing report utilities |
| HS-11 | Notifications and review tasks | Surface supported tasks from authenticated-user notifications without duplicates |
| HS-12 | UI/UX consistency | Consistency and accessibility pass; do not redesign unrelated roles |
| HS-13 | Final security and backend audit | Cross-cutting audit after per-wave checks; fix any deficiency before final tests |
| HS-14 | Testing and final verification | Verify behavior, scope, empty states, reports, and unrelated-role regressions |

## HS-1 repository baseline

### Repository state

- Branch: `v10`, tracking `origin/v10`.
- HEAD: `1c5b6e2` (`merge v6 and v7`).
- At inspection start, `git status --short` reported 103 entries: 79 modified/deleted tracked paths and 24 untracked paths. Existing changes span application code, docs, tests, and migrations. HS-1 did not modify or clean those changes; ownership and intended disposition are not inferred.
- Recent commits: `1c5b6e2` (`merge v6 and v7`), `c0d02ac` (`not tested, merged and inaantok na ako`), `f5264f8` (`feat: RHU triage-to-consultation workflow and related fixes`), `12d2aee` (`feat: wire RHU dashboard statistics to live triage data`), `a4f1769` (`fix: wire admin dashboard statistics and resolve profile page 404`).

### Dashboard and navigation

- Main dashboard: `frontend/src/features/dashboards/pages/HealthSupervisorDashboard.jsx`. It renders “Health Monitoring,” scope-specific descriptive text, five summary cards (Active Cases, High-Risk Cases, Pending Referrals, Overdue Follow-ups, Health Alerts), Cases Requiring Attention, Community Health Alerts, oversight shortcuts, and the Community Health Monitoring barangay table.
- The main dashboard currently has no month/year or date-range controls and does not display a selected period.
- Navigation is defined in `frontend/src/lib/navConfig.js`; the Health Supervisor section currently contains Dashboard, Resident Directory, Resident Verifications, Household Verifications, Account Approvals, Consultation, Records (TCL, M1, Immunization, TB Records, Follow-ups), Schedule Calendar, Health Services, Referrals, Community Monitoring, Early Warning, Reports, Notifications, and Settings.
- Routes are in `frontend/src/routes/AppRoutes.jsx`. The dashboard, verification pages, consultation page, trends page, community monitoring page, reports, and notifications are distinct routes. The community map is currently in the separate Community Monitoring feature, not embedded in the main dashboard.
- Existing visualization surfaces to reuse: `frontend/src/features/analytics/components/CommunityHealthMap.jsx`, `frontend/src/features/analytics/pages/CommunityMonitoring.jsx`, and `frontend/src/features/analytics/pages/HealthTrends.jsx`.

### Dashboard data and period support

- The dashboard calls `referralsApi.list()`, `followUpsApi.list()`, `householdsApi.list({ limit: 100 })`, and `fetchEarlyWarningData(barangay)` for visible barangays. It also consumes `usePhnWorkflow({ source: "intake" })` for intake workflow cases.
- API modules include `frontend/src/services/api/earlyWarningApi.js`, `frontend/src/services/api/referralsApi.js`, `frontend/src/services/api/operationalApi.js`, `frontend/src/services/api/householdsApi.js`, and `frontend/src/services/api/phnWorkflow.js`.
- Backend analytics path: `backend/src/routes/analytics.routes.js` → `backend/src/controllers/analytics.controller.js` → `backend/src/services/analytics.service.js` → repository methods.
- `GET /analytics/early-warning` currently has no month/year or from/to query support. Its “this month” counts, risk/disease distributions, and 12-month trends are computed relative to the server's current date.
- `GET /analytics/community-map` already accepts `from`/`to` date filters, and `GET /analytics/community-map/trends` accepts a year. The map feature has date presets and sends date ranges.
- The dashboard combines date-based events with current-state data (for example resident/household totals, current workflow queue, and overdue follow-ups). Historical “as of period end” values are not established by the dashboard implementation.

### Roles, permissions, and data scope

- Canonical role and feature mapping: `backend/src/config/roles.js`. `FEATURE_ROLES.analytics` includes MHO, PHN, and Health Supervisor; RHU Personnel is not included.
- Analytics endpoints require authentication and analytics-role authorization. The scoped analytics routes also use `resolveBarangayScope` from `backend/src/middleware/barangayScope.js`; it derives a Health Supervisor's barangay from the authenticated session and rejects attempts to request another barangay.
- `getEarlyWarning` filters resident-linked visits/referrals using server-resolved barangay and municipality scope. Preserve this enforcement; client-side filters must not widen scope.
- Dashboard-related existing data objects include residents and visits, households and members, follow-ups, health referrals, and intake visits. Migrations enable RLS on core resident/visit/household/referral/follow-up records. Any changed query or data path still requires per-wave review of authorization, RLS, input validation, and aggregate privacy.

## Baseline gaps and implementation constraints

1. **Header and date controls:** HS-2 added independent month/year controls, defaults to the current month/year, constrains choices to the last 24 months, and displays the chosen month/year. The selected period is not yet passed to dashboard fetches; date-aware data integration remains open for the relevant widget waves.
2. **Period filtering:** existing Early Warning dashboard source is current-period/current-state oriented and does not accept a period. Date-filtered event data can be filtered; present-day registry/workflow state must not be presented as a historical snapshot without a supported as-of model.
3. **Map placement:** a map exists, with date filtering, on the separate Community Monitoring page. HS-4 should reuse it; do not duplicate the map implementation or expose resident identity.
4. **Trends:** a Health Trends page and analytics endpoint exist. Preserve its actual-data and scope behavior; no hotspot rule is currently established by the inspected dashboard and analytics code.
5. **Navigation:** the existing labels and destinations are more extensive than the target structure in §4. Preserve route/deep-link behavior and feature dependencies during HS-6.
6. **Verification, consultation, reports, and notifications:** dedicated pages/routes and role-gated backend paths exist. Inspect those exact paths before changing them; keep resident and household verification distinct and preserve consultation/follow-up records.

## Implementation status update — HS-2

- The main dashboard header now contains independent month and year selectors for the current month and the preceding 23 months, plus a visible month/year label.
- Only the header was changed; existing cards, lists, table, modal, and their visual styles were not changed.
- The controls currently select and display the reporting period. Backend/query filtering is not yet wired, so existing widgets still use their current data behavior until their period-aware implementation wave.
- Verification: `npm run build --prefix frontend` passed.

## Implementation status update — HS-3

- Kept the five existing data-backed summary cards; no new KPI or visual restyling was introduced.
- Added navigation from each card to the existing related Health Supervisor page.
- Active Cases now shows loading and error values from the persistent intake workflow instead of displaying a misleading zero before the request settles or after it fails.
- The selected period does not filter these current-state cards. Historical snapshots are not available, as documented under “Dashboard period semantics for current-state widgets.”
- Verification: `npm run build --prefix frontend` passed.

## Implementation status update — HS-4

- Embedded the existing `CommunityHealthMap` renderer in the Health Supervisor dashboard; the separate Community Monitoring route remains intact.
- The map request uses the authenticated user's existing server-derived geographic scope and sends the selected month as local-calendar `from`/`to` dates.
- Map retry, loading, no-data, and no-mappable-data states remain provided by the existing map component. Clicking a marker displays aggregate counts only; no resident identity is exposed.
- Omitted the component's `newCases` popup field because its backend value is calculated against the current month, not the selected period.
- Verification: `npm run build --prefix frontend` passed.

## Implementation status update — HS-5

- Added dashboard charts for actual case counts by month in the selected year and actual condition counts in the selected month, using the existing scoped community-map analytics endpoints.
- Both charts retain loading/error handling and show empty states instead of substituting local or fabricated figures.
- No hotspot label or threshold was added; the inspected codebase has no documented hotspot criteria. This remains an explicit clarification, not a blocker for trends.
- Verification: `npm run build --prefix frontend` passed after correcting a duplicate import found by the first build attempt.

## Needs clarification

### Dashboard period semantics for current-state widgets

- Question: How should a selected historical month affect widgets whose source represents current state rather than dated events (for example current resident/household totals, current intake queue, and current overdue follow-ups)?
- Impact: the current sources do not provide historical snapshots; treating current values as historical period values would misrepresent what was recorded.
- Alternatives: (a) filter dated events to the selected month and label current-state widgets as current snapshots; (b) defer historical versions until an as-of/history source exists.
- Safest temporary interpretation: use the selected period for dated events and label current-state values as current snapshots. Do not fabricate historical values.
- Blocked: no. This interpretation does not change clinical meaning, security posture, or role permissions.

### Hotspot definition

- Phrase: §3.D requires potential hotspots only “per documented criteria.”
- Impact: no hotspot classification rule was found in the inspected dashboard/analytics path; assigning one would imply an unsupported public-health threshold.
- Alternatives: use a separately approved/documented rule, or show actual counts/trends without calling locations hotspots.
- Safest temporary interpretation: do not label any location a hotspot until criteria are documented.
- Blocked: only hotspot labeling; other dashboard work can continue.

## Per-wave verification and security

- Every data or permission wave must preserve session-derived barangay/municipality scope, role authorization, RLS coverage, aggregate privacy, validated parameters, and explicit error handling.
- Use the smallest relevant test/build command for each wave. Do not run a full suite for documentation-only or isolated changes.
- Record only commands actually run and their results in the progress checkpoint and wave report.
- HS-13 is a final cross-cutting audit, not a substitute for checks during HS-2 through HS-12.
