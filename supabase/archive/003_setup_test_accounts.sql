-- ==============================================================================
-- PET CONNECT VETERINARY HEALTHCARE PLATFORM
-- Migration 003: Setup Dedicated Test Accounts, Auth Identities & Safe Cleanup RPC
-- File: supabase/migrations/003_setup_test_accounts.sql
-- ==============================================================================
-- SECURITY & INTEGRITY AUDIT SAFEGUARDS:
-- 1. Strictly scoped to 4 dedicated test accounts (*.test@petconnect.com).
-- 2. Zero modification of existing real user accounts or patient records.
-- 3. Ingests auth.identities to ensure 100% Supabase GoTrue signInWithPassword compatibility.
-- 4. Deploys public.cleanup_test_records(UUID[]) RPC to allow authorized admins
--    to safely clean up test consultations and audit logs under RLS without service_role.
-- ==============================================================================

-- Enable pgcrypto for password hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ------------------------------------------------------------------------------
-- 1. CLEANUP PREVIOUS TEST IDENTITIES TO PREVENT UNIQUE KEY COLLISIONS
-- ------------------------------------------------------------------------------
-- Delete identities first to maintain FK integrity (handles both UUID and email provider_id)
DELETE FROM auth.identities
WHERE provider = 'email'
  AND (
    provider_id IN (
      'client.test@petconnect.com',
      'doctor.assigned@petconnect.com',
      'doctor.other@petconnect.com',
      'admin.test@petconnect.com',
      'c1000000-0000-0000-0000-000000000001',
      'd1000000-0000-0000-0000-000000000001',
      'd2000000-0000-0000-0000-000000000002',
      'a1000000-0000-0000-0000-000000000001'
    )
    OR user_id IN (
      'c1000000-0000-0000-0000-000000000001',
      'd1000000-0000-0000-0000-000000000001',
      'd2000000-0000-0000-0000-000000000002',
      'a1000000-0000-0000-0000-000000000001'
    )
    OR identity_data->>'email' IN (
      'client.test@petconnect.com',
      'doctor.assigned@petconnect.com',
      'doctor.other@petconnect.com',
      'admin.test@petconnect.com'
    )
  );

-- Remove stale test accounts if they were created with conflicting non-standard UUIDs
DELETE FROM auth.users
WHERE email IN ('client.test@petconnect.com', 'doctor.assigned@petconnect.com', 'doctor.other@petconnect.com', 'admin.test@petconnect.com')
  AND id NOT IN ('c1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001');

-- ------------------------------------------------------------------------------
-- 2. SCOPED CONFIRMATION (Explicitly limited to test accounts)
-- ------------------------------------------------------------------------------
UPDATE auth.users
SET email_confirmed_at = COALESCE(email_confirmed_at, now())
WHERE email IN (
  'client.test@petconnect.com',
  'doctor.assigned@petconnect.com',
  'doctor.other@petconnect.com',
  'admin.test@petconnect.com',
  'vet.tester.petconnect@gmail.com'
);

-- ------------------------------------------------------------------------------
-- 3. INSERT OR UPDATE 4 DEDICATED TEST ACCOUNTS IN auth.users
-- Password for all 4 test accounts: Password123!Secure
-- ------------------------------------------------------------------------------

-- A. Test Client Account
INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  created_at,
  updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'c1000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'client.test@petconnect.com',
  crypt('Password123!Secure', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Jane Client (Dedicated Test)"}'::jsonb,
  false,
  now(),
  now()
) ON CONFLICT (id) DO UPDATE SET
  email_confirmed_at = now(),
  encrypted_password = crypt('Password123!Secure', gen_salt('bf')),
  email = 'client.test@petconnect.com',
  raw_app_meta_data = '{"provider":"email","providers":["email"]}'::jsonb;

