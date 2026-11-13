# PET CONNECT — Database RPC Contracts & Security Specification

**Document Status:** Phase 2 Implemented RPC Interface Contract (Synced with `20261113040000` & `20261113045000`)  
**Execution Principle:** All state transitions, clinical writes, membership mutations, and chat sends execute strictly through PostgreSQL `SECURITY DEFINER` RPCs with `SET search_path = ''`. Direct table `INSERT`/`UPDATE`/`DELETE` grants on workflow and clinical tables are revoked from `authenticated` and `anon`.

---

## 1. Universal RPC Security Standards

Every RPC defined in this specification MUST obey:
1. `SECURITY DEFINER` owned by a non-exposed migration/owner role, with `SET search_path = ''` and fully schema-qualified table/function references (`public.*`, `app.*`, `auth.uid()`).
2. `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon;` and `GRANT EXECUTE ON FUNCTION ... TO authenticated;` (zero `anon` execution).
3. Mandatory authentication guard at line 1:
   - `IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;`
4. Explicit tenant & branch permission verification via `app.is_platform_admin()`, `app.has_org_permission(...)`, `app.has_branch_access(...)`, or `app.current_clinic_client_id(...)`.
5. Concurrency row locking (`SELECT ... FOR UPDATE`) before reading mutable workflow state.
6. Atomic audit logging (`INSERT INTO public.audit_logs`) and notification enqueueing (`app.enqueue_notification(...)`) inside the same transaction.

### Standard PostgreSQL Error Codes Returned to Frontend Repositories

| SQLSTATE | Meaning | Frontend Handling |
|---|---|---|
| `28000` | Unauthenticated (`auth.uid() IS NULL`) | Redirect to `/login` |
| `42501` | Insufficient privileges / cross-tenant / suspended org | Display access denied (`403`) |
| `P0002` | Target entity not found (or invisible to caller) | Display not found (`404`) |
| `22023` | Invalid state transition / invalid input / expired window | Show domain validation message |
| `23P01` | GiST exclusion violation (double-booked doctor slot) | Show `"This time slot is no longer available"` and refresh slots |
| `23505` | Unique violation (duplicate membership, duplicate consultation activation, duplicate email) | Handle idempotently or inform user |

---

## 2. Platform & Organization Onboarding RPCs

| RPC Signature | Caller Authority | State Transition & Validation | Side Effects |
|---|---|---|---|
| `public.get_my_context() RETURNS jsonb` | Any `authenticated` user | Reads `auth.uid()`, `profiles`, `platform_admins`, active `organization_memberships` (+ resolved roles & permission arrays), and `clinic_clients` rows across orgs. | Read-only (`STABLE`). |
| `public.submit_organization_application(p_proposed_name text, p_proposed_slug text, p_legal_name text, p_contact_email text, p_phone text, p_country text, p_timezone text, p_branch_name text, p_branch_code text, p_branch_address text, p_documents jsonb DEFAULT '[]') RETURNS uuid` | Any `authenticated` user | Validates unique `proposed_slug` (`23505` if taken in active orgs or pending apps) and non-empty clinic details (`22023`). Inserts `organization_applications` with `status = 'pending'`. | Inserts `audit_logs` (`organization_id = NULL`). |
| `public.approve_organization_application(p_application_id uuid) RETURNS uuid` | `platform_admin` (`42501` otherwise) | Locks application row (`FOR UPDATE`), verifies `status = 'pending'` (`22023`). Creates `organizations (status='active')`, initial `branches (is_active=true)`, `organization_memberships (status='active')`, and `membership_roles ('org_owner')`. Marks application `'approved'`. | Updates app, writes `audit_logs` & `notifications` to applicant. Returns `organization_id`. |
| `public.reject_organization_application(p_application_id uuid, p_reason text) RETURNS void` | `platform_admin` (`42501` otherwise) | Locks row, requires `status = 'pending'` and non-blank `p_reason`. Sets `status = 'rejected'`. | Writes `audit_logs` & `notifications`. |
| `public.suspend_organization(p_organization_id uuid, p_reason text) RETURNS void` | `platform_admin` | Locks org, sets `status = 'suspended'`. Immediately invalidates `app.is_org_active()` for all members/clients. | Writes `audit_logs`. |
| `public.reactivate_organization(p_organization_id uuid) RETURNS void` | `platform_admin` | Locks org, sets `status = 'active'` from `'suspended'`. | Writes `audit_logs`. |

---

