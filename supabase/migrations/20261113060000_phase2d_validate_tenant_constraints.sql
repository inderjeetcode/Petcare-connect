-- ==============================================================================
-- PET CONNECT VETERINARY HEALTHCARE PLATFORM
-- Migration 6 (Phase 2d Validate): Composite Tenant FKs & Multi-Tenant Uniqueness
-- File: supabase/migrations/20261113060000_phase2d_validate_tenant_constraints.sql
-- ==============================================================================
-- INTEGRITY GUARANTEE:
-- 1. Replaces global doctor_profiles UNIQUE(user_id) with UNIQUE(organization_id, user_id)
--    so one user identity can practice across multiple clinics.
-- 2. Adds composite tenant foreign keys (parent_id, organization_id) using
--    NOT VALID + VALIDATE CONSTRAINT to prevent cross-tenant linking even by
--    privileged code, while allowing NULL branch_id (MATCH SIMPLE) on legacy
--    consultations/prescriptions until verified branch source mapping arrives.
-- ==============================================================================

-- 1. Swap global doctor_profiles UNIQUE(user_id) -> UNIQUE(organization_id, user_id)
DO $$
DECLARE
  v_uq_name TEXT;
BEGIN
  SELECT c.conname INTO v_uq_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'doctor_profiles'
    AND c.contype = 'u'
    AND array_length(c.conkey, 1) = 1
    AND EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = t.oid AND a.attnum = c.conkey[1] AND a.attname = 'user_id'
    );

  IF v_uq_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.doctor_profiles DROP CONSTRAINT %I', v_uq_name);
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE public.doctor_profiles
    ADD CONSTRAINT doctor_profiles_org_user_uq UNIQUE (organization_id, user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Add Composite Tenant Foreign Keys (NOT VALID -> VALIDATE CONSTRAINT)
-- Consultations: cannot point to pet, clinic_client, doctor, branch, or appointment of another org
DO $$ BEGIN
  ALTER TABLE public.consultations
    ADD CONSTRAINT consultations_pet_org_fk
    FOREIGN KEY (pet_id, organization_id) REFERENCES public.pets(id, organization_id) ON DELETE RESTRICT NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.consultations
    ADD CONSTRAINT consultations_doctor_org_fk
    FOREIGN KEY (doctor_id, organization_id) REFERENCES public.doctor_profiles(id, organization_id) ON DELETE RESTRICT NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.consultations
    ADD CONSTRAINT consultations_client_org_fk
    FOREIGN KEY (clinic_client_id, organization_id) REFERENCES public.clinic_clients(id, organization_id) ON DELETE RESTRICT NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- MATCH SIMPLE allows legacy branch_id = NULL while rejecting any non-null branch_id from another org!
DO $$ BEGIN
  ALTER TABLE public.consultations
    ADD CONSTRAINT consultations_branch_org_fk
    FOREIGN KEY (branch_id, organization_id) REFERENCES public.branches(id, organization_id) ON DELETE RESTRICT NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.consultations
    ADD CONSTRAINT consultations_appointment_org_fk
    FOREIGN KEY (appointment_id, organization_id) REFERENCES public.appointments(id, organization_id) ON DELETE RESTRICT NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Consultation payments & chats
DO $$ BEGIN
  ALTER TABLE public.consultation_payments
    ADD CONSTRAINT payments_consultation_org_fk
    FOREIGN KEY (consultation_id, organization_id) REFERENCES public.consultations(id, organization_id) ON DELETE RESTRICT NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.chat_conversations
    ADD CONSTRAINT chat_conv_consultation_org_fk
    FOREIGN KEY (consultation_id, organization_id) REFERENCES public.consultations(id, organization_id) ON DELETE RESTRICT NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.chat_conversations
    ADD CONSTRAINT chat_conv_doctor_org_fk
    FOREIGN KEY (doctor_id, organization_id) REFERENCES public.doctor_profiles(id, organization_id) ON DELETE RESTRICT NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.chat_messages
    ADD CONSTRAINT chat_msg_conv_org_fk
    FOREIGN KEY (conversation_id, organization_id) REFERENCES public.chat_conversations(id, organization_id) ON DELETE RESTRICT NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Prescriptions & Items
DO $$ BEGIN
  ALTER TABLE public.prescriptions
    ADD CONSTRAINT prescriptions_pet_org_fk
    FOREIGN KEY (pet_id, organization_id) REFERENCES public.pets(id, organization_id) ON DELETE RESTRICT NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.prescriptions
    ADD CONSTRAINT prescriptions_doctor_org_fk
    FOREIGN KEY (doctor_id, organization_id) REFERENCES public.doctor_profiles(id, organization_id) ON DELETE RESTRICT NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.prescriptions
    ADD CONSTRAINT prescriptions_cons_org_fk
    FOREIGN KEY (consultation_id, organization_id) REFERENCES public.consultations(id, organization_id) ON DELETE RESTRICT NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.prescriptions
    ADD CONSTRAINT prescriptions_appt_org_fk
    FOREIGN KEY (appointment_id, organization_id) REFERENCES public.appointments(id, organization_id) ON DELETE RESTRICT NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.prescriptions
    ADD CONSTRAINT prescriptions_branch_org_fk
    FOREIGN KEY (branch_id, organization_id) REFERENCES public.branches(id, organization_id) ON DELETE RESTRICT NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.prescription_items
    ADD CONSTRAINT prescription_items_rx_org_fk
    FOREIGN KEY (prescription_id, organization_id) REFERENCES public.prescriptions(id, organization_id) ON DELETE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Medical Records, Vaccinations & Reviews
DO $$ BEGIN
  ALTER TABLE public.medical_records
    ADD CONSTRAINT medical_records_pet_org_fk
    FOREIGN KEY (pet_id, organization_id) REFERENCES public.pets(id, organization_id) ON DELETE RESTRICT NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.medical_records
    ADD CONSTRAINT medical_records_doctor_org_fk
    FOREIGN KEY (doctor_id, organization_id) REFERENCES public.doctor_profiles(id, organization_id) ON DELETE RESTRICT NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.medical_records
    ADD CONSTRAINT medical_records_cons_org_fk
    FOREIGN KEY (consultation_id, organization_id) REFERENCES public.consultations(id, organization_id) ON DELETE RESTRICT NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.medical_records
    ADD CONSTRAINT medical_records_amend_org_fk
    FOREIGN KEY (amended_from_id, organization_id) REFERENCES public.medical_records(id, organization_id) ON DELETE RESTRICT NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.vaccinations
    ADD CONSTRAINT vaccinations_pet_org_fk
    FOREIGN KEY (pet_id, organization_id) REFERENCES public.pets(id, organization_id) ON DELETE RESTRICT NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.vaccinations
    ADD CONSTRAINT vaccinations_doctor_org_fk
    FOREIGN KEY (doctor_profile_id, organization_id) REFERENCES public.doctor_profiles(id, organization_id) ON DELETE RESTRICT NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.reviews
    ADD CONSTRAINT reviews_cons_org_fk
    FOREIGN KEY (consultation_id, organization_id) REFERENCES public.consultations(id, organization_id) ON DELETE RESTRICT NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Validate all composite tenant constraints (SHARE UPDATE EXCLUSIVE lock)
ALTER TABLE public.consultations VALIDATE CONSTRAINT consultations_pet_org_fk;
ALTER TABLE public.consultations VALIDATE CONSTRAINT consultations_doctor_org_fk;
ALTER TABLE public.consultations VALIDATE CONSTRAINT consultations_client_org_fk;
ALTER TABLE public.consultations VALIDATE CONSTRAINT consultations_branch_org_fk;
ALTER TABLE public.consultations VALIDATE CONSTRAINT consultations_appointment_org_fk;
ALTER TABLE public.consultation_payments VALIDATE CONSTRAINT payments_consultation_org_fk;
ALTER TABLE public.chat_conversations VALIDATE CONSTRAINT chat_conv_consultation_org_fk;
ALTER TABLE public.chat_conversations VALIDATE CONSTRAINT chat_conv_doctor_org_fk;
ALTER TABLE public.chat_messages VALIDATE CONSTRAINT chat_msg_conv_org_fk;
ALTER TABLE public.prescriptions VALIDATE CONSTRAINT prescriptions_pet_org_fk;
ALTER TABLE public.prescriptions VALIDATE CONSTRAINT prescriptions_doctor_org_fk;
ALTER TABLE public.prescriptions VALIDATE CONSTRAINT prescriptions_cons_org_fk;
ALTER TABLE public.prescriptions VALIDATE CONSTRAINT prescriptions_appt_org_fk;
ALTER TABLE public.prescriptions VALIDATE CONSTRAINT prescriptions_branch_org_fk;
ALTER TABLE public.prescription_items VALIDATE CONSTRAINT prescription_items_rx_org_fk;
ALTER TABLE public.medical_records VALIDATE CONSTRAINT medical_records_pet_org_fk;
ALTER TABLE public.medical_records VALIDATE CONSTRAINT medical_records_doctor_org_fk;
ALTER TABLE public.medical_records VALIDATE CONSTRAINT medical_records_cons_org_fk;
ALTER TABLE public.medical_records VALIDATE CONSTRAINT medical_records_amend_org_fk;
ALTER TABLE public.vaccinations VALIDATE CONSTRAINT vaccinations_pet_org_fk;
ALTER TABLE public.vaccinations VALIDATE CONSTRAINT vaccinations_doctor_org_fk;
ALTER TABLE public.reviews VALIDATE CONSTRAINT reviews_cons_org_fk;
