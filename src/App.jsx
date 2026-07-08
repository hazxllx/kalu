import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import ScrollToTop from './components/ScrollToTop';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';

import Landing from './pages/Landing';
import Login from './pages/Login';
import RegistrationTypeSelection from './pages/RegistrationTypeSelection';
import NewResidentRegistration from './pages/NewResidentRegistration';
import TransferRegistration from './pages/TransferRegistration';
import RegistrationSuccess from './pages/RegistrationSuccess';
import VerificationStatus from './pages/VerificationStatus';
import DashboardLayout from './components/app/DashboardLayout';

import ResidentDashboard from './pages/resident/ResidentDashboard';
import HealthRecord from './pages/resident/HealthRecord';
import Appointments from './pages/resident/Appointments';
import HealthServices from './pages/resident/HealthServices';
import FollowUps from './pages/resident/FollowUps';

import BHWDashboard from './pages/bhw/BHWDashboard';
import Households from './pages/bhw/Households';
import PendingVerifications from './pages/bhw/PendingVerifications';
import ResidentVerification from './pages/bhw/ResidentVerification';

import MidwifeDashboard from './pages/midwife/MidwifeDashboard';
import TreatmentConsultation from './pages/midwife/TreatmentConsultation';
import MidwifeFollowUp from './pages/midwife/MidwifeFollowUp';
import TCLS from './pages/midwife/TCLS';
import M1Records from './pages/midwife/M1Records';
import MidwifeHealthServices from './pages/midwife/HealthServicesPage';
import Immunization from './pages/midwife/Immunization';
import Referrals from './pages/midwife/Referrals';

import RHUDashboard from './pages/rhu/RHUDashboard';
import Analytics from './pages/rhu/Analytics';
import Barangays from './pages/rhu/Barangays';
import Programs from './pages/rhu/Programs';

import AdminDashboard from './pages/admin/AdminDashboard';
import UserManagement from './pages/admin/UserManagement';
import AuditTrail from './pages/admin/AuditTrail';
import AdminSimple from './pages/admin/AdminSimple';

import LimitedResidentDashboard from './pages/resident/LimitedResidentDashboard';
import MHODashboard from './pages/mho/MHODashboard';
import HealthTrends from './pages/mho/HealthTrends';
import MHOReferrals from './pages/mho/MHOReferrals';

import ResidentsPage from './pages/shared/ResidentsPage';
import FollowUpPage from './pages/shared/FollowUpPage';
import ConsultationsPage from './pages/shared/ConsultationsPage';
import NotificationsPage from './pages/shared/NotificationsPage';
import SettingsPage from './pages/shared/SettingsPage';
import ReportsPage from './pages/shared/ReportsPage';

const AppRoutes = () => {
  // Auth context is initialized for the platform; this app uses public mock data for the frontend flow.
  useAuth();
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<RegistrationTypeSelection />} />
      <Route path="/register/new/step-1" element={<NewResidentRegistration />} />
      <Route path="/register/transfer" element={<TransferRegistration />} />
      <Route path="/registration-success" element={<RegistrationSuccess />} />
      <Route path="/verification-status" element={<VerificationStatus />} />

      {/* Resident */}
      <Route path="/app/resident" element={<DashboardLayout roleKey="resident" />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<ResidentDashboard />} />
        <Route path="record" element={<HealthRecord />} />
        <Route path="consultations" element={<ConsultationsPage showResidentSearch={false} />} />
        <Route path="referrals" element={<Referrals />} />
        <Route path="followups" element={<FollowUps />} />
        <Route path="appointments" element={<Appointments />} />
        <Route path="services" element={<HealthServices />} />
        <Route path="notifications" element={<NotificationsPage roleKey="resident" />} />
        <Route path="settings" element={<SettingsPage roleKey="resident" />} />
      </Route>

      {/* Resident (Limited / Pending Verification) */}
      <Route path="/app/resident-limited" element={<DashboardLayout roleKey="resident-limited" />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<LimitedResidentDashboard />} />
        <Route path="announcements" element={<NotificationsPage roleKey="resident-limited" />} />
        <Route path="services" element={<HealthServices />} />
        <Route path="profile" element={<SettingsPage roleKey="resident-limited" />} />
        <Route path="verification" element={<LimitedResidentDashboard />} />
        <Route path="support" element={<SettingsPage roleKey="resident-limited" />} />
        <Route path="settings" element={<SettingsPage roleKey="resident-limited" />} />
      </Route>

      {/* Municipal Health Officer */}
      <Route path="/app/mho" element={<DashboardLayout roleKey="mho" />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<MHODashboard />} />
        <Route path="trends" element={<HealthTrends />} />
        <Route path="referrals" element={<MHOReferrals />} />
        <Route path="notifications" element={<NotificationsPage roleKey="mho" />} />
        <Route path="settings" element={<SettingsPage roleKey="mho" />} />
      </Route>

      {/* BHW */}
      <Route path="/app/bhw" element={<DashboardLayout roleKey="bhw" />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<BHWDashboard />} />
        <Route path="residents" element={<ResidentsPage />} />
        <Route path="households" element={<Households />} />
        <Route path="verifications" element={<PendingVerifications />} />
        <Route path="verification/review" element={<ResidentVerification />} />
        <Route path="followup" element={<FollowUpPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="notifications" element={<NotificationsPage roleKey="bhw" />} />
        <Route path="settings" element={<SettingsPage roleKey="bhw" />} />
      </Route>

      {/* Midwife */}
      <Route path="/app/midwife" element={<DashboardLayout roleKey="midwife" />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<MidwifeDashboard />} />
        <Route path="consultations" element={<TreatmentConsultation />} />
        <Route path="residents" element={<ResidentsPage />} />
        <Route path="tcls" element={<TCLS />} />
        <Route path="m1" element={<M1Records />} />
        <Route path="followups" element={<MidwifeFollowUp />} />
        <Route path="services" element={<MidwifeHealthServices />} />
        <Route path="immunization" element={<Immunization />} />
        <Route path="referrals" element={<Referrals />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="notifications" element={<NotificationsPage roleKey="midwife" />} />
        <Route path="settings" element={<SettingsPage roleKey="midwife" />} />
      </Route>

      {/* RHU */}
      <Route path="/app/rhu" element={<DashboardLayout roleKey="rhu" />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<RHUDashboard />} />
        <Route path="residents" element={<ResidentsPage />} />
        <Route path="barangays" element={<Barangays />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="programs" element={<Programs />} />
        <Route path="notifications" element={<NotificationsPage roleKey="rhu" />} />
        <Route path="settings" element={<SettingsPage roleKey="rhu" />} />
      </Route>

      {/* Admin */}
      <Route path="/app/admin" element={<DashboardLayout roleKey="admin" />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<AdminDashboard />} />
        <Route path="users" element={<UserManagement />} />
        <Route path="roles" element={<AdminSimple variant="roles" />} />
        <Route path="permissions" element={<AdminSimple variant="permissions" />} />
        <Route path="audit" element={<AuditTrail />} />
        <Route path="settings" element={<SettingsPage roleKey="admin" />} />
        <Route path="logs" element={<AdminSimple variant="logs" />} />
        <Route path="notifications" element={<NotificationsPage roleKey="admin" />} />
      </Route>

      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <AppRoutes />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App