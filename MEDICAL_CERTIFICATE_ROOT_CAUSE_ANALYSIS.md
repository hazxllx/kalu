# Medical Certificate Request Authorization Issue - Root Cause Analysis

**Issue**: RHU Personnel cannot create medical certificate requests. Error: "Your role is not permitted to perform this action" when searching for residents.

**Date Identified**: 2026-11-12
**Priority**: CRITICAL
**Status**: FIXED

---

## Root Cause

The resident directory API (`GET /api/residents`) required the `residents` feature role, which only included Health Supervisor, PHN, and MHO. RHU Personnel was excluded from this list despite needing resident search access to initiate certificate requests.

### Why This Happened

1. **Initial Design Assumption**: The resident directory was originally designed for clinical record access (PHN/MHO/Health Supervisor only).

2. **Medical Certificates Added Later**: When the medical certificate feature was added, it allowed RHU Personnel to initiate requests (via the `certificateRequest` role).

3. **Scope Gap**: The new feature didn't update the resident search authorization to include RHU Personnel, creating a gap between:
   - Authorization to create certificates (via `certificateRequest` role) ✓
   - Authorization to find patients (via `residents` role) ✗

4. **Authorization Layers Out of Sync**: 
   - Backend certificate routes authorized RHU Personnel
   - Certificate service authorized RHU Personnel
   - Supabase RLS authorized RHU Personnel
   - Resident search authorization did NOT include RHU Personnel

### Authorization Flow Analysis

**BEFORE FIX** (Failed):
```
RHU Personnel
  ↓
Certificate Composer Page (✓ authorized via route guard)
  ↓
Search Residents API Call
  ↓
GET /api/residents (✗ BLOCKED)
  ├─ Route: residents.routes.js line 47
  │ └─ authorize(FEATURE_ROLES.residents) 
  │    └─ [HEALTH_SUPERVISOR, PHN, MHO] ← RHU Personnel NOT included
  └─ Error 403: "Your role is not permitted to perform this action"
```

**AFTER FIX** (Success):
```
RHU Personnel (with Triage station + municipality)
  ↓
Certificate Composer Page (✓ authorized via route guard)
  ↓
Search Residents API Call
  ↓
GET /api/residents (✓ ALLOWED)
  ├─ Route: residents.routes.js line 47
  │ └─ authorize(FEATURE_ROLES.residents) 
  │    └─ [HEALTH_SUPERVISOR, PHN, MHO, RHU_PERSONNEL] ← RHU Personnel included
  │
  ├─ Service: residents.service.js listResidents()
  │ ├─ Role check (✓ includes rhu_personnel)
  │ ├─ Municipality scope check (✓ enforced)
  │ └─ Returns scoped residents
  │
  ├─ Supabase RLS (✓ already allowed)
  │ └─ residents_select policy includes rhu_personnel
  │
  └─ Response: Filtered residents for RHU Personnel's municipality
  
  ↓
Select Resident & Auto-populate Info (✓)
  ↓
Complete Certificate Request Form (✓)
  ↓
POST /api/medical-certificates (✓)
  ├─ Route: medicalCertificates.routes.js line 39-43
  │ ├─ authorize(FEATURE_ROLES.certificateRequest) ✓
  │ └─ authorizeStation(RHU_STATIONS.TRIAGE) ✓
  │
  ├─ Service: medicalCertificates.service.js create()
  │ ├─ assertPersonnelApproved() ✓
  │ ├─ residentInScope() ✓
  │ ├─ isTriageRequest = true
  │ ├─ Forces status to 'For Review' ✓
  │ ├─ No medical officer stamped ✓
  │ └─ Record created
  │
  ├─ Supabase RLS (✓ already allowed)
  │ └─ medical_certificates_insert policy allows
  │
  ├─ Database trigger (✓ already implemented)
  │ └─ enforce_triage_certificate_request() validates
  │
  └─ Response: Certificate created with reference number
  
  ↓
Success: Request appears in Medical Certificates register
```

---

## Technical Details

### 1. Authorization Layers in KALUSAGAP

The system uses **three independent authorization layers** (defense in depth):

#### Layer 1: Express Route Middleware
```javascript
// backend/src/routes/residents.routes.js:47
router.get(
  '/',
  authorize(FEATURE_ROLES.residents, { permission: 'residents.directory.view' }),
  asyncHandler(residentsController.listResidents),
);
```

The `authorize()` middleware checks if the user's role is in the allowed list.

**BEFORE**: `FEATURE_ROLES.residents = [HEALTH_SUPERVISOR, PHN, MHO]`
**AFTER**: `FEATURE_ROLES.residents = [HEALTH_SUPERVISOR, PHN, MHO, RHU_PERSONNEL]`

#### Layer 2: Service Layer (Node.js)
```javascript
// backend/src/services/residents.service.js:701
const role = String(user?.role || '').toLowerCase();
if (!['health_supervisor', 'phn', 'mho'].includes(role)) {
  throw ApiError.forbidden('You are not permitted to view the resident directory.');
}
```

The service re-checks the role independently, even if middleware was bypassed.

**BEFORE**: List did NOT include 'rhu_personnel'
**AFTER**: List includes 'rhu_personnel'

Additional check added (line 716):
```javascript
if (role === 'rhu_personnel' && !municipalityId) {
  throw ApiError.forbidden('A valid municipality assignment is required...');
}
```

#### Layer 3: Supabase RLS (Database)
```sql
-- supabase/migrations/20260915100100_accounts_documents_and_clinical_scope.sql:335
create policy residents_select on public.residents
  for select to authenticated
  using (
    ...
    or (
      public.is_staff_active()
      and (
        (
          public.profile_role() in ('mho', 'phn', 'rhu_personnel')
          and municipality_id = public.profile_municipality_id()
        )
        ...
      )
    )
  );
```

