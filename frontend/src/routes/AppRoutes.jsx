import { Suspense, lazy } from 'react';
import { Route, Routes, Navigate } from 'react-router-dom';

import DashboardLayout from '@/layouts/DashboardLayout';
import NotFoundPage from '@/pages/NotFoundPage';
import UnauthorizedPage from '@/pages/UnauthorizedPage';
import ProtectedRoute from '@/routes/ProtectedRoute';
import { FullPageSkeleton, PageSkeleton } from '@/components/common/Skeleton';
import { ROUTE_ROLES } from '@/lib/roles';

// Landing + login are the public entry points and load eagerly so the first
// paint never waits on a chunk fetch.
import Landing from '@/features/landing/pages/Landing';
import Login from '@/features/authentication/pages/Login';

/**
 * Code-split the rest of the route table.
 *
 * Every page below is loaded on demand. While its chunk is being fetched the
 * route shows a skeleton — `PageSkeleton` inside the dashboard shell (so the
 * sidebar/header stay mounted) and `FullPageSkeleton` for the standalone
 * public/registration pages. This is the only loading state the router adds;
 * individual pages still show their own skeletons while their API data loads.
 *
 * Props given to the route element are forwarded to the page. Pages such as
 * SettingsPage, NotificationsPage, ReportsPage, Referrals and
 * SystemManagementPage are configured per role through props (roleKey /
 * variant), so dropping them would silently give every role the default
 * configuration — for example a staff Settings page rendering the resident
 * account view.
 */
const appPage = (loader) => {
  const Page = lazy(loader);
  return function LazyAppPage(props) {
    return (
      <Suspense fallback={<PageSkeleton />}>
        <Page {...props} />
      </Suspense>
    );
  };
};

const publicPage = (loader) => {
  const Page = lazy(loader);
  return function LazyPublicPage(props) {
    return (
      <Suspense fallback={<FullPageSkeleton />}>
        <Page {...props} />
      </Suspense>
    );
  };
};

// Registration
const RegistrationTypeSelection = publicPage(() => import('@/features/registration/pages/RegistrationTypeSelection'));
const NewResidentRegistration = publicPage(() => import('@/features/registration/pages/NewResidentRegistration'));
const TransferRegistration = publicPage(() => import('@/features/registration/pages/TransferRegistration'));
const PersonnelRegistration = publicPage(() => import('@/features/registration/pages/PersonnelRegistration'));
const RegistrationSuccess = publicPage(() => import('@/features/registration/pages/RegistrationSuccess'));
const VerificationStatus = publicPage(() => import('@/features/verification/pages/VerificationStatus'));

// Verification
const PendingVerifications = appPage(() => import('@/features/verification/pages/PendingVerifications'));
const ResidentVerificationStatus = appPage(() => import('@/features/verification/pages/ResidentVerificationStatus'));
const HouseholdVerifications = appPage(() => import('@/features/verification/pages/HouseholdVerifications'));
const TransferRequests = appPage(() => import('@/features/verification/pages/TransferRequests'));

// Role dashboards
const ResidentDashboard = appPage(() => import('@/features/dashboards/pages/ResidentDashboard'));
const LimitedResidentDashboard = appPage(() => import('@/features/dashboards/pages/LimitedResidentDashboard'));
const BHWDashboard = appPage(() => import('@/features/dashboards/pages/BHWDashboard'));
const HealthSupervisorDashboard = appPage(() => import('@/features/dashboards/pages/HealthSupervisorDashboard'));
const RHUDashboard = appPage(() => import('@/features/dashboards/pages/RHUDashboard'));
const MHODashboard = appPage(() => import('@/features/dashboards/pages/MHODashboard'));
const AdminDashboard = appPage(() => import('@/features/dashboards/pages/AdminDashboard'));
const PHNDashboard = appPage(() => import('@/features/dashboards/pages/PHNDashboard'));
const RhuTriage = appPage(() => import('@/features/triage/pages/RhuTriage'));
const PhnCheckups = appPage(() => import('@/features/consultations/pages/PhnAssessments'));
const PhnHealthRecords = appPage(() => import('@/features/health-records/pages/PhnHealthRecords'));
const PhnHealthServices = appPage(() => import('@/features/health-services/pages/PhnHealthServices'));

