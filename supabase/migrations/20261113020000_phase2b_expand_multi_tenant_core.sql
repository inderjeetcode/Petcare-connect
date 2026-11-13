-- ==============================================================================
-- PET CONNECT VETERINARY HEALTHCARE PLATFORM
-- Migration 2 (Phase 2b Expand Part 1): Multi-Tenant Core Schema (Additive)
-- File: supabase/migrations/20261113020000_phase2b_expand_multi_tenant_core.sql
-- ==============================================================================
-- EXPAND PHASE: Strictly additive DDL creating multi-tenant root tables,
-- governance principals, organization memberships, roles/permissions,
-- clinic-specific clients, pet guardians, branch assignments, schedules,
-- concurrent-safe appointments, attachments, and internal migration_runs.
-- ==============================================================================

-- 1. Extensions & Internal Governance Schema
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE SCHEMA IF NOT EXISTS app;
REVOKE ALL ON SCHEMA app FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA app TO authenticated;

CREATE TABLE IF NOT EXISTS app.migration_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    migration_name TEXT NOT NULL,
    phase TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    finished_at TIMESTAMPTZ,
    rows_affected BIGINT NOT NULL DEFAULT 0,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    executed_by TEXT NOT NULL DEFAULT current_user
);
REVOKE ALL ON TABLE app.migration_runs FROM PUBLIC, anon, authenticated;

-- 2. Platform Owner Principals (Global Platform Governance — ZERO Clinical Data Access)
CREATE TABLE IF NOT EXISTS public.platform_admins (
    user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE RESTRICT,
    granted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    is_active BOOLEAN NOT NULL DEFAULT true,
    notes TEXT
);

-- 3. Organizations (Tenancy Root)
CREATE TABLE IF NOT EXISTS public.organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug VARCHAR(80) NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$'),
    legal_name VARCHAR(200) NOT NULL,
    display_name VARCHAR(150) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
      CHECK (status IN ('pending', 'active', 'suspended', 'closed')),
    timezone VARCHAR(80) NOT NULL DEFAULT 'UTC',
    country VARCHAR(80) NOT NULL DEFAULT 'IN',
    contact_email VARCHAR(255),
    phone VARCHAR(30),
    plan_code VARCHAR(50), -- Reserved for future SaaS subscription billing (no gateway in v1)
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 4. Organization Applications (Clinic Self-Registration Queue)
CREATE TABLE IF NOT EXISTS public.organization_applications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    applicant_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    proposed_name VARCHAR(150) NOT NULL,
    proposed_slug VARCHAR(80) NOT NULL CHECK (proposed_slug ~ '^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$'),
    legal_name VARCHAR(200) NOT NULL,
    contact_email VARCHAR(255) NOT NULL,
    phone VARCHAR(30) NOT NULL,
    country VARCHAR(80) NOT NULL DEFAULT 'IN',
    timezone VARCHAR(80) NOT NULL DEFAULT 'UTC',
    initial_branch_name VARCHAR(150) NOT NULL,
    initial_branch_code VARCHAR(30) NOT NULL,
    initial_branch_address TEXT NOT NULL,
    documents JSONB NOT NULL DEFAULT '[]'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
    reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    decision_reason TEXT,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_org_app_pending_slug
  ON public.organization_applications(proposed_slug)
  WHERE status = 'pending';

-- 5. Branches (Multi-Branch Support per Organization)
CREATE TABLE IF NOT EXISTS public.branches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    name VARCHAR(150) NOT NULL,
    code VARCHAR(40) NOT NULL,
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(100),
    country VARCHAR(80),
    timezone VARCHAR(80) NOT NULL DEFAULT 'UTC',
    phone VARCHAR(30),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT branches_org_code_uq UNIQUE (organization_id, code),
    CONSTRAINT branches_id_org_uq UNIQUE (id, organization_id)
);

-- 6. Organization Roles & Static Permission Catalogue
CREATE TABLE IF NOT EXISTS public.organization_roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    description TEXT,
    is_system BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT organization_roles_code_uq UNIQUE (code)
);

