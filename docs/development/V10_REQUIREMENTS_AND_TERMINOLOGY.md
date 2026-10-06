# KALUSAGAP V10 — Requirements and Terminology Reference

## Scope

This reference consolidates the requirement language from §5–§22 and aligns it to the terms already used in the repository.

## Canonical terminology already in use

| Concept | Repository terminology | Notes |
|---|---|---|
| Resident | `resident` | Core person/profile record in the resident workflows and access model. |
| Barangay health worker | `bhw` | Household and community data collection role. |
| Health supervisor | `health_supervisor` | Barangay-scoped supervisor/verification and monitoring role. |
| Public health nurse | `phn` | Clinical review, verification, and consultation follow-up role. |
| Municipal health officer | `mho` | Municipality-wide reporting and oversight role. |
| RHU personnel | `rhu_personnel` | Intake / triage / authorized reporting role. |
| Resident-limited | `resident-limited` | Restricted state for residents awaiting verification, not a separate staff role. |
| Household profile | `households` | Household-level workflow and monitoring area. |
| Follow-up | `follow-up` / `follow_ups` | Distinct from consultation records and linked to a resident and consultation when applicable. |
| Consultation | `consultations` | Recorded clinical encounter; retained as a distinct record from follow-up. |
| Health service | `health_services` | Program, schedule or activity; not necessarily an online booking workflow. |
| Resident verification | `verification_status` / `verification` workflows | Existing verification and review model should be reused. |
| Households without resident accounts | `household members` / resident-linked records | The current codebase distinguishes household members from resident records; no duplicate resident profile should be created for a person who already has a resident record. |
| Estimated date of delivery | `EDD` | Preserved separately from confirmed delivery information. |
| Maternal records | `M1` / maternal workflows | Existing official form names and labels should be preserved. |
| NFP | `Needs clarification` | Not enough evidence in the codebase or prompt to define it without guessing. |

## Requirement traceability

### §5 — Resident dashboard and health records

- Requirement: Residents must access and search their own records while preventing access to another resident's private health information.
- Affected modules: resident self-service dashboard, health records, verification gating, resident navigation, profile access.
- Files or database objects: `frontend/src/features/residents/*`, `frontend/src/features/health-records/*`, `backend/src/routes/*`, `backend/src/repositories/supabaseRepository.js`.
- Implementation status: supported by existing resident scoping and role restrictions; any remaining ambiguity should be documented rather than invented.
- Test performed: `npm test --prefix backend`, `npm test --prefix frontend`, `npm run typecheck --prefix frontend`, `npm run build --prefix frontend`.
- Unresolved ambiguity: residency transfer and appointment policy remains under the "Needs clarification" category unless the repo clearly defines it.

### §6 — Consultation and follow-up connected workflow

- Requirement: Consultation records remain distinct from follow-up records; follow-up is linked to a resident and consultation when planned.
- Affected modules: consultations, follow-ups, notifications, resident/dashboard scheduling.
- Files or database objects: `backend/src/routes/consultations.routes.js`, `backend/src/routes/residentFollowups.routes.js`, `frontend/src/features/consultations/*`, `frontend/src/features/follow-ups/*`.
- Implementation status: existing workflow preserved and re-used; no duplicate consultation record should be created as part of follow-up scheduling.
- Test performed: repo test suite and frontend build checks.
- Unresolved ambiguity: none at the current repository level beyond general policy questions already tracked in the progress document.

### §7 — Health services and scheduling

- Requirement: Present health services as organized schedules/programs without forcing a separate online-booking workflow.
- Affected modules: `health-services` API, service catalog, frontend schedule displays.
- Files or database objects: `backend/src/routes/healthServices.routes.js`, `backend/src/services/healthServices.service.js`, `frontend/src/features/health-services/*`.
- Implementation status: implementation should prefer actual schedule/program display and walk-in accommodation unless the codebase clearly establishes booking capability.
- Test performed: project test suite.
- Unresolved ambiguity: online booking policy remains a required clarification item.

### §8 — BHW household profiling

- Requirement: Household profile must display relevant household details and members, maintain relationship data, and support adding existing residents without duplicating records.
- Affected modules: BHW household pages, household member linking workflows, resident search.
- Files or database objects: `backend/src/routes/households.routes.js`, `frontend/src/features/households/*`, `backend/src/services/households.service.js`.
- Implementation status: repository workflow is reused as the source of truth; no duplicate resident should be created when a person already exists.
- Test performed: project test suite.
- Unresolved ambiguity: household-member representation for persons without resident accounts remains a policy question requiring codebase evidence or a documented decision.

### §10 — Map and reports

- Requirement: Use actual records only; no fabricated hotspots or totals; respect filters and periods.
- Affected modules: dashboards, community health map, reporting pages.
- Files or database objects: `frontend/src/features/analytics/*`, `frontend/src/features/reports/*`, `backend/src/services/analytics.service.js`.
- Implementation status: current codebase uses aggregated records and filters rather than hardcoded example totals.
- Test performed: backend and frontend tests plus build checks.
- Unresolved ambiguity: none in the current repository state.

### §11 — Consultation data entry

- Requirement: preserve narrative findings and structured diagnosis support where the system already has it; avoid building a new clinical catalog from assumptions.
- Affected modules: consultation intake and treatment editing flows.
- Files or database objects: `backend/src/services/consultations.service.js`, `frontend/src/features/consultations/*`.
- Implementation status: existing field semantics are retained; no unsupported diagnosis catalog was introduced.
- Test performed: repository test suite.
- Unresolved ambiguity: diagnosis and medication catalog decisions remain a clarification item if the codebase does not already supply an authoritative list.

