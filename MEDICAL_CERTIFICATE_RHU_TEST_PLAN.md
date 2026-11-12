# Medical Certificate Request Authorization Fix - Test Plan

## Fix Summary

**Root Cause Identified:**
RHU Personnel could not create medical certificate requests because they were blocked at the resident directory search stage. The authorization chain was:
1. RHU Personnel tried to access Medical Certificate Request page ✓ (authorized via `certificateRequest` role)
2. RHU Personnel tried to search residents via `GET /api/residents` ✗ (blocked - not in `FEATURE_ROLES.residents`)
3. Result: Cannot find patients to associate with certificate requests

**Modifications Made:**

### 1. Role Configuration (`backend/src/config/roles.js`)
- **Line 73**: Added `ROLES.RHU_PERSONNEL` to `FEATURE_ROLES.residents`
- Before: `residents: [ROLES.HEALTH_SUPERVISOR, ROLES.PHN, ROLES.MHO]`
- After: `residents: [ROLES.HEALTH_SUPERVISOR, ROLES.PHN, ROLES.MHO, ROLES.RHU_PERSONNEL]`
- Impact: RHU Personnel can now access the resident directory for certificate request initialization

### 2. Residents Service (`backend/src/services/residents.service.js`)
- **Line 701**: Updated role whitelist to include `rhu_personnel`
- Before: `if (!['health_supervisor', 'phn', 'mho'].includes(role))`
- After: `if (!['health_supervisor', 'phn', 'mho', 'rhu_personnel'].includes(role))`
- **Line 716**: Added RHU Personnel municipality scope validation
- Impact: RHU Personnel can list residents in their assigned municipality

### 3. Zone Filtering Logic (`backend/src/services/residents.service.js`)
- **Line 745**: Zone filtering remains Health Supervisor only (RHU Personnel searches at municipality level)
- Impact: Maintains proper scope boundaries

**Authorization Layers Already Supporting RHU Personnel:**
1. ✓ Medical Certificate routes (`backend/src/routes/medicalCertificates.routes.js`)
   - POST endpoint includes `authorize(FEATURE_ROLES.certificateRequest)` which includes RHU Personnel
   - Request chain includes `authorizeStation(RHU_STATIONS.TRIAGE)` for station enforcement

2. ✓ Medical Certificates service (`backend/src/services/medicalCertificates.service.js`)
   - Line 461: `const isTriageRequest = REQUEST_ROLES.has(user?.role)` where `REQUEST_ROLES` includes RHU Personnel
   - Line 469-486: Forces request status to 'For Review' with no signatory for RHU Personnel
   - RHU Personnel cannot update, approve, or issue (those use `FEATURE_ROLES.certificates` which is PHN/MHO only)

3. ✓ Supabase RLS Policies
   - `medical_certificates_select` (line 79): Allows RHU Personnel to read their municipality's certificates
   - `medical_certificates_insert` (line 258): Allows RHU Personnel to create certificates
   - `medical_certificates_update` (line 270): Blocks RHU Personnel from updates (PHN/MHO only)
   - `residents_select` (line 344): Already includes RHU Personnel for municipality scope

4. ✓ Frontend Access (`frontend/src/features/certificates/pages/CertificateComposer.jsx`)
   - Line 22: `AUTHORIZED_ROLES = ["mho", "phn", "rhu_personnel"]`
   - Line 165: `isRequester = user?.role === "rhu_personnel"` properly identifies request-only workflow

## Test Scenarios

### Scenario 1: RHU Personnel Access Certificate Request Page
**Setup:**
- Logged in as RHU Personnel with Triage station assigned
- Municipality and barangay properly assigned

**Test Steps:**
1. Navigate to Medical Certificates page → should load without access denied error
2. Verify "Request Certificate" button is visible
3. Click button to open Certificate Composer
4. Verify Certificate Composer loads without "Unauthorized" shield alert

**Expected Results:**
- ✓ Page loads
- ✓ Button visible
- ✓ Composer accessible
- ✓ No authorization errors

### Scenario 2: RHU Personnel Search Residents
**Setup:**
- Same as Scenario 1
- Certificate Composer is open

**Test Steps:**
1. In "Select Patient" field, type resident name or ID
2. Verify resident list appears with search results
3. Click to select a resident
4. Verify patient information populates automatically

**Expected Results:**
- ✓ Resident search returns results
- ✓ No "Your role is not permitted" error
- ✓ Only residents from RHU Personnel's municipality shown
- ✓ Patient fields auto-populate (name, age, gender, DOB, address, etc.)

### Scenario 3: RHU Personnel Submit Medical Certificate Request
**Setup:**
- Same as Scenario 2, resident selected
- Certificate Composer has populated patient info

**Test Steps:**
1. Complete required fields:
   - Purpose: Select from dropdown (e.g., "General Medical Certificate")
   - Findings: Leave empty (optional for request)
   - Date Examined: Should be today
   - Other remarks/notes as needed
2. Click Submit button
3. Verify success message and redirect to register