CREATE TABLE IF NOT EXISTS public.permissions (
    code VARCHAR(80) PRIMARY KEY,
    domain VARCHAR(50) NOT NULL,
    description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
    role_id UUID NOT NULL REFERENCES public.organization_roles(id) ON DELETE CASCADE,
    permission_code VARCHAR(80) NOT NULL REFERENCES public.permissions(code) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_code)
);

-- Seed system roles & permission catalogue idempotently
INSERT INTO public.organization_roles (code, display_name, description, is_system)
VALUES
  ('org_owner', 'Organization Owner', 'Full tenant administrative authority within a veterinary organization.', true),
  ('org_admin', 'Clinic Administrator', 'Manages branches, staff, schedules, client approvals, and appointments.', true),
  ('branch_manager', 'Branch Manager', 'Manages schedules, appointments, and client onboarding for assigned branches.', true),
  ('doctor', 'Veterinary Doctor', 'Authorized clinician with org-wide clinical read and treating/prescribing rights.', true),
  ('front_desk', 'Front Desk Coordinator', 'Manages client onboarding, walk-ins, and appointment confirmations/check-ins.', true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, domain, description)
VALUES
  ('org.manage', 'organization', 'Update organization settings and metadata'),
  ('branch.manage', 'organization', 'Create and manage clinic branches'),
  ('staff.manage', 'staff', 'Invite, assign, and suspend organization staff members'),
  ('roles.assign_admin', 'staff', 'Assign or revoke org_admin role'),
  ('clients.approve', 'clients', 'Approve, reject, suspend, or register clinic clients'),
  ('clients.read', 'clients', 'Read organization clinic client directory'),
  ('pets.read', 'pets', 'Read organization pet and guardian records'),
  ('pets.write', 'pets', 'Create, update, and archive organization pets and guardians'),
  ('schedules.manage', 'scheduling', 'Manage doctor branch schedules and exceptions'),
  ('appointments.read', 'appointments', 'View branch and organization appointments'),
  ('appointments.confirm', 'appointments', 'Confirm, decline, reschedule, check-in, and complete appointments'),
  ('consultations.activate', 'consultations', 'Activate 7-day consultations for eligible appointments'),
  ('consultations.manage', 'consultations', 'Complete, reject, or reassign consultations'),
  ('medical_records.read', 'clinical', 'Read all clinical records (medical_records, vaccinations, prescriptions) in organization'),
  ('medical_records.write', 'clinical', 'Create/amend clinical records, prescriptions, and vaccinations'),
  ('audit.read', 'governance', 'Read organization-scoped audit logs')
ON CONFLICT (code) DO NOTHING;

-- Map system roles -> permissions
WITH role_perm_pairs(role_code, perm_code) AS (
  VALUES
    ('org_owner', 'org.manage'), ('org_owner', 'branch.manage'), ('org_owner', 'staff.manage'),
    ('org_owner', 'roles.assign_admin'), ('org_owner', 'clients.approve'), ('org_owner', 'clients.read'),
    ('org_owner', 'pets.read'), ('org_owner', 'pets.write'), ('org_owner', 'schedules.manage'),
    ('org_owner', 'appointments.read'), ('org_owner', 'appointments.confirm'),
    ('org_owner', 'consultations.activate'), ('org_owner', 'consultations.manage'),
    ('org_owner', 'audit.read'),

    ('org_admin', 'branch.manage'), ('org_admin', 'staff.manage'),
    ('org_admin', 'clients.approve'), ('org_admin', 'clients.read'),
    ('org_admin', 'pets.read'), ('org_admin', 'pets.write'), ('org_admin', 'schedules.manage'),
    ('org_admin', 'appointments.read'), ('org_admin', 'appointments.confirm'),
    ('org_admin', 'consultations.activate'), ('org_admin', 'consultations.manage'),
    ('org_admin', 'audit.read'),

    ('branch_manager', 'clients.approve'), ('branch_manager', 'clients.read'),
    ('branch_manager', 'pets.read'), ('branch_manager', 'pets.write'),
    ('branch_manager', 'schedules.manage'), ('branch_manager', 'appointments.read'),
    ('branch_manager', 'appointments.confirm'),

    ('doctor', 'clients.read'), ('doctor', 'pets.read'), ('doctor', 'pets.write'),
    ('doctor', 'schedules.manage'), ('doctor', 'appointments.read'),
    ('doctor', 'consultations.activate'), ('doctor', 'consultations.manage'),
    ('doctor', 'medical_records.read'), ('doctor', 'medical_records.write'),

    ('front_desk', 'clients.approve'), ('front_desk', 'clients.read'),
    ('front_desk', 'pets.read'), ('front_desk', 'pets.write'),
    ('front_desk', 'appointments.read'), ('front_desk', 'appointments.confirm')
)
INSERT INTO public.role_permissions (role_id, permission_code)
SELECT r.id, p.perm_code
FROM role_perm_pairs p
JOIN public.organization_roles r ON r.code = p.role_code
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- 7. Organization Memberships, Membership Roles, Branch Scope & Staff Invitations
CREATE TABLE IF NOT EXISTS public.organization_memberships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
      CHECK (status IN ('invited', 'active', 'suspended', 'left')),
    invited_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    joined_at TIMESTAMPTZ,
    suspended_at TIMESTAMPTZ,
    suspension_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT org_memberships_org_user_uq UNIQUE (organization_id, user_id),
    CONSTRAINT org_memberships_id_org_uq UNIQUE (id, organization_id)
);

