-- ==============================================================================
-- PET CONNECT VETERINARY HEALTHCARE PLATFORM
-- Migration 14 (Phase 1 Hardening): Single Developer / Platform Owner Architecture
-- File: supabase/migrations/20261113140000_phase1_single_platform_owner.sql
-- ==============================================================================
-- SECURITY & ARCHITECTURE INVARIANTS:
-- 1. Strictly additive, forward-only migration (zero DROP TABLE, TRUNCATE, or
--    data deletion; all historical/inactive records are preserved).
-- 2. Enforces AT MOST ONE active Platform Owner at the database level via:
--    - Partial unique index uq_platform_admins_single_active (WHERE is_active = true)
--    - Guard trigger tg_platform_admins_guard_single_owner blocking >1 active
--      owner, blocking unconfirmed/banned/suspended accounts, blocking direct
--      anon/authenticated writes, and blocking DELETE (preserving history).
-- 3. Disables normal Platform Owner promotion paths:
--    - public.platform_grant_platform_admin is revoked from PUBLIC/anon/authenticated
--      and replaced to fail closed (42501).
-- 4. Provides controlled, one-time, concurrency-safe, audited bootstrap function
--    app.bootstrap_single_platform_owner(...) locked strictly to canonical email
--    'inderjeetcode@gmail.com' with verified email_confirmed_at in auth.users.
--    Never executable by PUBLIC, anon, or authenticated sessions.
-- 5. Does NOT execute bootstrap automatically and does NOT alter MaxPetZ or
--    organization/clinic/consultation workflows.
-- ==============================================================================

-- 1. Safety pre-check: abort without deleting data if >1 active owner already exists
DO $$
DECLARE
  v_active_count BIGINT;
BEGIN
  SELECT count(*) INTO v_active_count
  FROM public.platform_admins
  WHERE is_active = true;

  IF v_active_count > 1 THEN
    RAISE EXCEPTION
      'Migration aborted: % active rows already exist in public.platform_admins. Resolve manually while preserving historical rows before enforcing single active Platform Owner constraint.',
      v_active_count
      USING ERRCODE = '23505';
  END IF;
END $$;

-- 2. Partial unique index allowing at most ONE active Platform Owner while
--    preserving any historical inactive rows (is_active = false)
CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_admins_single_active
  ON public.platform_admins ((true))
  WHERE is_active = true;

-- Explicitly re-assert direct table privilege isolation on public.platform_admins
REVOKE ALL ON public.platform_admins FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.platform_admins FROM authenticated;

-- 3. Defense-in-depth trigger preventing multi-owner creation, self-promotion,
--    unconfirmed email activation, or deletion of historical records
CREATE OR REPLACE FUNCTION public.tg_platform_admins_guard_single_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_other_active_uid UUID;
  v_auth_confirmed TIMESTAMPTZ;
  v_auth_deleted TIMESTAMPTZ;
  v_auth_banned TIMESTAMPTZ;
  v_profile_status TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Forbidden: platform_admins records cannot be deleted; historical governance records must be preserved'
      USING ERRCODE = '42501';
  END IF;

  IF current_user IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Forbidden: Direct modification of platform_admins is not permitted'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Forbidden: platform_admins.user_id is immutable'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.is_active = true THEN
    SELECT pa.user_id INTO v_other_active_uid
    FROM public.platform_admins pa
    WHERE pa.is_active = true
      AND pa.user_id <> NEW.user_id
    FOR UPDATE;

    IF FOUND THEN
      RAISE EXCEPTION 'Single Platform Owner Violation: Only one active Platform Owner is allowed (existing user_id: %)',
        v_other_active_uid
        USING ERRCODE = '23505';
    END IF;

    SELECT au.email_confirmed_at, au.deleted_at, au.banned_until
    INTO v_auth_confirmed, v_auth_deleted, v_auth_banned
    FROM auth.users au
    WHERE au.id = NEW.user_id;

    IF NOT FOUND OR v_auth_deleted IS NOT NULL THEN
      RAISE EXCEPTION 'Invalid Target: Auth account % does not exist or has been deleted',
        NEW.user_id
        USING ERRCODE = 'P0002';
    END IF;

    IF v_auth_confirmed IS NULL THEN
      RAISE EXCEPTION 'Forbidden: Unconfirmed email account cannot hold active Platform Owner status'
        USING ERRCODE = '42501';
    END IF;

    IF v_auth_banned IS NOT NULL AND v_auth_banned > timezone('utc'::text, now()) THEN
      RAISE EXCEPTION 'Forbidden: Banned Auth account cannot hold active Platform Owner status'
        USING ERRCODE = '42501';
    END IF;

    SELECT COALESCE(p.platform_status, 'active') INTO v_profile_status
    FROM public.profiles p
    WHERE p.id = NEW.user_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invalid Target: Profile record for user % does not exist',
        NEW.user_id
        USING ERRCODE = 'P0002';
    END IF;

    IF v_profile_status <> 'active' THEN
      RAISE EXCEPTION 'Forbidden: Suspended profile (%) cannot hold active Platform Owner privileges',
        NEW.user_id
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS platform_admins_guard_single_owner ON public.platform_admins;
CREATE TRIGGER platform_admins_guard_single_owner
  BEFORE INSERT OR UPDATE OR DELETE ON public.platform_admins
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_platform_admins_guard_single_owner();

