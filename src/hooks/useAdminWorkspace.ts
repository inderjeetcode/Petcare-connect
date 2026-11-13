import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { OrgRoleCode } from '../types/auth';

export interface ActiveAdminWorkspace {
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
  userId: string;
  userName: string;
  userEmail: string;
  roles: OrgRoleCode[];
  permissions: string[];
  membershipBranchIds: string[];
  isBranchScoped: boolean;
  canManageOrg: boolean;
  canManageBranches: boolean;
  canManageStaff: boolean;
  canAssignAdmin: boolean;
  canApproveClients: boolean;
  canReadClients: boolean;
  canReadPets: boolean;
  canWritePets: boolean;
  canManageSchedules: boolean;
  canReadAppointments: boolean;
  canConfirmAppointments: boolean;
  canActivateConsultations: boolean;
  canManageConsultations: boolean;
  canReadAudit: boolean;
  canReadMedicalRecords: boolean;
}

const ADMIN_PORTAL_ROLES: OrgRoleCode[] = [
  'org_owner',
  'org_admin',
  'branch_manager',
  'front_desk',
];

export function useAdminWorkspace(): {
  workspace: ActiveAdminWorkspace | null;
  adminBasePath: string;
} {
  const { orgSlug } = useParams<{ orgSlug?: string }>();
  const { user, profile, activeWorkspace, memberships } = useAuth();

  const matchedMembership = useMemo(() => {
    const slug = (orgSlug || activeWorkspace?.organization_slug || '').toLowerCase();
    return memberships.find(
      (m) =>
        m.membership_status === 'active' &&
        m.organization_status === 'active' &&
        m.roles.some((r) => ADMIN_PORTAL_ROLES.includes(r)) &&
        (slug
          ? m.organization_slug.toLowerCase() === slug
          : m.organization_id === activeWorkspace?.organization_id)
    );
  }, [orgSlug, activeWorkspace, memberships]);

  const adminBasePath = useMemo(() => {
    const slug =
      matchedMembership?.organization_slug ||
      orgSlug ||
      activeWorkspace?.organization_slug ||
      '';
    return slug ? `/${slug}/admin` : '/workspaces';
  }, [matchedMembership?.organization_slug, orgSlug, activeWorkspace?.organization_slug]);

  const workspace = useMemo<ActiveAdminWorkspace | null>(() => {
    if (!user || !matchedMembership) return null;
    const perms = new Set(matchedMembership.permissions);
    const branchIds = matchedMembership.branch_ids || [];

    return {
      organizationId: matchedMembership.organization_id,
      organizationSlug: matchedMembership.organization_slug,
      organizationName: matchedMembership.organization_name,
      userId: user.id,
      userName: profile?.full_name || user.email || 'Clinic Administrator',
      userEmail: profile?.email || user.email || '',
      roles: matchedMembership.roles,
      permissions: matchedMembership.permissions,
      membershipBranchIds: branchIds,
      isBranchScoped: branchIds.length > 0,
      canManageOrg: perms.has('org.manage'),
      canManageBranches: perms.has('branch.manage'),
      canManageStaff: perms.has('staff.manage'),
      canAssignAdmin: perms.has('roles.assign_admin'),
      canApproveClients: perms.has('clients.approve'),
      canReadClients: perms.has('clients.read'),
      canReadPets: perms.has('pets.read'),
      canWritePets: perms.has('pets.write'),
      canManageSchedules: perms.has('schedules.manage'),
      canReadAppointments: perms.has('appointments.read'),
      canConfirmAppointments: perms.has('appointments.confirm'),
      canActivateConsultations: perms.has('consultations.activate'),
      canManageConsultations: perms.has('consultations.manage'),
      canReadAudit: perms.has('audit.read'),
      canReadMedicalRecords: perms.has('medical_records.read'),
    };
  }, [user, matchedMembership, profile]);

  return {
    workspace,
    adminBasePath,
  };
}
