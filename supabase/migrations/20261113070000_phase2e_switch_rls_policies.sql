-- ==============================================================================
-- PET CONNECT VETERINARY HEALTHCARE PLATFORM
-- Migration 7 (Phase 2e Switch): Multi-Tenant RLS Policies & Storage Security
-- File: supabase/migrations/20261113070000_phase2e_switch_rls_policies.sql
-- ==============================================================================
-- ATOMIC POLICY SWITCH:
-- - Drops legacy single-tenant / global-admin policies and installs hardened
--   TO authenticated multi-tenant policies inside the same transaction so
--   permissive policies never OR-overlap and tables never have an open window.
-- - Enforces confirmed Phase 1 & 2 rules:
--   1. Platform Owner manages applications/orgs with ZERO clinical data access.
--   2. All active doctors in an org read that org's clinical records.
--   3. Expired (and active) chat history is readable ONLY by the consultation's
--      client and treating doctor (excludes org_admin, org_owner, platform_admin).
--   4. Private clinical-files storage bucket enforces {organization_id}/ path RLS.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. PROFILES & PLATFORM_ADMINS & LEGACY USER_ROLES (Deprecated Read-Only)
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view their own profile or active doctors" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own initial profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update only their own profile" ON public.profiles;

CREATE POLICY "profiles_select_authenticated"
ON public.profiles FOR SELECT TO authenticated
USING (
  id = (SELECT auth.uid())
  OR (
    (SELECT app.is_platform_admin())
    AND (
      EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = profiles.id)
      OR EXISTS (SELECT 1 FROM public.organization_applications oa WHERE oa.applicant_user_id = profiles.id)
    )
  )
  OR EXISTS (
    SELECT 1 FROM public.organization_memberships me
    JOIN public.organization_memberships peer ON peer.organization_id = me.organization_id
    JOIN public.organizations o ON o.id = me.organization_id
    WHERE me.user_id = (SELECT auth.uid()) AND me.status = 'active' AND o.status = 'active'
      AND peer.user_id = profiles.id
  )
  OR EXISTS (
    SELECT 1 FROM public.organization_memberships me
    JOIN public.clinic_clients cc ON cc.organization_id = me.organization_id
    JOIN public.organizations o ON o.id = me.organization_id
    WHERE me.user_id = (SELECT auth.uid()) AND me.status = 'active' AND o.status = 'active'
      AND cc.user_id = profiles.id
  )
  OR EXISTS (
    SELECT 1 FROM public.clinic_clients cc
    JOIN public.doctor_profiles dp ON dp.organization_id = cc.organization_id
    JOIN public.organizations o ON o.id = cc.organization_id
    WHERE cc.user_id = (SELECT auth.uid()) AND cc.status = 'approved' AND o.status = 'active'
      AND dp.user_id = profiles.id AND dp.is_active = true
  )
);

CREATE POLICY "profiles_update_own"
ON public.profiles FOR UPDATE TO authenticated
USING (id = (SELECT auth.uid()))
WITH CHECK (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "platform_admins_select_self" ON public.platform_admins;
CREATE POLICY "platform_admins_select_self"
ON public.platform_admins FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()) AND is_active = true);

-- Deprecate legacy user_roles: allow only self read (writes revoked in Phase 2a; table dropped in Phase 11)
DROP POLICY IF EXISTS "Users can view their own roles or admins can view all" ON public.user_roles;
DROP POLICY IF EXISTS "Only administrators can assign user roles" ON public.user_roles;
DROP POLICY IF EXISTS "Only administrators can modify user roles" ON public.user_roles;
DROP POLICY IF EXISTS "Only administrators can remove user roles" ON public.user_roles;

CREATE POLICY "user_roles_select_own_deprecated"
ON public.user_roles FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()));

-- ------------------------------------------------------------------------------
-- 2. ORGANIZATIONS, APPLICATIONS, BRANCHES, ROLES & MEMBERSHIPS
-- ------------------------------------------------------------------------------
CREATE POLICY "org_apps_select"
ON public.organization_applications FOR SELECT TO authenticated
USING (applicant_user_id = (SELECT auth.uid()) OR (SELECT app.is_platform_admin()));