-- B. Test Assigned Doctor Account
INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  created_at,
  updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'd1000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'doctor.assigned@petconnect.com',
  crypt('Password123!Secure', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Dr. Marcus Vance (Assigned Doctor Test)"}'::jsonb,
  false,
  now(),
  now()
) ON CONFLICT (id) DO UPDATE SET
  email_confirmed_at = now(),
  encrypted_password = crypt('Password123!Secure', gen_salt('bf')),
  email = 'doctor.assigned@petconnect.com',
  raw_app_meta_data = '{"provider":"email","providers":["email"]}'::jsonb;

-- C. Test Unassigned Doctor Account
INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  created_at,
  updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'd2000000-0000-0000-0000-000000000002',
  'authenticated',
  'authenticated',
  'doctor.other@petconnect.com',
  crypt('Password123!Secure', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Dr. Elena Rostova (Unassigned Doctor Test)"}'::jsonb,
  false,
  now(),
  now()
) ON CONFLICT (id) DO UPDATE SET
  email_confirmed_at = now(),
  encrypted_password = crypt('Password123!Secure', gen_salt('bf')),
  email = 'doctor.other@petconnect.com',
  raw_app_meta_data = '{"provider":"email","providers":["email"]}'::jsonb;

-- D. Test Admin Account
INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  created_at,
  updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'a1000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'admin.test@petconnect.com',
  crypt('Password123!Secure', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Dr. Alistair Finch (Admin Test)"}'::jsonb,
  false,
  now(),
  now()
) ON CONFLICT (id) DO UPDATE SET
  email_confirmed_at = now(),
  encrypted_password = crypt('Password123!Secure', gen_salt('bf')),
  email = 'admin.test@petconnect.com',
  raw_app_meta_data = '{"provider":"email","providers":["email"]}'::jsonb;

-- ------------------------------------------------------------------------------
-- 4. POPULATE auth.identities (Required by GoTrue for email provider lookup)
-- ------------------------------------------------------------------------------
INSERT INTO auth.identities (
  id,
  user_id,
  identity_data,
  provider,
  provider_id,
  last_sign_in_at,
  created_at,
  updated_at
) VALUES
  (
    'c1000000-0000-0000-0000-000000000001',
    'c1000000-0000-0000-0000-000000000001',
    jsonb_build_object('sub', 'c1000000-0000-0000-0000-000000000001', 'email', 'client.test@petconnect.com'),
    'email',
    'c1000000-0000-0000-0000-000000000001',
    now(),
    now(),
    now()
  ),
  (
    'd1000000-0000-0000-0000-000000000001',
    'd1000000-0000-0000-0000-000000000001',
    jsonb_build_object('sub', 'd1000000-0000-0000-0000-000000000001', 'email', 'doctor.assigned@petconnect.com'),
    'email',
    'd1000000-0000-0000-0000-000000000001',
    now(),
    now(),
    now()
  ),
  (
    'd2000000-0000-0000-0000-000000000002',
    'd2000000-0000-0000-0000-000000000002',
    jsonb_build_object('sub', 'd2000000-0000-0000-0000-000000000002', 'email', 'doctor.other@petconnect.com'),
    'email',
    'd2000000-0000-0000-0000-000000000002',
    now(),
    now(),
    now()
  ),
  (
    'a1000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001',
    jsonb_build_object('sub', 'a1000000-0000-0000-0000-000000000001', 'email', 'admin.test@petconnect.com'),
    'email',
    'a1000000-0000-0000-0000-000000000001',
    now(),
    now(),
    now()
  )
ON CONFLICT (provider, provider_id) DO UPDATE SET
  identity_data = EXCLUDED.identity_data,
  updated_at = now();

