-- ==============================================================================
-- PET CONNECT VETERINARY HEALTHCARE PLATFORM
-- Migration 4b (Phase 2b Helpers & RPCs): Remaining Workflow & Clinical RPCs
-- File: supabase/migrations/20261113045000_phase2b_additional_workflow_rpcs.sql
-- ==============================================================================
-- Completes the Phase 1 DATABASE_RPC_CONTRACTS.md surface:
-- - Staff invitations: invite_member, accept_invitation
-- - Pet guardians: add_pet_guardian
-- - Doctor self/governance updates: update_doctor_self_profile, admin_update_doctor_governance
-- - Scheduling & appointments: get_available_slots, reschedule_appointment,
--   check_in_appointment, complete_appointment, mark_no_show
-- - Private clinical attachment registration: register_attachment
-- ==============================================================================

-- Uses built-in PostgreSQL 13+ pg_catalog.gen_random_uuid() & sha256() so
-- SET search_path = '' never depends on pgcrypto's installed schema.

-- ------------------------------------------------------------------------------
-- 1. STAFF INVITATIONS (HASHED SINGLE-USE TOKENS)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.invite_member(
  p_organization_id UUID,
  p_email TEXT,
  p_role_codes TEXT[],
  p_branch_ids UUID[] DEFAULT '{}'::uuid[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_email TEXT := lower(trim(p_email));
  v_code TEXT;
  v_bid UUID;
  v_raw_token TEXT;
  v_token_hash TEXT;
  v_expires_at TIMESTAMPTZ := timezone('utc'::text, now()) + INTERVAL '7 days';
  v_inv_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Authentication required' USING ERRCODE = '28000';
  END IF;

  IF NOT app.has_org_permission(p_organization_id, 'staff.manage') THEN
    RAISE EXCEPTION 'Forbidden: Missing staff.manage permission' USING ERRCODE = '42501';
  END IF;

  IF NULLIF(v_email, '') IS NULL OR position('@' IN v_email) < 2 THEN
    RAISE EXCEPTION 'Valid invitee email is required' USING ERRCODE = '22023';
  END IF;

  IF p_role_codes IS NULL OR cardinality(p_role_codes) < 1 THEN
    RAISE EXCEPTION 'At least one role code is required' USING ERRCODE = '22023';
  END IF;

  IF ('org_owner' = ANY(p_role_codes) OR 'org_admin' = ANY(p_role_codes))
     AND NOT app.has_org_permission(p_organization_id, 'roles.assign_admin') THEN
    RAISE EXCEPTION 'Forbidden: Only org_owner can invite org_owner or org_admin' USING ERRCODE = '42501';
  END IF;

  FOREACH v_code IN ARRAY p_role_codes LOOP
    IF NOT EXISTS (SELECT 1 FROM public.organization_roles WHERE code = v_code) THEN
      RAISE EXCEPTION 'Unknown role code %', v_code USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF p_branch_ids IS NOT NULL THEN
    FOREACH v_bid IN ARRAY p_branch_ids LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.branches b
        WHERE b.id = v_bid AND b.organization_id = p_organization_id
      ) THEN
        RAISE EXCEPTION 'Branch % does not belong to organization', v_bid USING ERRCODE = '42501';
      END IF;
    END LOOP;
  END IF;

  v_raw_token := pg_catalog.replace(pg_catalog.gen_random_uuid()::text || pg_catalog.gen_random_uuid()::text, '-', '');
  v_token_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_raw_token, 'UTF8')), 'hex');

  INSERT INTO public.staff_invitations (
    organization_id, email, token_hash, role_codes, branch_ids, invited_by, expires_at
  )
  VALUES (
    p_organization_id, v_email, v_token_hash, p_role_codes,
    COALESCE(p_branch_ids, '{}'::uuid[]), v_uid, v_expires_at
  )
  RETURNING id INTO v_inv_id;

  PERFORM app.write_audit_log(
    p_organization_id, v_uid, 'INVITE_MEMBER', 'staff_invitation', v_inv_id::TEXT,
    'Invited ' || v_email || ' with roles [' || array_to_string(p_role_codes, ',') || ']'
  );

  RETURN jsonb_build_object(
    'invitation_id', v_inv_id,
    'token', v_raw_token,
    'expires_at', v_expires_at
  );