CREATE POLICY "orgs_select"
ON public.organizations FOR SELECT TO authenticated
USING (
  (SELECT app.is_platform_admin())
  OR (SELECT app.is_org_member(id))
  OR EXISTS (
    SELECT 1 FROM public.clinic_clients cc
    WHERE cc.organization_id = organizations.id AND cc.user_id = (SELECT auth.uid())
  )
  OR status = 'active' -- Allows authenticated users to search active clinics to request join
);

CREATE POLICY "branches_select"
ON public.branches FOR SELECT TO authenticated
USING (
  (SELECT app.is_platform_admin())
  OR (SELECT app.is_org_member(organization_id))
  OR (is_active = true AND (SELECT app.current_clinic_client_id(organization_id)) IS NOT NULL)
);

CREATE POLICY "org_roles_catalogue_select"
ON public.organization_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "permissions_catalogue_select"
ON public.permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY "role_permissions_catalogue_select"
ON public.role_permissions FOR SELECT TO authenticated USING (true);

CREATE POLICY "org_memberships_select"
ON public.organization_memberships FOR SELECT TO authenticated
USING (
  user_id = (SELECT auth.uid())
  OR (SELECT app.is_org_member(organization_id))
);

CREATE POLICY "membership_roles_select"
ON public.membership_roles FOR SELECT TO authenticated
USING ((SELECT app.is_org_member(organization_id)));

CREATE POLICY "membership_branches_select"
ON public.membership_branches FOR SELECT TO authenticated
USING ((SELECT app.is_org_member(organization_id)));

CREATE POLICY "staff_invitations_select"
ON public.staff_invitations FOR SELECT TO authenticated
USING ((SELECT app.has_org_permission(organization_id, 'staff.manage')));

-- ------------------------------------------------------------------------------
-- 3. CLINIC CLIENTS, PETS & PET GUARDIANS (ZERO PLATFORM OWNER / CROSS-ORG ACCESS)
-- ------------------------------------------------------------------------------
CREATE POLICY "clinic_clients_select"
ON public.clinic_clients FOR SELECT TO authenticated
USING (
  user_id = (SELECT auth.uid())
  OR (SELECT app.has_org_permission(organization_id, 'clients.read'))
);

DROP POLICY IF EXISTS "Clients can select their own pets" ON public.pets;
DROP POLICY IF EXISTS "Clients can insert/update/delete their own pets" ON public.pets;

CREATE POLICY "pets_select_tenant"
ON public.pets FOR SELECT TO authenticated
USING (
  (SELECT app.has_org_permission(organization_id, 'pets.read'))
  OR (SELECT app.is_pet_guardian(organization_id, id))
);

CREATE POLICY "pet_guardians_select_tenant"
ON public.pet_guardians FOR SELECT TO authenticated
USING (
  (SELECT app.has_org_permission(organization_id, 'pets.read'))
  OR EXISTS (
    SELECT 1 FROM public.clinic_clients cc
    WHERE cc.id = pet_guardians.clinic_client_id
      AND cc.organization_id = pet_guardians.organization_id
      AND cc.user_id = (SELECT auth.uid())
      AND cc.status = 'approved'
  )
);

-- ------------------------------------------------------------------------------
-- 4. DOCTOR PROFILES, BRANCH ASSIGNMENTS & SCHEDULES
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can view active doctor profiles" ON public.doctor_profiles;
DROP POLICY IF EXISTS "Only administrators can create doctor profiles" ON public.doctor_profiles;
DROP POLICY IF EXISTS "Doctors can update their own profile and admins can update all" ON public.doctor_profiles;

CREATE POLICY "doctor_profiles_select_tenant"
ON public.doctor_profiles FOR SELECT TO authenticated
USING (
  (SELECT app.is_org_member(organization_id))
  OR (is_active = true AND (SELECT app.current_clinic_client_id(organization_id)) IS NOT NULL)
);

