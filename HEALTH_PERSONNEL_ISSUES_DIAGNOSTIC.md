# Health Personnel Registration, Medical Certificates, and Incoming Reports - Issues Diagnostic

## Investigation Summary

This document details the root causes of issues in the health personnel registration, medical certificate, and incoming reports workflows.

---

## 1. MEDICAL CERTIFICATE WORKFLOW - ROOT CAUSES IDENTIFIED

### 1.1 Authorization Gate Issue
**Location:** `backend/src/routes/medicalCertificates.routes.js:35-39`

**Issue:** The medical certificates GET endpoints use `request` middleware chain which includes `authorizeStation(RHU_STATIONS.TRIAGE)`. This gate was intended to allow RHU Personnel with the TRIAGE station to initiate certificate requests, but it creates an authorization problem:

- **Problem**: The station authorization middleware (line 38) enforces that RHU Personnel MUST have the 'triage' station
- **Impact**: RHU Personnel with other station assignments (e.g., 'consultation' only) are rejected even if they should be able to view certificates in their municipality
- **Root Cause**: The station gate is too restrictive for a READ-only endpoint; it should only apply to POST (creation)

### 1.2 Approval Status Gate Missing in Frontend
**Location:** `frontend/src/features/certificates/components/MedicalCertificateModal.jsx:82-87`

**Issue:** While the modal loads certificate data, there is no verification that the authenticated user has `approval_status = 'approved'` in the `personnel_accounts` table before allowing view/edit operations.

**Impact**: Users with `approval_status = 'pending'` or `approval_status = 'rejected'` may attempt to access certificates, causing confusion or silent failures.

### 1.3 Missing Service-Layer Approval Check
**Location:** `backend/src/services/medicalCertificates.service.js`

**Issue:** The `getById` function (line 352-372) loads and returns a certificate without re-verifying that:
- The authenticated user's account has `approval_status = 'approved'`
- The user's account is not `setup_required = true`
- The user's account is not `suspended_at is not null`

**Impact**: RLS policies on the `visits` table enforce `personnel_session_is_usable()`, but there is no equivalent gate on the medical certificates service layer. An unapproved user who somehow bypasses the frontend might still retrieve certificate data.

---

## 2. INCOMING REPORTS - ROOT CAUSES IDENTIFIED

### 2.1 Missing Authorization Check in Frontend
**Location:** `frontend/src/features/reports/components/IncomingReports.jsx:141-159` (act function)

**Issue:** The `act` function that marks reports as Received/Reviewed/Rejected does NOT re-verify the user's role before sending the API request.

**Problem:**
```javascript
const act = async (report, status) => {
  if (!canReview || user?.role !== report.recipientRole) return;
  // ... continues
};
```

While there IS a check `user?.role !== report.recipientRole`, there is NO verification that:
- The user still has `approval_status = 'approved'`
- The user has `reports.view` permission at runtime
- The user's session is still valid

### 2.2 Incoming Reports Detail Retrieval - Race Condition
**Location:** `frontend/src/features/reports/components/IncomingReports.jsx:94-110`

**Issue:** When a report is opened, the component fetches the full report content via `reportsApi.get(detail.id)`. However:

**Problem 1:** The fetch is triggered in a `useEffect` with `[detail]` dependency, but there is NO cleanup if:
- The user closes the modal before the request completes
- A new report is opened while the previous request is still loading
- The backend returns an error (e.g., 404 if the report was deleted)

**Problem 2:** The error state persists and blocks the "Approve Report" button, preventing any retry or fallback.

### 2.3 Report Content Null/Undefined Not Gracefully Handled
**Location:** `frontend/src/features/reports/components/IncomingReports.jsx:345`

**Issue:** The report snapshot view is called with `content={detailContent?.content}`, but:

**Problem:** If `detailContent` is null (from the API GET /:id request), then `detailContent.content` will throw an error or be undefined, and the ReportSnapshotView will show "Report content unavailable" even if the report metadata loaded correctly.

### 2.4 RHU Personnel Facility Scope Not Enforced on Frontend
**Location:** `frontend/src/features/reports/components/IncomingReports.jsx:141-159`

