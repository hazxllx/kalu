import React, { Suspense, lazy } from 'react';
import { Route, Routes, Navigate, useLocation } from 'react-router-dom';
import DashboardLayout from '@/layouts/DashboardLayout';
import NavTabsLayout from '@/layouts/NavTabsLayout';
import NotFoundPage from '@/pages/NotFoundPage';
import UnauthorizedPage from '@/pages/UnauthorizedPage';
import ProtectedRoute from '@/routes/ProtectedRoute';
import { FullPageSkeleton, PageSkeleton } from '@/components/common/Skeleton';
import { ROUTE_ROLES } from '@/lib/roles';

/**
 * Redirect the legacy M1 report path to the canonical M1 Records page.
 * Preserves query parameters (e.g., reporting period) so existing bookmarks
 * maintain their context when the reporting UI was restructured.
 */
const M1ReportRedirect = () => {
  const location = useLocation();
  return <Navigate to={{ pathname: '/app/health_supervisor/m1', search: location.search }} replace />;
};

/**
 * Error boundary for route rendering.
 *
 * Catches errors during page component render (not during data loading—
 * each page handles its own data loading state). Provides a retry button
 * so the user can recover without a full page reload. Errors are logged
 * for debugging.
 */
class RouteErrorBoundary extends React.Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('Route failed to render.', error, info);
  }

  handleRetry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <section className="mx-auto w-full max-w-xl rounded-card border border-brand-border bg-white p-8 text-center shadow-card" role="alert">
        <h1 className="text-lg font-semibold text-brand-ink">This page could not be displayed</h1>
        <p className="mt-2 text-sm text-brand-gray">
          The page encountered an unexpected error. Try loading it again.
        </p>
        <button
          type="button"
          onClick={this.handleRetry}
          className="mt-5 rounded-btn bg-brand-blue px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark"
        >
          Try again
        </button>
      </section>
    );
  }
}

// Landing + login are the public entry points and load eagerly so the first
// paint never waits on a chunk fetch.
import Landing from '@/features/landing/pages/Landing';

import Login from '@/features/authentication/pages/Login';

/**
 * Code-split page loaders.
 *
 * Every application page (except Landing and Login) is loaded on demand via
 * dynamic import. While a chunk is being fetched, a skeleton loading state
 * is shown — PageSkeleton inside the dashboard layout (preserving the sidebar/
 * header context) or FullPageSkeleton for public/registration pages.
 *
 * This keeps the initial bundle small and improves Time to Interactive.
 * Individual pages still handle their own API data loading with page-specific
 * skeletons.
 *
 * Props passed to route elements are forwarded to pages. Some pages (Settings,
 * Notifications, Reports, etc.) accept a `roleKey` or `variant` prop to render
 * role-specific UI. Dropping these props would silently render the default
 * configuration for all roles—a common source of bugs.
 */
const appPage = (loader) => {
  const Page = lazy(loader);

  return function LazyAppPage(props) {
    return (
      <Suspense fallback={<PageSkeleton />}>
        <RouteErrorBoundary>
          <Page {...props} />
        </RouteErrorBoundary>
      </Suspense>
    );
  };
};

const publicPage = (loader) => {
  const Page = lazy(loader);

  return function LazyPublicPage(props) {
    return (
      <Suspense fallback={<FullPageSkeleton />}>
        <RouteErrorBoundary>
          <Page {...props} />
        </RouteErrorBoundary>
      </Suspense>
    );
  };
};

// Registration
const PersonnelRegistration = publicPage(() => import('@/features/registration/pages/PersonnelRegistration'));
const RegistrationTypeSelection = publicPage(
  () =>
    import(
      '@/features/registration/pages/RegistrationTypeSelection'
    )
);

const NewResidentRegistration = publicPage(
  () =>
    import(
      '@/features/registration/pages/NewResidentRegistration'
    )
);

const TransferRegistration = publicPage(
  () =>
    import(
      '@/features/registration/pages/TransferRegistration'
    )
);

const RegistrationSuccess = publicPage(
  () =>
    import(
      '@/features/registration/pages/RegistrationSuccess'
    )
);

const StaffResidentRegistration = appPage(
  () =>
    import(
      '@/features/registration/pages/StaffResidentRegistration'
    )
);

