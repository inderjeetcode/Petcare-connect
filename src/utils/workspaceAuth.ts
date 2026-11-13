import {
  AuthPortalEntry,
  MyClinicClient,
  MyContextResponse,
  MyMembership,
  OrgRoleCode,
  PortalKind,
  WorkspaceOption,
} from '../types/auth';
import { UserRole } from '../types';

const ADMIN_PORTAL_ROLES: OrgRoleCode[] = [
  'org_owner',
  'org_admin',
  'branch_manager',
  'front_desk',
];

export function isAdminPortalRole(role: OrgRoleCode): boolean {
  return ADMIN_PORTAL_ROLES.includes(role);
}

export function hasOrgRole(
  membership: MyMembership | null | undefined,
  allowedRoles: OrgRoleCode[]
): boolean {
  if (!membership || membership.membership_status !== 'active') return false;
  if (membership.organization_status !== 'active') return false;
  return membership.roles.some((r) => allowedRoles.includes(r));
}

export function hasOrgPermission(
  membership: MyMembership | null | undefined,
  permission: string
): boolean {
  if (!membership || membership.membership_status !== 'active') return false;
  if (membership.organization_status !== 'active') return false;
  return membership.permissions.includes(permission);
}

export function hasBranchAccess(
  membership: MyMembership | null | undefined,
  branchId: string | null | undefined,
  permission?: string
): boolean {
  if (!membership || membership.membership_status !== 'active') return false;
  if (membership.organization_status !== 'active') return false;
  if (permission && !membership.permissions.includes(permission)) return false;
  // Empty branch_ids means org-wide access (see Phase 2 app.has_branch_access)
  if (!membership.branch_ids || membership.branch_ids.length === 0) return true;
  if (!branchId) return false;
  return membership.branch_ids.includes(branchId);
}

/**
 * Builds the verified workspace options allowed for the authenticated user
 * strictly from database-returned `get_my_context()`.
 */
export function buildWorkspaceOptions(
  context: MyContextResponse | null
): WorkspaceOption[] {
  if (!context) return [];
  const options: WorkspaceOption[] = [];

  if (context.is_platform_admin) {
    options.push({
      key: 'platform:owner',
      portal: 'platform',
      organization_id: null,
      organization_slug: null,
      organization_name: 'Pet Connect Platform',
      label: 'Platform Owner Console',
      sublabel: 'Organization Onboarding & Governance',
      default_path: '/platform/dashboard',
      roles: [],
      permissions: [],
      branch_ids: [],
    });
  }

  for (const mem of context.memberships || []) {
    if (mem.organization_status !== 'active' || mem.membership_status !== 'active') {
      continue;
    }

    if (mem.roles.includes('doctor')) {
      options.push({
        key: `doctor:${mem.organization_id}`,
        portal: 'doctor',
        organization_id: mem.organization_id,
        organization_slug: mem.organization_slug,
        organization_name: mem.organization_name,
        label: `${mem.organization_name} — Doctor Portal`,
        sublabel: 'Clinical Consultations, Patients & Prescriptions',
        default_path: `/${mem.organization_slug}/doctor/dashboard`,
        roles: mem.roles,
        permissions: mem.permissions,
        branch_ids: mem.branch_ids,
      });
    }

    if (mem.roles.some(isAdminPortalRole)) {
      const roleLabels = mem.roles
        .filter(isAdminPortalRole)
        .map((r) => r.replace('_', ' '))
        .join(', ');
      options.push({
        key: `admin:${mem.organization_id}`,
        portal: 'admin',
        organization_id: mem.organization_id,
        organization_slug: mem.organization_slug,
        organization_name: mem.organization_name,
        label: `${mem.organization_name} — Clinic Admin`,
        sublabel: `Roles: ${roleLabels}`,
        default_path: `/${mem.organization_slug}/admin/dashboard`,
        roles: mem.roles,
        permissions: mem.permissions,
        branch_ids: mem.branch_ids,
      });
    }
  }

  for (const cc of context.clinic_clients || []) {
    if (cc.organization_status !== 'active' || cc.client_status !== 'approved') {
      continue;
    }
    options.push({
      key: `client:${cc.organization_id}`,
      portal: 'client',
      organization_id: cc.organization_id,
      organization_slug: cc.organization_slug,
      organization_name: cc.organization_name,
      label: `${cc.organization_name} — Pet Owner Portal`,
      sublabel: 'My Pets, Consultations & Medical Records',
      default_path: `/${cc.organization_slug}/client/dashboard`,
      roles: [],
      permissions: [],
      branch_ids: [],
      clinic_client_id: cc.clinic_client_id,
    });
  }

  return options;
}

