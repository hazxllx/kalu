# KALUSAGAP

## Community Health Risk Monitoring and Early Intervention System

KALUSAGAP is a web-based health information system for the Municipal Health Office of Pili, Camarines Sur. It helps residents and municipal health personnel manage resident registration, household and community health monitoring, clinical workflows, risk assessment, referrals, follow-ups, and municipality-level analytics for early intervention and data-driven decisions.

The system serves residents, barangay health workers (BHW), Rural Health Unit (RHU) personnel, public health nurses (PHN), health supervisors, the Municipal Health Officer (MHO), and system administrators. It brings community health data and clinical workflows into one role-scoped, secure application with strict access controls on personal and clinical data.

---

## Purpose

- **Resident Registration and Verification:** Onboarding with document submission, automated screening, and staff review
- **Household Profiling:** Family grouping, member health tracking, and risk assessment
- **Clinical Workflows:** Triage, consultations, vital signs, health services, and appointments
- **Referral Management:** Coordinated referrals between BHWs, RHU personnel, and hospitals
- **Follow-up Tracking:** Scheduled and case-based follow-ups with outcome recording
- **Health Risk Monitoring:** Risk assessment using validated clinical indicators
- **Health Records:** FHSIS M1 monthly reporting, maternal/postpartum health, NCD tracking, oral health, and TB case listing
- **Early Warning and Analytics:** Municipality and barangay dashboards with geographic mapping
- **Offline-First Capability:** Local draft storage and conflict resolution for areas with weak connectivity
- **Audit and Compliance:** Audit trail of business events and system request logging

---

## Community Health Context

- **FHSIS M1 Compliance:** Aligns with Field Health Services Information System monthly indicators
- **DOH Workflows:** Follows Department of Health standards for maternal health, communicable disease, and health services
- **BHW Integration:** Supports community data collection by barangay health workers
- **RHU Coordination:** Facilitates intake, triage, and referral processing
- **Geographic Scope:** Operates at the barangay level with municipal aggregation for planning

---

## User Roles

| Role | Primary Responsibilities |
|------|--------------------------|
| **Resident** | Register, verify identity, view own health records, book appointments |
| **Barangay Health Worker (BHW)** | Collect household and health data, conduct intake, enter permitted M1 indicators |
| **RHU Personnel** | Process intake, triage, consultations, medicine dispensing, referrals, certificate approval, report submission |
| **Public Health Nurse (PHN)** | Clinical case management, verification, referral processing, follow-up oversight, M1 review |
| **Health Supervisor** | Barangay-level resident and household management, verification, clinical oversight, analytics |
| **Municipal Health Officer (MHO)** | Municipality-wide access, referral oversight, M1 and report approval, community analytics |
| **Admin** | Account management, role assignment, system configuration, access control |

---

## Key Features

1. **Authentication and Access Control:** Email/password sign-in via Supabase Auth, password recovery, JWT sessions, and server-side role resolution
2. **Resident Registration and Verification:** Demographics, guardian linking for minors, document upload, automated screening, staff review, and barangay transfers
3. **Household Profiling:** Household creation, member management, health status tracking, and risk scoring
4. **Clinical Consultations and Triage:** Vital signs, blood pressure classification, assessments, medicine dispensing, and status tracking
5. **Health Records:** M1 FHSIS reporting (150+ indicators), maternal health, NCD records, oral health, TB case listing, and environmental health assessments
6. **Referral Management:** Referral creation, recipient acceptance, outcome tracking, and lab result integration
7. **Follow-Up Workflows:** Scheduling, BHW task assignment, status tracking, and decision recording
8. **Medical Certificates:** Request, RHU triage, approval or denial, and certificate directory
9. **Health Services and Appointments:** Program scheduling, staff assignment, resident booking, and attendance tracking
10. **Municipal Reports:** Role-based templates, multi-level review (RHU → MHO → regional), version control, and deduplication
11. **Analytics and Early Warning:** Risk clustering, geospatial mapping, trend analysis, and barangay comparison (aggregated, no individual data exposed)
12. **Resident Risk Assessment:** Risk scoring by clinical indicators, stratification (low to critical), and risk-based follow-up recommendations
13. **Offline Sync:** IndexedDB drafts, automatic sync on reconnection, and conflict resolution
14. **Notifications:** Event-triggered, role-scoped alerts with deduplication
15. **User Management:** Staff registration, approval workflows, role changes, and RHU station assignments
16. **Role-Based Access Control:** Seven roles with feature-level, permission-level, and geographic scope enforcement
17. **Document Management:** Private storage, automated screening (file type, readability, OCR), and manual review
18. **Barangay Management:** Approved barangay list, GeoJSON boundaries, and barangay-level data filtering
19. **Audit Trail and System Logs:** Business event logging and request logging with no PII

---

## Technology Stack

**Frontend:** React 18, Vite 5, Tailwind CSS 3, Radix UI, shadcn/ui, React Router 7, TanStack React Query 5, React Hook Form, Zod, Recharts, React Leaflet 4, Framer Motion, Lucide React, Dexie.js 4 (IndexedDB), Workbox (PWA), Supabase JS Client 2.48+, date-fns

**Backend:** Node.js 22+, Express 4.22, Supabase JS Client 2.48+, Multer 1.4, Nodemailer 6, Tesseract.js 4 (OCR), Helmet 7, CORS, Express Rate Limit

**Database and Auth:** Supabase (PostgreSQL 15+, Auth, Storage), Row Level Security

**PDF and Reporting:** jsPDF, html2canvas, papaparse

**Development and Deployment:** npm, ESLint, TypeScript (checkJs), Supabase CLI, Nodemon, Vercel (frontend), Render (backend)

