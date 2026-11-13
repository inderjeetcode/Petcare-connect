-- ==============================================================================
-- PET CONNECT VETERINARY HEALTHCARE PLATFORM
-- Standalone RPC Migration: activate_consultation() & Authorization Helpers
-- File: supabase/migrations/002_activate_consultation_rpc.sql
-- ==============================================================================

-- 1. Helper function: is_admin()
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- 2. Helper function: is_doctor()
CREATE OR REPLACE FUNCTION public.is_doctor()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'doctor'
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.is_doctor() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_doctor() TO authenticated;

-- 3. Stored Procedure: activate_consultation(UUID)
CREATE OR REPLACE FUNCTION public.activate_consultation(p_consultation_id UUID)
RETURNS public.consultations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_is_admin BOOLEAN := false;
  v_consultation public.consultations;
  v_activated_at TIMESTAMPTZ;
  v_expires_at TIMESTAMPTZ;
BEGIN
  -- 1. Verify caller authentication
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Caller authentication required' USING ERRCODE = '28000';
  END IF;

  -- 2. Lock target row for update to prevent concurrent race conditions
  SELECT * INTO v_consultation
  FROM public.consultations
  WHERE id = p_consultation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Consultation % not found', p_consultation_id USING ERRCODE = 'P0002';
  END IF;

  -- 3. Only pending consultations can be activated
  IF v_consultation.consultation_status <> 'pending' THEN
    RAISE EXCEPTION 'Invalid State: Consultation % is already in status %', p_consultation_id, v_consultation.consultation_status
      USING ERRCODE = '22023';
  END IF;

  -- 4. Check if caller is authorized administrator
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_caller_id AND role = 'admin'
  ) INTO v_is_admin;

  -- 5. If not admin, check if caller is the active assigned doctor
  IF NOT v_is_admin THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.doctor_profiles dp
      WHERE dp.id = v_consultation.doctor_id
        AND dp.user_id = v_caller_id
        AND dp.is_active = true
    ) THEN
      -- Disallow client self-activation explicitly
      IF v_consultation.client_id = v_caller_id THEN
        RAISE EXCEPTION 'Forbidden: Clients cannot self-activate consultations' USING ERRCODE = '42501';
      ELSE
        RAISE EXCEPTION 'Forbidden: Caller is not the assigned doctor or an authorized administrator' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  -- 6. Database timestamps: exactly 7 days expiry
  v_activated_at := now();
  v_expires_at := v_activated_at + INTERVAL '7 days';

  -- 7. Atomically activate consultation
  UPDATE public.consultations
  SET consultation_status = 'active',
      activated_at = v_activated_at,
      expires_at = v_expires_at,
      updated_at = v_activated_at
  WHERE id = p_consultation_id
  RETURNING * INTO v_consultation;

  -- 8. Create exactly one chat conversation (prevent duplicates via unique constraint)
  INSERT INTO public.chat_conversations (
    consultation_id,
    client_id,
    doctor_id,
    created_at
  )
  VALUES (
    v_consultation.id,
    v_consultation.client_id,
    v_consultation.doctor_id,
    v_activated_at
  )
  ON CONFLICT (consultation_id) DO NOTHING;

  -- 9. Audit logging with details
  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_type,
    entity_id,
    details,
    created_at
  ) VALUES (
    v_caller_id,
    'ACTIVATE_CONSULTATION',
    'consultation',
    p_consultation_id::TEXT,
    'Consultation activated by ' || CASE WHEN v_is_admin THEN 'admin' ELSE 'assigned doctor' END || '. 7-day chat window initiated until ' || v_expires_at::TEXT,
    v_activated_at
  );

  RETURN v_consultation;
END;
$$;

-- 4. Permissions
REVOKE EXECUTE ON FUNCTION public.activate_consultation(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activate_consultation(UUID) TO authenticated;
