import { Organization, OrganizationApplication, OrganizationStatus } from './auth';

export type PlatformAccountStatus = 'active' | 'suspended';

export type PlatformSupportScope =
  | 'org_diagnostics'
  | 'billing_audit'
  | 'schedule_support';

export type PlatformSupportGrantStatus =
  | 'requested'
  | 'approved'
  | 'rejected'
  | 'revoked'
  | 'expired';

export interface PlatformOverviewMetrics {
  generated_at: string;
  organizations: {
    total: number;
    active: number;
    pending: number;
    suspended: number;
    closed: number;
  };
  applications: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    withdrawn: number;
  };
  users: {
    total_profiles: number;
    active_profiles: number;
    suspended_profiles: number;
    platform_admins_active: number;
    total_org_memberships: number;
    active_org_memberships: number;
    total_clinic_clients: number;
    approved_clinic_clients: number;
  };
  usage: {
    total_branches: number;
    active_branches: number;
    total_doctors: number;
    active_doctors: number;
    total_pets: number;
    total_appointments: number;
    confirmed_appointments: number;
    completed_appointments: number;
    total_consultations: number;
    active_consultations: number;
    completed_consultations: number;
    expired_consultations: number;
    total_prescriptions: number;
    total_medical_records: number;
    total_vaccinations: number;
    total_payments: number;
    paid_payments_count: number;
  };
  security: {
    pending_support_grants: number;
    active_support_grants: number;
    recent_audit_events_24h: number;
    suspended_orgs_count: number;
    suspended_users_count: number;
  };
}

export interface PlatformOrganizationOverview extends Organization {
  plan_code?: string | null;
  branch_count: number;
  active_branch_count: number;
  active_staff_count: number;
  active_doctor_count: number;
  approved_client_count: number;
  pending_client_count: number;
  pet_count: number;
  appointment_count: number;
  consultation_count: number;
  active_consultation_count: number;
}

export interface PlatformOrganizationBranchSummary {
  id: string;
  name: string;
  code: string;
  city: string | null;
  state: string | null;
  country: string | null;
  timezone: string;
  is_active: boolean;
  created_at: string;
}

export interface PlatformOrganizationDetails {
  organization: Organization & { plan_code?: string | null };
  branches: PlatformOrganizationBranchSummary[];
  role_counts: Record<string, number>;
  metrics: {
    active_staff: number;
    suspended_staff: number;
    approved_clients: number;
    pending_clients: number;
    active_doctors: number;
    pets: number;
    appointments_total: number;
    appointments_confirmed: number;
    consultations_total: number;
    consultations_active: number;
    prescriptions_total: number;
    medical_records_total: number;
    vaccinations_total: number;
  };
  application: OrganizationApplication | null;
}

export interface PlatformUserRecord {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  platform_status: PlatformAccountStatus;
  platform_suspended_at: string | null;
  platform_suspension_reason: string | null;
  created_at: string;
  updated_at: string;
  has_platform_admin_record: boolean;
  is_platform_admin: boolean;
  platform_admin_granted_at: string | null;
  platform_admin_granted_by: string | null;
  platform_admin_notes: string | null;
  active_staff_org_count: number;
  approved_client_org_count: number;
}

export interface PlatformAuditLogRecord {
  id: string;
  organization_id: string | null;
  organization_name: string | null;
  actor_user_id: string | null;
  actor_name: string;
  actor_email: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: string | null;
  before_json: Record<string, unknown> | null;
  after_json: Record<string, unknown> | null;
  created_at: string;
}

export interface PlatformSettings {
  id: string;
  platform_name: string;
  require_manual_org_approval: boolean;
  allow_self_service_org_applications: boolean;
  default_consultation_window_days: number;
  max_support_access_minutes: number;
  maintenance_mode: boolean;
  security_notice: string | null;
  allowed_countries: string[];
  updated_by: string | null;
  updated_at: string;
}

export interface PlatformSupportGrant {
  id: string;
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  platform_admin_user_id: string;
  platform_admin_email: string | null;
  approved_by: string | null;
  approved_by_email: string | null;
  scope: PlatformSupportScope;
  reason: string;
  decision_reason: string | null;
  status: PlatformSupportGrantStatus;
  duration_minutes: number;
  approved_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface PlatformSupportSnapshot {
  grant_id: string;
  scope: PlatformSupportScope;
  expires_at: string;
  organization: {
    id: string;
    slug: string;
    display_name: string;
    status: OrganizationStatus;
    operational_settings: Record<string, unknown>;
  };
  branches_summary: Array<{
    id: string;
    name: string;
    code: string;
    is_active: boolean;
    timezone: string;
  }>;
  appointment_status_counts: Record<string, number>;
  consultation_status_counts: Record<string, number>;
  payment_status_counts: Record<string, number>;
  clinical_privacy_notice: string;
}
