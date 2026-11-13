-- ==============================================================================
-- PET CONNECT VETERINARY HEALTHCARE PLATFORM
-- Database Architecture & Schema Definition (PostgreSQL / Supabase)
-- Migration: 001_initial_schema.sql
-- ==============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------------------------
-- 1. PROFILES
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(30),
    avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ------------------------------------------------------------------------------
-- 2. USER_ROLES
-- ------------------------------------------------------------------------------
CREATE TYPE user_role_enum AS ENUM ('client', 'doctor', 'admin');

CREATE TABLE IF NOT EXISTS public.user_roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role user_role_enum NOT NULL DEFAULT 'client',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT unique_user_role UNIQUE (user_id, role)
);

-- ------------------------------------------------------------------------------
-- 3. PETS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    species VARCHAR(50) NOT NULL,
    breed VARCHAR(100) NOT NULL,
    date_of_birth DATE,
    gender VARCHAR(20) NOT NULL,
    weight NUMERIC(5, 2) NOT NULL CHECK (weight > 0),
    color VARCHAR(100),
    avatar_url TEXT,
    allergies TEXT,
    medical_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ------------------------------------------------------------------------------
-- 4. DOCTOR_PROFILES
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.doctor_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
    qualification VARCHAR(255) NOT NULL,
    specialization VARCHAR(150) NOT NULL,
    experience_years INT NOT NULL CHECK (experience_years >= 0),
    consultation_fee NUMERIC(8, 2) NOT NULL DEFAULT 50.00 CHECK (consultation_fee >= 0),
    bio TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ------------------------------------------------------------------------------
-- 5. DOCTOR_AVAILABILITY
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.doctor_availability (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    doctor_id UUID NOT NULL REFERENCES public.doctor_profiles(id) ON DELETE CASCADE,
    day_of_week VARCHAR(15) NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_available BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT check_time_order CHECK (end_time > start_time)
);

-- ------------------------------------------------------------------------------
-- 6. CONSULTATIONS
-- ------------------------------------------------------------------------------
CREATE TYPE consultation_status_enum AS ENUM ('pending', 'active', 'completed', 'expired', 'rejected');

CREATE TABLE IF NOT EXISTS public.consultations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    doctor_id UUID NOT NULL REFERENCES public.doctor_profiles(id) ON DELETE RESTRICT,
    pet_id UUID NOT NULL REFERENCES public.pets(id) ON DELETE RESTRICT,
    consultation_reason TEXT NOT NULL,
    consultation_status consultation_status_enum NOT NULL DEFAULT 'pending',
    activated_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    rejection_reason TEXT,
    preferred_time VARCHAR(100),
    attachment_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    -- CRITICAL BUSINESS CONSTRAINT: Expiry must be precisely 7 days after activation
    CONSTRAINT check_seven_day_expiry CHECK (
        activated_at IS NULL OR expires_at = (activated_at + INTERVAL '7 days')
    )
);

-- ------------------------------------------------------------------------------
-- 7. CONSULTATION_PAYMENTS (Architecture Ready for Razorpay/Stripe)
-- ------------------------------------------------------------------------------
CREATE TYPE payment_status_enum AS ENUM ('pending', 'completed', 'failed', 'refunded');