export type PortalAccessCheckResult =
  | {
      allowed: true;
      portal: PortalKind;
      organizationId: string;
      organizationSlug: string;
      organizationName: string;
      membership?: MyMembership;
      clinicClient?: MyClinicClient;
    }
  | {
      allowed: false;
      reason:
        | 'unauthenticated'
        | 'org_pending'
        | 'org_suspended'
        | 'org_closed'
        | 'member_suspended'
        | 'member_inactive'
        | 'client_requested'
        | 'client_rejected'
        | 'client_suspended'
        | 'forbidden';
      message: string;
      organizationName?: string;
    };

export function checkWorkspacePortalAccess(
  context: MyContextResponse | null,
  orgSlug: string | undefined,
  portal: Exclude<PortalKind, 'platform'>
): PortalAccessCheckResult {
  if (!context) {
    return {
      allowed: false,
      reason: 'unauthenticated',
      message: 'Authentication is required to access this workspace.',
    };
  }

  const normalizedSlug = (orgSlug || '').trim().toLowerCase();
  const membership = (context.memberships || []).find(
    (m) => m.organization_slug.toLowerCase() === normalizedSlug
  );
  const clinicClient = (context.clinic_clients || []).find(
    (cc) => cc.organization_slug.toLowerCase() === normalizedSlug
  );

  const orgStatus = membership?.organization_status || clinicClient?.organization_status;
  const orgName = membership?.organization_name || clinicClient?.organization_name;

  if (orgStatus === 'pending') {
    return {
      allowed: false,
      reason: 'org_pending',
      organizationName: orgName,
      message: `${orgName || 'This organization'} is awaiting Platform Owner approval and cannot access active clinic workspaces yet.`,
    };
  }
  if (orgStatus === 'suspended') {
    return {
      allowed: false,
      reason: 'org_suspended',
      organizationName: orgName,
      message: `${orgName || 'This organization'} is currently suspended. Contact Platform Administration.`,
    };
  }
  if (orgStatus === 'closed') {
    return {
      allowed: false,
      reason: 'org_closed',
      organizationName: orgName,
      message: `${orgName || 'This organization'} has been closed.`,
    };
  }

  if (portal === 'client') {
    if (!clinicClient) {
      return {
        allowed: false,
        reason: 'forbidden',
        message: 'You do not have an approved pet owner membership for this veterinary clinic.',
      };
    }
    if (clinicClient.client_status === 'requested') {
      return {
        allowed: false,
        reason: 'client_requested',
        organizationName: clinicClient.organization_name,
        message: `Your request to join ${clinicClient.organization_name} is pending clinic approval.`,
      };
    }
    if (clinicClient.client_status === 'rejected') {
      return {
        allowed: false,
        reason: 'client_rejected',
        organizationName: clinicClient.organization_name,
        message: `Your request to join ${clinicClient.organization_name} was declined by clinic staff.`,
      };
    }
    if (clinicClient.client_status === 'suspended') {
      return {
        allowed: false,
        reason: 'client_suspended',
        organizationName: clinicClient.organization_name,
        message: `Your client access at ${clinicClient.organization_name} is currently suspended.`,
      };
    }
    return {
      allowed: true,
      portal: 'client',
      organizationId: clinicClient.organization_id,
      organizationSlug: clinicClient.organization_slug,
      organizationName: clinicClient.organization_name,
      clinicClient,
    };
  }

  // Staff portals: 'doctor' or 'admin'
  if (!membership) {
    return {
      allowed: false,
      reason: 'forbidden',
      message: 'You do not hold an active staff membership in this veterinary organization.',
    };
  }
  if (membership.membership_status === 'suspended') {
    return {
      allowed: false,
      reason: 'member_suspended',
      organizationName: membership.organization_name,
      message: `Your staff membership at ${membership.organization_name} has been suspended.`,
    };
  }
  if (membership.membership_status !== 'active') {
    return {
      allowed: false,
      reason: 'member_inactive',
      organizationName: membership.organization_name,
      message: `Your staff membership at ${membership.organization_name} is not active (${membership.membership_status}).`,
    };
  }

  if (portal === 'doctor') {
    if (!membership.roles.includes('doctor')) {
      return {
        allowed: false,
        reason: 'forbidden',
        organizationName: membership.organization_name,
        message: 'Doctor portal access requires an assigned Doctor role in this clinic.',
      };
    }
  } else if (portal === 'admin') {
    if (!membership.roles.some(isAdminPortalRole)) {
      return {
        allowed: false,
        reason: 'forbidden',
        organizationName: membership.organization_name,
        message: 'Clinic administration requires an Owner, Admin, Branch Manager, or Front Desk role.',
      };
    }
  }

  return {
    allowed: true,
    portal,
    organizationId: membership.organization_id,
    organizationSlug: membership.organization_slug,
    organizationName: membership.organization_name,
    membership,
  };
}