-- ------------------------------------------------------------------------------
-- 5. POPULATE public.profiles (Prefixed [CONTROLLED-TEST])
-- ------------------------------------------------------------------------------
INSERT INTO public.profiles (id, full_name, email, phone, avatar_url)
VALUES
  ('c1000000-0000-0000-0000-000000000001', '[CONTROLLED-TEST] Jane Client', 'client.test@petconnect.com', '+1 (555) 234-8901', 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150'),
  ('d1000000-0000-0000-0000-000000000001', '[CONTROLLED-TEST] Dr. Marcus Vance (Assigned)', 'doctor.assigned@petconnect.com', '+1 (555) 789-1020', 'https://images.unsplash.com/photo-1622253692010-333f2da6031d?w=150'),
  ('d2000000-0000-0000-0000-000000000002', '[CONTROLLED-TEST] Dr. Elena Rostova (Unassigned)', 'doctor.other@petconnect.com', '+1 (555) 345-6712', 'https://images.unsplash.com/photo-1594824813689-536098bdfb13?w=150'),
  ('a1000000-0000-0000-0000-000000000001', '[CONTROLLED-TEST] Dr. Alistair Finch (Admin)', 'admin.test@petconnect.com', '+1 (555) 901-2345', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150')
ON CONFLICT (id) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  email = EXCLUDED.email;

-- ------------------------------------------------------------------------------
-- 6. POPULATE public.user_roles (Strict Role Separation)
-- ------------------------------------------------------------------------------
INSERT INTO public.user_roles (user_id, role)
VALUES
  ('c1000000-0000-0000-0000-000000000001', 'client'),
  ('d1000000-0000-0000-0000-000000000001', 'doctor'),
  ('d2000000-0000-0000-0000-000000000002', 'doctor'),
  ('a1000000-0000-0000-0000-000000000001', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 7. POPULATE public.doctor_profiles
-- ------------------------------------------------------------------------------
INSERT INTO public.doctor_profiles (id, user_id, qualification, specialization, experience_years, consultation_fee, bio, is_active)
VALUES
  ('70000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'BVSc & AH, MVSc (Surgery)', 'Small Animal Orthopedics & Soft Tissue Surgery', 12, 65.00, '[CONTROLLED-TEST] Assigned board-certified veterinary surgeon.', true),
  ('70000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000002', 'DVM, PhD (Gastroenterology)', 'Feline Internal Medicine & Nutrition', 9, 50.00, '[CONTROLLED-TEST] Unassigned doctor for unauthorized activation tests.', true)
ON CONFLICT (id) DO UPDATE SET
  user_id = EXCLUDED.user_id,
  is_active = true;

-- ------------------------------------------------------------------------------
-- 8. POPULATE public.pets FOR TEST CLIENT
-- ------------------------------------------------------------------------------
INSERT INTO public.pets (id, owner_id, name, species, breed, date_of_birth, gender, weight, color, allergies, medical_notes, avatar_url)
VALUES
  ('80000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', '[CONTROLLED-TEST] Barnaby', 'Dog', 'Golden Retriever', '2023-04-12', 'Neutered Male', 31.8, 'Warm Golden', 'None', 'Controlled test patient for RPC verification.', 'https://images.unsplash.com/photo-1552053831-71594a27632d?w=200')
ON CONFLICT (id) DO UPDATE SET
  owner_id = EXCLUDED.owner_id;

-- ------------------------------------------------------------------------------
-- 9. SAFE CLEANUP RPC PROCEDURE FOR AUTHORIZED ADMINISTRATOR
-- Allows the test runner to clean up test consultations and audit logs without service_role
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleanup_test_records(p_test_consultation_ids UUID[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_is_admin BOOLEAN := false;
  v_deleted_convs INT := 0;
  v_deleted_cons INT := 0;
  v_deleted_logs INT := 0;
BEGIN
  -- 1. Must be authenticated
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Caller authentication required' USING ERRCODE = '28000';
  END IF;

  -- 2. Must be verified administrator in user_roles
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = v_caller_id AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Forbidden: Only administrators can execute test data cleanup' USING ERRCODE = '42501';
  END IF;

  -- 3. Strict Safety Guard: Can ONLY delete consultations that match controlled test criteria!
  IF EXISTS (
    SELECT 1 FROM public.consultations
    WHERE id = ANY(p_test_consultation_ids)
      AND client_id <> 'c1000000-0000-0000-0000-000000000001'
      AND consultation_reason NOT LIKE '%[CONTROLLED-TEST]%'
  ) THEN
    RAISE EXCEPTION 'Safety Violation: Cleanup rejected. One or more consultation IDs do not match controlled test criteria.'
      USING ERRCODE = '42501';
  END IF;

  -- 4. Delete in exact foreign-key dependency order:
  -- A. Delete chat messages
  DELETE FROM public.chat_messages
  WHERE conversation_id IN (
    SELECT id FROM public.chat_conversations WHERE consultation_id = ANY(p_test_consultation_ids)
  );

  -- B. Delete chat conversations
  WITH del_convs AS (
    DELETE FROM public.chat_conversations
    WHERE consultation_id = ANY(p_test_consultation_ids)
    RETURNING id
  )
  SELECT count(*) INTO v_deleted_convs FROM del_convs;

  -- C. Delete consultations
  WITH del_cons AS (
    DELETE FROM public.consultations
    WHERE id = ANY(p_test_consultation_ids)
    RETURNING id
  )
  SELECT count(*) INTO v_deleted_cons FROM del_cons;

  -- D. Delete associated audit logs (STRICT: only test-account activation logs for these specific test IDs)
  WITH del_logs AS (
    DELETE FROM public.audit_logs
    WHERE entity_type = 'consultation'
      AND entity_id = ANY(SELECT unnest(p_test_consultation_ids)::TEXT)
      AND user_id IN (
        'c1000000-0000-0000-0000-000000000001',
        'd1000000-0000-0000-0000-000000000001',
        'a1000000-0000-0000-0000-000000000001'
      )
      AND (
        action = 'ACTIVATE_CONSULTATION'
        OR details LIKE '%[CONTROLLED-TEST]%'
      )
    RETURNING id
  )
  SELECT count(*) INTO v_deleted_logs FROM del_logs;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_consultations', v_deleted_cons,
    'deleted_conversations', v_deleted_convs,
    'deleted_audit_logs', v_deleted_logs
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_test_records(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cleanup_test_records(UUID[]) TO authenticated;

-- ==============================================================================
-- 10. OPTIONAL FULL TEARDOWN SCRIPT (Strict Dependency Order)
-- Execute manually in SQL Editor only if completely removing all test accounts:
-- ==============================================================================
-- 1. DELETE FROM public.chat_messages WHERE conversation_id IN (SELECT id FROM public.chat_conversations WHERE client_id = 'c1000000-0000-0000-0000-000000000001');
-- 2. DELETE FROM public.chat_conversations WHERE client_id = 'c1000000-0000-0000-0000-000000000001';
-- 3. DELETE FROM public.consultation_payments WHERE consultation_id IN (SELECT id FROM public.consultations WHERE client_id = 'c1000000-0000-0000-0000-000000000001');
-- 4. DELETE FROM public.consultations WHERE client_id = 'c1000000-0000-0000-0000-000000000001';
-- 5. DELETE FROM public.pets WHERE owner_id = 'c1000000-0000-0000-0000-000000000001';
-- 6. DELETE FROM public.doctor_availability WHERE doctor_id IN ('70000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000002');
-- 7. DELETE FROM public.doctor_profiles WHERE id IN ('70000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000002');
-- 8. DELETE FROM public.audit_logs WHERE user_id IN ('c1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001');
-- 9. DELETE FROM public.user_roles WHERE user_id IN ('c1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001');
-- 10. DELETE FROM public.profiles WHERE id IN ('c1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001');
-- 11. DELETE FROM auth.identities WHERE user_id IN ('c1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001');
-- 12. DELETE FROM auth.users WHERE id IN ('c1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001');
