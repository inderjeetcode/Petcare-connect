-- ==============================================================================
-- PET CONNECT VETERINARY HEALTHCARE PLATFORM
-- Migration 11 (Phase 7): Platform Owner Portal Governance, Analytics & Isolation
-- File: supabase/migrations/20261113110000_phase7_platform_owner_portal.sql
-- ==============================================================================
-- SECURITY & ARCHITECTURE INVARIANTS:
-- 1. Strictly additive & hardened incremental migration for Phase 7.
-- 2. Platform Owner (public.platform_admins) remains strictly isolated from
--    private clinical tables (medical_records, prescriptions, vaccinations,
--    pets, chat_conversations, chat_messages, consultations.clinical_notes).
-- 3. Platform-wide statistics and organization-level overviews return strictly
--    privacy-preserving aggregate counts (zero PHI/clinical/chat rows).
-- 4. Platform role changes (grant/revoke platform_admin) & user governance
--    require explicit authorized actions, protect against self-lockout and
--    last-admin removal, and never auto-promote users.
-- 5. Organization ownership and memberships are never silently modified by
--    Platform Owner RPCs.
-- 6. Exceptional support access requires explicit Organization Owner approval
--    (org.manage), is time-limited, non-clinical/non-chat scoped, and audited.
-- ==============================================================================

-- 1. Platform User Governance Columns on public.profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS platform_status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (platform_status IN ('active', 'suspended')),
  ADD COLUMN IF NOT EXISTS platform_suspended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS platform_suspension_reason TEXT;

-- Harden tg_profiles_guard_identity so authenticated/anon callers cannot mutate platform_status
CREATE OR REPLACE FUNCTION public.tg_profiles_guard_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Forbidden: profiles.id is immutable' USING ERRCODE = '42501';
  END IF;

  IF current_user IN ('authenticated', 'anon') THEN
    IF NEW.email IS DISTINCT FROM OLD.email THEN
      RAISE EXCEPTION 'Forbidden: profiles.email cannot be edited directly' USING ERRCODE = '42501';
    END IF;
    IF NEW.platform_status IS DISTINCT FROM OLD.platform_status
       OR NEW.platform_suspended_at IS DISTINCT FROM OLD.platform_suspended_at
       OR NEW.platform_suspension_reason IS DISTINCT FROM OLD.platform_suspension_reason THEN
      RAISE EXCEPTION 'Forbidden: Platform account status requires authorized Platform Owner RPC'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  NEW.updated_at := timezone('utc'::text, now());
  RETURN NEW;
END;
$$;

-- Ensure app.is_platform_admin() also requires active platform_status on profiles
CREATE OR REPLACE FUNCTION app.is_platform_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.platform_admins pa
      JOIN public.profiles pr ON pr.id = pa.user_id
      WHERE pa.user_id = auth.uid()
        AND pa.is_active = true
        AND COALESCE(pr.platform_status, 'active') = 'active'
    )
  END;
$$;
REVOKE ALL ON FUNCTION app.is_platform_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.is_platform_admin() TO authenticated;

-- Update get_my_context() to expose profile.platform_status
CREATE OR REPLACE FUNCTION public.get_my_context()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_profile JSONB;
  v_is_platform_admin BOOLEAN := false;
  v_memberships JSONB;
  v_client_orgs JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT jsonb_build_object(
    'id', p.id,
    'full_name', p.full_name,
    'email', p.email,
    'phone', p.phone,
    'avatar_url', p.avatar_url,
    'platform_status', COALESCE(p.platform_status, 'active')
  ) INTO v_profile
  FROM public.profiles p
  WHERE p.id = v_uid;

  SELECT app.is_platform_admin() INTO v_is_platform_admin;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'membership_id', om.id,
      'organization_id', o.id,
      'organization_slug', o.slug,
      'organization_name', o.display_name,
      'organization_status', o.status,
      'membership_status', om.status,
      'roles', COALESCE((
        SELECT jsonb_agg(DISTINCT r.code ORDER BY r.code)
        FROM public.membership_roles mr
        JOIN public.organization_roles r ON r.id = mr.role_id
        WHERE mr.membership_id = om.id AND mr.organization_id = om.organization_id
      ), '[]'::jsonb),
      'permissions', COALESCE((
        SELECT jsonb_agg(DISTINCT rp.permission_code ORDER BY rp.permission_code)
        FROM public.membership_roles mr
        JOIN public.role_permissions rp ON rp.role_id = mr.role_id
        WHERE mr.membership_id = om.id AND mr.organization_id = om.organization_id
      ), '[]'::jsonb),
      'branch_ids', COALESCE((
        SELECT jsonb_agg(mb.branch_id)
        FROM public.membership_branches mb
        WHERE mb.membership_id = om.id AND mb.organization_id = om.organization_id
      ), '[]'::jsonb)
    )
    ORDER BY o.display_name
  ), '[]'::jsonb)
  INTO v_memberships
  FROM public.organization_memberships om
  JOIN public.organizations o ON o.id = om.organization_id
  WHERE om.user_id = v_uid;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'clinic_client_id', cc.id,
      'organization_id', o.id,
      'organization_slug', o.slug,
      'organization_name', o.display_name,
      'organization_status', o.status,
      'client_status', cc.status,
      'requested_at', cc.requested_at,
      'approved_at', cc.approved_at
    )
    ORDER BY o.display_name
  ), '[]'::jsonb)
  INTO v_client_orgs
  FROM public.clinic_clients cc
  JOIN public.organizations o ON o.id = cc.organization_id
  WHERE cc.user_id = v_uid;

  RETURN jsonb_build_object(
    'user_id', v_uid,
    'profile', COALESCE(v_profile, '{}'::jsonb),
    'is_platform_admin', v_is_platform_admin,
    'memberships', v_memberships,
    'clinic_clients', v_client_orgs
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_context() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_context() TO authenticated;

-- 2. Platform Settings Table (Singleton Governance Configuration)
CREATE TABLE IF NOT EXISTS public.platform_settings (
  id TEXT PRIMARY KEY DEFAULT 'default' CHECK (id = 'default'),
  platform_name VARCHAR(150) NOT NULL DEFAULT 'Pet Connect',
  require_manual_org_approval BOOLEAN NOT NULL DEFAULT true,
  allow_self_service_org_applications BOOLEAN NOT NULL DEFAULT true,
  default_consultation_window_days SMALLINT NOT NULL DEFAULT 7
    CHECK (default_consultation_window_days BETWEEN 1 AND 30),
  max_support_access_minutes SMALLINT NOT NULL DEFAULT 60
    CHECK (max_support_access_minutes BETWEEN 15 AND 480),
  maintenance_mode BOOLEAN NOT NULL DEFAULT false,
  security_notice TEXT,
  allowed_countries TEXT[] NOT NULL DEFAULT ARRAY['IN', 'US', 'GB', 'CA', 'AU'],
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

INSERT INTO public.platform_settings (id)
VALUES ('default')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_settings FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.platform_settings FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "platform_settings_select_admin" ON public.platform_settings;
CREATE POLICY "platform_settings_select_admin"
ON public.platform_settings FOR SELECT TO authenticated
USING ((SELECT app.is_platform_admin()));

DROP TRIGGER IF EXISTS platform_settings_touch_updated_at ON public.platform_settings;
CREATE TRIGGER platform_settings_touch_updated_at
  BEFORE UPDATE ON public.platform_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- 3. Explicit, Time-Limited, Audited Support Access Grants
--    (Scoped strictly to non-clinical operational diagnostics; NEVER raw chat or PHI)
CREATE TABLE IF NOT EXISTS public.platform_support_access_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  platform_admin_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  requested_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  revoked_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  scope VARCHAR(40) NOT NULL
    CHECK (scope IN ('org_diagnostics', 'billing_audit', 'schedule_support')),
  reason TEXT NOT NULL,
  decision_reason TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'approved', 'rejected', 'revoked', 'expired')),
  duration_minutes SMALLINT NOT NULL DEFAULT 60 CHECK (duration_minutes BETWEEN 15 AND 480),
  approved_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_platform_support_grants_org_status
  ON public.platform_support_access_grants(organization_id, status, expires_at);