CREATE TABLE IF NOT EXISTS public.membership_roles (
    membership_id UUID NOT NULL,
    organization_id UUID NOT NULL,
    role_id UUID NOT NULL REFERENCES public.organization_roles(id) ON DELETE RESTRICT,
    assigned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (membership_id, role_id),
    CONSTRAINT membership_roles_membership_fk
      FOREIGN KEY (membership_id, organization_id)
      REFERENCES public.organization_memberships(id, organization_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.membership_branches (
    membership_id UUID NOT NULL,
    organization_id UUID NOT NULL,
    branch_id UUID NOT NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (membership_id, branch_id),
    CONSTRAINT membership_branches_membership_fk
      FOREIGN KEY (membership_id, organization_id)
      REFERENCES public.organization_memberships(id, organization_id) ON DELETE CASCADE,
    CONSTRAINT membership_branches_branch_fk
      FOREIGN KEY (branch_id, organization_id)
      REFERENCES public.branches(id, organization_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.staff_invitations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    role_codes TEXT[] NOT NULL CHECK (cardinality(role_codes) >= 1),
    branch_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
    invited_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    accepted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 8. Clinic-Scoped Client Directory & Pet Guardianship
CREATE TABLE IF NOT EXISTS public.clinic_clients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(30),
    status VARCHAR(20) NOT NULL DEFAULT 'requested'
      CHECK (status IN ('requested', 'approved', 'rejected', 'suspended')),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    rejected_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    rejected_at TIMESTAMPTZ,
    rejection_reason TEXT,
    source VARCHAR(50) NOT NULL DEFAULT 'self-request',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT clinic_clients_id_org_uq UNIQUE (id, organization_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_clinic_clients_org_user
  ON public.clinic_clients(organization_id, user_id)
  WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.pet_guardians (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    pet_id UUID NOT NULL,
    clinic_client_id UUID NOT NULL,
    relationship VARCHAR(50) NOT NULL DEFAULT 'owner',
    is_primary BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT pet_guardians_pet_client_uq UNIQUE (pet_id, clinic_client_id),
    CONSTRAINT pet_guardians_client_fk
      FOREIGN KEY (clinic_client_id, organization_id)
      REFERENCES public.clinic_clients(id, organization_id) ON DELETE RESTRICT
    -- Composite FK to pets(id, organization_id) attached in migration 20261113030000 after pets_id_org_uq exists
);

-- 9. Multi-Branch Doctor Assignments & Branch-Specific Schedules
CREATE TABLE IF NOT EXISTS public.doctor_branch_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    doctor_profile_id UUID NOT NULL,
    branch_id UUID NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_to DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT doctor_branch_assignments_uq UNIQUE (doctor_profile_id, branch_id),
    CONSTRAINT doctor_branch_assignments_id_org_uq UNIQUE (id, organization_id),
    CONSTRAINT doctor_branch_assignments_branch_fk
      FOREIGN KEY (branch_id, organization_id)
      REFERENCES public.branches(id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT check_assignment_dates CHECK (effective_to IS NULL OR effective_to >= effective_from)
    -- Composite FK to doctor_profiles(id, organization_id) attached in migration 20261113030000
);

CREATE TABLE IF NOT EXISTS public.doctor_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    branch_id UUID NOT NULL,
    doctor_profile_id UUID NOT NULL,
    weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 1 AND 7), -- ISO weekday (1=Mon .. 7=Sun)
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    slot_minutes SMALLINT NOT NULL DEFAULT 30 CHECK (slot_minutes BETWEEN 5 AND 240),
    is_active BOOLEAN NOT NULL DEFAULT true,
    effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_to DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT doctor_schedules_time_order CHECK (end_time > start_time),
    CONSTRAINT doctor_schedules_dates CHECK (effective_to IS NULL OR effective_to >= effective_from),
    CONSTRAINT doctor_schedules_branch_fk
      FOREIGN KEY (branch_id, organization_id)
      REFERENCES public.branches(id, organization_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.doctor_schedule_exceptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    branch_id UUID,
    doctor_profile_id UUID NOT NULL,
    start_at TIMESTAMPTZ NOT NULL,
    end_at TIMESTAMPTZ NOT NULL,
    exception_type VARCHAR(30) NOT NULL CHECK (exception_type IN ('leave', 'holiday', 'clinic_closure', 'extra_availability')),
    reason TEXT,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT doctor_schedule_exceptions_order CHECK (end_at > start_at),
    CONSTRAINT doctor_schedule_exceptions_branch_fk
      FOREIGN KEY (branch_id, organization_id)
      REFERENCES public.branches(id, organization_id) ON DELETE RESTRICT
);

-- 10. Concurrency-Safe Appointments & Append-Only Status History
CREATE TABLE IF NOT EXISTS public.appointments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    branch_id UUID NOT NULL,
    clinic_client_id UUID NOT NULL,
    pet_id UUID NOT NULL,
    doctor_profile_id UUID NOT NULL,
    requested_start TIMESTAMPTZ NOT NULL,
    requested_end TIMESTAMPTZ NOT NULL,
    scheduled_range TSTZRANGE, -- NULL while 'requested' so pending requests NEVER block calendar slots
    status VARCHAR(20) NOT NULL DEFAULT 'requested'
      CHECK (status IN ('requested', 'confirmed', 'checked_in', 'completed', 'declined', 'cancelled', 'no_show')),
    reason TEXT NOT NULL,
    decline_reason TEXT,
    cancellation_reason TEXT,
    confirmed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    confirmed_at TIMESTAMPTZ,
    checked_in_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT appointments_id_org_uq UNIQUE (id, organization_id),
    CONSTRAINT appointments_req_order CHECK (requested_end > requested_start),
    CONSTRAINT appointments_confirmed_range_chk CHECK (
      status NOT IN ('confirmed', 'checked_in') OR scheduled_range IS NOT NULL
    ),
    CONSTRAINT appointments_branch_fk
      FOREIGN KEY (branch_id, organization_id)
      REFERENCES public.branches(id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT appointments_client_fk
      FOREIGN KEY (clinic_client_id, organization_id)
      REFERENCES public.clinic_clients(id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT no_double_booking EXCLUDE USING gist (
      doctor_profile_id WITH =,
      scheduled_range WITH &&
    ) WHERE (status IN ('confirmed', 'checked_in'))
);

CREATE TABLE IF NOT EXISTS public.appointment_status_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    appointment_id UUID NOT NULL,
    from_status VARCHAR(20),
    to_status VARCHAR(20) NOT NULL,
    changed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    reason TEXT,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT appt_history_appt_fk
      FOREIGN KEY (appointment_id, organization_id)
      REFERENCES public.appointments(id, organization_id) ON DELETE RESTRICT
);

-- 11. Private File Attachments Metadata
CREATE TABLE IF NOT EXISTS public.attachments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    entity_type VARCHAR(40) NOT NULL CHECK (entity_type IN ('pet', 'medical_record', 'consultation', 'chat_message', 'application')),
    entity_id UUID NOT NULL,
    bucket_id VARCHAR(80) NOT NULL DEFAULT 'clinical-files',
    object_path TEXT NOT NULL UNIQUE,
    mime_type VARCHAR(120) NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
    byte_size BIGINT NOT NULL CHECK (byte_size > 0 AND byte_size <= 10485760),
    original_filename VARCHAR(255) NOT NULL,
    uploaded_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT attachments_id_org_uq UNIQUE (id, organization_id),
    -- Object path must begin with '<organization_id>/' to align with storage.objects RLS
    CONSTRAINT attachments_path_prefix_chk CHECK (object_path LIKE (organization_id::text || '/%'))
);

CREATE TABLE IF NOT EXISTS public.message_attachments (
    message_id UUID NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
    attachment_id UUID NOT NULL,
    organization_id UUID NOT NULL,
    PRIMARY KEY (message_id, attachment_id),
    CONSTRAINT message_attachments_att_fk
      FOREIGN KEY (attachment_id, organization_id)
      REFERENCES public.attachments(id, organization_id) ON DELETE CASCADE
);

-- 12. Enable RLS & Revoke Direct Table Writes on All New Multi-Tenant Tables
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pet_guardians ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_branch_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_schedule_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_attachments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.platform_admins FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.platform_admins FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.organizations FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.organization_applications FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.branches FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.organization_roles FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.permissions FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.role_permissions FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.organization_memberships FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.membership_roles FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.membership_branches FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.staff_invitations FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.clinic_clients FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.pet_guardians FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.doctor_branch_assignments FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.doctor_schedules FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.doctor_schedule_exceptions FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.appointments FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.appointment_status_history FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.attachments FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.message_attachments FROM PUBLIC, anon, authenticated;

REVOKE ALL ON public.organizations, public.organization_applications, public.branches,
  public.organization_roles, public.permissions, public.role_permissions,
  public.organization_memberships, public.membership_roles, public.membership_branches,
  public.staff_invitations, public.clinic_clients, public.pet_guardians,
  public.doctor_branch_assignments, public.doctor_schedules, public.doctor_schedule_exceptions,
  public.appointments, public.appointment_status_history, public.attachments, public.message_attachments
  FROM anon;

-- Updated_at triggers for mutable new tables
DROP TRIGGER IF EXISTS organizations_touch_updated_at ON public.organizations;
CREATE TRIGGER organizations_touch_updated_at BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

DROP TRIGGER IF EXISTS org_apps_touch_updated_at ON public.organization_applications;
CREATE TRIGGER org_apps_touch_updated_at BEFORE UPDATE ON public.organization_applications FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

DROP TRIGGER IF EXISTS branches_touch_updated_at ON public.branches;
CREATE TRIGGER branches_touch_updated_at BEFORE UPDATE ON public.branches FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

DROP TRIGGER IF EXISTS memberships_touch_updated_at ON public.organization_memberships;
CREATE TRIGGER memberships_touch_updated_at BEFORE UPDATE ON public.organization_memberships FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

DROP TRIGGER IF EXISTS clinic_clients_touch_updated_at ON public.clinic_clients;
CREATE TRIGGER clinic_clients_touch_updated_at BEFORE UPDATE ON public.clinic_clients FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

DROP TRIGGER IF EXISTS doctor_branch_assignments_touch_updated_at ON public.doctor_branch_assignments;
CREATE TRIGGER doctor_branch_assignments_touch_updated_at BEFORE UPDATE ON public.doctor_branch_assignments FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

DROP TRIGGER IF EXISTS doctor_schedules_touch_updated_at ON public.doctor_schedules;
CREATE TRIGGER doctor_schedules_touch_updated_at BEFORE UPDATE ON public.doctor_schedules FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

DROP TRIGGER IF EXISTS appointments_touch_updated_at ON public.appointments;
CREATE TRIGGER appointments_touch_updated_at BEFORE UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