## 3. Organization Staff, Branch & Client Onboarding RPCs

| RPC Signature | Caller Authority | State Transition & Validation | Side Effects |
|---|---|---|---|
| `public.create_or_update_branch(p_organization_id uuid, p_branch_id uuid, p_name text, p_code text, p_timezone text, p_address text, p_phone text, p_is_active boolean) RETURNS uuid` | `branch.manage` in `p_organization_id` | Inserts or updates branch scoped to `p_organization_id`; enforces unique `(organization_id, code)`. | Writes `audit_logs`. |
| `public.invite_member(p_organization_id uuid, p_email text, p_role_codes text[], p_branch_ids uuid[] DEFAULT '{}') RETURNS jsonb` | `staff.manage` (and `roles.assign_admin` if `'org_admin'`/`'org_owner'` requested) | Prevents non-owners from granting `org_owner`/`org_admin` (`42501`). Generates single-use `sha256` hashed token (7-day expiry) and returns `{ invitation_id, token, expires_at }`. | Inserts `staff_invitations` + `audit_logs`. |
| `public.accept_invitation(p_token text) RETURNS uuid` | Authenticated user whose profile email matches invitation | Verifies token hash (`pg_catalog.sha256`), expiration, and unused/unrevoked status (`FOR UPDATE`). Creates/activates `organization_memberships`, assigns roles & branches, and if `doctor` role is present, ensures `doctor_profiles (organization_id, user_id)`. | Marks invitation accepted, writes `audit_logs`. Returns `organization_id`. |
| `public.set_member_roles(p_membership_id uuid, p_role_codes text[], p_branch_ids uuid[]) RETURNS void` | `staff.manage` (plus `roles.assign_admin` for admin roles) | Enforces caller cannot escalate above own privilege and cannot remove the last active `org_owner` (`22023`). | Updates `membership_roles` & `membership_branches`, writes `audit_logs`. |
| `public.suspend_member(p_membership_id uuid, p_reason text) RETURNS void` | `staff.manage` | Prevents self-lockout if caller is target. Sets `status = 'suspended'`. | Writes `audit_logs`. |
| `public.assign_doctor_to_branch(p_organization_id uuid, p_doctor_profile_id uuid, p_branch_id uuid, p_is_active boolean) RETURNS void` | `staff.manage` | Validates doctor & branch belong to `p_organization_id`. Upserts `doctor_branch_assignments`. | Writes `audit_logs`. |
| `public.update_doctor_self_profile(p_organization_id uuid, p_bio text, p_qualification text, p_specialization text, p_experience_years int, p_registration_number text) RETURNS void` | Active `doctor` in `p_organization_id` | Allows updating own clinical profile bio/qualification/specialization only; `is_active` and `consultation_fee` remain admin-only (`SEC-10`). | Writes `audit_logs`. |
| `public.admin_update_doctor_governance(p_doctor_profile_id uuid, p_is_active boolean, p_consultation_fee numeric, p_display_name text) RETURNS void` | `staff.manage` | Updates governance fields (`is_active`, `consultation_fee`, `display_name`) safely inside `SECURITY DEFINER` context. | Writes `audit_logs` (`before`/`after`). |
| `public.request_clinic_join(p_organization_id uuid) RETURNS uuid` | Any `authenticated` user | Checks org is `'active'`. Upserts/inserts `clinic_clients` with `status = 'requested'` using `profiles` snapshot. Returns existing ID if `'approved'`; fails (`42501`) if `'suspended'`. | Writes `audit_logs`. |
| `public.approve_clinic_client(p_clinic_client_id uuid) RETURNS void` | `clients.approve` in org | Locks row, sets `status = 'approved'`, `approved_by = auth.uid()`, `approved_at = now()`. | Writes `audit_logs` & notifies client. |
| `public.reject_clinic_client(p_clinic_client_id uuid, p_reason text) RETURNS void` | `clients.approve` in org | Locks row, requires reason, sets `status = 'rejected'`. | Writes `audit_logs`. |
| `public.create_walk_in_client(p_organization_id uuid, p_full_name text, p_phone text, p_email text DEFAULT NULL) RETURNS uuid` | `clients.approve` in org | Creates `clinic_clients` with `user_id = NULL`, `status = 'approved'`, `approved_by = auth.uid()`. | Writes `audit_logs`. |

---

## 4. Pets, Guardians & Doctor Scheduling RPCs

