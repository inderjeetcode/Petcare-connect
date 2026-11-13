import { isSupabaseConfigured, supabase } from '../config/supabaseClient';
import { Organization, OrganizationApplication } from '../types/auth';
import {
  PlatformAuditLogRecord,
  PlatformOrganizationDetails,
  PlatformOrganizationOverview,
  PlatformOverviewMetrics,
  PlatformSettings,
  PlatformSupportGrant,
  PlatformSupportScope,
  PlatformSupportSnapshot,
  PlatformUserRecord,
} from '../types/platform';
import { onboardingService } from './onboardingService';

function getClient() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error(
      'Supabase client is not configured. Please provide VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
    );
  }
  return supabase;
}

export const platformPortalService = {
  // ---------------------------------------------------------------------------
  // PLATFORM OVERVIEW & AGGREGATE ANALYTICS (PRIVACY-PRESERVING)
  // ---------------------------------------------------------------------------

  async getOverviewMetrics(): Promise<PlatformOverviewMetrics> {
    const client = getClient();
    const { data, error } = await client.rpc('platform_get_overview_metrics');
    if (error) throw error;
    return data as PlatformOverviewMetrics;
  },

  async listOrganizationsOverview(): Promise<PlatformOrganizationOverview[]> {
    const client = getClient();
    const { data, error } = await client.rpc('platform_list_organizations_overview');
    if (error) throw error;
    return (Array.isArray(data) ? data : []) as PlatformOrganizationOverview[];
  },

  async getOrganizationDetails(
    organizationId: string
  ): Promise<PlatformOrganizationDetails> {
    const client = getClient();
    const { data, error } = await client.rpc('platform_get_organization_details', {
      p_organization_id: organizationId,
    });
    if (error) throw error;
    return data as PlatformOrganizationDetails;
  },

  // ---------------------------------------------------------------------------
  // ORGANIZATION APPLICATIONS & LIFECYCLE GOVERNANCE
  // ---------------------------------------------------------------------------

  async listApplications(): Promise<OrganizationApplication[]> {
    return onboardingService.getAllOrganizationApplications();
  },

  async approveApplication(applicationId: string): Promise<string> {
    return onboardingService.approveOrganizationApplication(applicationId);
  },

  async rejectApplication(applicationId: string, reason: string): Promise<void> {
    return onboardingService.rejectOrganizationApplication(applicationId, reason);
  },

  async activateOrganization(organizationId: string): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('platform_activate_organization', {
      p_organization_id: organizationId,
    });
    if (error) throw error;
  },

  async suspendOrganization(organizationId: string, reason: string): Promise<void> {
    return onboardingService.suspendOrganization(organizationId, reason);
  },

  async reactivateOrganization(organizationId: string): Promise<void> {
    return onboardingService.reactivateOrganization(organizationId);
  },

  async updateOrganizationMetadata(params: {
    organization_id: string;
    display_name?: string;
    legal_name?: string;
    timezone?: string;
    country?: string;
    contact_email?: string | null;
    phone?: string | null;
    plan_code?: string | null;
  }): Promise<Organization> {
    const client = getClient();
    const { data, error } = await client.rpc('platform_update_organization_metadata', {
      p_organization_id: params.organization_id,
      p_display_name: params.display_name ?? null,
      p_legal_name: params.legal_name ?? null,
      p_timezone: params.timezone ?? null,
      p_country: params.country ?? null,
      p_contact_email: params.contact_email ?? null,
      p_phone: params.phone ?? null,
      p_plan_code: params.plan_code ?? null,
    });
    if (error) throw error;
    return data as Organization;
  },

  // ---------------------------------------------------------------------------
  // PLATFORM USER ADMINISTRATION & ROLE GOVERNANCE
  // ---------------------------------------------------------------------------

  async listUsers(params?: {
    search?: string;
    filter?: 'all' | 'platform_admins' | 'active' | 'suspended';
    limit?: number;
    offset?: number;
  }): Promise<{ total: number; users: PlatformUserRecord[] }> {
    const client = getClient();
    const { data, error } = await client.rpc('platform_list_users', {
      p_search: params?.search ?? null,
      p_filter: params?.filter ?? 'all',
      p_limit: params?.limit ?? 100,
      p_offset: params?.offset ?? 0,
    });
    if (error) throw error;
    const payload = (data || {}) as { total?: number; users?: PlatformUserRecord[] };
    return {
      total: Number(payload.total || 0),
      users: Array.isArray(payload.users) ? payload.users : [],
    };
  },

  async grantPlatformAdmin(targetUserId: string, notes?: string): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('platform_grant_platform_admin', {
      p_target_user_id: targetUserId,
      p_notes: notes?.trim() || null,
    });
    if (error) throw error;
  },

  async revokePlatformAdmin(targetUserId: string, reason: string): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('platform_revoke_platform_admin', {
      p_target_user_id: targetUserId,
      p_reason: reason.trim(),
    });
    if (error) throw error;
  },

  async suspendUser(targetUserId: string, reason: string): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('platform_suspend_user', {
      p_target_user_id: targetUserId,
      p_reason: reason.trim(),
    });
    if (error) throw error;
  },

  async reactivateUser(targetUserId: string): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('platform_reactivate_user', {
      p_target_user_id: targetUserId,
    });
    if (error) throw error;
  },

  // ---------------------------------------------------------------------------
  // GOVERNANCE AUDIT LOGS & PLATFORM SETTINGS
  // ---------------------------------------------------------------------------

  async listAuditLogs(params?: {
    search?: string;
    action?: string;
    limit?: number;
  }): Promise<PlatformAuditLogRecord[]> {
    const client = getClient();
    const { data, error } = await client.rpc('platform_list_audit_logs', {
      p_search: params?.search ?? null,
      p_action: params?.action ?? null,
      p_limit: params?.limit ?? 150,
    });
    if (error) throw error;
    return (Array.isArray(data) ? data : []) as PlatformAuditLogRecord[];
  },

  async getSettings(): Promise<PlatformSettings> {
    const client = getClient();
    const { data, error } = await client.rpc('platform_get_settings');
    if (error) throw error;
    return data as PlatformSettings;
  },

  async updateSettings(params: {
    platform_name: string;
    require_manual_org_approval: boolean;
    allow_self_service_org_applications: boolean;
    default_consultation_window_days: number;
    max_support_access_minutes: number;
    maintenance_mode: boolean;
    security_notice?: string | null;
    allowed_countries?: string[];
  }): Promise<PlatformSettings> {
    const client = getClient();
    const { data, error } = await client.rpc('platform_update_settings', {
      p_platform_name: params.platform_name.trim(),
      p_require_manual_org_approval: params.require_manual_org_approval,
      p_allow_self_service_org_applications: params.allow_self_service_org_applications,
      p_default_consultation_window_days: params.default_consultation_window_days,
      p_max_support_access_minutes: params.max_support_access_minutes,
      p_maintenance_mode: params.maintenance_mode,
      p_security_notice: params.security_notice ?? null,
      p_allowed_countries: params.allowed_countries ?? null,
    });
    if (error) throw error;
    return data as PlatformSettings;
  },

  // ---------------------------------------------------------------------------
  // TIME-LIMITED EXPLICIT SUPPORT ACCESS GRANTS (NON-CLINICAL / AUDITED)
  // ---------------------------------------------------------------------------

  async listSupportGrants(organizationId?: string): Promise<PlatformSupportGrant[]> {
    const client = getClient();
    const { data, error } = await client.rpc('platform_list_support_grants', {
      p_organization_id: organizationId ?? null,
    });
    if (error) throw error;
    return (Array.isArray(data) ? data : []) as PlatformSupportGrant[];
  },

  async requestSupportAccess(params: {
    organization_id: string;
    scope: PlatformSupportScope;
    reason: string;
    duration_minutes: number;
  }): Promise<string> {
    const client = getClient();
    const { data, error } = await client.rpc('platform_request_support_access', {
      p_organization_id: params.organization_id,
      p_scope: params.scope,
      p_reason: params.reason.trim(),
      p_duration_minutes: params.duration_minutes,
    });
    if (error) throw error;
    return String(data);
  },

  async revokeSupportGrant(grantId: string, reason?: string): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('revoke_platform_support_access', {
      p_grant_id: grantId,
      p_reason: reason?.trim() || null,
    });
    if (error) throw error;
  },

  async getScopedSupportSnapshot(
    grantId: string
  ): Promise<PlatformSupportSnapshot> {
    const client = getClient();
    const { data, error } = await client.rpc('platform_get_scoped_support_snapshot', {
      p_grant_id: grantId,
    });
    if (error) throw error;
    return data as PlatformSupportSnapshot;
  },

  // ---------------------------------------------------------------------------
  // PLATFORM OWNER NOTIFICATIONS
  // ---------------------------------------------------------------------------

  async getNotifications(userId: string) {
    const client = getClient();
    const { data, error } = await client
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(150);
    if (error) throw error;
    return data || [];
  },

  async setNotificationReadStatus(
    notificationId: string,
    userId: string,
    isRead: boolean
  ): Promise<void> {
    const client = getClient();
    const { error } = await client
      .from('notifications')
      .update({ is_read: isRead })
      .eq('id', notificationId)
      .eq('user_id', userId);
    if (error) throw error;
  },

  async markAllNotificationsRead(userId: string): Promise<void> {
    const client = getClient();
    const { error } = await client
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false);
    if (error) throw error;
  },
};
