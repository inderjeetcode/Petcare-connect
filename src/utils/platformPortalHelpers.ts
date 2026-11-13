import { OrganizationStatus } from '../types/auth';
import {
  PlatformAuditLogRecord,
  PlatformOrganizationOverview,
  PlatformOverviewMetrics,
  PlatformSupportScope,
  PlatformUserRecord,
} from '../types/platform';

export const ALLOWED_SUPPORT_SCOPES: Array<{
  value: PlatformSupportScope;
  label: string;
  description: string;
}> = [
  {
    value: 'org_diagnostics',
    label: 'Organization Diagnostics',
    description: 'Branch configuration, operational settings, and non-PHI appointment status counts.',
  },
  {
    value: 'billing_audit',
    label: 'Payment & Billing Audit',
    description: 'Aggregate payment status counts and organization plan metadata.',
  },
  {
    value: 'schedule_support',
    label: 'Scheduling & Routing Support',
    description: 'Branch timezone, slot policy, and aggregate consultation volume.',
  },
];

// Governance-permitted audit actions visible to Platform Owner (excludes patient/clinical/chat actions)
export const PLATFORM_PERMITTED_AUDIT_ACTIONS = new Set<string>([
  'SUBMIT_ORG_APPLICATION',
  'APPROVE_ORG_APPLICATION',
  'REJECT_ORG_APPLICATION',
  'SUSPEND_ORGANIZATION',
  'REACTIVATE_ORGANIZATION',
  'ACTIVATE_ORGANIZATION',
  'PLATFORM_UPDATE_ORG_METADATA',
  'GRANT_PLATFORM_ADMIN',
  'REVOKE_PLATFORM_ADMIN',
  'PLATFORM_SUSPEND_USER',
  'PLATFORM_REACTIVATE_USER',
  'UPDATE_PLATFORM_SETTINGS',
  'REQUEST_PLATFORM_SUPPORT_ACCESS',
  'APPROVE_PLATFORM_SUPPORT_ACCESS',
  'REJECT_PLATFORM_SUPPORT_ACCESS',
  'REVOKE_PLATFORM_SUPPORT_ACCESS',
  'SUPPORT_ACCESS_VIEWED',
]);

export function isPlatformAuditEventPermitted(
  action: string,
  organizationId: string | null
): boolean {
  const normalized = (action || '').toUpperCase().trim();
  if (!normalized) return false;
  if (PLATFORM_PERMITTED_AUDIT_ACTIONS.has(normalized)) return true;
  // Unscoped platform events (organization_id === null) are visible unless explicitly clinical
  if (organizationId === null) {
    return !/(MEDICAL_RECORD|PRESCRIPTION|VACCINATION|CHAT_MESSAGE|PET)/i.test(normalized);
  }
  return false;
}

export function validatePlatformOrgTransition(
  action: 'activate' | 'suspend' | 'reactivate',
  currentStatus: OrganizationStatus,
  reason?: string
): string | null {
  if (action === 'activate') {
    if (currentStatus !== 'pending') {
      return `Only pending organizations can be activated (current status: ${currentStatus}).`;
    }
    return null;
  }
  if (action === 'suspend') {
    if (currentStatus === 'suspended') {
      return 'Organization is already suspended.';
    }
    if (currentStatus === 'closed') {
      return 'Closed organizations cannot be suspended.';
    }
    if (!reason || !reason.trim()) {
      return 'A clear suspension reason is required for the audit log.';
    }
    return null;
  }
  if (action === 'reactivate') {
    if (currentStatus !== 'suspended') {
      return 'Only suspended organizations can be reactivated.';
    }
    return null;
  }
  return 'Unsupported organization lifecycle action.';
}

export function validatePlatformAdminGrant(
  targetUser: Pick<PlatformUserRecord, 'id' | 'is_platform_admin' | 'platform_status'>
): string | null {
  if (targetUser.platform_status !== 'active') {
    return 'Cannot grant Platform Owner role to a suspended account. Reactivate the user first.';
  }
  if (targetUser.is_platform_admin) {
    return 'This user already holds an active Platform Owner role.';
  }
  return null;
}

export function validatePlatformAdminRevoke(params: {
  targetUser: Pick<PlatformUserRecord, 'id' | 'is_platform_admin'>;
  actorUserId: string;
  activePlatformAdminCount: number;
  reason: string;
}): string | null {
  if (!params.targetUser.is_platform_admin) {
    return 'Target user does not hold an active Platform Owner role.';
  }
  if (params.targetUser.id === params.actorUserId) {
    return 'Self-revocation is blocked to prevent accidental platform lockout.';
  }
  if (params.activePlatformAdminCount <= 1) {
    return 'Cannot revoke the last active Platform Owner.';
  }
  if (!params.reason.trim()) {
    return 'A mandatory reason is required to revoke Platform Owner privileges.';
  }
  return null;
}