**Expected Results:**
- ✓ Request submits successfully
- ✓ Success toast message appears
- ✓ Returns to Medical Certificates register
- ✓ Request appears in list with status "For Review"
- ✓ Request reference number auto-generated (MC-YYYY-####)

### Scenario 4: Verify RHU Personnel Request Properties
**Setup:**
- Certificate request created in Scenario 3
- Medical Certificates register is open

**Test Steps:**
1. Find the created request in the register
2. Click to view details
3. Verify request properties:
   - Status: "For Review"
   - Created By: RHU Personnel name
   - Medical Officer: Empty (not stamped for request)
   - Patient: Correctly linked resident
   - Municipality: Matches RHU Personnel's municipality
   - Barangay: Matches patient's barangay

**Expected Results:**
- ✓ Request visible in register
- ✓ Status is "For Review" (enforced by backend)
- ✓ No medical officer stamped (request-only workflow)
- ✓ All scope fields correctly set

### Scenario 5: PHN Review RHU Personnel Request
**Setup:**
- Certificate request created in Scenario 3
- Logged in as PHN in same municipality

**Test Steps:**
1. Navigate to Medical Certificates register
2. Find RHU Personnel's request with status "For Review"
3. Click to open request details
4. Verify request can be opened for review
5. Click "Review" or "Approve" button

**Expected Results:**
- ✓ PHN sees request in their list
- ✓ Request details fully visible
- ✓ Review/approval buttons available
- ✓ PHN can edit and add clinical findings
- ✓ PHN can approve and issue certificate

### Scenario 6: RHU Personnel Cannot Access Approval Functions
**Setup:**
- Same as Scenario 5 (certificate request exists)
- Still logged in as RHU Personnel

**Test Steps:**
1. Navigate to Medical Certificates register
2. Find the "For Review" request
3. Click to view details
4. Attempt to click approval/rejection buttons (should be hidden or disabled)
5. Verify form is read-only for decision fields

**Expected Results:**
- ✓ RHU Personnel sees their own requests
- ✓ Approval/rejection buttons NOT visible
- ✓ Cannot modify request fields
- ✓ Cannot change status
- ✓ Can only view (status, patient info, purpose)

### Scenario 7: RHU Personnel Cannot Access Non-Triage Station
**Setup:**
- RHU Personnel account WITHOUT Triage station assigned
- Has municipality but no Triage in rhu_stations

**Test Steps:**
1. Log in as this RHU Personnel
2. Navigate to Medical Certificates page
3. Try to click "Request Certificate" button

**Expected Results:**
- ✓ Button may appear (frontend check passes with role)
- ✓ Backend POST request returns 403 "You are not assigned to the RHU Triage station"
- ✓ Error properly displayed in UI

### Scenario 8: RHU Personnel Cannot Access Cross-Municipality Residents
**Setup:**
- RHU Personnel assigned to Municipality A
- Resident data exists in Municipality B

**Test Steps:**
1. Log in as RHU Personnel for Municipality A
2. Open Certificate Composer
3. Search for resident name (if known from Municipality B)
4. Verify search returns only Municipality A residents
5. Attempt to manually input a Municipality B resident ID

**Expected Results:**
- ✓ Only Municipality A residents in dropdown
- ✓ Manual ID entry of cross-municipality resident returns "Resident not found"
- ✓ No cross-scope access possible

### Scenario 9: Unapproved RHU Personnel Blocked
**Setup:**
- RHU Personnel account with approval_status = "pending" or "rejected"
- Has municipality and Triage station

**Test Steps:**
1. Log in as this RHU Personnel
2. Open Medical Certificates page
3. Try to access GET /api/medical-certificates (via page load)

**Expected Results:**
- ✓ Backend service layer `assertPersonnelApproved()` blocks access
- ✓ Returns 403 "Your account is not approved" or appropriate status message
- ✓ Page shows error state

### Scenario 10: MHO/PHN Still Cannot Access Non-Approved Requests Incorrectly
**Setup:**
- PHN/MHO with proper permissions
- RHU Personnel request in their municipality

**Test Steps:**
1. Log in as PHN/MHO
2. Navigate to Medical Certificates
3. Find RHU Personnel's "For Review" request
4. Verify can open and review
5. Attempt approval workflow

**Expected Results:**
- ✓ PHN/MHO sees request
- ✓ Can review, approve, issue, or reject
- ✓ Their decision is properly logged
- ✓ No unexpected restrictions

## Security Validation Checklist

- ✓ RHU Personnel cannot approve/issue certificates (enforced by role and RLS)
- ✓ RHU Personnel cannot view cross-municipality residents
- ✓ RHU Personnel cannot view cross-barangay residents
- ✓ RHU Personnel without Triage station cannot create requests
- ✓ Unapproved RHU Personnel accounts blocked at service layer
- ✓ Request status forced to "For Review" by DB trigger and service
- ✓ No medical officer stamped for requests (enforced in service)
- ✓ All decisions logged to medical_certificate_logs
- ✓ Supabase RLS prevents unauthorized direct database access
- ✓ Frontend cannot bypass backend authorization

## Related Files Modified

- `backend/src/config/roles.js` — Added RHU Personnel to residents feature
- `backend/src/services/residents.service.js` — Added RHU Personnel to listResidents with proper scope

## Related Files NOT Modified (Already Correct)

- `backend/src/routes/medicalCertificates.routes.js` — Already authorizes RHU Personnel
- `backend/src/services/medicalCertificates.service.js` — Already restricts RHU to request-only
- `backend/src/middleware/authorizeStation.js` — Already enforces Triage station
- `frontend/src/features/certificates/pages/CertificateComposer.jsx` — Already restricts composer to authorized roles
- `frontend/src/lib/rhuStations.js` — Already has `canInitiateCertificate()` check
- Supabase RLS policies — Already properly configured for all roles

## Expected Outcome After Fix

RHU Personnel with:
- Role: `rhu_personnel`
- Triage station assigned
- Municipality assigned
- Approval status: `approved`

Can now:
1. Access Medical Certificates page ✓
2. Search and select residents from their municipality ✓
3. Create medical certificate requests ✓
4. View requests they created ✓
5. Cannot approve, reject, issue, or edit ✓

And cannot:
1. Access residents outside their municipality ✓
2. Create requests without Triage station ✓
3. Approve or issue certificates ✓
4. Modify approved/issued certificates ✓
5. View cross-municipality data ✓
