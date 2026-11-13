-- ==============================================================================
-- PET CONNECT VETERINARY HEALTHCARE PLATFORM
-- Unified Production Database Migration & Security Deployment
-- File: supabase/migrations/999_full_production_deploy.sql
-- ==============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. ENUMS
DO $$ BEGIN
  CREATE TYPE user_role_enum AS ENUM ('client', 'doctor', 'admin');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE consultation_status_enum AS ENUM ('pending', 'active', 'completed', 'expired', 'rejected');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE payment_status_enum AS ENUM ('pending', 'completed', 'failed', 'refunded');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE message_type_enum AS ENUM ('text', 'image', 'file');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE medical_record_type_enum AS ENUM ('clinical_note', 'lab_report', 'vaccination', 'surgery', 'discharge');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE notification_type_enum AS ENUM ('consultation', 'message', 'prescription', 'system');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 3. TABLES (16 NORMALIZED TABLES)

-- Table 1: PROFILES
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(30),
    avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Table 2: USER_ROLES
CREATE TABLE IF NOT EXISTS public.user_roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role user_role_enum NOT NULL DEFAULT 'client',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT unique_user_role UNIQUE (user_id, role)
);

-- Table 3: PETS
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

-- Table 4: DOCTOR_PROFILES
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

-- Table 5: DOCTOR_AVAILABILITY
CREATE TABLE IF NOT EXISTS public.doctor_availability (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    doctor_id UUID NOT NULL REFERENCES public.doctor_profiles(id) ON DELETE CASCADE,
    day_of_week VARCHAR(15) NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_available BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT check_time_order CHECK (end_time > start_time)
);

-- Table 6: CONSULTATIONS
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
    CONSTRAINT check_seven_day_expiry CHECK (
        activated_at IS NULL OR expires_at = (activated_at + INTERVAL '7 days')
    )
);

-- Table 7: CONSULTATION_PAYMENTS
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

-- Table 8: CHAT_CONVERSATIONS
CREATE TABLE IF NOT EXISTS public.chat_conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    consultation_id UUID NOT NULL UNIQUE REFERENCES public.consultations(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    doctor_id UUID NOT NULL REFERENCES public.doctor_profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Table 9: CHAT_MESSAGES
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

-- Table 10: PRESCRIPTIONS
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

-- Table 11: PRESCRIPTION_ITEMS
CREATE TABLE IF NOT EXISTS public.prescription_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    prescription_id UUID NOT NULL REFERENCES public.prescriptions(id) ON DELETE CASCADE,
    medicine_name VARCHAR(150) NOT NULL,
    dosage VARCHAR(100) NOT NULL,
    frequency VARCHAR(100) NOT NULL,
    duration VARCHAR(50) NOT NULL,
    instructions TEXT
);

-- Table 12: MEDICAL_RECORDS
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

-- Table 13: VACCINATIONS
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

-- Table 14: NOTIFICATIONS
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