const VerificationStatus = publicPage(
  () =>
    import(
      '@/features/verification/pages/VerificationStatus'
    )
);

// Password recovery (Supabase Auth)
const ForgotPassword = publicPage(
  () =>
    import(
      '@/features/authentication/pages/ForgotPassword'
    )
);

const ResetPassword = publicPage(
  () =>
    import(
      '@/features/authentication/pages/ResetPassword'
    )
);

// Verification
const VerificationsApprovals = appPage(
  () =>
    import(
      '@/features/verification/pages/VerificationsApprovals'
    )
);

const ResidentVerificationStatus = appPage(
  () =>
    import(
      '@/features/verification/pages/ResidentVerificationStatus'
    )
);

const TransferRequests = appPage(
  () =>
    import(
      '@/features/verification/pages/TransferRequests'
    )
);

// Role dashboards
const ResidentDashboard = appPage(
  () =>
    import(
      '@/features/dashboards/pages/ResidentDashboard'
    )
);

const LimitedResidentDashboard = appPage(
  () =>
    import(
      '@/features/dashboards/pages/LimitedResidentDashboard'
    )
);

const BHWDashboard = appPage(
  () =>
    import(
      '@/features/dashboards/pages/BHWDashboard'
    )
);

const HealthSupervisorDashboard = appPage(
  () =>
    import(
      '@/features/dashboards/pages/HealthSupervisorDashboard'
    )
);

const RHUDashboard = appPage(
  () =>
    import(
      '@/features/dashboards/pages/RHUDashboard'
    )
);

const MHODashboard = appPage(
  () =>
    import(
      '@/features/dashboards/pages/MHODashboard'
    )
);

const AdminDashboard = appPage(
  () =>
    import(
      '@/features/dashboards/pages/AdminDashboard'
    )
);

const PHNDashboard = appPage(
  () =>
    import(
      '@/features/dashboards/pages/PHNDashboard'
    )
);

const RhuTriage = appPage(
  () =>
    import(
      '@/features/triage/pages/RhuTriage'
    )
);

const IncomingReferrals = appPage(
  () => import('@/features/triage/pages/IncomingReferrals')
);

const RhuConsultation = appPage(
  () =>
    import(
      '@/features/consultations/pages/RhuConsultation'
    )
);

const PhnCheckups = appPage(
  () =>
    import(
      '@/features/consultations/pages/PhnAssessments'
    )
);

const PhnHealthRecords = appPage(
  () =>
    import(
      '@/features/health-records/pages/PhnHealthRecords'
    )
);

const PhnHealthServices = appPage(
  () =>
    import(
      '@/features/health-services/pages/PhnHealthServices'
    )
);

// Domain features
const ResidentsPage = appPage(
  () =>
    import(
      '@/features/residents/pages/ResidentsPage'
    )
);

const Households = appPage(
  () =>
    import(
      '@/features/households/pages/Households'
    )
);

const AddHouseholdPage = appPage(
  () =>
    import(
      '@/features/households/pages/AddHouseholdPage'
    )
);

const EditHouseholdPage = appPage(
  () =>
    import(
      '@/features/households/pages/EditHouseholdPage'
    )
);

// BUG/product decision: the user-facing "Household Risk Clusters" feature has
// been removed. Its old routes now redirect to Household Profiling.
const HouseholdRiskOverview = appPage(
  () =>
    import(
      '@/features/households/pages/HouseholdRiskOverview'
    )
);

const HouseholdRiskDetail = appPage(
  () =>
    import(
      '@/features/households/pages/HouseholdRiskDetail'
    )
);

const TreatmentConsultation = appPage(
  () =>
    import(
      '@/features/consultations/pages/TreatmentConsultation'
    )
);

const HealthRecord = appPage(
  () =>
    import(
      '@/features/health-records/pages/HealthRecord'
    )
);

const TCLS = appPage(
  () =>
    import(
      '@/features/health-records/pages/TCLS'
    )
);

const TclWorkspace = appPage(
  () =>
    import(
      '@/features/health-records/pages/TclWorkspace'
    )
);

const PhnTclSubmissions = appPage(
  () =>
    import(
      '@/features/health-records/pages/PhnTclSubmissions'
    )
);

const M1Records = appPage(
  () =>
    import(
      '@/features/health-records/pages/M1Records'
    )
);

