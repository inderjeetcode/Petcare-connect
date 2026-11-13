-- ==============================================================================
-- PET CONNECT VETERINARY HEALTHCARE PLATFORM
-- Migration 12 (Phase 8): Core Business Workflows, Transactions & Hardening
-- File: supabase/migrations/20261113120000_phase8_core_workflows_hardening.sql
-- ==============================================================================
-- GUARANTEES:
-- 1. Additive schema support linking public.appointments -> public.clinic_services
--    within the same organization (service_id, organization_id).
-- 2. Ephemeral browser blob:/data: URL rejection at DB constraint & RPC layers.
-- 3. Transactional confirmation & rescheduling with doctor row locking (FOR UPDATE),
--    cross-branch overlap prevention (no_double_booking GiST + 23P01), service
--    & duration validation, and branch/schedule/exception rechecks.
-- 4. Appointment <-> consultation separation and trusted DB-side 7-day window
--    activation + explicit server-side expiry transition (expire_due_consultations).
-- 5. Participant-only chat & attachment authorization + post-expiry rejection.
-- 6. Auditable append-only medical records, amendments, prescriptions, vaccinations.
-- 7. Server-side notification generation across all core workflow events.
-- 8. Safe Realtime publication enrollment for chat_messages, notifications,
--    appointments, and consultations.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- SECTION 1: SCHEMA EXTENSIONS & DATA HYGIENE CONSTRAINTS
-- ------------------------------------------------------------------------------