| RPC Signature | Caller Authority | Validation & Behavior | Side Effects |
|---|---|---|---|
| `public.create_pet(p_organization_id uuid, p_clinic_client_id uuid, p_name text, p_species text, p_breed text, p_gender text, p_weight numeric, p_dob date, p_color text, p_allergies text, p_medical_notes text) RETURNS uuid` | Approved `clinic_client` (self) OR staff with `pets.write` | Validates `p_clinic_client_id` belongs to `p_organization_id` and is `'approved'`. Inserts `pets` + primary `pet_guardians` row atomically. | Writes `audit_logs`. |
| `public.update_pet(p_pet_id uuid, p_updates jsonb) RETURNS void` | `is_pet_guardian` OR `pets.write` | Updates demographic/clinical summary fields only (`organization_id` immutable). | Writes `audit_logs` (`before`/`after`). |
| `public.archive_pet(p_pet_id uuid, p_reason text) RETURNS void` | `pets.write` (staff) OR guardian (only if zero open appointments/consultations) | Sets `archived_at = now()` instead of `DELETE`, preserving clinical history (`SEC-16`). | Writes `audit_logs`. |
| `public.add_pet_guardian(p_pet_id uuid, p_clinic_client_id uuid, p_relationship text) RETURNS void` | `pets.write` (staff only) | Ensures both `pet` and `clinic_client` belong to same `organization_id` and client is `'approved'`. | Writes `audit_logs`. |
| `public.upsert_doctor_schedule(p_organization_id uuid, p_branch_id uuid, p_doctor_profile_id uuid, p_weekday smallint, p_start_time time, p_end_time time, p_slot_minutes smallint, p_is_active boolean) RETURNS uuid` | `schedules.manage` (or self doctor for assigned branch) | Validates `doctor_branch_assignments` active for `(p_doctor_profile_id, p_branch_id)` and `p_end_time > p_start_time`. | Writes `audit_logs`. |
| `public.add_schedule_exception(p_organization_id uuid, p_doctor_profile_id uuid, p_branch_id uuid, p_start_at timestamptz, p_end_at timestamptz, p_exception_type text, p_reason text) RETURNS uuid` | `schedules.manage` (or self doctor) | Stores leave/override window in UTC `timestamptz`. | Writes `audit_logs`. |
| `public.get_available_slots(p_organization_id uuid, p_branch_id uuid, p_doctor_profile_id uuid, p_date date) RETURNS TABLE(slot_start timestamptz, slot_end timestamptz)` | Approved `clinic_client` or org staff | Converts branch local schedule (`branches.timezone`) for `p_date` into `timestamptz` slots, subtracts `doctor_schedule_exceptions`, and excludes confirmed/checked-in `appointments` (`scheduled_range && slot`). Pending `'requested'` appointments are **not** excluded. | Read-only (`STABLE`). |

---

## 5. Appointment & Consultation Workflow RPCs

### 5.1 Appointment Workflow (Requests Do Not Reserve; Front Desk / Admin Confirms)

| RPC Signature | Caller Authority | Validation & State Machine | Side Effects |
|---|---|---|---|
| `public.request_appointment(p_organization_id uuid, p_branch_id uuid, p_pet_id uuid, p_doctor_profile_id uuid, p_requested_start timestamptz, p_requested_end timestamptz, p_reason text) RETURNS uuid` | Approved `clinic_client` (guardian of `p_pet_id`) OR `appointments.confirm` staff | Checks active org & branch, doctor active & assigned to branch, approved client & valid guardianship. Inserts `appointments` with `status = 'requested'`, `scheduled_range = NULL`. Does **not** block any slot. | Inserts `appointment_status_history`, `audit_logs`, notifies branch `front_desk`. |
| `public.confirm_appointment(p_appointment_id uuid, p_confirmed_start timestamptz, p_confirmed_end timestamptz, p_doctor_profile_id uuid DEFAULT NULL) RETURNS public.appointments` | Staff with `appointments.confirm` (`front_desk`, `branch_manager`, `org_admin`, `org_owner`) for the appointment's branch | `SELECT ... FOR UPDATE`. Requires `status = 'requested'`. Revalidates inside transaction: (1) doctor active & assigned to branch; (2) confirmed range aligns with branch schedule & no schedule exception; (3) `clinic_clients.status = 'approved'` & pet active. Updates `status = 'confirmed'`, `scheduled_range = tstzrange(p_confirmed_start, p_confirmed_end, '[)')`, `confirmed_by = auth.uid()`. Exclusion constraint `no_double_booking` raises `23P01` on overlap. | Inserts `appointment_status_history`, `audit_logs`, notifies client & doctor. |
| `public.decline_appointment(p_appointment_id uuid, p_reason text) RETURNS void` | `appointments.confirm` | Locks row, requires `status = 'requested'` & non-empty reason. Sets `status = 'declined'`. | History, audit, notification. |
| `public.cancel_appointment(p_appointment_id uuid, p_reason text) RETURNS void` | Client guardian (`requested`/`confirmed` before start) OR `appointments.confirm` | Locks row, validates transition from `requested` or `confirmed` → `cancelled` (`scheduled_range` freed automatically because exclusion WHERE clause covers only `confirmed`/`checked_in`). | History, audit, notification. |
| `public.reschedule_appointment(p_appointment_id uuid, p_new_start timestamptz, p_new_end timestamptz) RETURNS public.appointments` | `appointments.confirm` | Locks row, requires `confirmed`, revalidates doctor schedule/exceptions and updates `scheduled_range` (`23P01` if conflict). | History, audit, notifications. |
| `public.check_in_appointment(p_appointment_id uuid) RETURNS public.appointments` / `complete_appointment(...)` / `mark_no_show(...)` | `appointments.confirm` (or assigned `doctor` for `complete_appointment`) | Locks row, enforces `confirmed → checked_in → completed` or `confirmed → no_show`. | History, audit. |