// Domain features
const ResidentsPage = appPage(() => import('@/features/residents/pages/ResidentsPage'));
const Households = appPage(() => import('@/features/households/pages/Households'));
const AddHouseholdPage = appPage(() => import('@/features/households/pages/AddHouseholdPage'));
const HouseholdRiskClusters = appPage(() => import('@/features/households/pages/HouseholdRiskClusters'));
const HouseholdRiskOverview = appPage(() => import('@/features/households/pages/HouseholdRiskOverview'));
const HouseholdRiskDetail = appPage(() => import('@/features/households/pages/HouseholdRiskDetail'));
const RiskRuleConfig = appPage(() => import('@/features/households/pages/RiskRuleConfig'));
const ConsultationsPage = appPage(() => import('@/features/consultations/pages/ConsultationsPage'));
const TreatmentConsultation = appPage(() => import('@/features/consultations/pages/TreatmentConsultation'));
const HealthRecord = appPage(() => import('@/features/health-records/pages/HealthRecord'));
const TCLS = appPage(() => import('@/features/health-records/pages/TCLS'));
const M1Records = appPage(() => import('@/features/health-records/pages/M1Records'));
const M1Fhsis = appPage(() => import('@/features/health-records/pages/M1Fhsis'));
const Immunization = appPage(() => import('@/features/health-records/pages/Immunization'));
const ResidentFollowUps = appPage(() => import('@/features/follow-ups/pages/ResidentFollowUps'));
const ResidentFollowUpCalendar = appPage(() => import('@/features/follow-ups/pages/ResidentFollowUpCalendar'));
const MidwifeFollowUp = appPage(() => import('@/features/follow-ups/pages/MidwifeFollowUp'));
const FollowUpCalendar = appPage(() => import('@/features/follow-ups/pages/FollowUpCalendar'));
const PhnFollowUps = appPage(() => import('@/features/follow-ups/pages/PhnFollowUps'));
const Referrals = appPage(() => import('@/features/referrals/pages/Referrals'));
const HealthReferrals = appPage(() => import('@/features/referrals/pages/HealthReferrals'));
const MHOReferrals = appPage(() => import('@/features/referrals/pages/MHOReferrals'));
const RhuReferrals = appPage(() => import('@/features/referrals/pages/RhuReferrals'));
const Appointments = appPage(() => import('@/features/appointments/pages/Appointments'));
const ResidentHealthServices = appPage(() => import('@/features/health-services/pages/ResidentHealthServices'));
const MidwifeHealthServices = appPage(() => import('@/features/health-services/pages/MidwifeHealthServices'));
const Programs = appPage(() => import('@/features/health-services/pages/Programs'));
const NotificationsPage = appPage(() => import('@/features/notifications/pages/NotificationsPage'));
const ReportsPage = appPage(() => import('@/features/reports/pages/ReportsPage'));
const MunicipalHealthReports = appPage(() => import('@/features/reports/pages/MunicipalHealthReports'));
const MunicipalSubmissions = appPage(() => import('@/features/submissions/pages/MunicipalSubmissions'));
const HealthTrends = appPage(() => import('@/features/analytics/pages/HealthTrends'));
const Barangays = appPage(() => import('@/features/analytics/pages/Barangays'));
const CommunityMonitoring = appPage(() => import('@/features/analytics/pages/CommunityMonitoring'));
const UserManagement = appPage(() => import('@/features/users/pages/UserManagement'));
const AuditTrail = appPage(() => import('@/features/users/pages/AuditTrail'));
const SystemManagementPage = appPage(() => import('@/features/users/pages/SystemManagementPage'));
const RolePermissionsPage = appPage(() => import('@/features/access-control/pages/RolePermissionsPage'));
const SettingsPage = appPage(() => import('@/features/settings/pages/SettingsPage'));
const MedicalCertificates = appPage(() => import('@/features/certificates/pages/MedicalCertificates'));
const CertificateComposer = appPage(() => import('@/features/certificates/pages/CertificateComposer'));
const StaffRequests = appPage(() => import('@/features/users/pages/StaffRequests'));
const SupervisorVerifications = appPage(() => import('@/features/users/pages/SupervisorVerifications'));

