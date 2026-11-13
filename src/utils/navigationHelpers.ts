import {
  MyClinicClient,
  MyContextResponse,
  MyMembership,
  PortalKind,
  WorkspaceOption,
} from '../types/auth';
import {
  ADMIN_ROUTE_PERMISSIONS,
  hasAnyRequiredPermission,
  isAdminPortalRole,
} from './workspaceAuth';

export type SidebarIconKey =
  | 'dashboard'
  | 'pets'
  | 'doctors'
  | 'appointments'
  | 'consultations'
  | 'chat'
  | 'prescriptions'
  | 'medical_records'
  | 'payments'
  | 'notifications'
  | 'organizations'
  | 'profile'
  | 'settings'
  | 'workspaces'
  | 'branches'
  | 'onboarding'
  | 'clients'
  | 'reports'
  | 'schedules'
  | 'platform_apps'
  | 'platform_users'
  | 'invite';

export interface SidebarNavItem {
  to: string;
  label: string;
  iconKey: SidebarIconKey;
  badgeCount?: number;
}

export interface SidebarNavModel {
  portal: PortalKind | 'global';
  title: string;
  items: SidebarNavItem[];
}

export interface WorkspaceStateSummary {
  isPlatformAdmin: boolean;
  hasStaffMembership: boolean;
  hasApprovedClientAccess: boolean;
  hasPendingClientRequest: boolean;
  pendingClientRequests: MyClinicClient[];
  isClientOnlyAccount: boolean;
  isPlatformOnlyAccount: boolean;
  showWorkspaceSwitcher: boolean;
  headerRoleBadge: string;
}

export function resolveWorkspaceStateSummary(params: {
  myContext: MyContextResponse | null;
  availableWorkspaces: WorkspaceOption[];
  activeWorkspace: WorkspaceOption | null;
}): WorkspaceStateSummary {
  const { myContext, availableWorkspaces, activeWorkspace } = params;
  const isPlatformAdmin = Boolean(myContext?.is_platform_admin);
  const memberships = myContext?.memberships || [];
  const clinicClients = myContext?.clinic_clients || [];

  const hasStaffMembership = memberships.length > 0;
  const hasApprovedClientAccess = clinicClients.some(
    (c) => c.client_status === 'approved' && c.organization_status === 'active'
  );
  const pendingClientRequests = clinicClients.filter(
    (c) => c.client_status === 'requested'
  );
  const hasPendingClientRequest = pendingClientRequests.length > 0;

  const isClientOnlyAccount =
    !isPlatformAdmin && !hasStaffMembership && clinicClients.length > 0;

  const isPlatformOnlyAccount =
    isPlatformAdmin &&
    !hasStaffMembership &&
    clinicClients.length === 0 &&
    availableWorkspaces.every((w) => w.portal === 'platform');

  const showWorkspaceSwitcher =
    availableWorkspaces.length > 0 && !isPlatformOnlyAccount;

  const headerRoleBadge = (() => {
    if (activeWorkspace) {
      if (activeWorkspace.portal === 'platform') return 'Platform Owner';
      if (activeWorkspace.portal === 'admin') return 'Clinic Admin';
      if (activeWorkspace.portal === 'doctor') return 'Doctor';
      return 'Pet Owner';
    }
    if (isPlatformAdmin) return 'Platform Owner';
    if (hasPendingClientRequest) return 'Pending Approval';
    return 'No Active Portal';
  })();

  return {
    isPlatformAdmin,
    hasStaffMembership,
    hasApprovedClientAccess,
    hasPendingClientRequest,
    pendingClientRequests,
    isClientOnlyAccount,
    isPlatformOnlyAccount,
    showWorkspaceSwitcher,
    headerRoleBadge,
  };
}

function findActivePortalMembership(
  memberships: MyMembership[],
  orgSlug: string,
  portal: 'doctor' | 'admin'
): MyMembership | undefined {
  const normalized = orgSlug.trim().toLowerCase();
  return memberships.find(
    (m) =>
      m.organization_slug.toLowerCase() === normalized &&
      m.organization_status === 'active' &&
      m.membership_status === 'active' &&
      (portal === 'doctor'
        ? m.roles.includes('doctor')
        : m.roles.some(isAdminPortalRole))
  );
}