-- Allow composite FK from appointments(service_id, organization_id) -> clinic_services
DO $$ BEGIN
  ALTER TABLE public.clinic_services
    ADD CONSTRAINT clinic_services_id_org_uq UNIQUE (id, organization_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS service_id UUID;

DO $$ BEGIN
  ALTER TABLE public.appointments
    ADD CONSTRAINT appointments_service_fk
    FOREIGN KEY (service_id, organization_id)
    REFERENCES public.clinic_services(id, organization_id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_appointments_service
  ON public.appointments(organization_id, service_id)
  WHERE service_id IS NOT NULL;

-- Defense-in-depth: forbid persisting temporary browser blob: or data: URLs
DO $$ BEGIN
  ALTER TABLE public.attachments
    ADD CONSTRAINT attachments_no_ephemeral_url_chk
    CHECK (
      object_path !~* '^blob:'
      AND object_path !~* '^data:'
      AND position('..' IN object_path) = 0
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.chat_messages
    ADD CONSTRAINT chat_messages_no_blob_url_chk
    CHECK (
      attachment_url IS NULL
      OR (attachment_url !~* '^blob:' AND attachment_url !~* '^data:')
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.pets
    ADD CONSTRAINT pets_no_blob_avatar_chk
    CHECK (
      avatar_url IS NULL
      OR (avatar_url !~* '^blob:' AND avatar_url !~* '^data:')
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_no_blob_avatar_chk
    CHECK (
      avatar_url IS NULL
      OR (avatar_url !~* '^blob:' AND avatar_url !~* '^data:')
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------------------------------------
-- SECTION 2: INTERNAL NOTIFICATION & CONTEXT HELPERS (app SCHEMA ONLY)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.notify_pet_guardians(
  p_org_id UUID,
  p_pet_id UUID,
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
DECLARE
  v_user_id UUID;
  v_sent BOOLEAN := false;
BEGIN
  FOR v_user_id IN
    SELECT DISTINCT cc.user_id
    FROM public.pet_guardians pg
    JOIN public.clinic_clients cc
      ON cc.id = pg.clinic_client_id
     AND cc.organization_id = pg.organization_id
    WHERE pg.organization_id = p_org_id
      AND pg.pet_id = p_pet_id
      AND cc.status = 'approved'
      AND cc.user_id IS NOT NULL
  LOOP
    PERFORM app.enqueue_notification(
      p_org_id, v_user_id, p_title, p_message, p_type, p_link_url
    );
    v_sent := true;
  END LOOP;

  IF NOT v_sent THEN
    SELECT p.owner_id INTO v_user_id
    FROM public.pets p
    WHERE p.id = p_pet_id AND p.organization_id = p_org_id;

    IF v_user_id IS NOT NULL THEN
      PERFORM app.enqueue_notification(
        p_org_id, v_user_id, p_title, p_message, p_type, p_link_url
      );
    END IF;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION app.notify_pet_guardians(UUID, UUID, TEXT, TEXT, public.notification_type_enum, TEXT)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION app.notify_branch_appointment_staff(
  p_org_id UUID,
  p_branch_id UUID,
  p_title TEXT,
  p_message TEXT,
  p_type public.notification_type_enum,
  p_link_url TEXT DEFAULT NULL,
  p_exclude_user_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_staff_user_id UUID;
BEGIN
  FOR v_staff_user_id IN
    SELECT DISTINCT om.user_id
    FROM public.organization_memberships om
    JOIN public.membership_roles mr
      ON mr.membership_id = om.id
     AND mr.organization_id = om.organization_id
    JOIN public.role_permissions rp
      ON rp.role_id = mr.role_id
    WHERE om.organization_id = p_org_id
      AND om.status = 'active'
      AND rp.permission_code = 'appointments.confirm'
      AND (p_exclude_user_id IS NULL OR om.user_id <> p_exclude_user_id)
      AND (
        NOT EXISTS (
          SELECT 1 FROM public.membership_branches mb
          WHERE mb.membership_id = om.id
            AND mb.organization_id = om.organization_id
        )
        OR EXISTS (
          SELECT 1 FROM public.membership_branches mb
          WHERE mb.membership_id = om.id
            AND mb.organization_id = om.organization_id
            AND mb.branch_id = p_branch_id
        )
      )
  LOOP
    PERFORM app.enqueue_notification(
      p_org_id, v_staff_user_id, p_title, p_message, p_type, p_link_url
    );
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION app.notify_branch_appointment_staff(UUID, UUID, TEXT, TEXT, public.notification_type_enum, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- SECTION 3: SCHEDULING, SERVICE VALIDATION & APPOINTMENT LIFECYCLE RPCs
-- ------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_available_slots(UUID, UUID, UUID, DATE);
CREATE OR REPLACE FUNCTION public.get_available_slots(
  p_organization_id UUID,
  p_branch_id UUID,
  p_doctor_profile_id UUID,
  p_date DATE,
  p_service_id UUID DEFAULT NULL
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
  v_service_mins INT := NULL;
  v_slot_mins INT;
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

  IF p_service_id IS NOT NULL THEN
    SELECT cs.duration_minutes::INT INTO v_service_mins
    FROM public.clinic_services cs
    WHERE cs.id = p_service_id
      AND cs.organization_id = p_organization_id
      AND cs.is_active = true
      AND (cs.branch_id IS NULL OR cs.branch_id = p_branch_id);

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invalid or inactive clinic service for target branch' USING ERRCODE = '22023';
    END IF;
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
    v_slot_mins := COALESCE(v_service_mins, v_sched.slot_minutes::INT);
    IF v_slot_mins < 5 OR v_slot_mins > 480 THEN
      CONTINUE;
    END IF;

    v_win_start := (p_date::TIMESTAMP + v_sched.start_time) AT TIME ZONE v_branch_tz;
    v_win_end := (p_date::TIMESTAMP + v_sched.end_time) AT TIME ZONE v_branch_tz;
    v_cur := v_win_start;

    WHILE v_cur + make_interval(mins => v_slot_mins) <= v_win_end LOOP
      v_next := v_cur + make_interval(mins => v_slot_mins);

      -- Pending 'requested' rows have scheduled_range = NULL and never block available slots
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
REVOKE ALL ON FUNCTION public.get_available_slots(UUID, UUID, UUID, DATE, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_available_slots(UUID, UUID, UUID, DATE, UUID) TO authenticated;

DROP FUNCTION IF EXISTS public.request_appointment(UUID, UUID, UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT);
CREATE OR REPLACE FUNCTION public.request_appointment(
  p_organization_id UUID,
  p_branch_id UUID,
  p_pet_id UUID,
  p_doctor_profile_id UUID,
  p_requested_start TIMESTAMPTZ,
  p_requested_end TIMESTAMPTZ,
  p_reason TEXT,
  p_service_id UUID DEFAULT NULL
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
  v_org_slug TEXT;
  v_pet_name TEXT;
  v_doc_user_id UUID;
  v_svc public.clinic_services;
  v_duration_mins NUMERIC;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  IF NOT app.is_org_active(p_organization_id) THEN
    RAISE EXCEPTION 'Organization unavailable' USING ERRCODE = '42501';
  END IF;

  IF p_requested_start IS NULL OR p_requested_end IS NULL OR p_requested_end <= p_requested_start THEN
    RAISE EXCEPTION 'Appointment end time must be after start time' USING ERRCODE = '22023';
  END IF;

  v_duration_mins := EXTRACT(EPOCH FROM (p_requested_end - p_requested_start)) / 60.0;
  IF v_duration_mins < 5 OR v_duration_mins > 480 THEN
    RAISE EXCEPTION 'Appointment duration must be between 5 and 480 minutes' USING ERRCODE = '22023';
  END IF;

  IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Clinical reason is required' USING ERRCODE = '22023';
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

  SELECT name INTO v_pet_name
  FROM public.pets
  WHERE id = p_pet_id AND organization_id = p_organization_id AND archived_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pet not found or archived in organization' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.branches b
    WHERE b.id = p_branch_id AND b.organization_id = p_organization_id AND b.is_active = true
  ) THEN
    RAISE EXCEPTION 'Invalid or inactive branch' USING ERRCODE = '22023';
  END IF;

  SELECT dp.user_id INTO v_doc_user_id
  FROM public.doctor_profiles dp
  JOIN public.doctor_branch_assignments dba
    ON dba.doctor_profile_id = dp.id
   AND dba.organization_id = dp.organization_id
  WHERE dp.id = p_doctor_profile_id
    AND dp.organization_id = p_organization_id
    AND dp.is_active = true
    AND dba.branch_id = p_branch_id
    AND dba.is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Doctor is not active or not assigned to target branch' USING ERRCODE = '22023';
  END IF;

  IF p_service_id IS NOT NULL THEN
    SELECT * INTO v_svc
    FROM public.clinic_services cs
    WHERE cs.id = p_service_id
      AND cs.organization_id = p_organization_id
      AND cs.is_active = true
      AND (cs.branch_id IS NULL OR cs.branch_id = p_branch_id);

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Selected service is invalid, inactive, or unavailable at this branch' USING ERRCODE = '22023';
    END IF;

    IF round(v_duration_mins) <> v_svc.duration_minutes THEN
      RAISE EXCEPTION 'Requested duration (% mins) must match service duration (% mins)',
        round(v_duration_mins), v_svc.duration_minutes USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Pending requests leave scheduled_range NULL so they never reserve slots before confirmation
  INSERT INTO public.appointments (
    organization_id, branch_id, clinic_client_id, pet_id, doctor_profile_id, service_id,
    requested_start, requested_end, scheduled_range, status, reason, created_by
  )
  VALUES (
    p_organization_id, p_branch_id, v_cc_id, p_pet_id, p_doctor_profile_id, p_service_id,
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

  SELECT slug INTO v_org_slug FROM public.organizations WHERE id = p_organization_id;

  PERFORM app.notify_branch_appointment_staff(
    p_organization_id,
    p_branch_id,
    'New Appointment Request',
    'Appointment requested for ' || COALESCE(v_pet_name, 'Pet') || '. Clinic confirmation required.',
    'appointment'::public.notification_type_enum,
    CASE WHEN v_org_slug IS NOT NULL THEN '/' || v_org_slug || '/admin/consultations' ELSE NULL END,
    v_uid
  );

  IF v_doc_user_id IS NOT NULL AND v_doc_user_id <> v_uid THEN
    PERFORM app.enqueue_notification(
      p_organization_id,
      v_doc_user_id,
      'New Appointment Request',
      'Client requested an appointment for ' || COALESCE(v_pet_name, 'Pet') || ' pending clinic confirmation.',
      'appointment'::public.notification_type_enum,
      CASE WHEN v_org_slug IS NOT NULL THEN '/' || v_org_slug || '/doctor/requests' ELSE NULL END
    );
  END IF;

  RETURN v_appt_id;
END;
$$;
REVOKE ALL ON FUNCTION public.request_appointment(UUID, UUID, UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_appointment(UUID, UUID, UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID) TO authenticated;

DROP FUNCTION IF EXISTS public.confirm_appointment(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID);
CREATE OR REPLACE FUNCTION public.confirm_appointment(
  p_appointment_id UUID,
  p_confirmed_start TIMESTAMPTZ DEFAULT NULL,
  p_confirmed_end TIMESTAMPTZ DEFAULT NULL,
  p_doctor_profile_id UUID DEFAULT NULL,
  p_service_id UUID DEFAULT NULL
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
  v_svc_id UUID;
  v_svc public.clinic_services;
  v_branch_tz TEXT;
  v_local_start TIMESTAMP;
  v_local_end TIMESTAMP;
  v_iso_dow SMALLINT;
  v_duration_mins NUMERIC;
  v_org_slug TEXT;
  v_pet_name TEXT;
  v_doc_user_id UUID;
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
  v_svc_id := COALESCE(p_service_id, v_appt.service_id);

  IF v_end <= v_start THEN
    RAISE EXCEPTION 'Confirmed end must be after start' USING ERRCODE = '22023';
  END IF;

  v_duration_mins := EXTRACT(EPOCH FROM (v_end - v_start)) / 60.0;
  IF v_duration_mins < 5 OR v_duration_mins > 480 THEN
    RAISE EXCEPTION 'Appointment duration must be between 5 and 480 minutes' USING ERRCODE = '22023';
  END IF;

  -- Lock target doctor profile row to serialize concurrent confirmations cleanly across branches
  PERFORM 1 FROM public.doctor_profiles WHERE id = v_doc_id AND organization_id = v_appt.organization_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assigned doctor does not belong to organization' USING ERRCODE = '22023';
  END IF;

  -- Revalidate client approved & pet active
  SELECT p.name INTO v_pet_name
  FROM public.clinic_clients cc
  JOIN public.pet_guardians pg ON pg.clinic_client_id = cc.id AND pg.organization_id = cc.organization_id
  JOIN public.pets p ON p.id = pg.pet_id AND p.organization_id = pg.organization_id
  WHERE cc.id = v_appt.clinic_client_id
    AND cc.organization_id = v_appt.organization_id
    AND cc.status = 'approved'
    AND p.id = v_appt.pet_id
    AND p.archived_at IS NULL
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client approval or pet guardianship invalid' USING ERRCODE = '22023';
  END IF;

  -- Revalidate branch active
  SELECT b.timezone INTO v_branch_tz
  FROM public.branches b
  WHERE b.id = v_appt.branch_id AND b.organization_id = v_appt.organization_id AND b.is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Branch is inactive' USING ERRCODE = '22023';
  END IF;

  -- Revalidate doctor active & assigned to branch
  SELECT dp.user_id INTO v_doc_user_id
  FROM public.doctor_profiles dp
  JOIN public.doctor_branch_assignments dba
    ON dba.doctor_profile_id = dp.id AND dba.organization_id = dp.organization_id
  WHERE dp.id = v_doc_id
    AND dp.organization_id = v_appt.organization_id
    AND dp.is_active = true
    AND dba.branch_id = v_appt.branch_id
    AND dba.is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assigned doctor is inactive or detached from branch' USING ERRCODE = '22023';
  END IF;

  -- Revalidate service if linked
  IF v_svc_id IS NOT NULL THEN
    SELECT * INTO v_svc
    FROM public.clinic_services cs
    WHERE cs.id = v_svc_id
      AND cs.organization_id = v_appt.organization_id
      AND cs.is_active = true
      AND (cs.branch_id IS NULL OR cs.branch_id = v_appt.branch_id);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Linked clinic service is invalid, inactive, or unavailable at this branch' USING ERRCODE = '22023';
    END IF;
    IF round(v_duration_mins) <> v_svc.duration_minutes THEN
      RAISE EXCEPTION 'Confirmed duration (% mins) must match service duration (% mins)',
        round(v_duration_mins), v_svc.duration_minutes USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Revalidate against doctor branch schedule
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

  -- Transactional cross-branch conflict check (backed by GiST no_double_booking SQLSTATE 23P01)
  IF EXISTS (
    SELECT 1 FROM public.appointments a
    WHERE a.id <> p_appointment_id
      AND a.doctor_profile_id = v_doc_id
      AND a.status IN ('confirmed', 'checked_in')
      AND a.scheduled_range && tstzrange(v_start, v_end, '[)')
  ) THEN
    RAISE EXCEPTION 'Doctor already has an overlapping confirmed appointment across branches' USING ERRCODE = '23P01';
  END IF;

  UPDATE public.appointments
  SET status = 'confirmed',
      doctor_profile_id = v_doc_id,
      service_id = v_svc_id,
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

  SELECT slug INTO v_org_slug FROM public.organizations WHERE id = v_appt.organization_id;

  PERFORM app.notify_pet_guardians(
    v_appt.organization_id,
    v_appt.pet_id,
    'Appointment Confirmed',
    'Your appointment for ' || COALESCE(v_pet_name, 'your pet') || ' is confirmed for ' || to_char(v_start AT TIME ZONE v_branch_tz, 'Mon DD HH24:MI') || ' (' || v_branch_tz || ').',
    'appointment'::public.notification_type_enum,
    CASE WHEN v_org_slug IS NOT NULL THEN '/' || v_org_slug || '/client/consultations' ELSE NULL END
  );

  IF v_doc_user_id IS NOT NULL AND v_doc_user_id <> v_uid THEN
    PERFORM app.enqueue_notification(
      v_appt.organization_id,
      v_doc_user_id,
      'Appointment Confirmed',
      'Confirmed slot for ' || COALESCE(v_pet_name, 'Pet') || ' at ' || to_char(v_start AT TIME ZONE v_branch_tz, 'Mon DD HH24:MI') || '.',
      'appointment'::public.notification_type_enum,
      CASE WHEN v_org_slug IS NOT NULL THEN '/' || v_org_slug || '/doctor/requests' ELSE NULL END
    );
  END IF;

  RETURN v_appt;
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_appointment(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_appointment(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID) TO authenticated;

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
  v_duration_mins NUMERIC;
  v_svc public.clinic_services;
  v_org_slug TEXT;
  v_pet_name TEXT;
  v_doc_user_id UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  IF p_new_end <= p_new_start THEN RAISE EXCEPTION 'End time must be after start time' USING ERRCODE = '22023'; END IF;

  v_duration_mins := EXTRACT(EPOCH FROM (p_new_end - p_new_start)) / 60.0;
  IF v_duration_mins < 5 OR v_duration_mins > 480 THEN
    RAISE EXCEPTION 'Appointment duration must be between 5 and 480 minutes' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_appt FROM public.appointments WHERE id = p_appointment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Appointment not found' USING ERRCODE = 'P0002'; END IF;

  IF NOT app.has_branch_access(v_appt.organization_id, v_appt.branch_id, 'appointments.confirm') THEN
    RAISE EXCEPTION 'Forbidden: Missing appointments.confirm permission' USING ERRCODE = '42501';
  END IF;

  IF v_appt.status <> 'confirmed' THEN
    RAISE EXCEPTION 'Only confirmed appointments can be rescheduled' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.doctor_profiles WHERE id = v_appt.doctor_profile_id AND organization_id = v_appt.organization_id FOR UPDATE;

  SELECT b.timezone INTO v_branch_tz
  FROM public.branches b
  WHERE b.id = v_appt.branch_id AND b.organization_id = v_appt.organization_id AND b.is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Branch is inactive' USING ERRCODE = '22023'; END IF;

  IF v_appt.service_id IS NOT NULL THEN
    SELECT * INTO v_svc
    FROM public.clinic_services cs
    WHERE cs.id = v_appt.service_id AND cs.organization_id = v_appt.organization_id;
    IF FOUND AND round(v_duration_mins) <> v_svc.duration_minutes THEN
      RAISE EXCEPTION 'Rescheduled duration (% mins) must match service duration (% mins)',
        round(v_duration_mins), v_svc.duration_minutes USING ERRCODE = '22023';
    END IF;
  END IF;

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

  IF EXISTS (
    SELECT 1 FROM public.appointments a
    WHERE a.id <> p_appointment_id
      AND a.doctor_profile_id = v_appt.doctor_profile_id
      AND a.status IN ('confirmed', 'checked_in')
      AND a.scheduled_range && tstzrange(p_new_start, p_new_end, '[)')
  ) THEN
    RAISE EXCEPTION 'Doctor already has an overlapping confirmed appointment across branches' USING ERRCODE = '23P01';
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

  SELECT slug INTO v_org_slug FROM public.organizations WHERE id = v_appt.organization_id;
  SELECT name INTO v_pet_name FROM public.pets WHERE id = v_appt.pet_id;
  SELECT user_id INTO v_doc_user_id FROM public.doctor_profiles WHERE id = v_appt.doctor_profile_id;

  PERFORM app.notify_pet_guardians(
    v_appt.organization_id,
    v_appt.pet_id,
    'Appointment Rescheduled',
    'Your appointment for ' || COALESCE(v_pet_name, 'your pet') || ' was rescheduled to ' || to_char(p_new_start AT TIME ZONE v_branch_tz, 'Mon DD HH24:MI') || ' (' || v_branch_tz || ').',
    'appointment'::public.notification_type_enum,
    CASE WHEN v_org_slug IS NOT NULL THEN '/' || v_org_slug || '/client/consultations' ELSE NULL END
  );

  IF v_doc_user_id IS NOT NULL AND v_doc_user_id <> v_uid THEN
    PERFORM app.enqueue_notification(
      v_appt.organization_id,
      v_doc_user_id,
      'Appointment Rescheduled',
      'Rescheduled appointment for ' || COALESCE(v_pet_name, 'Pet') || ' to ' || to_char(p_new_start AT TIME ZONE v_branch_tz, 'Mon DD HH24:MI') || '.',
      'appointment'::public.notification_type_enum,
      CASE WHEN v_org_slug IS NOT NULL THEN '/' || v_org_slug || '/doctor/requests' ELSE NULL END
    );
  END IF;

  RETURN v_appt;
END;
$$;
REVOKE ALL ON FUNCTION public.reschedule_appointment(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reschedule_appointment(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

CREATE OR REPLACE FUNCTION public.decline_appointment(p_appointment_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_appt public.appointments;
  v_org_slug TEXT;
  v_pet_name TEXT;
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

  SELECT slug INTO v_org_slug FROM public.organizations WHERE id = v_appt.organization_id;
  SELECT name INTO v_pet_name FROM public.pets WHERE id = v_appt.pet_id;

  PERFORM app.notify_pet_guardians(
    v_appt.organization_id,
    v_appt.pet_id,
    'Appointment Request Declined',
    'Your appointment request for ' || COALESCE(v_pet_name, 'your pet') || ' was declined: ' || trim(p_reason),
    'appointment'::public.notification_type_enum,
    CASE WHEN v_org_slug IS NOT NULL THEN '/' || v_org_slug || '/client/consultations' ELSE NULL END
  );
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
  v_is_staff BOOLEAN := false;
  v_org_slug TEXT;
  v_pet_name TEXT;
  v_doc_user_id UUID;
  v_clean_reason TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v_appt FROM public.appointments WHERE id = p_appointment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Appointment not found' USING ERRCODE = 'P0002'; END IF;

  v_is_staff := app.has_branch_access(v_appt.organization_id, v_appt.branch_id, 'appointments.confirm');

  IF NOT (v_is_staff OR app.is_pet_guardian(v_appt.organization_id, v_appt.pet_id)) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_appt.status NOT IN ('requested', 'confirmed') THEN
    RAISE EXCEPTION 'Cannot cancel appointment in status %', v_appt.status USING ERRCODE = '22023';
  END IF;

  v_clean_reason := COALESCE(NULLIF(trim(p_reason), ''), 'Cancelled');

  UPDATE public.appointments
  SET status = 'cancelled',
      cancellation_reason = NULLIF(trim(p_reason), '')
  WHERE id = p_appointment_id;

  INSERT INTO public.appointment_status_history (organization_id, appointment_id, from_status, to_status, changed_by, reason)
  VALUES (v_appt.organization_id, p_appointment_id, v_appt.status, 'cancelled', v_uid, v_clean_reason);

  PERFORM app.write_audit_log(
    v_appt.organization_id, v_uid, 'CANCEL_APPOINTMENT', 'appointment', p_appointment_id::TEXT, v_clean_reason
  );

  SELECT slug INTO v_org_slug FROM public.organizations WHERE id = v_appt.organization_id;
  SELECT name INTO v_pet_name FROM public.pets WHERE id = v_appt.pet_id;
  SELECT user_id INTO v_doc_user_id FROM public.doctor_profiles WHERE id = v_appt.doctor_profile_id;

  IF v_is_staff THEN
    PERFORM app.notify_pet_guardians(
      v_appt.organization_id,
      v_appt.pet_id,
      'Appointment Cancelled',
      'Your appointment for ' || COALESCE(v_pet_name, 'your pet') || ' was cancelled by the clinic (' || v_clean_reason || ').',
      'appointment'::public.notification_type_enum,
      CASE WHEN v_org_slug IS NOT NULL THEN '/' || v_org_slug || '/client/consultations' ELSE NULL END
    );
  ELSE
    PERFORM app.notify_branch_appointment_staff(
      v_appt.organization_id,
      v_appt.branch_id,
      'Appointment Cancelled by Client',
      'Client cancelled appointment for ' || COALESCE(v_pet_name, 'Pet') || ' (' || v_clean_reason || ').',
      'appointment'::public.notification_type_enum,
      CASE WHEN v_org_slug IS NOT NULL THEN '/' || v_org_slug || '/admin/consultations' ELSE NULL END,
      v_uid
    );
  END IF;

  IF v_doc_user_id IS NOT NULL AND v_doc_user_id <> v_uid THEN
    PERFORM app.enqueue_notification(
      v_appt.organization_id,
      v_doc_user_id,
      'Appointment Cancelled',
      'Appointment for ' || COALESCE(v_pet_name, 'Pet') || ' was cancelled (' || v_clean_reason || ').',
      'appointment'::public.notification_type_enum,
      CASE WHEN v_org_slug IS NOT NULL THEN '/' || v_org_slug || '/doctor/requests' ELSE NULL END
    );
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_appointment(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_appointment(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.check_in_appointment(p_appointment_id UUID)
RETURNS public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_appt public.appointments;
  v_org_slug TEXT;
  v_pet_name TEXT;
  v_doc_user_id UUID;
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

  SELECT slug INTO v_org_slug FROM public.organizations WHERE id = v_appt.organization_id;
  SELECT name INTO v_pet_name FROM public.pets WHERE id = v_appt.pet_id;
  SELECT user_id INTO v_doc_user_id FROM public.doctor_profiles WHERE id = v_appt.doctor_profile_id;

  IF v_doc_user_id IS NOT NULL AND v_doc_user_id <> v_uid THEN
    PERFORM app.enqueue_notification(
      v_appt.organization_id,
      v_doc_user_id,
      'Patient Checked In',
      COALESCE(v_pet_name, 'Patient') || ' has checked in at the clinic branch.',
      'appointment'::public.notification_type_enum,
      CASE WHEN v_org_slug IS NOT NULL THEN '/' || v_org_slug || '/doctor/requests' ELSE NULL END
    );
  END IF;

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
  v_org_slug TEXT;
  v_pet_name TEXT;
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

  SELECT slug INTO v_org_slug FROM public.organizations WHERE id = v_appt.organization_id;
  SELECT name INTO v_pet_name FROM public.pets WHERE id = v_appt.pet_id;

  PERFORM app.notify_pet_guardians(
    v_appt.organization_id,
    v_appt.pet_id,
    'Visit Completed',
    'The clinic appointment for ' || COALESCE(v_pet_name, 'your pet') || ' has been marked completed.',
    'appointment'::public.notification_type_enum,
    CASE WHEN v_org_slug IS NOT NULL THEN '/' || v_org_slug || '/client/consultations' ELSE NULL END
  );

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
  v_org_slug TEXT;
  v_pet_name TEXT;
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

  SELECT slug INTO v_org_slug FROM public.organizations WHERE id = v_appt.organization_id;
  SELECT name INTO v_pet_name FROM public.pets WHERE id = v_appt.pet_id;

  PERFORM app.notify_pet_guardians(
    v_appt.organization_id,
    v_appt.pet_id,
    'Missed Appointment (No-Show)',
    'The confirmed appointment for ' || COALESCE(v_pet_name, 'your pet') || ' was recorded as a no-show.',
    'appointment'::public.notification_type_enum,
    CASE WHEN v_org_slug IS NOT NULL THEN '/' || v_org_slug || '/client/consultations' ELSE NULL END
  );

  RETURN v_appt;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_no_show(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_no_show(UUID) TO authenticated;

-- ------------------------------------------------------------------------------
-- SECTION 4: CONSULTATION ACTIVATION, 7-DAY EXPIRY & CHAT MESSAGING
-- ------------------------------------------------------------------------------

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
  v_org_slug TEXT;
  v_pet_name TEXT;
  v_doc_user_id UUID;
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

  IF v_consultation.appointment_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.appointments a
    WHERE a.id = v_consultation.appointment_id
      AND a.organization_id = v_consultation.organization_id
      AND a.status IN ('confirmed', 'checked_in', 'completed')
  ) THEN
    RAISE EXCEPTION 'Invalid State: A confirmed or completed appointment is mandatory before consultation activation'
      USING ERRCODE = '22023';
  END IF;

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

  SELECT slug INTO v_org_slug FROM public.organizations WHERE id = v_consultation.organization_id;
  SELECT name INTO v_pet_name FROM public.pets WHERE id = v_consultation.pet_id;
  SELECT user_id INTO v_doc_user_id FROM public.doctor_profiles WHERE id = v_consultation.doctor_id;

  PERFORM app.notify_pet_guardians(
    v_consultation.organization_id,
    v_consultation.pet_id,
    '7-Day Consultation Activated',
    'Your consultation chat for ' || COALESCE(v_pet_name, 'your pet') || ' is now active for 7 days until ' || to_char(v_expires_at, 'Mon DD HH24:MI UTC') || '.',
    'consultation'::public.notification_type_enum,
    CASE WHEN v_org_slug IS NOT NULL THEN '/' || v_org_slug || '/client/chat/' || v_consultation.id::TEXT ELSE NULL END
  );

  IF v_doc_user_id IS NOT NULL AND v_doc_user_id <> v_caller_id THEN
    PERFORM app.enqueue_notification(
      v_consultation.organization_id,
      v_doc_user_id,
      'Consultation Activated',
      'A 7-day consultation for ' || COALESCE(v_pet_name, 'Pet') || ' was activated and your participant chat is open.',
      'consultation'::public.notification_type_enum,
      CASE WHEN v_org_slug IS NOT NULL THEN '/' || v_org_slug || '/doctor/chat/' || v_consultation.id::TEXT ELSE NULL END
    );
  END IF;

  RETURN v_consultation;
END;
$$;
REVOKE ALL ON FUNCTION public.activate_consultation(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activate_consultation(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_consultation(p_consultation_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_cons public.consultations;
  v_org_slug TEXT;
  v_pet_name TEXT;
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

  SELECT slug INTO v_org_slug FROM public.organizations WHERE id = v_cons.organization_id;
  SELECT name INTO v_pet_name FROM public.pets WHERE id = v_cons.pet_id;

  PERFORM app.notify_pet_guardians(
    v_cons.organization_id,
    v_cons.pet_id,
    'Consultation Completed',
    'The clinical consultation for ' || COALESCE(v_pet_name, 'your pet') || ' is completed. Chat history remains read-only for participants.',
    'consultation'::public.notification_type_enum,
    CASE WHEN v_org_slug IS NOT NULL THEN '/' || v_org_slug || '/client/consultations' ELSE NULL END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.complete_consultation(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_consultation(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_consultation(p_consultation_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_cons public.consultations;
  v_org_slug TEXT;
  v_pet_name TEXT;
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

  SELECT slug INTO v_org_slug FROM public.organizations WHERE id = v_cons.organization_id;
  SELECT name INTO v_pet_name FROM public.pets WHERE id = v_cons.pet_id;

  PERFORM app.notify_pet_guardians(
    v_cons.organization_id,
    v_cons.pet_id,
    'Consultation Declined',
    'Consultation request for ' || COALESCE(v_pet_name, 'your pet') || ' was declined: ' || trim(p_reason),
    'consultation'::public.notification_type_enum,
    CASE WHEN v_org_slug IS NOT NULL THEN '/' || v_org_slug || '/client/consultations' ELSE NULL END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.reject_consultation(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_consultation(UUID, TEXT) TO authenticated;

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
  v_new_doc_user_id UUID;
  v_org_slug TEXT;
  v_pet_name TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v_cons FROM public.consultations WHERE id = p_consultation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Consultation not found' USING ERRCODE = 'P0002'; END IF;

  IF NOT (app.has_org_permission(v_cons.organization_id, 'staff.manage') AND app.has_org_permission(v_cons.organization_id, 'consultations.manage')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT dp.user_id INTO v_new_doc_user_id
  FROM public.doctor_profiles dp
  WHERE dp.id = p_new_doctor_profile_id AND dp.organization_id = v_cons.organization_id AND dp.is_active = true;
  IF NOT FOUND THEN
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

  SELECT slug INTO v_org_slug FROM public.organizations WHERE id = v_cons.organization_id;
  SELECT name INTO v_pet_name FROM public.pets WHERE id = v_cons.pet_id;

  IF v_new_doc_user_id IS NOT NULL THEN
    PERFORM app.enqueue_notification(
      v_cons.organization_id,
      v_new_doc_user_id,
      'Consultation Assigned to You',
      'Consultation for ' || COALESCE(v_pet_name, 'Pet') || ' has been reassigned to you.',
      'consultation'::public.notification_type_enum,
      CASE WHEN v_org_slug IS NOT NULL THEN '/' || v_org_slug || '/doctor/chat/' || v_cons.id::TEXT ELSE NULL END
    );
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.reassign_consultation(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reassign_consultation(UUID, UUID, TEXT) TO authenticated;

-- Trusted DB-side expiry transition: transitions active consultations past expires_at
-- to 'expired', audits the transition, and notifies participants.
CREATE OR REPLACE FUNCTION public.expire_due_consultations(
  p_organization_id UUID DEFAULT NULL,
  p_consultation_id UUID DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_row RECORD;
  v_expired_count INT := 0;
  v_org_slug TEXT;
  v_pet_name TEXT;
  v_doc_user_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000';
  END IF;

  IF p_organization_id IS NOT NULL THEN
    IF NOT (
      app.is_org_member(p_organization_id)
      OR app.current_clinic_client_id(p_organization_id) IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  ELSIF p_consultation_id IS NOT NULL THEN
    IF NOT app.is_consultation_participant(p_consultation_id) THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'Organization ID or Consultation ID required' USING ERRCODE = '22023';
  END IF;

  FOR v_row IN
    SELECT c.*
    FROM public.consultations c
    WHERE c.consultation_status = 'active'
      AND c.expires_at IS NOT NULL
      AND timezone('utc'::text, now()) >= c.expires_at
      AND (p_organization_id IS NULL OR c.organization_id = p_organization_id)
      AND (p_consultation_id IS NULL OR c.id = p_consultation_id)
    FOR UPDATE
  LOOP
    UPDATE public.consultations
    SET consultation_status = 'expired',
        updated_at = timezone('utc'::text, now())
    WHERE id = v_row.id;

    PERFORM app.write_audit_log(
      v_row.organization_id,
      v_uid,
      'EXPIRE_CONSULTATION',
      'consultation',
      v_row.id::TEXT,
      '7-day consultation window expired cleanly at ' || v_row.expires_at::TEXT,
      jsonb_build_object('consultation_status', 'active', 'expires_at', v_row.expires_at),
      jsonb_build_object('consultation_status', 'expired')
    );

    SELECT slug INTO v_org_slug FROM public.organizations WHERE id = v_row.organization_id;
    SELECT name INTO v_pet_name FROM public.pets WHERE id = v_row.pet_id;
    SELECT user_id INTO v_doc_user_id FROM public.doctor_profiles WHERE id = v_row.doctor_id;

    PERFORM app.notify_pet_guardians(
      v_row.organization_id,
      v_row.pet_id,
      'Consultation Chat Window Expired',
      'The 7-day active consultation window for ' || COALESCE(v_pet_name, 'your pet') || ' has ended. Message history remains read-only.',
      'consultation'::public.notification_type_enum,
      CASE WHEN v_org_slug IS NOT NULL THEN '/' || v_org_slug || '/client/chat/' || v_row.id::TEXT ELSE NULL END
    );

    IF v_doc_user_id IS NOT NULL THEN
      PERFORM app.enqueue_notification(
        v_row.organization_id,
        v_doc_user_id,
        'Consultation Window Expired',
        'The 7-day chat window for ' || COALESCE(v_pet_name, 'Pet') || ' has expired and switched to read-only.',
        'consultation'::public.notification_type_enum,
        CASE WHEN v_org_slug IS NOT NULL THEN '/' || v_org_slug || '/doctor/chat/' || v_row.id::TEXT ELSE NULL END
      );
    END IF;

    v_expired_count := v_expired_count + 1;
  END LOOP;

  RETURN v_expired_count;
END;
$$;
REVOKE ALL ON FUNCTION public.expire_due_consultations(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expire_due_consultations(UUID, UUID) TO authenticated;

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
  v_org_slug TEXT;
  v_pet_name TEXT;
  v_sender_name TEXT;
  v_doc_user_id UUID;
  v_recipient_user_id UUID;
  v_link_url TEXT;
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
        WHERE a.id = v_att_id
          AND a.organization_id = v_cons.organization_id
          AND a.entity_type IN ('chat_message', 'consultation')
          AND a.entity_id = v_cons.id
      ) THEN
        RAISE EXCEPTION 'Attachment % is unauthorized for this consultation', v_att_id USING ERRCODE = '42501';
      END IF;
      INSERT INTO public.message_attachments (message_id, attachment_id, organization_id)
      VALUES (v_msg.id, v_att_id, v_cons.organization_id);
    END LOOP;
  END IF;

  -- Notify the counterparty participant (client <-> treating doctor)
  SELECT slug INTO v_org_slug FROM public.organizations WHERE id = v_cons.organization_id;
  SELECT name INTO v_pet_name FROM public.pets WHERE id = v_cons.pet_id;
  SELECT full_name INTO v_sender_name FROM public.profiles WHERE id = v_uid;
  SELECT user_id INTO v_doc_user_id FROM public.doctor_profiles WHERE id = v_cons.doctor_id;

  IF v_doc_user_id IS NOT NULL AND v_uid = v_doc_user_id THEN
    -- Doctor sent message -> notify client
    SELECT COALESCE(cc.user_id, v_cons.client_id) INTO v_recipient_user_id
    FROM public.clinic_clients cc
    WHERE cc.id = v_cons.clinic_client_id;
    v_recipient_user_id := COALESCE(v_recipient_user_id, v_cons.client_id);
    v_link_url := CASE WHEN v_org_slug IS NOT NULL THEN '/' || v_org_slug || '/client/chat/' || v_cons.id::TEXT ELSE NULL END;
  ELSE
    -- Client sent message -> notify treating doctor
    v_recipient_user_id := v_doc_user_id;
    v_link_url := CASE WHEN v_org_slug IS NOT NULL THEN '/' || v_org_slug || '/doctor/chat/' || v_cons.id::TEXT ELSE NULL END;
  END IF;

  IF v_recipient_user_id IS NOT NULL AND v_recipient_user_id <> v_uid THEN
    PERFORM app.enqueue_notification(
      v_cons.organization_id,
      v_recipient_user_id,
      'New Consultation Message',
      COALESCE(v_sender_name, 'Participant') || ' sent a message regarding ' || COALESCE(v_pet_name, 'consultation') || '.',
      'message'::public.notification_type_enum,
      v_link_url
    );
  END IF;

  RETURN v_msg;
END;
$$;
REVOKE ALL ON FUNCTION public.send_chat_message(UUID, public.message_type_enum, TEXT, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_chat_message(UUID, public.message_type_enum, TEXT, UUID[]) TO authenticated;

-- ------------------------------------------------------------------------------
-- SECTION 5: ATTACHMENT & PET URL HARDENING
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
  v_cons public.consultations;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  IF NOT app.is_org_active(p_organization_id) THEN
    RAISE EXCEPTION 'Organization unavailable' USING ERRCODE = '42501';
  END IF;

  IF p_object_path IS NULL
     OR p_object_path ~* '^blob:'
     OR p_object_path ~* '^data:'
     OR position('..' IN p_object_path) > 0
     OR p_object_path NOT LIKE (p_organization_id::TEXT || '/%') THEN
    RAISE EXCEPTION 'Invalid object path prefix for organization' USING ERRCODE = '42501';
  END IF;

  IF p_entity_type IN ('consultation', 'chat_message') THEN
    SELECT * INTO v_cons
    FROM public.consultations
    WHERE id = p_entity_id
      AND organization_id = p_organization_id;

    IF NOT FOUND OR NOT app.is_consultation_participant(p_entity_id) THEN
      RAISE EXCEPTION 'Forbidden: Only consultation participants in this organization may attach consultation files' USING ERRCODE = '42501';
    END IF;

    IF p_entity_type = 'chat_message' AND (
      v_cons.consultation_status <> 'active'
      OR v_cons.expires_at IS NULL
      OR timezone('utc'::text, now()) >= v_cons.expires_at
    ) THEN
      RAISE EXCEPTION 'Cannot upload chat attachments after the 7-day window has expired' USING ERRCODE = '22023';
    END IF;
  ELSIF p_entity_type = 'pet' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.pets p
      WHERE p.id = p_entity_id AND p.organization_id = p_organization_id AND p.archived_at IS NULL
    ) OR NOT (
      app.has_org_permission(p_organization_id, 'pets.write')
      OR app.is_pet_guardian(p_organization_id, p_entity_id)
    ) THEN
      RAISE EXCEPTION 'Forbidden: Cannot attach file to pet' USING ERRCODE = '42501';
    END IF;
  ELSIF p_entity_type = 'medical_record' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.medical_records mr
      WHERE mr.id = p_entity_id AND mr.organization_id = p_organization_id
    ) OR NOT app.has_org_permission(p_organization_id, 'medical_records.write') THEN
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

CREATE OR REPLACE FUNCTION public.update_pet(p_pet_id UUID, p_updates JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_pet public.pets;
  v_new_weight NUMERIC;
  v_new_dob DATE;
  v_avatar TEXT := NULLIF(trim(COALESCE(p_updates->>'avatar_url', '')), '');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v_pet FROM public.pets WHERE id = p_pet_id FOR UPDATE;
  IF NOT FOUND OR v_pet.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Pet not found or archived' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (
    app.is_pet_guardian(v_pet.organization_id, p_pet_id)
    OR app.has_org_permission(v_pet.organization_id, 'pets.write')
  ) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_avatar IS NOT NULL AND (v_avatar ~* '^blob:' OR v_avatar ~* '^data:') THEN
    RAISE EXCEPTION 'Ephemeral blob or data URLs cannot be stored as pet avatars' USING ERRCODE = '22023';
  END IF;

  IF p_updates ? 'weight' AND NULLIF(trim(COALESCE(p_updates->>'weight', '')), '') IS NOT NULL THEN
    v_new_weight := (p_updates->>'weight')::NUMERIC;
    IF v_new_weight <= 0 THEN
      RAISE EXCEPTION 'Pet weight must be positive' USING ERRCODE = '22023';
    END IF;
  ELSE
    v_new_weight := v_pet.weight;
  END IF;

  IF p_updates ? 'date_of_birth' THEN
    v_new_dob := NULLIF(trim(COALESCE(p_updates->>'date_of_birth', '')), '')::DATE;
  ELSE
    v_new_dob := v_pet.date_of_birth;
  END IF;

  UPDATE public.pets
  SET name = COALESCE(NULLIF(trim(p_updates->>'name'), ''), name),
      species = COALESCE(NULLIF(trim(p_updates->>'species'), ''), species),
      breed = COALESCE(NULLIF(trim(p_updates->>'breed'), ''), breed),
      gender = COALESCE(NULLIF(trim(p_updates->>'gender'), ''), gender),
      date_of_birth = v_new_dob,
      weight = v_new_weight,
      color = CASE WHEN p_updates ? 'color' THEN NULLIF(trim(COALESCE(p_updates->>'color', '')), '') ELSE color END,
      avatar_url = CASE WHEN p_updates ? 'avatar_url' THEN v_avatar ELSE avatar_url END,
      allergies = CASE WHEN p_updates ? 'allergies' THEN NULLIF(trim(COALESCE(p_updates->>'allergies', '')), '') ELSE allergies END,
      medical_notes = CASE WHEN p_updates ? 'medical_notes' THEN NULLIF(trim(COALESCE(p_updates->>'medical_notes', '')), '') ELSE medical_notes END,
      updated_at = timezone('utc'::text, now())
  WHERE id = p_pet_id;

  PERFORM app.write_audit_log(
    v_pet.organization_id, v_uid, 'UPDATE_PET', 'pet', p_pet_id::TEXT,
    'Updated pet profile', to_jsonb(v_pet), p_updates
  );
END;
$$;
REVOKE ALL ON FUNCTION public.update_pet(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_pet(UUID, JSONB) TO authenticated;

-- ------------------------------------------------------------------------------
-- SECTION 6: CLINICAL RECORDS, PRESCRIPTIONS & VACCINATIONS WITH NOTIFICATIONS
-- ------------------------------------------------------------------------------

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
  v_pet_name TEXT;
  v_org_slug TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  IF NOT app.has_org_permission(p_organization_id, 'medical_records.write') THEN
    RAISE EXCEPTION 'Forbidden: Only authorized organization doctors may write medical records' USING ERRCODE = '42501';
  END IF;

  IF NULLIF(trim(COALESCE(p_diagnosis, '')), '') IS NULL OR NULLIF(trim(COALESCE(p_notes, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Diagnosis and clinical notes are required' USING ERRCODE = '22023';
  END IF;

  SELECT dp.id INTO v_doc_id
  FROM public.doctor_profiles dp
  WHERE dp.organization_id = p_organization_id AND dp.user_id = v_uid AND dp.is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Forbidden: Active doctor profile required' USING ERRCODE = '42501';
  END IF;

  SELECT p.name INTO v_pet_name
  FROM public.pets p
  WHERE p.id = p_pet_id AND p.organization_id = p_organization_id AND p.archived_at IS NULL;
  IF NOT FOUND THEN
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
    'Added medical record for pet ' || p_pet_id::TEXT,
    NULL,
    jsonb_build_object('pet_id', p_pet_id, 'record_type', COALESCE(p_record_type::TEXT, 'clinical_note'), 'diagnosis', trim(p_diagnosis))
  );

  SELECT slug INTO v_org_slug FROM public.organizations WHERE id = p_organization_id;
  PERFORM app.notify_pet_guardians(
    p_organization_id,
    p_pet_id,
    'Medical Record Added',
    'A new ' || replace(COALESCE(p_record_type::TEXT, 'clinical_note'), '_', ' ') || ' entry was recorded for ' || COALESCE(v_pet_name, 'your pet') || ': ' || trim(p_diagnosis),
    'system'::public.notification_type_enum,
    CASE WHEN v_org_slug IS NOT NULL THEN '/' || v_org_slug || '/client/medical-records' ELSE NULL END
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
  v_pet_name TEXT;
  v_org_slug TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  IF NULLIF(trim(COALESCE(p_diagnosis, '')), '') IS NULL OR NULLIF(trim(COALESCE(p_notes, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Amendment diagnosis and notes are required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_orig FROM public.medical_records WHERE id = p_original_record_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Medical record not found' USING ERRCODE = 'P0002'; END IF;

  IF NOT app.has_org_permission(v_orig.organization_id, 'medical_records.write') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT dp.id INTO v_doc_id
  FROM public.doctor_profiles dp
  WHERE dp.organization_id = v_orig.organization_id AND dp.user_id = v_uid AND dp.is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501'; END IF;

  -- Append-only amendment row; original clinical record remains completely untouched
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
    'Addendum to medical_record ' || v_orig.id::TEXT,
    jsonb_build_object('original_record_id', v_orig.id, 'original_diagnosis', v_orig.diagnosis),
    jsonb_build_object('amended_record_id', v_new_id, 'diagnosis', trim(p_diagnosis))
  );

  SELECT slug INTO v_org_slug FROM public.organizations WHERE id = v_orig.organization_id;
  SELECT name INTO v_pet_name FROM public.pets WHERE id = v_orig.pet_id;
  PERFORM app.notify_pet_guardians(
    v_orig.organization_id,
    v_orig.pet_id,
    'Clinical Record Addendum',
    'An amended clinical note was added for ' || COALESCE(v_pet_name, 'your pet') || ': ' || trim(p_diagnosis),
    'system'::public.notification_type_enum,
    CASE WHEN v_org_slug IS NOT NULL THEN '/' || v_org_slug || '/client/medical-records' ELSE NULL END
  );

  RETURN v_new_id;
END;
$$;
REVOKE ALL ON FUNCTION public.amend_medical_record(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.amend_medical_record(UUID, TEXT, TEXT) TO authenticated;

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
  v_pet_name TEXT;
  v_org_slug TEXT;
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

  IF NULLIF(trim(COALESCE(p_diagnosis, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Clinical diagnosis is required' USING ERRCODE = '22023';
  END IF;

  IF p_consultation_id IS NULL AND p_appointment_id IS NULL THEN
    RAISE EXCEPTION 'Prescription requires a consultation or appointment in this organization' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) < 1 THEN
    RAISE EXCEPTION 'At least one prescription item is required' USING ERRCODE = '22023';
  END IF;

  SELECT p.owner_id, p.name INTO v_legacy_client_id, v_pet_name
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
    IF NULLIF(trim(COALESCE(v_item->>'medicine_name', '')), '') IS NULL
       OR NULLIF(trim(COALESCE(v_item->>'dosage', '')), '') IS NULL
       OR NULLIF(trim(COALESCE(v_item->>'frequency', '')), '') IS NULL
       OR NULLIF(trim(COALESCE(v_item->>'duration', '')), '') IS NULL THEN
      RAISE EXCEPTION 'Every prescription item requires medicine_name, dosage, frequency, and duration' USING ERRCODE = '22023';
    END IF;

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
    'Issued prescription for pet ' || p_pet_id::TEXT,
    NULL,
    jsonb_build_object('pet_id', p_pet_id, 'diagnosis', trim(p_diagnosis), 'item_count', jsonb_array_length(p_items))
  );

  SELECT slug INTO v_org_slug FROM public.organizations WHERE id = p_organization_id;
  PERFORM app.notify_pet_guardians(
    p_organization_id,
    p_pet_id,
    'New Prescription Issued',
    'A prescription was issued for ' || COALESCE(v_pet_name, 'your pet') || ' (' || trim(p_diagnosis) || ').',
    'prescription'::public.notification_type_enum,
    CASE WHEN v_org_slug IS NOT NULL THEN '/' || v_org_slug || '/client/prescriptions' ELSE NULL END
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
  v_pet_name TEXT;
  v_org_slug TEXT;
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
    v_rx.organization_id, v_uid, 'VOID_PRESCRIPTION', 'prescription', p_prescription_id::TEXT, trim(p_reason),
    jsonb_build_object('status', 'issued'),
    jsonb_build_object('status', 'void', 'void_reason', trim(p_reason))
  );

  SELECT slug INTO v_org_slug FROM public.organizations WHERE id = v_rx.organization_id;
  SELECT name INTO v_pet_name FROM public.pets WHERE id = v_rx.pet_id;
  PERFORM app.notify_pet_guardians(
    v_rx.organization_id,
    v_rx.pet_id,
    'Prescription Voided',
    'A prescription for ' || COALESCE(v_pet_name, 'your pet') || ' was marked void: ' || trim(p_reason),
    'prescription'::public.notification_type_enum,
    CASE WHEN v_org_slug IS NOT NULL THEN '/' || v_org_slug || '/client/prescriptions' ELSE NULL END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.void_prescription(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_prescription(UUID, TEXT) TO authenticated;

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
  v_pet_name TEXT;
  v_org_slug TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  IF NOT app.has_org_permission(p_organization_id, 'medical_records.write') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF NULLIF(trim(COALESCE(p_vaccine_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Vaccine name is required' USING ERRCODE = '22023';
  END IF;
  IF p_next_due_date IS NOT NULL AND p_next_due_date < p_administered_date THEN
    RAISE EXCEPTION 'Next due date cannot precede administered date' USING ERRCODE = '22023';
  END IF;

  SELECT dp.id, COALESCE(dp.display_name, p.full_name)
  INTO v_doc_id, v_doc_name
  FROM public.doctor_profiles dp
  JOIN public.profiles p ON p.id = dp.user_id
  WHERE dp.organization_id = p_organization_id AND dp.user_id = v_uid AND dp.is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Forbidden: Active doctor profile required' USING ERRCODE = '42501'; END IF;

  SELECT pet.name INTO v_pet_name
  FROM public.pets pet
  WHERE pet.id = p_pet_id AND pet.organization_id = p_organization_id AND pet.archived_at IS NULL;
  IF NOT FOUND THEN
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

  SELECT slug INTO v_org_slug FROM public.organizations WHERE id = p_organization_id;
  PERFORM app.notify_pet_guardians(
    p_organization_id,
    p_pet_id,
    'Vaccination Recorded',
    trim(p_vaccine_name) || ' vaccination logged for ' || COALESCE(v_pet_name, 'your pet') || ' on ' || p_administered_date::TEXT || '.',
    'system'::public.notification_type_enum,
    CASE WHEN v_org_slug IS NOT NULL THEN '/' || v_org_slug || '/client/medical-records' ELSE NULL END
  );

  RETURN v_vax_id;
END;
$$;
REVOKE ALL ON FUNCTION public.record_vaccination(UUID, UUID, TEXT, DATE, DATE, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_vaccination(UUID, UUID, TEXT, DATE, DATE, TEXT, TEXT) TO authenticated;

-- ------------------------------------------------------------------------------
-- SECTION 7: REALTIME PUBLICATION ENROLLMENT (SAFE & IDEMPOTENT)
-- ------------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.appointments;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.consultations;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;