const M1Fhsis = appPage(
  () =>
    import(
      '@/features/health-records/pages/M1Fhsis'
    )
);

const M1SectionDetail = appPage(
  () =>
    import(
      '@/features/health-records/pages/M1SectionDetail'
    )
);

const M1PrenatalDetail = appPage(
  () =>
    import(
      '@/features/health-records/pages/M1PrenatalDetail'
    )
);

const M1NcdDetail = appPage(
  () =>
    import(
      '@/features/health-records/pages/M1NcdDetail'
    )
);

const M1CervicalDetail = appPage(
  () =>
    import(
      '@/features/health-records/pages/M1CervicalDetail'
    )
);

const M1VisualDetail = appPage(
  () =>
    import(
      '@/features/health-records/pages/M1VisualDetail'
    )
);

const M1OralDetail = appPage(
  () =>
    import(
      '@/features/health-records/pages/M1OralDetail'
    )
);

const M1EnvironmentalDetail = appPage(
  () =>
    import(
      '@/features/health-records/pages/M1EnvironmentalDetail'
    )
);

const M1EnrollmentDetail = appPage(
  () =>
    import(
      '@/features/health-records/pages/M1EnrollmentDetail'
    )
);

const Immunization = appPage(
  () =>
    import(
      '@/features/health-records/pages/Immunization'
    )
);

const TBRecords = appPage(
  () =>
    import(
      '@/features/health-records/pages/TBRecords'
    )
);

const NcdRecords = appPage(
  () =>
    import(
      '@/features/health-records/pages/NcdRecords'
    )
);

const OralHealthRecords = appPage(
  () =>
    import(
      '@/features/health-records/pages/OralHealthRecords'
    )
);

const EnvironmentalMasterlist = appPage(
  () =>
    import(
      '@/features/health-records/pages/EnvironmentalMasterlist'
    )
);

const ResidentFollowUps = appPage(
  () =>
    import(
      '@/features/follow-ups/pages/ResidentFollowUps'
    )
);

const MidwifeFollowUp = appPage(
  () =>
    import(
      '@/features/follow-ups/pages/MidwifeFollowUp'
    )
);

const FollowUpCalendar = appPage(
  () =>
    import(
      '@/features/follow-ups/pages/FollowUpCalendar'
    )
);

const HealthReferrals = appPage(
  () =>
    import(
      '@/features/referrals/pages/HealthReferrals'
    )
);

const ResidentHealthServices = appPage(
  () =>
    import(
      '@/features/health-services/pages/ResidentHealthServices'
    )
);

const MidwifeHealthServices = appPage(
  () =>
    import(
      '@/features/health-services/pages/MidwifeHealthServices'
    )
);

const NotificationsPage = appPage(
  () =>
    import(
      '@/features/notifications/pages/NotificationsPage'
    )
);

const ReportsPage = appPage(
  () =>
    import(
      '@/features/reports/pages/ReportsPage'
    )
);

const MunicipalHealthReports = appPage(
  () =>
    import(
      '@/features/reports/pages/MunicipalHealthReports'
    )
);

const MunicipalSubmissions = appPage(
  () =>
    import(
      '@/features/submissions/pages/MunicipalSubmissions'
    )
);

const HealthTrends = appPage(
  () =>
    import(
      '@/features/analytics/pages/HealthTrends'
    )
);

const UserManagement = appPage(
  () =>
    import(
      '@/features/users/pages/UserManagement'
    )
);

const BarangayManagement = appPage(
  () =>
    import(
      '@/features/barangays/pages/BarangayManagement'
    )
);

const AuditTrail = appPage(
  () =>
    import(
      '@/features/users/pages/AuditTrail'
    )
);

const SystemManagementPage = appPage(
  () =>
    import(
      '@/features/users/pages/SystemManagementPage'
    )
);

const RolePermissionsPage = appPage(
  () =>
    import(
      '@/features/access-control/pages/RolePermissionsPage'
    )
);

const RoleAccessManagementPage = appPage(
  () =>
    import(
      '@/features/access-control/pages/RoleAccessManagementPage'
    )
);

const RiskInterventionSettings = appPage(
  () =>
    import(
      '@/features/access-control/pages/RiskInterventionSettings'
    )
);

const SettingsPage = appPage(
  () =>
    import(
      '@/features/settings/pages/SettingsPage'
    )
);

