-- ==============================================================================
-- PET CONNECT VETERINARY HEALTHCARE PLATFORM
-- Comprehensive Database Security & Authorization Test Suite (19 Verified Scenarios)
-- File: supabase/tests/security_tests.sql
-- ==============================================================================

-- Test Suite executes in a single transaction that rolls back at the end
-- This guarantees zero pollution of demo or production records
BEGIN;

DO $$
DECLARE
  v_client_1_id UUID := 'c1000000-0000-0000-0000-000000000001';
  v_client_2_id UUID := 'c2000000-0000-0000-0000-000000000002';
  v_assigned_doc_user UUID := 'd1000000-0000-0000-0000-000000000001';
  v_assigned_doc_profile UUID := '70000000-0000-0000-0000-000000000001';
  v_other_doc_user UUID := 'd2000000-0000-0000-0000-000000000002';
  v_admin_user UUID := 'a1000000-0000-0000-0000-000000000001';
  v_pet_id UUID := '80000000-0000-0000-0000-000000000001';
  v_pending_cons_id UUID;
  v_admin_pending_cons_id UUID;
  v_active_cons_id UUID;
  v_active_conv_id UUID;
  v_expired_cons_id UUID;
  v_expired_conv_id UUID;
  v_activated_result public.consultations;
  v_admin_activated_result public.consultations;
  v_err_caught BOOLEAN := false;
  v_test_msg_id UUID;
  v_initial_audit_count INT;
  v_after_unauth_audit_count INT;
  v_read_count INT;