ALTER TABLE public.platform_support_access_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_support_access_grants FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.platform_support_access_grants FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "platform_support_grants_select" ON public.platform_support_access_grants;
CREATE POLICY "platform_support_grants_select"
ON public.platform_support_access_grants FOR SELECT TO authenticated
USING (
  (SELECT app.is_platform_admin())
  OR (SELECT app.has_org_permission(organization_id, 'org.manage'))
);

DROP TRIGGER IF EXISTS platform_support_grants_touch_updated_at ON public.platform_support_access_grants;
CREATE TRIGGER platform_support_grants_touch_updated_at
  BEFORE UPDATE ON public.platform_support_access_grants
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- 4. Platform Overview Metrics RPC (Privacy-Preserving Aggregates Only)
CREATE OR REPLACE FUNCTION public.platform_get_overview_metrics()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_orgs JSONB;
  v_apps JSONB;
  v_users JSONB;
  v_usage JSONB;
  v_security JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Authentication required' USING ERRCODE = '28000';
  END IF;

  IF NOT app.is_platform_admin() THEN
    RAISE EXCEPTION 'Forbidden: Platform Owner privileges required' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'total', count(*),
    'active', count(*) FILTER (WHERE status = 'active'),
    'pending', count(*) FILTER (WHERE status = 'pending'),
    'suspended', count(*) FILTER (WHERE status = 'suspended'),
    'closed', count(*) FILTER (WHERE status = 'closed')
  ) INTO v_orgs
  FROM public.organizations;

  SELECT jsonb_build_object(
    'total', count(*),
    'pending', count(*) FILTER (WHERE status = 'pending'),
    'approved', count(*) FILTER (WHERE status = 'approved'),
    'rejected', count(*) FILTER (WHERE status = 'rejected'),
    'withdrawn', count(*) FILTER (WHERE status = 'withdrawn')
  ) INTO v_apps
  FROM public.organization_applications;

  SELECT jsonb_build_object(
    'total_profiles', (SELECT count(*) FROM public.profiles),
    'active_profiles', (SELECT count(*) FROM public.profiles WHERE COALESCE(platform_status, 'active') = 'active'),
    'suspended_profiles', (SELECT count(*) FROM public.profiles WHERE platform_status = 'suspended'),
    'platform_admins_active', (
      SELECT count(*)
      FROM public.platform_admins pa
      JOIN public.profiles pr ON pr.id = pa.user_id
      WHERE pa.is_active = true AND COALESCE(pr.platform_status, 'active') = 'active'
    ),
    'total_org_memberships', (SELECT count(*) FROM public.organization_memberships),
    'active_org_memberships', (SELECT count(*) FROM public.organization_memberships WHERE status = 'active'),
    'total_clinic_clients', (SELECT count(*) FROM public.clinic_clients),
    'approved_clinic_clients', (SELECT count(*) FROM public.clinic_clients WHERE status = 'approved')
  ) INTO v_users;

  SELECT jsonb_build_object(
    'total_branches', (SELECT count(*) FROM public.branches),
    'active_branches', (SELECT count(*) FROM public.branches WHERE is_active = true),
    'total_doctors', (SELECT count(*) FROM public.doctor_profiles),
    'active_doctors', (SELECT count(*) FROM public.doctor_profiles WHERE is_active = true),
    'total_pets', (SELECT count(*) FROM public.pets WHERE archived_at IS NULL),
    'total_appointments', (SELECT count(*) FROM public.appointments),
    'confirmed_appointments', (SELECT count(*) FROM public.appointments WHERE status IN ('confirmed', 'checked_in')),
    'completed_appointments', (SELECT count(*) FROM public.appointments WHERE status = 'completed'),
    'total_consultations', (SELECT count(*) FROM public.consultations),
    'active_consultations', (SELECT count(*) FROM public.consultations WHERE consultation_status = 'active'),
    'completed_consultations', (SELECT count(*) FROM public.consultations WHERE consultation_status = 'completed'),
    'expired_consultations', (SELECT count(*) FROM public.consultations WHERE consultation_status = 'expired'),
    'total_prescriptions', (SELECT count(*) FROM public.prescriptions),
    'total_medical_records', (SELECT count(*) FROM public.medical_records),
    'total_vaccinations', (SELECT count(*) FROM public.vaccinations),
    'total_payments', (SELECT count(*) FROM public.consultation_payments),
    'paid_payments_count', (SELECT count(*) FROM public.consultation_payments WHERE payment_status = 'completed')
  ) INTO v_usage;

  SELECT jsonb_build_object(
    'pending_support_grants', (
      SELECT count(*) FROM public.platform_support_access_grants WHERE status = 'requested'
    ),
    'active_support_grants', (
      SELECT count(*) FROM public.platform_support_access_grants
      WHERE status = 'approved' AND expires_at > timezone('utc'::text, now())
    ),
    'recent_audit_events_24h', (
      SELECT count(*) FROM public.audit_logs
      WHERE created_at >= timezone('utc'::text, now()) - INTERVAL '24 hours'
        AND (
          organization_id IS NULL
          OR action IN (
            'APPROVE_ORG_APPLICATION', 'REJECT_ORG_APPLICATION',
            'SUSPEND_ORGANIZATION', 'REACTIVATE_ORGANIZATION', 'ACTIVATE_ORGANIZATION',
            'PLATFORM_UPDATE_ORG_METADATA', 'GRANT_PLATFORM_ADMIN', 'REVOKE_PLATFORM_ADMIN',
            'PLATFORM_SUSPEND_USER', 'PLATFORM_REACTIVATE_USER', 'UPDATE_PLATFORM_SETTINGS',
            'REQUEST_PLATFORM_SUPPORT_ACCESS', 'APPROVE_PLATFORM_SUPPORT_ACCESS',
            'REJECT_PLATFORM_SUPPORT_ACCESS', 'REVOKE_PLATFORM_SUPPORT_ACCESS', 'SUPPORT_ACCESS_VIEWED'
          )
        )
    ),
    'suspended_orgs_count', (SELECT count(*) FROM public.organizations WHERE status = 'suspended'),
    'suspended_users_count', (SELECT count(*) FROM public.profiles WHERE platform_status = 'suspended')
  ) INTO v_security;

  RETURN jsonb_build_object(
    'generated_at', timezone('utc'::text, now()),
    'organizations', v_orgs,
    'applications', v_apps,
    'users', v_users,
    'usage', v_usage,
    'security', v_security
  );