---

## System Architecture

**Frontend:** React SPA with lazy-loaded feature modules, TanStack Query for server state, context providers for auth and permissions, and an offline layer built on IndexedDB and a service worker.

**Backend:** Express API with a middleware pipeline covering security headers, CORS, rate limiting, idempotency, authentication, role authorization, and scope enforcement. Routes map to controllers, which call services. Repositories handle data access through Supabase.

**Database:** PostgreSQL on Supabase with Row Level Security policies on every data table, enforcing role and geographic scope as a second layer of control beside backend authorization.

**Request Flow:**

1. The user signs in through Supabase Auth and receives a JWT.
2. The backend verifies the token and loads the user's profile.
3. The backend checks the role against the endpoint's allowlist and any granular permissions.
4. Barangay or facility scope is applied to queries, and RLS enforces it again at the database.

---

## Access Control Summary

- **Server-side enforcement** is authoritative for all data access.
- **Database RLS** provides a second, independent control.
- **Frontend route guards** are for convenience only and are not a security boundary.

---

## Setup

### Prerequisites

- Node.js 22 or newer
- npm
- Git
- A Supabase account
- Supabase CLI (`npm install -g supabase`)

### Installation

```bash
git clone <repository-url>
cd KALUSAGAP
npm run install:all
```

### Environment Configuration

**Frontend (`frontend/.env`):**
```env
VITE_API_URL=http://localhost:5000/api
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<public-anon-key>
VITE_ANALYTICS_ENABLED=false
```

**Backend (`backend/.env`):**
```env
PORT=5000
NODE_ENV=development
CLIENT_URL=http://localhost:5173
TRUST_PROXY=loopback
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<public-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
SMTP_HOST=<smtp-host>
SMTP_PORT=587
SMTP_USER=<email>
SMTP_PASSWORD=<app-password>
SMTP_FROM=noreply@kalusagap.local
USE_LOCAL_FILE_STORE=false
LOCAL_FILE_STORE_PATH=./data
```

**Security Notes:**
- Never commit `.env` files.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` to the frontend or as a `VITE_` variable. It bypasses RLS and must stay server-side.
- Use separate credentials for staging and production.

### Database Setup

```bash
supabase link --project-ref <project-ref>
supabase migration list --linked
supabase db push
```

- Migrations are applied in timestamp order. Do not remove or reorder migration history.
- Do not run `supabase db reset` or `supabase db seed` against production.

---

## Running the Application

**Frontend** (http://localhost:5173):
```bash
npm run dev:frontend
```

**Backend** (http://localhost:5000):
```bash
npm run dev:backend
```

**Production backend:**
```bash
npm run start:backend
```

**Health check:** `GET http://localhost:5000/api/health`

---

## Deployment

| Service | Platform | Notes |
|---------|----------|-------|
| Frontend | Vercel | Static SPA build from `frontend/dist`, with SPA rewrites to `index.html` |
| Backend | Render | Node.js 22.x service, start with `npm run start --prefix backend` |
| Database | Supabase | Apply migrations with `supabase db push` |

**Post-deployment checks:**
1. Frontend loads and the sign-in page displays.
2. Backend health check returns 200 at `/api/health`.
3. Migrations are applied and RLS policies are active.
4. Sign in, load the resident directory, and submit a test consultation.

---

## API Overview

All endpoints except `/api/health` and authentication endpoints require `Authorization: Bearer <jwt>`.

| Area | Base Endpoint | Purpose |
|------|---------------|---------|
| Auth | `/api/auth` | Sign-up, sign-in, password reset, current user |
| Residents | `/api/residents` | Resident records, verification, risk scores |
| Households | `/api/households` | Household records and members |
| Consultations | `/api/consultations` | Clinical visits and submissions |
| M1 Reports | `/api/m1/reports` | FHSIS monthly reports |
| Reports | `/api/reports` | Municipal reports and review |
| Health Records | `/api/health-records` | Maternal, NCD, oral health, and TB records |
| Referrals | `/api/referrals` | Referral creation and outcomes |
| Follow-ups | `/api/follow-ups` | Follow-up scheduling and outcomes |
| Certificates | `/api/medical-certificates` | Certificate requests and decisions |
| Health Services | `/api/health-services` | Program scheduling and slots |
| Appointments | `/api/appointments` | Resident bookings |
| Analytics | `/api/analytics` | Municipality and barangay analytics |
| Users | `/api/users` | User management (admin) |
| Roles | `/api/roles`, `/api/access-control` | Permissions and access checks |

**Standard response format:**
```json
{
  "success": true,
  "data": {},
  "error": null
}
```

---

## Project Structure

```
KALUSAGAP/
├── frontend/     React SPA (features, components, services, offline engine)
├── backend/      Express API (routes, controllers, services, middleware, config)
├── supabase/     SQL migrations, seed files, and Supabase configuration
├── shared/       Shared utilities (e.g., barangay list)
├── docs/         Backend, database, and integration documentation
└── README.md
```

---

## Scope and Limitations

- **Offline support** covers selected workflows only (consultations, household data, and the submission outbox). Authentication and server-authoritative reads still require a network connection.
- **Document screening** is automated checking only. It is not AI-based identity authentication, and final verification is always done by authorized personnel.
- **Analytics** are aggregated at the municipality and barangay levels. No individual resident data is exposed.

---

## Documentation

- Backend overview: `docs/backend/README.md`
- Database schema: `docs/database/README.md`
- Resident verification workflow: `docs/integration/manual-resident-verification.md`

---

## License

Refer to the LICENSE file in the repository.