-- Table 15: REVIEWS
CREATE TABLE IF NOT EXISTS public.reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    consultation_id UUID NOT NULL UNIQUE REFERENCES public.consultations(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    doctor_id UUID NOT NULL REFERENCES public.doctor_profiles(id) ON DELETE CASCADE,
    rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
    review_text TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Table 16: AUDIT_LOGS
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id VARCHAR(100) NOT NULL,
    details TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 4. INDEXES
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
CREATE INDEX IF NOT EXISTS idx_medical_records_pet ON public.medical_records(pet_id);
CREATE INDEX IF NOT EXISTS idx_vaccinations_pet ON public.vaccinations(pet_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON public.audit_logs(user_id);

-- 5. ROW LEVEL SECURITY (RLS) ENABLEMENT
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultation_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prescription_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medical_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vaccinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 6. SECURITY DEFINER HELPER FUNCTIONS
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.is_doctor()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'doctor'
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.is_doctor() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_doctor() TO authenticated;

-- 7. CONSULTATION ACTIVATION PROCEDURE
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
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Caller authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_consultation
  FROM public.consultations
  WHERE id = p_consultation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Consultation % not found', p_consultation_id USING ERRCODE = 'P0002';
  END IF;

  IF v_consultation.consultation_status <> 'pending' THEN
    RAISE EXCEPTION 'Invalid State: Consultation % is already in status %', p_consultation_id, v_consultation.consultation_status
      USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_caller_id AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.doctor_profiles dp
      WHERE dp.id = v_consultation.doctor_id
        AND dp.user_id = v_caller_id
        AND dp.is_active = true
    ) THEN
      IF v_consultation.client_id = v_caller_id THEN
        RAISE EXCEPTION 'Forbidden: Clients cannot self-activate consultations' USING ERRCODE = '42501';
      ELSE
        RAISE EXCEPTION 'Forbidden: Caller is not the assigned doctor or an authorized administrator' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  v_activated_at := now();
  v_expires_at := v_activated_at + INTERVAL '7 days';

  UPDATE public.consultations
  SET consultation_status = 'active',
      activated_at = v_activated_at,
      expires_at = v_expires_at,
      updated_at = v_activated_at
  WHERE id = p_consultation_id
  RETURNING * INTO v_consultation;

  INSERT INTO public.chat_conversations (
    consultation_id, client_id, doctor_id, created_at
  )
  VALUES (
    v_consultation.id, v_consultation.client_id, v_consultation.doctor_id, v_activated_at
  )
  ON CONFLICT (consultation_id) DO NOTHING;

  INSERT INTO public.audit_logs (
    user_id, action, entity_type, entity_id, details, created_at
  ) VALUES (
    v_caller_id, 'ACTIVATE_CONSULTATION', 'consultation', p_consultation_id::TEXT,
    'Consultation activated by ' || CASE WHEN v_is_admin THEN 'admin' ELSE 'assigned doctor' END || '. 7-day chat window initiated until ' || v_expires_at::TEXT,
    v_activated_at
  );

  RETURN v_consultation;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.activate_consultation(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activate_consultation(UUID) TO authenticated;

-- 8. AUTOMATIC NEW USER SIGNUP TRIGGER (DEFAULTS TO CLIENT ROLE ONLY)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.email,
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'client')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

-- 9. ROW LEVEL SECURITY POLICIES

-- Profiles
CREATE POLICY "Users can view their own profile or active doctors"
ON public.profiles FOR SELECT
USING (auth.uid() = id OR public.is_admin() OR EXISTS (SELECT 1 FROM public.doctor_profiles dp WHERE dp.user_id = profiles.id AND dp.is_active = true));

CREATE POLICY "Users can insert their own initial profile"
ON public.profiles FOR INSERT
WITH CHECK (auth.uid() = id OR public.is_admin());

CREATE POLICY "Users can update only their own profile"
ON public.profiles FOR UPDATE
USING (auth.uid() = id);

-- User Roles
CREATE POLICY "Users can view their own roles or admins can view all"
ON public.user_roles FOR SELECT
USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "Only administrators can assign user roles"
ON public.user_roles FOR INSERT
WITH CHECK (public.is_admin());

CREATE POLICY "Only administrators can modify user roles"
ON public.user_roles FOR UPDATE
USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "Only administrators can remove user roles"
ON public.user_roles FOR DELETE
USING (public.is_admin());

-- Doctor Profiles & Schedules
CREATE POLICY "Anyone can view active doctor profiles"
ON public.doctor_profiles FOR SELECT
USING (is_active = true OR user_id = auth.uid() OR public.is_admin());

CREATE POLICY "Only administrators can create doctor profiles"
ON public.doctor_profiles FOR INSERT
WITH CHECK (public.is_admin());

CREATE POLICY "Doctors can update their own profile and admins can update all"
ON public.doctor_profiles FOR UPDATE
USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "Anyone can view available doctor schedules"
ON public.doctor_availability FOR SELECT
USING (is_available = true OR public.is_admin() OR EXISTS (
  SELECT 1 FROM public.doctor_profiles dp WHERE dp.id = doctor_availability.doctor_id AND dp.user_id = auth.uid()
));

CREATE POLICY "Doctors and admins can manage availability"
ON public.doctor_availability FOR ALL
USING (public.is_admin() OR EXISTS (SELECT 1 FROM public.doctor_profiles dp WHERE dp.id = doctor_availability.doctor_id AND dp.user_id = auth.uid()));

-- Pets
CREATE POLICY "Clients can select their own pets"
ON public.pets FOR SELECT
USING (owner_id = auth.uid() OR public.is_admin() OR EXISTS (SELECT 1 FROM public.consultations c JOIN public.doctor_profiles dp ON dp.id = c.doctor_id WHERE c.pet_id = pets.id AND dp.user_id = auth.uid()));

CREATE POLICY "Clients can insert/update/delete their own pets"
ON public.pets FOR ALL
USING (owner_id = auth.uid() OR public.is_admin());

-- Consultations
CREATE POLICY "Consultation participants and admins can view consultations"
ON public.consultations FOR SELECT
USING (client_id = auth.uid() OR public.is_admin() OR EXISTS (SELECT 1 FROM public.doctor_profiles dp WHERE dp.id = consultations.doctor_id AND dp.user_id = auth.uid()));

CREATE POLICY "Clients can book consultations"
ON public.consultations FOR INSERT
WITH CHECK (client_id = auth.uid());

CREATE POLICY "Assigned doctors and admins can update consultations"
ON public.consultations FOR UPDATE
USING (public.is_admin() OR EXISTS (SELECT 1 FROM public.doctor_profiles dp WHERE dp.id = consultations.doctor_id AND dp.user_id = auth.uid()));

-- Payments
CREATE POLICY "Clients and admins can view consultation payment status"
ON public.consultation_payments FOR SELECT
USING (public.is_admin() OR EXISTS (SELECT 1 FROM public.consultations c WHERE c.id = consultation_payments.consultation_id AND c.client_id = auth.uid()));

CREATE POLICY "Only admins can manage consultation payments"
ON public.consultation_payments FOR ALL
USING (public.is_admin());

-- Chat Conversations & Messages
CREATE POLICY "Participants can view their chat conversation"
ON public.chat_conversations FOR SELECT
USING (client_id = auth.uid() OR public.is_admin() OR EXISTS (SELECT 1 FROM public.doctor_profiles dp WHERE dp.id = chat_conversations.doctor_id AND dp.user_id = auth.uid()));

CREATE POLICY "Participants can read past chat history regardless of expiry"
ON public.chat_messages FOR SELECT
USING (EXISTS (SELECT 1 FROM public.chat_conversations conv JOIN public.doctor_profiles dp ON dp.id = conv.doctor_id WHERE conv.id = chat_messages.conversation_id AND (conv.client_id = auth.uid() OR dp.user_id = auth.uid() OR public.is_admin())));

CREATE POLICY "Only active, non-expired consultations allow inserting new messages"
ON public.chat_messages FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.chat_conversations conv
    JOIN public.consultations c ON c.id = conv.consultation_id
    JOIN public.doctor_profiles dp ON dp.id = conv.doctor_id
    WHERE conv.id = chat_messages.conversation_id
      AND (conv.client_id = auth.uid() OR dp.user_id = auth.uid())
      AND chat_messages.sender_id = auth.uid()
      AND c.consultation_status = 'active'
      AND c.activated_at IS NOT NULL
      AND c.expires_at IS NOT NULL
      AND now() < c.expires_at
  )
);