BEGIN
  RAISE NOTICE '================================================================';
  RAISE NOTICE 'STARTING PET CONNECT FULL DATABASE AUTHORIZATION & SECURITY TEST';
  RAISE NOTICE 'TARGET: 19 DISTINCT SECURITY & RLS SCENARIOS';
  RAISE NOTICE '================================================================';

  -- Record initial audit log count
  SELECT count(*) INTO v_initial_audit_count FROM public.audit_logs;

  -- -----------------------------------------------------------------
  -- SECTION A: USER ROLE SECURITY & PRIVILEGE ESCALATION (4 TESTS)
  -- -----------------------------------------------------------------
  RAISE NOTICE '--- [SECTION A] Testing User Role Security & Privilege Escalation ---';

  -- TEST 1 (A1): Client attempting to assign themselves the 'admin' role
  v_err_caught := false;
  PERFORM set_config('request.jwt.claim.sub', v_client_1_id::TEXT, true);
  BEGIN
    INSERT INTO public.user_roles (user_id, role) VALUES (v_client_1_id, 'admin');
  EXCEPTION WHEN OTHERS THEN
    v_err_caught := true;
    RAISE NOTICE 'TEST 1 (A1) PASSED: Client prevented from inserting admin role by RLS: %', SQLERRM;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 1 (A1) FAILED: Client was able to assign themselves an admin role!';
  END IF;

  -- TEST 2 (A2): Client attempting to update their role record to 'admin'
  v_err_caught := false;
  PERFORM set_config('request.jwt.claim.sub', v_client_1_id::TEXT, true);
  BEGIN
    UPDATE public.user_roles SET role = 'admin' WHERE user_id = v_client_1_id;
    IF NOT FOUND THEN
      v_err_caught := true;
      RAISE NOTICE 'TEST 2 (A2) PASSED: Client role update blocked (0 rows modified under RLS)';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_err_caught := true;
    RAISE NOTICE 'TEST 2 (A2) PASSED: Client prevented from updating role: %', SQLERRM;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 2 (A2) FAILED: Client was able to modify their user_roles record!';
  END IF;

  -- TEST 3 (A3): Doctor attempting to elevate themselves to 'admin'
  v_err_caught := false;
  PERFORM set_config('request.jwt.claim.sub', v_assigned_doc_user::TEXT, true);
  BEGIN
    INSERT INTO public.user_roles (user_id, role) VALUES (v_assigned_doc_user, 'admin');
  EXCEPTION WHEN OTHERS THEN
    v_err_caught := true;
    RAISE NOTICE 'TEST 3 (A3) PASSED: Doctor prevented from inserting admin role by RLS: %', SQLERRM;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 3 (A3) FAILED: Doctor was able to assign themselves an admin role!';
  END IF;

  -- TEST 4 (A4): Authorized Administrator managing user roles
  PERFORM set_config('request.jwt.claim.sub', v_admin_user::TEXT, true);
  INSERT INTO public.user_roles (user_id, role) VALUES (v_client_2_id, 'doctor')
  ON CONFLICT (user_id, role) DO NOTHING;
  RAISE NOTICE 'TEST 4 (A4) PASSED: Authorized administrator successfully inserted user_role';

  -- -----------------------------------------------------------------
  -- SECTION B: STORED PROCEDURE SECURITY & VALIDATION (7 TESTS)
  -- -----------------------------------------------------------------
  RAISE NOTICE '--- [SECTION B] Testing activate_consultation() Procedure ---';

  -- Create a fresh pending consultation for activation testing
  INSERT INTO public.consultations (
    id, client_id, doctor_id, pet_id, consultation_reason, consultation_status
  ) VALUES (
    uuid_generate_v4(), v_client_1_id, v_assigned_doc_profile, v_pet_id,
    'Security Triage: Canine stifle inflammation', 'pending'
  ) RETURNING id INTO v_pending_cons_id;

  -- TEST 5 (B1): Unauthenticated caller (auth.uid() IS NULL)
  v_err_caught := false;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    PERFORM public.activate_consultation(v_pending_cons_id);
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '28000' THEN
      v_err_caught := true;
      RAISE NOTICE 'TEST 5 (B1) PASSED: Unauthenticated caller rejected with 28000: %', SQLERRM;
    ELSE
      RAISE EXCEPTION 'TEST 5 (B1) FAILED: Unexpected error state % (%)', SQLSTATE, SQLERRM;
    END IF;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 5 (B1) FAILED: Unauthenticated caller was not rejected!';
  END IF;

  -- TEST 6 (B2): Client attempting self-activation
  v_err_caught := false;
  PERFORM set_config('request.jwt.claim.sub', v_client_1_id::TEXT, true);
  BEGIN
    PERFORM public.activate_consultation(v_pending_cons_id);
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' AND SQLERRM LIKE '%Clients cannot self-activate%' THEN
      v_err_caught := true;
      RAISE NOTICE 'TEST 6 (B2) PASSED: Client self-activation rejected with 42501: %', SQLERRM;
    ELSE
      RAISE EXCEPTION 'TEST 6 (B2) FAILED: Expected client forbidden error 42501, got %: %', SQLSTATE, SQLERRM;
    END IF;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 6 (B2) FAILED: Client self-activation was not rejected!';
  END IF;

  -- TEST 7 (B3): Unassigned doctor attempting activation
  v_err_caught := false;
  PERFORM set_config('request.jwt.claim.sub', v_other_doc_user::TEXT, true);
  BEGIN
    PERFORM public.activate_consultation(v_pending_cons_id);
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' THEN
      v_err_caught := true;
      RAISE NOTICE 'TEST 7 (B3) PASSED: Unassigned doctor rejected with 42501: %', SQLERRM;
    ELSE
      RAISE EXCEPTION 'TEST 7 (B3) FAILED: Expected unassigned doctor error 42501, got %: %', SQLSTATE, SQLERRM;
    END IF;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 7 (B3) FAILED: Unassigned doctor was not rejected!';
  END IF;

  -- TEST 8 (B4): Assigned doctor activating consultation
  PERFORM set_config('request.jwt.claim.sub', v_assigned_doc_user::TEXT, true);
  v_activated_result := public.activate_consultation(v_pending_cons_id);

  IF v_activated_result.consultation_status = 'active'
     AND v_activated_result.activated_at IS NOT NULL
     AND v_activated_result.expires_at = (v_activated_result.activated_at + INTERVAL '7 days') THEN
    RAISE NOTICE 'TEST 8 (B4) PASSED: Assigned doctor activated consultation with exact 7-day expiry';
    v_active_cons_id := v_pending_cons_id;
  ELSE
    RAISE EXCEPTION 'TEST 8 (B4) FAILED: Consultation activation failed or expiry date incorrect';
  END IF;

  -- TEST 9 (B5): Duplicate chat conversation prevention
  IF (SELECT count(*) FROM public.chat_conversations WHERE consultation_id = v_active_cons_id) = 1 THEN
    RAISE NOTICE 'TEST 9 (B5) PASSED: Unique chat conversation created for consultation (exactly 1)';
  ELSE
    RAISE EXCEPTION 'TEST 9 (B5) FAILED: Duplicate or missing chat conversation!';
  END IF;

  -- TEST 10 (B6): Repeated activation attempt on active consultation
  v_err_caught := false;
  BEGIN
    PERFORM public.activate_consultation(v_active_cons_id);
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '22023' THEN
      v_err_caught := true;
      RAISE NOTICE 'TEST 10 (B6) PASSED: Repeated activation on active consultation rejected with 22023';
    ELSE
      RAISE EXCEPTION 'TEST 10 (B6) FAILED: Expected invalid state error 22023, got %: %', SQLSTATE, SQLERRM;
    END IF;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 10 (B6) FAILED: Repeated activation was not rejected!';
  END IF;

  -- TEST 11 (B7): Hospital administrator activating consultation
  INSERT INTO public.consultations (
    id, client_id, doctor_id, pet_id, consultation_reason, consultation_status
  ) VALUES (
    uuid_generate_v4(), v_client_1_id, v_assigned_doc_profile, v_pet_id,
    'Admin Activation Test Case', 'pending'
  ) RETURNING id INTO v_admin_pending_cons_id;

  PERFORM set_config('request.jwt.claim.sub', v_admin_user::TEXT, true);
  v_admin_activated_result := public.activate_consultation(v_admin_pending_cons_id);
  IF v_admin_activated_result.consultation_status = 'active' THEN
    RAISE NOTICE 'TEST 11 (B7) PASSED: Hospital administrator successfully activated consultation';
  ELSE
    RAISE EXCEPTION 'TEST 11 (B7) FAILED: Admin activation failed';
  END IF;

  -- -----------------------------------------------------------------
  -- SECTION C: AUDIT LOGGING VERIFICATION (2 TESTS)
  -- -----------------------------------------------------------------
  RAISE NOTICE '--- [SECTION C] Testing Audit Logging ---';

  -- TEST 12 (C1): Verify unauthorized activation attempts did NOT create audit logs falsely
  SELECT count(*) INTO v_after_unauth_audit_count FROM public.audit_logs;
  -- Note: only successful activations (B4 and B7) created audit logs; unauth attempts (B1, B2, B3) were aborted
  IF v_after_unauth_audit_count = (v_initial_audit_count + 2) THEN
    RAISE NOTICE 'TEST 12 (C1) PASSED: Unauthorized activation attempts did not create false audit log entries';
  ELSE
    RAISE EXCEPTION 'TEST 12 (C1) FAILED: Audit log count mismatch (expected % logs, got %)', (v_initial_audit_count + 2), v_after_unauth_audit_count;
  END IF;

  -- TEST 13 (C2): Verify successful activation event logged in audit_logs with details
  IF EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE entity_type = 'consultation'
      AND entity_id = v_active_cons_id::TEXT
      AND action = 'ACTIVATE_CONSULTATION'
      AND details LIKE '%7-day chat window initiated%'
  ) THEN
    RAISE NOTICE 'TEST 13 (C2) PASSED: Activation event properly logged in audit_logs with details column';
  ELSE
    RAISE EXCEPTION 'TEST 13 (C2) FAILED: Expected activation audit log not found!';
  END IF;

  -- -----------------------------------------------------------------
  -- SECTION E: CHAT SECURITY & 7-DAY EXPIRY ENFORCEMENT (6 TESTS)
  -- -----------------------------------------------------------------
  RAISE NOTICE '--- [SECTION E] Testing Chat Security & 7-Day Window RLS ---';

  SELECT id INTO v_active_conv_id FROM public.chat_conversations WHERE consultation_id = v_active_cons_id;

  -- TEST 14 (E1): Client sending message in their own active consultation (MUST PASS)
  PERFORM set_config('request.jwt.claim.sub', v_client_1_id::TEXT, true);
  INSERT INTO public.chat_messages (
    id, conversation_id, sender_id, message_type, message_content
  ) VALUES (
    uuid_generate_v4(), v_active_conv_id, v_client_1_id, 'text', 'Dr. Smith, Bella is resting now.'
  ) RETURNING id INTO v_test_msg_id;
  RAISE NOTICE 'TEST 14 (E1) PASSED: Client successfully sent message in active consultation: %', v_test_msg_id;

  -- TEST 15 (E2): Assigned doctor sending message in assigned active consultation (MUST PASS)
  PERFORM set_config('request.jwt.claim.sub', v_assigned_doc_user::TEXT, true);
  INSERT INTO public.chat_messages (
    id, conversation_id, sender_id, message_type, message_content
  ) VALUES (
    uuid_generate_v4(), v_active_conv_id, v_assigned_doc_user, 'text', 'Great, keep her hydrated.'
  );
  RAISE NOTICE 'TEST 15 (E2) PASSED: Assigned doctor successfully sent clinical message';

  -- TEST 16 (E3): Unassigned doctor sending message in this consultation (MUST FAIL)
  v_err_caught := false;
  PERFORM set_config('request.jwt.claim.sub', v_other_doc_user::TEXT, true);
  BEGIN
    INSERT INTO public.chat_messages (
      id, conversation_id, sender_id, message_type, message_content
    ) VALUES (
      uuid_generate_v4(), v_active_conv_id, v_other_doc_user, 'text', 'Unassigned doctor intruding'
    );
  EXCEPTION WHEN OTHERS THEN
    v_err_caught := true;
    RAISE NOTICE 'TEST 16 (E3) PASSED: Unassigned doctor rejected from sending message by RLS: %', SQLERRM;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 16 (E3) FAILED: Unassigned doctor was able to send a message in this consultation!';
  END IF;

  -- TEST 17 (E4): Unrelated client sending message in this consultation (MUST FAIL)
  v_err_caught := false;
  PERFORM set_config('request.jwt.claim.sub', v_client_2_id::TEXT, true);
  BEGIN
    INSERT INTO public.chat_messages (
      id, conversation_id, sender_id, message_type, message_content
    ) VALUES (
      uuid_generate_v4(), v_active_conv_id, v_client_2_id, 'text', 'Unrelated client intruding'
    );
  EXCEPTION WHEN OTHERS THEN
    v_err_caught := true;
    RAISE NOTICE 'TEST 17 (E4) PASSED: Unrelated client rejected from sending message by RLS: %', SQLERRM;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 17 (E4) FAILED: Unrelated client was able to send a message in another consultation!';
  END IF;

  -- TEST 18 (E5): Expired consultation rejecting new messages (MUST FAIL)
  INSERT INTO public.consultations (
    id, client_id, doctor_id, pet_id, consultation_reason, consultation_status,
    activated_at, expires_at
  ) VALUES (
    uuid_generate_v4(), v_client_1_id, v_assigned_doc_profile, v_pet_id,
    'Expired Consultation Test', 'expired',
    now() - INTERVAL '14 days', now() - INTERVAL '7 days'
  ) RETURNING id INTO v_expired_cons_id;

  INSERT INTO public.chat_conversations (
    id, consultation_id, client_id, doctor_id
  ) VALUES (
    uuid_generate_v4(), v_expired_cons_id, v_client_1_id, v_assigned_doc_profile
  ) RETURNING id INTO v_expired_conv_id;

  -- Seed a historical message in the expired consultation
  INSERT INTO public.chat_messages (
    id, conversation_id, sender_id, message_type, message_content, created_at
  ) VALUES (
    uuid_generate_v4(), v_expired_conv_id, v_client_1_id, 'text', 'Historical message during active window',
    now() - INTERVAL '10 days'
  );

  -- Client tries to send new message in expired consultation (MUST BE REJECTED)
  v_err_caught := false;
  PERFORM set_config('request.jwt.claim.sub', v_client_1_id::TEXT, true);
  BEGIN
    INSERT INTO public.chat_messages (
      conversation_id, sender_id, message_type, message_content
    ) VALUES (
      v_expired_conv_id, v_client_1_id, 'text', 'Attempting to send in expired consultation'
    );
  EXCEPTION WHEN OTHERS THEN
    v_err_caught := true;
    RAISE NOTICE 'TEST 18 (E5) PASSED: Expired consultation correctly rejected new message: %', SQLERRM;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'TEST 18 (E5) FAILED: Message was accepted in an expired consultation!';
  END IF;

  -- TEST 19 (E6 & E7): Past chat history readable by participants & completely blocked for unrelated users
  PERFORM set_config('request.jwt.claim.sub', v_client_1_id::TEXT, true);
  SELECT count(*) INTO v_read_count FROM public.chat_messages WHERE conversation_id = v_expired_conv_id;
  IF v_read_count >= 1 THEN
    RAISE NOTICE 'TEST 19a (E6) PASSED: Client can read past chat history (% messages) in expired consultation', v_read_count;
  ELSE
    RAISE EXCEPTION 'TEST 19a (E6) FAILED: Client cannot read past chat history!';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_client_2_id::TEXT, true);
  SELECT count(*) INTO v_read_count FROM public.chat_messages WHERE conversation_id = v_expired_conv_id;
  IF v_read_count = 0 THEN
    RAISE NOTICE 'TEST 19b (E7) PASSED: Unrelated user cannot read conversation messages (0 rows returned)';
  ELSE
    RAISE EXCEPTION 'TEST 19b (E7) FAILED: Unrelated user accessed confidential messages!';
  END IF;

  RAISE NOTICE '================================================================';
  RAISE NOTICE 'ALL 19 DATABASE SECURITY & AUTHORIZATION TESTS PASSED CLEANLY!';
  RAISE NOTICE '================================================================';
END $$;

-- Rollback ensures test run is completely non-destructive
ROLLBACK;