CREATE POLICY "doctor_branch_assignments_select_tenant"
ON public.doctor_branch_assignments FOR SELECT TO authenticated
USING (
  (SELECT app.is_org_member(organization_id))
  OR (is_active = true AND (SELECT app.current_clinic_client_id(organization_id)) IS NOT NULL)
);

CREATE POLICY "doctor_schedules_select_tenant"
ON public.doctor_schedules FOR SELECT TO authenticated
USING (
  (SELECT app.is_org_member(organization_id))
  OR (is_active = true AND (SELECT app.current_clinic_client_id(organization_id)) IS NOT NULL)
);

CREATE POLICY "doctor_schedule_exceptions_select_tenant"
ON public.doctor_schedule_exceptions FOR SELECT TO authenticated
USING ((SELECT app.is_org_member(organization_id)));

DROP POLICY IF EXISTS "Anyone can view available doctor schedules" ON public.doctor_availability;
DROP POLICY IF EXISTS "Doctors and admins can manage availability" ON public.doctor_availability;

CREATE POLICY "doctor_availability_select_legacy_tenant"
ON public.doctor_availability FOR SELECT TO authenticated
USING ((SELECT app.is_org_member(organization_id)));

-- ------------------------------------------------------------------------------
-- 5. APPOINTMENTS & CONSULTATIONS
-- ------------------------------------------------------------------------------
CREATE POLICY "appointments_select_tenant"
ON public.appointments FOR SELECT TO authenticated
USING (
  (SELECT app.has_branch_access(organization_id, branch_id, 'appointments.read'))
  OR (SELECT app.is_pet_guardian(organization_id, pet_id))
);

CREATE POLICY "appointment_status_history_select_tenant"
ON public.appointment_status_history FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.appointments a
    WHERE a.id = appointment_status_history.appointment_id
      AND a.organization_id = appointment_status_history.organization_id
      AND (
        (SELECT app.has_branch_access(a.organization_id, a.branch_id, 'appointments.read'))
        OR (SELECT app.is_pet_guardian(a.organization_id, a.pet_id))
      )
  )
);

DROP POLICY IF EXISTS "Consultation participants and admins can view consultations" ON public.consultations;
DROP POLICY IF EXISTS "Clients can book consultations" ON public.consultations;
DROP POLICY IF EXISTS "Assigned doctors and admins can update consultations" ON public.consultations;

CREATE POLICY "consultations_select_tenant"
ON public.consultations FOR SELECT TO authenticated
USING (
  (SELECT app.has_org_permission(organization_id, 'consultations.manage'))
  OR (branch_id IS NOT NULL AND (SELECT app.has_branch_access(organization_id, branch_id, 'appointments.read')))
  OR (branch_id IS NULL AND (SELECT app.has_org_permission(organization_id, 'appointments.read')))
  OR (SELECT app.is_pet_guardian(organization_id, pet_id))
  OR (SELECT app.is_consultation_participant(id))
);

DROP POLICY IF EXISTS "Clients and admins can view consultation payment status" ON public.consultation_payments;
DROP POLICY IF EXISTS "Only admins or payment webhooks can insert/modify payments" ON public.consultation_payments;

CREATE POLICY "consultation_payments_select_tenant"
ON public.consultation_payments FOR SELECT TO authenticated
USING (
  (SELECT app.has_org_permission(organization_id, 'audit.read'))
  OR EXISTS (
    SELECT 1 FROM public.consultations c
    WHERE c.id = consultation_payments.consultation_id
      AND c.organization_id = consultation_payments.organization_id
      AND (SELECT app.is_pet_guardian(c.organization_id, c.pet_id))
  )
);

-- ------------------------------------------------------------------------------
-- 6. CHAT CONVERSATIONS & MESSAGES (D-16: STRICTLY CLIENT + TREATING DOCTOR ONLY)
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Participants can view their chat conversation" ON public.chat_conversations;
DROP POLICY IF EXISTS "Participants can read past chat history regardless of expiry" ON public.chat_messages;
DROP POLICY IF EXISTS "Only active, non-expired consultations allow inserting new messages" ON public.chat_messages;