**Issue:** RHU Personnel can view incoming reports routed to their facility (filtered by `recipient_facility_id` on the backend). However, the frontend does NOT verify that:
- The report's `recipientFacilityId` matches the user's `facilityId`
- The user can take actions on reports outside their assigned facility

**Impact**: An RHU Personnel from Facility A might attempt to approve a report routed to Facility B (if the backend filtering fails).

---

## 3. TRIAGE ACCESS CONTROL - ROOT CAUSES IDENTIFIED

### 3.1 Approval Status Gate Applied Only via RLS, Not Frontend
**Location:** Multiple triage endpoints

**Issue:** The access control relies entirely on Supabase RLS policy `personnel_session_is_usable()` on the `visits` table. This policy blocks:
- `approval_status !== 'approved'`
- `setup_required = true`
- `suspended_at is not null`

**Problem:** While RLS is strong, there is NO service-layer re-check in the triage controller/service. If:
- RLS is bypassed (extremely unlikely but possible with a compromised Supabase key)
- The policy cache is stale
- The user's approval status changed mid-session

Then an unapproved user could still POST a visit (until the RLS rejects the INSERT).

### 3.2 Station Gate Too Strict for RHU Personnel Triage Access
**Location:** `backend/src/routes/medicalCertificates.routes.js:35-39`

**Issue:** Same as Medical Certificate 1.1 — the station gate blocks RHU Personnel without the 'triage' station from accessing triage-related endpoints, even for read-only operations.

### 3.3 No Frontend Triage Authorization Re-Check
**Location:** `frontend/src/features/triage/pages/RhuTriage.jsx` (assumed location)

**Issue:** The triage page loads without re-verifying:
- The user's `approval_status = 'approved'`
- The user has `rhu_stations = ['triage']` (or similar station assignment)
- The user's session is valid at page load time

**Impact**: A user with a pending approval status could navigate to the triage page and see the form loaded, even though backend calls would fail.

---

## 4. SUMMARY TABLE - ROOT CAUSES BY ISSUE

| Issue | Root Cause | Location | Impact |
|-------|-----------|----------|--------|
| Medical Certificate - 403 on GET | Station gate too strict on read endpoints | routes:35-39 | RHU Personnel with non-triage stations blocked |
| Medical Certificate - Missing Approval Check | No service-layer re-check of approval_status | service:352-372 | Unapproved users might retrieve certificates |
| Incoming Reports - Cannot Open | Possible race condition in useEffect | component:94-110 | Report detail fails to load; error persists |
| Incoming Reports - Content Unavailable | null content not handled gracefully | component:345 | User sees "unavailable" instead of error details |
| Incoming Reports - Scope Not Verified | RHU facility scope not checked on frontend | component:141-159 | RHU Personnel might see reports outside their facility |
| Triage - Unapproved Access | No frontend re-check of approval_status | triage page (unknown location) | Unapproved user can navigate to triage page |
| Triage - Station Gate Too Strict | Station authorization on read endpoints | routes (medical certificates) | Consultation-only RHU Personnel blocked from reads |

---

## 5. RECOMMENDATIONS FOR FIXES

1. **Split Station Authorization**: Separate the station gate into read and write endpoints:
   - GET endpoints: require only role (FEATURE_ROLES.certificates or FEATURE_ROLES.triage)
   - POST endpoints: require role + station (authorizeStation(TRIAGE))

2. **Add Service-Layer Approval Checks**: Re-verify `personnel_session_is_usable()` in:
   - `medicalCertificates.service.js::getById`
   - `reports.service.js::getById`
   - Triage read/write endpoints

3. **Improve Frontend Error Handling**:
   - Validate `detailContent?.content` exists before rendering
   - Add retry logic for failed detail fetches
   - Show meaningful error messages (not just "unavailable")

4. **Add Frontend Scope Verification**:
   - RHU Personnel verify `recipientFacilityId` matches their `facilityId` before acting
   - Verify approval_status = 'approved' before allowing triage page navigation

5. **Add Comprehensive Logging**: Log all approval status checks and authorization decisions for audit trail.

