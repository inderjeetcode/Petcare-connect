-- ==============================================================================
-- PET CONNECT VETERINARY HEALTHCARE PLATFORM
-- Migration 4 (Phase 2b Helpers & RPCs): Authorization Helpers & Hardened RPCs
-- File: supabase/migrations/20261113040000_phase2b_app_helpers_and_rpcs.sql
-- ==============================================================================
-- SECURITY STANDARDS:
-- - Every helper and RPC uses SECURITY DEFINER + SET search_path = ''
-- - All object references are schema-qualified (public.*, app.*, auth.uid())
-- - Zero anon or PUBLIC execute permissions on any RPC
-- - All state transitions lock target rows (SELECT ... FOR UPDATE)
-- - Every workflow & clinical mutation writes server-side audit_logs
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- SECTION A: AUTHORIZATION & INTERNAL HELPERS (app SCHEMA)
-- ------------------------------------------------------------------------------

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
      WHERE pa.user_id = auth.uid()
        AND pa.is_active = true
    )
  END;
$$;
REVOKE ALL ON FUNCTION app.is_platform_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.is_platform_admin() TO authenticated;

CREATE OR REPLACE FUNCTION app.is_org_active(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_org_id IS NULL THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.organizations o
      WHERE o.id = p_org_id
        AND o.status = 'active'
    )
  END;