const AUTH_ENTRY_PATHS = new Set([
  '/',
  '/login',
  '/login/client',
  '/login/clinic',
  '/platform/login',
  '/signup',
  '/forgot-password',
  '/unauthorized',
]);

/**
 * Maps Organization Admin route sections to the exact database permissions required.
 * Enforced both at route level (RouteGuards + App.tsx) and in return-path validation.
 */
export const ADMIN_ROUTE_PERMISSIONS = {
  onboarding: ['clients.approve', 'staff.manage', 'branch.manage'],
  branches: ['branch.manage', 'schedules.manage'],
  clients: ['clients.read'],
  doctors: ['staff.manage', 'schedules.manage'],
  pets: ['pets.read'],
  consultations: ['appointments.read', 'consultations.manage'],
  prescriptions: ['audit.read', 'medical_records.read'],
  'medical-records': ['audit.read', 'medical_records.read'],
  payments: ['audit.read'],
  reports: ['audit.read'],
  settings: ['org.manage', 'branch.manage', 'staff.manage'],
} as const satisfies Record<string, readonly string[]>;

export function getAdminSectionRequiredPermissions(
  section: string | undefined
): readonly string[] | undefined {
  const key = (section || '').trim().toLowerCase().split('/')[0];
  if (!key) return undefined;
  return (ADMIN_ROUTE_PERMISSIONS as Record<string, readonly string[]>)[key];
}

export function hasAnyRequiredPermission(
  grantedPermissions: readonly string[] | undefined,
  requiredPermissions: readonly string[] | undefined
): boolean {
  if (!requiredPermissions || requiredPermissions.length === 0) return true;
  if (!grantedPermissions || grantedPermissions.length === 0) return false;
  return requiredPermissions.some((perm) => grantedPermissions.includes(perm));
}

/**
 * Resolves the portal-specific login entrypoint for unauthenticated access.
 */
export function resolveUnauthenticatedLoginPath(pathname: string): string {
  const normalized = (pathname || '').trim().toLowerCase().replace(/\/+$/, '') || '/';

  if (normalized === '/platform' || normalized.startsWith('/platform/')) {
    return '/platform/login';
  }

  if (
    /^\/[^/]+\/client(\/|$)/.test(normalized) ||
    normalized === '/client' ||
    normalized.startsWith('/client/')
  ) {
    return '/login/client';
  }

  if (
    /^\/[^/]+\/(doctor|admin)(\/|$)/.test(normalized) ||
    normalized === '/doctor' ||
    normalized.startsWith('/doctor/') ||
    normalized === '/admin' ||
    normalized.startsWith('/admin/')
  ) {
    return '/login/clinic';
  }

  return '/login';
}

