# KALUSAGAP Backend Preparation (NOT IMPLEMENTED)

This document prepares the backend structure for features that are currently
frontend-only. **No backend logic, API endpoint, database connection, or
authentication is implemented.** Each section below describes the future
purpose and TODO work for one area. The frontend continues to use its mock
stores until these are built.

---

## 1. User Management

// TODO: Add the database model for user accounts (name, email, contact,
// role, assigned barangay, status, password hash).
// TODO: Add endpoints for create / update / disable / enable / reset-password
// / delete (disabled only) with admin-only authorization.
// Frontend reference: frontend/src/services/mock/adminUserStore.js

## 2. Staff Registration Requests

// TODO: Add the database model for staff registration requests
// (applicant info, documents, status, notes, reviewer, timestamps).
// TODO: Add endpoints for list / review (approve, reject, request documents)
// with required-notes validation on the server.
// Frontend reference: frontend/src/services/mock/staffRequestStore.js

## 3. Health Supervisor Account Verification

// TODO: Add the database model for supervisor verification accounts
// (assigned barangay, document status, PHN endorsement note, status, reason).
// TODO: Add endpoints for admin review decisions and PHN endorsements.
// Frontend reference: frontend/src/services/mock/supervisorVerificationStore.js

## 4. Role and Barangay Assignment

// TODO: Add role and barangay assignment columns to the user model.
// TODO: Add server-side validation of role/barangay combinations
// (barangay-scoped roles require a barangay; others must have none).
// Frontend reference: adminUserStore.validateAssignment

## 5. Audit Logs

// TODO: Add the database model for audit events (user, role, action,
// description, status, timestamp, IP address).
// TODO: Add login/logout event capture and an admin-only query endpoint with
// search, action, role, and date filters.
// Frontend reference: frontend/src/services/mock/auditStore.js

## 6. Medical Certificate Status History

// TODO: Add the database model for medical certificates and their status
// history (previous status, new status, actor, notes, timestamp).
// TODO: Add server-side enforcement of the allowed transitions
// (Draft → For Review → Approved | Rejected; Approved → Issued) and
// confirmation-before-issuing.
// Frontend reference: medicalCertificateStore.ALLOWED_TRANSITIONS

## 7. Household Verification Records

// TODO: Add verification columns to the household model (verification status,
// reviewer, review date, correction reason).
// TODO: Add endpoints so the Health Supervisor's verification decisions are
// persisted and visible to the submitting BHW.
// Frontend reference: householdStore.applyVerification

## 8. Resident Health Record Export

// TODO: Add an export endpoint that generates a resident-owned health record
// bundle (resident info, assessments, vitals, diagnoses, treatments,
// referrals, follow-ups) with resident-only authorization.
// Frontend reference: HealthRecord.exportHealthRecord

## 9. Resident PhilPEN Results

// TODO: Add the database model for PhilPEN assessment results (date, risk
// classification, findings, recommendations, follow-up advice, status).
// TODO: Add a resident-scoped read endpoint — residents must never see or
// edit another resident's results.
// Frontend reference: HealthRecord philpenResults

## 10. RHU Referrals

// TODO: Add the database model for referrals (resident, referring personnel,
// receiving facility, reason, priority, status, notes, assigned personnel).
// TODO: Add endpoints for list / detail / status updates with role-based
// authorization (RHU Personnel manage; MHO monitors).
// Frontend reference: frontend/src/services/mock/referralTrackingStore.js

## 11. MHO Referral Tracking

// TODO: Add a referral status history table powering the tracking timeline.
// TODO: Add municipality-wide, read-mostly query endpoints for the MHO
// dashboard and referral tracking views.
// Frontend reference: referralTrackingStore (shared with RHU referrals)

## 12. Barangay Hotspot Data

// TODO: Add the database model / query for barangay-level health aggregates
// feeding the community monitoring (hotspot) map.
// TODO: Add an analytics endpoint scoped to the requesting role's municipality.
// Frontend reference: features/analytics/pages/Barangays.jsx

---

**Reminder:** Everything in this file is preparation only. Do not treat any
backend functionality as implemented or working.