END;
$$;
REVOKE ALL ON FUNCTION public.platform_get_overview_metrics() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_get_overview_metrics() TO authenticated;

-- 5. Organization Listing & Privacy-Preserving Operational Overview RPCs
CREATE OR REPLACE FUNCTION public.platform_list_organizations_overview()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_result JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Authentication required' USING ERRCODE = '28000';
  END IF;
  IF NOT app.is_platform_admin() THEN
    RAISE EXCEPTION 'Forbidden: Platform Owner privileges required' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', o.id,
      'slug', o.slug,
      'legal_name', o.legal_name,
      'display_name', o.display_name,
      'status', o.status,
      'timezone', o.timezone,
      'country', o.country,
      'contact_email', o.contact_email,
      'phone', o.phone,
      'plan_code', o.plan_code,
      'created_by', o.created_by,
      'approved_by', o.approved_by,
      'approved_at', o.approved_at,
      'created_at', o.created_at,
      'updated_at', o.updated_at,
      'branch_count', (SELECT count(*) FROM public.branches b WHERE b.organization_id = o.id),
      'active_branch_count', (SELECT count(*) FROM public.branches b WHERE b.organization_id = o.id AND b.is_active = true),
      'active_staff_count', (SELECT count(*) FROM public.organization_memberships om WHERE om.organization_id = o.id AND om.status = 'active'),
      'active_doctor_count', (SELECT count(*) FROM public.doctor_profiles dp WHERE dp.organization_id = o.id AND dp.is_active = true),
      'approved_client_count', (SELECT count(*) FROM public.clinic_clients cc WHERE cc.organization_id = o.id AND cc.status = 'approved'),
      'pending_client_count', (SELECT count(*) FROM public.clinic_clients cc WHERE cc.organization_id = o.id AND cc.status = 'requested'),
      'pet_count', (SELECT count(*) FROM public.pets p WHERE p.organization_id = o.id AND p.archived_at IS NULL),
      'appointment_count', (SELECT count(*) FROM public.appointments a WHERE a.organization_id = o.id),
      'consultation_count', (SELECT count(*) FROM public.consultations c WHERE c.organization_id = o.id),
      'active_consultation_count', (SELECT count(*) FROM public.consultations c WHERE c.organization_id = o.id AND c.consultation_status = 'active')
    )
    ORDER BY o.created_at DESC
  ), '[]'::jsonb)
  INTO v_result
  FROM public.organizations o;

  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.platform_list_organizations_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_list_organizations_overview() TO authenticated;

CREATE OR REPLACE FUNCTION public.platform_get_organization_details(p_organization_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_org public.organizations;
  v_branches JSONB;
  v_role_counts JSONB;
  v_metrics JSONB;
  v_application JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Authentication required' USING ERRCODE = '28000';
  END IF;
  IF NOT app.is_platform_admin() THEN
    RAISE EXCEPTION 'Forbidden: Platform Owner privileges required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_org FROM public.organizations WHERE id = p_organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', b.id,
      'name', b.name,
      'code', b.code,
      'city', b.city,
      'state', b.state,
      'country', b.country,
      'timezone', b.timezone,
      'is_active', b.is_active,
      'created_at', b.created_at
    )
    ORDER BY b.name
  ), '[]'::jsonb)
  INTO v_branches
  FROM public.branches b
  WHERE b.organization_id = p_organization_id;

  -- Aggregate role distribution counts only (no member PII or silent role edits)
  SELECT COALESCE(jsonb_object_agg(role_code, role_cnt), '{}'::jsonb)
  INTO v_role_counts
  FROM (
    SELECT r.code AS role_code, count(DISTINCT om.id) AS role_cnt
    FROM public.organization_memberships om
    JOIN public.membership_roles mr ON mr.membership_id = om.id AND mr.organization_id = om.organization_id
    JOIN public.organization_roles r ON r.id = mr.role_id
    WHERE om.organization_id = p_organization_id AND om.status = 'active'
    GROUP BY r.code
  ) rc;

  SELECT jsonb_build_object(
    'active_staff', (SELECT count(*) FROM public.organization_memberships WHERE organization_id = p_organization_id AND status = 'active'),
    'suspended_staff', (SELECT count(*) FROM public.organization_memberships WHERE organization_id = p_organization_id AND status = 'suspended'),
    'approved_clients', (SELECT count(*) FROM public.clinic_clients WHERE organization_id = p_organization_id AND status = 'approved'),
    'pending_clients', (SELECT count(*) FROM public.clinic_clients WHERE organization_id = p_organization_id AND status = 'requested'),
    'active_doctors', (SELECT count(*) FROM public.doctor_profiles WHERE organization_id = p_organization_id AND is_active = true),
    'pets', (SELECT count(*) FROM public.pets WHERE organization_id = p_organization_id AND archived_at IS NULL),
    'appointments_total', (SELECT count(*) FROM public.appointments WHERE organization_id = p_organization_id),
    'appointments_confirmed', (SELECT count(*) FROM public.appointments WHERE organization_id = p_organization_id AND status IN ('confirmed', 'checked_in')),
    'consultations_total', (SELECT count(*) FROM public.consultations WHERE organization_id = p_organization_id),
    'consultations_active', (SELECT count(*) FROM public.consultations WHERE organization_id = p_organization_id AND consultation_status = 'active'),
    'prescriptions_total', (SELECT count(*) FROM public.prescriptions WHERE organization_id = p_organization_id),
    'medical_records_total', (SELECT count(*) FROM public.medical_records WHERE organization_id = p_organization_id),
    'vaccinations_total', (SELECT count(*) FROM public.vaccinations WHERE organization_id = p_organization_id)
  ) INTO v_metrics;

  SELECT to_jsonb(oa) INTO v_application
  FROM public.organization_applications oa
  WHERE oa.organization_id = p_organization_id
  ORDER BY oa.created_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'organization', to_jsonb(v_org),
    'branches', v_branches,
    'role_counts', v_role_counts,
    'metrics', v_metrics,
    'application', v_application
  );
