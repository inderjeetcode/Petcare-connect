-- ==============================================================================
-- PET CONNECT VETERINARY HEALTHCARE PLATFORM
-- Migration 1 (Phase 2a): Security Hardening on Existing 16-Table Baseline
-- File: supabase/migrations/20261113010000_phase2a_security_hardening.sql
-- ==============================================================================
-- RESOLVES:
-- - SEC-11: Drops dangerous cleanup_test_records(UUID[]) RPC
-- - SEC-03: Adds consultations_guard_window immutability trigger & revokes direct
--           UPDATE on consultations from authenticated/anon
-- - SEC-04: Revokes direct INSERT on consultations from authenticated/anon
-- - SEC-06/SEC-21: Revokes direct clinical/chat/audit table writes
-- - SEC-09: Prevents direct email mutation in profiles & adds updated_at triggers
-- - SEC-10: Blocks non-privileged doctor changes to is_active / consultation_fee
-- - SEC-16: Replaces ON DELETE CASCADE on medical_records.pet_id & vaccinations.pet_id
--           with ON DELETE RESTRICT; adds pets.archived_at soft-archival column
-- - SEC-20: Replaces handle_new_user() to create profile ONLY (no global client role)
-- ==============================================================================

-- 1. SEC-11: Remove destructive test cleanup RPC if present in DB
DROP FUNCTION IF EXISTS public.cleanup_test_records(UUID[]);

-- 2. Common updated_at maintenance trigger function
CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := timezone('utc'::text, now());
  RETURN NEW;
END;
$$;

