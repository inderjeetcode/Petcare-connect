-- ==============================================================================
-- PET CONNECT VETERINARY HEALTHCARE PLATFORM
-- Migration 5 (Phase 2c Backfill): Deterministic MaxPetZ Pilot Attribution
-- File: supabase/migrations/20261113050000_phase2c_backfill_maxpetz_safe.sql
-- ==============================================================================
-- STRICT PROVENANCE RULES:
-- 1. MaxPetZ is the initial pilot organization; existing verified real records
--    are attributed to MaxPetZ (slug = 'maxpetz').
-- 2. Historical branch mappings remain UNRESOLVED (branch_id = NULL,
--    is_legacy_unmapped_branch = true) until verified MaxPetZ branch source
--    records are supplied. NEVER invent a Main, Legacy, or default branch.
-- 3. Known 003/seed/script test artifacts are quarantined/excluded rather than
--    blindly promoted into active MaxPetZ clinical rosters or platform_admins.
-- 4. Existing user_roles(role='admin') rows are NOT blindly promoted to
--    platform_admins; D-04 identity mapping requires explicit operator assignment.
-- 5. Full counts & skipped artifact details logged in app.migration_runs.
-- ==============================================================================

DO $$
DECLARE
  v_run_id UUID;
  v_maxpetz_id UUID;
  v_pets_updated BIGINT := 0;
  v_docs_updated BIGINT := 0;
  v_clients_inserted BIGINT := 0;
  v_guardians_inserted BIGINT := 0;
  v_memberships_inserted BIGINT := 0;
  v_cons_updated BIGINT := 0;
  v_stale_expired BIGINT := 0;
  v_payments_updated BIGINT := 0;
  v_convs_updated BIGINT := 0;
  v_msgs_updated BIGINT := 0;
  v_rx_updated BIGINT := 0;
  v_rx_items_updated BIGINT := 0;
  v_medrec_updated BIGINT := 0;
  v_vax_updated BIGINT := 0;
  v_reviews_updated BIGINT := 0;
  v_audit_updated BIGINT := 0;
  v_quarantined_profiles BIGINT := 0;
  v_quarantined_cons BIGINT := 0;
  v_doctor_role_id UUID;
