import { Route, Routes, Navigate } from 'react-router-dom';

import DashboardLayout from '@/layouts/DashboardLayout';
import NotFoundPage from '@/pages/NotFoundPage';
import UnauthorizedPage from '@/pages/UnauthorizedPage';
import ProtectedRoute from '@/routes/ProtectedRoute';
import { ROUTE_ROLES } from '@/lib/roles';

// Landing + public entry points
import Landing from '@/features/landing/pages/Landing';
import Login from '@/features/authentication/pages/Login';

// Registration
import RegistrationTypeSelection from '@/features/registration/pages/RegistrationTypeSelection';
import NewResidentRegistration from '@/features/registration/pages/NewResidentRegistration';
import TransferRegistration from '@/features/registration/pages/TransferRegistration';
import RegistrationSuccess from '@/features/registration/pages/RegistrationSuccess';

// Verification
import VerificationStatus from '@/features/verification/pages/VerificationStatus';
import PendingVerifications from '@/features/verification/pages/PendingVerifications';
import ResidentVerification from '@/features/verification/pages/ResidentVerification';

// Role dashboards
import ResidentDashboard from '@/features/dashboards/pages/ResidentDashboard';
import LimitedResidentDashboard from '@/features/dashboards/pages/LimitedResidentDashboard';
import BHWDashboard from '@/features/dashboards/pages/BHWDashboard';
import MidwifeDashboard from '@/features/dashboards/pages/MidwifeDashboard';
import RHUDashboard from '@/features/dashboards/pages/RHUDashboard';
import MHODashboard from '@/features/dashboards/pages/MHODashboard';
import AdminDashboard from '@/features/dashboards/pages/AdminDashboard';

// Domain features
import ResidentsPage from '@/features/residents/pages/ResidentsPage';
import Households from '@/features/households/pages/Households';
import ConsultationsPage from '@/features/consultations/pages/ConsultationsPage';
import TreatmentConsultation from '@/features/consultations/pages/TreatmentConsultation';
import HealthRecord from '@/features/health-records/pages/HealthRecord';
import TCLS from '@/features/health-records/pages/TCLS';
import M1Records from '@/features/health-records/pages/M1Records';
import Immunization from '@/features/health-records/pages/Immunization';
import ResidentFollowUps from '@/features/follow-ups/pages/ResidentFollowUps';
import MidwifeFollowUp from '@/features/follow-ups/pages/MidwifeFollowUp';
import Referrals from '@/features/referrals/pages/Referrals';
import MHOReferrals from '@/features/referrals/pages/MHOReferrals';
import Appointments from '@/features/appointments/pages/Appointments';
import ResidentHealthServices from '@/features/health-services/pages/ResidentHealthServices';
import MidwifeHealthServices from '@/features/health-services/pages/MidwifeHealthServices';
import Programs from '@/features/health-services/pages/Programs';
import NotificationsPage from '@/features/notifications/pages/NotificationsPage';
import ReportsPage from '@/features/reports/pages/ReportsPage';
import Analytics from '@/features/analytics/pages/Analytics';
import HealthTrends from '@/features/analytics/pages/HealthTrends';
import Barangays from '@/features/analytics/pages/Barangays';
import UserManagement from '@/features/users/pages/UserManagement';
import AuditTrail from '@/features/users/pages/AuditTrail';
import SystemManagementPage from '@/features/users/pages/SystemManagementPage';
import RolePermissionsPage from '@/features/access-control/pages/RolePermissionsPage';
import SettingsPage from '@/features/settings/pages/SettingsPage';

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
        <Route path="referrals" element={<Referrals />} />
        <Route path="followups" element={<ResidentFollowUps />} />
        <Route path="appointments" element={<Appointments />} />
        <Route path="services" element={<ResidentHealthServices />} />
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
        <Route path="services" element={<ResidentHealthServices />} />
        <Route path="profile" element={<SettingsPage roleKey="resident-limited" />} />
        <Route path="verification" element={<LimitedResidentDashboard />} />
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
        <Route path="referrals" element={<MHOReferrals />} />
        <Route path="notifications" element={<NotificationsPage roleKey="mho" />} />
        <Route path="settings" element={<SettingsPage roleKey="mho" />} />
      </Route>
    </Route>

    {/* Public Health Nurse — health records, assessments, referrals, follow-ups */}
    <Route element={<ProtectedRoute allow={ROUTE_ROLES.phn} />}>
      <Route path="/app/phn" element={<DashboardLayout roleKey="phn" />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<MidwifeDashboard />} />
        <Route path="record" element={<HealthRecord />} />
        <Route path="consultations" element={<ConsultationsPage />} />
        <Route path="referrals" element={<Referrals />} />
        <Route path="followups" element={<ResidentFollowUps />} />
        <Route path="reports" element={<ReportsPage />} />
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
        <Route path="dashboard" element={<MidwifeDashboard />} />
        <Route path="residents" element={<ResidentsPage />} />
        <Route path="verifications" element={<PendingVerifications />} />
        <Route path="verification/review" element={<ResidentVerification />} />
        <Route path="consultations" element={<TreatmentConsultation />} />
        <Route path="tcls" element={<TCLS />} />
        <Route path="m1" element={<M1Records />} />
        <Route path="followups" element={<MidwifeFollowUp />} />
        <Route path="services" element={<MidwifeHealthServices />} />
        <Route path="immunization" element={<Immunization />} />
        <Route path="referrals" element={<Referrals />} />
        <Route path="households" element={<Households />} />
        <Route path="trends" element={<HealthTrends />} />
        <Route path="barangays" element={<Barangays />} />
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
        <Route path="residents" element={<ResidentsPage />} />
        <Route path="barangays" element={<Barangays />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="programs" element={<Programs />} />
        <Route path="notifications" element={<NotificationsPage roleKey="rhu_personnel" />} />
        <Route path="settings" element={<SettingsPage roleKey="rhu_personnel" />} />
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
