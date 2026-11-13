-- ==============================================================================
-- PET CONNECT VETERINARY HEALTHCARE PLATFORM
-- Migration 9 (Phase 5): Doctor Portal Scheduling, Breaks & Clinical Summary RPCs
-- File: supabase/migrations/20261113090000_phase5_doctor_portal_rpcs.sql
-- ==============================================================================
-- NOTES:
-- 1. Strictly additive / hardened incremental migration for Phase 5 Doctor Portal.
-- 2. Adds clinical_notes & follow_up_date columns to public.consultations.
-- 3. Adds save_doctor_branch_day_schedule(...) supporting working hours + break
--    windows while validating against existing confirmed/checked_in appointments.
-- 4. Hardens add_schedule_exception(...) against confirmed/checked_in appointments
--    and adds remove_schedule_exception(UUID).
-- 5. Adds update_consultation_clinical_summary(...) without touching chat expiry.
-- ==============================================================================

-- 1. Extend consultations with clinical notes & follow-up date (additive)
ALTER TABLE public.consultations
  ADD COLUMN IF NOT EXISTS clinical_notes TEXT,
  ADD COLUMN IF NOT EXISTS follow_up_date DATE;

-- 2. Save Doctor Weekly Day Schedule (Working Hours + Optional Break + Slot Size)
-- Validates caller authorization, active branch assignment, time boundaries,
-- and prevents removing or shrinking hours/breaks over confirmed appointments.
CREATE OR REPLACE FUNCTION public.save_doctor_branch_day_schedule(
  p_organization_id UUID,
  p_branch_id UUID,
  p_doctor_profile_id UUID,
  p_weekday SMALLINT,
  p_is_available BOOLEAN,
  p_start_time TIME,
  p_end_time TIME,
  p_break_start TIME DEFAULT NULL,
  p_break_end TIME DEFAULT NULL,
  p_slot_minutes SMALLINT DEFAULT 30
)
RETURNS SETOF public.doctor_schedules
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_doc public.doctor_profiles;
  v_branch_tz TEXT;
  v_slot_mins SMALLINT := COALESCE(p_slot_minutes, 30);
  v_conflict_start TIMESTAMPTZ;
  v_has_break BOOLEAN := (p_break_start IS NOT NULL OR p_break_end IS NOT NULL);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Authentication required' USING ERRCODE = '28000';
  END IF;

  IF NOT app.is_org_active(p_organization_id) THEN
    RAISE EXCEPTION 'Forbidden: Organization is inactive or unavailable' USING ERRCODE = '42501';
  END IF;

  IF p_weekday IS NULL OR p_weekday < 1 OR p_weekday > 7 THEN
    RAISE EXCEPTION 'Weekday must be an ISO day between 1 (Monday) and 7 (Sunday)' USING ERRCODE = '22023';
  END IF;

  IF v_slot_mins < 5 OR v_slot_mins > 240 THEN
    RAISE EXCEPTION 'Slot duration must be between 5 and 240 minutes' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_doc
  FROM public.doctor_profiles
  WHERE id = p_doctor_profile_id
    AND organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Doctor profile not found in organization' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (
    app.has_branch_access(p_organization_id, p_branch_id, 'schedules.manage')
    AND (
      app.has_org_permission(p_organization_id, 'staff.manage')
      OR v_doc.user_id = v_uid
    )
  ) THEN
    RAISE EXCEPTION 'Forbidden: Cannot manage schedule for this doctor or branch' USING ERRCODE = '42501';
  END IF;

  SELECT b.timezone INTO v_branch_tz
  FROM public.branches b
  WHERE b.id = p_branch_id
    AND b.organization_id = p_organization_id
    AND b.is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Branch is inactive or does not belong to organization' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.doctor_branch_assignments dba
    WHERE dba.organization_id = p_organization_id
      AND dba.doctor_profile_id = p_doctor_profile_id
      AND dba.branch_id = p_branch_id
      AND dba.is_active = true
  ) THEN
    RAISE EXCEPTION 'Doctor is not actively assigned to branch %', p_branch_id USING ERRCODE = '22023';
  END IF;

  IF COALESCE(p_is_available, false) THEN
    IF p_start_time IS NULL OR p_end_time IS NULL OR p_end_time <= p_start_time THEN
      RAISE EXCEPTION 'Working shift end time must be after start time' USING ERRCODE = '22023';
    END IF;

    IF v_has_break THEN
      IF p_break_start IS NULL OR p_break_end IS NULL THEN
        RAISE EXCEPTION 'Both break start and break end times must be provided' USING ERRCODE = '22023';
      END IF;
      IF p_break_end <= p_break_start THEN
        RAISE EXCEPTION 'Break end time must be after break start time' USING ERRCODE = '22023';
      END IF;
      IF p_break_start < p_start_time OR p_break_end > p_end_time THEN
        RAISE EXCEPTION 'Break window must fall inside working shift hours' USING ERRCODE = '22023';
      END IF;
      IF p_break_start = p_start_time AND p_break_end = p_end_time THEN
        RAISE EXCEPTION 'Break cannot cover the entire working shift' USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;

  -- Validate against existing future confirmed or checked-in appointments at this branch & weekday
  SELECT lower(a.scheduled_range)
  INTO v_conflict_start
  FROM public.appointments a
  WHERE a.organization_id = p_organization_id
    AND a.branch_id = p_branch_id
    AND a.doctor_profile_id = p_doctor_profile_id
    AND a.status IN ('confirmed', 'checked_in')
    AND a.scheduled_range IS NOT NULL
    AND upper(a.scheduled_range) > timezone('utc'::text, now())
    AND EXTRACT(ISODOW FROM (lower(a.scheduled_range) AT TIME ZONE v_branch_tz))::SMALLINT = p_weekday
    AND (
      NOT COALESCE(p_is_available, false)
      OR (lower(a.scheduled_range) AT TIME ZONE v_branch_tz)::DATE <> (upper(a.scheduled_range) AT TIME ZONE v_branch_tz)::DATE
      OR (lower(a.scheduled_range) AT TIME ZONE v_branch_tz)::TIME < p_start_time
      OR (upper(a.scheduled_range) AT TIME ZONE v_branch_tz)::TIME > p_end_time
      OR (
        v_has_break
        AND (lower(a.scheduled_range) AT TIME ZONE v_branch_tz)::TIME < p_break_end
        AND (upper(a.scheduled_range) AT TIME ZONE v_branch_tz)::TIME > p_break_start
      )
    )
  ORDER BY lower(a.scheduled_range) ASC
  LIMIT 1;

  IF v_conflict_start IS NOT NULL THEN
    RAISE EXCEPTION 'Schedule change conflicts with existing confirmed appointment starting at %',
      to_char(v_conflict_start AT TIME ZONE v_branch_tz, 'YYYY-MM-DD HH24:MI')
      USING ERRCODE = '22023';
  END IF;

  -- Replace active schedule windows for this (doctor, branch, weekday)
  DELETE FROM public.doctor_schedules
  WHERE organization_id = p_organization_id
    AND branch_id = p_branch_id
    AND doctor_profile_id = p_doctor_profile_id
    AND weekday = p_weekday
    AND is_active = true;

  IF COALESCE(p_is_available, false) THEN
    IF v_has_break THEN
      IF p_break_start > p_start_time THEN
        INSERT INTO public.doctor_schedules (
          organization_id, branch_id, doctor_profile_id, weekday, start_time, end_time, slot_minutes, is_active
        )
        VALUES (
          p_organization_id, p_branch_id, p_doctor_profile_id, p_weekday, p_start_time, p_break_start, v_slot_mins, true
        );
      END IF;

      IF p_break_end < p_end_time THEN
        INSERT INTO public.doctor_schedules (
          organization_id, branch_id, doctor_profile_id, weekday, start_time, end_time, slot_minutes, is_active
        )
        VALUES (
          p_organization_id, p_branch_id, p_doctor_profile_id, p_weekday, p_break_end, p_end_time, v_slot_mins, true
        );
      END IF;
    ELSE
      INSERT INTO public.doctor_schedules (
        organization_id, branch_id, doctor_profile_id, weekday, start_time, end_time, slot_minutes, is_active
      )
      VALUES (
        p_organization_id, p_branch_id, p_doctor_profile_id, p_weekday, p_start_time, p_end_time, v_slot_mins, true
      );
    END IF;
  END IF;

  PERFORM app.write_audit_log(
    p_organization_id,
    v_uid,
    'SAVE_DOCTOR_DAY_SCHEDULE',
    'doctor_schedule',
    p_doctor_profile_id::TEXT || ':' || p_branch_id::TEXT || ':' || p_weekday::TEXT,
    CASE WHEN COALESCE(p_is_available, false)
      THEN 'Updated weekday ' || p_weekday::TEXT || ' availability (' || p_start_time::TEXT || '-' || p_end_time::TEXT || ')'
      ELSE 'Marked weekday ' || p_weekday::TEXT || ' unavailable'
    END
  );

  RETURN QUERY
  SELECT *
  FROM public.doctor_schedules ds
  WHERE ds.organization_id = p_organization_id
    AND ds.branch_id = p_branch_id
    AND ds.doctor_profile_id = p_doctor_profile_id
    AND ds.weekday = p_weekday
    AND ds.is_active = true
  ORDER BY ds.start_time ASC;
