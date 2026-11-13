import { supabase, isSupabaseConfigured } from '../config/supabaseClient';
import {
  Branch,
  ClinicClientRecord,
  DoctorGovernanceRecord,
  Organization,
  OrganizationApplication,
  OrganizationMemberView,
  OrgRoleCode,
  StaffInvitationRecord,
} from '../types/auth';

function getClient() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error(
      'Supabase client is not configured. Please provide VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
    );
  }
  return supabase;
}

export interface SubmitOrgApplicationInput {
  proposed_name: string;
  proposed_slug: string;
  legal_name: string;
  contact_email: string;
  phone: string;
  country: string;
  timezone: string;
  branch_name: string;
  branch_code: string;
  branch_address: string;
  documents?: Array<{ name: string; url?: string; type?: string }>;
}

export const onboardingService = {
  // ---------------------------------------------------------------------------
  // ORGANIZATION REGISTRATION & PLATFORM OWNER GOVERNANCE
  // ---------------------------------------------------------------------------

  async getMyOrganizationApplications(): Promise<OrganizationApplication[]> {
    const client = getClient();
    const { data, error } = await client
      .from('organization_applications')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []) as OrganizationApplication[];
  },

  async getAllOrganizationApplications(): Promise<OrganizationApplication[]> {
    const client = getClient();
    const { data, error } = await client
      .from('organization_applications')
      .select('*, applicant:profiles!organization_applications_applicant_user_id_fkey(full_name, email)')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []).map((row: any) => ({
      ...row,
      applicant_name: row.applicant?.full_name || 'Applicant',
      applicant_email: row.applicant?.email || row.contact_email,
    })) as OrganizationApplication[];
  },

  async submitOrganizationApplication(
    input: SubmitOrgApplicationInput
  ): Promise<string> {
    const client = getClient();
    const { data, error } = await client.rpc('submit_organization_application', {
      p_proposed_name: input.proposed_name,
      p_proposed_slug: input.proposed_slug,
      p_legal_name: input.legal_name,
      p_contact_email: input.contact_email,
      p_phone: input.phone,
      p_country: input.country,
      p_timezone: input.timezone,
      p_branch_name: input.branch_name,
      p_branch_code: input.branch_code,
      p_branch_address: input.branch_address,
      p_documents: input.documents || [],
    });

    if (error) throw error;
    return String(data);
  },

  async approveOrganizationApplication(applicationId: string): Promise<string> {
    const client = getClient();
    const { data, error } = await client.rpc('approve_organization_application', {
      p_application_id: applicationId,
    });
    if (error) throw error;
    return String(data);
  },

  async rejectOrganizationApplication(
    applicationId: string,
    reason: string
  ): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('reject_organization_application', {
      p_application_id: applicationId,
      p_reason: reason,
    });
    if (error) throw error;
  },

  async listAllOrganizations(): Promise<Organization[]> {
    const client = getClient();
    const { data, error } = await client
      .from('organizations')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []) as Organization[];
  },

  async suspendOrganization(
    organizationId: string,
    reason: string
  ): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('suspend_organization', {
      p_organization_id: organizationId,
      p_reason: reason,
    });
    if (error) throw error;
  },

  async reactivateOrganization(organizationId: string): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('reactivate_organization', {
      p_organization_id: organizationId,
    });
    if (error) throw error;
  },

  // ---------------------------------------------------------------------------
  // CLIENT DISCOVERY & CLINIC JOIN ONBOARDING
  // ---------------------------------------------------------------------------

  async listActiveOrganizationsForDiscovery(): Promise<Organization[]> {
    const client = getClient();
    const { data, error } = await client
      .from('organizations')
      .select('id, slug, legal_name, display_name, status, timezone, country, contact_email, phone, created_by, approved_by, approved_at, created_at, updated_at')
      .eq('status', 'active')
      .order('display_name', { ascending: true });
    if (error) throw error;
    return (data || []) as Organization[];
  },

  async requestClinicJoin(organizationId: string): Promise<string> {
    const client = getClient();
    const { data, error } = await client.rpc('request_clinic_join', {
      p_organization_id: organizationId,
    });
    if (error) throw error;
    return String(data);
  },

  async getOrgClinicClients(organizationId: string): Promise<ClinicClientRecord[]> {
    const client = getClient();
    const { data, error } = await client
      .from('clinic_clients')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []) as ClinicClientRecord[];
  },

  async approveClinicClient(clinicClientId: string): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('approve_clinic_client', {
      p_clinic_client_id: clinicClientId,
    });
    if (error) throw error;
  },

  async rejectClinicClient(
    clinicClientId: string,
    reason: string
  ): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('reject_clinic_client', {
      p_clinic_client_id: clinicClientId,
      p_reason: reason,
    });
    if (error) throw error;
  },

  async createWalkInClient(
    organizationId: string,
    fullName: string,
    phone: string,
    email?: string
  ): Promise<string> {
    const client = getClient();
    const { data, error } = await client.rpc('create_walk_in_client', {
      p_organization_id: organizationId,
      p_full_name: fullName,
      p_phone: phone,
      p_email: email || null,
    });
    if (error) throw error;
    return String(data);
  },

  // ---------------------------------------------------------------------------
  // BRANCHES, STAFF INVITATIONS, ROLES & DOCTORS
  // ---------------------------------------------------------------------------

  async getOrgBranches(organizationId: string): Promise<Branch[]> {
    const client = getClient();
    const { data, error } = await client
      .from('branches')
      .select('*')
      .eq('organization_id', organizationId)
      .order('name', { ascending: true });
    if (error) throw error;
    return (data || []) as Branch[];
  },

  async createOrUpdateBranch(params: {
    organization_id: string;
    branch_id?: string | null;
    name: string;
    code: string;
    timezone: string;
    address?: string;
    phone?: string;
    is_active?: boolean;
  }): Promise<string> {
    const client = getClient();
    const { data, error } = await client.rpc('create_or_update_branch', {
      p_organization_id: params.organization_id,
      p_branch_id: params.branch_id || null,
      p_name: params.name,
      p_code: params.code,
      p_timezone: params.timezone || 'UTC',
      p_address: params.address || null,
      p_phone: params.phone || null,
      p_is_active: params.is_active ?? true,
    });
    if (error) throw error;
    return String(data);
  },

  async getOrgMembers(organizationId: string): Promise<OrganizationMemberView[]> {
    const client = getClient();
    const { data: memberships, error: memErr } = await client
      .from('organization_memberships')
      .select(`
        id,
        organization_id,
        user_id,
        status,
        joined_at,
        suspended_at,
        suspension_reason,
        profile:profiles!organization_memberships_user_id_fkey(full_name, email, phone),
        membership_roles(role:organization_roles(code)),
        membership_branches(branch_id)
      `)
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: true });

    if (memErr) throw memErr;

    return (memberships || []).map((row: any) => ({
      membership_id: row.id,
      organization_id: row.organization_id,
      user_id: row.user_id,
      status: row.status,
      joined_at: row.joined_at,
      suspended_at: row.suspended_at,
      suspension_reason: row.suspension_reason,
      full_name: row.profile?.full_name || 'Staff Member',
      email: row.profile?.email || '',
      phone: row.profile?.phone || null,
      roles: (row.membership_roles || [])
        .map((mr: any) => mr.role?.code)
        .filter(Boolean) as OrgRoleCode[],
      branch_ids: (row.membership_branches || [])
        .map((mb: any) => mb.branch_id)
        .filter(Boolean) as string[],
    }));
  },

  async getOrgInvitations(
    organizationId: string
  ): Promise<StaffInvitationRecord[]> {
    const client = getClient();
    const { data, error } = await client
      .from('staff_invitations')
      .select(
        'id, organization_id, email, role_codes, branch_ids, invited_by, expires_at, accepted_at, accepted_by, revoked_at, created_at'
      )
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []) as StaffInvitationRecord[];
  },

  async inviteMember(params: {
    organization_id: string;
    email: string;
    role_codes: OrgRoleCode[];
    branch_ids?: string[];
  }): Promise<{ invitation_id: string; token: string; expires_at: string }> {
    const client = getClient();
    const { data, error } = await client.rpc('invite_member', {
      p_organization_id: params.organization_id,
      p_email: params.email,
      p_role_codes: params.role_codes,
      p_branch_ids: params.branch_ids || [],
    });
    if (error) throw error;
    return data as { invitation_id: string; token: string; expires_at: string };
  },

  async acceptInvitation(token: string): Promise<string> {
    const client = getClient();
    const { data, error } = await client.rpc('accept_invitation', {
      p_token: token.trim(),
    });
    if (error) throw error;
    return String(data);
  },

  async setMemberRoles(
    membershipId: string,
    roleCodes: OrgRoleCode[],
    branchIds: string[] = []
  ): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('set_member_roles', {
      p_membership_id: membershipId,
      p_role_codes: roleCodes,
      p_branch_ids: branchIds,
    });
    if (error) throw error;
  },

  async suspendMember(membershipId: string, reason: string): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('suspend_member', {
      p_membership_id: membershipId,
      p_reason: reason,
    });
    if (error) throw error;
  },

  async getOrgDoctors(
    organizationId: string
  ): Promise<DoctorGovernanceRecord[]> {
    const client = getClient();
    const { data, error } = await client
      .from('doctor_profiles')
      .select(`
        id,
        organization_id,
        user_id,
        display_name,
        qualification,
        specialization,
        experience_years,
        consultation_fee,
        bio,
        registration_number,
        is_active,
        profile:profiles!doctor_profiles_user_id_fkey(full_name, email, phone),
        doctor_branch_assignments(branch_id, is_active)
      `)
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data || []).map((row: any) => ({
      id: row.id,
      organization_id: row.organization_id,
      user_id: row.user_id,
      display_name: row.display_name,
      qualification: row.qualification || '',
      specialization: row.specialization || '',
      experience_years: Number(row.experience_years || 0),
      consultation_fee: Number(row.consultation_fee || 0),
      bio: row.bio || '',
      registration_number: row.registration_number || null,
      is_active: Boolean(row.is_active),
      full_name: row.display_name || row.profile?.full_name || 'Veterinary Doctor',
      email: row.profile?.email || '',
      phone: row.profile?.phone || null,
      branch_ids: (row.doctor_branch_assignments || [])
        .filter((b: any) => b.is_active)
        .map((b: any) => b.branch_id),
    }));
  },

  async getMyDoctorProfile(
    organizationId: string,
    userId: string
  ): Promise<DoctorGovernanceRecord | null> {
    const client = getClient();
    const { data, error } = await client
      .from('doctor_profiles')
      .select(`
        id,
        organization_id,
        user_id,
        display_name,
        qualification,
        specialization,
        experience_years,
        consultation_fee,
        bio,
        registration_number,
        is_active,
        doctor_branch_assignments(branch_id, is_active)
      `)
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;
    const row: any = data;
    return {
      id: row.id,
      organization_id: row.organization_id,
      user_id: row.user_id,
      display_name: row.display_name,
      qualification: row.qualification || '',
      specialization: row.specialization || '',
      experience_years: Number(row.experience_years || 0),
      consultation_fee: Number(row.consultation_fee || 0),
      bio: row.bio || '',
      registration_number: row.registration_number || null,
      is_active: Boolean(row.is_active),
      branch_ids: (row.doctor_branch_assignments || [])
        .filter((b: any) => b.is_active)
        .map((b: any) => b.branch_id),
    };
  },

  async assignDoctorToBranch(
    organizationId: string,
    doctorProfileId: string,
    branchId: string,
    isActive = true
  ): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('assign_doctor_to_branch', {
      p_organization_id: organizationId,
      p_doctor_profile_id: doctorProfileId,
      p_branch_id: branchId,
      p_is_active: isActive,
    });
    if (error) throw error;
  },

  async updateDoctorSelfProfile(params: {
    organization_id: string;
    bio?: string;
    qualification?: string;
    specialization?: string;
    experience_years?: number;
    registration_number?: string;
  }): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('update_doctor_self_profile', {
      p_organization_id: params.organization_id,
      p_bio: params.bio ?? null,
      p_qualification: params.qualification ?? null,
      p_specialization: params.specialization ?? null,
      p_experience_years: params.experience_years ?? null,
      p_registration_number: params.registration_number ?? null,
    });
    if (error) throw error;
  },

  async adminUpdateDoctorGovernance(params: {
    doctor_profile_id: string;
    is_active?: boolean;
    consultation_fee?: number;
    display_name?: string;
  }): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('admin_update_doctor_governance', {
      p_doctor_profile_id: params.doctor_profile_id,
      p_is_active: params.is_active ?? null,
      p_consultation_fee: params.consultation_fee ?? null,
      p_display_name: params.display_name ?? null,
    });
    if (error) throw error;
  },
};