const MedicineCatalog = appPage(
  () =>
    import(
      '@/features/medicines/pages/MedicineCatalog'
    )
);

const MedicalCertificates = appPage(
  () =>
    import(
      '@/features/certificates/pages/MedicalCertificates'
    )
);

const CertificateComposer = appPage(
  () =>
    import(
      '@/features/certificates/pages/CertificateComposer'
    )
);

const StaffAccountApprovals = appPage(
  () =>
    import(
      '@/features/accounts/pages/StaffAccountApprovals'
    )
);

/**
 * Central route table for KALUSAGAP.
 *
 * Structure:
 *   - Public routes (landing, login, password recovery, registration) are at
 *     the top level and accessible without authentication.
 *   - Authenticated routes are nested under /app/<role> and wrapped in
 *     <ProtectedRoute allow={ROUTE_ROLES[role]}> to enforce RBAC at the
 *     routing level. Access is denied before the page renders, preventing
 *     unauthorized users from accessing role-specific features even if they
 *     navigate directly to the URL. The backend (authenticate + authorize
 *     middleware, RLS policies) is the authoritative enforcement layer;
 *     this frontend guard is a UX layer that prevents wrong-role navigation.
 *
 * The authenticated user's role comes from the auth profile (resolved from
 * the backend `profiles` table in AuthContext). Users never pick a role.
 *
 * Role areas (KALUSAGAP role brief):
 *   admin             — accounts / roles / access control / system settings
 *   mho               — municipal monitoring, health trends, referral tracking
 *   phn               — public health nurse: health records, assessments,
 *                       referrals, follow-ups, account approval authority
 *   health_supervisor — barangay nurse/midwife: household profiling, resident
 *                       verification, consultations, TCL/M1 records,
 *                       follow-ups, referrals, account approval authority
 *   rhu_personnel     — RHU (Rural Health Unit) triage, consultation, incoming
 *                       referral triage (station-assigned)
 *   bhw               — Barangay Health Worker: DATA COLLECTION ONLY
 *                       (household profiling and community data)
 *   resident          — own profile, health records, services, referrals,
 *                       follow-ups, notifications
 *   resident-limited  — resident pending verification: limited features
 *                       until identity is verified by Health Supervisor
 */
