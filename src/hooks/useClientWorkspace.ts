import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export interface ActiveClientWorkspace {
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
  clinicClientId: string;
  userId: string;
  profileName: string;
  profileEmail: string;
}

export function useClientWorkspace(): {
  workspace: ActiveClientWorkspace | null;
  clientBasePath: string;
} {
  const { orgSlug } = useParams<{ orgSlug?: string }>();
  const { user, profile, activeWorkspace, clinicClients } = useAuth();

  return useMemo(() => {
    const slug = (orgSlug || activeWorkspace?.organization_slug || '').toLowerCase();

    const matchedClinicClient = clinicClients.find(
      (cc) =>
        cc.client_status === 'approved' &&
        cc.organization_status === 'active' &&
        (slug
          ? cc.organization_slug.toLowerCase() === slug
          : cc.organization_id === activeWorkspace?.organization_id)
    );

    if (!user || !matchedClinicClient) {
      return {
        workspace: null,
        clientBasePath: slug ? `/${slug}/client` : '/workspaces',
      };
    }

    return {
      workspace: {
        organizationId: matchedClinicClient.organization_id,
        organizationSlug: matchedClinicClient.organization_slug,
        organizationName: matchedClinicClient.organization_name,
        clinicClientId: matchedClinicClient.clinic_client_id,
        userId: user.id,
        profileName: profile?.full_name || user.email || 'Pet Owner',
        profileEmail: profile?.email || user.email || '',
      },
      clientBasePath: `/${matchedClinicClient.organization_slug}/client`,
    };
  }, [orgSlug, activeWorkspace, clinicClients, user, profile]);
}