END;
$$;
REVOKE ALL ON FUNCTION public.invite_member(UUID, TEXT, TEXT[], UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_member(UUID, TEXT, TEXT[], UUID[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.accept_invitation(p_token TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_user_email TEXT;
  v_token_hash TEXT;
  v_inv public.staff_invitations;
  v_mem_id UUID;
  v_code TEXT;
  v_role_id UUID;
  v_bid UUID;
  v_full_name TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Authentication required' USING ERRCODE = '28000';
  END IF;

  IF NULLIF(trim(p_token), '') IS NULL THEN
    RAISE EXCEPTION 'Invitation token required' USING ERRCODE = '22023';
  END IF;

  v_token_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(trim(p_token), 'UTF8')), 'hex');

  SELECT * INTO v_inv
  FROM public.staff_invitations
  WHERE token_hash = v_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_inv.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has been revoked' USING ERRCODE = '22023';
  END IF;

  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been accepted' USING ERRCODE = '22023';
  END IF;

  IF timezone('utc'::text, now()) >= v_inv.expires_at THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  IF NOT app.is_org_active(v_inv.organization_id) THEN
    RAISE EXCEPTION 'Organization is inactive' USING ERRCODE = '42501';
  END IF;

  SELECT lower(p.email), p.full_name
  INTO v_user_email, v_full_name
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF v_user_email IS NULL OR v_user_email <> lower(v_inv.email) THEN
    RAISE EXCEPTION 'Forbidden: Authenticated account email does not match invitation' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.organization_memberships (
    organization_id, user_id, status, invited_by, joined_at
  )
  VALUES (
    v_inv.organization_id, v_uid, 'active', v_inv.invited_by, timezone('utc'::text, now())
  )
  ON CONFLICT (organization_id, user_id) DO UPDATE
    SET status = 'active',
        joined_at = COALESCE(public.organization_memberships.joined_at, timezone('utc'::text, now())),
        suspended_at = NULL,
        suspension_reason = NULL
  RETURNING id INTO v_mem_id;

  DELETE FROM public.membership_roles
  WHERE membership_id = v_mem_id AND organization_id = v_inv.organization_id;

  FOREACH v_code IN ARRAY v_inv.role_codes LOOP
    SELECT id INTO v_role_id FROM public.organization_roles WHERE code = v_code;
    INSERT INTO public.membership_roles (membership_id, organization_id, role_id, assigned_by)
    VALUES (v_mem_id, v_inv.organization_id, v_role_id, v_inv.invited_by);
  END LOOP;

  DELETE FROM public.membership_branches
  WHERE membership_id = v_mem_id AND organization_id = v_inv.organization_id;

  IF v_inv.branch_ids IS NOT NULL THEN
    FOREACH v_bid IN ARRAY v_inv.branch_ids LOOP
      INSERT INTO public.membership_branches (membership_id, organization_id, branch_id)
      VALUES (v_mem_id, v_inv.organization_id, v_bid);
    END LOOP;
  END IF;

  IF 'doctor' = ANY(v_inv.role_codes) THEN
    INSERT INTO public.doctor_profiles (
      organization_id, user_id, display_name, specialization, qualification, experience_years, is_active
    )
    VALUES (
      v_inv.organization_id, v_uid, v_full_name, 'General Veterinary Medicine', 'BVSc', 0, true
    )
    ON CONFLICT (organization_id, user_id) DO NOTHING;
  END IF;

  UPDATE public.staff_invitations
  SET accepted_at = timezone('utc'::text, now()),
      accepted_by = v_uid
  WHERE id = v_inv.id;

  PERFORM app.write_audit_log(
    v_inv.organization_id, v_uid, 'ACCEPT_INVITATION', 'organization_membership', v_mem_id::TEXT,
    'Accepted staff invitation ' || v_inv.id::TEXT
  );

  RETURN v_inv.organization_id;
END;
$$;
REVOKE ALL ON FUNCTION public.accept_invitation(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_invitation(TEXT) TO authenticated;

-- ------------------------------------------------------------------------------
-- 2. PET GUARDIANS & DOCTOR PROFILE GOVERNANCE / SELF-UPDATE
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.add_pet_guardian(
  p_pet_id UUID,
  p_clinic_client_id UUID,
  p_relationship TEXT DEFAULT 'co-owner'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_pet public.pets;
  v_cc public.clinic_clients;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;

  SELECT * INTO v_pet FROM public.pets WHERE id = p_pet_id FOR UPDATE;
  IF NOT FOUND OR v_pet.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Pet not found or archived' USING ERRCODE = 'P0002';
  END IF;

  IF NOT app.has_org_permission(v_pet.organization_id, 'pets.write') THEN
    RAISE EXCEPTION 'Forbidden: Only authorized clinic staff can link additional guardians' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cc FROM public.clinic_clients
  WHERE id = p_clinic_client_id AND organization_id = v_pet.organization_id;
  IF NOT FOUND OR v_cc.status <> 'approved' THEN
    RAISE EXCEPTION 'Target clinic client must be approved in the same organization' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.pet_guardians (organization_id, pet_id, clinic_client_id, relationship, is_primary)
  VALUES (v_pet.organization_id, p_pet_id, p_clinic_client_id, COALESCE(NULLIF(trim(p_relationship), ''), 'co-owner'), false)
  ON CONFLICT (pet_id, clinic_client_id) DO UPDATE
    SET relationship = EXCLUDED.relationship;

  PERFORM app.write_audit_log(
    v_pet.organization_id, v_uid, 'ADD_PET_GUARDIAN', 'pet', p_pet_id::TEXT,
    'Linked clinic_client ' || p_clinic_client_id::TEXT || ' as guardian'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.add_pet_guardian(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_pet_guardian(UUID, UUID, TEXT) TO authenticated;

-- SEC-10: Doctors may edit clinical bio/qualification/specialization via RPC;
-- governance fields (is_active, consultation_fee) require staff.manage via admin_update_doctor_governance.
CREATE OR REPLACE FUNCTION public.update_doctor_self_profile(
  p_organization_id UUID,
  p_bio TEXT DEFAULT NULL,
  p_qualification TEXT DEFAULT NULL,
  p_specialization TEXT DEFAULT NULL,
  p_experience_years INT DEFAULT NULL,
  p_registration_number TEXT DEFAULT NULL
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
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  IF NOT app.is_org_member(p_organization_id) THEN
    RAISE EXCEPTION 'Forbidden: Active organization membership required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_doc
  FROM public.doctor_profiles
  WHERE organization_id = p_organization_id AND user_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Doctor profile not found in organization' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.doctor_profiles
  SET bio = COALESCE(p_bio, bio),
      qualification = COALESCE(NULLIF(trim(p_qualification), ''), qualification),
      specialization = COALESCE(NULLIF(trim(p_specialization), ''), specialization),
      experience_years = COALESCE(p_experience_years, experience_years),
      registration_number = COALESCE(NULLIF(trim(p_registration_number), ''), registration_number)
  WHERE id = v_doc.id;

  PERFORM app.write_audit_log(
    p_organization_id, v_uid, 'UPDATE_DOCTOR_SELF_PROFILE', 'doctor_profile', v_doc.id::TEXT,
    'Doctor updated clinical profile attributes'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.update_doctor_self_profile(UUID, TEXT, TEXT, TEXT, INT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_doctor_self_profile(UUID, TEXT, TEXT, TEXT, INT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_doctor_governance(
  p_doctor_profile_id UUID,
  p_is_active BOOLEAN DEFAULT NULL,
  p_consultation_fee NUMERIC DEFAULT NULL,
  p_display_name TEXT DEFAULT NULL
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
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v_doc FROM public.doctor_profiles WHERE id = p_doctor_profile_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Doctor profile not found' USING ERRCODE = 'P0002'; END IF;

  IF NOT app.has_org_permission(v_doc.organization_id, 'staff.manage') THEN
    RAISE EXCEPTION 'Forbidden: Missing staff.manage permission' USING ERRCODE = '42501';
  END IF;

  IF p_consultation_fee IS NOT NULL AND p_consultation_fee < 0 THEN
    RAISE EXCEPTION 'Consultation fee must be non-negative' USING ERRCODE = '22023';
  END IF;

  UPDATE public.doctor_profiles
  SET is_active = COALESCE(p_is_active, is_active),
      consultation_fee = COALESCE(p_consultation_fee, consultation_fee),
      display_name = COALESCE(NULLIF(trim(p_display_name), ''), display_name)
  WHERE id = p_doctor_profile_id;

  PERFORM app.write_audit_log(
    v_doc.organization_id, v_uid, 'ADMIN_UPDATE_DOCTOR_GOVERNANCE', 'doctor_profile', p_doctor_profile_id::TEXT,
    'Updated doctor governance attributes',
    jsonb_build_object('is_active', v_doc.is_active, 'consultation_fee', v_doc.consultation_fee),
    jsonb_build_object('is_active', COALESCE(p_is_active, v_doc.is_active), 'consultation_fee', COALESCE(p_consultation_fee, v_doc.consultation_fee))
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_update_doctor_governance(UUID, BOOLEAN, NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_doctor_governance(UUID, BOOLEAN, NUMERIC, TEXT) TO authenticated;

-- ------------------------------------------------------------------------------
-- 3. SCHEDULING SLOTS & APPOINTMENT LIFECYCLE COMPLETION RPCs
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_available_slots(
  p_organization_id UUID,
  p_branch_id UUID,
  p_doctor_profile_id UUID,
  p_date DATE
)
RETURNS TABLE(slot_start TIMESTAMPTZ, slot_end TIMESTAMPTZ)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_branch_tz TEXT;
  v_iso_dow SMALLINT := EXTRACT(ISODOW FROM p_date)::SMALLINT;
  v_sched RECORD;
  v_win_start TIMESTAMPTZ;
  v_win_end TIMESTAMPTZ;
  v_cur TIMESTAMPTZ;
  v_next TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  IF NOT app.is_org_active(p_organization_id) THEN
    RAISE EXCEPTION 'Organization unavailable' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    app.is_org_member(p_organization_id)
    OR app.current_clinic_client_id(p_organization_id) IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Forbidden: Approved clinic client or organization staff membership required' USING ERRCODE = '42501';
  END IF;

  SELECT b.timezone INTO v_branch_tz
  FROM public.branches b
  WHERE b.id = p_branch_id AND b.organization_id = p_organization_id AND b.is_active = true;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.doctor_profiles dp
    JOIN public.doctor_branch_assignments dba
      ON dba.doctor_profile_id = dp.id AND dba.organization_id = dp.organization_id
    WHERE dp.id = p_doctor_profile_id
      AND dp.organization_id = p_organization_id
      AND dp.is_active = true
      AND dba.branch_id = p_branch_id
      AND dba.is_active = true
  ) THEN
    RETURN;
  END IF;

  FOR v_sched IN
    SELECT ds.start_time, ds.end_time, ds.slot_minutes
    FROM public.doctor_schedules ds
    WHERE ds.organization_id = p_organization_id
      AND ds.branch_id = p_branch_id
      AND ds.doctor_profile_id = p_doctor_profile_id
      AND ds.weekday = v_iso_dow
      AND ds.is_active = true
      AND (ds.effective_from IS NULL OR p_date >= ds.effective_from)
      AND (ds.effective_to IS NULL OR p_date <= ds.effective_to)
    ORDER BY ds.start_time
  LOOP
    v_win_start := (p_date::TIMESTAMP + v_sched.start_time) AT TIME ZONE v_branch_tz;
    v_win_end := (p_date::TIMESTAMP + v_sched.end_time) AT TIME ZONE v_branch_tz;
    v_cur := v_win_start;

    WHILE v_cur + make_interval(mins => v_sched.slot_minutes) <= v_win_end LOOP
      v_next := v_cur + make_interval(mins => v_sched.slot_minutes);

      -- Exclude schedule exceptions and ONLY confirmed/checked_in appointments
      -- (Pending 'requested' appointments NEVER block available slots)
      IF NOT EXISTS (
        SELECT 1 FROM public.doctor_schedule_exceptions dse
        WHERE dse.organization_id = p_organization_id
          AND dse.doctor_profile_id = p_doctor_profile_id
          AND (dse.branch_id IS NULL OR dse.branch_id = p_branch_id)
          AND dse.exception_type IN ('leave', 'holiday', 'clinic_closure')
          AND tstzrange(dse.start_at, dse.end_at, '[)') && tstzrange(v_cur, v_next, '[)')
      ) AND NOT EXISTS (
        SELECT 1 FROM public.appointments a
        WHERE a.doctor_profile_id = p_doctor_profile_id
          AND a.status IN ('confirmed', 'checked_in')
          AND a.scheduled_range && tstzrange(v_cur, v_next, '[)')
      ) THEN
        slot_start := v_cur;
        slot_end := v_next;
        RETURN NEXT;
      END IF;

      v_cur := v_next;
    END LOOP;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.get_available_slots(UUID, UUID, UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_available_slots(UUID, UUID, UUID, DATE) TO authenticated;

CREATE OR REPLACE FUNCTION public.reschedule_appointment(
  p_appointment_id UUID,
  p_new_start TIMESTAMPTZ,
  p_new_end TIMESTAMPTZ
)
RETURNS public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_appt public.appointments;
  v_branch_tz TEXT;
  v_local_start TIMESTAMP;
  v_local_end TIMESTAMP;
  v_iso_dow SMALLINT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  IF p_new_end <= p_new_start THEN RAISE EXCEPTION 'End time must be after start time' USING ERRCODE = '22023'; END IF;

  SELECT * INTO v_appt FROM public.appointments WHERE id = p_appointment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Appointment not found' USING ERRCODE = 'P0002'; END IF;

  IF NOT app.has_branch_access(v_appt.organization_id, v_appt.branch_id, 'appointments.confirm') THEN
    RAISE EXCEPTION 'Forbidden: Missing appointments.confirm permission' USING ERRCODE = '42501';
  END IF;

  IF v_appt.status <> 'confirmed' THEN
    RAISE EXCEPTION 'Only confirmed appointments can be rescheduled' USING ERRCODE = '22023';
  END IF;

  SELECT b.timezone INTO v_branch_tz
  FROM public.branches b
  WHERE b.id = v_appt.branch_id AND b.organization_id = v_appt.organization_id AND b.is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Branch is inactive' USING ERRCODE = '22023'; END IF;

  v_local_start := p_new_start AT TIME ZONE v_branch_tz;
  v_local_end := p_new_end AT TIME ZONE v_branch_tz;
  v_iso_dow := EXTRACT(ISODOW FROM v_local_start)::SMALLINT;

  IF v_local_start::DATE = v_local_end::DATE AND EXISTS (
    SELECT 1 FROM public.doctor_schedules ds
    WHERE ds.organization_id = v_appt.organization_id
      AND ds.branch_id = v_appt.branch_id
      AND ds.doctor_profile_id = v_appt.doctor_profile_id
      AND ds.is_active = true
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.doctor_schedules ds
      WHERE ds.organization_id = v_appt.organization_id
        AND ds.branch_id = v_appt.branch_id
        AND ds.doctor_profile_id = v_appt.doctor_profile_id
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

  IF EXISTS (
    SELECT 1 FROM public.doctor_schedule_exceptions dse
    WHERE dse.organization_id = v_appt.organization_id
      AND dse.doctor_profile_id = v_appt.doctor_profile_id
      AND (dse.branch_id IS NULL OR dse.branch_id = v_appt.branch_id)
      AND dse.exception_type IN ('leave', 'holiday', 'clinic_closure')
      AND tstzrange(dse.start_at, dse.end_at, '[)') && tstzrange(p_new_start, p_new_end, '[)')
  ) THEN
    RAISE EXCEPTION 'Requested slot overlaps schedule exception' USING ERRCODE = '22023';
  END IF;

  UPDATE public.appointments
  SET scheduled_range = tstzrange(p_new_start, p_new_end, '[)')
  WHERE id = p_appointment_id
  RETURNING * INTO v_appt;

  INSERT INTO public.appointment_status_history (
    organization_id, appointment_id, from_status, to_status, changed_by, reason
  )
  VALUES (
    v_appt.organization_id, v_appt.id, 'confirmed', 'confirmed', v_uid,
    'Rescheduled to [' || p_new_start::TEXT || ', ' || p_new_end::TEXT || ')'
  );

  PERFORM app.write_audit_log(
    v_appt.organization_id, v_uid, 'RESCHEDULE_APPOINTMENT', 'appointment', v_appt.id::TEXT,
    'Rescheduled appointment to [' || p_new_start::TEXT || ', ' || p_new_end::TEXT || ')'
  );

  RETURN v_appt;
END;
$$;
REVOKE ALL ON FUNCTION public.reschedule_appointment(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reschedule_appointment(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

CREATE OR REPLACE FUNCTION public.check_in_appointment(p_appointment_id UUID)
RETURNS public.appointments
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

  IF NOT app.has_branch_access(v_appt.organization_id, v_appt.branch_id, 'appointments.confirm') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_appt.status <> 'confirmed' THEN
    RAISE EXCEPTION 'Only confirmed appointments can be checked in' USING ERRCODE = '22023';
  END IF;

  UPDATE public.appointments
  SET status = 'checked_in',
      checked_in_at = timezone('utc'::text, now())
  WHERE id = p_appointment_id
  RETURNING * INTO v_appt;

  INSERT INTO public.appointment_status_history (organization_id, appointment_id, from_status, to_status, changed_by, reason)
  VALUES (v_appt.organization_id, v_appt.id, 'confirmed', 'checked_in', v_uid, 'Checked in');
  PERFORM app.write_audit_log(v_appt.organization_id, v_uid, 'CHECK_IN_APPOINTMENT', 'appointment', v_appt.id::TEXT, 'Checked in');

  RETURN v_appt;
END;
$$;
REVOKE ALL ON FUNCTION public.check_in_appointment(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_in_appointment(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_appointment(p_appointment_id UUID)
RETURNS public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_appt public.appointments;
  v_from_status TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v_appt FROM public.appointments WHERE id = p_appointment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Appointment not found' USING ERRCODE = 'P0002'; END IF;

  IF NOT (
    app.has_branch_access(v_appt.organization_id, v_appt.branch_id, 'appointments.confirm')
    OR EXISTS (
      SELECT 1 FROM public.doctor_profiles dp
      WHERE dp.id = v_appt.doctor_profile_id AND dp.organization_id = v_appt.organization_id AND dp.user_id = v_uid AND dp.is_active = true
    )
  ) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_appt.status NOT IN ('confirmed', 'checked_in') THEN
    RAISE EXCEPTION 'Only confirmed or checked_in appointments can be completed' USING ERRCODE = '22023';
  END IF;

  v_from_status := v_appt.status;

  UPDATE public.appointments
  SET status = 'completed',
      completed_at = timezone('utc'::text, now())
  WHERE id = p_appointment_id
  RETURNING * INTO v_appt;

  INSERT INTO public.appointment_status_history (organization_id, appointment_id, from_status, to_status, changed_by, reason)
  VALUES (v_appt.organization_id, v_appt.id, v_from_status, 'completed', v_uid, 'Appointment completed');
  PERFORM app.write_audit_log(v_appt.organization_id, v_uid, 'COMPLETE_APPOINTMENT', 'appointment', v_appt.id::TEXT, 'Completed');

  RETURN v_appt;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_appointment(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_appointment(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_no_show(p_appointment_id UUID)
RETURNS public.appointments
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

  IF NOT app.has_branch_access(v_appt.organization_id, v_appt.branch_id, 'appointments.confirm') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_appt.status <> 'confirmed' THEN
    RAISE EXCEPTION 'Only confirmed appointments can be marked no_show' USING ERRCODE = '22023';
  END IF;

  UPDATE public.appointments SET status = 'no_show' WHERE id = p_appointment_id RETURNING * INTO v_appt;

  INSERT INTO public.appointment_status_history (organization_id, appointment_id, from_status, to_status, changed_by, reason)
  VALUES (v_appt.organization_id, v_appt.id, 'confirmed', 'no_show', v_uid, 'Client no-show');
  PERFORM app.write_audit_log(v_appt.organization_id, v_uid, 'MARK_NO_SHOW', 'appointment', v_appt.id::TEXT, 'Marked no_show');

  RETURN v_appt;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_no_show(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_no_show(UUID) TO authenticated;

-- ------------------------------------------------------------------------------
-- 4. PRIVATE CLINICAL ATTACHMENT REGISTRATION RPC
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.register_attachment(
  p_organization_id UUID,
  p_entity_type TEXT,
  p_entity_id UUID,
  p_object_path TEXT,
  p_mime_type TEXT,
  p_byte_size BIGINT,
  p_original_filename TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_att_id UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  IF NOT app.is_org_active(p_organization_id) THEN
    RAISE EXCEPTION 'Organization unavailable' USING ERRCODE = '42501';
  END IF;

  IF p_object_path NOT LIKE (p_organization_id::TEXT || '/%') THEN
    RAISE EXCEPTION 'Invalid object path prefix for organization' USING ERRCODE = '42501';
  END IF;

  IF p_entity_type IN ('consultation', 'chat_message') THEN
    IF NOT app.is_consultation_participant(p_entity_id) THEN
      RAISE EXCEPTION 'Forbidden: Only consultation participants may attach consultation files' USING ERRCODE = '42501';
    END IF;
  ELSIF p_entity_type = 'pet' THEN
    IF NOT (app.has_org_permission(p_organization_id, 'pets.write') OR app.is_pet_guardian(p_organization_id, p_entity_id)) THEN
      RAISE EXCEPTION 'Forbidden: Cannot attach file to pet' USING ERRCODE = '42501';
    END IF;
  ELSIF p_entity_type = 'medical_record' THEN
    IF NOT app.has_org_permission(p_organization_id, 'medical_records.write') THEN
      RAISE EXCEPTION 'Forbidden: Only authorized organization doctors may attach medical record files' USING ERRCODE = '42501';
    END IF;
  ELSIF p_entity_type = 'application' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.organization_applications oa
      WHERE oa.id = p_entity_id AND oa.applicant_user_id = v_uid
    ) THEN
      RAISE EXCEPTION 'Forbidden: Invalid application attachment target' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported attachment entity_type %', p_entity_type USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.attachments (
    organization_id, entity_type, entity_id, bucket_id, object_path, mime_type, byte_size, original_filename, uploaded_by
  )
  VALUES (
    p_organization_id, p_entity_type, p_entity_id, 'clinical-files', p_object_path,
    p_mime_type, p_byte_size, trim(p_original_filename), v_uid
  )
  RETURNING id INTO v_att_id;

  RETURN v_att_id;
END;
$$;
REVOKE ALL ON FUNCTION public.register_attachment(UUID, TEXT, UUID, TEXT, TEXT, BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_attachment(UUID, TEXT, UUID, TEXT, TEXT, BIGINT, TEXT) TO authenticated;
