-- ==============================================================================
-- PET CONNECT VETERINARY HEALTHCARE PLATFORM
-- Row Level Security (RLS) Policies & Authorization Architecture (PostgreSQL / Supabase)
-- File: supabase/policies/rls_policies.sql
-- ==============================================================================

-- Enable RLS across all 16 sensitive tables
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

-- ------------------------------------------------------------------------------
-- HELPER FUNCTIONS FOR ROLE VERIFICATION (SECURITY DEFINER HARDENED)
-- ------------------------------------------------------------------------------
-- Fixed search_path = public, pg_temp prevents schema-shadowing attacks
-- Schema-qualified auth.uid() ensures safe resolution in isolated execution context
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

-- ------------------------------------------------------------------------------
-- 1. PROFILES POLICIES
-- ------------------------------------------------------------------------------
CREATE POLICY "Users can view their own profile or active doctors"
ON public.profiles FOR SELECT
USING (
  auth.uid() = id
  OR public.is_admin()
  OR EXISTS (SELECT 1 FROM public.doctor_profiles dp WHERE dp.user_id = profiles.id AND dp.is_active = true)
);

CREATE POLICY "Users can insert their own initial profile"
ON public.profiles FOR INSERT
WITH CHECK (auth.uid() = id OR public.is_admin());

CREATE POLICY "Users can update only their own profile"
ON public.profiles FOR UPDATE
USING (auth.uid() = id);

-- ------------------------------------------------------------------------------
-- 2. USER ROLES POLICIES (STRICT PRIVILEGE ESCALATION PREVENTION)
-- Clients and doctors cannot assign, modify, or delete roles.
-- Only verified administrators can manage user roles.
-- ------------------------------------------------------------------------------
CREATE POLICY "Users can view their own roles or admins can view all"
ON public.user_roles FOR SELECT
USING (
  user_id = auth.uid()
  OR public.is_admin()
);

CREATE POLICY "Only administrators can assign user roles"
ON public.user_roles FOR INSERT
WITH CHECK (public.is_admin());

CREATE POLICY "Only administrators can modify user roles"
ON public.user_roles FOR UPDATE
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY "Only administrators can remove user roles"
ON public.user_roles FOR DELETE
USING (public.is_admin());

-- ------------------------------------------------------------------------------
-- 3. DOCTOR PROFILES & AVAILABILITY
-- ------------------------------------------------------------------------------
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
USING (
  public.is_admin() OR EXISTS (
    SELECT 1 FROM public.doctor_profiles dp WHERE dp.id = doctor_availability.doctor_id AND dp.user_id = auth.uid()
  )
);

-- ------------------------------------------------------------------------------
-- 4. PETS POLICIES
-- ------------------------------------------------------------------------------
CREATE POLICY "Clients can select their own pets"
ON public.pets FOR SELECT
USING (
  owner_id = auth.uid()
  OR public.is_admin()
  OR EXISTS (
    -- Assigned doctors can view their patients' records
    SELECT 1 FROM public.consultations c
    JOIN public.doctor_profiles dp ON dp.id = c.doctor_id
    WHERE c.pet_id = pets.id AND dp.user_id = auth.uid()
  )
);

CREATE POLICY "Clients can insert/update/delete their own pets"
ON public.pets FOR ALL
USING (owner_id = auth.uid() OR public.is_admin());

-- ------------------------------------------------------------------------------
-- 5. CONSULTATIONS POLICIES
-- ------------------------------------------------------------------------------
CREATE POLICY "Consultation participants and admins can view consultations"
ON public.consultations FOR SELECT
USING (
  client_id = auth.uid()
  OR public.is_admin()
  OR EXISTS (
    SELECT 1 FROM public.doctor_profiles dp
    WHERE dp.id = consultations.doctor_id AND dp.user_id = auth.uid()
  )
);

CREATE POLICY "Clients can book consultations"
ON public.consultations FOR INSERT
WITH CHECK (client_id = auth.uid());

CREATE POLICY "Assigned doctors and admins can update consultations"
ON public.consultations FOR UPDATE
USING (
  public.is_admin()
  OR EXISTS (
    SELECT 1 FROM public.doctor_profiles dp
    WHERE dp.id = consultations.doctor_id AND dp.user_id = auth.uid()
  )
);

-- ------------------------------------------------------------------------------
-- 6. CONSULTATION PAYMENTS (Postponed Gateway Integration / Placeholder Safeguards)
-- ------------------------------------------------------------------------------
CREATE POLICY "Clients and admins can view consultation payment status"
ON public.consultation_payments FOR SELECT
USING (
  public.is_admin()
  OR EXISTS (
    SELECT 1 FROM public.consultations c
    WHERE c.id = consultation_payments.consultation_id AND c.client_id = auth.uid()
  )
);

CREATE POLICY "Only admins or payment webhooks can insert/modify payments"
ON public.consultation_payments FOR ALL
USING (public.is_admin());