/**
 * Validates an untrusted `location.state.from` destination strictly against
 * the authenticated user's database-returned `get_my_context()` and portal entry intent.
 * Returns a normalized internal path+search, or `null` if rejected.
 */
export function isAuthorizedReturnPath(
  context: MyContextResponse | null,
  rawPath: string | undefined,
  portalIntent: AuthPortalEntry = 'generic'
): string | null {
  if (!context || !rawPath) return null;
  const trimmed = rawPath.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('\\')) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed, 'https://petconnect.local');
  } catch {
    return null;
  }
  if (parsed.origin !== 'https://petconnect.local') {
    return null;
  }

  const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  const normalizedFull = `${pathname}${parsed.search}`;

  if (AUTH_ENTRY_PATHS.has(pathname)) {
    return null;
  }

  if (pathname === '/accept-invite' || pathname === '/reset-password') {
    return normalizedFull;
  }

  const workspaces = buildWorkspaceOptions(context);
  const staffWorkspaces = workspaces.filter(
    (w) => w.portal === 'doctor' || w.portal === 'admin'
  );
  const clientWorkspaces = workspaces.filter((w) => w.portal === 'client');

  if (pathname === '/notifications') {
    return portalIntent === 'generic' || workspaces.length > 0 ? normalizedFull : null;
  }

  if (pathname === '/platform' || pathname.startsWith('/platform/')) {
    if (!context.is_platform_admin) return null;
    if (portalIntent !== 'platform') return null;
    return normalizedFull;
  }

  const tenantMatch = pathname.match(/^\/([^/]+)\/(client|doctor|admin)(?:\/(.*))?$/i);
  if (tenantMatch) {
    const [, orgSlug, rawPortal, subpath = ''] = tenantMatch;
    const targetPortal = rawPortal.toLowerCase() as Exclude<PortalKind, 'platform'>;

    if (portalIntent === 'platform') return null;
    if (portalIntent === 'client' && targetPortal !== 'client') return null;
    if (portalIntent === 'clinic' && targetPortal === 'client') return null;

    const access = checkWorkspacePortalAccess(context, orgSlug, targetPortal);
    if (!access.allowed) return null;

    if (targetPortal === 'admin') {
      const requiredPerms = getAdminSectionRequiredPermissions(subpath);
      if (!hasAnyRequiredPermission(access.membership?.permissions, requiredPerms)) {
        return null;
      }
    }

    return normalizedFull;
  }

  const legacyMatch = pathname.match(/^\/(client|doctor|admin)(?:\/(.*))?$/i);
  if (legacyMatch) {
    const legacyPortal = legacyMatch[1].toLowerCase() as Exclude<PortalKind, 'platform'>;
    const legacySubpath = legacyMatch[2] || '';
    if (portalIntent === 'platform') return null;
    if (portalIntent === 'client' && legacyPortal !== 'client') return null;
    if (portalIntent === 'clinic' && legacyPortal === 'client') return null;
    const matchingWorkspaces = workspaces.filter((w) => w.portal === legacyPortal);
    if (matchingWorkspaces.length === 0) return null;

    if (legacyPortal === 'admin') {
      const requiredPerms = getAdminSectionRequiredPermissions(legacySubpath);
      if (
        !matchingWorkspaces.some((w) =>
          hasAnyRequiredPermission(w.permissions, requiredPerms)
        )
      ) {
        return null;
      }
    }

    return normalizedFull;
  }

  if (pathname === '/workspaces') {
    if (portalIntent === 'platform') return null;
    if (portalIntent === 'clinic') return staffWorkspaces.length > 0 ? normalizedFull : null;
    if (portalIntent === 'client') return clientWorkspaces.length > 1 ? normalizedFull : null;
    return workspaces.some((w) => w.portal !== 'platform') ? normalizedFull : null;
  }

  return null;
}

