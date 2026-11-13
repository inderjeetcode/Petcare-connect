-- ==============================================================================
-- PET CONNECT — PHASE 9: REPORTS, NOTIFICATIONS HARDENING & COMPOSITE INDEXES
-- ==============================================================================
-- Non-destructive additive migration:
-- 1. Restricts authenticated UPDATE privileges on public.notifications to ONLY
--    is_read (preserving notifications_update_own_read RLS policy).
-- 2. Adds 60-second deduplication guard inside app.enqueue_notification(...) to
--    prevent unintended duplicate notifications for the same event.
-- 3. Adds composite and partial PostgreSQL indexes for reporting, date filtering,
--    unread notification queries, and service aggregations.
-- 4. Adds read-only aggregate helper RPC public.get_org_service_summary(...)
--    guarded by tenant membership and appointments.read / audit.read permission.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. COLUMN-LEVEL NOTIFICATION UPDATE RESTRICTION (is_read ONLY)
-- ------------------------------------------------------------------------------
REVOKE UPDATE ON public.notifications FROM PUBLIC, anon, authenticated;
GRANT UPDATE (is_read) ON public.notifications TO authenticated;

-- ------------------------------------------------------------------------------
-- 2. IDEMPOTENT / DEDUPLICATED NOTIFICATION ENQUEUE HELPER
-- ------------------------------------------------------------------------------
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
DECLARE
  v_trimmed_title TEXT;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  v_trimmed_title := left(coalesce(p_title, ''), 150);

  -- Prevent unintended duplicate notifications emitted by concurrent/repeated events
  -- within a 60-second idempotency window.
  IF EXISTS (
    SELECT 1
    FROM public.notifications n
    WHERE n.user_id = p_user_id
      AND n.organization_id IS NOT DISTINCT FROM p_org_id
      AND n.notification_type = p_type
      AND n.title = v_trimmed_title
      AND n.message = coalesce(p_message, '')
      AND n.link_url IS NOT DISTINCT FROM p_link_url
      AND n.created_at >= timezone('utc'::text, now()) - interval '60 seconds'
  ) THEN
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
    v_trimmed_title,
    coalesce(p_message, ''),
    p_type,
    false,
    p_link_url,
    timezone('utc'::text, now())
  );
END;
$$;
REVOKE ALL ON FUNCTION app.enqueue_notification(UUID, UUID, TEXT, TEXT, public.notification_type_enum, TEXT) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 3. COMPOSITE & PARTIAL INDEXES FOR REPORTING, FILTERING & NOTIFICATIONS
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_notifications_user_org_created_desc
  ON public.notifications (user_id, organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread_created_desc
  ON public.notifications (user_id, created_at DESC)
  WHERE is_read = false;

CREATE INDEX IF NOT EXISTS idx_appointments_org_doctor_status_start_desc
  ON public.appointments (organization_id, doctor_profile_id, status, requested_start DESC);

CREATE INDEX IF NOT EXISTS idx_appointments_org_service
  ON public.appointments (organization_id, service_id);

CREATE INDEX IF NOT EXISTS idx_medical_records_org_created_desc
  ON public.medical_records (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_prescriptions_org_status_created_desc
  ON public.prescriptions (organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_vaccinations_org_administered_desc
  ON public.vaccinations (organization_id, administered_date DESC);

CREATE INDEX IF NOT EXISTS idx_clinic_clients_org_status_requested_desc
  ON public.clinic_clients (organization_id, status, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_consultation_payments_org_status_created_desc
  ON public.consultation_payments (organization_id, payment_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_org_action_created_desc
  ON public.audit_logs (organization_id, action, created_at DESC);

-- ------------------------------------------------------------------------------
-- 4. TENANT-ISOLATED SERVICE SUMMARY REPORT RPC
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_org_service_summary(
  p_organization_id UUID,
  p_from TIMESTAMPTZ DEFAULT NULL,
  p_to TIMESTAMPTZ DEFAULT NULL,
  p_branch_id UUID DEFAULT NULL
)
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
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  IF NOT (SELECT app.is_org_member(p_organization_id)) THEN
    RAISE EXCEPTION 'Forbidden: organization membership required' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    (SELECT app.has_org_permission(p_organization_id, 'audit.read'))
    OR (SELECT app.has_org_permission(p_organization_id, 'appointments.read'))
  ) THEN
    RAISE EXCEPTION 'Forbidden: insufficient permissions for service summary report' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(row_data ORDER BY booking_count DESC, service_name ASC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      cs.id AS service_id,
      cs.name AS service_name,
      cs.code AS service_code,
      cs.category,
      cs.duration_minutes,
      cs.price,
      cs.is_active,
      count(a.id)::int AS booking_count,
      count(a.id) FILTER (WHERE a.status = 'completed')::int AS completed_count,
      count(a.id) FILTER (WHERE a.status = 'requested')::int AS requested_count,
      count(a.id) FILTER (WHERE a.status IN ('confirmed', 'checked_in'))::int AS active_count,
      count(a.id) FILTER (WHERE a.status IN ('cancelled', 'declined', 'no_show'))::int AS dropped_count,
      round((count(a.id) FILTER (WHERE a.status = 'completed') * cs.price)::numeric, 2) AS estimated_completed_revenue,
      jsonb_build_object(
        'service_id', cs.id,
        'service_name', cs.name,
        'service_code', cs.code,
        'category', cs.category,
        'duration_minutes', cs.duration_minutes,
        'price', cs.price,
        'is_active', cs.is_active,
        'booking_count', count(a.id)::int,
        'completed_count', count(a.id) FILTER (WHERE a.status = 'completed')::int,
        'requested_count', count(a.id) FILTER (WHERE a.status = 'requested')::int,
        'active_count', count(a.id) FILTER (WHERE a.status IN ('confirmed', 'checked_in'))::int,
        'dropped_count', count(a.id) FILTER (WHERE a.status IN ('cancelled', 'declined', 'no_show'))::int,
        'estimated_completed_revenue', round((count(a.id) FILTER (WHERE a.status = 'completed') * cs.price)::numeric, 2)
      ) AS row_data
    FROM public.clinic_services cs
    LEFT JOIN public.appointments a
      ON a.service_id = cs.id
      AND a.organization_id = p_organization_id
      AND (p_branch_id IS NULL OR a.branch_id = p_branch_id)
      AND (p_from IS NULL OR coalesce(lower(a.scheduled_range), a.requested_start) >= p_from)
      AND (p_to IS NULL OR coalesce(lower(a.scheduled_range), a.requested_start) <= p_to)
    WHERE cs.organization_id = p_organization_id
      AND (p_branch_id IS NULL OR cs.branch_id IS NULL OR cs.branch_id = p_branch_id)
    GROUP BY cs.id
  ) sub;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_org_service_summary(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_org_service_summary(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID) TO authenticated;