-- 3. SEC-09: Guard profiles against email squatting / direct email edits by end users
CREATE OR REPLACE FUNCTION public.tg_profiles_guard_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Disallow PK change
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Forbidden: profiles.id is immutable' USING ERRCODE = '42501';
  END IF;

  -- Non-service API callers cannot mutate profiles.email directly (synced from auth.users)
  IF current_user IN ('authenticated', 'anon') AND NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'Forbidden: profiles.email cannot be edited directly' USING ERRCODE = '42501';
  END IF;

  NEW.updated_at := timezone('utc'::text, now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_identity ON public.profiles;
CREATE TRIGGER profiles_guard_identity
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_profiles_guard_identity();

-- 4. SEC-03 Defense-in-Depth: Immutable 7-day consultation activation window trigger
CREATE OR REPLACE FUNCTION public.tg_consultations_guard_window()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- Once activated_at or expires_at is stamped, neither timestamp may ever be altered
  IF OLD.activated_at IS NOT NULL AND NEW.activated_at IS DISTINCT FROM OLD.activated_at THEN
    RAISE EXCEPTION 'Forbidden: consultations.activated_at is immutable once set' USING ERRCODE = '42501';
  END IF;

  IF OLD.expires_at IS NOT NULL AND NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'Forbidden: consultations.expires_at is immutable once set' USING ERRCODE = '42501';
  END IF;

  -- Enforce 7-day invariant whenever activated_at is present
  IF NEW.activated_at IS NOT NULL AND NEW.expires_at IS DISTINCT FROM (NEW.activated_at + INTERVAL '7 days') THEN
    RAISE EXCEPTION 'Invalid State: expires_at must equal activated_at + 7 days' USING ERRCODE = '22023';
  END IF;

  -- Block backward transition from terminal states back to pending or active
  IF OLD.consultation_status IN ('completed', 'expired', 'rejected')
     AND NEW.consultation_status IN ('pending', 'active') THEN
    RAISE EXCEPTION 'Invalid State Transition: Cannot reopen terminal consultation from % to %',
      OLD.consultation_status, NEW.consultation_status
      USING ERRCODE = '22023';
  END IF;

  NEW.updated_at := timezone('utc'::text, now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS consultations_guard_window ON public.consultations;
CREATE TRIGGER consultations_guard_window
  BEFORE UPDATE ON public.consultations
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_consultations_guard_window();

-- 5. SEC-10: Block doctors from directly mutating governance fields (is_active, consultation_fee)
CREATE OR REPLACE FUNCTION public.tg_doctor_profiles_guard_governance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Forbidden: doctor_profiles.user_id is immutable' USING ERRCODE = '42501';
  END IF;

  -- Note: Direct table UPDATE on doctor_profiles is also revoked from authenticated below;
  -- this trigger provides defense-in-depth if any legacy policy or session updates the table directly.
  IF current_user IN ('authenticated', 'anon') THEN
    IF NEW.is_active IS DISTINCT FROM OLD.is_active OR NEW.consultation_fee IS DISTINCT FROM OLD.consultation_fee THEN
      RAISE EXCEPTION 'Forbidden: Governance fields (is_active, consultation_fee) require authorized admin RPC'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  NEW.updated_at := timezone('utc'::text, now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS doctor_profiles_guard_governance ON public.doctor_profiles;
CREATE TRIGGER doctor_profiles_guard_governance
  BEFORE UPDATE ON public.doctor_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_doctor_profiles_guard_governance();

-- 6. SEC-16: Prevent cascading destruction of clinical history when pets are deleted
ALTER TABLE public.pets
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

DROP TRIGGER IF EXISTS pets_touch_updated_at ON public.pets;
CREATE TRIGGER pets_touch_updated_at
  BEFORE UPDATE ON public.pets
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_touch_updated_at();

-- Convert medical_records.pet_id FK to ON DELETE RESTRICT (discovering constraint dynamically if renamed)
DO $$
DECLARE
  v_fk_name TEXT;
BEGIN
  SELECT c.conname INTO v_fk_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
  WHERE n.nspname = 'public'
    AND t.relname = 'medical_records'
    AND c.contype = 'f'
    AND a.attname = 'pet_id'
    AND c.confdeltype = 'c';

  IF v_fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.medical_records DROP CONSTRAINT %I', v_fk_name);
    ALTER TABLE public.medical_records
      ADD CONSTRAINT medical_records_pet_id_fkey
      FOREIGN KEY (pet_id) REFERENCES public.pets(id) ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
DECLARE
  v_fk_name TEXT;
BEGIN
  SELECT c.conname INTO v_fk_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
  WHERE n.nspname = 'public'
    AND t.relname = 'vaccinations'
    AND c.contype = 'f'
    AND a.attname = 'pet_id'
    AND c.confdeltype = 'c';

  IF v_fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.vaccinations DROP CONSTRAINT %I', v_fk_name);
    ALTER TABLE public.vaccinations
      ADD CONSTRAINT vaccinations_pet_id_fkey
      FOREIGN KEY (pet_id) REFERENCES public.pets(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- 7. SEC-20: Replace handle_new_user() — create global profile ONLY (never auto-assign clinic/client role)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, phone, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), ''), split_part(NEW.email, '@', 1)),
    NEW.email,
    NULLIF(trim(NEW.raw_user_meta_data->>'phone'), ''),
    NULLIF(trim(NEW.raw_user_meta_data->>'avatar_url'), '')
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    updated_at = timezone('utc'::text, now());

  RETURN NEW;
END;
$$;

-- Attach auth.users signup trigger safely if permitted (works in Supabase CLI / postgres owner; logs notice if restricted)
DO $$
BEGIN
  DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
  CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Skipped auth.users trigger attachment due to insufficient privileges; attach via Supabase Dashboard/postgres role.';
END $$;

-- 8. SEC-03 / SEC-04 / SEC-06 / SEC-12 / SEC-21:
-- Revoke direct INSERT/UPDATE/DELETE grants on workflow, clinical, and audit tables
-- so mutations MUST pass through hardened SECURITY DEFINER RPCs.
REVOKE INSERT, UPDATE, DELETE ON public.user_roles FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.pets FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.doctor_profiles FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.doctor_availability FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.consultations FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.consultation_payments FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.chat_conversations FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.chat_messages FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.prescriptions FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.prescription_items FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.medical_records FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.vaccinations FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.reviews FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.audit_logs FROM PUBLIC, anon, authenticated;
REVOKE INSERT, DELETE ON public.notifications FROM PUBLIC, anon, authenticated;
REVOKE INSERT, DELETE ON public.profiles FROM PUBLIC, anon, authenticated;
-- Keep UPDATE on profiles (guarded by tg_profiles_guard_identity + RLS) and notifications (is_read only via RPC/RLS)
REVOKE ALL ON TABLE public.profiles FROM anon;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