The database policy already included `rhu_personnel` and enforced municipality scope.

**Status**: Already correct, no changes needed.

### 2. Certificate Request Authorization

Medical certificates had SEPARATE authorization streams that were correctly configured:

#### Feature Role
```javascript
// backend/src/config/roles.js:116
certificateRequest: [ROLES.PHN, ROLES.MHO, ROLES.RHU_PERSONNEL], // ← RHU Personnel included
```

#### Route Middleware
```javascript
// backend/src/routes/medicalCertificates.routes.js:39-43
const request = [
  authenticate,
  authorize(FEATURE_ROLES.certificateRequest),  // ✓ Allows RHU Personnel
  authorizeStation(RHU_STATIONS.TRIAGE),        // ✓ Enforces station
];

router.post('/', ...request, validate(...), asyncHandler(controller.create));
```

#### Service Layer
```javascript
// backend/src/services/medicalCertificates.service.js:461-464
const isTriageRequest = REQUEST_ROLES.has(user?.role);  // REQUEST_ROLES includes RHU Personnel
if (!PREPARE_ROLES.has(user?.role) && !isTriageRequest) {
  throw ApiError.forbidden('You are not authorized to prepare medical certificates.');
}
```

#### Request-Only Enforcement
```javascript
// backend/src/services/medicalCertificates.service.js:469-486
if (isTriageRequest) {
  // Triage INITIATES a request only. Status forced to 'For Review'
  row.status = CERT_STATUS.FOR_REVIEW;  // ← Never Draft, never Issued
  // NO signatory stamped
} else {
  // PHN/MHO path: full prepare workflow
}
```

#### Database Trigger
```sql
-- supabase/migrations/20261008000100_medical_certificate_triage_request.sql:30-67
CREATE FUNCTION public.enforce_triage_certificate_request()
RETURNS TRIGGER AS $$
BEGIN
  IF (SELECT role FROM profiles WHERE id = auth.uid()) = 'rhu_personnel' THEN
    NEW.status := 'For Review';  -- ← Forced by database
    NEW.reviewed_by := NULL;     -- ← No signatory
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### 3. The Gap

| Layer | Residents Search | Certificate Create |
|-------|------------------|-------------------|
| Route Middleware | ✗ RHU blocked | ✓ RHU allowed |
| Service Layer | ✗ RHU blocked | ✓ RHU allowed |
| Supabase RLS | ✓ RHU allowed | ✓ RHU allowed |
| **Result** | 🔴 **FAILED** | 🟢 (unreachable) |

The route middleware and service layer for residents were out of sync with the database layer. When RHU Personnel tried to search residents (step 1 of certificate creation), they hit the authorization wall before reaching the database layer.

---

## Why It Wasn't Caught Earlier

1. **Feature Integration Timing**: Residents feature and medical certificates feature were integrated separately, with different authorization assumptions.

2. **Frontend Masking**: The frontend `CertificateComposer.jsx` component (line 116) loads residents in a `useEffect` without explicit user interaction, so the error appeared as a silent "resident directory unavailable" rather than an obvious access denied.

3. **Test Coverage Gap**: The test suite has 15 failures, suggesting the medical certificate request workflow wasn't thoroughly tested with actual RHU Personnel accounts.

4. **Permission Model Complexity**: With three independent authorization layers and multiple feature groups, it's easy for one layer to fall out of sync.

---

## Fix Validation

### Changed Files

1. **backend/src/config/roles.js** (Line 73)
   - Added `ROLES.RHU_PERSONNEL` to `FEATURE_ROLES.residents`
   - Impact: Route middleware now allows RHU Personnel to access resident search

2. **backend/src/services/residents.service.js** (Lines 701, 716)
   - Added `'rhu_personnel'` to role whitelist
   - Added municipality scope enforcement for RHU Personnel
   - Impact: Service layer now accepts and properly scopes RHU Personnel requests

### Unchanged (Already Correct)

- Medical certificates routes ✓
- Medical certificates service ✓
- Supabase RLS policies ✓
- Database triggers ✓
- Frontend authorization checks ✓

### Security Guarantees Maintained

- ✓ RHU Personnel cannot approve/issue (enforced by role + station gate)
- ✓ RHU Personnel cannot access cross-municipality residents (municipality scope enforced)
- ✓ Unapproved staff blocked at service layer
- ✓ Request status forced to 'For Review' by service and database trigger
- ✓ No signatory stamped for requests
- ✓ All changes logged to audit trail

---

## Testing Strategy

See `MEDICAL_CERTIFICATE_RHU_TEST_PLAN.md` for comprehensive test scenarios covering:
- Resident search functionality
- Certificate request submission
- Request status verification
- PHN/MHO review workflow
- Permission enforcement (what RHU Personnel cannot do)
- Cross-scope prevention
- Unapproved account blocking

---

## Deployment Considerations

1. **Database**: No schema changes required. RLS policies already correct.
2. **Backend**: Role configuration and service method changes. Rebuild required.
3. **Frontend**: No changes needed (already authorized RHU Personnel).
4. **Migration**: No Supabase migration needed. Changes are in code only.

---

## Lessons Learned

1. **Sync Authorization Layers**: When updating feature roles, ensure all three layers (route middleware, service layer, database RLS) are updated together.

2. **Test Real Scenarios**: The tests should have caught this by testing the full workflow with RHU Personnel accounts, including resident search.

3. **Documentation**: Feature permissions should be documented in one place to prevent drift.

4. **Code Review**: Authorization changes should always be reviewed against all three layers.