-- 4. Strengthen app.is_platform_admin() to verify Auth email confirmation,
--    non-deleted/non-banned status, active profile, and active platform_admins row
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
      JOIN auth.users au ON au.id = pa.user_id
      WHERE pa.user_id = auth.uid()
        AND pa.is_active = true
        AND COALESCE(pr.platform_status, 'active') = 'active'
        AND au.email_confirmed_at IS NOT NULL
        AND au.deleted_at IS NULL
        AND (au.banned_until IS NULL OR au.banned_until <= timezone('utc'::text, now()))
    )
  END;
$$;
REVOKE ALL ON FUNCTION app.is_platform_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.is_platform_admin() TO authenticated;

-- 5. Disable normal Platform Owner promotion RPC completely
CREATE OR REPLACE FUNCTION public.platform_grant_platform_admin(
  p_target_user_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Forbidden: Normal Platform Owner promotion is disabled. Pet Connect enforces a single active Platform Owner provisioned via controlled one-time bootstrap.'
    USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION public.platform_grant_platform_admin(UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- 6. Controlled, auditable, concurrency-safe one-time bootstrap procedure
--    Executable ONLY by privileged DB/service roles (never PUBLIC, anon, authenticated)
CREATE OR REPLACE FUNCTION app.bootstrap_single_platform_owner(
  p_expected_email TEXT DEFAULT 'inderjeetcode@gmail.com',
  p_notes TEXT DEFAULT 'Controlled one-time Platform Owner bootstrap'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_canonical_email CONSTANT TEXT := 'inderjeetcode@gmail.com';
  v_target_email TEXT := lower(trim(COALESCE(p_expected_email, '')));
  v_now TIMESTAMPTZ := timezone('utc'::text, now());
  v_clean_notes TEXT := COALESCE(
    NULLIF(trim(COALESCE(p_notes, '')), ''),
    'Controlled one-time Platform Owner bootstrap'
  );
  v_raw_jwt_claims TEXT := NULLIF(trim(COALESCE(current_setting('request.jwt.claims', true), '')), '');
  v_jwt_claims_json JSONB;
  v_jwt_role TEXT := '';
  v_claim_role TEXT := lower(trim(COALESCE(current_setting('request.jwt.claim.role', true), '')));
  v_existing_active_id UUID;
  v_auth_count BIGINT;
  v_auth_user RECORD;
  v_profile_status TEXT;
BEGIN
  -- Reject end-user API roles/sessions (validate PostgREST JWT claims & legacy claim.role safely)
  IF v_raw_jwt_claims IS NOT NULL THEN
    BEGIN
      v_jwt_claims_json := v_raw_jwt_claims::jsonb;
      v_jwt_role := lower(trim(COALESCE(v_jwt_claims_json->>'role', '')));
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Forbidden: Invalid JWT claim payload for privileged bootstrap'
        USING ERRCODE = '42501';
    END;
  END IF;

  IF auth.uid() IS NOT NULL
     OR v_jwt_role IN ('anon', 'authenticated')
     OR v_claim_role IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Forbidden: Controlled bootstrap requires privileged execution and cannot run under an anon or authenticated API session'
      USING ERRCODE = '42501';
  END IF;

  -- Serialize concurrent bootstrap attempts
  PERFORM pg_advisory_xact_lock(hashtext('pet_connect_single_platform_owner_bootstrap'));

  -- Verify exact authorized Developer email
  IF v_target_email <> v_canonical_email THEN
    RAISE EXCEPTION 'Forbidden: Bootstrap rejected for unauthorized email (%). Only % is permitted.',
      COALESCE(NULLIF(v_target_email, ''), '<empty>'),
      v_canonical_email
      USING ERRCODE = '42501';
  END IF;

  -- Refuse if any active Platform Owner already exists
  SELECT pa.user_id INTO v_existing_active_id
  FROM public.platform_admins pa
  WHERE pa.is_active = true
  FOR UPDATE;

  IF FOUND THEN
    RAISE EXCEPTION 'Conflict: An active Platform Owner already exists (user_id: %)',
      v_existing_active_id
      USING ERRCODE = '23505';
  END IF;

  -- Resolve real Auth UUID from auth.users and verify uniqueness & confirmation
  SELECT count(*) INTO v_auth_count
  FROM auth.users au
  WHERE lower(au.email) = v_canonical_email
    AND au.deleted_at IS NULL;

  IF v_auth_count = 0 THEN
    RAISE EXCEPTION 'Not Found: Authorized Auth account (%) does not exist in auth.users',
      v_canonical_email
      USING ERRCODE = 'P0002';
  END IF;

  IF v_auth_count > 1 THEN
    RAISE EXCEPTION 'Conflict: Multiple active auth.users rows match %',
      v_canonical_email
      USING ERRCODE = '23505';
  END IF;

  SELECT
    au.id,
    au.email,
    au.email_confirmed_at,
    au.banned_until,
    au.raw_user_meta_data
  INTO v_auth_user
  FROM auth.users au
  WHERE lower(au.email) = v_canonical_email
    AND au.deleted_at IS NULL
  FOR UPDATE;

  IF v_auth_user.email_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'Forbidden: Email (%) is not verified (email_confirmed_at is NULL)',
      v_canonical_email
      USING ERRCODE = '42501';
  END IF;

  IF v_auth_user.banned_until IS NOT NULL AND v_auth_user.banned_until > v_now THEN
    RAISE EXCEPTION 'Forbidden: Auth account (%) is banned until %',
      v_canonical_email, v_auth_user.banned_until
      USING ERRCODE = '42501';
  END IF;

  -- Sync global profile only (never assign clinic memberships or roles)
  SELECT COALESCE(p.platform_status, 'active') INTO v_profile_status
  FROM public.profiles p
  WHERE p.id = v_auth_user.id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.profiles (id, full_name, email, phone, avatar_url)
    VALUES (
      v_auth_user.id,
      left(
        COALESCE(
          NULLIF(trim(v_auth_user.raw_user_meta_data->>'full_name'), ''),
          split_part(v_auth_user.email, '@', 1)
        ),
        150
      ),
      v_auth_user.email,
      NULLIF(trim(v_auth_user.raw_user_meta_data->>'phone'), ''),
      NULLIF(trim(v_auth_user.raw_user_meta_data->>'avatar_url'), '')
    );
  ELSIF v_profile_status <> 'active' THEN
    RAISE EXCEPTION 'Forbidden: Profile for % is suspended (platform_status: %)',
      v_canonical_email, v_profile_status
      USING ERRCODE = '42501';
  END IF;

  -- Enforce one-time execution: reject if a platform_admins row already exists for this UUID
  IF EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = v_auth_user.id) THEN
    RAISE EXCEPTION 'Conflict: Controlled one-time bootstrap was already executed for % (%)',
      v_canonical_email, v_auth_user.id
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.platform_admins (user_id, granted_by, granted_at, is_active, notes)
  VALUES (v_auth_user.id, v_auth_user.id, v_now, true, v_clean_notes);

  PERFORM app.write_audit_log(
    NULL,
    v_auth_user.id,
    'BOOTSTRAP_PLATFORM_OWNER',
    'platform_admin',
    v_auth_user.id::TEXT,
    'Controlled one-time bootstrap assigned sole active Platform Owner to ' || v_canonical_email,
    NULL,
    jsonb_build_object(
      'user_id', v_auth_user.id,
      'email', v_canonical_email,
      'email_confirmed_at', v_auth_user.email_confirmed_at,
      'notes', v_clean_notes,
      'bootstrapped_at', v_now
    )
  );

  RETURN jsonb_build_object(
    'user_id', v_auth_user.id,
    'email', v_canonical_email,
    'email_confirmed_at', v_auth_user.email_confirmed_at,
    'bootstrapped_at', v_now,
    'is_active', true
  );
END;
$$;

REVOKE ALL ON FUNCTION app.bootstrap_single_platform_owner(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