export type PortalLandingDecision =
  | { kind: 'redirect'; path: string }
  | { kind: 'client_pending_status'; clinicClients: MyClinicClient[] }
  | {
      kind: 'denied';
      reason:
        | 'platform_forbidden'
        | 'platform_login_required'
        | 'clinic_membership_required';
      message: string;
    };

/**
 * Resolves post-authentication landing exclusively from verified `get_my_context()` data.
 */
export function resolvePortalLandingDecision(
  context: MyContextResponse,
  portalIntent: AuthPortalEntry = 'generic',
  stateFrom?: string
): PortalLandingDecision {
  const validReturn = isAuthorizedReturnPath(context, stateFrom, portalIntent);
  if (validReturn) {
    return { kind: 'redirect', path: validReturn };
  }

  const workspaces = buildWorkspaceOptions(context);
  const staffWorkspaces = workspaces.filter(
    (w) => w.portal === 'doctor' || w.portal === 'admin'
  );
  const clientWorkspaces = workspaces.filter((w) => w.portal === 'client');
  const clinicClients = context.clinic_clients || [];

  if (portalIntent === 'platform') {
    if (context.is_platform_admin) {
      return { kind: 'redirect', path: '/platform/dashboard' };
    }
    return {
      kind: 'denied',
      reason: 'platform_forbidden',
      message:
        'Access denied: this account does not hold active Platform Owner governance authorization.',
    };
  }

  if (portalIntent === 'clinic') {
    if (staffWorkspaces.length === 1) {
      return { kind: 'redirect', path: staffWorkspaces[0].default_path };
    }
    if (staffWorkspaces.length > 1) {
      return { kind: 'redirect', path: '/workspaces' };
    }
    return {
      kind: 'denied',
      reason: 'clinic_membership_required',
      message:
        'No active clinic staff or veterinarian membership was found for this account. Clinic access requires clinic administrator approval or a staff invitation.',
    };
  }

  const nonPlatformWorkspaces = workspaces.filter((w) => w.portal !== 'platform');

  if (portalIntent === 'client') {
    if (clientWorkspaces.length === 1) {
      return { kind: 'redirect', path: clientWorkspaces[0].default_path };
    }
    if (clientWorkspaces.length > 1) {
      return { kind: 'redirect', path: '/workspaces' };
    }
    if (context.is_platform_admin && clinicClients.length === 0) {
      return {
        kind: 'denied',
        reason: 'platform_login_required',
        message:
          'Platform Owner accounts cannot access governance portals from Pet Owner login. Use the dedicated Platform Governance sign-in endpoint.',
      };
    }
    return {
      kind: 'client_pending_status',
      clinicClients,
    };
  }

  // Legacy/generic entry (/login, /signup): never provide a route to Platform Owner access
  if (context.is_platform_admin && nonPlatformWorkspaces.length === 0) {
    return {
      kind: 'denied',
      reason: 'platform_login_required',
      message:
        'Platform Owner access is disabled on generic login and signup routes. Sign out and authenticate at the dedicated Platform Governance sign-in route.',
    };
  }
  if (nonPlatformWorkspaces.length === 1) {
    return { kind: 'redirect', path: nonPlatformWorkspaces[0].default_path };
  }
  if (nonPlatformWorkspaces.length > 1) {
    return { kind: 'redirect', path: '/workspaces' };
  }
  if (
    !context.is_platform_admin &&
    (context.memberships || []).length === 0 &&
    clinicClients.length > 0
  ) {
    return {
      kind: 'client_pending_status',
      clinicClients,
    };
  }
  return { kind: 'redirect', path: '/workspaces' };
}

export function deriveLegacyPortalRole(workspace: WorkspaceOption | null): UserRole {
  if (!workspace) return 'client';
  if (workspace.portal === 'doctor') return 'doctor';
  if (workspace.portal === 'admin' || workspace.portal === 'platform') return 'admin';
  return 'client';
}
