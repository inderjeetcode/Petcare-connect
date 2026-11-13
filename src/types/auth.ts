export type OrgRoleCode =
  | 'org_owner'
  | 'org_admin'
  | 'branch_manager'
  | 'doctor'
  | 'front_desk';

export type OrganizationStatus = 'pending' | 'active' | 'suspended' | 'closed';

export type OrganizationApplicationStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'withdrawn';

export type MembershipStatus = 'invited' | 'active' | 'suspended' | 'left';

export type ClinicClientStatus =
  | 'requested'
  | 'approved'
  | 'rejected'
  | 'suspended';

export type PortalKind = 'client' | 'doctor' | 'admin' | 'platform';

export type AuthStatus =
  | 'loading'
  | 'authenticated'
  | 'unauthenticated'
  | 'recovery'
  | 'session_expired';

export interface AuthProfileSummary {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  avatar_url: string | null;
  platform_status?: 'active' | 'suspended';
}

export interface MyMembership {
  membership_id: string;
  organization_id: string;
  organization_slug: string;
  organization_name: string;
  organization_status: OrganizationStatus;
  membership_status: MembershipStatus;
  roles: OrgRoleCode[];
  permissions: string[];
  branch_ids: string[];
}

export interface MyClinicClient {
  clinic_client_id: string;
  organization_id: string;
  organization_slug: string;
  organization_name: string;
  organization_status: OrganizationStatus;
  client_status: ClinicClientStatus;
  requested_at: string;
  approved_at: string | null;
}

export interface MyContextResponse {
  user_id: string;
  profile: AuthProfileSummary;
  is_platform_admin: boolean;
  memberships: MyMembership[];
  clinic_clients: MyClinicClient[];
}

export interface WorkspaceOption {
  key: string;
  portal: PortalKind;
  organization_id: string | null;
  organization_slug: string | null;
  organization_name: string;
  label: string;
  sublabel: string;
  default_path: string;
  roles: OrgRoleCode[];
  permissions: string[];
  branch_ids: string[];
  clinic_client_id?: string;
}

export interface OrganizationOperationalSettings {
  default_slot_minutes?: number;
  advance_booking_days?: number;
  cancellation_notice_hours?: number;
  allow_walk_in_appointments?: boolean;
  require_triage_reason?: boolean;
}

export interface Organization {
  id: string;
  slug: string;
  legal_name: string;
  display_name: string;
  status: OrganizationStatus;
  timezone: string;
  country: string;
  contact_email: string | null;
  phone: string | null;
  operational_settings?: OrganizationOperationalSettings;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrganizationApplication {
  id: string;
  applicant_user_id: string;
  proposed_name: string;
  proposed_slug: string;
  legal_name: string;
  contact_email: string;
  phone: string;
  country: string;
  timezone: string;
  initial_branch_name: string;
  initial_branch_code: string;
  initial_branch_address: string;
  documents: Array<{ name?: string; url?: string; type?: string }>;
  status: OrganizationApplicationStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  decision_reason: string | null;
  organization_id: string | null;
  created_at: string;
  updated_at: string;
  applicant_name?: string;
  applicant_email?: string;
}

export interface BranchOperationalSettings {
  operating_hours?: string;
  walk_in_enabled?: boolean;
  check_in_grace_minutes?: number;
  reception_note?: string;
}

export interface Branch {
  id: string;
  organization_id: string;
  name: string;
  code: string;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  timezone: string;
  phone: string | null;
  is_active: boolean;
  settings?: BranchOperationalSettings;
  created_at: string;
  updated_at: string;
}

export interface ClinicClientRecord {
  id: string;
  organization_id: string;
  user_id: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  status: ClinicClientStatus;
  requested_at: string;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface OrganizationMemberView {
  membership_id: string;
  organization_id: string;
  user_id: string;
  status: MembershipStatus;
  joined_at: string | null;
  suspended_at: string | null;
  suspension_reason: string | null;
  full_name: string;
  email: string;
  phone: string | null;
  roles: OrgRoleCode[];
  branch_ids: string[];
}

export interface StaffInvitationRecord {
  id: string;
  organization_id: string;
  email: string;
  role_codes: OrgRoleCode[];
  branch_ids: string[];
  invited_by: string;
  expires_at: string;
  accepted_at: string | null;
  accepted_by: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface DoctorGovernanceRecord {
  id: string;
  organization_id: string;
  user_id: string;
  display_name: string | null;
  qualification: string;
  specialization: string;
  experience_years: number;
  consultation_fee: number;
  bio: string;
  registration_number: string | null;
  is_active: boolean;
  full_name?: string;
  email?: string;
  phone?: string | null;
  branch_ids: string[];
}