$$;
REVOKE ALL ON FUNCTION app.is_org_active(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.is_org_active(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION app.is_org_member(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL OR p_org_id IS NULL THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.organization_memberships om
      JOIN public.organizations o ON o.id = om.organization_id
      WHERE om.organization_id = p_org_id
        AND om.user_id = auth.uid()
        AND om.status = 'active'
        AND o.status = 'active'
    )
  END;
$$;
REVOKE ALL ON FUNCTION app.is_org_member(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.is_org_member(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION app.has_org_permission(p_org_id UUID, p_perm TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL OR p_org_id IS NULL OR p_perm IS NULL THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.organization_memberships om
      JOIN public.organizations o ON o.id = om.organization_id
      JOIN public.membership_roles mr
        ON mr.membership_id = om.id
       AND mr.organization_id = om.organization_id
      JOIN public.role_permissions rp ON rp.role_id = mr.role_id
      WHERE om.organization_id = p_org_id
        AND om.user_id = auth.uid()
        AND om.status = 'active'
        AND o.status = 'active'
        AND rp.permission_code = p_perm
    )
  END;
$$;
REVOKE ALL ON FUNCTION app.has_org_permission(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.has_org_permission(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION app.has_branch_access(p_org_id UUID, p_branch_id UUID, p_perm TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL OR p_org_id IS NULL OR p_perm IS NULL THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.organization_memberships om
      JOIN public.organizations o ON o.id = om.organization_id
      JOIN public.membership_roles mr
        ON mr.membership_id = om.id
       AND mr.organization_id = om.organization_id
      JOIN public.role_permissions rp ON rp.role_id = mr.role_id
      WHERE om.organization_id = p_org_id
        AND om.user_id = auth.uid()
        AND om.status = 'active'
        AND o.status = 'active'
        AND rp.permission_code = p_perm
        AND (
          -- Org-wide staff have zero rows in membership_branches
          NOT EXISTS (
            SELECT 1 FROM public.membership_branches mb
            WHERE mb.membership_id = om.id
              AND mb.organization_id = om.organization_id
          )
          OR (
            p_branch_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM public.membership_branches mb
              WHERE mb.membership_id = om.id
                AND mb.organization_id = om.organization_id
                AND mb.branch_id = p_branch_id
            )
          )
        )
    )
  END;
$$;
REVOKE ALL ON FUNCTION app.has_branch_access(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.has_branch_access(UUID, UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION app.current_clinic_client_id(p_org_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT cc.id
  FROM public.clinic_clients cc
  JOIN public.organizations o ON o.id = cc.organization_id
  WHERE cc.organization_id = p_org_id
    AND cc.user_id = auth.uid()
    AND cc.status = 'approved'
    AND o.status = 'active'
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION app.current_clinic_client_id(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.current_clinic_client_id(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION app.is_pet_guardian(p_org_id UUID, p_pet_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL OR p_org_id IS NULL OR p_pet_id IS NULL THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.pet_guardians pg
      JOIN public.clinic_clients cc
        ON cc.id = pg.clinic_client_id
       AND cc.organization_id = pg.organization_id
      JOIN public.organizations o ON o.id = pg.organization_id
      WHERE pg.organization_id = p_org_id
        AND pg.pet_id = p_pet_id
        AND cc.user_id = auth.uid()
        AND cc.status = 'approved'
        AND o.status = 'active'
    )
  END;
$$;
REVOKE ALL ON FUNCTION app.is_pet_guardian(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.is_pet_guardian(UUID, UUID) TO authenticated;

-- STRICT PARTICIPANT CHECK (D-16):
-- Only the consultation's approved clinic_client (user_id = auth.uid()) OR its treating active doctor
-- (doctor_profiles.user_id = auth.uid() with active org membership) may read chat history.
-- Organization admins, owners, front desk, unrelated doctors, and platform_admins are EXCLUDED.
CREATE OR REPLACE FUNCTION app.is_consultation_participant(p_consultation_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL OR p_consultation_id IS NULL THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.consultations c
      JOIN public.organizations o ON o.id = c.organization_id
      WHERE c.id = p_consultation_id
        AND o.status = 'active'
        AND (
          EXISTS (
            SELECT 1
            FROM public.clinic_clients cc
            WHERE cc.id = c.clinic_client_id
              AND cc.organization_id = c.organization_id
              AND cc.user_id = auth.uid()
              AND cc.status = 'approved'
          )
          OR EXISTS (
            SELECT 1
            FROM public.doctor_profiles dp
            JOIN public.organization_memberships om
              ON om.organization_id = dp.organization_id
             AND om.user_id = dp.user_id
            WHERE dp.id = c.doctor_id
              AND dp.organization_id = c.organization_id
              AND dp.user_id = auth.uid()
              AND om.status = 'active'
          )
        )
    )
  END;
$$;
REVOKE ALL ON FUNCTION app.is_consultation_participant(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.is_consultation_participant(UUID) TO authenticated;

-- Internal-only helper: audit log writer (NEVER exposed to API roles)
CREATE OR REPLACE FUNCTION app.write_audit_log(
  p_org_id UUID,
  p_actor_user_id UUID,
  p_action TEXT,
  p_entity_type TEXT,
  p_entity_id TEXT,
  p_details TEXT,
  p_before JSONB DEFAULT NULL,
  p_after JSONB DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.audit_logs (
    organization_id,
    user_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    details,
    before_json,
    after_json,
    created_at
  )
  VALUES (
    p_org_id,
    p_actor_user_id,
    p_actor_user_id,
    p_action,
    p_entity_type,
    p_entity_id,
    p_details,
    p_before,
    p_after,
    timezone('utc'::text, now())
  );
END;
$$;
REVOKE ALL ON FUNCTION app.write_audit_log(UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB) FROM PUBLIC, anon, authenticated;

-- Internal-only helper: notification dispatcher (NEVER exposed to API roles)
CREATE OR REPLACE FUNCTION app.enqueue_notification(
  p_org_id UUID,
  p_user_id UUID,
  p_title TEXT,
  p_message TEXT,
  p_type public.notification_type_enum,
  p_link_url TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.notifications (
    organization_id,
    user_id,
    title,
    message,
    notification_type,
    is_read,
    link_url,
    created_at
  )
  VALUES (
    p_org_id,
    p_user_id,
    left(p_title, 150),
    p_message,
    p_type,
    false,
    p_link_url,
    timezone('utc'::text, now())
  );
END;
$$;
REVOKE ALL ON FUNCTION app.enqueue_notification(UUID, UUID, TEXT, TEXT, public.notification_type_enum, TEXT) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- SECTION B: CONTEXT & PLATFORM ONBOARDING RPCs
-- ------------------------------------------------------------------------------

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
    'avatar_url', p.avatar_url
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

CREATE OR REPLACE FUNCTION public.submit_organization_application(
  p_proposed_name TEXT,
  p_proposed_slug TEXT,
  p_legal_name TEXT,
  p_contact_email TEXT,
  p_phone TEXT,
  p_country TEXT,
  p_timezone TEXT,
  p_branch_name TEXT,
  p_branch_code TEXT,
  p_branch_address TEXT,
  p_documents JSONB DEFAULT '[]'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_slug TEXT := lower(trim(p_proposed_slug));
  v_app_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Authentication required' USING ERRCODE = '28000';
  END IF;

  IF NULLIF(trim(p_proposed_name), '') IS NULL OR NULLIF(v_slug, '') IS NULL OR NULLIF(trim(p_branch_name), '') IS NULL THEN
    RAISE EXCEPTION 'Invalid input: organization name, slug, and initial branch name are required' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM public.organizations WHERE slug = v_slug) THEN
    RAISE EXCEPTION 'Slug % is already registered', v_slug USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.organization_applications (
    applicant_user_id, proposed_name, proposed_slug, legal_name, contact_email, phone,
    country, timezone, initial_branch_name, initial_branch_code, initial_branch_address, documents, status
  )
  VALUES (
    v_uid, trim(p_proposed_name), v_slug, COALESCE(NULLIF(trim(p_legal_name), ''), trim(p_proposed_name)),
    trim(p_contact_email), trim(p_phone), COALESCE(NULLIF(trim(p_country), ''), 'IN'),
    COALESCE(NULLIF(trim(p_timezone), ''), 'UTC'), trim(p_branch_name),
    upper(COALESCE(NULLIF(trim(p_branch_code), ''), 'BR01')), trim(p_branch_address),
    COALESCE(p_documents, '[]'::jsonb), 'pending'
  )
  RETURNING id INTO v_app_id;

  PERFORM app.write_audit_log(
    NULL, v_uid, 'SUBMIT_ORG_APPLICATION', 'organization_application', v_app_id::TEXT,
    'Submitted application for clinic ' || trim(p_proposed_name) || ' (' || v_slug || ')'
  );

  RETURN v_app_id;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_organization_application(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_organization_application(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_organization_application(p_application_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_app public.organization_applications;
  v_org_id UUID;
  v_branch_id UUID;
  v_membership_id UUID;
  v_owner_role_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Authentication required' USING ERRCODE = '28000';
  END IF;

  IF NOT app.is_platform_admin() THEN
    RAISE EXCEPTION 'Forbidden: Only Platform Owner can approve organizations' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_app
  FROM public.organization_applications
  WHERE id = p_application_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application % not found', p_application_id USING ERRCODE = 'P0002';
  END IF;

  IF v_app.status <> 'pending' THEN
    RAISE EXCEPTION 'Invalid State: Application is already %', v_app.status USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.organizations (
    slug, legal_name, display_name, status, timezone, country, contact_email, phone,
    created_by, approved_by, approved_at
  )
  VALUES (
    v_app.proposed_slug, v_app.legal_name, v_app.proposed_name, 'active',
    v_app.timezone, v_app.country, v_app.contact_email, v_app.phone,
    v_app.applicant_user_id, v_uid, timezone('utc'::text, now())
  )
  RETURNING id INTO v_org_id;

  INSERT INTO public.branches (
    organization_id, name, code, address, country, timezone, phone, is_active
  )
  VALUES (
    v_org_id, v_app.initial_branch_name, v_app.initial_branch_code,
    v_app.initial_branch_address, v_app.country, v_app.timezone, v_app.phone, true
  )
  RETURNING id INTO v_branch_id;

  INSERT INTO public.organization_memberships (
    organization_id, user_id, status, invited_by, joined_at
  )
  VALUES (
    v_org_id, v_app.applicant_user_id, 'active', v_uid, timezone('utc'::text, now())
  )
  RETURNING id INTO v_membership_id;

  SELECT id INTO v_owner_role_id FROM public.organization_roles WHERE code = 'org_owner';

  INSERT INTO public.membership_roles (membership_id, organization_id, role_id, assigned_by)
  VALUES (v_membership_id, v_org_id, v_owner_role_id, v_uid);

  UPDATE public.organization_applications
  SET status = 'approved',
      reviewed_by = v_uid,
      reviewed_at = timezone('utc'::text, now()),
      organization_id = v_org_id
  WHERE id = p_application_id;

  PERFORM app.write_audit_log(
    v_org_id, v_uid, 'APPROVE_ORG_APPLICATION', 'organization', v_org_id::TEXT,
    'Approved clinic application ' || p_application_id::TEXT || ' and provisioned initial branch ' || v_branch_id::TEXT
  );

  PERFORM app.enqueue_notification(
    v_org_id, v_app.applicant_user_id, 'Clinic Approved',
    'Your veterinary clinic ' || v_app.proposed_name || ' has been approved and activated.',
    'system'::public.notification_type_enum, '/' || v_app.proposed_slug || '/admin/dashboard'
  );

  RETURN v_org_id;
END;
$$;
REVOKE ALL ON FUNCTION public.approve_organization_application(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_organization_application(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_organization_application(p_application_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_app public.organization_applications;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000';
  END IF;
  IF NOT app.is_platform_admin() THEN
    RAISE EXCEPTION 'Forbidden: Only Platform Owner can reject applications' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Rejection reason is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_app FROM public.organization_applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_app.status <> 'pending' THEN
    RAISE EXCEPTION 'Application is not pending' USING ERRCODE = '22023';
  END IF;

  UPDATE public.organization_applications
  SET status = 'rejected',
      reviewed_by = v_uid,
      reviewed_at = timezone('utc'::text, now()),
      decision_reason = trim(p_reason)
  WHERE id = p_application_id;

  PERFORM app.write_audit_log(
    NULL, v_uid, 'REJECT_ORG_APPLICATION', 'organization_application', p_application_id::TEXT,
    'Rejected clinic application: ' || trim(p_reason)
  );
  PERFORM app.enqueue_notification(
    NULL, v_app.applicant_user_id, 'Clinic Application Update',
    'Your clinic application was declined: ' || trim(p_reason),
    'system'::public.notification_type_enum, '/workspaces'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.reject_organization_application(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_organization_application(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.suspend_organization(p_organization_id UUID, p_reason TEXT)
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
  IF NOT app.is_platform_admin() THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501'; END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Suspension reason required' USING ERRCODE = '22023'; END IF;

  SELECT * INTO v_org FROM public.organizations WHERE id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Organization not found' USING ERRCODE = 'P0002'; END IF;

  UPDATE public.organizations SET status = 'suspended' WHERE id = p_organization_id;

  PERFORM app.write_audit_log(
    p_organization_id, v_uid, 'SUSPEND_ORGANIZATION', 'organization', p_organization_id::TEXT,
    'Suspended organization: ' || trim(p_reason),
    jsonb_build_object('status', v_org.status),
    jsonb_build_object('status', 'suspended', 'reason', trim(p_reason))
  );
END;
$$;
REVOKE ALL ON FUNCTION public.suspend_organization(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.suspend_organization(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.reactivate_organization(p_organization_id UUID)
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
  IF NOT app.is_platform_admin() THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501'; END IF;

  SELECT * INTO v_org FROM public.organizations WHERE id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Organization not found' USING ERRCODE = 'P0002'; END IF;
  IF v_org.status <> 'suspended' THEN RAISE EXCEPTION 'Only suspended organizations can be reactivated' USING ERRCODE = '22023'; END IF;

  UPDATE public.organizations SET status = 'active' WHERE id = p_organization_id;

  PERFORM app.write_audit_log(
    p_organization_id, v_uid, 'REACTIVATE_ORGANIZATION', 'organization', p_organization_id::TEXT,
    'Reactivated organization',
    jsonb_build_object('status', v_org.status),
    jsonb_build_object('status', 'active')
  );
END;
$$;
REVOKE ALL ON FUNCTION public.reactivate_organization(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reactivate_organization(UUID) TO authenticated;

-- ------------------------------------------------------------------------------
-- SECTION C: BRANCHES, STAFF MEMBERSHIPS & CLINIC CLIENT ONBOARDING RPCs
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_or_update_branch(
  p_organization_id UUID,
  p_branch_id UUID,
  p_name TEXT,
  p_code TEXT,
  p_timezone TEXT,
  p_address TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT true
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_branch_id UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  IF NOT app.has_org_permission(p_organization_id, 'branch.manage') THEN
    RAISE EXCEPTION 'Forbidden: Missing branch.manage permission' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(trim(p_name), '') IS NULL OR NULLIF(trim(p_code), '') IS NULL THEN
    RAISE EXCEPTION 'Branch name and code are required' USING ERRCODE = '22023';
  END IF;

  IF p_branch_id IS NULL THEN
    INSERT INTO public.branches (organization_id, name, code, timezone, address, phone, is_active)
    VALUES (p_organization_id, trim(p_name), upper(trim(p_code)), COALESCE(NULLIF(trim(p_timezone), ''), 'UTC'), p_address, p_phone, COALESCE(p_is_active, true))
    RETURNING id INTO v_branch_id;
  ELSE
    UPDATE public.branches
    SET name = trim(p_name),
        code = upper(trim(p_code)),
        timezone = COALESCE(NULLIF(trim(p_timezone), ''), timezone),
        address = COALESCE(p_address, address),
        phone = COALESCE(p_phone, phone),
        is_active = COALESCE(p_is_active, is_active)
    WHERE id = p_branch_id AND organization_id = p_organization_id
    RETURNING id INTO v_branch_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Branch % not found in organization', p_branch_id USING ERRCODE = 'P0002';
    END IF;
  END IF;

  PERFORM app.write_audit_log(
    p_organization_id, v_uid,
    CASE WHEN p_branch_id IS NULL THEN 'CREATE_BRANCH' ELSE 'UPDATE_BRANCH' END,
    'branch', v_branch_id::TEXT, 'Branch ' || upper(trim(p_code)) || ' saved'
  );

  RETURN v_branch_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_or_update_branch(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_or_update_branch(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.assign_doctor_to_branch(
  p_organization_id UUID,
  p_doctor_profile_id UUID,
  p_branch_id UUID,
  p_is_active BOOLEAN DEFAULT true
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  IF NOT app.has_org_permission(p_organization_id, 'staff.manage') THEN
    RAISE EXCEPTION 'Forbidden: Missing staff.manage permission' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.doctor_profiles WHERE id = p_doctor_profile_id AND organization_id = p_organization_id) THEN
    RAISE EXCEPTION 'Doctor does not belong to organization' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch_id AND organization_id = p_organization_id) THEN
    RAISE EXCEPTION 'Branch does not belong to organization' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.doctor_branch_assignments (organization_id, doctor_profile_id, branch_id, is_active)
  VALUES (p_organization_id, p_doctor_profile_id, p_branch_id, COALESCE(p_is_active, true))
  ON CONFLICT (doctor_profile_id, branch_id) DO UPDATE
    SET is_active = EXCLUDED.is_active,
        updated_at = timezone('utc'::text, now());

  PERFORM app.write_audit_log(
    p_organization_id, v_uid, 'ASSIGN_DOCTOR_BRANCH', 'doctor_branch_assignment',
    p_doctor_profile_id::TEXT || ':' || p_branch_id::TEXT,
    'Doctor branch assignment active=' || COALESCE(p_is_active, true)::TEXT
  );
END;
$$;
REVOKE ALL ON FUNCTION public.assign_doctor_to_branch(UUID, UUID, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_doctor_to_branch(UUID, UUID, UUID, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_member_roles(
  p_membership_id UUID,
  p_role_codes TEXT[],
  p_branch_ids UUID[] DEFAULT '{}'::uuid[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_mem public.organization_memberships;
  v_code TEXT;
  v_role_id UUID;
  v_bid UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  IF cardinality(p_role_codes) < 1 THEN RAISE EXCEPTION 'At least one role is required' USING ERRCODE = '22023'; END IF;

  SELECT * INTO v_mem FROM public.organization_memberships WHERE id = p_membership_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Membership not found' USING ERRCODE = 'P0002'; END IF;

  IF NOT app.has_org_permission(v_mem.organization_id, 'staff.manage') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF ('org_owner' = ANY(p_role_codes) OR 'org_admin' = ANY(p_role_codes))
     AND NOT app.has_org_permission(v_mem.organization_id, 'roles.assign_admin') THEN
    RAISE EXCEPTION 'Forbidden: Only org_owner can grant org_owner or org_admin' USING ERRCODE = '42501';
  END IF;

  -- Prevent removing the last org_owner in an organization
  IF NOT ('org_owner' = ANY(p_role_codes)) AND EXISTS (
    SELECT 1
    FROM public.membership_roles mr
    JOIN public.organization_roles r ON r.id = mr.role_id
    WHERE mr.membership_id = p_membership_id AND r.code = 'org_owner'
  ) THEN
    IF (
      SELECT count(*)
      FROM public.membership_roles mr
      JOIN public.organization_roles r ON r.id = mr.role_id
      JOIN public.organization_memberships om ON om.id = mr.membership_id
      WHERE mr.organization_id = v_mem.organization_id
        AND r.code = 'org_owner'
        AND om.status = 'active'
        AND om.id <> p_membership_id
    ) = 0 THEN
      RAISE EXCEPTION 'Cannot remove last active org_owner' USING ERRCODE = '22023';
    END IF;
  END IF;

  DELETE FROM public.membership_roles WHERE membership_id = p_membership_id AND organization_id = v_mem.organization_id;

  FOREACH v_code IN ARRAY p_role_codes LOOP
    SELECT id INTO v_role_id FROM public.organization_roles WHERE code = v_code;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown role code %', v_code USING ERRCODE = '22023'; END IF;
    INSERT INTO public.membership_roles (membership_id, organization_id, role_id, assigned_by)
    VALUES (p_membership_id, v_mem.organization_id, v_role_id, v_uid);
  END LOOP;

  DELETE FROM public.membership_branches WHERE membership_id = p_membership_id AND organization_id = v_mem.organization_id;
  IF p_branch_ids IS NOT NULL THEN
    FOREACH v_bid IN ARRAY p_branch_ids LOOP
      INSERT INTO public.membership_branches (membership_id, organization_id, branch_id)
      VALUES (p_membership_id, v_mem.organization_id, v_bid);
    END LOOP;
  END IF;

  PERFORM app.write_audit_log(
    v_mem.organization_id, v_uid, 'SET_MEMBER_ROLES', 'organization_membership', p_membership_id::TEXT,
    'Updated roles to ' || array_to_string(p_role_codes, ',')
  );
END;
$$;
REVOKE ALL ON FUNCTION public.set_member_roles(UUID, TEXT[], UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_member_roles(UUID, TEXT[], UUID[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.suspend_member(p_membership_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_mem public.organization_memberships;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v_mem FROM public.organization_memberships WHERE id = p_membership_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Membership not found' USING ERRCODE = 'P0002'; END IF;

  IF NOT app.has_org_permission(v_mem.organization_id, 'staff.manage') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_mem.user_id = v_uid THEN
    RAISE EXCEPTION 'Cannot suspend your own membership' USING ERRCODE = '22023';
  END IF;

  UPDATE public.organization_memberships
  SET status = 'suspended',
      suspended_at = timezone('utc'::text, now()),
      suspension_reason = NULLIF(trim(p_reason), '')
  WHERE id = p_membership_id;

  PERFORM app.write_audit_log(
    v_mem.organization_id, v_uid, 'SUSPEND_MEMBER', 'organization_membership', p_membership_id::TEXT,
    'Suspended member: ' || COALESCE(NULLIF(trim(p_reason), ''), 'none')
  );
END;
$$;
REVOKE ALL ON FUNCTION public.suspend_member(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.suspend_member(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.request_clinic_join(p_organization_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_profile public.profiles;
  v_client public.clinic_clients;
  v_cc_id UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  IF NOT app.is_org_active(p_organization_id) THEN
    RAISE EXCEPTION 'Target organization is unavailable' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO v_client
  FROM public.clinic_clients
  WHERE organization_id = p_organization_id AND user_id = v_uid
  FOR UPDATE;

  IF FOUND THEN
    IF v_client.status = 'approved' THEN
      RETURN v_client.id;
    ELSIF v_client.status = 'suspended' THEN
      RAISE EXCEPTION 'Client membership is suspended in this clinic' USING ERRCODE = '42501';
    END IF;
    UPDATE public.clinic_clients
    SET status = 'requested',
        requested_at = timezone('utc'::text, now()),
        rejection_reason = NULL
    WHERE id = v_client.id
    RETURNING id INTO v_cc_id;
  ELSE
    INSERT INTO public.clinic_clients (
      organization_id, user_id, full_name, email, phone, status, source
    )
    VALUES (
      p_organization_id, v_uid, v_profile.full_name, v_profile.email, v_profile.phone, 'requested', 'self-request'
    )
    RETURNING id INTO v_cc_id;
  END IF;

  PERFORM app.write_audit_log(
    p_organization_id, v_uid, 'REQUEST_CLINIC_JOIN', 'clinic_client', v_cc_id::TEXT,
    'User requested client membership'
  );
  RETURN v_cc_id;
END;
$$;
REVOKE ALL ON FUNCTION public.request_clinic_join(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_clinic_join(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_clinic_client(p_clinic_client_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_cc public.clinic_clients;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v_cc FROM public.clinic_clients WHERE id = p_clinic_client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Clinic client not found' USING ERRCODE = 'P0002'; END IF;

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
    v_cc.organization_id, v_uid, 'APPROVE_CLINIC_CLIENT', 'clinic_client', p_clinic_client_id::TEXT,
    'Approved clinic client'
  );
  PERFORM app.enqueue_notification(
    v_cc.organization_id, v_cc.user_id, 'Clinic Access Approved',
    'Your clinic membership request has been approved.',
    'join_request'::public.notification_type_enum, '/workspaces'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.approve_clinic_client(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_clinic_client(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_clinic_client(p_clinic_client_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_cc public.clinic_clients;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v_cc FROM public.clinic_clients WHERE id = p_clinic_client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Clinic client not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT app.has_org_permission(v_cc.organization_id, 'clients.approve') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Rejection reason is required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.clinic_clients
  SET status = 'rejected',
      rejected_by = v_uid,
      rejected_at = timezone('utc'::text, now()),
      rejection_reason = trim(p_reason)
  WHERE id = p_clinic_client_id;

  PERFORM app.write_audit_log(
    v_cc.organization_id, v_uid, 'REJECT_CLINIC_CLIENT', 'clinic_client', p_clinic_client_id::TEXT,
    'Rejected clinic client: ' || trim(p_reason)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.reject_clinic_client(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_clinic_client(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_walk_in_client(
  p_organization_id UUID,
  p_full_name TEXT,
  p_phone TEXT,
  p_email TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_cc_id UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  IF NOT app.has_org_permission(p_organization_id, 'clients.approve') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(trim(p_full_name), '') IS NULL THEN
    RAISE EXCEPTION 'Client full name required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.clinic_clients (
    organization_id, user_id, full_name, email, phone, status, approved_by, approved_at, source
  )
  VALUES (
    p_organization_id, NULL, trim(p_full_name), NULLIF(trim(p_email), ''), NULLIF(trim(p_phone), ''),
    'approved', v_uid, timezone('utc'::text, now()), 'walk-in'
  )
  RETURNING id INTO v_cc_id;

  PERFORM app.write_audit_log(
    p_organization_id, v_uid, 'CREATE_WALK_IN_CLIENT', 'clinic_client', v_cc_id::TEXT,
    'Created walk-in clinic client ' || trim(p_full_name)
  );
  RETURN v_cc_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_walk_in_client(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_walk_in_client(UUID, TEXT, TEXT, TEXT) TO authenticated;

-- ------------------------------------------------------------------------------
-- SECTION D: PETS, GUARDIANS & SCHEDULING RPCs
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_pet(
  p_organization_id UUID,
  p_clinic_client_id UUID,
  p_name TEXT,
  p_species TEXT,
  p_breed TEXT,
  p_gender TEXT,
  p_weight NUMERIC,
  p_dob DATE DEFAULT NULL,
  p_color TEXT DEFAULT NULL,
  p_allergies TEXT DEFAULT NULL,
  p_medical_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_cc public.clinic_clients;
  v_self_cc_id UUID;
  v_pet_id UUID;
  v_legacy_owner UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  IF NOT app.is_org_active(p_organization_id) THEN
    RAISE EXCEPTION 'Organization unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cc
  FROM public.clinic_clients
  WHERE id = p_clinic_client_id AND organization_id = p_organization_id;

  IF NOT FOUND OR v_cc.status <> 'approved' THEN
    RAISE EXCEPTION 'Clinic client must be approved in this organization' USING ERRCODE = '42501';
  END IF;

  v_self_cc_id := app.current_clinic_client_id(p_organization_id);
  IF NOT (
    (v_self_cc_id IS NOT NULL AND v_self_cc_id = p_clinic_client_id)
    OR app.has_org_permission(p_organization_id, 'pets.write')
  ) THEN
    RAISE EXCEPTION 'Forbidden: Cannot register pet for another client' USING ERRCODE = '42501';
  END IF;

  -- Preserve compatibility with baseline non-null owner_id column during transition
  v_legacy_owner := COALESCE(v_cc.user_id, v_uid);

  INSERT INTO public.pets (
    organization_id, owner_id, created_by, name, species, breed, date_of_birth,
    gender, weight, color, allergies, medical_notes
  )
  VALUES (
    p_organization_id, v_legacy_owner, v_uid, trim(p_name), trim(p_species), trim(p_breed),
    p_dob, trim(p_gender), p_weight, p_color, p_allergies, p_medical_notes
  )
  RETURNING id INTO v_pet_id;

  INSERT INTO public.pet_guardians (organization_id, pet_id, clinic_client_id, relationship, is_primary)
  VALUES (p_organization_id, v_pet_id, p_clinic_client_id, 'owner', true);

  PERFORM app.write_audit_log(
    p_organization_id, v_uid, 'CREATE_PET', 'pet', v_pet_id::TEXT,
    'Registered pet ' || trim(p_name) || ' for clinic_client ' || p_clinic_client_id::TEXT
  );
  RETURN v_pet_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_pet(UUID, UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, DATE, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_pet(UUID, UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, DATE, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_pet(p_pet_id UUID, p_updates JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_pet public.pets;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v_pet FROM public.pets WHERE id = p_pet_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pet not found' USING ERRCODE = 'P0002'; END IF;

  IF NOT (
    app.is_pet_guardian(v_pet.organization_id, p_pet_id)
    OR app.has_org_permission(v_pet.organization_id, 'pets.write')
  ) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.pets
  SET name = COALESCE(NULLIF(trim(p_updates->>'name'), ''), name),
      species = COALESCE(NULLIF(trim(p_updates->>'species'), ''), species),
      breed = COALESCE(NULLIF(trim(p_updates->>'breed'), ''), breed),
      gender = COALESCE(NULLIF(trim(p_updates->>'gender'), ''), gender),
      weight = COALESCE((p_updates->>'weight')::NUMERIC, weight),
      color = COALESCE(p_updates->>'color', color),
      allergies = COALESCE(p_updates->>'allergies', allergies),
      medical_notes = COALESCE(p_updates->>'medical_notes', medical_notes)
  WHERE id = p_pet_id;

  PERFORM app.write_audit_log(
    v_pet.organization_id, v_uid, 'UPDATE_PET', 'pet', p_pet_id::TEXT,
    'Updated pet profile', to_jsonb(v_pet), p_updates
  );
END;
$$;
REVOKE ALL ON FUNCTION public.update_pet(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_pet(UUID, JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.archive_pet(p_pet_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_pet public.pets;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v_pet FROM public.pets WHERE id = p_pet_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pet not found' USING ERRCODE = 'P0002'; END IF;

  IF NOT (
    app.is_pet_guardian(v_pet.organization_id, p_pet_id)
    OR app.has_org_permission(v_pet.organization_id, 'pets.write')
  ) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.appointments
    WHERE pet_id = p_pet_id AND status IN ('requested', 'confirmed', 'checked_in')
  ) OR EXISTS (
    SELECT 1 FROM public.consultations
    WHERE pet_id = p_pet_id AND consultation_status IN ('pending', 'active')
  ) THEN
    RAISE EXCEPTION 'Cannot archive pet with open appointments or active consultations' USING ERRCODE = '22023';
  END IF;

  UPDATE public.pets
  SET archived_at = timezone('utc'::text, now()),
      archived_by = v_uid
  WHERE id = p_pet_id;

  PERFORM app.write_audit_log(
    v_pet.organization_id, v_uid, 'ARCHIVE_PET', 'pet', p_pet_id::TEXT,
    'Archived pet: ' || COALESCE(NULLIF(trim(p_reason), ''), 'none')
  );
END;
$$;
REVOKE ALL ON FUNCTION public.archive_pet(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_pet(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.upsert_doctor_schedule(
  p_organization_id UUID,
  p_branch_id UUID,
  p_doctor_profile_id UUID,
  p_weekday SMALLINT,
  p_start_time TIME,
  p_end_time TIME,
  p_slot_minutes SMALLINT DEFAULT 30,
  p_is_active BOOLEAN DEFAULT true
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_doc public.doctor_profiles;
  v_sched_id UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;

  SELECT * INTO v_doc FROM public.doctor_profiles
  WHERE id = p_doctor_profile_id AND organization_id = p_organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Doctor not found in organization' USING ERRCODE = 'P0002'; END IF;

  IF NOT (
    app.has_branch_access(p_organization_id, p_branch_id, 'schedules.manage')
    AND (
      app.has_org_permission(p_organization_id, 'staff.manage')
      OR v_doc.user_id = v_uid
    )
  ) THEN
    RAISE EXCEPTION 'Forbidden: Cannot manage schedule for this doctor/branch' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.doctor_branch_assignments
    WHERE organization_id = p_organization_id
      AND doctor_profile_id = p_doctor_profile_id
      AND branch_id = p_branch_id
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Doctor is not assigned to branch %', p_branch_id USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.doctor_schedules (
    organization_id, branch_id, doctor_profile_id, weekday, start_time, end_time, slot_minutes, is_active
  )
  VALUES (
    p_organization_id, p_branch_id, p_doctor_profile_id, p_weekday, p_start_time, p_end_time,
    COALESCE(p_slot_minutes, 30), COALESCE(p_is_active, true)
  )
  RETURNING id INTO v_sched_id;

  PERFORM app.write_audit_log(
    p_organization_id, v_uid, 'UPSERT_DOCTOR_SCHEDULE', 'doctor_schedule', v_sched_id::TEXT,
    'Saved schedule for doctor ' || p_doctor_profile_id::TEXT || ' at branch ' || p_branch_id::TEXT
  );
  RETURN v_sched_id;
END;
$$;
REVOKE ALL ON FUNCTION public.upsert_doctor_schedule(UUID, UUID, UUID, SMALLINT, TIME, TIME, SMALLINT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_doctor_schedule(UUID, UUID, UUID, SMALLINT, TIME, TIME, SMALLINT, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.add_schedule_exception(
  p_organization_id UUID,
  p_doctor_profile_id UUID,
  p_branch_id UUID,
  p_start_at TIMESTAMPTZ,
  p_end_at TIMESTAMPTZ,
  p_exception_type TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_doc public.doctor_profiles;
  v_exc_id UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v_doc FROM public.doctor_profiles
  WHERE id = p_doctor_profile_id AND organization_id = p_organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Doctor not found in organization' USING ERRCODE = 'P0002'; END IF;

  IF NOT (
    app.has_org_permission(p_organization_id, 'schedules.manage')
    AND (app.has_org_permission(p_organization_id, 'staff.manage') OR v_doc.user_id = v_uid)
  ) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.doctor_schedule_exceptions (
    organization_id, branch_id, doctor_profile_id, start_at, end_at, exception_type, reason, created_by
  )
  VALUES (
    p_organization_id, p_branch_id, p_doctor_profile_id, p_start_at, p_end_at, p_exception_type, p_reason, v_uid
  )
  RETURNING id INTO v_exc_id;

  PERFORM app.write_audit_log(
    p_organization_id, v_uid, 'ADD_SCHEDULE_EXCEPTION', 'doctor_schedule_exception', v_exc_id::TEXT,
    'Added schedule exception (' || p_exception_type || ')'
  );
  RETURN v_exc_id;
END;
$$;
REVOKE ALL ON FUNCTION public.add_schedule_exception(UUID, UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_schedule_exception(UUID, UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT) TO authenticated;

-- ------------------------------------------------------------------------------
-- SECTION E: APPOINTMENTS & CONSULTATION LIFECYCLE RPCs
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.request_appointment(
  p_organization_id UUID,
  p_branch_id UUID,
  p_pet_id UUID,
  p_doctor_profile_id UUID,
  p_requested_start TIMESTAMPTZ,
  p_requested_end TIMESTAMPTZ,
  p_reason TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_cc_id UUID;
  v_appt_id UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  IF NOT app.is_org_active(p_organization_id) THEN
    RAISE EXCEPTION 'Organization unavailable' USING ERRCODE = '42501';
  END IF;

  v_cc_id := app.current_clinic_client_id(p_organization_id);
  IF v_cc_id IS NULL THEN
    IF app.has_branch_access(p_organization_id, p_branch_id, 'appointments.confirm') THEN
      SELECT pg.clinic_client_id INTO v_cc_id
      FROM public.pet_guardians pg
      JOIN public.clinic_clients cc ON cc.id = pg.clinic_client_id
      WHERE pg.organization_id = p_organization_id AND pg.pet_id = p_pet_id AND cc.status = 'approved'
      ORDER BY pg.is_primary DESC
      LIMIT 1;
    END IF;
    IF v_cc_id IS NULL THEN
      RAISE EXCEPTION 'Forbidden: Approved clinic client & valid guardian required' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT app.is_pet_guardian(p_organization_id, p_pet_id) THEN
    RAISE EXCEPTION 'Forbidden: Caller is not an approved guardian for this pet' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.branches b
    WHERE b.id = p_branch_id AND b.organization_id = p_organization_id AND b.is_active = true
  ) THEN
    RAISE EXCEPTION 'Invalid or inactive branch' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.doctor_profiles dp
    JOIN public.doctor_branch_assignments dba
      ON dba.doctor_profile_id = dp.id
     AND dba.organization_id = dp.organization_id
    WHERE dp.id = p_doctor_profile_id
      AND dp.organization_id = p_organization_id
      AND dp.is_active = true
      AND dba.branch_id = p_branch_id
      AND dba.is_active = true
  ) THEN
    RAISE EXCEPTION 'Doctor is not active or not assigned to target branch' USING ERRCODE = '22023';
  END IF;

  -- Pending requests leave scheduled_range NULL so they never block slots before confirmation
  INSERT INTO public.appointments (
    organization_id, branch_id, clinic_client_id, pet_id, doctor_profile_id,
    requested_start, requested_end, scheduled_range, status, reason, created_by
  )
  VALUES (
    p_organization_id, p_branch_id, v_cc_id, p_pet_id, p_doctor_profile_id,
    p_requested_start, p_requested_end, NULL, 'requested', trim(p_reason), v_uid
  )
  RETURNING id INTO v_appt_id;

  INSERT INTO public.appointment_status_history (
    organization_id, appointment_id, from_status, to_status, changed_by, reason
  )
  VALUES (p_organization_id, v_appt_id, NULL, 'requested', v_uid, 'Appointment requested');

  PERFORM app.write_audit_log(
    p_organization_id, v_uid, 'REQUEST_APPOINTMENT', 'appointment', v_appt_id::TEXT,
    'Appointment requested for doctor ' || p_doctor_profile_id::TEXT || ' at branch ' || p_branch_id::TEXT
  );

  RETURN v_appt_id;
END;
$$;
REVOKE ALL ON FUNCTION public.request_appointment(UUID, UUID, UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_appointment(UUID, UUID, UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_appointment(
  p_appointment_id UUID,
  p_confirmed_start TIMESTAMPTZ DEFAULT NULL,
  p_confirmed_end TIMESTAMPTZ DEFAULT NULL,
  p_doctor_profile_id UUID DEFAULT NULL
)
RETURNS public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_appt public.appointments;
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_doc_id UUID;
  v_branch_tz TEXT;
  v_local_start TIMESTAMP;
  v_local_end TIMESTAMP;
  v_iso_dow SMALLINT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;

  SELECT * INTO v_appt FROM public.appointments WHERE id = p_appointment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Appointment not found' USING ERRCODE = 'P0002'; END IF;

  -- Strictly front_desk, branch_manager, org_admin, or org_owner with appointments.confirm
  IF NOT app.has_branch_access(v_appt.organization_id, v_appt.branch_id, 'appointments.confirm') THEN
    RAISE EXCEPTION 'Forbidden: Only authorized front desk or clinic admin may confirm appointments' USING ERRCODE = '42501';
  END IF;

  IF v_appt.status <> 'requested' THEN
    RAISE EXCEPTION 'Invalid State: Appointment is already %', v_appt.status USING ERRCODE = '22023';
  END IF;

  v_start := COALESCE(p_confirmed_start, v_appt.requested_start);
  v_end := COALESCE(p_confirmed_end, v_appt.requested_end);
  v_doc_id := COALESCE(p_doctor_profile_id, v_appt.doctor_profile_id);

  IF v_end <= v_start THEN
    RAISE EXCEPTION 'Confirmed end must be after start' USING ERRCODE = '22023';
  END IF;

  -- Revalidate client approved & pet active
  IF NOT EXISTS (
    SELECT 1 FROM public.clinic_clients cc
    JOIN public.pet_guardians pg ON pg.clinic_client_id = cc.id AND pg.organization_id = cc.organization_id
    JOIN public.pets p ON p.id = pg.pet_id AND p.organization_id = pg.organization_id
    WHERE cc.id = v_appt.clinic_client_id
      AND cc.organization_id = v_appt.organization_id
      AND cc.status = 'approved'
      AND p.id = v_appt.pet_id
      AND p.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Client approval or pet guardianship invalid' USING ERRCODE = '22023';
  END IF;

  -- Revalidate branch active & doctor active + assigned
  SELECT b.timezone INTO v_branch_tz
  FROM public.branches b
  WHERE b.id = v_appt.branch_id AND b.organization_id = v_appt.organization_id AND b.is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Branch is inactive' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.doctor_profiles dp
    JOIN public.doctor_branch_assignments dba
      ON dba.doctor_profile_id = dp.id AND dba.organization_id = dp.organization_id
    WHERE dp.id = v_doc_id
      AND dp.organization_id = v_appt.organization_id
      AND dp.is_active = true
      AND dba.branch_id = v_appt.branch_id
      AND dba.is_active = true
  ) THEN
    RAISE EXCEPTION 'Assigned doctor is inactive or detached from branch' USING ERRCODE = '22023';
  END IF;

  -- Revalidate against branch schedule (if schedules are configured for the branch/doctor)
  v_local_start := v_start AT TIME ZONE v_branch_tz;
  v_local_end := v_end AT TIME ZONE v_branch_tz;
  v_iso_dow := EXTRACT(ISODOW FROM v_local_start)::SMALLINT;

  IF v_local_start::DATE = v_local_end::DATE AND EXISTS (
    SELECT 1 FROM public.doctor_schedules ds
    WHERE ds.organization_id = v_appt.organization_id
      AND ds.branch_id = v_appt.branch_id
      AND ds.doctor_profile_id = v_doc_id
      AND ds.is_active = true
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.doctor_schedules ds
      WHERE ds.organization_id = v_appt.organization_id
        AND ds.branch_id = v_appt.branch_id
        AND ds.doctor_profile_id = v_doc_id
        AND ds.is_active = true
        AND ds.weekday = v_iso_dow
        AND ds.start_time <= v_local_start::TIME
        AND ds.end_time >= v_local_end::TIME
        AND (ds.effective_from IS NULL OR v_local_start::DATE >= ds.effective_from)
        AND (ds.effective_to IS NULL OR v_local_start::DATE <= ds.effective_to)
    ) THEN
      RAISE EXCEPTION 'Requested slot falls outside doctor branch schedule' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Check schedule exceptions (leave/holiday/closure)
  IF EXISTS (
    SELECT 1 FROM public.doctor_schedule_exceptions dse
    WHERE dse.organization_id = v_appt.organization_id
      AND dse.doctor_profile_id = v_doc_id
      AND (dse.branch_id IS NULL OR dse.branch_id = v_appt.branch_id)
      AND dse.exception_type IN ('leave', 'holiday', 'clinic_closure')
      AND tstzrange(dse.start_at, dse.end_at, '[)') && tstzrange(v_start, v_end, '[)')
  ) THEN
    RAISE EXCEPTION 'Requested slot overlaps doctor/branch schedule exception' USING ERRCODE = '22023';
  END IF;

  -- Update appointment; EXCLUDE USING gist (no_double_booking) guarantees zero race overlaps (SQLSTATE 23P01)
  UPDATE public.appointments
  SET status = 'confirmed',
      doctor_profile_id = v_doc_id,
      scheduled_range = tstzrange(v_start, v_end, '[)'),
      confirmed_by = v_uid,
      confirmed_at = timezone('utc'::text, now())
  WHERE id = p_appointment_id
  RETURNING * INTO v_appt;

  INSERT INTO public.appointment_status_history (
    organization_id, appointment_id, from_status, to_status, changed_by, reason
  )
  VALUES (v_appt.organization_id, v_appt.id, 'requested', 'confirmed', v_uid, 'Appointment confirmed');

  PERFORM app.write_audit_log(
    v_appt.organization_id, v_uid, 'CONFIRM_APPOINTMENT', 'appointment', v_appt.id::TEXT,
    'Confirmed appointment slot [' || v_start::TEXT || ', ' || v_end::TEXT || ')'
  );

  RETURN v_appt;
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_appointment(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_appointment(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.decline_appointment(p_appointment_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_appt public.appointments;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Decline reason required' USING ERRCODE = '22023'; END IF;

  SELECT * INTO v_appt FROM public.appointments WHERE id = p_appointment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Appointment not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT app.has_branch_access(v_appt.organization_id, v_appt.branch_id, 'appointments.confirm') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_appt.status <> 'requested' THEN
    RAISE EXCEPTION 'Only requested appointments can be declined' USING ERRCODE = '22023';
  END IF;

  UPDATE public.appointments SET status = 'declined', decline_reason = trim(p_reason) WHERE id = p_appointment_id;
  INSERT INTO public.appointment_status_history (organization_id, appointment_id, from_status, to_status, changed_by, reason)
  VALUES (v_appt.organization_id, p_appointment_id, 'requested', 'declined', v_uid, trim(p_reason));
  PERFORM app.write_audit_log(v_appt.organization_id, v_uid, 'DECLINE_APPOINTMENT', 'appointment', p_appointment_id::TEXT, trim(p_reason));
END;
$$;
REVOKE ALL ON FUNCTION public.decline_appointment(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decline_appointment(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_appointment(p_appointment_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_appt public.appointments;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v_appt FROM public.appointments WHERE id = p_appointment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Appointment not found' USING ERRCODE = 'P0002'; END IF;

  IF NOT (
    app.has_branch_access(v_appt.organization_id, v_appt.branch_id, 'appointments.confirm')
    OR app.is_pet_guardian(v_appt.organization_id, v_appt.pet_id)
  ) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_appt.status NOT IN ('requested', 'confirmed') THEN
    RAISE EXCEPTION 'Cannot cancel appointment in status %', v_appt.status USING ERRCODE = '22023';
  END IF;

  UPDATE public.appointments SET status = 'cancelled', cancellation_reason = NULLIF(trim(p_reason), '') WHERE id = p_appointment_id;
  INSERT INTO public.appointment_status_history (organization_id, appointment_id, from_status, to_status, changed_by, reason)
  VALUES (v_appt.organization_id, p_appointment_id, v_appt.status, 'cancelled', v_uid, COALESCE(NULLIF(trim(p_reason), ''), 'Cancelled'));
  PERFORM app.write_audit_log(v_appt.organization_id, v_uid, 'CANCEL_APPOINTMENT', 'appointment', p_appointment_id::TEXT, 'Cancelled');
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_appointment(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_appointment(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_consultation_from_appointment(
  p_appointment_id UUID,
  p_reason TEXT DEFAULT NULL,
  p_activate_immediately BOOLEAN DEFAULT false
)
RETURNS public.consultations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_appt public.appointments;
  v_cc public.clinic_clients;
  v_cons public.consultations;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;

  SELECT * INTO v_appt FROM public.appointments WHERE id = p_appointment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Appointment not found' USING ERRCODE = 'P0002'; END IF;

  IF NOT app.has_org_permission(v_appt.organization_id, 'consultations.activate') THEN
    RAISE EXCEPTION 'Forbidden: Missing consultations.activate permission' USING ERRCODE = '42501';
  END IF;

  -- If caller is a doctor without org-level staff.manage, ensure they are the appointment's doctor
  IF NOT app.has_org_permission(v_appt.organization_id, 'staff.manage') THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.doctor_profiles dp
      WHERE dp.id = v_appt.doctor_profile_id
        AND dp.organization_id = v_appt.organization_id
        AND dp.user_id = v_uid
        AND dp.is_active = true
    ) THEN
      RAISE EXCEPTION 'Forbidden: Only assigned doctor or clinic admin can initiate consultation' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_appt.status NOT IN ('confirmed', 'checked_in', 'completed') THEN
    RAISE EXCEPTION 'Invalid State: Confirmed or completed appointment is mandatory before consultation (current: %)', v_appt.status
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_cc FROM public.clinic_clients WHERE id = v_appt.clinic_client_id;

  INSERT INTO public.consultations (
    organization_id, branch_id, clinic_client_id, appointment_id,
    client_id, doctor_id, pet_id, consultation_reason, consultation_status
  )
  VALUES (
    v_appt.organization_id, v_appt.branch_id, v_appt.clinic_client_id, v_appt.id,
    COALESCE(v_cc.user_id, v_uid), v_appt.doctor_profile_id, v_appt.pet_id,
    COALESCE(NULLIF(trim(p_reason), ''), v_appt.reason), 'pending'
  )
  RETURNING * INTO v_cons;

  IF COALESCE(p_activate_immediately, false) THEN
    v_cons := public.activate_consultation(v_cons.id);
  END IF;

  RETURN v_cons;
END;
$$;
REVOKE ALL ON FUNCTION public.create_consultation_from_appointment(UUID, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_consultation_from_appointment(UUID, TEXT, BOOLEAN) TO authenticated;

-- Hardened multi-tenant activate_consultation(UUID):
-- Enforces active org, mandatory confirmed/checked_in/completed appointment, authorized doctor/admin,
-- exact 7-day chat window, 1:1 conversation creation, and org-scoped audit log.
CREATE OR REPLACE FUNCTION public.activate_consultation(p_consultation_id UUID)
RETURNS public.consultations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_consultation public.consultations;
  v_is_org_admin BOOLEAN := false;
  v_is_assigned_doc BOOLEAN := false;
  v_activated_at TIMESTAMPTZ;
  v_expires_at TIMESTAMPTZ;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Caller authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_consultation
  FROM public.consultations
  WHERE id = p_consultation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Consultation % not found', p_consultation_id USING ERRCODE = 'P0002';
  END IF;

  IF v_consultation.organization_id IS NULL OR NOT app.is_org_active(v_consultation.organization_id) THEN
    RAISE EXCEPTION 'Forbidden: Organization is inactive or unresolved' USING ERRCODE = '42501';
  END IF;

  IF v_consultation.consultation_status <> 'pending' THEN
    RAISE EXCEPTION 'Invalid State: Consultation % is already in status %', p_consultation_id, v_consultation.consultation_status
      USING ERRCODE = '22023';
  END IF;

  -- Mandatory confirmed/completed appointment prerequisite (resolved decision)
  IF v_consultation.appointment_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.appointments a
    WHERE a.id = v_consultation.appointment_id
      AND a.organization_id = v_consultation.organization_id
      AND a.status IN ('confirmed', 'checked_in', 'completed')
  ) THEN
    RAISE EXCEPTION 'Invalid State: A confirmed or completed appointment is mandatory before consultation activation'
      USING ERRCODE = '22023';
  END IF;

  -- Explicitly block client self-activation
  IF EXISTS (
    SELECT 1 FROM public.clinic_clients cc
    WHERE cc.id = v_consultation.clinic_client_id AND cc.user_id = v_caller_id
  ) AND NOT app.has_org_permission(v_consultation.organization_id, 'consultations.activate') THEN
    RAISE EXCEPTION 'Forbidden: Clients cannot self-activate consultations' USING ERRCODE = '42501';
  END IF;

  v_is_org_admin := app.has_org_permission(v_consultation.organization_id, 'staff.manage')
    AND app.has_org_permission(v_consultation.organization_id, 'consultations.activate');

  SELECT EXISTS (
    SELECT 1
    FROM public.doctor_profiles dp
    WHERE dp.id = v_consultation.doctor_id
      AND dp.organization_id = v_consultation.organization_id
      AND dp.user_id = v_caller_id
      AND dp.is_active = true
      AND app.has_org_permission(v_consultation.organization_id, 'consultations.activate')
  ) INTO v_is_assigned_doc;

  IF NOT v_is_org_admin AND NOT v_is_assigned_doc THEN
    RAISE EXCEPTION 'Forbidden: Caller is not the assigned active doctor or an authorized clinic administrator'
      USING ERRCODE = '42501';
  END IF;

  v_activated_at := timezone('utc'::text, now());
  v_expires_at := v_activated_at + INTERVAL '7 days';

  UPDATE public.consultations
  SET consultation_status = 'active',
      activated_at = v_activated_at,
      expires_at = v_expires_at,
      activated_by = v_caller_id,
      updated_at = v_activated_at
  WHERE id = p_consultation_id
  RETURNING * INTO v_consultation;

  INSERT INTO public.chat_conversations (
    organization_id, consultation_id, client_id, doctor_id, created_at
  )
  VALUES (
    v_consultation.organization_id, v_consultation.id, v_consultation.client_id, v_consultation.doctor_id, v_activated_at
  )
  ON CONFLICT (consultation_id) DO NOTHING;

  PERFORM app.write_audit_log(
    v_consultation.organization_id, v_caller_id, 'ACTIVATE_CONSULTATION', 'consultation', p_consultation_id::TEXT,
    'Consultation activated by ' || CASE WHEN v_is_org_admin AND NOT v_is_assigned_doc THEN 'org_admin' ELSE 'assigned_doctor' END || '. 7-day chat window initiated until ' || v_expires_at::TEXT,
    jsonb_build_object('consultation_status', 'pending'),
    jsonb_build_object('consultation_status', 'active', 'activated_at', v_activated_at, 'expires_at', v_expires_at)
  );

  RETURN v_consultation;
END;
$$;
REVOKE ALL ON FUNCTION public.activate_consultation(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activate_consultation(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_consultation(p_consultation_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_cons public.consultations;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Rejection reason required' USING ERRCODE = '22023'; END IF;

  SELECT * INTO v_cons FROM public.consultations WHERE id = p_consultation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Consultation not found' USING ERRCODE = 'P0002'; END IF;

  IF NOT (
    (app.has_org_permission(v_cons.organization_id, 'consultations.manage') AND app.has_org_permission(v_cons.organization_id, 'staff.manage'))
    OR EXISTS (
      SELECT 1 FROM public.doctor_profiles dp
      WHERE dp.id = v_cons.doctor_id AND dp.organization_id = v_cons.organization_id AND dp.user_id = v_uid
    )
  ) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_cons.consultation_status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending consultations can be rejected' USING ERRCODE = '22023';
  END IF;

  UPDATE public.consultations
  SET consultation_status = 'rejected',
      rejection_reason = trim(p_reason),
      rejected_by = v_uid
  WHERE id = p_consultation_id;

  PERFORM app.write_audit_log(
    v_cons.organization_id, v_uid, 'REJECT_CONSULTATION', 'consultation', p_consultation_id::TEXT, trim(p_reason)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.reject_consultation(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_consultation(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_consultation(p_consultation_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_cons public.consultations;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v_cons FROM public.consultations WHERE id = p_consultation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Consultation not found' USING ERRCODE = 'P0002'; END IF;

  IF NOT (
    (app.has_org_permission(v_cons.organization_id, 'consultations.manage') AND app.has_org_permission(v_cons.organization_id, 'staff.manage'))
    OR EXISTS (
      SELECT 1 FROM public.doctor_profiles dp
      WHERE dp.id = v_cons.doctor_id AND dp.organization_id = v_cons.organization_id AND dp.user_id = v_uid
    )
  ) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_cons.consultation_status <> 'active' THEN
    RAISE EXCEPTION 'Only active consultations can be completed' USING ERRCODE = '22023';
  END IF;

  UPDATE public.consultations
  SET consultation_status = 'completed',
      completed_at = timezone('utc'::text, now()),
      completed_by = v_uid
  WHERE id = p_consultation_id;

  PERFORM app.write_audit_log(
    v_cons.organization_id, v_uid, 'COMPLETE_CONSULTATION', 'consultation', p_consultation_id::TEXT,
    'Marked consultation completed'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.complete_consultation(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_consultation(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.reassign_consultation(
  p_consultation_id UUID,
  p_new_doctor_profile_id UUID,
  p_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_cons public.consultations;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v_cons FROM public.consultations WHERE id = p_consultation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Consultation not found' USING ERRCODE = 'P0002'; END IF;

  IF NOT (app.has_org_permission(v_cons.organization_id, 'staff.manage') AND app.has_org_permission(v_cons.organization_id, 'consultations.manage')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.doctor_profiles dp
    WHERE dp.id = p_new_doctor_profile_id AND dp.organization_id = v_cons.organization_id AND dp.is_active = true
  ) THEN
    RAISE EXCEPTION 'Target doctor is not active in this organization' USING ERRCODE = '22023';
  END IF;

  UPDATE public.consultations SET doctor_id = p_new_doctor_profile_id WHERE id = p_consultation_id;
  UPDATE public.chat_conversations SET doctor_id = p_new_doctor_profile_id WHERE consultation_id = p_consultation_id;

  PERFORM app.write_audit_log(
    v_cons.organization_id, v_uid, 'REASSIGN_CONSULTATION', 'consultation', p_consultation_id::TEXT,
    COALESCE(NULLIF(trim(p_reason), ''), 'Reassigned doctor'),
    jsonb_build_object('doctor_id', v_cons.doctor_id),
    jsonb_build_object('doctor_id', p_new_doctor_profile_id)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.reassign_consultation(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reassign_consultation(UUID, UUID, TEXT) TO authenticated;

-- ------------------------------------------------------------------------------
-- SECTION F: CHAT & CLINICAL RECORD WRITE RPCs
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.send_chat_message(
  p_conversation_id UUID,
  p_message_type public.message_type_enum,
  p_content TEXT,
  p_attachment_ids UUID[] DEFAULT '{}'::uuid[]
)
RETURNS public.chat_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_conv public.chat_conversations;
  v_cons public.consultations;
  v_msg public.chat_messages;
  v_att_id UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  IF NULLIF(trim(p_content), '') IS NULL THEN RAISE EXCEPTION 'Message content required' USING ERRCODE = '22023'; END IF;

  SELECT * INTO v_conv FROM public.chat_conversations WHERE id = p_conversation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversation not found' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO v_cons FROM public.consultations WHERE id = v_conv.consultation_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Consultation not found' USING ERRCODE = 'P0002'; END IF;

  IF NOT app.is_consultation_participant(v_cons.id) THEN
    RAISE EXCEPTION 'Forbidden: Only consultation client or treating doctor may send messages' USING ERRCODE = '42501';
  END IF;

  IF v_cons.consultation_status <> 'active'
     OR v_cons.activated_at IS NULL
     OR v_cons.expires_at IS NULL
     OR timezone('utc'::text, now()) >= v_cons.expires_at THEN
    RAISE EXCEPTION 'Chat window has expired or consultation is not active' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.chat_messages (
    organization_id, conversation_id, sender_id, message_type, message_content
  )
  VALUES (
    v_cons.organization_id, v_conv.id, v_uid, COALESCE(p_message_type, 'text'::public.message_type_enum), trim(p_content)
  )
  RETURNING * INTO v_msg;

  IF p_attachment_ids IS NOT NULL THEN
    FOREACH v_att_id IN ARRAY p_attachment_ids LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.attachments a
        WHERE a.id = v_att_id AND a.organization_id = v_cons.organization_id
      ) THEN
        RAISE EXCEPTION 'Attachment % does not belong to organization', v_att_id USING ERRCODE = '42501';
      END IF;
      INSERT INTO public.message_attachments (message_id, attachment_id, organization_id)
      VALUES (v_msg.id, v_att_id, v_cons.organization_id);
    END LOOP;
  END IF;

  RETURN v_msg;
END;
$$;
REVOKE ALL ON FUNCTION public.send_chat_message(UUID, public.message_type_enum, TEXT, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_chat_message(UUID, public.message_type_enum, TEXT, UUID[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_messages_read(p_conversation_id UUID, p_up_to TIMESTAMPTZ DEFAULT timezone('utc'::text, now()))
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_conv public.chat_conversations;
  v_updated INT := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v_conv FROM public.chat_conversations WHERE id = p_conversation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversation not found' USING ERRCODE = 'P0002'; END IF;

  IF NOT app.is_consultation_participant(v_conv.consultation_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  WITH upd AS (
    UPDATE public.chat_messages
    SET read_at = timezone('utc'::text, now())
    WHERE conversation_id = p_conversation_id
      AND sender_id <> v_uid
      AND read_at IS NULL
      AND created_at <= COALESCE(p_up_to, timezone('utc'::text, now()))
    RETURNING id
  )
  SELECT count(*) INTO v_updated FROM upd;

  RETURN v_updated;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_messages_read(UUID, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_messages_read(UUID, TIMESTAMPTZ) TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_prescription(
  p_organization_id UUID,
  p_pet_id UUID,
  p_consultation_id UUID,
  p_appointment_id UUID,
  p_diagnosis TEXT,
  p_instructions TEXT,
  p_follow_up_date DATE,
  p_items JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_doc_id UUID;
  v_branch_id UUID;
  v_legacy_client_id UUID;
  v_rx_id UUID;
  v_item JSONB;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  IF NOT app.has_org_permission(p_organization_id, 'medical_records.write') THEN
    RAISE EXCEPTION 'Forbidden: Only authorized organization doctors can issue prescriptions' USING ERRCODE = '42501';
  END IF;

  SELECT dp.id INTO v_doc_id
  FROM public.doctor_profiles dp
  WHERE dp.organization_id = p_organization_id AND dp.user_id = v_uid AND dp.is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Forbidden: Active doctor profile in organization required' USING ERRCODE = '42501';
  END IF;

  IF p_consultation_id IS NULL AND p_appointment_id IS NULL THEN
    RAISE EXCEPTION 'Prescription requires a consultation or appointment in this organization' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) < 1 THEN
    RAISE EXCEPTION 'At least one prescription item is required' USING ERRCODE = '22023';
  END IF;

  -- Validate pet belongs to same organization
  SELECT p.owner_id INTO v_legacy_client_id
  FROM public.pets p
  WHERE p.id = p_pet_id AND p.organization_id = p_organization_id AND p.archived_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pet not found in organization' USING ERRCODE = 'P0002';
  END IF;

  IF p_consultation_id IS NOT NULL THEN
    SELECT c.branch_id INTO v_branch_id
    FROM public.consultations c
    WHERE c.id = p_consultation_id AND c.organization_id = p_organization_id AND c.pet_id = p_pet_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Consultation does not match org/pet' USING ERRCODE = '42501'; END IF;
  ELSIF p_appointment_id IS NOT NULL THEN
    SELECT a.branch_id INTO v_branch_id
    FROM public.appointments a
    WHERE a.id = p_appointment_id AND a.organization_id = p_organization_id AND a.pet_id = p_pet_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Appointment does not match org/pet' USING ERRCODE = '42501'; END IF;
  END IF;

  INSERT INTO public.prescriptions (
    organization_id, branch_id, consultation_id, appointment_id, pet_id, doctor_id, client_id,
    diagnosis, instructions, follow_up_date, status
  )
  VALUES (
    p_organization_id, v_branch_id, p_consultation_id, p_appointment_id, p_pet_id, v_doc_id, v_legacy_client_id,
    trim(p_diagnosis), p_instructions, p_follow_up_date, 'issued'
  )
  RETURNING id INTO v_rx_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO public.prescription_items (
      organization_id, prescription_id, medicine_name, dosage, frequency, duration, instructions
    )
    VALUES (
      p_organization_id, v_rx_id,
      trim(v_item->>'medicine_name'),
      trim(v_item->>'dosage'),
      trim(v_item->>'frequency'),
      trim(v_item->>'duration'),
      v_item->>'instructions'
    );
  END LOOP;

  PERFORM app.write_audit_log(
    p_organization_id, v_uid, 'ISSUE_PRESCRIPTION', 'prescription', v_rx_id::TEXT,
    'Issued prescription for pet ' || p_pet_id::TEXT
  );
  RETURN v_rx_id;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_prescription(UUID, UUID, UUID, UUID, TEXT, TEXT, DATE, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_prescription(UUID, UUID, UUID, UUID, TEXT, TEXT, DATE, JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.void_prescription(p_prescription_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_rx public.prescriptions;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Void reason required' USING ERRCODE = '22023'; END IF;

  SELECT * INTO v_rx FROM public.prescriptions WHERE id = p_prescription_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Prescription not found' USING ERRCODE = 'P0002'; END IF;

  IF NOT (
    (app.has_org_permission(v_rx.organization_id, 'consultations.manage') AND app.has_org_permission(v_rx.organization_id, 'staff.manage'))
    OR EXISTS (
      SELECT 1 FROM public.doctor_profiles dp
      WHERE dp.id = v_rx.doctor_id AND dp.organization_id = v_rx.organization_id AND dp.user_id = v_uid
    )
  ) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_rx.status = 'void' THEN
    RAISE EXCEPTION 'Prescription is already voided' USING ERRCODE = '22023';
  END IF;

  UPDATE public.prescriptions
  SET status = 'void',
      voided_by = v_uid,
      voided_at = timezone('utc'::text, now()),
      void_reason = trim(p_reason)
  WHERE id = p_prescription_id;

  PERFORM app.write_audit_log(
    v_rx.organization_id, v_uid, 'VOID_PRESCRIPTION', 'prescription', p_prescription_id::TEXT, trim(p_reason)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.void_prescription(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_prescription(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.add_medical_record(
  p_organization_id UUID,
  p_pet_id UUID,
  p_consultation_id UUID,
  p_record_type public.medical_record_type_enum,
  p_diagnosis TEXT,
  p_notes TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_doc_id UUID;
  v_rec_id UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  IF NOT app.has_org_permission(p_organization_id, 'medical_records.write') THEN
    RAISE EXCEPTION 'Forbidden: Only authorized organization doctors may write medical records' USING ERRCODE = '42501';
  END IF;

  SELECT dp.id INTO v_doc_id
  FROM public.doctor_profiles dp
  WHERE dp.organization_id = p_organization_id AND dp.user_id = v_uid AND dp.is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Forbidden: Active doctor profile required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.pets p WHERE p.id = p_pet_id AND p.organization_id = p_organization_id AND p.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Forbidden: Pet does not belong to caller organization' USING ERRCODE = '42501';
  END IF;

  IF p_consultation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.consultations c
    WHERE c.id = p_consultation_id AND c.organization_id = p_organization_id AND c.pet_id = p_pet_id
  ) THEN
    RAISE EXCEPTION 'Consultation does not belong to organization/pet' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.medical_records (
    organization_id, pet_id, consultation_id, doctor_id, created_by, record_type, diagnosis, notes
  )
  VALUES (
    p_organization_id, p_pet_id, p_consultation_id, v_doc_id, v_uid,
    COALESCE(p_record_type, 'clinical_note'::public.medical_record_type_enum), trim(p_diagnosis), trim(p_notes)
  )
  RETURNING id INTO v_rec_id;

  PERFORM app.write_audit_log(
    p_organization_id, v_uid, 'ADD_MEDICAL_RECORD', 'medical_record', v_rec_id::TEXT,
    'Added medical record for pet ' || p_pet_id::TEXT
  );
  RETURN v_rec_id;
END;
$$;
REVOKE ALL ON FUNCTION public.add_medical_record(UUID, UUID, UUID, public.medical_record_type_enum, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_medical_record(UUID, UUID, UUID, public.medical_record_type_enum, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.amend_medical_record(
  p_original_record_id UUID,
  p_diagnosis TEXT,
  p_notes TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_orig public.medical_records;
  v_doc_id UUID;
  v_new_id UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v_orig FROM public.medical_records WHERE id = p_original_record_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Medical record not found' USING ERRCODE = 'P0002'; END IF;

  IF NOT app.has_org_permission(v_orig.organization_id, 'medical_records.write') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT dp.id INTO v_doc_id
  FROM public.doctor_profiles dp
  WHERE dp.organization_id = v_orig.organization_id AND dp.user_id = v_uid AND dp.is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501'; END IF;

  INSERT INTO public.medical_records (
    organization_id, pet_id, consultation_id, doctor_id, created_by, amended_from_id,
    record_type, diagnosis, notes
  )
  VALUES (
    v_orig.organization_id, v_orig.pet_id, v_orig.consultation_id, v_doc_id, v_uid, v_orig.id,
    v_orig.record_type, trim(p_diagnosis), trim(p_notes)
  )
  RETURNING id INTO v_new_id;

  PERFORM app.write_audit_log(
    v_orig.organization_id, v_uid, 'AMEND_MEDICAL_RECORD', 'medical_record', v_new_id::TEXT,
    'Addendum to medical_record ' || v_orig.id::TEXT
  );
  RETURN v_new_id;
END;
$$;
REVOKE ALL ON FUNCTION public.amend_medical_record(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.amend_medical_record(UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_vaccination(
  p_organization_id UUID,
  p_pet_id UUID,
  p_vaccine_name TEXT,
  p_administered_date DATE,
  p_next_due_date DATE DEFAULT NULL,
  p_batch_number TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_doc_id UUID;
  v_doc_name TEXT;
  v_vax_id UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  IF NOT app.has_org_permission(p_organization_id, 'medical_records.write') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT dp.id, COALESCE(dp.display_name, p.full_name)
  INTO v_doc_id, v_doc_name
  FROM public.doctor_profiles dp
  JOIN public.profiles p ON p.id = dp.user_id
  WHERE dp.organization_id = p_organization_id AND dp.user_id = v_uid AND dp.is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Forbidden: Active doctor profile required' USING ERRCODE = '42501'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.pets pet WHERE pet.id = p_pet_id AND pet.organization_id = p_organization_id AND pet.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Forbidden: Pet does not belong to organization' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.vaccinations (
    organization_id, pet_id, doctor_profile_id, created_by, created_at,
    vaccine_name, administered_date, next_due_date, batch_number, notes, administered_by
  )
  VALUES (
    p_organization_id, p_pet_id, v_doc_id, v_uid, timezone('utc'::text, now()),
    trim(p_vaccine_name), p_administered_date, p_next_due_date, NULLIF(trim(p_batch_number), ''),
    p_notes, v_doc_name
  )
  RETURNING id INTO v_vax_id;

  PERFORM app.write_audit_log(
    p_organization_id, v_uid, 'RECORD_VACCINATION', 'vaccination', v_vax_id::TEXT,
    'Recorded vaccine ' || trim(p_vaccine_name) || ' for pet ' || p_pet_id::TEXT
  );
  RETURN v_vax_id;
END;
$$;
REVOKE ALL ON FUNCTION public.record_vaccination(UUID, UUID, TEXT, DATE, DATE, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_vaccination(UUID, UUID, TEXT, DATE, DATE, TEXT, TEXT) TO authenticated;