### 5.2 Consultation Lifecycle (Appointment Mandatory Before Activation; 7-Day Window)

| RPC Signature | Caller Authority | Validation & State Machine | Side Effects |
|---|---|---|---|
| `public.activate_consultation(p_consultation_id uuid) RETURNS public.consultations` | Assigned `doctor` (`doctor_profiles.user_id = auth.uid() AND is_active = true`) OR org staff with `consultations.activate` (`org_admin`/`org_owner`) in same `organization_id`. Clients strictly `42501`. | Locks `consultations` row (`FOR UPDATE`). Checks org active, `consultation_status = 'pending'` (`22023` if already active/expired/completed/rejected), and **enforces linked `appointment_id` exists in the same `(organization_id, branch_id)` with `appointments.status IN ('confirmed', 'checked_in', 'completed')`** (`22023` if missing or unconfirmed). Sets `consultation_status = 'active'`, `activated_at = now()`, `expires_at = activated_at + INTERVAL '7 days'`, `activated_by = auth.uid()`. Inserts 1:1 `chat_conversations` (`ON CONFLICT DO NOTHING`). | Inserts `chat_conversations`, `audit_logs`, notifies client & doctor. |
| `public.create_consultation_from_appointment(p_appointment_id uuid, p_reason text DEFAULT NULL, p_activate_immediately boolean DEFAULT false) RETURNS public.consultations` | Assigned `doctor` or `consultations.activate` | Verifies appointment belongs to caller's org and is `confirmed`, `checked_in`, or `completed`. Creates `consultations` linked to `appointment_id` (and optionally invokes activation atomically). Prevents duplicate open consultation per appointment (`UNIQUE` or check). | Inserts consultation (and if activated, conversation + audit + notifications). |
| `public.reject_consultation(p_consultation_id uuid, p_reason text) RETURNS void` | Assigned `doctor` or `consultations.manage` | Locks row, requires `pending`, requires reason, sets `rejected`, `rejected_by = auth.uid()`. | Audit + notification. |
| `public.complete_consultation(p_consultation_id uuid) RETURNS void` | Assigned `doctor` or `consultations.manage` | Locks row, requires `active`, sets `completed`, `completed_at = now()`, `completed_by = auth.uid()`. Does not overwrite `activated_at` or `expires_at`. | Audit + notification. |
| `public.reassign_consultation(p_consultation_id uuid, p_new_doctor_profile_id uuid, p_reason text) RETURNS void` | `org_owner` or `org_admin` (`consultations.manage`) | Locks consultation, validates new doctor is active in same `organization_id` (and assigned to branch). Updates `consultations.doctor_id` **and** keeps `chat_conversations.doctor_id` synchronized atomically. | Audit (`before`/`after` doctor IDs) + notification. |

---

## 6. Chat & Clinical Documentation RPCs