-- Explicitly EXCLUDES org_admin, org_owner, front_desk, branch_manager, unrelated doctors, & platform_admin!
CREATE POLICY "chat_conversations_select_participants_only"
ON public.chat_conversations FOR SELECT TO authenticated
USING ((SELECT app.is_consultation_participant(consultation_id)));

CREATE POLICY "chat_messages_select_participants_only"
ON public.chat_messages FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.chat_conversations conv
    WHERE conv.id = chat_messages.conversation_id
      AND conv.organization_id = chat_messages.organization_id
      AND (SELECT app.is_consultation_participant(conv.consultation_id))
  )
);

-- ------------------------------------------------------------------------------
-- 7. CLINICAL RECORDS, PRESCRIPTIONS & VACCINATIONS
-- (D-17: ALL AUTHORIZED DOCTORS IN SAME ORG READ ORG CLINICAL RECORDS)
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Clients and attending doctors can view prescriptions" ON public.prescriptions;
DROP POLICY IF EXISTS "Doctors and admins can create prescriptions" ON public.prescriptions;
DROP POLICY IF EXISTS "Participants can view prescription items" ON public.prescription_items;
DROP POLICY IF EXISTS "Prescribing doctors and admins can insert items" ON public.prescription_items;
DROP POLICY IF EXISTS "Pet owners and authorized doctors can view medical records" ON public.medical_records;
DROP POLICY IF EXISTS "Doctors can insert medical records" ON public.medical_records;
DROP POLICY IF EXISTS "Pet owners and doctors can view vaccinations" ON public.vaccinations;
DROP POLICY IF EXISTS "Doctors and admins can record vaccinations" ON public.vaccinations;

CREATE POLICY "prescriptions_select_tenant"
ON public.prescriptions FOR SELECT TO authenticated
USING (
  (SELECT app.has_org_permission(organization_id, 'medical_records.read'))
  OR (SELECT app.is_pet_guardian(organization_id, pet_id))
);

CREATE POLICY "prescription_items_select_tenant"
ON public.prescription_items FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.prescriptions p
    WHERE p.id = prescription_items.prescription_id
      AND p.organization_id = prescription_items.organization_id
      AND (
        (SELECT app.has_org_permission(p.organization_id, 'medical_records.read'))
        OR (SELECT app.is_pet_guardian(p.organization_id, p.pet_id))
      )
  )
);

CREATE POLICY "medical_records_select_tenant"
ON public.medical_records FOR SELECT TO authenticated
USING (
  (SELECT app.has_org_permission(organization_id, 'medical_records.read'))
  OR (SELECT app.is_pet_guardian(organization_id, pet_id))
);

CREATE POLICY "vaccinations_select_tenant"
ON public.vaccinations FOR SELECT TO authenticated
USING (
  (SELECT app.has_org_permission(organization_id, 'medical_records.read'))
  OR (SELECT app.is_pet_guardian(organization_id, pet_id))
);

-- ------------------------------------------------------------------------------
-- 8. ATTACHMENTS, REVIEWS, NOTIFICATIONS & AUDIT LOGS
-- ------------------------------------------------------------------------------
CREATE POLICY "attachments_select_tenant"
ON public.attachments FOR SELECT TO authenticated
USING (
  CASE entity_type
    WHEN 'chat_message' THEN (
      EXISTS (
        SELECT 1 FROM public.message_attachments ma
        JOIN public.chat_messages cm ON cm.id = ma.message_id
        JOIN public.chat_conversations conv ON conv.id = cm.conversation_id
        WHERE ma.attachment_id = attachments.id
          AND ma.organization_id = attachments.organization_id
          AND (SELECT app.is_consultation_participant(conv.consultation_id))
      )
    )
    WHEN 'consultation' THEN (SELECT app.is_consultation_participant(entity_id))
    WHEN 'application' THEN (uploaded_by = (SELECT auth.uid()) OR (SELECT app.is_platform_admin()))
    WHEN 'pet' THEN (
      (SELECT app.has_org_permission(organization_id, 'pets.read'))
      OR (SELECT app.is_pet_guardian(organization_id, entity_id))
    )
    WHEN 'medical_record' THEN (
      (SELECT app.has_org_permission(organization_id, 'medical_records.read'))
      OR EXISTS (
        SELECT 1 FROM public.medical_records mr
        WHERE mr.id = attachments.entity_id
          AND mr.organization_id = attachments.organization_id
          AND (SELECT app.is_pet_guardian(mr.organization_id, mr.pet_id))
      )
    )
    ELSE false
  END
);