/**
 * Central route table for KALUSAGAP.
 *
 * Public routes sit at the top level. Every authenticated area is nested under
 * `/app/<role>` and wrapped in <ProtectedRoute allow={ROUTE_ROLES[role]}>, so
 * access is enforced by the router (not merely hidden in the UI). The role
 * comes from the authenticated account (see AuthContext); users never pick it.
 *
 * Role areas (KALUSAGAP role brief):
 *   admin            — accounts / roles / access / system
 *   mho              — municipal monitoring, reports, referral monitoring
 *   phn              — health records, assessments, referrals, follow-ups
 *   health_supervisor— barangay nurse/midwife: verification, directory, records,
 *                      consultation, referrals, follow-ups, barangay monitoring
 *   rhu_personnel    — triage (dedicated triage UI pending verified requirements)
 *   bhw              — DATA COLLECTION ONLY (household profiling / community data)
 *   resident         — own profile, records, services, notifications
 */
const AppRoutes = () => (
  <Routes>
    <Route path="/" element={<Landing />} />
    <Route path="/login" element={<Login />} />
    <Route path="/register" element={<RegistrationTypeSelection />} />
    <Route path="/register/new/step-1" element={<NewResidentRegistration />} />
    <Route path="/register/transfer" element={<TransferRegistration />} />
    <Route path="/register/personnel" element={<PersonnelRegistration />} />
    <Route path="/registration-success" element={<RegistrationSuccess />} />
            <Route path="/verification-status" element={<VerificationStatus />} />
            <Route path="/unauthorized" element={<UnauthorizedPage />} />

    {/* Resident */}
    <Route element={<ProtectedRoute allow={ROUTE_ROLES.resident} />}>
      <Route path="/app/resident" element={<DashboardLayout roleKey="resident" />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<ResidentDashboard />} />
        <Route path="record" element={<HealthRecord />} />
        <Route path="consultations" element={<ConsultationsPage showResidentSearch={false} />} />
        <Route path="referrals" element={<HealthReferrals />} />
        <Route path="followups" element={<ResidentFollowUps />} />
        <Route path="followup-calendar" element={<ResidentFollowUpCalendar />} />
        <Route path="appointments" element={<Appointments />} />
        <Route path="services" element={<ResidentHealthServices />} />
        <Route path="verification" element={<ResidentVerificationStatus />} />
        <Route path="notifications" element={<NotificationsPage roleKey="resident" />} />
        <Route path="settings" element={<SettingsPage roleKey="resident" />} />
      </Route>
    </Route>

    {/* Resident (Limited / Pending Verification) */}
    <Route element={<ProtectedRoute allow={ROUTE_ROLES['resident-limited']} />}>
      <Route path="/app/resident-limited" element={<DashboardLayout roleKey="resident-limited" />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<LimitedResidentDashboard />} />
        <Route path="announcements" element={<NotificationsPage roleKey="resident-limited" />} />
        <Route path="follow-ups" element={<ResidentFollowUps />} />
        <Route path="followups" element={<ResidentFollowUps />} />
        <Route path="followup-calendar" element={<ResidentFollowUpCalendar />} />
        <Route path="services" element={<ResidentHealthServices />} />
        <Route path="profile" element={<SettingsPage roleKey="resident-limited" />} />
        <Route path="verification" element={<ResidentVerificationStatus />} />
        <Route path="support" element={<SettingsPage roleKey="resident-limited" />} />
        <Route path="settings" element={<SettingsPage roleKey="resident-limited" />} />
      </Route>
    </Route>

    {/* Municipal Health Officer */}
    <Route element={<ProtectedRoute allow={ROUTE_ROLES.mho} />}>
      <Route path="/app/mho" element={<DashboardLayout roleKey="mho" />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<MHODashboard />} />
        <Route path="trends" element={<HealthTrends />} />
        <Route path="households/risk-overview" element={<HouseholdRiskOverview />} />
        <Route path="households/:id" element={<HouseholdRiskDetail />} />
        <Route path="submissions" element={<MunicipalSubmissions />} />
        <Route path="transfer-requests" element={<TransferRequests />} />
        <Route path="referrals" element={<MHOReferrals />} />
        <Route path="barangays" element={<CommunityMonitoring />} />
        <Route path="certificates/new" element={<CertificateComposer />} />
        <Route path="certificates" element={<MedicalCertificates />} />
        <Route path="reports" element={<MunicipalHealthReports />} />
        <Route path="notifications" element={<NotificationsPage roleKey="mho" />} />
        <Route path="settings" element={<SettingsPage roleKey="mho" />} />
      </Route>
    </Route>

    {/* Public Health Nurse — health records, assessments, referrals, follow-ups */}
    <Route element={<ProtectedRoute allow={ROUTE_ROLES.phn} />}>
      <Route path="/app/phn" element={<DashboardLayout roleKey="phn" />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<PHNDashboard />} />
        <Route path="transfer-requests" element={<TransferRequests />} />
        <Route path="record" element={<PhnHealthRecords />} />
        <Route path="households/risk-overview" element={<HouseholdRiskOverview />} />
        <Route path="households/:id" element={<HouseholdRiskDetail />} />
        <Route path="consultations" element={<PhnCheckups />} />
        <Route path="referrals" element={<Referrals roleKey="phn" />} />
        <Route path="followups" element={<PhnFollowUps />} />
        <Route path="services" element={<PhnHealthServices />} />
        <Route path="barangays" element={<CommunityMonitoring />} />
        <Route path="certificates/new" element={<CertificateComposer />} />
        <Route path="certificates" element={<MedicalCertificates />} />
        <Route path="reports" element={<ReportsPage roleKey="phn" />} />
        <Route path="notifications" element={<NotificationsPage roleKey="phn" />} />
        <Route path="settings" element={<SettingsPage roleKey="phn" />} />
      </Route>
    </Route>

    {/* Health Supervisor — barangay-level nurse/midwife (clinical + monitoring).
        This is the role that owns resident verification, the resident directory,
        consultation, referrals, follow-ups and barangay community monitoring. */}
    <Route element={<ProtectedRoute allow={ROUTE_ROLES.health_supervisor} />}>
      <Route path="/app/health_supervisor" element={<DashboardLayout roleKey="health_supervisor" />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<HealthSupervisorDashboard />} />
        <Route path="residents" element={<ResidentsPage />} />
        <Route path="verifications" element={<PendingVerifications />} />
        <Route path="transfer-requests" element={<TransferRequests />} />
        <Route path="household-verifications" element={<HouseholdVerifications />} />
        <Route path="consultations" element={<TreatmentConsultation />} />
        <Route path="tcls" element={<TCLS />} />
        <Route path="m1" element={<M1Records />} />
        <Route path="m1-report" element={<M1Fhsis />} />
        <Route path="followups" element={<MidwifeFollowUp />} />
        <Route path="followup-calendar" element={<FollowUpCalendar />} />
        <Route path="services" element={<MidwifeHealthServices />} />
        <Route path="immunization" element={<Immunization />} />
        <Route path="referrals" element={<HealthReferrals />} />
        <Route path="households" element={<Households />} />
        <Route path="households/new" element={<AddHouseholdPage />} />
        <Route path="households/risk-clusters" element={<HouseholdRiskClusters />} />
        <Route path="households/risk-overview" element={<HouseholdRiskOverview />} />
        <Route path="households/:id" element={<HouseholdRiskDetail />} />
        <Route path="trends" element={<HealthTrends />} />
        <Route path="barangays" element={<CommunityMonitoring />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="notifications" element={<NotificationsPage roleKey="health_supervisor" />} />
        <Route path="settings" element={<SettingsPage roleKey="health_supervisor" />} />
      </Route>
    </Route>

    {/* RHU Personnel — triage. A dedicated Triage Queue / Triage Assessment UI
        is pending the verified requirements; the monitoring pages below remain
        available in the interim. */}
    <Route element={<ProtectedRoute allow={ROUTE_ROLES.rhu_personnel} />}>
      <Route path="/app/rhu_personnel" element={<DashboardLayout roleKey="rhu_personnel" />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<RHUDashboard />} />
        <Route path="triage" element={<RhuTriage />} />
        <Route path="referrals" element={<RhuReferrals />} />
        <Route path="certificates/new" element={<CertificateComposer />} />
        <Route path="certificates" element={<MedicalCertificates />} />
        <Route path="programs" element={<Programs />} />
        <Route path="notifications" element={<NotificationsPage roleKey="rhu_personnel" />} />
        <Route path="settings" element={<SettingsPage roleKey="rhu_personnel" />} />
        {/* Barangays/Reports/Analytics are no longer part of the RHU Personnel
            role; any removed or unknown RHU sub-path falls back to the role
            dashboard so a user is never stranded on an inaccessible page. */}
        <Route path="*" element={<Navigate to="dashboard" replace />} />
      </Route>
    </Route>

    {/* BHW — community/household DATA COLLECTION ONLY. No resident directory,
        no personal clinical records, no consultation/referrals/follow-ups, and
        no resident verification (that belongs to the Health Supervisor). */}
    <Route element={<ProtectedRoute allow={ROUTE_ROLES.bhw} />}>
      <Route path="/app/bhw" element={<DashboardLayout roleKey="bhw" />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<BHWDashboard />} />
        <Route path="households" element={<Households />} />
        <Route path="households/new" element={<AddHouseholdPage />} />
        <Route path="households/risk-clusters" element={<HouseholdRiskClusters />} />
        <Route path="households/:id" element={<HouseholdRiskDetail />} />
        <Route path="notifications" element={<NotificationsPage roleKey="bhw" />} />
        <Route path="settings" element={<SettingsPage roleKey="bhw" />} />
      </Route>
    </Route>

    {/* Admin */}
    <Route element={<ProtectedRoute allow={ROUTE_ROLES.admin} />}>
      <Route path="/app/admin" element={<DashboardLayout roleKey="admin" />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<AdminDashboard />} />
        <Route path="users" element={<UserManagement />} />
        <Route path="staff-requests" element={<StaffRequests />} />
        <Route path="supervisor-verifications" element={<SupervisorVerifications />} />
        <Route path="risk-rules" element={<RiskRuleConfig />} />
        <Route path="roles" element={<SystemManagementPage variant="roles" />} />
        {/* Privilege & permission management (admin only). */}
        <Route path="permissions" element={<RolePermissionsPage />} />
        <Route path="audit" element={<AuditTrail />} />
        <Route path="settings" element={<SettingsPage roleKey="admin" />} />
        <Route path="logs" element={<SystemManagementPage variant="logs" />} />
        <Route path="notifications" element={<NotificationsPage roleKey="admin" />} />
      </Route>
    </Route>

    <Route path="*" element={<NotFoundPage />} />
  </Routes>
);

export default AppRoutes;