END;
$$;
REVOKE ALL ON FUNCTION public.save_doctor_branch_day_schedule(UUID, UUID, UUID, SMALLINT, BOOLEAN, TIME, TIME, TIME, TIME, SMALLINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_doctor_branch_day_schedule(UUID, UUID, UUID, SMALLINT, BOOLEAN, TIME, TIME, TIME, TIME, SMALLINT) TO authenticated;

-- 3. Harden add_schedule_exception with confirmed appointment conflict checking & branch assignment validation
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
  v_conflict_start TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  IF NOT app.is_org_active(p_organization_id) THEN
    RAISE EXCEPTION 'Forbidden: Organization is inactive' USING ERRCODE = '42501';
  END IF;

  IF p_start_at IS NULL OR p_end_at IS NULL OR p_end_at <= p_start_at THEN
    RAISE EXCEPTION 'Exception end timestamp must be after start timestamp' USING ERRCODE = '22023';
  END IF;

  IF p_exception_type NOT IN ('leave', 'holiday', 'clinic_closure', 'extra_availability') THEN
    RAISE EXCEPTION 'Invalid schedule exception type %', p_exception_type USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_doc FROM public.doctor_profiles
  WHERE id = p_doctor_profile_id AND organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Doctor not found in organization' USING ERRCODE = 'P0002'; END IF;

  IF NOT (
    app.has_org_permission(p_organization_id, 'schedules.manage')
    AND (app.has_org_permission(p_organization_id, 'staff.manage') OR v_doc.user_id = v_uid)
    AND (p_branch_id IS NULL OR app.has_branch_access(p_organization_id, p_branch_id, 'schedules.manage'))
  ) THEN
    RAISE EXCEPTION 'Forbidden: Cannot add schedule exception for this doctor/branch' USING ERRCODE = '42501';
  END IF;

  IF p_branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.doctor_branch_assignments dba
    WHERE dba.organization_id = p_organization_id
      AND dba.doctor_profile_id = p_doctor_profile_id
      AND dba.branch_id = p_branch_id
      AND dba.is_active = true
  ) THEN
    RAISE EXCEPTION 'Doctor is not actively assigned to selected branch' USING ERRCODE = '22023';
  END IF;

  -- Prevent blocking time over confirmed/checked-in appointments
  IF p_exception_type IN ('leave', 'holiday', 'clinic_closure') THEN
    SELECT lower(a.scheduled_range)
    INTO v_conflict_start
    FROM public.appointments a
    WHERE a.organization_id = p_organization_id
      AND a.doctor_profile_id = p_doctor_profile_id
      AND (p_branch_id IS NULL OR a.branch_id = p_branch_id)
      AND a.status IN ('confirmed', 'checked_in')
      AND a.scheduled_range IS NOT NULL
      AND a.scheduled_range && tstzrange(p_start_at, p_end_at, '[)')
    ORDER BY lower(a.scheduled_range) ASC
    LIMIT 1;

    IF v_conflict_start IS NOT NULL THEN
      RAISE EXCEPTION 'Blocked exception overlaps existing confirmed appointment starting at %',
        v_conflict_start::TEXT USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.doctor_schedule_exceptions (
    organization_id, branch_id, doctor_profile_id, start_at, end_at, exception_type, reason, created_by
  )
  VALUES (
    p_organization_id, p_branch_id, p_doctor_profile_id, p_start_at, p_end_at, p_exception_type, NULLIF(trim(COALESCE(p_reason, '')), ''), v_uid
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

CREATE OR REPLACE FUNCTION public.remove_schedule_exception(p_exception_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_exc public.doctor_schedule_exceptions;
  v_doc public.doctor_profiles;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;

  SELECT * INTO v_exc
  FROM public.doctor_schedule_exceptions
  WHERE id = p_exception_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Schedule exception not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT app.is_org_active(v_exc.organization_id) THEN
    RAISE EXCEPTION 'Forbidden: Organization is inactive' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_doc
  FROM public.doctor_profiles
  WHERE id = v_exc.doctor_profile_id
    AND organization_id = v_exc.organization_id;

  IF NOT (
    app.has_org_permission(v_exc.organization_id, 'schedules.manage')
    AND (app.has_org_permission(v_exc.organization_id, 'staff.manage') OR v_doc.user_id = v_uid)
    AND (v_exc.branch_id IS NULL OR app.has_branch_access(v_exc.organization_id, v_exc.branch_id, 'schedules.manage'))
  ) THEN
    RAISE EXCEPTION 'Forbidden: Cannot remove this schedule exception' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.doctor_schedule_exceptions WHERE id = p_exception_id;

  PERFORM app.write_audit_log(
    v_exc.organization_id, v_uid, 'REMOVE_SCHEDULE_EXCEPTION', 'doctor_schedule_exception', p_exception_id::TEXT,
    'Removed schedule exception (' || v_exc.exception_type || ')'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.remove_schedule_exception(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_schedule_exception(UUID) TO authenticated;

-- 4. Consultation Clinical Summary & Follow-Up RPC
-- Updates ONLY clinical_notes and follow_up_date; NEVER touches chat expiry timestamps.
CREATE OR REPLACE FUNCTION public.update_consultation_clinical_summary(
  p_consultation_id UUID,
  p_clinical_notes TEXT DEFAULT NULL,
  p_follow_up_date DATE DEFAULT NULL
)
RETURNS public.consultations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_cons public.consultations;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_cons
  FROM public.consultations
  WHERE id = p_consultation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Consultation not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT app.is_org_active(v_cons.organization_id) THEN
    RAISE EXCEPTION 'Forbidden: Organization is inactive' USING ERRCODE = '42501';
  END IF;

  IF NOT app.has_org_permission(v_cons.organization_id, 'medical_records.write') THEN
    RAISE EXCEPTION 'Forbidden: Missing medical_records.write permission' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    app.has_org_permission(v_cons.organization_id, 'staff.manage')
    OR EXISTS (
      SELECT 1 FROM public.doctor_profiles dp
      WHERE dp.id = v_cons.doctor_id
        AND dp.organization_id = v_cons.organization_id
        AND dp.user_id = v_uid
        AND dp.is_active = true
    )
  ) THEN
    RAISE EXCEPTION 'Forbidden: Only treating active doctor or authorized clinic admin may update consultation notes' USING ERRCODE = '42501';
  END IF;

  IF v_cons.consultation_status NOT IN ('active', 'completed', 'expired') THEN
    RAISE EXCEPTION 'Clinical notes can only be recorded for activated, completed, or expired consultations' USING ERRCODE = '22023';
  END IF;

  UPDATE public.consultations
  SET clinical_notes = NULLIF(trim(COALESCE(p_clinical_notes, '')), ''),
      follow_up_date = p_follow_up_date,
      updated_at = timezone('utc'::text, now())
  WHERE id = p_consultation_id
  RETURNING * INTO v_cons;

  PERFORM app.write_audit_log(
    v_cons.organization_id,
    v_uid,
    'UPDATE_CONSULTATION_NOTES',
    'consultation',
    p_consultation_id::TEXT,
    'Updated consultation clinical summary and follow-up date'
  );

  RETURN v_cons;
END;
$$;
REVOKE ALL ON FUNCTION public.update_consultation_clinical_summary(UUID, TEXT, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_consultation_clinical_summary(UUID, TEXT, DATE) TO authenticated;