END;
$$;
REVOKE ALL ON FUNCTION public.platform_get_organization_details(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_get_organization_details(UUID) TO authenticated;

-- 6. Organization Lifecycle Activation & Metadata Governance RPCs
CREATE OR REPLACE FUNCTION public.platform_activate_organization(p_organization_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_org public.organizations;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  IF NOT app.is_platform_admin() THEN
    RAISE EXCEPTION 'Forbidden: Platform Owner privileges required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_org FROM public.organizations WHERE id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Organization not found' USING ERRCODE = 'P0002'; END IF;

  IF v_org.status <> 'pending' THEN
    RAISE EXCEPTION 'Invalid State: Only pending organizations can be activated directly (current: %)', v_org.status USING ERRCODE = '22023';
  END IF;

  UPDATE public.organizations
  SET status = 'active',
      approved_by = COALESCE(approved_by, v_uid),
      approved_at = COALESCE(approved_at, timezone('utc'::text, now()))
  WHERE id = p_organization_id;

  PERFORM app.write_audit_log(
    p_organization_id, v_uid, 'ACTIVATE_ORGANIZATION', 'organization', p_organization_id::TEXT,
    'Activated pending organization ' || v_org.display_name,
    jsonb_build_object('status', v_org.status),
    jsonb_build_object('status', 'active')
  );
END;
$$;
REVOKE ALL ON FUNCTION public.platform_activate_organization(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_activate_organization(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.platform_update_organization_metadata(
  p_organization_id UUID,
  p_display_name TEXT DEFAULT NULL,
  p_legal_name TEXT DEFAULT NULL,
  p_timezone TEXT DEFAULT NULL,
  p_country TEXT DEFAULT NULL,
  p_contact_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_plan_code TEXT DEFAULT NULL
)
RETURNS public.organizations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_org public.organizations;
  v_updated public.organizations;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  IF NOT app.is_platform_admin() THEN
    RAISE EXCEPTION 'Forbidden: Platform Owner privileges required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_org FROM public.organizations WHERE id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Organization not found' USING ERRCODE = 'P0002'; END IF;

  -- Strictly updates metadata ONLY; NEVER alters organization_memberships or org_owner
  UPDATE public.organizations
  SET display_name = COALESCE(NULLIF(trim(COALESCE(p_display_name, '')), ''), display_name),
      legal_name = COALESCE(NULLIF(trim(COALESCE(p_legal_name, '')), ''), legal_name),
      timezone = COALESCE(NULLIF(trim(COALESCE(p_timezone, '')), ''), timezone),
      country = COALESCE(NULLIF(trim(COALESCE(p_country, '')), ''), country),
      contact_email = CASE WHEN p_contact_email IS NULL THEN contact_email ELSE NULLIF(trim(p_contact_email), '') END,
      phone = CASE WHEN p_phone IS NULL THEN phone ELSE NULLIF(trim(p_phone), '') END,
      plan_code = CASE WHEN p_plan_code IS NULL THEN plan_code ELSE NULLIF(trim(p_plan_code), '') END
  WHERE id = p_organization_id
  RETURNING * INTO v_updated;

  PERFORM app.write_audit_log(
    p_organization_id, v_uid, 'PLATFORM_UPDATE_ORG_METADATA', 'organization', p_organization_id::TEXT,
    'Platform Owner updated organization metadata for ' || v_updated.display_name,
    jsonb_build_object(
      'display_name', v_org.display_name,
      'legal_name', v_org.legal_name,
      'timezone', v_org.timezone,
      'country', v_org.country,
      'plan_code', v_org.plan_code
    ),
    jsonb_build_object(
      'display_name', v_updated.display_name,
      'legal_name', v_updated.legal_name,
      'timezone', v_updated.timezone,
      'country', v_updated.country,
      'plan_code', v_updated.plan_code
    )
  );

  RETURN v_updated;
END;
$$;
REVOKE ALL ON FUNCTION public.platform_update_organization_metadata(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_update_organization_metadata(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- 7. Platform User Administration & Platform Role Governance RPCs
CREATE OR REPLACE FUNCTION public.platform_list_users(
  p_search TEXT DEFAULT NULL,
  p_filter TEXT DEFAULT 'all',
  p_limit INT DEFAULT 100,
  p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_q TEXT := lower(trim(COALESCE(p_search, '')));
  v_limit INT := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 250);
  v_offset INT := GREATEST(COALESCE(p_offset, 0), 0);
  v_rows JSONB;
  v_total BIGINT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  IF NOT app.is_platform_admin() THEN
    RAISE EXCEPTION 'Forbidden: Platform Owner privileges required' USING ERRCODE = '42501';
  END IF;

  WITH base AS (
    SELECT
      p.id,
      p.full_name,
      p.email,
      p.phone,
      COALESCE(p.platform_status, 'active') AS platform_status,
      p.platform_suspended_at,
      p.platform_suspension_reason,
      p.created_at,
      p.updated_at,
      (pa.user_id IS NOT NULL) AS has_platform_admin_record,
      COALESCE(pa.is_active, false) AS is_platform_admin,
      pa.granted_at AS platform_admin_granted_at,
      pa.granted_by AS platform_admin_granted_by,
      pa.notes AS platform_admin_notes,
      (SELECT count(*) FROM public.organization_memberships om WHERE om.user_id = p.id AND om.status = 'active') AS active_staff_org_count,
      (SELECT count(*) FROM public.clinic_clients cc WHERE cc.user_id = p.id AND cc.status = 'approved') AS approved_client_org_count
    FROM public.profiles p
    LEFT JOIN public.platform_admins pa ON pa.user_id = p.id
    WHERE (
      v_q = ''
      OR lower(p.full_name) LIKE '%' || v_q || '%'
      OR lower(p.email) LIKE '%' || v_q || '%'
    )
    AND (
      p_filter = 'all'
      OR (p_filter = 'platform_admins' AND COALESCE(pa.is_active, false) = true)
      OR (p_filter = 'suspended' AND COALESCE(p.platform_status, 'active') = 'suspended')
      OR (p_filter = 'active' AND COALESCE(p.platform_status, 'active') = 'active')
    )
  )
  SELECT
    (SELECT count(*) FROM base),
    COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.is_platform_admin DESC, r.created_at DESC)
      FROM (SELECT * FROM base ORDER BY is_platform_admin DESC, created_at DESC LIMIT v_limit OFFSET v_offset) r
    ), '[]'::jsonb)
  INTO v_total, v_rows;

  RETURN jsonb_build_object(
    'total', v_total,
    'users', v_rows
  );
END;
$$;
REVOKE ALL ON FUNCTION public.platform_list_users(TEXT, TEXT, INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_list_users(TEXT, TEXT, INT, INT) TO authenticated;

CREATE OR REPLACE FUNCTION public.platform_grant_platform_admin(
  p_target_user_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_target public.profiles;
  v_existing public.platform_admins;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  IF NOT app.is_platform_admin() THEN
    RAISE EXCEPTION 'Forbidden: Only an active Platform Owner can grant platform governance roles' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_target FROM public.profiles WHERE id = p_target_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user profile not found' USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_target.platform_status, 'active') <> 'active' THEN
    RAISE EXCEPTION 'Cannot grant Platform Owner role to a suspended user account' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing FROM public.platform_admins WHERE user_id = p_target_user_id FOR UPDATE;
  IF FOUND AND v_existing.is_active = true THEN
    RAISE EXCEPTION 'User is already an active Platform Owner' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.platform_admins (user_id, granted_by, granted_at, is_active, notes)
  VALUES (
    p_target_user_id,
    v_uid,
    timezone('utc'::text, now()),
    true,
    NULLIF(trim(COALESCE(p_notes, '')), '')
  )
  ON CONFLICT (user_id) DO UPDATE
    SET granted_by = v_uid,
        granted_at = timezone('utc'::text, now()),
        is_active = true,
        notes = COALESCE(NULLIF(trim(COALESCE(p_notes, '')), ''), public.platform_admins.notes);

  PERFORM app.write_audit_log(
    NULL, v_uid, 'GRANT_PLATFORM_ADMIN', 'platform_admin', p_target_user_id::TEXT,
    'Granted Platform Owner role to ' || v_target.email,
    jsonb_build_object('is_active', COALESCE(v_existing.is_active, false)),
    jsonb_build_object('is_active', true, 'notes', NULLIF(trim(COALESCE(p_notes, '')), ''))
  );

  PERFORM app.enqueue_notification(
    NULL, p_target_user_id, 'Platform Governance Role Assigned',
    'You have been granted Platform Owner governance privileges.',
    'system'::public.notification_type_enum, '/platform/dashboard'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.platform_grant_platform_admin(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_grant_platform_admin(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.platform_revoke_platform_admin(
  p_target_user_id UUID,
  p_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_target public.profiles;
  v_existing public.platform_admins;
  v_other_active_count BIGINT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  IF NOT app.is_platform_admin() THEN
    RAISE EXCEPTION 'Forbidden: Only an active Platform Owner can revoke platform governance roles' USING ERRCODE = '42501';
  END IF;

  IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Revocation reason is required' USING ERRCODE = '22023';
  END IF;

  IF p_target_user_id = v_uid THEN
    RAISE EXCEPTION 'Cannot revoke your own Platform Owner role' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_target FROM public.profiles WHERE id = p_target_user_id;
  SELECT * INTO v_existing FROM public.platform_admins WHERE user_id = p_target_user_id FOR UPDATE;
  IF NOT FOUND OR v_existing.is_active = false THEN
    RAISE EXCEPTION 'Target user is not an active Platform Owner' USING ERRCODE = 'P0002';
  END IF;

  SELECT count(*) INTO v_other_active_count
  FROM public.platform_admins pa
  JOIN public.profiles pr ON pr.id = pa.user_id
  WHERE pa.is_active = true
    AND COALESCE(pr.platform_status, 'active') = 'active'
    AND pa.user_id <> p_target_user_id;

  IF v_other_active_count = 0 THEN
    RAISE EXCEPTION 'Cannot revoke the last active Platform Owner' USING ERRCODE = '22023';
  END IF;

  UPDATE public.platform_admins
  SET is_active = false,
      notes = trim(p_reason)
  WHERE user_id = p_target_user_id;

  PERFORM app.write_audit_log(
    NULL, v_uid, 'REVOKE_PLATFORM_ADMIN', 'platform_admin', p_target_user_id::TEXT,
    'Revoked Platform Owner role from ' || COALESCE(v_target.email, p_target_user_id::TEXT) || ': ' || trim(p_reason),
    jsonb_build_object('is_active', true),
    jsonb_build_object('is_active', false, 'reason', trim(p_reason))
  );
END;
$$;
REVOKE ALL ON FUNCTION public.platform_revoke_platform_admin(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_revoke_platform_admin(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.platform_suspend_user(
  p_target_user_id UUID,
  p_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_target public.profiles;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  IF NOT app.is_platform_admin() THEN
    RAISE EXCEPTION 'Forbidden: Platform Owner privileges required' USING ERRCODE = '42501';
  END IF;

  IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Suspension reason is required' USING ERRCODE = '22023';
  END IF;

  IF p_target_user_id = v_uid THEN
    RAISE EXCEPTION 'Cannot suspend your own account' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_target FROM public.profiles WHERE id = p_target_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE user_id = p_target_user_id AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Revoke active Platform Owner role before suspending this user' USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles
  SET platform_status = 'suspended',
      platform_suspended_at = timezone('utc'::text, now()),
      platform_suspension_reason = trim(p_reason)
  WHERE id = p_target_user_id;

  PERFORM app.write_audit_log(
    NULL, v_uid, 'PLATFORM_SUSPEND_USER', 'profile', p_target_user_id::TEXT,
    'Suspended user ' || v_target.email || ': ' || trim(p_reason),
    jsonb_build_object('platform_status', COALESCE(v_target.platform_status, 'active')),
    jsonb_build_object('platform_status', 'suspended', 'reason', trim(p_reason))
  );
END;
$$;
REVOKE ALL ON FUNCTION public.platform_suspend_user(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_suspend_user(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.platform_reactivate_user(p_target_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_target public.profiles;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  IF NOT app.is_platform_admin() THEN
    RAISE EXCEPTION 'Forbidden: Platform Owner privileges required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_target FROM public.profiles WHERE id = p_target_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found' USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_target.platform_status, 'active') <> 'suspended' THEN
    RAISE EXCEPTION 'User account is not suspended' USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles
  SET platform_status = 'active',
      platform_suspended_at = NULL,
      platform_suspension_reason = NULL
  WHERE id = p_target_user_id;

  PERFORM app.write_audit_log(
    NULL, v_uid, 'PLATFORM_REACTIVATE_USER', 'profile', p_target_user_id::TEXT,
    'Reactivated user account ' || v_target.email,
    jsonb_build_object('platform_status', v_target.platform_status),
    jsonb_build_object('platform_status', 'active')
  );
END;
$$;
REVOKE ALL ON FUNCTION public.platform_reactivate_user(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_reactivate_user(UUID) TO authenticated;

-- 8. Platform Governance Audit Logs RPC (Excludes Clinical/Patient/Chat Events)
CREATE OR REPLACE FUNCTION public.platform_list_audit_logs(
  p_search TEXT DEFAULT NULL,
  p_action TEXT DEFAULT NULL,
  p_limit INT DEFAULT 100
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_q TEXT := lower(trim(COALESCE(p_search, '')));
  v_action TEXT := upper(trim(COALESCE(p_action, '')));
  v_limit INT := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 300);
  v_rows JSONB;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  IF NOT app.is_platform_admin() THEN
    RAISE EXCEPTION 'Forbidden: Platform Owner privileges required' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(row_json ORDER BY created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      al.created_at,
      jsonb_build_object(
        'id', al.id,
        'organization_id', al.organization_id,
        'organization_name', o.display_name,
        'actor_user_id', COALESCE(al.actor_user_id, al.user_id),
        'actor_name', COALESCE(pr.full_name, 'System'),
        'actor_email', COALESCE(pr.email, ''),
        'action', al.action,
        'entity_type', al.entity_type,
        'entity_id', al.entity_id,
        'details', al.details,
        'before_json', al.before_json,
        'after_json', al.after_json,
        'created_at', al.created_at
      ) AS row_json
    FROM public.audit_logs al
    LEFT JOIN public.organizations o ON o.id = al.organization_id
    LEFT JOIN public.profiles pr ON pr.id = COALESCE(al.actor_user_id, al.user_id)
    WHERE (
      al.organization_id IS NULL
      OR al.action IN (
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
        'SUPPORT_ACCESS_VIEWED'
      )
    )
    AND (v_action = '' OR v_action = 'ALL' OR upper(al.action) = v_action)
    AND (
      v_q = ''
      OR lower(COALESCE(al.action, '')) LIKE '%' || v_q || '%'
      OR lower(COALESCE(al.details, '')) LIKE '%' || v_q || '%'
      OR lower(COALESCE(al.entity_type, '')) LIKE '%' || v_q || '%'
      OR lower(COALESCE(pr.email, '')) LIKE '%' || v_q || '%'
      OR lower(COALESCE(o.display_name, '')) LIKE '%' || v_q || '%'
    )
    ORDER BY al.created_at DESC
    LIMIT v_limit
  ) sub;

  RETURN v_rows;
END;
$$;
REVOKE ALL ON FUNCTION public.platform_list_audit_logs(TEXT, TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_list_audit_logs(TEXT, TEXT, INT) TO authenticated;

-- 9. Platform Settings RPCs
CREATE OR REPLACE FUNCTION public.platform_get_settings()
RETURNS public.platform_settings
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_settings public.platform_settings;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  IF NOT app.is_platform_admin() THEN
    RAISE EXCEPTION 'Forbidden: Platform Owner privileges required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_settings FROM public.platform_settings WHERE id = 'default';
  RETURN v_settings;
END;
$$;
REVOKE ALL ON FUNCTION public.platform_get_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_get_settings() TO authenticated;

CREATE OR REPLACE FUNCTION public.platform_update_settings(
  p_platform_name TEXT,
  p_require_manual_org_approval BOOLEAN,
  p_allow_self_service_org_applications BOOLEAN,
  p_default_consultation_window_days SMALLINT,
  p_max_support_access_minutes SMALLINT,
  p_maintenance_mode BOOLEAN,
  p_security_notice TEXT DEFAULT NULL,
  p_allowed_countries TEXT[] DEFAULT NULL
)
RETURNS public.platform_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_before public.platform_settings;
  v_after public.platform_settings;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  IF NOT app.is_platform_admin() THEN
    RAISE EXCEPTION 'Forbidden: Platform Owner privileges required' USING ERRCODE = '42501';
  END IF;

  IF NULLIF(trim(COALESCE(p_platform_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Platform name is required' USING ERRCODE = '22023';
  END IF;
  IF p_default_consultation_window_days < 1 OR p_default_consultation_window_days > 30 THEN
    RAISE EXCEPTION 'Consultation window must be between 1 and 30 days' USING ERRCODE = '22023';
  END IF;
  IF p_max_support_access_minutes < 15 OR p_max_support_access_minutes > 480 THEN
    RAISE EXCEPTION 'Support access max duration must be between 15 and 480 minutes' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_before FROM public.platform_settings WHERE id = 'default' FOR UPDATE;

  UPDATE public.platform_settings
  SET platform_name = trim(p_platform_name),
      require_manual_org_approval = COALESCE(p_require_manual_org_approval, require_manual_org_approval),
      allow_self_service_org_applications = COALESCE(p_allow_self_service_org_applications, allow_self_service_org_applications),
      default_consultation_window_days = p_default_consultation_window_days,
      max_support_access_minutes = p_max_support_access_minutes,
      maintenance_mode = COALESCE(p_maintenance_mode, maintenance_mode),
      security_notice = CASE WHEN p_security_notice IS NULL THEN security_notice ELSE NULLIF(trim(p_security_notice), '') END,
      allowed_countries = COALESCE(p_allowed_countries, allowed_countries),
      updated_by = v_uid
  WHERE id = 'default'
  RETURNING * INTO v_after;

  PERFORM app.write_audit_log(
    NULL, v_uid, 'UPDATE_PLATFORM_SETTINGS', 'platform_settings', 'default',
    'Updated global platform configuration settings',
    to_jsonb(v_before),
    to_jsonb(v_after)
  );

  RETURN v_after;
END;
$$;
REVOKE ALL ON FUNCTION public.platform_update_settings(TEXT, BOOLEAN, BOOLEAN, SMALLINT, SMALLINT, BOOLEAN, TEXT, TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_update_settings(TEXT, BOOLEAN, BOOLEAN, SMALLINT, SMALLINT, BOOLEAN, TEXT, TEXT[]) TO authenticated;

-- 10. Exceptional Time-Limited, Explicitly Authorized Support Access RPCs
--     (Platform Owner requests -> Organization Owner approves -> Time-boxed non-PHI snapshot)
CREATE OR REPLACE FUNCTION public.platform_request_support_access(
  p_organization_id UUID,
  p_scope TEXT,
  p_reason TEXT,
  p_duration_minutes SMALLINT DEFAULT 60
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_org public.organizations;
  v_max_mins SMALLINT := 60;
  v_grant_id UUID;
  v_owner_uid UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  IF NOT app.is_platform_admin() THEN
    RAISE EXCEPTION 'Forbidden: Platform Owner privileges required' USING ERRCODE = '42501';
  END IF;

  IF p_scope NOT IN ('org_diagnostics', 'billing_audit', 'schedule_support') THEN
    RAISE EXCEPTION 'Invalid support scope: clinical records and chats cannot be requested' USING ERRCODE = '22023';
  END IF;

  IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Support access reason is required' USING ERRCODE = '22023';
  END IF;

  SELECT max_support_access_minutes INTO v_max_mins FROM public.platform_settings WHERE id = 'default';
  v_max_mins := COALESCE(v_max_mins, 60);

  IF p_duration_minutes IS NULL OR p_duration_minutes < 15 OR p_duration_minutes > v_max_mins THEN
    RAISE EXCEPTION 'Duration must be between 15 and % minutes', v_max_mins USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_org FROM public.organizations WHERE id = p_organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.platform_support_access_grants (
    organization_id, platform_admin_user_id, requested_by, scope, reason, status, duration_minutes
  )
  VALUES (
    p_organization_id, v_uid, v_uid, p_scope, trim(p_reason), 'requested', p_duration_minutes
  )
  RETURNING id INTO v_grant_id;

  PERFORM app.write_audit_log(
    p_organization_id, v_uid, 'REQUEST_PLATFORM_SUPPORT_ACCESS', 'platform_support_access_grant', v_grant_id::TEXT,
    'Platform Owner requested time-limited ' || p_scope || ' support access (' || p_duration_minutes || 'm): ' || trim(p_reason)
  );

  -- Notify active org_owner(s) to review and approve/reject
  FOR v_owner_uid IN
    SELECT DISTINCT om.user_id
    FROM public.organization_memberships om
    JOIN public.membership_roles mr ON mr.membership_id = om.id AND mr.organization_id = om.organization_id
    JOIN public.organization_roles r ON r.id = mr.role_id
    WHERE om.organization_id = p_organization_id
      AND om.status = 'active'
      AND r.code = 'org_owner'
  LOOP
    PERFORM app.enqueue_notification(
      p_organization_id,
      v_owner_uid,
      'Support Access Request',
      'Platform Owner requested time-limited (' || p_duration_minutes || ' min) ' || p_scope || ' support access.',
      'system'::public.notification_type_enum,
      '/' || v_org.slug || '/admin/settings'
    );
  END LOOP;

  RETURN v_grant_id;
END;
$$;
REVOKE ALL ON FUNCTION public.platform_request_support_access(UUID, TEXT, TEXT, SMALLINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_request_support_access(UUID, TEXT, TEXT, SMALLINT) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_platform_support_access(p_grant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_grant public.platform_support_access_grants;
  v_expires TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;

  SELECT * INTO v_grant FROM public.platform_support_access_grants WHERE id = p_grant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Support access grant not found' USING ERRCODE = 'P0002'; END IF;

  -- Strictly requires Organization Owner (org.manage); Platform Owner CANNOT self-approve
  IF NOT app.has_org_permission(v_grant.organization_id, 'org.manage') THEN
    RAISE EXCEPTION 'Forbidden: Explicit approval by an Organization Owner (org.manage) is required' USING ERRCODE = '42501';
  END IF;

  IF v_grant.status <> 'requested' THEN
    RAISE EXCEPTION 'Invalid State: Support grant is already %', v_grant.status USING ERRCODE = '22023';
  END IF;

  v_expires := timezone('utc'::text, now()) + make_interval(mins => v_grant.duration_minutes);

  UPDATE public.platform_support_access_grants
  SET status = 'approved',
      approved_by = v_uid,
      approved_at = timezone('utc'::text, now()),
      expires_at = v_expires
  WHERE id = p_grant_id;

  PERFORM app.write_audit_log(
    v_grant.organization_id, v_uid, 'APPROVE_PLATFORM_SUPPORT_ACCESS', 'platform_support_access_grant', p_grant_id::TEXT,
    'Organization Owner approved time-limited support access until ' || v_expires::TEXT
  );
END;
$$;
REVOKE ALL ON FUNCTION public.approve_platform_support_access(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_platform_support_access(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_platform_support_access(p_grant_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_grant public.platform_support_access_grants;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Rejection reason is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_grant FROM public.platform_support_access_grants WHERE id = p_grant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Support access grant not found' USING ERRCODE = 'P0002'; END IF;

  IF NOT app.has_org_permission(v_grant.organization_id, 'org.manage') THEN
    RAISE EXCEPTION 'Forbidden: Only Organization Owner (org.manage) can reject support access' USING ERRCODE = '42501';
  END IF;

  IF v_grant.status <> 'requested' THEN
    RAISE EXCEPTION 'Invalid State: Support grant is already %', v_grant.status USING ERRCODE = '22023';
  END IF;

  UPDATE public.platform_support_access_grants
  SET status = 'rejected',
      decision_reason = trim(p_reason)
  WHERE id = p_grant_id;

  PERFORM app.write_audit_log(
    v_grant.organization_id, v_uid, 'REJECT_PLATFORM_SUPPORT_ACCESS', 'platform_support_access_grant', p_grant_id::TEXT,
    'Organization Owner rejected support access request: ' || trim(p_reason)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.reject_platform_support_access(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_platform_support_access(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_platform_support_access(
  p_grant_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_grant public.platform_support_access_grants;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;

  SELECT * INTO v_grant FROM public.platform_support_access_grants WHERE id = p_grant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Support access grant not found' USING ERRCODE = 'P0002'; END IF;

  IF NOT (
    app.has_org_permission(v_grant.organization_id, 'org.manage')
    OR (app.is_platform_admin() AND v_grant.platform_admin_user_id = v_uid)
  ) THEN
    RAISE EXCEPTION 'Forbidden: Only Organization Owner or the granted Platform Owner may revoke' USING ERRCODE = '42501';
  END IF;

  IF v_grant.status NOT IN ('requested', 'approved') THEN
    RAISE EXCEPTION 'Grant is already closed (%)' , v_grant.status USING ERRCODE = '22023';
  END IF;

  UPDATE public.platform_support_access_grants
  SET status = 'revoked',
      revoked_by = v_uid,
      revoked_at = timezone('utc'::text, now()),
      decision_reason = COALESCE(NULLIF(trim(COALESCE(p_reason, '')), ''), decision_reason)
  WHERE id = p_grant_id;

  PERFORM app.write_audit_log(
    v_grant.organization_id, v_uid, 'REVOKE_PLATFORM_SUPPORT_ACCESS', 'platform_support_access_grant', p_grant_id::TEXT,
    'Revoked support access grant: ' || COALESCE(NULLIF(trim(COALESCE(p_reason, '')), ''), 'manual revocation')
  );
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_platform_support_access(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_platform_support_access(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.platform_list_support_grants(p_organization_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_rows JSONB;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  IF NOT (
    app.is_platform_admin()
    OR (p_organization_id IS NOT NULL AND app.has_org_permission(p_organization_id, 'org.manage'))
  ) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', g.id,
      'organization_id', g.organization_id,
      'organization_name', o.display_name,
      'organization_slug', o.slug,
      'platform_admin_user_id', g.platform_admin_user_id,
      'platform_admin_email', pa_prof.email,
      'approved_by', g.approved_by,
      'approved_by_email', app_prof.email,
      'scope', g.scope,
      'reason', g.reason,
      'decision_reason', g.decision_reason,
      'status', CASE
        WHEN g.status = 'approved' AND g.expires_at IS NOT NULL AND g.expires_at <= timezone('utc'::text, now()) THEN 'expired'
        ELSE g.status
      END,
      'duration_minutes', g.duration_minutes,
      'approved_at', g.approved_at,
      'expires_at', g.expires_at,
      'revoked_at', g.revoked_at,
      'created_at', g.created_at
    )
    ORDER BY g.created_at DESC
  ), '[]'::jsonb)
  INTO v_rows
  FROM public.platform_support_access_grants g
  JOIN public.organizations o ON o.id = g.organization_id
  LEFT JOIN public.profiles pa_prof ON pa_prof.id = g.platform_admin_user_id
  LEFT JOIN public.profiles app_prof ON app_prof.id = g.approved_by
  WHERE p_organization_id IS NULL OR g.organization_id = p_organization_id;

  RETURN v_rows;
END;
$$;
REVOKE ALL ON FUNCTION public.platform_list_support_grants(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_list_support_grants(UUID) TO authenticated;

-- Scoped diagnostic snapshot: strictly requires an active, approved, non-expired grant
-- and NEVER exposes clinical records, prescriptions, vaccinations, or chat messages.
CREATE OR REPLACE FUNCTION public.platform_get_scoped_support_snapshot(p_grant_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_grant public.platform_support_access_grants;
  v_org public.organizations;
  v_snapshot JSONB;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  IF NOT app.is_platform_admin() THEN
    RAISE EXCEPTION 'Forbidden: Platform Owner privileges required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_grant FROM public.platform_support_access_grants WHERE id = p_grant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Support access grant not found' USING ERRCODE = 'P0002'; END IF;

  IF v_grant.platform_admin_user_id <> v_uid THEN
    RAISE EXCEPTION 'Forbidden: Support grant belongs to a different Platform Owner' USING ERRCODE = '42501';
  END IF;

  IF v_grant.status <> 'approved' THEN
    RAISE EXCEPTION 'Forbidden: Support grant is not approved (status: %)', v_grant.status USING ERRCODE = '42501';
  END IF;

  IF v_grant.expires_at IS NULL OR v_grant.expires_at <= timezone('utc'::text, now()) THEN
    UPDATE public.platform_support_access_grants SET status = 'expired' WHERE id = p_grant_id;
    RAISE EXCEPTION 'Forbidden: Time-limited support access grant has expired' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_org FROM public.organizations WHERE id = v_grant.organization_id;

  SELECT jsonb_build_object(
    'grant_id', v_grant.id,
    'scope', v_grant.scope,
    'expires_at', v_grant.expires_at,
    'organization', jsonb_build_object(
      'id', v_org.id,
      'slug', v_org.slug,
      'display_name', v_org.display_name,
      'status', v_org.status,
      'operational_settings', v_org.operational_settings
    ),
    'branches_summary', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'code', b.code, 'is_active', b.is_active, 'timezone', b.timezone))
      FROM public.branches b WHERE b.organization_id = v_grant.organization_id
    ), '[]'::jsonb),
    'appointment_status_counts', COALESCE((
      SELECT jsonb_object_agg(status, cnt)
      FROM (
        SELECT status, count(*) AS cnt
        FROM public.appointments
        WHERE organization_id = v_grant.organization_id
        GROUP BY status
      ) ap
    ), '{}'::jsonb),
    'consultation_status_counts', COALESCE((
      SELECT jsonb_object_agg(consultation_status::TEXT, cnt)
      FROM (
        SELECT consultation_status, count(*) AS cnt
        FROM public.consultations
        WHERE organization_id = v_grant.organization_id
        GROUP BY consultation_status
      ) cs
    ), '{}'::jsonb),
    'payment_status_counts', COALESCE((
      SELECT jsonb_object_agg(payment_status::TEXT, cnt)
      FROM (
        SELECT payment_status, count(*) AS cnt
        FROM public.consultation_payments
        WHERE organization_id = v_grant.organization_id
        GROUP BY payment_status
      ) pm
    ), '{}'::jsonb),
    'clinical_privacy_notice', 'Private medical records, prescriptions, vaccinations, clinical notes, and consultation chats remain strictly excluded.'
  ) INTO v_snapshot;

  PERFORM app.write_audit_log(
    v_grant.organization_id, v_uid, 'SUPPORT_ACCESS_VIEWED', 'platform_support_access_grant', v_grant.id::TEXT,
    'Platform Owner viewed scoped (' || v_grant.scope || ') operational diagnostics snapshot'
  );

  RETURN v_snapshot;
END;
$$;
REVOKE ALL ON FUNCTION public.platform_get_scoped_support_snapshot(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_get_scoped_support_snapshot(UUID) TO authenticated;