const AppRoutes = () => (
  <Routes>
    {/* Public routes — no authentication required */}
    <Route path="/" element={<Landing />} />
    <Route path="/login" element={<Login />} />
    <Route
      path="/forgot-password"
      element={<ForgotPassword />}
    />
    <Route
      path="/reset-password"
      element={<ResetPassword />}
    />
    <Route
      path="/setup-password"
      element={<ResetPassword />}
    />
    <Route
      path="/register"
      element={<RegistrationTypeSelection />}
    />
    <Route
      path="/register/new/step-1"
      element={<NewResidentRegistration />}
    />
    <Route
      path="/register/transfer"
      element={<TransferRegistration />}
    />
    <Route
      path="/register/personnel"
      element={<PersonnelRegistration />}
    />
    <Route
      path="/registration-success"
      element={<RegistrationSuccess />}
    />
    <Route
      path="/verification-status"
      element={<VerificationStatus />}
    />
    <Route
      path="/unauthorized"
      element={<UnauthorizedPage />}
    />

    {/* Resident */}
    <Route
      element={
        <ProtectedRoute allow={ROUTE_ROLES.resident} />
      }
    >
      <Route
        path="/app/resident"
        element={<DashboardLayout roleKey="resident" />}
      >
        <Route
          index
          element={<Navigate to="dashboard" replace />}
        />
        <Route
          path="dashboard"
          element={<ResidentDashboard />}
        />
        <Route
          path="profile"
          element={<SettingsPage roleKey="resident" />}
        />
        <Route path="record" element={<HealthRecord />} />
        {/* Consultation History is consolidated into "My Health Records" (a tab
            on that page); keep the old path as a redirect for bookmarks/links. */}
        <Route
          path="consultations"
          element={<Navigate to="../record" replace />}
        />
        <Route
          path="referrals"
          element={<HealthReferrals />}
        />
        <Route
          path="followups"
          element={<ResidentFollowUps />}
        />
        {/* Consolidated into "Follow-ups & Schedule"; keep the old path as a redirect. */}
        <Route
          path="followup-calendar"
          element={<Navigate to="../followups" replace />}
        />
        <Route
          path="health-services"
          element={<ResidentHealthServices />}
        />
        <Route
          path="verification"
          element={<ResidentVerificationStatus />}
        />
        <Route
          path="notifications"
          element={
            <NotificationsPage roleKey="resident" />
          }
        />
        <Route
          path="settings"
          element={<SettingsPage roleKey="resident" />}
        />
      </Route>
    </Route>

    {/* Resident (Limited / Pending Verification) */}
    <Route
      element={
        <ProtectedRoute
          allow={ROUTE_ROLES['resident-limited']}
        />
      }
    >
      <Route
        path="/app/resident-limited"
        element={
          <DashboardLayout roleKey="resident-limited" />
        }
      >
        <Route
          index
          element={<Navigate to="dashboard" replace />}
        />
        <Route
          path="dashboard"
          element={<LimitedResidentDashboard />}
        />
        <Route
          path="announcements"
          element={
            <NotificationsPage roleKey="resident-limited" />
          }
        />
        <Route
          path="follow-ups"
          element={<ResidentFollowUps />}
        />
        <Route
          path="followups"
          element={<ResidentFollowUps />}
        />
        {/* Consolidated into "Follow-ups & Schedule"; keep the old path as a redirect. */}
        <Route
          path="followup-calendar"
          element={
            <Navigate to="../follow-ups" replace />
          }
        />
        <Route
          path="services"
          element={<ResidentHealthServices />}
        />
        <Route
          path="profile"
          element={
            <SettingsPage roleKey="resident-limited" />
          }
        />
        <Route
          path="verification"
          element={<ResidentVerificationStatus />}
        />
        <Route
          path="support"
          element={
            <SettingsPage roleKey="resident-limited" />
          }
        />
        <Route
          path="settings"
          element={
            <SettingsPage roleKey="resident-limited" />
          }
        />
      </Route>
    </Route>

    {/* Municipal Health Officer */}
    <Route
      element={
        <ProtectedRoute allow={ROUTE_ROLES.mho} />
      }
    >
      <Route
        path="/app/mho"
        element={<DashboardLayout roleKey="mho" />}
      >
        <Route
          index
          element={<Navigate to="dashboard" replace />}
        />
        <Route
          path="dashboard"
          element={<MHODashboard />}
        />
        <Route
          path="profile"
          element={<SettingsPage roleKey="mho" />}
        />
        {/*
          Municipal resident directory — read-only; the MHO supervises the
          register but resident demographics are edited by the PHN /
          Health Supervisor.
        */}
        <Route
          path="residents"
          element={<ResidentsPage />}
        />
        <Route
          path="trends"
          element={<HealthTrends />}
        />
        {/*
          The MHO is a municipality-wide supervisor and is NOT authorized for
          the barangay/BHW household-profiling data. The retained Household
          Risk Overview / Detail are backed by those household endpoints,
          so for the MHO the old paths redirect to           the MHO dashboard (which now includes the municipality heatmap)
          instead of rendering a guaranteed-403 page.
          Household Risk Clusters remains removed.
        */}
        <Route
          path="households/risk-overview"
          element={
            <Navigate
              to="/app/mho/barangays"
              replace
            />
          }
        />
        <Route
          path="households/:id"
          element={
            <Navigate
              to="/app/mho/barangays"
              replace
            />
          }
        />
        <Route
          path="submissions"
          element={<MunicipalSubmissions />}
        />
        <Route
          path="transfer-requests"
          element={<TransferRequests />}
        />
        {/* Read-only municipal monitoring view of the same referral register. */}
        <Route
          path="referrals"
          element={<HealthReferrals />}
        />
        <Route
          path="barangays"
          element={<Navigate to="/app/mho/dashboard" replace />}
        />
        <Route
          path="certificates/new"
          element={<CertificateComposer />}
        />
        <Route
          path="certificates"
          element={<MedicalCertificates />}
        />
        <Route
          path="reports"
          element={<MunicipalHealthReports />}
        />
        <Route
          path="notifications"
          element={
            <NotificationsPage roleKey="mho" />
          }
        />
        <Route
          path="settings"
          element={<SettingsPage roleKey="mho" />}
        />
      </Route>
    </Route>

    {/* Public Health Nurse — health records, assessments, referrals, follow-ups */}
    <Route
      element={
        <ProtectedRoute allow={ROUTE_ROLES.phn} />
      }
    >
      <Route
        path="/app/phn"
        element={<DashboardLayout roleKey="phn" />}
      >
        <Route
          index
          element={<Navigate to="dashboard" replace />}
        />
        <Route
          path="dashboard"
          element={<PHNDashboard />}
        />
        <Route
          path="profile"
          element={<SettingsPage roleKey="phn" />}
        />
        <Route
          path="transfer-requests"
          element={<TransferRequests />}
        />
        {/*
          PHN resident registration (Add Resident). The API already authorizes
          the PHN for POST/GET /residents; this exposes that existing
          capability in the UI (requirement: BHS/PHN Add Resident).
        */}
        <Route
          path="residents"
          element={<ResidentsPage />}
        />
        <Route
          path="record"
          element={<PhnHealthRecords />}
        />
        <Route path="tcls" element={<PhnTclSubmissions />} />
        <Route path="tcl-register" element={<TCLS />} />
        <Route path="ncd" element={<NcdRecords />} />
        <Route path="oral-health" element={<OralHealthRecords />} />
        <Route path="environmental" element={<EnvironmentalMasterlist />} />
        <Route
          path="households/risk-overview"
          element={<HouseholdRiskOverview />}
        />
        <Route
          path="households/:id"
          element={<HouseholdRiskDetail />}
        />
        <Route
          path="consultations"
          element={<PhnCheckups />}
        />
        <Route
          path="referrals"
          element={<HealthReferrals />}
        />
        <Route
          path="followups"
          element={<MidwifeFollowUp />}
        />
        <Route
          path="services"
          element={<PhnHealthServices />}
        />
        <Route
          path="barangays"
          element={<Navigate to="/app/phn/dashboard" replace />}
        />
        <Route
          path="certificates/new"
          element={<CertificateComposer />}
        />
        <Route
          path="certificates"
          element={<MedicalCertificates />}
        />
        {/* Account approval authority: the PHN approves Health Supervisor and RHU Personnel accounts. */}
        <Route
          path="account-approvals"
          element={<StaffAccountApprovals />}
        />
        <Route
          path="reports"
          element={<ReportsPage roleKey="phn" />}
        />
        <Route
          path="notifications"
          element={
            <NotificationsPage roleKey="phn" />
          }
        />
        <Route
          path="settings"
          element={<SettingsPage roleKey="phn" />}
        />
      </Route>
    </Route>

    {/* Health Supervisor — barangay-level nurse/midwife */}
    <Route
      element={
        <ProtectedRoute
          allow={ROUTE_ROLES.health_supervisor}
        />
      }
    >
      <Route
        path="/app/health_supervisor"
        element={
          <DashboardLayout roleKey="health_supervisor" />
        }
      >
        <Route
          index
          element={<Navigate to="dashboard" replace />}
        />
        <Route
          path="dashboard"
          element={<HealthSupervisorDashboard />}
        />
        <Route
          path="profile"
          element={
            <SettingsPage roleKey="health_supervisor" />
          }
        />
        <Route
          path="residents"
          element={<ResidentsPage />}
        />
        <Route
          path="residents/register"
          element={<StaffResidentRegistration />}
        />
        <Route
          path="verifications"
          element={<VerificationsApprovals />}
        />
        <Route
          path="transfer-requests"
          element={<TransferRequests />}
        />
        <Route
          path="household-verifications"
          element={
            <Navigate
              to="/app/health_supervisor/verifications?tab=household"
              replace
            />
          }
        />
        <Route
          path="consultations"
          element={<TreatmentConsultation />}
        />
        {/*
          Additional capability for a Health Supervisor assigned the RHU
          Consultation station: the shared RHU consultation queue. The barangay
          "Consultation" (TreatmentConsultation) above is unchanged. The
          DashboardLayout station guard + the backend restrict this to an HS with
          the Consultation station.
        */}
        <Route
          path="rhu-consultation"
          element={<RhuConsultation />}
        />
        <Route path="tcls" element={<TclWorkspace />} />
        <Route path="tcl-register" element={<TCLS />} />
        <Route path="m1" element={<M1Records />} />
        <Route path="m1-fhsis" element={<M1Fhsis />} />
        <Route path="m1-section/:section" element={<M1SectionDetail />} />
        <Route path="maternal-tcl" element={<M1Records />} />

        {/* Program-specific M1 detail pages */}
        <Route path="m1/prenatal-detail" element={<M1PrenatalDetail />} />
        <Route path="m1/ncd-detail" element={<M1NcdDetail />} />
        <Route path="m1/cervical-detail" element={<M1CervicalDetail />} />
        <Route path="m1/visual-detail" element={<M1VisualDetail />} />
        <Route path="m1/oral-detail" element={<M1OralDetail />} />
        <Route path="m1/environmental-detail" element={<M1EnvironmentalDetail />} />
        <Route path="m1/enrollment-detail" element={<M1EnrollmentDetail />} />

        {/*
          "Maternal Monitoring" (the standalone FHSIS M1 report page) was merged
          into the canonical M1 Health Programs page. Preserve reporting-period
          query parameters so existing monthly, quarterly, and annual bookmarks
          keep their selected reporting context.
        */}
        <Route
          path="m1-report"
          element={<M1ReportRedirect />}
        />

        <Route
          path="followups"
          element={<MidwifeFollowUp />}
        />
        <Route
          path="followup-calendar"
          element={<FollowUpCalendar />}
        />
        <Route
          path="services"
          element={<MidwifeHealthServices />}
        />
        <Route
          path="immunization"
          element={<Immunization />}
        />
        <Route path="tb" element={<TBRecords />} />
        <Route path="ncd" element={<NcdRecords />} />
        <Route path="oral-health" element={<OralHealthRecords />} />
        <Route path="environmental" element={<EnvironmentalMasterlist />} />

        {/* Account approval authority: the Health Supervisor approves BHW and Resident accounts. */}
        <Route
          path="account-approvals"
          element={
            <Navigate
              to="/app/health_supervisor/verifications?tab=accounts"
              replace
            />
          }
        />

        <Route
          path="referrals"
          element={<HealthReferrals />}
        />
        <Route
          path="households"
          element={<Households />}
        />
        <Route
          path="households/new"
          element={<AddHouseholdPage />}
        />
        <Route
          path="households/:householdId/edit"
          element={<EditHouseholdPage />}
        />
        <Route
          path="households/risk-clusters"
          element={
            <Navigate
              to="/app/health_supervisor/households"
              replace
            />
          }
        />
        <Route
          path="households/risk-overview"
          element={<HouseholdRiskOverview />}
        />
        <Route
          path="households/:id"
          element={<HouseholdRiskDetail />}
        />
<Route
          path="trends"
          element={<HealthTrends />}
        />
        <Route
          path="barangays"
          element={<Navigate to="/app/health_supervisor/trends" replace />}
        />
        <Route
          path="reports"
          element={<ReportsPage />}
        />
        <Route
          path="notifications"
          element={
            <NotificationsPage roleKey="health_supervisor" />
          }
        />
        <Route
          path="settings"
          element={
            <SettingsPage roleKey="health_supervisor" />
          }
        />
      </Route>
    </Route>

    {/* RHU Personnel — triage and consultation */}
    <Route
      element={
        <ProtectedRoute
          allow={ROUTE_ROLES.rhu_personnel}
        />
      }
    >
      <Route
        path="/app/rhu_personnel"
        element={
          <DashboardLayout roleKey="rhu_personnel" />
        }
      >
        <Route
          index
          element={<Navigate to="dashboard" replace />}
        />
        <Route
          path="dashboard"
          element={<RHUDashboard />}
        />
        <Route
          path="profile"
          element={
            <SettingsPage roleKey="rhu_personnel" />
          }
        />
        <Route
          path="triage"
          element={<RhuTriage />}
        />
        <Route
          path="incoming-referrals"
          element={<IncomingReferrals />}
        />

        {/* RHU Personnel accounts are station-assigned; each account sees its own workspace. */}
        <Route
          path="consultation"
          element={<RhuConsultation />}
        />

        {/* The referral inbox is recipient-scoped; only starting triage remains station-gated. */}
        <Route
          path="certificates/new"
          element={<CertificateComposer />}
        />
        <Route
          path="certificates"
          element={<MedicalCertificates />}
        />
        <Route
          path="notifications"
          element={
            <NotificationsPage roleKey="rhu_personnel" />
          }
        />
        <Route
          path="settings"
          element={
            <SettingsPage roleKey="rhu_personnel" />
          }
        />

        {/* Unknown RHU sub-paths return to the role dashboard. */}
        <Route
          path="*"
          element={<Navigate to="dashboard" replace />}
        />
      </Route>
    </Route>

    {/* BHW — community/household DATA COLLECTION ONLY */}
    <Route
      element={
        <ProtectedRoute allow={ROUTE_ROLES.bhw} />
      }
    >
      <Route
        path="/app/bhw"
        element={<DashboardLayout roleKey="bhw" />}
      >
        <Route
          index
          element={<Navigate to="dashboard" replace />}
        />
        <Route
          path="dashboard"
          element={<BHWDashboard />}
        />
        <Route
          path="profile"
          element={<SettingsPage roleKey="bhw" />}
        />
        <Route
          path="households"
          element={<Households />}
        />
        <Route
          path="households/new"
          element={<AddHouseholdPage />}
        />
        <Route
          path="households/:householdId/edit"
          element={<EditHouseholdPage />}
        />
        <Route
          path="households/risk-clusters"
          element={
            <Navigate
              to="/app/bhw/households"
              replace
            />
          }
        />
        <Route
          path="households/:id"
          element={<HouseholdRiskDetail />}
        />
        <Route
          path="notifications"
          element={
            <NotificationsPage roleKey="bhw" />
          }
        />
        <Route
          path="settings"
          element={<SettingsPage roleKey="bhw" />}
        />
      </Route>
    </Route>

    {/* Admin */}
    <Route
      element={
        <ProtectedRoute allow={ROUTE_ROLES.admin} />
      }
    >
      <Route
        path="/app/admin"
        element={<DashboardLayout roleKey="admin" />}
      >
        <Route
          index
          element={<Navigate to="dashboard" replace />}
        />
        <Route
          path="dashboard"
          element={<AdminDashboard />}
        />
        <Route
          path="profile"
          element={<SettingsPage roleKey="admin" />}
        />
        {/*
          Merged sidebar items. Each tab keeps its original route and page;
          NavTabsLayout only adds the tab strip (see NAV.admin `tabs`).
        */}
        {/* User & Personnel Management */}
        <Route
          element={<NavTabsLayout roleKey="admin" navId="user-personnel" />}
        >
          <Route
            path="users"
            element={<UserManagement key="users" />}
          />
          <Route
            path="personnel"
            element={<UserManagement personnelOnly key="personnel" />}
          />
        </Route>
        {/* Barangay & Access Management */}
        <Route
          element={<NavTabsLayout roleKey="admin" navId="barangay-access" />}
        >
          <Route
            path="barangays"
            element={<BarangayManagement />}
          />
          <Route
            path="role-access"
            element={<RoleAccessManagementPage />}
          />
        </Route>
        {/* Backward-compatible redirects for the former split pages. */}
        <Route
          path="roles"
          element={<Navigate to="/app/admin/role-access" replace />}
        />
        <Route
          path="permissions"
          element={<Navigate to="/app/admin/role-access" replace />}
        />
        {/* Health & System Settings */}
        <Route
          element={<NavTabsLayout roleKey="admin" navId="health-system" />}
        >
          {/* Unified resident risk + early intervention configuration. */}
          <Route
            path="risk-settings"
            element={<RiskInterventionSettings />}
          />
          {/* Medicine catalog + blood-pressure classification configuration. */}
          <Route
            path="medicines"
            element={<MedicineCatalog />}
          />
          <Route
            path="settings"
            element={<SettingsPage roleKey="admin" />}
          />
        </Route>
        {/* Backward-compatible redirects for the former split pages. */}
        <Route
          path="risk-rules"
          element={<Navigate to="/app/admin/risk-settings" replace />}
        />
        <Route
          path="risk-assessment"
          element={<Navigate to="/app/admin/risk-settings" replace />}
        />
        <Route
          path="audit"
          element={<AuditTrail />}
        />
        <Route
          path="logs"
          element={
            <SystemManagementPage variant="logs" />
          }
        />
        <Route
          path="notifications"
          element={
            <NotificationsPage roleKey="admin" />
          }
        />
      </Route>
    </Route>

    {/* Catch-all */}
    <Route
      path="*"
      element={<NotFoundPage />}
    />
  </Routes>
);

export default AppRoutes;
