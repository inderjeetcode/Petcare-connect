-- ==============================================================================
-- PET CONNECT VETERINARY HEALTHCARE PLATFORM
-- Migration 10 (Phase 6): Organization Admin Portal Services & Governance RPCs
-- File: supabase/migrations/20261113100000_phase6_admin_portal_services_and_governance.sql
-- ==============================================================================
-- NOTES:
-- 1. Strictly additive & hardened incremental migration for Phase 6.
-- 2. Adds operational_settings JSONB to organizations and settings JSONB to branches.
-- 3. Adds clinic_services table with tenant-isolated RLS & RPC management.
-- 4. Adds org/branch settings, member reactivation, invitation revocation,
--    clinic client suspension/reactivation, and full doctor governance RPCs.
-- 5. Never grants Platform Owner privileges inside organization RPCs and never
--    assigns historical records to branches without verified source mapping.
-- ==============================================================================

-- 1. Organization & Branch Operational Settings Columns (Additive)
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS operational_settings JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 2. Clinic Services Catalogue (Org-wide or Branch-specific)
CREATE TABLE IF NOT EXISTS public.clinic_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  branch_id UUID,
  name VARCHAR(150) NOT NULL,
  code VARCHAR(40) NOT NULL,
  category VARCHAR(60) NOT NULL DEFAULT 'consultation'
    CHECK (category IN (
      'consultation',
      'vaccination',
      'diagnostics',
      'surgery',
      'dental',
      'preventive',
      'emergency',
      'follow_up'
    )),
  description TEXT,
  duration_minutes SMALLINT NOT NULL DEFAULT 30 CHECK (duration_minutes BETWEEN 5 AND 480),
  price NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT clinic_services_branch_fk
    FOREIGN KEY (branch_id, organization_id)
    REFERENCES public.branches(id, organization_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_clinic_services_org_code
  ON public.clinic_services(organization_id, upper(code));

CREATE INDEX IF NOT EXISTS idx_clinic_services_org_active
  ON public.clinic_services(organization_id, is_active);

ALTER TABLE public.clinic_services ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE ON public.clinic_services FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.clinic_services FROM anon;

DROP POLICY IF EXISTS "clinic_services_select_tenant" ON public.clinic_services;
CREATE POLICY "clinic_services_select_tenant"
ON public.clinic_services FOR SELECT TO authenticated
USING (
  (SELECT app.is_org_member(organization_id))
  OR (is_active = true AND (SELECT app.current_clinic_client_id(organization_id)) IS NOT NULL)
);

DROP TRIGGER IF EXISTS clinic_services_touch_updated_at ON public.clinic_services;
CREATE TRIGGER clinic_services_touch_updated_at
  BEFORE UPDATE ON public.clinic_services
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- 3. Extended Branch Management RPC (Full Branch Details + Settings)
CREATE OR REPLACE FUNCTION public.admin_upsert_branch(
  p_organization_id UUID,
  p_branch_id UUID DEFAULT NULL,
  p_name TEXT DEFAULT NULL,
  p_code TEXT DEFAULT NULL,
  p_timezone TEXT DEFAULT 'UTC',
  p_address TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL,
  p_state TEXT DEFAULT NULL,
  p_country TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT true,
  p_settings JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_branch public.branches;
  v_branch_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Authentication required' USING ERRCODE = '28000';
  END IF;

  IF NOT app.is_org_active(p_organization_id) THEN
    RAISE EXCEPTION 'Forbidden: Organization is inactive or unavailable' USING ERRCODE = '42501';
  END IF;

  IF NOT app.has_org_permission(p_organization_id, 'branch.manage') THEN
    RAISE EXCEPTION 'Forbidden: Missing branch.manage permission' USING ERRCODE = '42501';
  END IF;

  IF NULLIF(trim(COALESCE(p_name, '')), '') IS NULL
     OR NULLIF(trim(COALESCE(p_code, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Branch name and code are required' USING ERRCODE = '22023';
  END IF;

  IF p_branch_id IS NULL THEN
    INSERT INTO public.branches (
      organization_id, name, code, timezone, address, city, state, country, phone, is_active, settings
    )
    VALUES (
      p_organization_id,
      trim(p_name),
      upper(trim(p_code)),
      COALESCE(NULLIF(trim(COALESCE(p_timezone, '')), ''), 'UTC'),
      NULLIF(trim(COALESCE(p_address, '')), ''),
      NULLIF(trim(COALESCE(p_city, '')), ''),
      NULLIF(trim(COALESCE(p_state, '')), ''),
      NULLIF(trim(COALESCE(p_country, '')), ''),
      NULLIF(trim(COALESCE(p_phone, '')), ''),
      COALESCE(p_is_active, true),
      COALESCE(p_settings, '{}'::jsonb)
    )
    RETURNING id INTO v_branch_id;

    PERFORM app.write_audit_log(
      p_organization_id,
      v_uid,
      'CREATE_BRANCH',
      'branch',
      v_branch_id::TEXT,
      'Created clinic branch ' || upper(trim(p_code)) || ' (' || trim(p_name) || ')'
    );
  ELSE
    SELECT * INTO v_branch
    FROM public.branches
    WHERE id = p_branch_id
      AND organization_id = p_organization_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Branch % not found in organization', p_branch_id USING ERRCODE = 'P0002';
    END IF;

    UPDATE public.branches
    SET name = trim(p_name),
        code = upper(trim(p_code)),
        timezone = COALESCE(NULLIF(trim(COALESCE(p_timezone, '')), ''), timezone),
        address = NULLIF(trim(COALESCE(p_address, '')), ''),
        city = NULLIF(trim(COALESCE(p_city, '')), ''),
        state = NULLIF(trim(COALESCE(p_state, '')), ''),
        country = NULLIF(trim(COALESCE(p_country, '')), ''),
        phone = NULLIF(trim(COALESCE(p_phone, '')), ''),
        is_active = COALESCE(p_is_active, is_active),
        settings = COALESCE(p_settings, settings)
    WHERE id = p_branch_id
      AND organization_id = p_organization_id
    RETURNING id INTO v_branch_id;

    PERFORM app.write_audit_log(
      p_organization_id,
      v_uid,
      'UPDATE_BRANCH',
      'branch',
      v_branch_id::TEXT,
      'Updated branch ' || upper(trim(p_code)) || ' (active=' || COALESCE(p_is_active, v_branch.is_active)::TEXT || ')'
    );
  END IF;

  RETURN v_branch_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_upsert_branch(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_branch(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, JSONB) TO authenticated;

-- 4. Organization Settings Management RPC (Strictly org.manage)
CREATE OR REPLACE FUNCTION public.update_organization_settings(
  p_organization_id UUID,
  p_display_name TEXT DEFAULT NULL,
  p_legal_name TEXT DEFAULT NULL,
  p_timezone TEXT DEFAULT NULL,
  p_country TEXT DEFAULT NULL,
  p_contact_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_operational_settings JSONB DEFAULT NULL
)
RETURNS public.organizations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_org public.organizations;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Authentication required' USING ERRCODE = '28000';
  END IF;

  IF NOT app.is_org_active(p_organization_id) THEN
    RAISE EXCEPTION 'Forbidden: Organization is inactive or unavailable' USING ERRCODE = '42501';
  END IF;

  IF NOT app.has_org_permission(p_organization_id, 'org.manage') THEN
    RAISE EXCEPTION 'Forbidden: Only authorized organization owners (org.manage) may update organization settings' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_org
  FROM public.organizations
  WHERE id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.organizations
  SET display_name = COALESCE(NULLIF(trim(COALESCE(p_display_name, '')), ''), display_name),
      legal_name = COALESCE(NULLIF(trim(COALESCE(p_legal_name, '')), ''), legal_name),
      timezone = COALESCE(NULLIF(trim(COALESCE(p_timezone, '')), ''), timezone),
      country = COALESCE(NULLIF(trim(COALESCE(p_country, '')), ''), country),
      contact_email = CASE WHEN p_contact_email IS NULL THEN contact_email ELSE NULLIF(trim(p_contact_email), '') END,
      phone = CASE WHEN p_phone IS NULL THEN phone ELSE NULLIF(trim(p_phone), '') END,
      operational_settings = COALESCE(p_operational_settings, operational_settings)
  WHERE id = p_organization_id
  RETURNING * INTO v_org;

  PERFORM app.write_audit_log(
    p_organization_id,
    v_uid,
    'UPDATE_ORGANIZATION_SETTINGS',
    'organization',
    p_organization_id::TEXT,
    'Updated organization metadata and operational settings'
  );

  RETURN v_org;
END;
$$;
REVOKE ALL ON FUNCTION public.update_organization_settings(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_organization_settings(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) TO authenticated;

-- 5. Clinic Services Catalogue RPC
CREATE OR REPLACE FUNCTION public.upsert_clinic_service(
  p_organization_id UUID,
  p_service_id UUID DEFAULT NULL,
  p_branch_id UUID DEFAULT NULL,
  p_name TEXT DEFAULT NULL,
  p_code TEXT DEFAULT NULL,
  p_category TEXT DEFAULT 'consultation',
  p_description TEXT DEFAULT NULL,
  p_duration_minutes SMALLINT DEFAULT 30,
  p_price NUMERIC DEFAULT 0,
  p_is_active BOOLEAN DEFAULT true
)
RETURNS public.clinic_services
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_svc public.clinic_services;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Authentication required' USING ERRCODE = '28000';
  END IF;

  IF NOT app.is_org_active(p_organization_id) THEN
    RAISE EXCEPTION 'Forbidden: Organization is inactive or unavailable' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    app.has_org_permission(p_organization_id, 'org.manage')
    OR app.has_org_permission(p_organization_id, 'branch.manage')
    OR app.has_org_permission(p_organization_id, 'staff.manage')
  ) THEN
    RAISE EXCEPTION 'Forbidden: Missing permission to manage clinic services' USING ERRCODE = '42501';
  END IF;

  IF NULLIF(trim(COALESCE(p_name, '')), '') IS NULL
     OR NULLIF(trim(COALESCE(p_code, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Service name and code are required' USING ERRCODE = '22023';
  END IF;

  IF p_duration_minutes IS NULL OR p_duration_minutes < 5 OR p_duration_minutes > 480 THEN
    RAISE EXCEPTION 'Duration must be between 5 and 480 minutes' USING ERRCODE = '22023';
  END IF;

  IF p_price IS NULL OR p_price < 0 THEN
    RAISE EXCEPTION 'Service price must be non-negative' USING ERRCODE = '22023';
  END IF;

  IF p_branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.branches b
    WHERE b.id = p_branch_id AND b.organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'Branch % does not belong to organization', p_branch_id USING ERRCODE = '42501';
  END IF;

  IF p_service_id IS NULL THEN
    INSERT INTO public.clinic_services (
      organization_id, branch_id, name, code, category, description, duration_minutes, price, is_active, created_by
    )
    VALUES (
      p_organization_id,
      p_branch_id,
      trim(p_name),
      upper(trim(p_code)),
      COALESCE(NULLIF(trim(COALESCE(p_category, '')), ''), 'consultation'),
      NULLIF(trim(COALESCE(p_description, '')), ''),
      p_duration_minutes,
      p_price,
      COALESCE(p_is_active, true),
      v_uid
    )
    RETURNING * INTO v_svc;
  ELSE
    SELECT * INTO v_svc
    FROM public.clinic_services
    WHERE id = p_service_id
      AND organization_id = p_organization_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Clinic service not found in organization' USING ERRCODE = 'P0002';
    END IF;

    UPDATE public.clinic_services
    SET branch_id = p_branch_id,
        name = trim(p_name),
        code = upper(trim(p_code)),
        category = COALESCE(NULLIF(trim(COALESCE(p_category, '')), ''), category),
        description = NULLIF(trim(COALESCE(p_description, '')), ''),
        duration_minutes = p_duration_minutes,
        price = p_price,
        is_active = COALESCE(p_is_active, is_active)
    WHERE id = p_service_id
      AND organization_id = p_organization_id
    RETURNING * INTO v_svc;
  END IF;

  PERFORM app.write_audit_log(
    p_organization_id,
    v_uid,
    'UPSERT_CLINIC_SERVICE',
    'clinic_service',
    v_svc.id::TEXT,
    'Saved clinic service ' || v_svc.code || ' (' || v_svc.name || ')'
  );

  RETURN v_svc;
END;
$$;
REVOKE ALL ON FUNCTION public.upsert_clinic_service(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, SMALLINT, NUMERIC, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_clinic_service(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, SMALLINT, NUMERIC, BOOLEAN) TO authenticated;

-- 6. Staff Reactivation & Invitation Revocation RPCs
CREATE OR REPLACE FUNCTION public.reactivate_member(p_membership_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_mem public.organization_memberships;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_mem
  FROM public.organization_memberships
  WHERE id = p_membership_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Membership not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT app.is_org_active(v_mem.organization_id) THEN
    RAISE EXCEPTION 'Forbidden: Organization is inactive' USING ERRCODE = '42501';
  END IF;

  IF NOT app.has_org_permission(v_mem.organization_id, 'staff.manage') THEN
    RAISE EXCEPTION 'Forbidden: Missing staff.manage permission' USING ERRCODE = '42501';
  END IF;

  UPDATE public.organization_memberships
  SET status = 'active',
      suspended_at = NULL,
      suspension_reason = NULL,
      joined_at = COALESCE(joined_at, timezone('utc'::text, now()))
  WHERE id = p_membership_id;

  PERFORM app.write_audit_log(
    v_mem.organization_id,
    v_uid,
    'REACTIVATE_MEMBER',
    'organization_membership',
    p_membership_id::TEXT,
    'Reactivated staff membership'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.reactivate_member(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reactivate_member(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_staff_invitation(p_invitation_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_inv public.staff_invitations;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_inv
  FROM public.staff_invitations
  WHERE id = p_invitation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT app.is_org_active(v_inv.organization_id) THEN
    RAISE EXCEPTION 'Forbidden: Organization is inactive' USING ERRCODE = '42501';
  END IF;

  IF NOT app.has_org_permission(v_inv.organization_id, 'staff.manage') THEN
    RAISE EXCEPTION 'Forbidden: Missing staff.manage permission' USING ERRCODE = '42501';
  END IF;

  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot revoke an invitation that has already been accepted' USING ERRCODE = '22023';
  END IF;

  IF v_inv.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation is already revoked' USING ERRCODE = '22023';
  END IF;

  UPDATE public.staff_invitations
  SET revoked_at = timezone('utc'::text, now())
  WHERE id = p_invitation_id;

  PERFORM app.write_audit_log(
    v_inv.organization_id,
    v_uid,
    'REVOKE_STAFF_INVITATION',
    'staff_invitation',
    p_invitation_id::TEXT,
    'Revoked pending staff invitation for ' || v_inv.email
  );
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_staff_invitation(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_staff_invitation(UUID) TO authenticated;

-- 7. Clinic Client Suspension & Reactivation RPCs
CREATE OR REPLACE FUNCTION public.suspend_clinic_client(
  p_clinic_client_id UUID,
  p_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_cc public.clinic_clients;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000';
  END IF;

  IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Suspension reason is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_cc
  FROM public.clinic_clients
  WHERE id = p_clinic_client_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Clinic client not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT app.is_org_active(v_cc.organization_id) THEN
    RAISE EXCEPTION 'Forbidden: Organization is inactive' USING ERRCODE = '42501';
  END IF;

  IF NOT app.has_org_permission(v_cc.organization_id, 'clients.approve') THEN
    RAISE EXCEPTION 'Forbidden: Missing clients.approve permission' USING ERRCODE = '42501';
  END IF;

  UPDATE public.clinic_clients
  SET status = 'suspended',
      rejection_reason = trim(p_reason)
  WHERE id = p_clinic_client_id;

  PERFORM app.write_audit_log(
    v_cc.organization_id,
    v_uid,
    'SUSPEND_CLINIC_CLIENT',
    'clinic_client',
    p_clinic_client_id::TEXT,
    'Suspended clinic client: ' || trim(p_reason)
  );

  IF v_cc.user_id IS NOT NULL THEN
    PERFORM app.enqueue_notification(
      v_cc.organization_id,
      v_cc.user_id,
      'Clinic Membership Suspended',
      'Your clinic access has been suspended: ' || trim(p_reason),
      'membership'::public.notification_type_enum,
      '/workspaces'
    );
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.suspend_clinic_client(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.suspend_clinic_client(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.reactivate_clinic_client(p_clinic_client_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_cc public.clinic_clients;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_cc
  FROM public.clinic_clients
  WHERE id = p_clinic_client_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Clinic client not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT app.is_org_active(v_cc.organization_id) THEN
    RAISE EXCEPTION 'Forbidden: Organization is inactive' USING ERRCODE = '42501';
  END IF;

  IF NOT app.has_org_permission(v_cc.organization_id, 'clients.approve') THEN
    RAISE EXCEPTION 'Forbidden: Missing clients.approve permission' USING ERRCODE = '42501';
  END IF;

  UPDATE public.clinic_clients
  SET status = 'approved',
      approved_by = v_uid,
      approved_at = timezone('utc'::text, now()),
      rejected_by = NULL,
      rejected_at = NULL,
      rejection_reason = NULL
  WHERE id = p_clinic_client_id;

  PERFORM app.write_audit_log(
    v_cc.organization_id,
    v_uid,
    'REACTIVATE_CLINIC_CLIENT',
    'clinic_client',
    p_clinic_client_id::TEXT,
    'Reactivated clinic client membership'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.reactivate_clinic_client(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reactivate_clinic_client(UUID) TO authenticated;

-- 8. Full Doctor Profile & Governance Update RPC (Strictly staff.manage)
CREATE OR REPLACE FUNCTION public.admin_update_doctor_profile_and_governance(
  p_doctor_profile_id UUID,
  p_display_name TEXT DEFAULT NULL,
  p_qualification TEXT DEFAULT NULL,
  p_specialization TEXT DEFAULT NULL,
  p_experience_years INT DEFAULT NULL,
  p_registration_number TEXT DEFAULT NULL,
  p_bio TEXT DEFAULT NULL,
  p_consultation_fee NUMERIC DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_doc public.doctor_profiles;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_doc
  FROM public.doctor_profiles
  WHERE id = p_doctor_profile_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Doctor profile not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT app.is_org_active(v_doc.organization_id) THEN
    RAISE EXCEPTION 'Forbidden: Organization is inactive' USING ERRCODE = '42501';
  END IF;

  IF NOT app.has_org_permission(v_doc.organization_id, 'staff.manage') THEN
    RAISE EXCEPTION 'Forbidden: Missing staff.manage permission' USING ERRCODE = '42501';
  END IF;

  IF p_consultation_fee IS NOT NULL AND p_consultation_fee < 0 THEN
    RAISE EXCEPTION 'Consultation fee must be non-negative' USING ERRCODE = '22023';
  END IF;

  IF p_experience_years IS NOT NULL AND p_experience_years < 0 THEN
    RAISE EXCEPTION 'Experience years must be non-negative' USING ERRCODE = '22023';
  END IF;

  UPDATE public.doctor_profiles
  SET display_name = COALESCE(NULLIF(trim(COALESCE(p_display_name, '')), ''), display_name),
      qualification = COALESCE(NULLIF(trim(COALESCE(p_qualification, '')), ''), qualification),
      specialization = COALESCE(NULLIF(trim(COALESCE(p_specialization, '')), ''), specialization),
      experience_years = COALESCE(p_experience_years, experience_years),
      registration_number = CASE
        WHEN p_registration_number IS NULL THEN registration_number
        ELSE NULLIF(trim(p_registration_number), '')
      END,
      bio = CASE WHEN p_bio IS NULL THEN bio ELSE p_bio END,
      consultation_fee = COALESCE(p_consultation_fee, consultation_fee),
      is_active = COALESCE(p_is_active, is_active)
  WHERE id = p_doctor_profile_id;

  PERFORM app.write_audit_log(
    v_doc.organization_id,
    v_uid,
    'ADMIN_UPDATE_DOCTOR_PROFILE',
    'doctor_profile',
    p_doctor_profile_id::TEXT,
    'Updated doctor profile and governance settings',
    jsonb_build_object('is_active', v_doc.is_active, 'consultation_fee', v_doc.consultation_fee),
    jsonb_build_object(
      'is_active', COALESCE(p_is_active, v_doc.is_active),
      'consultation_fee', COALESCE(p_consultation_fee, v_doc.consultation_fee)
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_update_doctor_profile_and_governance(UUID, TEXT, TEXT, TEXT, INT, TEXT, TEXT, NUMERIC, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_doctor_profile_and_governance(UUID, TEXT, TEXT, TEXT, INT, TEXT, TEXT, NUMERIC, BOOLEAN) TO authenticated;