### §12 — Vital signs, BP, and BMI

- Requirement: Record measurements clearly, calculate BMI when height/weight are available, and avoid inventing clinical thresholds.
- Affected modules: vitals and consultation forms.
- Files or database objects: `backend/src/services/intake.service.js`, `frontend/src/features/consultations/*`.
- Implementation status: safe recording and display patterns are used; any critical clinical threshold remains unimplemented until the project provides approved criteria.
- Test performed: repository test suite.
- Unresolved ambiguity: approved clinical thresholds and automated alert policy remain marked as Needs clinical confirmation.

### §13 — Maternal records and postnatal monitoring

- Requirement: preserve EDD separately from confirmed delivery and maintain monitoring without overwriting prior maternal history.
- Affected modules: maternal monitoring, M1, patient follow-up forms.
- Files or database objects: `frontend/src/features/health-records/pages/M1Records.jsx`, `frontend/src/features/health-records/pages/M1Fhsis.jsx`, `backend/src/services/m1*`.
- Implementation status: preserve the official labels and existing structure; avoid adding a fabricated form layout.
- Test performed: repository test suite.
- Unresolved ambiguity: official print template and child-related immunization fields remain under clarification if the codebase lacks a canonical template.

### §14 — Sidebar and module organization

- Requirement: consolidate redundant modules while preserving role-specific access and required workflows.
- Affected modules: dashboard layout, navigation, role configuration.
- Files or database objects: `frontend/src/layouts/*`, `frontend/src/features/*`.
- Implementation status: the codebase uses role-scoped navigation and should avoid dropping required functionality before verifying dependencies.
- Test performed: frontend build and test checks.
- Unresolved ambiguity: none determined from the project code alone.

### §15 — Referrals, family planning, and service indicators

- Requirement: keep records tied to the correct resident/service and avoid duplicate records; the meaning of NFP remains unknown unless the codebase defines it.
- Affected modules: referrals and service indicators.
- Files or database objects: `backend/src/services/referrals.service.js`, `frontend/src/features/referrals/*`.
- Implementation status: current implementation follows resident and service association standards without inventing new program indicators.
- Test performed: repository test suite.
- Unresolved ambiguity: NFP expansion is still marked as Needs clarification.

### §16 — Monthly reports and community health reporting

- Requirement: maintain actual aggregates, filter periods correctly, and preserve M1/FHSIS logic.
- Affected modules: report generation and dashboards.
- Files or database objects: `frontend/src/features/reports/*`, `backend/src/services/reports*`.
- Implementation status: actual records and selected periods are respected in the current implementation.
- Test performed: repository test suite and frontend build.
- Unresolved ambiguity: none beyond standard data availability and report-period assumptions already handled by scope logic.

### §17–§19 — RHU personnel, accountability, and final quality gates

- Requirement: preserve workflow sequence, accountability, access controls, and evidence-based validation before claiming completion.
- Affected modules: triage, accountability records, verification workflows.
- Files or database objects: `backend/src/services/triage*`, `backend/src/services/phnQueue.service.js`, `backend/src/services/staffAccounts.service.js`, `frontend/src/features/triage/*`.
- Implementation status: supported workflows use role and scope checks and should continue to be validated with the relevant tests.
- Test performed: project test suite.
- Unresolved ambiguity: triage personnel policy and record ownership rules should remain documented when not clearly encoded.

## Needs clarification

1. Should residents be able to book Health Services online, or should the system only display schedules and accommodate walk-ins?
2. What exactly makes a household verified?
3. What exactly makes a resident profile eligible for approval?
4. Should diagnosis, findings, treatment, and medication use structured lookup tables, free text, or a combination?
5. Which approved clinical thresholds should be used for vital-sign alerts?
6. What is the intended meaning of "NFP"?
7. What is the official maternal monitoring print template?
8. What are the intended rules for household members without resident accounts?
9. What are the approved workflow and permissions for triage personnel?
10. Which immunization and child-related details are required?
11. Health Supervisor Dashboard — the requirement traceability does not cite a concrete code path; the repo does have a real dashboard module at `frontend/src/features/dashboards/pages/HealthSupervisorDashboard.jsx`.
12. Verification — the requirement traceability does not cite a concrete verification path; the repo does have `backend/src/routes/verifications.routes.js` and `frontend/src/features/verification/*`.
13. Family Planning — the requirement traceability does not cite a concrete code path in the current V10 notes; the repo currently lacks a clearly defined family-planning module path.
14. §13 maternal print — per-visit tracking
    - Question: The adviser described a compact, tabular (Excel-like) maternal printed form. The current schema stores a single case-level maternal record per pregnancy with no per-visit rows.
    - Impact: without per-visit rows, the printed form can only show case-level fields (LMP, EDD, visit count, delivery, postpartum dates).
    - Available alternatives:
      a. Accept the current case-level printout.
      b. Add a `maternal_visits` table (date, BP, weight, fundal height, fetal heart tone, gestational age, provider) and rebuild the printout as a visit-log table.
    - Safest temporary state: keep the current case-level printout.
    - Blocked: no. Implementation of the existing printout is complete. Full tabular form is deferred pending confirmation.

## Implementation status snapshot

- Repository read and terminology review: complete.
- Requirement reference file: created.
- Progress file: maintained under `docs/development/V10_IMPLEMENTATION_PROGRESS.md`.
- Code-level changes: deferred to the implementation wave that matches the currently available repository state and tests.
- Verification: backend and frontend tests, frontend typecheck, and frontend production build passed in the current session.
