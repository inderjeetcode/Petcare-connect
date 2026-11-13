-- ==============================================================================
-- PET CONNECT VETERINARY HEALTHCARE PLATFORM
-- Migration 8 (Phase 4): Client Review Submission RPC & Pet DOB/Avatar Update
-- File: supabase/migrations/20261113080000_phase4_client_reviews_and_pet_updates.sql
-- ==============================================================================
-- NOTES:
-- 1. Strictly additive / hardened incremental update for Phase 4 Client Portal.
-- 2. Allows approved clinic clients and organization staff to read reviews in
--    their active organization (reviews remain tenant-isolated).
-- 3. Adds SECURITY DEFINER submit_review(UUID, INT, TEXT) RPC so approved clients
--    can submit validated 1..5 star reviews on completed/expired consultations.
-- 4. Extends update_pet(UUID, JSONB) safely to allow date_of_birth & avatar_url
--    updates with positive weight enforcement.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. REVIEWS SELECT POLICY (Tenant-scoped for Org Members & Approved Clients)
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "reviews_select_tenant" ON public.reviews;

CREATE POLICY "reviews_select_tenant"
ON public.reviews FOR SELECT TO authenticated
USING (
  (SELECT app.is_org_member(organization_id))
  OR (SELECT app.current_clinic_client_id(organization_id)) IS NOT NULL
);

-- ------------------------------------------------------------------------------
-- 2. SUBMIT REVIEW RPC (SECURITY DEFINER, 1 Review Per Concluded Consultation)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_review(
  p_consultation_id UUID,
  p_rating INT,
  p_review_text TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_cons public.consultations;
  v_cc_id UUID;
  v_clean_text TEXT := trim(COALESCE(p_review_text, ''));
  v_review_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Authentication required' USING ERRCODE = '28000';
  END IF;

  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RAISE EXCEPTION 'Rating must be an integer between 1 and 5' USING ERRCODE = '22023';
  END IF;

  IF char_length(v_clean_text) < 5 OR char_length(v_clean_text) > 2000 THEN
    RAISE EXCEPTION 'Review text must be between 5 and 2000 characters' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_cons
  FROM public.consultations
  WHERE id = p_consultation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Consultation not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_cons.organization_id IS NULL OR NOT app.is_org_active(v_cons.organization_id) THEN
    RAISE EXCEPTION 'Forbidden: Organization is inactive' USING ERRCODE = '42501';
  END IF;

  v_cc_id := app.current_clinic_client_id(v_cons.organization_id);
  IF v_cc_id IS NULL THEN
    RAISE EXCEPTION 'Forbidden: Approved clinic client membership required' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    v_cons.client_id = v_uid
    OR app.is_pet_guardian(v_cons.organization_id, v_cons.pet_id)
  ) THEN
    RAISE EXCEPTION 'Forbidden: Only the consultation client or pet guardian can review this case' USING ERRCODE = '42501';
  END IF;

  IF v_cons.consultation_status NOT IN ('completed', 'expired') THEN
    RAISE EXCEPTION 'Only completed or expired consultations can be reviewed' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.reviews r WHERE r.consultation_id = p_consultation_id
  ) THEN
    RAISE EXCEPTION 'A review has already been submitted for this consultation' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.reviews (
    organization_id, consultation_id, client_id, doctor_id, rating, review_text
  )
  VALUES (
    v_cons.organization_id, p_consultation_id, v_uid, v_cons.doctor_id, p_rating, v_clean_text
  )
  RETURNING id INTO v_review_id;

  PERFORM app.write_audit_log(
    v_cons.organization_id, v_uid, 'SUBMIT_REVIEW', 'review', v_review_id::TEXT,
    'Submitted ' || p_rating::TEXT || '-star review for consultation ' || p_consultation_id::TEXT
  );

  RETURN v_review_id;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_review(UUID, INT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_review(UUID, INT, TEXT) TO authenticated;

-- ------------------------------------------------------------------------------
-- 3. EXTEND UPDATE_PET RPC TO SUPPORT DATE_OF_BIRTH, AVATAR_URL & WEIGHT CHECK
-- ------------------------------------------------------------------------------
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

  IF p_updates ? 'weight' AND p_updates->>'weight' IS NOT NULL THEN
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
      avatar_url = CASE WHEN p_updates ? 'avatar_url' THEN NULLIF(trim(COALESCE(p_updates->>'avatar_url', '')), '') ELSE avatar_url END,
      allergies = CASE WHEN p_updates ? 'allergies' THEN NULLIF(trim(COALESCE(p_updates->>'allergies', '')), '') ELSE allergies END,
      medical_notes = CASE WHEN p_updates ? 'medical_notes' THEN NULLIF(trim(COALESCE(p_updates->>'medical_notes', '')), '') ELSE medical_notes END
  WHERE id = p_pet_id;

  PERFORM app.write_audit_log(
    v_pet.organization_id, v_uid, 'UPDATE_PET', 'pet', p_pet_id::TEXT,
    'Updated pet profile', to_jsonb(v_pet), p_updates
  );
END;
$$;
REVOKE ALL ON FUNCTION public.update_pet(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_pet(UUID, JSONB) TO authenticated;
