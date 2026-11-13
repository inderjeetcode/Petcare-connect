import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { AppProvider } from './context/AppContext';
import { AppLayout } from './layouts/AppLayout';
import { NotificationsCenter } from './components/common/NotificationsCenter';
import {
  RequireAuth,
  RequirePlatformAdmin,
  RequireWorkspaceAccess,
  LegacyPortalRedirect,
} from './components/auth/RouteGuards';
import { ADMIN_ROUTE_PERMISSIONS } from './utils/workspaceAuth';

// Public & Auth / Onboarding Pages
import { LandingPage } from './pages/public/LandingPage';
import { AuthPage } from './pages/auth/AuthPage';
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage';
import { AcceptInvitePage } from './pages/auth/AcceptInvitePage';
import { UnauthorizedPage } from './pages/auth/UnauthorizedPage';
import { WorkspacesPage } from './pages/onboarding/WorkspacesPage';
import { PlatformOrganizationsPage } from './pages/platform/PlatformOrganizationsPage';
import { PlatformDashboardPage } from './pages/platform/PlatformDashboardPage';
import { PlatformUsersPage } from './pages/platform/PlatformUsersPage';
import { PlatformAnalyticsPage } from './pages/platform/PlatformAnalyticsPage';
import { PlatformSettingsPage } from './pages/platform/PlatformSettingsPage';
import { AdminOnboardingPage } from './pages/admin/AdminOnboardingPage';

// Client Portal Pages
import { ClientDashboard } from './pages/client/ClientDashboard';
import { MyPets } from './pages/client/MyPets';
import { PetDetails } from './pages/client/PetDetails';
import { FindDoctor } from './pages/client/FindDoctor';
import { MyConsultations } from './pages/client/MyConsultations';
import { ClientChat } from './pages/client/ClientChat';
import { ClientPrescriptions } from './pages/client/ClientPrescriptions';
import { ClientMedicalRecords } from './pages/client/ClientMedicalRecords';
import { ClientNotifications } from './pages/client/ClientNotifications';
import { ClientPayments } from './pages/client/ClientPayments';
import { ClientProfile } from './pages/client/ClientProfile';
import { ClientSettings } from './pages/client/ClientSettings';
import { ClientOrganizations } from './pages/client/ClientOrganizations';

// Doctor Portal Pages
import { DoctorDashboard } from './pages/doctor/DoctorDashboard';
import { DoctorRequests } from './pages/doctor/DoctorRequests';
import { DoctorConsultations } from './pages/doctor/DoctorConsultations';
import { DoctorChat } from './pages/doctor/DoctorChat';
import { DoctorPrescriptions } from './pages/doctor/DoctorPrescriptions';
import { DoctorMedicalRecords } from './pages/doctor/DoctorMedicalRecords';
import { DoctorPatients } from './pages/doctor/DoctorPatients';
import { DoctorAvailabilityPage } from './pages/doctor/DoctorAvailabilityPage';
import { DoctorProfilePage } from './pages/doctor/DoctorProfilePage';
import { DoctorSettingsPage } from './pages/doctor/DoctorSettingsPage';

// Admin Portal Pages
import { AdminDashboard } from './pages/admin/AdminDashboard';
import { AdminBranchesPage } from './pages/admin/AdminBranchesPage';
import { AdminClients } from './pages/admin/AdminClients';
import { AdminDoctors } from './pages/admin/AdminDoctors';
import { AdminPets } from './pages/admin/AdminPets';
import { AdminConsultations } from './pages/admin/AdminConsultations';
import { AdminPrescriptions } from './pages/admin/AdminPrescriptions';
import { AdminMedicalRecords } from './pages/admin/AdminMedicalRecords';
import { AdminPayments } from './pages/admin/AdminPayments';
import { AdminReports } from './pages/admin/AdminReports';
import { AdminSettings } from './pages/admin/AdminSettings';

