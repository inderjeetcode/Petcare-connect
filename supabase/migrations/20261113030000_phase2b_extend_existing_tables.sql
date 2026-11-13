-- ==============================================================================
-- PET CONNECT VETERINARY HEALTHCARE PLATFORM
-- Migration 3 (Phase 2b Expand Part 2): Extend Existing 16 Tables Non-Destructively
-- File: supabase/migrations/20261113030000_phase2b_extend_existing_tables.sql
-- ==============================================================================
-- PRESERVATION GUARANTEE:
-- - Zero existing tables dropped or recreated.
-- - Zero existing columns dropped in Phase 2 (all additive / compatible).
-- - Adds organization_id, branch_id, audit/provenance columns, composite
--   UNIQUE(id, organization_id) parent keys, and multi-tenant indexes.
-- ==============================================================================

-- 1. PETS (Extend with organization_id + composite parent uniqueness)
ALTER TABLE public.pets
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE RESTRICT;

DO $$ BEGIN
  ALTER TABLE public.pets ADD CONSTRAINT pets_id_org_uq UNIQUE (id, organization_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Now attach pending composite FKs from Phase 2b Part 1 referencing pets(id, organization_id)
DO $$ BEGIN
  ALTER TABLE public.pet_guardians
    ADD CONSTRAINT pet_guardians_pet_fk
    FOREIGN KEY (pet_id, organization_id)
    REFERENCES public.pets(id, organization_id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.appointments
    ADD CONSTRAINT appointments_pet_fk
    FOREIGN KEY (pet_id, organization_id)
    REFERENCES public.pets(id, organization_id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. DOCTOR_PROFILES (Extend with organization_id, registration_number, display_name)
ALTER TABLE public.doctor_profiles
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS registration_number VARCHAR(100),
  ADD COLUMN IF NOT EXISTS display_name VARCHAR(150);

DO $$ BEGIN
  ALTER TABLE public.doctor_profiles ADD CONSTRAINT doctor_profiles_id_org_uq UNIQUE (id, organization_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP TRIGGER IF EXISTS doctor_profiles_touch_updated_at ON public.doctor_profiles;
CREATE TRIGGER doctor_profiles_touch_updated_at
  BEFORE UPDATE ON public.doctor_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_doctor_profiles_guard_governance();

-- Attach composite FKs referencing doctor_profiles(id, organization_id)
DO $$ BEGIN
  ALTER TABLE public.doctor_branch_assignments
    ADD CONSTRAINT doctor_branch_assignments_doctor_fk
    FOREIGN KEY (doctor_profile_id, organization_id)
    REFERENCES public.doctor_profiles(id, organization_id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.doctor_schedules
    ADD CONSTRAINT doctor_schedules_doctor_fk
    FOREIGN KEY (doctor_profile_id, organization_id)
    REFERENCES public.doctor_profiles(id, organization_id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.doctor_schedule_exceptions
    ADD CONSTRAINT doctor_schedule_exceptions_doctor_fk
    FOREIGN KEY (doctor_profile_id, organization_id)
    REFERENCES public.doctor_profiles(id, organization_id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.appointments
    ADD CONSTRAINT appointments_doctor_fk
    FOREIGN KEY (doctor_profile_id, organization_id)
    REFERENCES public.doctor_profiles(id, organization_id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. DOCTOR_AVAILABILITY (Retained read-only for legacy transition; superseded by doctor_schedules)
ALTER TABLE public.doctor_availability
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS branch_id UUID;

-- 4. CONSULTATIONS (Extend with organization_id, branch_id, clinic_client_id, appointment_id, actors)
ALTER TABLE public.consultations
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS branch_id UUID,
  ADD COLUMN IF NOT EXISTS clinic_client_id UUID,
  ADD COLUMN IF NOT EXISTS appointment_id UUID,
  ADD COLUMN IF NOT EXISTS activated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejected_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS completed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_legacy_unmapped_branch BOOLEAN NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE public.consultations ADD CONSTRAINT consultations_id_org_uq UNIQUE (id, organization_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_consultations_appointment_active
  ON public.consultations(appointment_id)
  WHERE appointment_id IS NOT NULL AND consultation_status <> 'rejected';

-- 5. CONSULTATION_PAYMENTS (Extend with organization_id; switch FK CASCADE -> RESTRICT for ledger safety)
ALTER TABLE public.consultation_payments
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE RESTRICT;

DO $$
DECLARE
  v_fk_name TEXT;
BEGIN
  SELECT c.conname INTO v_fk_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'consultation_payments'
    AND c.contype = 'f'
    AND c.confdeltype = 'c';

  IF v_fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.consultation_payments DROP CONSTRAINT %I', v_fk_name);
    ALTER TABLE public.consultation_payments
      ADD CONSTRAINT consultation_payments_consultation_id_fkey
      FOREIGN KEY (consultation_id) REFERENCES public.consultations(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- 6. CHAT_CONVERSATIONS & CHAT_MESSAGES
ALTER TABLE public.chat_conversations
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE RESTRICT;

DO $$ BEGIN
  ALTER TABLE public.chat_conversations ADD CONSTRAINT chat_conversations_id_org_uq UNIQUE (id, organization_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE RESTRICT;

DO $$ BEGIN
  ALTER TABLE public.message_attachments
    ADD CONSTRAINT message_attachments_org_fk
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 7. PRESCRIPTIONS & PRESCRIPTION_ITEMS
ALTER TABLE public.prescriptions
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS branch_id UUID,
  ADD COLUMN IF NOT EXISTS appointment_id UUID,
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'void')),
  ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS void_reason TEXT,
  ADD COLUMN IF NOT EXISTS is_legacy_unmapped_branch BOOLEAN NOT NULL DEFAULT false;

-- Allow prescriptions for in-clinic appointments even without chat consultation
ALTER TABLE public.prescriptions ALTER COLUMN consultation_id DROP NOT NULL;

DO $$ BEGIN
  ALTER TABLE public.prescriptions
    ADD CONSTRAINT prescriptions_context_chk CHECK (consultation_id IS NOT NULL OR appointment_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.prescriptions ADD CONSTRAINT prescriptions_id_org_uq UNIQUE (id, organization_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.prescription_items
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE RESTRICT;

-- 8. MEDICAL_RECORDS & VACCINATIONS
ALTER TABLE public.medical_records
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS amended_from_id UUID REFERENCES public.medical_records(id) ON DELETE RESTRICT;

DO $$ BEGIN
  ALTER TABLE public.medical_records ADD CONSTRAINT medical_records_id_org_uq UNIQUE (id, organization_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.vaccinations
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS doctor_profile_id UUID REFERENCES public.doctor_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS batch_number VARCHAR(100),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_backfilled BOOLEAN NOT NULL DEFAULT false;

-- Allow nullable next_due_date for single-dose/terminal vaccines (replacing legacy constraint safely)
ALTER TABLE public.vaccinations ALTER COLUMN next_due_date DROP NOT NULL;
ALTER TABLE public.vaccinations DROP CONSTRAINT IF EXISTS check_vaccine_dates;
ALTER TABLE public.vaccinations
  ADD CONSTRAINT check_vaccine_dates CHECK (next_due_date IS NULL OR next_due_date >= administered_date);

-- 9. NOTIFICATIONS (Extend with organization_id & multi-tenant notification types)
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TYPE public.notification_type_enum ADD VALUE IF NOT EXISTS 'appointment';
ALTER TYPE public.notification_type_enum ADD VALUE IF NOT EXISTS 'membership';
ALTER TYPE public.notification_type_enum ADD VALUE IF NOT EXISTS 'join_request';

-- 10. REVIEWS (Extend with organization_id, frozen in v1)
ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE RESTRICT;

-- 11. AUDIT_LOGS (Extend with structured multi-tenant provenance columns)
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS actor_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS before_json JSONB,
  ADD COLUMN IF NOT EXISTS after_json JSONB,
  ADD COLUMN IF NOT EXISTS request_id TEXT;

-- 12. Performance & Foreign-Key Indexes (Multi-Tenant + Missing Baseline FK Indexes)
CREATE INDEX IF NOT EXISTS idx_branches_org ON public.branches(organization_id, is_active);
CREATE INDEX IF NOT EXISTS idx_org_memberships_user_active ON public.organization_memberships(user_id, organization_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_org_memberships_org_status ON public.organization_memberships(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_membership_roles_org ON public.membership_roles(organization_id, role_id);
CREATE INDEX IF NOT EXISTS idx_clinic_clients_org_status ON public.clinic_clients(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_clinic_clients_user ON public.clinic_clients(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pet_guardians_org_pet ON public.pet_guardians(organization_id, pet_id);
CREATE INDEX IF NOT EXISTS idx_pet_guardians_org_client ON public.pet_guardians(organization_id, clinic_client_id);
CREATE INDEX IF NOT EXISTS idx_pets_org ON public.pets(organization_id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_doctor_profiles_org ON public.doctor_profiles(organization_id, is_active);
CREATE INDEX IF NOT EXISTS idx_doctor_branch_assign_org_branch ON public.doctor_branch_assignments(organization_id, branch_id, is_active);
CREATE INDEX IF NOT EXISTS idx_doctor_schedules_lookup ON public.doctor_schedules(organization_id, branch_id, doctor_profile_id, weekday) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_doctor_sched_exc_lookup ON public.doctor_schedule_exceptions(organization_id, doctor_profile_id, start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_doctor_availability_doctor ON public.doctor_availability(doctor_id);
CREATE INDEX IF NOT EXISTS idx_appointments_org_status ON public.appointments(organization_id, status, requested_start);
CREATE INDEX IF NOT EXISTS idx_appointments_org_branch ON public.appointments(organization_id, branch_id, status);
CREATE INDEX IF NOT EXISTS idx_appointments_org_client ON public.appointments(organization_id, clinic_client_id);
CREATE INDEX IF NOT EXISTS idx_appt_history_appt ON public.appointment_status_history(appointment_id, changed_at);
CREATE INDEX IF NOT EXISTS idx_consultations_org_status ON public.consultations(organization_id, consultation_status);
CREATE INDEX IF NOT EXISTS idx_consultations_org_doctor ON public.consultations(organization_id, doctor_id);
CREATE INDEX IF NOT EXISTS idx_consultations_org_branch ON public.consultations(organization_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_consultations_appointment ON public.consultations(appointment_id) WHERE appointment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_consultation_payments_cons ON public.consultation_payments(consultation_id);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_org ON public.chat_conversations(organization_id, client_id, doctor_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conv_created ON public.chat_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender ON public.chat_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_org_pet ON public.prescriptions(organization_id, pet_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_doctor ON public.prescriptions(doctor_id);
CREATE INDEX IF NOT EXISTS idx_medical_records_org_pet ON public.medical_records(organization_id, pet_id);
CREATE INDEX IF NOT EXISTS idx_medical_records_doctor ON public.medical_records(doctor_id);
CREATE INDEX IF NOT EXISTS idx_medical_records_consultation ON public.medical_records(consultation_id);
CREATE INDEX IF NOT EXISTS idx_vaccinations_org_pet ON public.vaccinations(organization_id, pet_id);
CREATE INDEX IF NOT EXISTS idx_reviews_doctor ON public.reviews(doctor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_org_created ON public.audit_logs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON public.audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_attachments_org_entity ON public.attachments(organization_id, entity_type, entity_id);
