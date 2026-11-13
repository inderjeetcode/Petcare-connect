-- ==============================================================================
-- PET CONNECT VETERINARY HEALTHCARE PLATFORM
-- Multi-Tenant RLS & Hardened RPC Test Suite (12 Core Suites / 30+ Assertions)
-- File: supabase/tests/rls_multi_tenant_suite.sql
-- ==============================================================================
-- EXECUTION REQUIREMENTS:
-- - Run against a local Supabase Postgres / staging database AFTER applying all
--   migrations in supabase/migrations/20261113000000..20261113070000.
-- - Uses genuine `SET LOCAL ROLE authenticated;` + `request.jwt.claims` so RLS
--   and GRANT/REVOKE enforcement are NEVER bypassed during assertions.
-- - Wrapped in BEGIN; ... ROLLBACK; so zero synthetic test rows persist.
-- - Note: Not executed automatically in environments without Postgres/Supabase CLI.
-- ==============================================================================

BEGIN;

DO $$
DECLARE
  -- Synthetic isolated identities (created transiently inside transaction)
  v_platform_admin   UUID := '90000000-0000-0000-0000-000000000001';
  v_org_a_owner      UUID := '90000000-0000-0000-0000-000000000002';
  v_org_a_admin      UUID := '90000000-0000-0000-0000-000000000003';
  v_org_a_frontdesk  UUID := '90000000-0000-0000-0000-000000000004';
  v_org_a_branch_mgr UUID := '90000000-0000-0000-0000-000000000005';
  v_org_a_doc1       UUID := '90000000-0000-0000-0000-000000000006'; -- Multi-branch + also client in Org B
  v_org_a_doc2       UUID := '90000000-0000-0000-0000-000000000007'; -- Unassigned peer doctor in Org A
  v_org_a_client1    UUID := '90000000-0000-0000-0000-000000000008';
  v_org_a_pending    UUID := '90000000-0000-0000-0000-000000000009';
  v_org_b_owner      UUID := '90000000-0000-0000-0000-000000000010';
  v_org_b_doc1       UUID := '90000000-0000-0000-0000-000000000011';
  v_org_b_client1    UUID := '90000000-0000-0000-0000-000000000012';

  v_org_a_id         UUID;
  v_org_b_id         UUID;
  v_app_a_id         UUID;
  v_app_b_id         UUID;
  v_branch_a1_id     UUID;
  v_branch_a2_id     UUID;
  v_branch_b1_id     UUID;

  v_doc_a1_prof_id   UUID;
  v_doc_a2_prof_id   UUID;
  v_doc_b1_prof_id   UUID;

  v_cc_a1_id         UUID;
  v_cc_a_pending_id  UUID;
  v_cc_b1_id         UUID;
  v_cc_b_from_a_doc  UUID;

  v_pet_a1_id        UUID;
  v_pet_b1_id        UUID;

  v_appt_a1_id       UUID;
  v_appt_a1_clash_id UUID;
  v_appt_a2_id       UUID;
  v_cons_a1          public.consultations;
  v_cons_unlinked_id UUID;
  v_conv_a1_id       UUID;
  v_rx_a1_id         UUID;
  v_rec_a1_id        UUID;

  v_count            BIGINT;
  v_slot_count       BIGINT;
  v_err_caught       BOOLEAN;
  v_test_date        DATE := (CURRENT_DATE + 14);
  v_slot_start       TIMESTAMPTZ;
  v_slot_end         TIMESTAMPTZ;

  v_mem_id           UUID;
  v_uid              UUID;
  v_idx              INT := 0;
  v_uids             UUID[] := ARRAY[
    '90000000-0000-0000-0000-000000000001'::uuid,
    '90000000-0000-0000-0000-000000000002'::uuid,
    '90000000-0000-0000-0000-000000000003'::uuid,
    '90000000-0000-0000-0000-000000000004'::uuid,
    '90000000-0000-0000-0000-000000000005'::uuid,
    '90000000-0000-0000-0000-000000000006'::uuid,
    '90000000-0000-0000-0000-000000000007'::uuid,
    '90000000-0000-0000-0000-000000000008'::uuid,
    '90000000-0000-0000-0000-000000000009'::uuid,
    '90000000-0000-0000-0000-000000000010'::uuid,
    '90000000-0000-0000-0000-000000000011'::uuid,
    '90000000-0000-0000-0000-000000000012'::uuid
  ];