export default function App() {
  return (
    <AuthProvider>
      <AppProvider>
        <BrowserRouter>
          <Routes>
            {/* Public Landing, Authentication & Onboarding Entry Routes */}
            <Route path="/" element={<LandingPage />} />
            <Route path="/login/client" element={<AuthPage mode="login" portal="client" />} />
            <Route path="/login/clinic" element={<AuthPage mode="login" portal="clinic" />} />
            <Route path="/platform/login" element={<AuthPage mode="login" portal="platform" />} />

            {/* Legacy & Utility Auth Routes */}
            <Route path="/login" element={<AuthPage mode="login" portal="generic" />} />
            <Route path="/signup" element={<AuthPage mode="signup" portal="generic" />} />
            <Route path="/forgot-password" element={<AuthPage mode="forgot" portal="generic" />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/accept-invite" element={<AcceptInvitePage />} />
            <Route path="/unauthorized" element={<UnauthorizedPage />} />

            {/* Authenticated Application Shell */}
            <Route
              element={
                <RequireAuth>
                  <AppLayout />
                </RequireAuth>
              }
            >
              <Route path="workspaces" element={<WorkspacesPage />} />
              <Route
                path="notifications"
                element={
                  <NotificationsCenter
                    portal="global"
                    title="Account Notifications"
                  />
                }
              />

              {/* Platform Owner Console */}
              <Route element={<RequirePlatformAdmin />}>
                <Route path="platform" element={<Navigate to="/platform/dashboard" replace />} />
                <Route path="platform/dashboard" element={<PlatformDashboardPage />} />
                <Route path="platform/applications" element={<PlatformOrganizationsPage />} />
                <Route path="platform/organizations" element={<PlatformOrganizationsPage />} />
                <Route path="platform/users" element={<PlatformUsersPage />} />
                <Route path="platform/analytics" element={<PlatformAnalyticsPage />} />
                <Route
                  path="platform/notifications"
                  element={
                    <NotificationsCenter
                      portal="platform"
                      title="Platform Governance Notifications"
                    />
                  }
                />
                <Route path="platform/settings" element={<PlatformSettingsPage />} />
              </Route>

              {/* Multi-Tenant Client Portal */}
              <Route
                path=":orgSlug/client"
                element={<RequireWorkspaceAccess portal="client" />}
              >
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="dashboard" element={<ClientDashboard />} />
                <Route path="pets" element={<MyPets />} />
                <Route path="pets/:id" element={<PetDetails />} />
                <Route path="doctors" element={<FindDoctor />} />
                <Route path="consultations" element={<MyConsultations />} />
                <Route path="chat" element={<ClientChat />} />
                <Route path="chat/:id" element={<ClientChat />} />
                <Route path="prescriptions" element={<ClientPrescriptions />} />
                <Route path="medical-records" element={<ClientMedicalRecords />} />
                <Route path="notifications" element={<ClientNotifications />} />
                <Route path="payments" element={<ClientPayments />} />
                <Route path="profile" element={<ClientProfile />} />
                <Route path="organizations" element={<ClientOrganizations />} />
                <Route path="settings" element={<ClientSettings />} />
              </Route>

              {/* Multi-Tenant Doctor Portal */}
              <Route
                path=":orgSlug/doctor"
                element={<RequireWorkspaceAccess portal="doctor" />}
              >
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="dashboard" element={<DoctorDashboard />} />
                <Route path="requests" element={<DoctorRequests />} />
                <Route path="consultations" element={<DoctorConsultations />} />
                <Route path="consultations/:id" element={<DoctorConsultations />} />
                <Route path="chat" element={<DoctorChat />} />
                <Route path="chat/:id" element={<DoctorChat />} />
                <Route path="patients" element={<DoctorPatients />} />
                <Route path="prescriptions" element={<DoctorPrescriptions />} />
                <Route path="medical-records" element={<DoctorMedicalRecords />} />
                <Route path="availability" element={<DoctorAvailabilityPage />} />
                <Route
                  path="notifications"
                  element={
                    <NotificationsCenter
                      portal="doctor"
                      title="Veterinarian Notifications"
                    />
                  }
                />
                <Route path="profile" element={<DoctorProfilePage />} />
                <Route path="settings" element={<DoctorSettingsPage />} />
              </Route>

              {/* Multi-Tenant Clinic Admin Portal */}
              <Route
                path=":orgSlug/admin"
                element={<RequireWorkspaceAccess portal="admin" />}
              >
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="dashboard" element={<AdminDashboard />} />
                <Route
                  path="onboarding"
                  element={
                    <RequireWorkspaceAccess
                      portal="admin"
                      requiredPermissions={[...ADMIN_ROUTE_PERMISSIONS.onboarding]}
                    >
                      <AdminOnboardingPage />
                    </RequireWorkspaceAccess>
                  }
                />
                <Route
                  path="branches"
                  element={
                    <RequireWorkspaceAccess
                      portal="admin"
                      requiredPermissions={[...ADMIN_ROUTE_PERMISSIONS.branches]}
                    >
                      <AdminBranchesPage />
                    </RequireWorkspaceAccess>
                  }
                />
                <Route
                  path="clients"
                  element={
                    <RequireWorkspaceAccess
                      portal="admin"
                      requiredPermissions={[...ADMIN_ROUTE_PERMISSIONS.clients]}
                    >
                      <AdminClients />
                    </RequireWorkspaceAccess>
                  }
                />
                <Route
                  path="doctors"
                  element={
                    <RequireWorkspaceAccess
                      portal="admin"
                      requiredPermissions={[...ADMIN_ROUTE_PERMISSIONS.doctors]}
                    >
                      <AdminDoctors />
                    </RequireWorkspaceAccess>
                  }
                />
                <Route
                  path="pets"
                  element={
                    <RequireWorkspaceAccess
                      portal="admin"
                      requiredPermissions={[...ADMIN_ROUTE_PERMISSIONS.pets]}
                    >
                      <AdminPets />
                    </RequireWorkspaceAccess>
                  }
                />
                <Route
                  path="consultations"
                  element={
                    <RequireWorkspaceAccess
                      portal="admin"
                      requiredPermissions={[...ADMIN_ROUTE_PERMISSIONS.consultations]}
                    >
                      <AdminConsultations />
                    </RequireWorkspaceAccess>
                  }
                />
                <Route
                  path="prescriptions"
                  element={
                    <RequireWorkspaceAccess
                      portal="admin"
                      requiredPermissions={[...ADMIN_ROUTE_PERMISSIONS.prescriptions]}
                    >
                      <AdminPrescriptions />
                    </RequireWorkspaceAccess>
                  }
                />
                <Route
                  path="medical-records"
                  element={
                    <RequireWorkspaceAccess
                      portal="admin"
                      requiredPermissions={[...ADMIN_ROUTE_PERMISSIONS['medical-records']]}
                    >
                      <AdminMedicalRecords />
                    </RequireWorkspaceAccess>
                  }
                />
                <Route
                  path="payments"
                  element={
                    <RequireWorkspaceAccess
                      portal="admin"
                      requiredPermissions={[...ADMIN_ROUTE_PERMISSIONS.payments]}
                    >
                      <AdminPayments />
                    </RequireWorkspaceAccess>
                  }
                />
                <Route
                  path="reports"
                  element={
                    <RequireWorkspaceAccess
                      portal="admin"
                      requiredPermissions={[...ADMIN_ROUTE_PERMISSIONS.reports]}
                    >
                      <AdminReports />
                    </RequireWorkspaceAccess>
                  }
                />
                <Route
                  path="settings"
                  element={
                    <RequireWorkspaceAccess
                      portal="admin"
                      requiredPermissions={[...ADMIN_ROUTE_PERMISSIONS.settings]}
                    >
                      <AdminSettings />
                    </RequireWorkspaceAccess>
                  }
                />
                <Route
                  path="notifications"
                  element={
                    <NotificationsCenter
                      portal="admin"
                      title="Organization Notifications"
                    />
                  }
                />
                <Route path="profile" element={<Navigate to="../dashboard" replace />} />
              </Route>

              {/* Legacy Unscoped Portal Redirects (Protected by RequireAuth) */}
              <Route path="client/*" element={<LegacyPortalRedirect portal="client" />} />
              <Route path="doctor/*" element={<LegacyPortalRedirect portal="doctor" />} />
              <Route path="admin/*" element={<LegacyPortalRedirect portal="admin" />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AppProvider>
    </AuthProvider>
  );
}