BEGIN
  INSERT INTO app.migration_runs (migration_name, phase, details)
  VALUES (
    '20261113050000_phase2c_backfill_maxpetz_safe',
    'phase_2c_backfill',
    jsonb_build_object('pilot_org', 'maxpetz', 'branch_policy', 'no_invented_branches')
  )
  RETURNING id INTO v_run_id;

  -- 1. Register MaxPetZ organization idempotently (NO synthetic branches created)
  INSERT INTO public.organizations (
    slug, legal_name, display_name, status, timezone, country
  )
  VALUES (
    'maxpetz', 'MaxPetZ Veterinary Hospitals', 'MaxPetZ', 'active', 'UTC', 'IN'
  )
  ON CONFLICT (slug) DO UPDATE SET
    display_name = EXCLUDED.display_name
  RETURNING id INTO v_maxpetz_id;

  -- Count quarantined test/script profiles (excluded from automatic MaxPetZ client/staff backfill)
  SELECT count(*) INTO v_quarantined_profiles
  FROM public.profiles p
  WHERE p.email LIKE '%@petconnect.com'
     OR p.email LIKE 'client.test.%@gmail.com'
     OR p.email = 'vet.tester.petconnect@gmail.com'
     OR p.full_name LIKE '[CONTROLLED-TEST]%';

  SELECT count(*) INTO v_quarantined_cons
  FROM public.consultations c
  WHERE c.consultation_reason LIKE '%[CONTROLLED-TEST]%'
     OR c.consultation_reason LIKE 'Automated Test:%';

  -- 2. Backfill organization_id on real (non-test) doctor_profiles
  WITH upd_docs AS (
    UPDATE public.doctor_profiles dp
    SET organization_id = v_maxpetz_id,
        display_name = COALESCE(dp.display_name, pr.full_name)
    FROM public.profiles pr
    WHERE dp.user_id = pr.id
      AND dp.organization_id IS NULL
      AND pr.email NOT LIKE '%@petconnect.com'
      AND pr.email <> 'vet.tester.petconnect@gmail.com'
      AND pr.full_name NOT LIKE '[CONTROLLED-TEST]%'
    RETURNING dp.id
  )
  SELECT count(*) INTO v_docs_updated FROM upd_docs;

  -- Create active organization_memberships + 'doctor' role for real backfilled MaxPetZ doctors
  SELECT id INTO v_doctor_role_id FROM public.organization_roles WHERE code = 'doctor';

  WITH ins_mem AS (
    INSERT INTO public.organization_memberships (organization_id, user_id, status, joined_at)
    SELECT dp.organization_id, dp.user_id, 'active', timezone('utc'::text, now())
    FROM public.doctor_profiles dp
    WHERE dp.organization_id = v_maxpetz_id
    ON CONFLICT (organization_id, user_id) DO NOTHING
    RETURNING id, organization_id
  )
  SELECT count(*) INTO v_memberships_inserted FROM ins_mem;

  INSERT INTO public.membership_roles (membership_id, organization_id, role_id)
  SELECT om.id, om.organization_id, v_doctor_role_id
  FROM public.organization_memberships om
  JOIN public.doctor_profiles dp
    ON dp.organization_id = om.organization_id
   AND dp.user_id = om.user_id
  WHERE om.organization_id = v_maxpetz_id
  ON CONFLICT (membership_id, role_id) DO NOTHING;

  -- 3. Backfill clinic_clients for real profiles owning pets or having consultations
  WITH ins_cc AS (
    INSERT INTO public.clinic_clients (
      organization_id, user_id, full_name, email, phone, status, approved_at, source
    )
    SELECT DISTINCT
      v_maxpetz_id,
      CASE WHEN EXISTS (SELECT 1 FROM auth.users au WHERE au.id = pr.id) THEN pr.id ELSE NULL END,
      pr.full_name,
      pr.email,
      pr.phone,
      'approved',
      timezone('utc'::text, now()),
      'legacy-maxpetz-backfill'
    FROM public.profiles pr
    WHERE pr.email NOT LIKE '%@petconnect.com'
      AND pr.email NOT LIKE 'client.test.%@gmail.com'
      AND pr.email <> 'vet.tester.petconnect@gmail.com'
      AND pr.full_name NOT LIKE '[CONTROLLED-TEST]%'
      AND (
        EXISTS (SELECT 1 FROM public.pets pt WHERE pt.owner_id = pr.id)
        OR EXISTS (SELECT 1 FROM public.consultations c WHERE c.client_id = pr.id)
      )
    ON CONFLICT DO NOTHING
    RETURNING id
  )
  SELECT count(*) INTO v_clients_inserted FROM ins_cc;

  -- 4. Backfill organization_id on real pets + create primary pet_guardians
  WITH upd_pets AS (
    UPDATE public.pets pt
    SET organization_id = v_maxpetz_id,
        created_by = COALESCE(pt.created_by, pt.owner_id)
    FROM public.profiles pr
    WHERE pt.owner_id = pr.id
      AND pt.organization_id IS NULL
      AND pr.email NOT LIKE '%@petconnect.com'
      AND pr.email NOT LIKE 'client.test.%@gmail.com'
      AND pr.full_name NOT LIKE '[CONTROLLED-TEST]%'
      AND pt.name NOT LIKE '[CONTROLLED-TEST]%'
    RETURNING pt.id
  )
  SELECT count(*) INTO v_pets_updated FROM upd_pets;

  WITH ins_pg AS (
    INSERT INTO public.pet_guardians (organization_id, pet_id, clinic_client_id, relationship, is_primary)
    SELECT pt.organization_id, pt.id, cc.id, 'owner', true
    FROM public.pets pt
    JOIN public.profiles pr ON pr.id = pt.owner_id
    JOIN public.clinic_clients cc
      ON cc.organization_id = pt.organization_id
     AND (
       cc.user_id = pt.owner_id
       OR (cc.user_id IS NULL AND cc.email IS NOT NULL AND cc.email = pr.email)
     )
    WHERE pt.organization_id = v_maxpetz_id
    ON CONFLICT (pet_id, clinic_client_id) DO NOTHING
    RETURNING id
  )
  SELECT count(*) INTO v_guardians_inserted FROM ins_pg;

  -- 5. Backfill consultations (branch_id remains NULL, is_legacy_unmapped_branch = true)
  WITH upd_cons AS (
    UPDATE public.consultations c
    SET organization_id = v_maxpetz_id,
        branch_id = NULL,
        is_legacy_unmapped_branch = true,
        clinic_client_id = COALESCE(
          c.clinic_client_id,
          (
            SELECT cc.id
            FROM public.clinic_clients cc
            LEFT JOIN public.profiles pr ON pr.id = c.client_id
            WHERE cc.organization_id = v_maxpetz_id
              AND (
                cc.user_id = c.client_id
                OR (cc.user_id IS NULL AND pr.email IS NOT NULL AND cc.email = pr.email)
              )
            LIMIT 1
          )
        )
    WHERE c.organization_id IS NULL
      AND c.consultation_reason NOT LIKE '%[CONTROLLED-TEST]%'
      AND c.consultation_reason NOT LIKE 'Automated Test:%'
      AND EXISTS (SELECT 1 FROM public.pets pt WHERE pt.id = c.pet_id AND pt.organization_id = v_maxpetz_id)
      AND EXISTS (SELECT 1 FROM public.doctor_profiles dp WHERE dp.id = c.doctor_id AND dp.organization_id = v_maxpetz_id)
    RETURNING c.id
  )
  SELECT count(*) INTO v_cons_updated FROM upd_cons;

  -- Normalize stale active consultations whose 7-day window already elapsed (D-09)
  WITH exp_cons AS (
    UPDATE public.consultations
    SET consultation_status = 'expired'
    WHERE organization_id = v_maxpetz_id
      AND consultation_status = 'active'
      AND expires_at IS NOT NULL
      AND expires_at < timezone('utc'::text, now())
    RETURNING id
  )
  SELECT count(*) INTO v_stale_expired FROM exp_cons;

  -- 6. Propagate organization_id to downstream tables from parent records
  WITH upd_pay AS (
    UPDATE public.consultation_payments cp
    SET organization_id = c.organization_id
    FROM public.consultations c
    WHERE cp.consultation_id = c.id AND cp.organization_id IS NULL AND c.organization_id IS NOT NULL
    RETURNING cp.id
  ) SELECT count(*) INTO v_payments_updated FROM upd_pay;

  WITH upd_conv AS (
    UPDATE public.chat_conversations cc
    SET organization_id = c.organization_id
    FROM public.consultations c
    WHERE cc.consultation_id = c.id AND cc.organization_id IS NULL AND c.organization_id IS NOT NULL
    RETURNING cc.id
  ) SELECT count(*) INTO v_convs_updated FROM upd_conv;

  WITH upd_msg AS (
    UPDATE public.chat_messages cm
    SET organization_id = cc.organization_id,
        attachment_url = CASE
          WHEN cm.attachment_url LIKE 'blob:%' OR cm.attachment_url LIKE '%example.com%' THEN NULL
          ELSE cm.attachment_url
        END
    FROM public.chat_conversations cc
    WHERE cm.conversation_id = cc.id AND cm.organization_id IS NULL AND cc.organization_id IS NOT NULL
    RETURNING cm.id
  ) SELECT count(*) INTO v_msgs_updated FROM upd_msg;

  WITH upd_rx AS (
    UPDATE public.prescriptions p
    SET organization_id = pt.organization_id,
        is_legacy_unmapped_branch = true
    FROM public.pets pt
    WHERE p.pet_id = pt.id AND p.organization_id IS NULL AND pt.organization_id IS NOT NULL
    RETURNING p.id
  ) SELECT count(*) INTO v_rx_updated FROM upd_rx;

  WITH upd_rxi AS (
    UPDATE public.prescription_items pi
    SET organization_id = p.organization_id
    FROM public.prescriptions p
    WHERE pi.prescription_id = p.id AND pi.organization_id IS NULL AND p.organization_id IS NOT NULL
    RETURNING pi.id
  ) SELECT count(*) INTO v_rx_items_updated FROM upd_rxi;

  WITH upd_mr AS (
    UPDATE public.medical_records mr
    SET organization_id = pt.organization_id
    FROM public.pets pt
    WHERE mr.pet_id = pt.id AND mr.organization_id IS NULL AND pt.organization_id IS NOT NULL
    RETURNING mr.id
  ) SELECT count(*) INTO v_medrec_updated FROM upd_mr;

  WITH upd_vx AS (
    UPDATE public.vaccinations v
    SET organization_id = pt.organization_id,
        is_backfilled = true
    FROM public.pets pt
    WHERE v.pet_id = pt.id AND v.organization_id IS NULL AND pt.organization_id IS NOT NULL
    RETURNING v.id
  ) SELECT count(*) INTO v_vax_updated FROM upd_vx;

  WITH upd_rev AS (
    UPDATE public.reviews r
    SET organization_id = c.organization_id
    FROM public.consultations c
    WHERE r.consultation_id = c.id AND r.organization_id IS NULL AND c.organization_id IS NOT NULL
    RETURNING r.id
  ) SELECT count(*) INTO v_reviews_updated FROM upd_rev;

  WITH upd_aud AS (
    UPDATE public.audit_logs al
    SET organization_id = c.organization_id,
        actor_user_id = COALESCE(al.actor_user_id, al.user_id)
    FROM public.consultations c
    WHERE al.entity_type = 'consultation'
      AND al.entity_id = c.id::TEXT
      AND al.organization_id IS NULL
      AND c.organization_id IS NOT NULL
    RETURNING al.id
  ) SELECT count(*) INTO v_audit_updated FROM upd_aud;

  UPDATE app.migration_runs
  SET finished_at = timezone('utc'::text, now()),
      rows_affected = v_pets_updated + v_docs_updated + v_clients_inserted + v_guardians_inserted
                    + v_memberships_inserted + v_cons_updated + v_convs_updated + v_msgs_updated
                    + v_rx_updated + v_rx_items_updated + v_medrec_updated + v_vax_updated,
      details = details || jsonb_build_object(
        'maxpetz_id', v_maxpetz_id,
        'doctors_updated', v_docs_updated,
        'memberships_inserted', v_memberships_inserted,
        'clinic_clients_inserted', v_clients_inserted,
        'pets_updated', v_pets_updated,
        'pet_guardians_inserted', v_guardians_inserted,
        'consultations_updated', v_cons_updated,
        'stale_consultations_expired', v_stale_expired,
        'payments_updated', v_payments_updated,
        'conversations_updated', v_convs_updated,
        'messages_updated', v_msgs_updated,
        'prescriptions_updated', v_rx_updated,
        'prescription_items_updated', v_rx_items_updated,
        'medical_records_updated', v_medrec_updated,
        'vaccinations_updated', v_vax_updated,
        'reviews_updated', v_reviews_updated,
        'audit_logs_updated', v_audit_updated,
        'quarantined_test_profiles', v_quarantined_profiles,
        'quarantined_test_consultations', v_quarantined_cons,
        'unresolved_admin_roles_count', (SELECT count(*) FROM public.user_roles WHERE role = 'admin')
      )
  WHERE id = v_run_id;
END $$;