-- Prescriptions & Items
CREATE POLICY "Clients and attending doctors can view prescriptions"
ON public.prescriptions FOR SELECT
USING (client_id = auth.uid() OR public.is_admin() OR EXISTS (SELECT 1 FROM public.doctor_profiles dp WHERE dp.id = prescriptions.doctor_id AND dp.user_id = auth.uid()));

CREATE POLICY "Doctors and admins can create prescriptions"
ON public.prescriptions FOR INSERT
WITH CHECK (public.is_admin() OR EXISTS (SELECT 1 FROM public.doctor_profiles dp WHERE dp.id = prescriptions.doctor_id AND dp.user_id = auth.uid()));

CREATE POLICY "Participants can view prescription items"
ON public.prescription_items FOR SELECT
USING (EXISTS (SELECT 1 FROM public.prescriptions p WHERE p.id = prescription_items.prescription_id AND (p.client_id = auth.uid() OR public.is_doctor() OR public.is_admin())));

CREATE POLICY "Prescribing doctors and admins can insert items"
ON public.prescription_items FOR INSERT
WITH CHECK (EXISTS (SELECT 1 FROM public.prescriptions p JOIN public.doctor_profiles dp ON dp.id = p.doctor_id WHERE p.id = prescription_items.prescription_id AND (dp.user_id = auth.uid() OR public.is_admin())));

-- Medical Records & Vaccinations
CREATE POLICY "Pet owners and authorized doctors can view medical records"
ON public.medical_records FOR SELECT
USING (public.is_admin() OR EXISTS (SELECT 1 FROM public.pets p WHERE p.id = medical_records.pet_id AND p.owner_id = auth.uid()) OR public.is_doctor());

CREATE POLICY "Doctors can insert medical records"
ON public.medical_records FOR INSERT
WITH CHECK (public.is_doctor() OR public.is_admin());

CREATE POLICY "Pet owners and doctors can view vaccinations"
ON public.vaccinations FOR SELECT
USING (public.is_admin() OR EXISTS (SELECT 1 FROM public.pets p WHERE p.id = vaccinations.pet_id AND p.owner_id = auth.uid()) OR public.is_doctor());

CREATE POLICY "Doctors and admins can record vaccinations"
ON public.vaccinations FOR INSERT
WITH CHECK (public.is_doctor() OR public.is_admin());

-- Reviews
CREATE POLICY "Anyone can view approved reviews"
ON public.reviews FOR SELECT
USING (true);

CREATE POLICY "Clients can review completed consultations"
ON public.reviews FOR INSERT
WITH CHECK (client_id = auth.uid() AND EXISTS (SELECT 1 FROM public.consultations c WHERE c.id = reviews.consultation_id AND c.client_id = auth.uid() AND c.consultation_status = 'completed'));

-- Notifications & Audit Logs
CREATE POLICY "Users view only their own notifications"
ON public.notifications FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "Users can mark their own notifications as read"
ON public.notifications FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins can view audit logs"
ON public.audit_logs FOR SELECT
USING (public.is_admin());

CREATE POLICY "Direct audit log insertions restricted to admins"
ON public.audit_logs FOR INSERT
WITH CHECK (public.is_admin());
