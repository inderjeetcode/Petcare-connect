import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { onboardingService } from '../services/onboardingService';
import { DoctorGovernanceRecord, OrgRoleCode } from '../types/auth';

export interface ActiveDoctorWorkspace {
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
  userId: string;
  profileName: string;
  profileEmail: string;
  profilePhone: string | null;
  roles: OrgRoleCode[];
  permissions: string[];
  membershipBranchIds: string[];
  doctorProfileId: string | null;
  doctorRecord: DoctorGovernanceRecord | null;
  assignedBranchIds: string[];
}

export function useDoctorWorkspace(): {
  workspace: ActiveDoctorWorkspace | null;
  doctorBasePath: string;
  doctorLoading: boolean;
  reloadDoctorProfile: () => Promise<void>;
} {
  const { orgSlug } = useParams<{ orgSlug?: string }>();
  const { user, profile, activeWorkspace, memberships } = useAuth();
  const [doctorRecord, setDoctorRecord] = useState<DoctorGovernanceRecord | null>(null);
  const [doctorLoading, setDoctorLoading] = useState<boolean>(true);

  const matchedMembership = useMemo(() => {
    const slug = (orgSlug || activeWorkspace?.organization_slug || '').toLowerCase();
    return memberships.find(
      (m) =>
        m.membership_status === 'active' &&
        m.organization_status === 'active' &&
        m.roles.includes('doctor') &&
        (slug
          ? m.organization_slug.toLowerCase() === slug
          : m.organization_id === activeWorkspace?.organization_id)
    );
  }, [orgSlug, activeWorkspace, memberships]);

  const loadDoctor = useCallback(async () => {
    if (!user?.id || !matchedMembership?.organization_id) {
      setDoctorRecord(null);
      setDoctorLoading(false);
      return;
    }
    setDoctorLoading(true);
    try {
      const record = await onboardingService.getMyDoctorProfile(
        matchedMembership.organization_id,
        user.id
      );
      setDoctorRecord(record);
    } catch {
      setDoctorRecord(null);
    } finally {
      setDoctorLoading(false);
    }
  }, [user?.id, matchedMembership?.organization_id]);

  useEffect(() => {
    void loadDoctor();
  }, [loadDoctor]);

  const doctorBasePath = useMemo(() => {
    const slug =
      matchedMembership?.organization_slug ||
      orgSlug ||
      activeWorkspace?.organization_slug ||
      '';
    return slug ? `/${slug}/doctor` : '/workspaces';
  }, [matchedMembership?.organization_slug, orgSlug, activeWorkspace?.organization_slug]);

  const workspace = useMemo<ActiveDoctorWorkspace | null>(() => {
    if (!user || !matchedMembership) return null;
    return {
      organizationId: matchedMembership.organization_id,
      organizationSlug: matchedMembership.organization_slug,
      organizationName: matchedMembership.organization_name,
      userId: user.id,
      profileName: profile?.full_name || doctorRecord?.display_name || user.email || 'Veterinary Doctor',
      profileEmail: profile?.email || user.email || '',
      profilePhone: profile?.phone || null,
      roles: matchedMembership.roles,
      permissions: matchedMembership.permissions,
      membershipBranchIds: matchedMembership.branch_ids,
      doctorProfileId: doctorRecord?.id || null,
      doctorRecord,
      assignedBranchIds: doctorRecord?.branch_ids || [],
    };
  }, [user, matchedMembership, profile, doctorRecord]);

  return {
    workspace,
    doctorBasePath,
    doctorLoading,
    reloadDoctorProfile: loadDoctor,
  };
}