CREATE TABLE IF NOT EXISTS public.consultation_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    consultation_id UUID NOT NULL REFERENCES public.consultations(id) ON DELETE CASCADE,
    amount NUMERIC(8, 2) NOT NULL CHECK (amount >= 0),
    payment_status payment_status_enum NOT NULL DEFAULT 'pending',
    gateway VARCHAR(50) NOT NULL DEFAULT 'razorpay',
    transaction_id VARCHAR(255),
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ------------------------------------------------------------------------------
-- 8. CHAT_CONVERSATIONS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    consultation_id UUID NOT NULL UNIQUE REFERENCES public.consultations(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    doctor_id UUID NOT NULL REFERENCES public.doctor_profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ------------------------------------------------------------------------------
-- 9. CHAT_MESSAGES
-- ------------------------------------------------------------------------------
CREATE TYPE message_type_enum AS ENUM ('text', 'image', 'file');

CREATE TABLE IF NOT EXISTS public.chat_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    message_type message_type_enum NOT NULL DEFAULT 'text',
    message_content TEXT NOT NULL,
    attachment_url TEXT,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ------------------------------------------------------------------------------
-- 10. PRESCRIPTIONS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.prescriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    consultation_id UUID NOT NULL REFERENCES public.consultations(id) ON DELETE RESTRICT,
    pet_id UUID NOT NULL REFERENCES public.pets(id) ON DELETE RESTRICT,
    doctor_id UUID NOT NULL REFERENCES public.doctor_profiles(id) ON DELETE RESTRICT,
    client_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    diagnosis TEXT NOT NULL,
    instructions TEXT,
    follow_up_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ------------------------------------------------------------------------------
-- 11. PRESCRIPTION_ITEMS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.prescription_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    prescription_id UUID NOT NULL REFERENCES public.prescriptions(id) ON DELETE CASCADE,
    medicine_name VARCHAR(150) NOT NULL,
    dosage VARCHAR(100) NOT NULL,
    frequency VARCHAR(100) NOT NULL,
    duration VARCHAR(50) NOT NULL,
    instructions TEXT
);

-- ------------------------------------------------------------------------------
-- 12. MEDICAL_RECORDS
-- ------------------------------------------------------------------------------
CREATE TYPE medical_record_type_enum AS ENUM ('clinical_note', 'lab_report', 'vaccination', 'surgery', 'discharge');

CREATE TABLE IF NOT EXISTS public.medical_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pet_id UUID NOT NULL REFERENCES public.pets(id) ON DELETE CASCADE,
    consultation_id UUID REFERENCES public.consultations(id) ON DELETE SET NULL,
    doctor_id UUID REFERENCES public.doctor_profiles(id) ON DELETE SET NULL,
    record_type medical_record_type_enum NOT NULL DEFAULT 'clinical_note',
    diagnosis VARCHAR(255) NOT NULL,
    notes TEXT NOT NULL,
    attachment_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ------------------------------------------------------------------------------
-- 13. VACCINATIONS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vaccinations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pet_id UUID NOT NULL REFERENCES public.pets(id) ON DELETE CASCADE,
    vaccine_name VARCHAR(150) NOT NULL,
    administered_date DATE NOT NULL,
    next_due_date DATE NOT NULL,
    notes TEXT,
    administered_by VARCHAR(150),
    CONSTRAINT check_vaccine_dates CHECK (next_due_date >= administered_date)
);

-- ------------------------------------------------------------------------------
-- 14. NOTIFICATIONS
-- ------------------------------------------------------------------------------
CREATE TYPE notification_type_enum AS ENUM ('consultation', 'message', 'prescription', 'system');

CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    title VARCHAR(150) NOT NULL,
    message TEXT NOT NULL,
    notification_type notification_type_enum NOT NULL DEFAULT 'system',
    is_read BOOLEAN NOT NULL DEFAULT false,
    link_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ------------------------------------------------------------------------------