| RPC Signature | Caller Authority | Validation & Behavior | Side Effects |
|---|---|---|---|
| `public.send_chat_message(p_conversation_id uuid, p_message_type message_type_enum, p_content text, p_attachment_ids uuid[] DEFAULT '{}') RETURNS public.chat_messages` | Strictly consultation `client` (`clinic_clients.user_id = auth.uid()`) OR treating `doctor` (`doctor_profiles.user_id = auth.uid()`) | Locks/reads consultation. Enforces: org active, caller is participant (`42501`), `consultation_status = 'active'`, `activated_at IS NOT NULL`, `expires_at IS NOT NULL`, and **`now() < expires_at`** (server time; raises `22023` if expired). Validates attachments belong to same `(organization_id, consultation_id)` (zero `blob:` URLs). | Inserts `chat_messages` + `message_attachments`, enqueues recipient notification. |
| `public.mark_messages_read(p_conversation_id uuid, p_up_to timestamptz) RETURNS int` | Consultation participant | Updates `read_at = now()` where `sender_id <> auth.uid()` and `read_at IS NULL` and `created_at <= p_up_to`. | Returns updated count. |
| `public.issue_prescription(p_organization_id uuid, p_pet_id uuid, p_consultation_id uuid, p_appointment_id uuid, p_diagnosis text, p_instructions text, p_follow_up_date date, p_items jsonb) RETURNS uuid` | Active `doctor` in `p_organization_id` (`medical_records.write`) | Requires at least one of `p_consultation_id` or `p_appointment_id` belonging to `(p_organization_id, p_pet_id)`. Derives `doctor_id` from caller's `doctor_profiles` in `p_organization_id` (never trusts client-supplied `doctor_id`). Validates `jsonb_array_length(p_items) >= 1`. Inserts `prescriptions` + `prescription_items` **atomically** in one transaction. | Inserts Rx + items + `audit_logs` + notifies guardian. |
| `public.void_prescription(p_prescription_id uuid, p_reason text) RETURNS void` | Prescribing `doctor` or `org_admin` (`consultations.manage`) | Marks `status = 'void'`, `voided_by = auth.uid()`, `voided_at = now()`, `void_reason = p_reason` (prescriptions are never deleted). | Writes `audit_logs`. |
| `public.register_attachment(p_organization_id uuid, p_entity_type text, p_entity_id uuid, p_object_path text, p_mime_type text, p_byte_size bigint, p_original_filename text) RETURNS uuid` | Org member / guardian / consultation participant depending on `p_entity_type` | Validates `{org_id}/` prefix, active org, MIME/size constraints, and target authorization before inserting `public.attachments`. | Inserts `attachments`. |
| `public.add_medical_record(p_organization_id uuid, p_pet_id uuid, p_consultation_id uuid, p_record_type medical_record_type_enum, p_diagnosis text, p_notes text) RETURNS uuid` | Active `doctor` in `p_organization_id` (`medical_records.write`) | Validates pet belongs to `p_organization_id` (and consultation matches `(org, pet)` if provided). Sets `doctor_id` & `created_by` strictly from caller. | Inserts `medical_records`, writes `audit_logs`. |
| `public.amend_medical_record(p_original_record_id uuid, p_diagnosis text, p_notes text) RETURNS uuid` | Active org `doctor` (`medical_records.write`) | Creates an append-only addendum row with `amended_from_id = p_original_record_id` rather than overwriting clinical history. | Writes `audit_logs`. |
| `public.record_vaccination(p_organization_id uuid, p_pet_id uuid, p_vaccine_name text, p_administered_date date, p_next_due_date date, p_batch_number text, p_notes text) RETURNS uuid` | Active `doctor` in `p_organization_id` (`medical_records.write`) | Validates pet belongs to `p_organization_id` and `next_due_date IS NULL OR next_due_date >= administered_date`. Sets `doctor_profile_id` and `created_by` from caller. | Inserts `vaccinations` + `audit_logs`. |

---

## 7. Legacy Functions Scheduled for Deprecation / Removal

| Existing Function | Phase 2 Action | Reason |
|---|---|---|
| `public.cleanup_test_records(uuid[])` (from `003`) | **DROP immediately** in Phase 2a hardening | Destructive `SECURITY DEFINER` path capable of deleting chat/audit records (`SEC-11`). |
| `public.is_admin()` / `public.is_doctor()` | Deprecate after Phase 2c/3 policy switch; **DROP** in contract phase | Monolithic global checks incompatible with multi-tenancy (`SEC-05`, `SEC-07`). |
| `public.handle_new_user()` | Replace with profile-only creation + verified trigger | Existing body grants global `'client'` role without clinic approval (`SEC-20`). |