export function validatePlatformUserSuspension(params: {
  targetUser: Pick<PlatformUserRecord, 'id' | 'is_platform_admin' | 'platform_status'>;
  actorUserId: string;
  reason: string;
}): string | null {
  if (params.targetUser.id === params.actorUserId) {
    return 'Cannot suspend your own Platform Owner account.';
  }
  if (params.targetUser.is_platform_admin) {
    return 'Revoke the active Platform Owner role before suspending this account.';
  }
  if (params.targetUser.platform_status === 'suspended') {
    return 'This user account is already suspended.';
  }
  if (!params.reason.trim()) {
    return 'A suspension reason is required for the audit trail.';
  }
  return null;
}

export function validateSupportAccessRequest(params: {
  scope: string;
  reason: string;
  durationMinutes: number;
  maxMinutes: number;
}): string | null {
  const validScopes = new Set<string>(['org_diagnostics', 'billing_audit', 'schedule_support']);
  if (!validScopes.has(params.scope)) {
    return 'Clinical records, prescriptions, vaccinations, and chat messages cannot be requested via support access.';
  }
  if (!params.reason.trim() || params.reason.trim().length < 5) {
    return 'Provide a specific support ticket or operational justification (min 5 characters).';
  }
  if (
    !Number.isFinite(params.durationMinutes) ||
    params.durationMinutes < 15 ||
    params.durationMinutes > params.maxMinutes
  ) {
    return `Support access duration must be between 15 and ${params.maxMinutes} minutes.`;
  }
  return null;
}

export function validatePlatformSettingsInput(input: {
  platform_name: string;
  default_consultation_window_days: number;
  max_support_access_minutes: number;
}): string | null {
  if (!input.platform_name.trim()) {
    return 'Platform name cannot be empty.';
  }
  if (
    !Number.isFinite(input.default_consultation_window_days) ||
    input.default_consultation_window_days < 1 ||
    input.default_consultation_window_days > 30
  ) {
    return 'Default consultation window must be between 1 and 30 days.';
  }
  if (
    !Number.isFinite(input.max_support_access_minutes) ||
    input.max_support_access_minutes < 15 ||
    input.max_support_access_minutes > 480
  ) {
    return 'Maximum support access window must be between 15 and 480 minutes.';
  }
  return null;
}

export interface PlatformAggregateAnalyticsSummary {
  totalOrganizations: number;
  activeOrganizations: number;
  suspendedOrganizations: number;
  totalBranches: number;
  totalActiveStaff: number;
  totalApprovedClients: number;
  totalPets: number;
  totalAppointments: number;
  totalConsultations: number;
  activeConsultations: number;
  avgBranchesPerActiveOrg: number;
  avgStaffPerActiveOrg: number;
}

export function computePlatformAggregateAnalytics(
  orgs: PlatformOrganizationOverview[]
): PlatformAggregateAnalyticsSummary {
  const totalOrganizations = orgs.length;
  const activeOrgs = orgs.filter((o) => o.status === 'active');
  const suspendedOrganizations = orgs.filter((o) => o.status === 'suspended').length;
  const totalBranches = orgs.reduce((acc, o) => acc + Number(o.branch_count || 0), 0);
  const totalActiveStaff = orgs.reduce((acc, o) => acc + Number(o.active_staff_count || 0), 0);
  const totalApprovedClients = orgs.reduce((acc, o) => acc + Number(o.approved_client_count || 0), 0);
  const totalPets = orgs.reduce((acc, o) => acc + Number(o.pet_count || 0), 0);
  const totalAppointments = orgs.reduce((acc, o) => acc + Number(o.appointment_count || 0), 0);
  const totalConsultations = orgs.reduce((acc, o) => acc + Number(o.consultation_count || 0), 0);
  const activeConsultations = orgs.reduce((acc, o) => acc + Number(o.active_consultation_count || 0), 0);

  const activeCount = activeOrgs.length;
  return {
    totalOrganizations,
    activeOrganizations: activeCount,
    suspendedOrganizations,
    totalBranches,
    totalActiveStaff,
    totalApprovedClients,
    totalPets,
    totalAppointments,
    totalConsultations,
    activeConsultations,
    avgBranchesPerActiveOrg:
      activeCount > 0 ? Math.round((totalBranches / activeCount) * 10) / 10 : 0,
    avgStaffPerActiveOrg:
      activeCount > 0 ? Math.round((totalActiveStaff / activeCount) * 10) / 10 : 0,
  };
}