-- 15. REVIEWS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    consultation_id UUID NOT NULL UNIQUE REFERENCES public.consultations(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    doctor_id UUID NOT NULL REFERENCES public.doctor_profiles(id) ON DELETE CASCADE,
    rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
    review_text TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ------------------------------------------------------------------------------
-- 16. AUDIT_LOGS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id VARCHAR(100) NOT NULL,
    details TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ==============================================================================
-- INDEXING STRATEGY
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_pets_owner_id ON public.pets(owner_id);
CREATE INDEX IF NOT EXISTS idx_consultations_client ON public.consultations(client_id);
CREATE INDEX IF NOT EXISTS idx_consultations_doctor ON public.consultations(doctor_id);
CREATE INDEX IF NOT EXISTS idx_consultations_pet ON public.consultations(pet_id);
CREATE INDEX IF NOT EXISTS idx_consultations_status ON public.consultations(consultation_status);
CREATE INDEX IF NOT EXISTS idx_consultations_expires_at ON public.consultations(expires_at);

CREATE INDEX IF NOT EXISTS idx_chat_messages_conv ON public.chat_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON public.chat_messages(created_at);

CREATE INDEX IF NOT EXISTS idx_prescriptions_consultation ON public.prescriptions(consultation_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_pet ON public.prescriptions(pet_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_client ON public.prescriptions(client_id);

CREATE INDEX IF NOT EXISTS idx_medical_records_pet ON public.medical_records(pet_id);
CREATE INDEX IF NOT EXISTS idx_vaccinations_pet ON public.vaccinations(pet_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON public.audit_logs(user_id);

-- ==============================================================================
-- CONSULTATION ACTIVATION PROCEDURE (SECURITY DEFINER HARDENED)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.activate_consultation(p_consultation_id UUID)
RETURNS public.consultations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_is_admin BOOLEAN := false;
  v_consultation public.consultations;
  v_activated_at TIMESTAMPTZ;
  v_expires_at TIMESTAMPTZ;
BEGIN
  -- 1. Authorization: Verify auth.uid() is not NULL
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Caller authentication required' USING ERRCODE = '28000';
  END IF;

  -- 2. Lock target consultation row for update (prevents concurrent race conditions)
  SELECT * INTO v_consultation
  FROM public.consultations
  WHERE id = p_consultation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Consultation % not found', p_consultation_id USING ERRCODE = 'P0002';
  END IF;

  -- 3. Verify state: Only pending consultations can be activated
  IF v_consultation.consultation_status <> 'pending' THEN
    RAISE EXCEPTION 'Invalid State: Consultation % is already in status %', p_consultation_id, v_consultation.consultation_status
      USING ERRCODE = '22023';
  END IF;

  -- 4. Authorization: Verify caller is an authorized admin or the assigned doctor
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_caller_id AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    -- Check if caller is the active assigned doctor for this consultation
    IF NOT EXISTS (
      SELECT 1 FROM public.doctor_profiles dp
      WHERE dp.id = v_consultation.doctor_id
        AND dp.user_id = v_caller_id
        AND dp.is_active = true
    ) THEN
      -- Disallow client self-activation explicitly
      IF v_consultation.client_id = v_caller_id THEN
        RAISE EXCEPTION 'Forbidden: Clients cannot self-activate consultations' USING ERRCODE = '42501';
      ELSE
        RAISE EXCEPTION 'Forbidden: Caller is not the assigned doctor or an authorized administrator' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  -- 5. Timestamps: Database-generated timestamptz without modifying timezone representation
  v_activated_at := now();
  v_expires_at := v_activated_at + INTERVAL '7 days';

  -- 6. Atomically update consultation status and exact 7-day window
  UPDATE public.consultations
  SET consultation_status = 'active',
      activated_at = v_activated_at,
      expires_at = v_expires_at,
      updated_at = v_activated_at
  WHERE id = p_consultation_id
  RETURNING * INTO v_consultation;

  -- 7. Create exactly one chat conversation (prevent duplicates)
  INSERT INTO public.chat_conversations (
    consultation_id,
    client_id,
    doctor_id,
    created_at
  )
  VALUES (
    v_consultation.id,
    v_consultation.client_id,
    v_consultation.doctor_id,
    v_activated_at
  )
  ON CONFLICT (consultation_id) DO NOTHING;

  -- 8. Audit logging
  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_type,
    entity_id,
    details,
    created_at
  )
  VALUES (
    v_caller_id,
    'ACTIVATE_CONSULTATION',
    'consultation',
    p_consultation_id::TEXT,
    'Consultation activated by ' || CASE WHEN v_is_admin THEN 'admin' ELSE 'assigned doctor' END || '. 7-day chat window initiated until ' || v_expires_at::TEXT,
    v_activated_at
  );

  RETURN v_consultation;
END;
$$;

-- Revoke EXECUTE from PUBLIC and anon roles
REVOKE EXECUTE ON FUNCTION public.activate_consultation(UUID) FROM PUBLIC, anon;

-- Grant EXECUTE only to authenticated users (role checked inside function)
GRANT EXECUTE ON FUNCTION public.activate_consultation(UUID) TO authenticated;