BEGIN
  -- ---------------------------------------------------------------------------
  -- FIXTURE SETUP (privileged role only for auth.users + platform_admins seed)
  -- ---------------------------------------------------------------------------
  FOREACH v_uid IN ARRAY v_uids LOOP
    v_idx := v_idx + 1;
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    )
    VALUES (
      v_uid,
      '00000000-0000-0000-0000-000000000000'::uuid,
      'authenticated',
      'authenticated',
      'rls-suite-' || v_idx || '@rls-fixture.invalid',
      '$2a$10$rlsfixtureplaceholderhash00000000000000000000000000000',
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', 'RLS Fixture User ' || v_idx),
      now(),
      now()
    )
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.profiles (id, full_name, email)
    VALUES (v_uid, 'RLS Fixture User ' || v_idx, 'rls-suite-' || v_idx || '@rls-fixture.invalid')
    ON CONFLICT (id) DO NOTHING;
  END LOOP;

  INSERT INTO public.platform_admins (user_id, granted_by, is_active, notes)
  VALUES (v_platform_admin, v_platform_admin, true, 'RLS suite platform owner fixture');

  -- ---------------------------------------------------------------------------
  -- TEST 1: cleanup_test_records(UUID[]) DOES NOT EXIST (SEC-11)
  -- ---------------------------------------------------------------------------
  v_err_caught := false;
  BEGIN
    EXECUTE 'SELECT public.cleanup_test_records(ARRAY[]::uuid[])';
  EXCEPTION WHEN undefined_function THEN
    v_err_caught := true;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 1 FAILED: legacy cleanup_test_records(UUID[]) still exists!';
  END IF;
  RAISE NOTICE 'TEST 1 PASSED: cleanup_test_records(UUID[]) removed';

  -- ---------------------------------------------------------------------------
  -- TEST 2: PLATFORM APPLICATION & MULTI-ORG PROVISIONING VIA REAL AUTHENTICATED RPCs
  -- ---------------------------------------------------------------------------
  SET LOCAL ROLE authenticated;

  -- Org A Owner submits application
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org_a_owner::text, 'role', 'authenticated', 'email', 'rls-suite-2@rls-fixture.invalid')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_org_a_owner::text, true);
  v_app_a_id := public.submit_organization_application(
    'Alpha Vet Clinic', 'rls-alpha-vet', 'Alpha Vet LLC', 'alpha@rls-fixture.invalid',
    '+919900000001', 'IN', 'UTC', 'Alpha Branch 1', 'A01', '100 Alpha Way'
  );

  -- Org B Owner submits application
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org_b_owner::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_org_b_owner::text, true);
  v_app_b_id := public.submit_organization_application(
    'Beta Vet Clinic', 'rls-beta-vet', 'Beta Vet LLC', 'beta@rls-fixture.invalid',
    '+919900000002', 'IN', 'UTC', 'Beta Branch 1', 'B01', '200 Beta Way'
  );

  -- Non-platform-admin cannot approve organization (42501)
  v_err_caught := false;
  BEGIN
    PERFORM public.approve_organization_application(v_app_a_id);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_err_caught := true;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 2a FAILED: Non-platform-admin approved organization application!';
  END IF;

  -- Platform Owner approves both organizations
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_platform_admin::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_platform_admin::text, true);
  v_org_a_id := public.approve_organization_application(v_app_a_id);
  v_org_b_id := public.approve_organization_application(v_app_b_id);

  -- Switch to privileged role briefly only to read branch IDs for fixtures
  RESET ROLE;
  SELECT id INTO v_branch_a1_id FROM public.branches WHERE organization_id = v_org_a_id AND code = 'A01';
  SELECT id INTO v_branch_b1_id FROM public.branches WHERE organization_id = v_org_b_id AND code = 'B01';

  -- Org A Owner creates Branch A2 & assigns org staff (via authenticated role)
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org_a_owner::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_org_a_owner::text, true);
  v_branch_a2_id := public.create_or_update_branch(v_org_a_id, NULL, 'Alpha Branch 2', 'A02', 'UTC', '102 Alpha Way', '+919900000003', true);

  -- Setup staff memberships & doctor profiles in Org A and Org B
  RESET ROLE;
  INSERT INTO public.organization_memberships (organization_id, user_id, status, joined_at)
  VALUES
    (v_org_a_id, v_org_a_admin, 'active', now()),
    (v_org_a_id, v_org_a_frontdesk, 'active', now()),
    (v_org_a_id, v_org_a_branch_mgr, 'active', now()),
    (v_org_a_id, v_org_a_doc1, 'active', now()),
    (v_org_a_id, v_org_a_doc2, 'active', now()),
    (v_org_b_id, v_org_b_doc1, 'active', now());

  -- Assign roles via set_member_roles as Org A Owner
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org_a_owner::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_org_a_owner::text, true);

  SELECT id INTO v_mem_id FROM public.organization_memberships WHERE organization_id = v_org_a_id AND user_id = v_org_a_admin;
  PERFORM public.set_member_roles(v_mem_id, ARRAY['org_admin'], '{}'::uuid[]);

  SELECT id INTO v_mem_id FROM public.organization_memberships WHERE organization_id = v_org_a_id AND user_id = v_org_a_frontdesk;
  PERFORM public.set_member_roles(v_mem_id, ARRAY['front_desk'], ARRAY[v_branch_a1_id]);

  SELECT id INTO v_mem_id FROM public.organization_memberships WHERE organization_id = v_org_a_id AND user_id = v_org_a_branch_mgr;
  PERFORM public.set_member_roles(v_mem_id, ARRAY['branch_manager'], ARRAY[v_branch_a1_id]);

  SELECT id INTO v_mem_id FROM public.organization_memberships WHERE organization_id = v_org_a_id AND user_id = v_org_a_doc1;
  PERFORM public.set_member_roles(v_mem_id, ARRAY['doctor'], ARRAY[v_branch_a1_id, v_branch_a2_id]);

  SELECT id INTO v_mem_id FROM public.organization_memberships WHERE organization_id = v_org_a_id AND user_id = v_org_a_doc2;
  PERFORM public.set_member_roles(v_mem_id, ARRAY['doctor'], ARRAY[v_branch_a1_id]);

  -- Non-owner org_admin CANNOT promote someone to org_admin (42501)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org_a_admin::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_org_a_admin::text, true);
  v_err_caught := false;
  BEGIN
    SELECT id INTO v_mem_id FROM public.organization_memberships WHERE organization_id = v_org_a_id AND user_id = v_org_a_frontdesk;
    PERFORM public.set_member_roles(v_mem_id, ARRAY['org_admin'], '{}'::uuid[]);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_err_caught := true;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 2b FAILED: org_admin was able to assign org_admin role!';
  END IF;

  -- Setup Org B Doctor role & doctor profiles
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org_b_owner::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_org_b_owner::text, true);
  SELECT id INTO v_mem_id FROM public.organization_memberships WHERE organization_id = v_org_b_id AND user_id = v_org_b_doc1;
  PERFORM public.set_member_roles(v_mem_id, ARRAY['doctor'], ARRAY[v_branch_b1_id]);

  RESET ROLE;
  INSERT INTO public.doctor_profiles (organization_id, user_id, display_name, specialization, qualification, experience_years, is_active)
  VALUES
    (v_org_a_id, v_org_a_doc1, 'Dr. Alpha One', 'Internal Medicine', 'MVSc', 8, true)
  RETURNING id INTO v_doc_a1_prof_id;

  INSERT INTO public.doctor_profiles (organization_id, user_id, display_name, specialization, qualification, experience_years, is_active)
  VALUES
    (v_org_a_id, v_org_a_doc2, 'Dr. Alpha Two', 'Surgery', 'MVSc', 6, true)
  RETURNING id INTO v_doc_a2_prof_id;

  INSERT INTO public.doctor_profiles (organization_id, user_id, display_name, specialization, qualification, experience_years, is_active)
  VALUES
    (v_org_b_id, v_org_b_doc1, 'Dr. Beta One', 'Dermatology', 'BVSc', 5, true)
  RETURNING id INTO v_doc_b1_prof_id;

  SET LOCAL ROLE authenticated;
  -- Assign multi-branch doctor A1 to BOTH Branch A1 and Branch A2
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org_a_admin::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_org_a_admin::text, true);
  PERFORM public.assign_doctor_to_branch(v_org_a_id, v_doc_a1_prof_id, v_branch_a1_id, true);
  PERFORM public.assign_doctor_to_branch(v_org_a_id, v_doc_a1_prof_id, v_branch_a2_id, true);
  PERFORM public.assign_doctor_to_branch(v_org_a_id, v_doc_a2_prof_id, v_branch_a1_id, true);

  -- Create schedule for Dr. Alpha One at Branch A1 (09:00..12:00 UTC on v_test_date weekday)
  PERFORM public.upsert_doctor_schedule(
    v_org_a_id, v_branch_a1_id, v_doc_a1_prof_id,
    EXTRACT(ISODOW FROM v_test_date)::SMALLINT, '09:00'::TIME, '12:00'::TIME, 30::SMALLINT, true
  );
  PERFORM public.upsert_doctor_schedule(
    v_org_a_id, v_branch_a2_id, v_doc_a1_prof_id,
    EXTRACT(ISODOW FROM v_test_date)::SMALLINT, '13:00'::TIME, '16:00'::TIME, 30::SMALLINT, true
  );

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org_b_owner::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_org_b_owner::text, true);
  PERFORM public.assign_doctor_to_branch(v_org_b_id, v_doc_b1_prof_id, v_branch_b1_id, true);

  RAISE NOTICE 'TEST 2 PASSED: Multi-org & multi-branch topology provisioned cleanly';

  -- ---------------------------------------------------------------------------
  -- TEST 3: CLINIC CLIENT APPROVAL BOUNDARY & MULTI-ORG GLOBAL IDENTITY
  -- ---------------------------------------------------------------------------
  -- Client 1 & Pending Client request join in Org A
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org_a_client1::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_org_a_client1::text, true);
  v_cc_a1_id := public.request_clinic_join(v_org_a_id);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org_a_pending::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_org_a_pending::text, true);
  v_cc_a_pending_id := public.request_clinic_join(v_org_a_id);

  -- Pending client sees 0 doctors, 0 branches, 0 schedules in Org A
  SELECT count(*) INTO v_count FROM public.doctor_profiles WHERE organization_id = v_org_a_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST 3a FAILED: Pending client saw % doctors before clinic approval!', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM public.branches WHERE organization_id = v_org_a_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST 3b FAILED: Pending client saw % branches before clinic approval!', v_count;
  END IF;

  -- Multi-org global identity: Dr. Alpha One (Org A doctor) requests & gets approved as a CLIENT in Org B!
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org_a_doc1::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_org_a_doc1::text, true);
  v_cc_b_from_a_doc := public.request_clinic_join(v_org_b_id);

  -- Org B Client 1 requests join in Org B
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org_b_client1::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_org_b_client1::text, true);
  v_cc_b1_id := public.request_clinic_join(v_org_b_id);

  -- Front desk approves Client 1 in Org A (leaves v_org_a_pending as requested)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org_a_frontdesk::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_org_a_frontdesk::text, true);
  PERFORM public.approve_clinic_client(v_cc_a1_id);

  -- Org B Owner approves Client 1 & Dr. Alpha One in Org B
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org_b_owner::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_org_b_owner::text, true);
  PERFORM public.approve_clinic_client(v_cc_b1_id);
  PERFORM public.approve_clinic_client(v_cc_b_from_a_doc);

  -- Approved Client 1 registers pet in Org A; Org B Client registers pet in Org B
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org_a_client1::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_org_a_client1::text, true);
  v_pet_a1_id := public.create_pet(v_org_a_id, v_cc_a1_id, 'Bella', 'Dog', 'Labrador', 'Female', 24.5);

  -- Org A Client CANNOT register pet inside Org B (42501)
  v_err_caught := false;
  BEGIN
    PERFORM public.create_pet(v_org_b_id, v_cc_b1_id, 'Intruder', 'Dog', 'Beagle', 'Male', 10.0);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_err_caught := true;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 3c FAILED: Org A client registered pet in Org B!';
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org_b_client1::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_org_b_client1::text, true);
  v_pet_b1_id := public.create_pet(v_org_b_id, v_cc_b1_id, 'Milo', 'Cat', 'Siamese', 'Male', 4.2);

  RAISE NOTICE 'TEST 3 PASSED: Clinic approval gate & multi-org global identity verified';

  -- ---------------------------------------------------------------------------
  -- TEST 4: COMPOSITE TENANT FOREIGN KEY PROTECTION (23503)
  -- ---------------------------------------------------------------------------
  RESET ROLE;
  v_err_caught := false;
  BEGIN
    -- Attempt cross-org appointment (Org A branch + Org B pet) even with RLS bypassed
    INSERT INTO public.appointments (
      organization_id, branch_id, clinic_client_id, pet_id, doctor_profile_id,
      requested_start, requested_end, status, reason
    )
    VALUES (
      v_org_a_id, v_branch_a1_id, v_cc_a1_id, v_pet_b1_id, v_doc_a1_prof_id,
      v_test_date::TIMESTAMP + TIME '09:00', v_test_date::TIMESTAMP + TIME '09:30', 'requested', 'Cross-tenant test'
    );
  EXCEPTION WHEN foreign_key_violation THEN
    v_err_caught := true;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 4 FAILED: Composite tenant FK allowed Org A appointment with Org B pet!';
  END IF;
  RAISE NOTICE 'TEST 4 PASSED: Composite tenant FK blocked cross-org reference (23503)';

  -- ---------------------------------------------------------------------------
  -- TEST 5: APPOINTMENT REQUEST vs CONFIRMATION + CONCURRENT EXCLUSION + BRANCH SCOPE
  -- ---------------------------------------------------------------------------
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org_a_client1::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_org_a_client1::text, true);

  SELECT slot_start, slot_end INTO v_slot_start, v_slot_end
  FROM public.get_available_slots(v_org_a_id, v_branch_a1_id, v_doc_a1_prof_id, v_test_date)
  ORDER BY slot_start LIMIT 1;

  SELECT count(*) INTO v_slot_count
  FROM public.get_available_slots(v_org_a_id, v_branch_a1_id, v_doc_a1_prof_id, v_test_date);

  IF v_slot_start IS NULL OR v_slot_count <> 6 THEN
    RAISE EXCEPTION 'TEST 5a FAILED: Expected 6 slots for 09:00-12:00 30-min window, got %', v_slot_count;
  END IF;

  -- Request TWO appointments on the SAME slot (requests do NOT reserve!)
  v_appt_a1_id := public.request_appointment(v_org_a_id, v_branch_a1_id, v_pet_a1_id, v_doc_a1_prof_id, v_slot_start, v_slot_end, 'Annual checkup');
  v_appt_a1_clash_id := public.request_appointment(v_org_a_id, v_branch_a1_id, v_pet_a1_id, v_doc_a1_prof_id, v_slot_start, v_slot_end, 'Duplicate pending request');

  -- Pending requests MUST NOT hide slot from get_available_slots
  SELECT count(*) INTO v_count
  FROM public.get_available_slots(v_org_a_id, v_branch_a1_id, v_doc_a1_prof_id, v_test_date);
  IF v_count <> 6 THEN
    RAISE EXCEPTION 'TEST 5b FAILED: Pending request blocked available slot (count=%)', v_count;
  END IF;

  -- Client CANNOT confirm their own appointment (42501)
  v_err_caught := false;
  BEGIN
    PERFORM public.confirm_appointment(v_appt_a1_id);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_err_caught := true;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 5c FAILED: Client self-confirmed appointment!';
  END IF;

  -- Front Desk (Branch A1) confirms first appointment
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org_a_frontdesk::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_org_a_frontdesk::text, true);
  PERFORM public.confirm_appointment(v_appt_a1_id);

  -- Confirmed slot is now excluded from get_available_slots (5 remaining)
  SELECT count(*) INTO v_count
  FROM public.get_available_slots(v_org_a_id, v_branch_a1_id, v_doc_a1_prof_id, v_test_date);
  IF v_count <> 5 THEN
    RAISE EXCEPTION 'TEST 5d FAILED: Confirmed appointment did not remove slot (count=%)', v_count;
  END IF;

  -- Double booking same doctor/range raises GiST exclusion violation 23P01
  v_err_caught := false;
  BEGIN
    PERFORM public.confirm_appointment(v_appt_a1_clash_id);
  EXCEPTION WHEN exclusion_violation THEN
    v_err_caught := true;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 5e FAILED: Overlapping confirm_appointment succeeded instead of raising 23P01!';
  END IF;

  -- Branch A2 appointment cannot be confirmed or read by Branch A1 branch_manager
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org_a_client1::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_org_a_client1::text, true);
  v_appt_a2_id := public.request_appointment(
    v_org_a_id, v_branch_a2_id, v_pet_a1_id, v_doc_a1_prof_id,
    (v_test_date::TIMESTAMP + TIME '13:00') AT TIME ZONE 'UTC',
    (v_test_date::TIMESTAMP + TIME '13:30') AT TIME ZONE 'UTC',
    'Branch A2 visit'
  );

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org_a_branch_mgr::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_org_a_branch_mgr::text, true);
  SELECT count(*) INTO v_count FROM public.appointments WHERE id = v_appt_a2_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST 5f FAILED: Branch A1 manager saw Branch A2 appointment!';
  END IF;

  v_err_caught := false;
  BEGIN
    PERFORM public.confirm_appointment(v_appt_a2_id);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_err_caught := true;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 5g FAILED: Branch A1 manager confirmed Branch A2 appointment!';
  END IF;

  RAISE NOTICE 'TEST 5 PASSED: Appointment workflow, GiST exclusion (23P01) & branch isolation verified';

  -- ---------------------------------------------------------------------------
  -- TEST 6: CONSULTATION ACTIVATION, 7-DAY WINDOW & STRICT CHAT PRIVACY (D-16)
  -- ---------------------------------------------------------------------------
  -- Mandatory appointment prerequisite: unlinked consultation cannot activate (22023)
  RESET ROLE;
  INSERT INTO public.consultations (
    organization_id, branch_id, clinic_client_id, appointment_id, client_id, doctor_id, pet_id,
    consultation_reason, consultation_status
  )
  VALUES (
    v_org_a_id, v_branch_a1_id, v_cc_a1_id, NULL, v_org_a_client1, v_doc_a1_prof_id, v_pet_a1_id,
    'Unlinked test', 'pending'
  )
  RETURNING id INTO v_cons_unlinked_id;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org_a_doc1::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_org_a_doc1::text, true);
  v_err_caught := false;
  BEGIN
    PERFORM public.activate_consultation(v_cons_unlinked_id);
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_err_caught := true;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 6a FAILED: Consultation without confirmed appointment activated!';
  END IF;

  -- Create consultation from confirmed appointment (pending first)
  v_cons_a1 := public.create_consultation_from_appointment(v_appt_a1_id, 'Checkup chat', false);

  -- Client self-activation blocked (42501)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org_a_client1::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_org_a_client1::text, true);
  v_err_caught := false;
  BEGIN
    PERFORM public.activate_consultation(v_cons_a1.id);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_err_caught := true;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 6b FAILED: Client self-activated consultation!';
  END IF;

  -- Unassigned peer doctor (Doc2 in Org A) blocked from activating (42501)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org_a_doc2::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_org_a_doc2::text, true);
  v_err_caught := false;
  BEGIN
    PERFORM public.activate_consultation(v_cons_a1.id);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_err_caught := true;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 6c FAILED: Unassigned peer doctor activated consultation!';
  END IF;

  -- Assigned Doctor 1 activates consultation -> exact 7-day window + 1 conversation
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org_a_doc1::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_org_a_doc1::text, true);
  v_cons_a1 := public.activate_consultation(v_cons_a1.id);
  IF v_cons_a1.consultation_status <> 'active'
     OR v_cons_a1.expires_at <> (v_cons_a1.activated_at + INTERVAL '7 days') THEN
    RAISE EXCEPTION 'TEST 6d FAILED: Invalid consultation activation state or 7-day window!';
  END IF;

  SELECT id INTO v_conv_a1_id FROM public.chat_conversations WHERE consultation_id = v_cons_a1.id;
  IF v_conv_a1_id IS NULL THEN
    RAISE EXCEPTION 'TEST 6e FAILED: Treating doctor cannot see newly created chat_conversation!';
  END IF;

  -- Treating doctor sends message; client sends reply
  PERFORM public.send_chat_message(v_conv_a1_id, 'text'::public.message_type_enum, 'Doctor greeting');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org_a_client1::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_org_a_client1::text, true);
  PERFORM public.send_chat_message(v_conv_a1_id, 'text'::public.message_type_enum, 'Client reply');

  -- Direct UPDATE on consultations blocked (42501)
  v_err_caught := false;
  BEGIN
    UPDATE public.consultations SET expires_at = now() + INTERVAL '30 days' WHERE id = v_cons_a1.id;
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_err_caught := true;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 6f FAILED: Direct UPDATE on consultations succeeded!';
  END IF;

  -- Expire consultation cleanly by setting activated_at/expires_at to past (privileged fixture step)
  RESET ROLE;
  ALTER TABLE public.consultations DISABLE TRIGGER consultations_guard_window;
  UPDATE public.consultations
  SET consultation_status = 'expired',
      activated_at = now() - INTERVAL '10 days',
      expires_at = now() - INTERVAL '3 days'
  WHERE id = v_cons_a1.id;
  ALTER TABLE public.consultations ENABLE TRIGGER consultations_guard_window;

  SET LOCAL ROLE authenticated;

  -- Client CANNOT send new messages after expiry (22023)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org_a_client1::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_org_a_client1::text, true);
  v_err_caught := false;
  BEGIN
    PERFORM public.send_chat_message(v_conv_a1_id, 'text'::public.message_type_enum, 'Late message');
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_err_caught := true;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 6g FAILED: Client sent chat message after 7-day expiry!';
  END IF;

  -- Expired chat history IS readable by consultation client (2 rows) and treating doctor (2 rows)
  SELECT count(*) INTO v_count FROM public.chat_messages WHERE conversation_id = v_conv_a1_id;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'TEST 6h FAILED: Client could not read expired chat history (count=%)', v_count;
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org_a_doc1::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_org_a_doc1::text, true);
  SELECT count(*) INTO v_count FROM public.chat_messages WHERE conversation_id = v_conv_a1_id;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'TEST 6i FAILED: Treating doctor could not read expired chat history (count=%)', v_count;
  END IF;

  -- STRICT D-16 PRIVACY CHECK: org_admin, org_owner, unrelated doc2, front_desk, & platform_admin see 0 rows!
  FOREACH v_uid IN ARRAY ARRAY[v_org_a_admin, v_org_a_owner, v_org_a_doc2, v_org_a_frontdesk, v_platform_admin] LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    SELECT count(*) INTO v_count FROM public.chat_messages WHERE conversation_id = v_conv_a1_id;
    IF v_count <> 0 THEN
      RAISE EXCEPTION 'TEST 6j FAILED: Non-participant % read % expired chat messages!', v_uid, v_count;
    END IF;
    SELECT count(*) INTO v_count FROM public.chat_conversations WHERE id = v_conv_a1_id;
    IF v_count <> 0 THEN
      RAISE EXCEPTION 'TEST 6k FAILED: Non-participant % read chat_conversations row!', v_uid;
    END IF;
  END LOOP;

  RAISE NOTICE 'TEST 6 PASSED: 7-day consultation window & strict participant-only chat history verified';

  -- ---------------------------------------------------------------------------
  -- TEST 7: ORG-WIDE DOCTOR CLINICAL READ (D-17) & CROSS-ORG WRITE BLOCK
  -- ---------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org_a_doc1::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_org_a_doc1::text, true);

  v_rec_a1_id := public.add_medical_record(v_org_a_id, v_pet_a1_id, v_cons_a1.id, 'clinical_note'::public.medical_record_type_enum, 'Healthy', 'Normal exam');
  v_rx_a1_id := public.issue_prescription(
    v_org_a_id, v_pet_a1_id, v_cons_a1.id, NULL, 'Vitamin deficiency', 'Once daily', CURRENT_DATE + 7,
    '[{"medicine_name":"PetVit","dosage":"1 tab","frequency":"OD","duration":"7 days"}]'::jsonb
  );
  PERFORM public.record_vaccination(v_org_a_id, v_pet_a1_id, 'Rabies', CURRENT_DATE, CURRENT_DATE + 365, 'BATCH-1', 'OK');

  -- Peer Doctor 2 in SAME Org A (not assigned to v_cons_a1) CAN read Org A clinical records
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org_a_doc2::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_org_a_doc2::text, true);

  SELECT count(*) INTO v_count FROM public.medical_records WHERE id = v_rec_a1_id;
  IF v_count <> 1 THEN RAISE EXCEPTION 'TEST 7a FAILED: Org A peer doctor could not read Org A medical_record!'; END IF;

  SELECT count(*) INTO v_count FROM public.prescriptions WHERE id = v_rx_a1_id;
  IF v_count <> 1 THEN RAISE EXCEPTION 'TEST 7b FAILED: Org A peer doctor could not read Org A prescription!'; END IF;

  SELECT count(*) INTO v_count FROM public.vaccinations WHERE pet_id = v_pet_a1_id;
  IF v_count <> 1 THEN RAISE EXCEPTION 'TEST 7c FAILED: Org A peer doctor could not read Org A vaccination!'; END IF;

  -- Org A doctor CANNOT write medical record for Org B pet (42501)
  v_err_caught := false;
  BEGIN
    PERFORM public.add_medical_record(v_org_b_id, v_pet_b1_id, NULL, 'clinical_note'::public.medical_record_type_enum, 'Cross-org', 'Should fail');
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_err_caught := true;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 7d FAILED: Org A doctor wrote medical record in Org B!';
  END IF;

  -- Org B doctor sees ZERO Org A clinical records, pets, or consultations
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org_b_doc1::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_org_b_doc1::text, true);

  SELECT (
    (SELECT count(*) FROM public.pets WHERE organization_id = v_org_a_id)
    + (SELECT count(*) FROM public.medical_records WHERE organization_id = v_org_a_id)
    + (SELECT count(*) FROM public.prescriptions WHERE organization_id = v_org_a_id)
    + (SELECT count(*) FROM public.vaccinations WHERE organization_id = v_org_a_id)
    + (SELECT count(*) FROM public.consultations WHERE organization_id = v_org_a_id)
  ) INTO v_count;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST 7e FAILED: Org B doctor read % Org A rows!', v_count;
  END IF;

  RAISE NOTICE 'TEST 7 PASSED: Org-wide doctor clinical read & strict cross-org isolation verified';

  -- ---------------------------------------------------------------------------
  -- TEST 8: PLATFORM OWNER ZERO CLINICAL ACCESS BOUNDARY
  -- ---------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_platform_admin::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_platform_admin::text, true);

  SELECT (
    (SELECT count(*) FROM public.pets WHERE organization_id IN (v_org_a_id, v_org_b_id))
    + (SELECT count(*) FROM public.appointments WHERE organization_id IN (v_org_a_id, v_org_b_id))
    + (SELECT count(*) FROM public.consultations WHERE organization_id IN (v_org_a_id, v_org_b_id))
    + (SELECT count(*) FROM public.chat_messages WHERE organization_id IN (v_org_a_id, v_org_b_id))
    + (SELECT count(*) FROM public.medical_records WHERE organization_id IN (v_org_a_id, v_org_b_id))
    + (SELECT count(*) FROM public.prescriptions WHERE organization_id IN (v_org_a_id, v_org_b_id))
    + (SELECT count(*) FROM public.vaccinations WHERE organization_id IN (v_org_a_id, v_org_b_id))
  ) INTO v_count;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST 8 FAILED: Platform Owner accessed % clinical rows!', v_count;
  END IF;
  RAISE NOTICE 'TEST 8 PASSED: Platform Owner has zero clinical data access';

  -- ---------------------------------------------------------------------------
  -- TEST 9: SUSPENDED ORGANIZATION LOCKDOWN & REACTIVATION
  -- ---------------------------------------------------------------------------
  PERFORM public.suspend_organization(v_org_a_id, 'Compliance review');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org_a_doc1::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_org_a_doc1::text, true);
  SELECT count(*) INTO v_count FROM public.medical_records WHERE organization_id = v_org_a_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST 9a FAILED: Suspended organization member still read clinical records!';
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_platform_admin::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_platform_admin::text, true);
  PERFORM public.reactivate_organization(v_org_a_id);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org_a_doc1::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_org_a_doc1::text, true);
  SELECT count(*) INTO v_count FROM public.medical_records WHERE organization_id = v_org_a_id;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST 9b FAILED: Reactivated organization access was not restored!';
  END IF;
  RAISE NOTICE 'TEST 9 PASSED: Organization suspension lockdown & reactivation verified';

  -- ---------------------------------------------------------------------------
  -- TEST 10: DIRECT TABLE WRITE REVOCATIONS (42501)
  -- ---------------------------------------------------------------------------
  v_err_caught := false;
  BEGIN
    INSERT INTO public.medical_records (organization_id, pet_id, doctor_id, record_type, diagnosis, notes)
    VALUES (v_org_a_id, v_pet_a1_id, v_doc_a1_prof_id, 'clinical_note', 'Bypass', 'Bypass');
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_err_caught := true;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 10a FAILED: Direct INSERT into medical_records succeeded!';
  END IF;

  v_err_caught := false;
  BEGIN
    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
    VALUES (v_org_a_doc1, 'FORGED', 'test', '1', 'Forged log');
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_err_caught := true;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 10b FAILED: Direct INSERT into audit_logs succeeded!';
  END IF;
  RAISE NOTICE 'TEST 10 PASSED: Direct table writes blocked (42501)';

  -- ---------------------------------------------------------------------------
  -- TEST 11: PET SOFT ARCHIVAL PRESERVES CLINICAL HISTORY (SEC-16)
  -- ---------------------------------------------------------------------------
  -- Cannot archive pet while open appointment (confirmed) exists
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org_a_client1::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_org_a_client1::text, true);
  v_err_caught := false;
  BEGIN
    PERFORM public.archive_pet(v_pet_a1_id, 'Testing lock');
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_err_caught := true;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 11a FAILED: Archived pet while open appointments existed!';
  END IF;

  -- Cancel open appointments so pet can be soft-archived cleanly while preserving clinical records
  PERFORM public.cancel_appointment(v_appt_a1_id, 'Test cleanup');
  PERFORM public.cancel_appointment(v_appt_a1_clash_id, 'Test cleanup');
  PERFORM public.cancel_appointment(v_appt_a2_id, 'Test cleanup');
  PERFORM public.archive_pet(v_pet_a1_id, 'Patient moved');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org_a_doc1::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_org_a_doc1::text, true);
  SELECT count(*) INTO v_count FROM public.medical_records WHERE pet_id = v_pet_a1_id;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST 11b FAILED: Archiving pet did not preserve medical_records!';
  END IF;
  RAISE NOTICE 'TEST 11 PASSED: Pet soft-archival lock & clinical history preservation verified';

  -- ---------------------------------------------------------------------------
  -- TEST 12: STAFF INVITATION TOKEN, DOCTOR SELF/GOVERNANCE & ATTACHMENT RPCs
  -- ---------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org_a_owner::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_org_a_owner::text, true);
  DECLARE
    v_inv_res JSONB;
    v_joined_org UUID;
    v_att_id UUID;
  BEGIN
    -- Invite rls-suite-9 (v_org_a_pending) as front_desk at Branch A2
    v_inv_res := public.invite_member(v_org_a_id, 'rls-suite-9@rls-fixture.invalid', ARRAY['front_desk'], ARRAY[v_branch_a2_id]);
    IF v_inv_res->>'token' IS NULL THEN
      RAISE EXCEPTION 'TEST 12a FAILED: invite_member returned null token!';
    END IF;

    -- Wrong user (client1) cannot accept invitation meant for rls-suite-9 (42501)
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org_a_client1::text, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_org_a_client1::text, true);
    v_err_caught := false;
    BEGIN
      PERFORM public.accept_invitation(v_inv_res->>'token');
    EXCEPTION WHEN SQLSTATE '42501' THEN
      v_err_caught := true;
    END;
    IF NOT v_err_caught THEN
      RAISE EXCEPTION 'TEST 12b FAILED: Wrong email accepted staff invitation!';
    END IF;

    -- Correct invitee accepts invitation
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org_a_pending::text, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_org_a_pending::text, true);
    v_joined_org := public.accept_invitation(v_inv_res->>'token');
    IF v_joined_org <> v_org_a_id THEN
      RAISE EXCEPTION 'TEST 12c FAILED: accept_invitation returned wrong org ID!';
    END IF;

    -- Doctor updates own clinical bio via RPC, and admin updates fee via governance RPC
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org_a_doc1::text, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_org_a_doc1::text, true);
    PERFORM public.update_doctor_self_profile(v_org_a_id, 'Updated bio', 'MVSc', 'Internal Medicine', 9, 'REG-99');

    -- Register clinical attachment and verify participant-only read on consultation attachment
    v_att_id := public.register_attachment(
      v_org_a_id, 'consultation', v_cons_a1.id,
      v_org_a_id::text || '/consultations/' || v_cons_a1.id::text || '/report.pdf',
      'application/pdf', 2048, 'report.pdf'
    );

    -- Org A Admin CANNOT read consultation attachment (D-16 participant privacy)
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org_a_admin::text, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_org_a_admin::text, true);
    SELECT count(*) INTO v_count FROM public.attachments WHERE id = v_att_id;
    IF v_count <> 0 THEN
      RAISE EXCEPTION 'TEST 12d FAILED: Org Admin read private consultation attachment!';
    END IF;

    PERFORM public.admin_update_doctor_governance(v_doc_a1_prof_id, true, 750.00, 'Dr. Alpha One');
  END;
  RAISE NOTICE 'TEST 12 PASSED: Staff invitation, doctor self/governance & attachment isolation verified';

  RAISE NOTICE '================================================================';
  RAISE NOTICE 'ALL MULTI-TENANT RLS & HARDENED RPC ASSERTIONS PASSED!';
  RAISE NOTICE '================================================================';
END $$;

ROLLBACK;