export interface PlatformActivationStats {
  totalApplications: number;
  pendingApplications: number;
  approvedApplications: number;
  rejectedApplications: number;
  approvalRatePct: number;
  totalOrganizations: number;
  activeOrganizations: number;
  pendingOrganizations: number;
  suspendedOrganizations: number;
  closedOrganizations: number;
  activeRatioPct: number;
  suspensionRatePct: number;
}

export function computePlatformActivationStats(params: {
  organizations: Array<{ status: string }>;
  applications: Array<{ status: string }>;
}): PlatformActivationStats {
  const pendingApplications = params.applications.filter((a) => a.status === 'pending').length;
  const approvedApplications = params.applications.filter((a) => a.status === 'approved').length;
  const rejectedApplications = params.applications.filter((a) => a.status === 'rejected').length;
  const reviewedApps = approvedApplications + rejectedApplications;
  const approvalRatePct =
    reviewedApps > 0 ? Math.round((approvedApplications / reviewedApps) * 100) : 0;

  const totalOrganizations = params.organizations.length;
  const activeOrganizations = params.organizations.filter((o) => o.status === 'active').length;
  const pendingOrganizations = params.organizations.filter((o) => o.status === 'pending').length;
  const suspendedOrganizations = params.organizations.filter((o) => o.status === 'suspended').length;
  const closedOrganizations = params.organizations.filter((o) => o.status === 'closed').length;

  const activeRatioPct =
    totalOrganizations > 0 ? Math.round((activeOrganizations / totalOrganizations) * 100) : 0;
  const suspensionRatePct =
    totalOrganizations > 0 ? Math.round((suspendedOrganizations / totalOrganizations) * 100) : 0;

  return {
    totalApplications: params.applications.length,
    pendingApplications,
    approvedApplications,
    rejectedApplications,
    approvalRatePct,
    totalOrganizations,
    activeOrganizations,
    pendingOrganizations,
    suspendedOrganizations,
    closedOrganizations,
    activeRatioPct,
    suspensionRatePct,
  };
}

function escapeCsvCell(val: string | number | null | undefined): string {
  const raw = val === null || val === undefined ? '' : String(val);
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

export function buildPlatformGovernanceCsv(params: {
  metrics: PlatformOverviewMetrics | null;
  organizations: PlatformOrganizationOverview[];
  auditLogs: PlatformAuditLogRecord[];
}): string {
  const lines: string[] = [];
  lines.push('PET CONNECT — PLATFORM GOVERNANCE & PRIVACY-PRESERVING AGGREGATE REPORT');
  lines.push(`Generated At,${escapeCsvCell(new Date().toISOString())}`);
  lines.push('Privacy Notice,Strictly aggregate counts & governance logs only. Zero clinical or chat content.');
  lines.push('');

  if (params.metrics) {
    lines.push('PLATFORM SUMMARY');
    lines.push('Metric,Value');
    lines.push(`Total Organizations,${params.metrics.organizations.total}`);
    lines.push(`Active Organizations,${params.metrics.organizations.active}`);
    lines.push(`Suspended Organizations,${params.metrics.organizations.suspended}`);
    lines.push(`Pending Applications,${params.metrics.applications.pending}`);
    lines.push(`Total Profiles,${params.metrics.users.total_profiles}`);
    lines.push(`Active Platform Owners,${params.metrics.users.platform_admins_active}`);
    lines.push(`Total Appointments,${params.metrics.usage.total_appointments}`);
    lines.push(`Total Consultations,${params.metrics.usage.total_consultations}`);
    lines.push('');
  }

  lines.push('ORGANIZATION AGGREGATE USAGE');
  lines.push('Organization,Slug,Status,Country,Branches,Active Staff,Approved Clients,Pets,Appointments,Consultations');
  for (const org of params.organizations) {
    lines.push(
      [
        org.display_name,
        org.slug,
        org.status,
        org.country,
        org.branch_count,
        org.active_staff_count,
        org.approved_client_count,
        org.pet_count,
        org.appointment_count,
        org.consultation_count,
      ]
        .map(escapeCsvCell)
        .join(',')
    );
  }
  lines.push('');

  lines.push('GOVERNANCE AUDIT LOGS');
  lines.push('Timestamp,Action,Organization,Actor,Entity Type,Entity ID,Details');
  for (const log of params.auditLogs) {
    lines.push(
      [
        log.created_at,
        log.action,
        log.organization_name || 'Platform',
        log.actor_email || log.actor_name,
        log.entity_type,
        log.entity_id || '',
        log.details || '',
      ]
        .map(escapeCsvCell)
        .join(',')
    );
  }

  return lines.join('\n');
}