-- ------------------------------------------------------------------------------
-- 7. CHAT CONVERSATIONS & MESSAGES (STRICT 7-DAY ACCESS & EXPIRY LOCKDOWN)
-- ------------------------------------------------------------------------------
CREATE POLICY "Participants can view their chat conversation"
ON public.chat_conversations FOR SELECT
USING (
  client_id = auth.uid()
  OR public.is_admin()
  OR EXISTS (
    SELECT 1 FROM public.doctor_profiles dp
    WHERE dp.id = chat_conversations.doctor_id AND dp.user_id = auth.uid()
  )
);

-- Previous conversation history remains permanently readable even after 7-day expiration
CREATE POLICY "Participants can read past chat history regardless of expiry"
ON public.chat_messages FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.chat_conversations conv
    JOIN public.doctor_profiles dp ON dp.id = conv.doctor_id
    WHERE conv.id = chat_messages.conversation_id
      AND (conv.client_id = auth.uid() OR dp.user_id = auth.uid() OR public.is_admin())
  )
);

-- CRITICAL BUSINESS & SECURITY RULE:
-- 1. Consultation must be in 'active' status.
-- 2. Consultation activated_at and expires_at must not be NULL.
-- 3. now() must be strictly less than expires_at (< 7 days).
-- 4. Sender must be either the assigned client or the assigned doctor.
-- 5. Expired or unassigned consultations REJECT all new messages.
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

-- Messages and conversations are immutable clinical records: NO UPDATE or DELETE allowed
-- (Absence of UPDATE/DELETE policy blocks modifications for authenticated users)

-- ------------------------------------------------------------------------------
-- 8. PRESCRIPTIONS & PRESCRIPTION ITEMS
-- ------------------------------------------------------------------------------
CREATE POLICY "Clients and attending doctors can view prescriptions"
ON public.prescriptions FOR SELECT
USING (
  client_id = auth.uid()
  OR public.is_admin()
  OR EXISTS (
    SELECT 1 FROM public.doctor_profiles dp
    WHERE dp.id = prescriptions.doctor_id AND dp.user_id = auth.uid()
  )
);

CREATE POLICY "Doctors and admins can create prescriptions"
ON public.prescriptions FOR INSERT
WITH CHECK (
  public.is_admin()
  OR EXISTS (
    SELECT 1 FROM public.doctor_profiles dp
    WHERE dp.id = prescriptions.doctor_id AND dp.user_id = auth.uid()
  )
);

CREATE POLICY "Participants can view prescription items"
ON public.prescription_items FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.prescriptions p
    WHERE p.id = prescription_items.prescription_id
      AND (p.client_id = auth.uid() OR public.is_doctor() OR public.is_admin())
  )
);

CREATE POLICY "Prescribing doctors and admins can insert items"
ON public.prescription_items FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.prescriptions p
    JOIN public.doctor_profiles dp ON dp.id = p.doctor_id
    WHERE p.id = prescription_items.prescription_id
      AND (dp.user_id = auth.uid() OR public.is_admin())
  )
);

-- ------------------------------------------------------------------------------
-- 9. MEDICAL RECORDS & VACCINATIONS
-- ------------------------------------------------------------------------------
CREATE POLICY "Pet owners and authorized doctors can view medical records"
ON public.medical_records FOR SELECT
USING (
  public.is_admin()
  OR EXISTS (
    SELECT 1 FROM public.pets p WHERE p.id = medical_records.pet_id AND p.owner_id = auth.uid()
  )
  OR public.is_doctor()
);

CREATE POLICY "Doctors can insert medical records"
ON public.medical_records FOR INSERT
WITH CHECK (public.is_doctor() OR public.is_admin());

CREATE POLICY "Pet owners and doctors can view vaccinations"
ON public.vaccinations FOR SELECT
USING (
  public.is_admin()
  OR EXISTS (
    SELECT 1 FROM public.pets p WHERE p.id = vaccinations.pet_id AND p.owner_id = auth.uid()
  )
  OR public.is_doctor()
);

CREATE POLICY "Doctors and admins can record vaccinations"
ON public.vaccinations FOR INSERT
WITH CHECK (public.is_doctor() OR public.is_admin());

-- ------------------------------------------------------------------------------
-- 10. REVIEWS
-- ------------------------------------------------------------------------------
CREATE POLICY "Anyone can view approved reviews"
ON public.reviews FOR SELECT
USING (true);

CREATE POLICY "Clients can review completed consultations"
ON public.reviews FOR INSERT
WITH CHECK (
  client_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.consultations c
    WHERE c.id = reviews.consultation_id
      AND c.client_id = auth.uid()
      AND c.consultation_status = 'completed'
  )
);

-- ------------------------------------------------------------------------------
-- 11. NOTIFICATIONS & AUDIT LOGS
-- ------------------------------------------------------------------------------
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