/**
 * Derives the verified navigation model strictly from the current route,
 * database-returned `get_my_context()`, and phase-C route permissions.
 * Fails closed when membership/permissions are missing.
 */
export function buildSidebarNavigation(params: {
  pathname: string;
  routeOrgSlug?: string;
  myContext: MyContextResponse | null;
  availableWorkspaces: WorkspaceOption[];
  activeWorkspace: WorkspaceOption | null;
  counts?: {
    pendingRequests?: number;
    activeChats?: number;
    unreadNotifs?: number;
  };
}): SidebarNavModel {
  const {
    pathname,
    routeOrgSlug,
    myContext,
    availableWorkspaces,
    activeWorkspace,
    counts,
  } = params;

  const pendingRequests = counts?.pendingRequests || 0;
  const activeChats = counts?.activeChats || 0;
  const unreadNotifs = counts?.unreadNotifs || 0;

  const normalizedPath = pathname.trim();
  const isPlatformRoute =
    normalizedPath === '/platform' || normalizedPath.startsWith('/platform/');
  const isGlobalHubRoute =
    normalizedPath === '/workspaces' ||
    normalizedPath === '/accept-invite' ||
    normalizedPath === '/notifications';

  const summary = resolveWorkspaceStateSummary({
    myContext,
    availableWorkspaces,
    activeWorkspace,
  });

  if (isPlatformRoute) {
    if (!myContext?.is_platform_admin) {
      return {
        portal: 'platform',
        title: 'Access Restricted',
        items: [],
      };
    }

    const platformItems: SidebarNavItem[] = [
      { to: '/platform/dashboard', label: 'Platform Overview', iconKey: 'dashboard' },
      { to: '/platform/applications', label: 'Clinic Applications', iconKey: 'platform_apps' },
      { to: '/platform/organizations', label: 'Organizations', iconKey: 'organizations' },
      { to: '/platform/users', label: 'Platform Users', iconKey: 'platform_users' },
      { to: '/platform/analytics', label: 'Analytics & Audit', iconKey: 'reports' },
      {
        to: '/platform/notifications',
        label: 'Notifications',
        iconKey: 'notifications',
        badgeCount: unreadNotifs,
      },
      { to: '/platform/settings', label: 'Platform Settings', iconKey: 'settings' },
    ];

    if (availableWorkspaces.some((w) => w.portal !== 'platform')) {
      platformItems.push({
        to: '/workspaces',
        label: 'My Workspaces',
        iconKey: 'workspaces',
      });
    }

    return {
      portal: 'platform',
      title: 'Platform Governance',
      items: platformItems,
    };
  }

  const tenantMatch = normalizedPath.match(/^\/([^/]+)\/(client|doctor|admin)(?:\/|$)/i);
  const routePortal = tenantMatch
    ? (tenantMatch[2].toLowerCase() as Exclude<PortalKind, 'platform'>)
    : undefined;
  const matchedSlug = tenantMatch ? tenantMatch[1] : undefined;

  const effectiveSlug =
    matchedSlug || routeOrgSlug || activeWorkspace?.organization_slug || '';

  if (isGlobalHubRoute || !effectiveSlug) {
    const globalItems: SidebarNavItem[] = [];

    if (!summary.isPlatformOnlyAccount) {
      globalItems.push({
        to: '/workspaces',
        label: summary.isClientOnlyAccount ? 'Clinics & Status' : 'My Workspaces',
        iconKey: 'workspaces',
      });
    }

    globalItems.push({
      to: '/notifications',
      label: 'Notifications',
      iconKey: 'notifications',
      badgeCount: unreadNotifs,
    });

    if (!summary.isClientOnlyAccount && !summary.isPlatformOnlyAccount) {
      globalItems.push({
        to: '/accept-invite',
        label: 'Accept Staff Invite',
        iconKey: 'invite',
      });
    }

    if (summary.isPlatformAdmin) {
      globalItems.push({
        to: '/platform/dashboard',
        label: 'Platform Console',
        iconKey: 'platform_apps',
      });
    }

    return {
      portal: 'global',
      title: summary.isClientOnlyAccount ? 'Pet Owner Account' : 'Pet Connect Hub',
      items: globalItems,
    };
  }

  const targetPortal: Exclude<PortalKind, 'platform'> =
    routePortal ||
    (activeWorkspace && activeWorkspace.portal !== 'platform'
      ? activeWorkspace.portal
      : 'client');

  const prefix = `/${effectiveSlug}`;

  if (targetPortal === 'doctor') {
    const doctorMembership = findActivePortalMembership(
      myContext?.memberships || [],
      effectiveSlug,
      'doctor'
    );

    if (!doctorMembership) {
      return {
        portal: 'doctor',
        title: 'Doctor Access Restricted',
        items: [],
      };
    }

    const doctorItems: SidebarNavItem[] = [
      { to: `${prefix}/doctor/dashboard`, label: 'Doctor Dashboard', iconKey: 'dashboard' },
      {
        to: `${prefix}/doctor/requests`,
        label: 'Appointments',
        iconKey: 'appointments',
        badgeCount: pendingRequests,
      },
      {
        to: `${prefix}/doctor/consultations`,
        label: 'Consultations',
        iconKey: 'consultations',
        badgeCount: activeChats,
      },
      { to: `${prefix}/doctor/chat`, label: 'Chat Sessions', iconKey: 'chat' },
      { to: `${prefix}/doctor/patients`, label: 'Patients Directory', iconKey: 'pets' },
      { to: `${prefix}/doctor/prescriptions`, label: 'Prescriptions', iconKey: 'prescriptions' },
      { to: `${prefix}/doctor/medical-records`, label: 'Medical & Vaccines', iconKey: 'medical_records' },
      { to: `${prefix}/doctor/availability`, label: 'Branches & Schedule', iconKey: 'schedules' },
      {
        to: `${prefix}/doctor/notifications`,
        label: 'Notifications',
        iconKey: 'notifications',
        badgeCount: unreadNotifs,
      },
      { to: `${prefix}/doctor/profile`, label: 'Doctor Profile', iconKey: 'profile' },
      { to: `${prefix}/doctor/settings`, label: 'Settings', iconKey: 'settings' },
    ];

    if (availableWorkspaces.length > 1) {
      doctorItems.push({
        to: '/workspaces',
        label: 'Switch Workspace',
        iconKey: 'workspaces',
      });
    }

    return {
      portal: 'doctor',
      title: `${doctorMembership.organization_name} — Doctor`,
      items: doctorItems,
    };
  }

  if (targetPortal === 'admin') {
    const adminMembership = findActivePortalMembership(
      myContext?.memberships || [],
      effectiveSlug,
      'admin'
    );

    if (!adminMembership) {
      return {
        portal: 'admin',
        title: 'Admin Access Restricted',
        items: [],
      };
    }

    const perms = adminMembership.permissions;
    const adminItems: SidebarNavItem[] = [
      { to: `${prefix}/admin/dashboard`, label: 'Admin Dashboard', iconKey: 'dashboard' },
    ];

    if (hasAnyRequiredPermission(perms, ADMIN_ROUTE_PERMISSIONS.onboarding)) {
      adminItems.push({
        to: `${prefix}/admin/onboarding`,
        label: 'Onboarding & Access',
        iconKey: 'onboarding',
      });
    }

    if (hasAnyRequiredPermission(perms, ADMIN_ROUTE_PERMISSIONS.branches)) {
      adminItems.push({
        to: `${prefix}/admin/branches`,
        label: 'Branches',
        iconKey: 'branches',
      });
    }

    if (hasAnyRequiredPermission(perms, ADMIN_ROUTE_PERMISSIONS.clients)) {
      adminItems.push({
        to: `${prefix}/admin/clients`,
        label: 'Client Management',
        iconKey: 'clients',
      });
    }

    if (hasAnyRequiredPermission(perms, ADMIN_ROUTE_PERMISSIONS.doctors)) {
      adminItems.push({
        to: `${prefix}/admin/doctors`,
        label: 'Doctor Management',
        iconKey: 'doctors',
      });
    }

    if (hasAnyRequiredPermission(perms, ADMIN_ROUTE_PERMISSIONS.pets)) {
      adminItems.push({
        to: `${prefix}/admin/pets`,
        label: 'Pet Directory',
        iconKey: 'pets',
      });
    }

    if (hasAnyRequiredPermission(perms, ADMIN_ROUTE_PERMISSIONS.consultations)) {
      adminItems.push({
        to: `${prefix}/admin/consultations`,
        label: 'Appointments & Cases',
        iconKey: 'appointments',
        badgeCount: pendingRequests,
      });
    }

    if (hasAnyRequiredPermission(perms, ADMIN_ROUTE_PERMISSIONS.prescriptions)) {
      adminItems.push({
        to: `${prefix}/admin/prescriptions`,
        label: 'Prescription Audit',
        iconKey: 'prescriptions',
      });
    }

    if (hasAnyRequiredPermission(perms, ADMIN_ROUTE_PERMISSIONS['medical-records'])) {
      adminItems.push({
        to: `${prefix}/admin/medical-records`,
        label: 'Medical Records',
        iconKey: 'medical_records',
      });
    }

    if (hasAnyRequiredPermission(perms, ADMIN_ROUTE_PERMISSIONS.payments)) {
      adminItems.push({
        to: `${prefix}/admin/payments`,
        label: 'Payment Ledger',
        iconKey: 'payments',
      });
    }

    if (hasAnyRequiredPermission(perms, ADMIN_ROUTE_PERMISSIONS.reports)) {
      adminItems.push({
        to: `${prefix}/admin/reports`,
        label: 'Analytics & Reports',
        iconKey: 'reports',
      });
    }

    if (hasAnyRequiredPermission(perms, ADMIN_ROUTE_PERMISSIONS.settings)) {
      adminItems.push({
        to: `${prefix}/admin/settings`,
        label: 'Services & Settings',
        iconKey: 'settings',
      });
    }

    adminItems.push({
      to: `${prefix}/admin/notifications`,
      label: 'Notifications',
      iconKey: 'notifications',
      badgeCount: unreadNotifs,
    });

    if (availableWorkspaces.length > 1) {
      adminItems.push({
        to: '/workspaces',
        label: 'Switch Workspace',
        iconKey: 'workspaces',
      });
    }

    return {
      portal: 'admin',
      title: `${adminMembership.organization_name} — Admin`,
      items: adminItems,
    };
  }

  // Client Portal (Pet Owner)
  const approvedClient = (myContext?.clinic_clients || []).find(
    (cc) =>
      cc.organization_slug.toLowerCase() === effectiveSlug.toLowerCase() &&
      cc.organization_status === 'active' &&
      cc.client_status === 'approved'
  );

  if (!approvedClient) {
    return {
      portal: 'client',
      title: 'Pet Owner Access Restricted',
      items: [],
    };
  }

  const clientItems: SidebarNavItem[] = [
    { to: `${prefix}/client/dashboard`, label: 'Dashboard', iconKey: 'dashboard' },
    { to: `${prefix}/client/pets`, label: 'My Pets', iconKey: 'pets' },
    { to: `${prefix}/client/doctors`, label: 'Find a Doctor', iconKey: 'doctors' },
    {
      to: `${prefix}/client/consultations`,
      label: 'Appointments & Chats',
      iconKey: 'appointments',
      badgeCount: activeChats,
    },
    { to: `${prefix}/client/chat`, label: 'Consultation Chat', iconKey: 'chat' },
    { to: `${prefix}/client/prescriptions`, label: 'Prescriptions', iconKey: 'prescriptions' },
    { to: `${prefix}/client/medical-records`, label: 'Medical Records', iconKey: 'medical_records' },
    { to: `${prefix}/client/payments`, label: 'Payments & Billing', iconKey: 'payments' },
    {
      to: `${prefix}/client/notifications`,
      label: 'Notifications',
      iconKey: 'notifications',
      badgeCount: unreadNotifs,
    },
    { to: `${prefix}/client/organizations`, label: 'Clinics & Access', iconKey: 'organizations' },
    { to: `${prefix}/client/profile`, label: 'Client Profile', iconKey: 'profile' },
    { to: `${prefix}/client/settings`, label: 'Settings', iconKey: 'settings' },
  ];

  if (availableWorkspaces.length > 1) {
    clientItems.push({
      to: '/workspaces',
      label: 'Switch Workspace',
      iconKey: 'workspaces',
    });
  }

  return {
    portal: 'client',
    title: `${approvedClient.organization_name} — Client`,
    items: clientItems,
  };
}