CREATE POLICY "message_attachments_select_participants_only"
ON public.message_attachments FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.chat_messages cm
    JOIN public.chat_conversations conv ON conv.id = cm.conversation_id
    WHERE cm.id = message_attachments.message_id
      AND conv.organization_id = message_attachments.organization_id
      AND (SELECT app.is_consultation_participant(conv.consultation_id))
  )
);

DROP POLICY IF EXISTS "Anyone can view approved reviews" ON public.reviews;
DROP POLICY IF EXISTS "Clients can review completed consultations" ON public.reviews;

CREATE POLICY "reviews_select_tenant"
ON public.reviews FOR SELECT TO authenticated
USING ((SELECT app.is_org_member(organization_id)));

DROP POLICY IF EXISTS "Users view only their own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can mark their own notifications as read" ON public.notifications;

CREATE POLICY "notifications_select_own"
ON public.notifications FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()));

CREATE POLICY "notifications_update_own_read"
ON public.notifications FOR UPDATE TO authenticated
USING (user_id = (SELECT auth.uid()))
WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Admins can view audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Direct audit log insertions restricted to admins" ON public.audit_logs;

CREATE POLICY "audit_logs_select_tenant_or_platform"
ON public.audit_logs FOR SELECT TO authenticated
USING (
  (organization_id IS NOT NULL AND (SELECT app.has_org_permission(organization_id, 'audit.read')))
  OR (organization_id IS NULL AND (SELECT app.is_platform_admin()))
);

-- ------------------------------------------------------------------------------
-- 9. PRIVATE SUPABASE STORAGE BUCKET & TENANT OBJECT POLICIES
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'buckets') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'clinical-files',
      'clinical-files',
      false,
      10485760,
      ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
    )
    ON CONFLICT (id) DO UPDATE SET
      public = false,
      file_size_limit = 10485760,
      allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'objects') THEN
    EXECUTE 'DROP POLICY IF EXISTS "clinical_files_select_tenant" ON storage.objects';
    EXECUTE 'DROP POLICY IF EXISTS "clinical_files_insert_tenant" ON storage.objects';

    EXECUTE $pol$
      CREATE POLICY "clinical_files_select_tenant"
      ON storage.objects FOR SELECT TO authenticated
      USING (
        bucket_id = 'clinical-files'
        AND CASE
          WHEN name ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/' THEN
            EXISTS (
              SELECT 1 FROM public.attachments a
              WHERE a.bucket_id = 'clinical-files'
                AND a.object_path = storage.objects.name
                AND a.organization_id = split_part(storage.objects.name, '/', 1)::uuid
            )
          ELSE false
        END
      )
    $pol$;

    EXECUTE $pol$
      CREATE POLICY "clinical_files_insert_tenant"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'clinical-files'
        AND CASE
          WHEN name ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/' THEN
            (
              (SELECT app.is_org_member(split_part(name, '/', 1)::uuid))
              OR (SELECT app.current_clinic_client_id(split_part(name, '/', 1)::uuid)) IS NOT NULL
            )
          ELSE false
        END
      )
    $pol$;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Skipped storage.objects policy creation due to storage ownership; apply via Supabase CLI/Dashboard storage owner.';
END $$;
