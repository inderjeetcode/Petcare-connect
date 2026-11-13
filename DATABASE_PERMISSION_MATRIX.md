# PET CONNECT — Database Permission & Row-Level Security Matrix

**Document Status:** Phase 2 Database-Enforced Authorization Specification (Synced with `supabase/migrations/20261113070000_phase2e_switch_rls_policies.sql`)  
**Enforcement Standard:** Every table enables Row Level Security (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`), uses explicit `TO authenticated` policies (zero `anon` access to base tables), and restricts mutations to `SECURITY DEFINER` RPCs where state transitions or clinical integrity apply.

---

## 1. Principals & Role Model

Pet Connect separates **Platform Governance**, **Organization Staff Roles**, and **Clinic Client Access**:

| Principal / Role | Scope | Source Table | Summary |
|---|---|---|---|
| **anon** | Unauthenticated | — | Zero base-table read/write access. Can read only an explicit public clinic/doctor directory view if intentionally published (`display_name`, `specialization`, `branch_name` — no personal email/phone). |
| **Platform Owner** (`platform_admin`) | Global (Platform) | `public.platform_admins` | Reviews `organization_applications`, activates/suspends `organizations`, views platform health & platform audit logs. **Zero clinical data access** (`pets`, `appointments`, `consultations`, `chat_*`, `medical_records`, `prescriptions`, `vaccinations`). |
| **org_owner** | Single Organization | `organization_memberships` + `membership_roles` | Full tenant governance: branches, org settings, staff roles (including assigning `org_admin`), client approvals, appointments, operational audit logs. **No read access to expired consultation chats unless personally the treating doctor.** |
| **org_admin** | Single Organization | `organization_memberships` + `membership_roles` | Manages branches, doctors, schedules, `front_desk`, `clinic_clients` approvals, appointments, and org audit logs. **Cannot read expired chat history unless personally the treating doctor.** Cannot promote to `org_owner` or `platform_admin`. |
| **branch_manager** | Assigned Branch(es) within Org | `organization_memberships` + `membership_branches` | Manages branch schedules, branch appointments, branch doctors, and walk-in/client onboarding within assigned branches. **No expired chat access.** |
| **doctor** | Single Organization (+ Assigned Branches for scheduling) | `organization_memberships` + `doctor_profiles` + `doctor_branch_assignments` | **All active doctors in an organization can read that organization's clinical records** (`medical_records`, `vaccinations`, `prescriptions`, `prescription_items`, `pets`). Manages own schedule/clinical writes, activates consultations for eligible appointments, and participates in assigned consultation chats. |
| **front_desk** | Assigned Branch(es) or Org | `organization_memberships` + `membership_roles` | Approves/registers `clinic_clients`, creates/confirms/declines/reschedules/checks-in `appointments`. **No access to clinical notes, prescriptions, or consultation chats.** |
| **clinic_client (approved)** | Single Organization | `clinic_clients (status='approved')` | Views own profile, own/guarded `pets` in that org, own `appointments`, own `consultations`, own `prescriptions`, `medical_records`, `vaccinations`, and participates in active chats (read-only after expiry). |
| **clinic_client (pending / rejected / suspended)** | Single Organization | `clinic_clients` | Sees **only** their own `clinic_clients` membership status row. **Zero** access to doctors, slots, pets, appointments, or clinical data. |

---

## 2. Permission Catalogue (`permissions` & `role_permissions`)

| Permission Code | Description | Granted To (System Roles) |
|---|---|---|
| `org.manage` | Edit org profile, settings, transfer ownership | `org_owner` |
| `branch.manage` | Create/update branches | `org_owner`, `org_admin` |
| `staff.manage` | Invite staff, manage `organization_memberships` & doctor assignments | `org_owner`, `org_admin` |
| `roles.assign_admin` | Grant/revoke `org_admin` role | `org_owner` |
| `clients.approve` | Approve/reject/suspend `clinic_clients` and create walk-ins | `org_owner`, `org_admin`, `branch_manager`, `front_desk` |
| `clients.read` | Read organization `clinic_clients` directory | `org_owner`, `org_admin`, `branch_manager`, `front_desk`, `doctor` |
| `pets.read` | Read organization `pets` & `pet_guardians` | `org_owner`, `org_admin`, `branch_manager`, `front_desk`, `doctor` |
| `pets.write` | Create/update/archive `pets` and manage guardians | `org_owner`, `org_admin`, `branch_manager`, `front_desk`, `doctor` |
| `schedules.manage` | Manage doctor schedules & exceptions | `org_owner`, `org_admin`, `branch_manager`, `doctor` (own only) |
| `appointments.confirm` | Confirm/decline/check-in/complete/no-show appointments | `org_owner`, `org_admin`, `branch_manager`, `front_desk` |
| `appointments.read` | View organization/branch appointments | `org_owner`, `org_admin`, `branch_manager`, `front_desk`, `doctor` |
| `consultations.activate` | Activate 7-day consultation from eligible appointment | `org_owner`, `org_admin`, `doctor` (assigned or org-authorized) |
| `consultations.manage` | Complete, reject, or reassign consultations | `org_owner`, `org_admin`, `doctor` |
| `medical_records.read` | Read clinical history (`medical_records`, `vaccinations`, `prescriptions`, `prescription_items`) across org | `doctor` (and read-only summary for `org_owner`/`org_admin` if explicitly configured — clinical care scope guaranteed for all org doctors) |
| `medical_records.write` | Issue prescriptions, add/amend medical records, record vaccinations | `doctor` |
| `audit.read` | Read organization `audit_logs` | `org_owner`, `org_admin` |

> **Key Policy Rule (D-17 Confirmed):** Every active `doctor` holding `medical_records.read` within `organization_id` can read all clinical records (`pets`, `medical_records`, `vaccinations`, `prescriptions`, `prescription_items`) belonging to **that same `organization_id`**, and **zero** records belonging to any other organization.
>
> **Key Policy Rule (D-16 Confirmed):** `chat_conversations` and `chat_messages` are **never** covered by a broad `org_admin` / `org_owner` or `platform_admin` SELECT policy. Expired (and active) consultation chats are readable **exclusively** by the consultation's `client` (`user_id = auth.uid()` on `clinic_clients`) and the consultation's treating `doctor` (`doctor_profiles.user_id = auth.uid()`).

---

## 3. Helper Functions (`app` Schema)

All RLS policies call `STABLE SECURITY DEFINER` helpers with `SET search_path = ''`:

- `app.is_platform_admin() -> boolean`
- `app.is_org_active(p_org_id uuid) -> boolean`
- `app.is_org_member(p_org_id uuid) -> boolean` (requires `membership.status = 'active'` AND `organization.status = 'active'`)
- `app.has_org_permission(p_org_id uuid, p_perm text) -> boolean`
- `app.has_branch_access(p_org_id uuid, p_branch_id uuid, p_perm text) -> boolean`
- `app.current_clinic_client_id(p_org_id uuid) -> uuid` (returns `id` only when `clinic_clients.status = 'approved'` and org is active)
- `app.is_pet_guardian(p_org_id uuid, p_pet_id uuid) -> boolean`
- `app.is_consultation_participant(p_consultation_id uuid) -> boolean` (strictly `client` user_id = `auth.uid()` OR treating `doctor` user_id = `auth.uid()`, within active org)

---

## 4. Complete Table-by-Table Access Matrix

Legend: **R** = SELECT via RLS · **RPC** = Mutated only via hardened `SECURITY DEFINER` RPC (direct INSERT/UPDATE/DELETE revoked from `authenticated`) · **Self** = Own record only · **Org** = Own `organization_id` only · **Branch** = Assigned `branch_id` (or full org if unscoped) · **Treating** = Assigned consultation participant only · **—** = Denied.

| Table | anon | Platform Owner | org_owner / org_admin | branch_manager | front_desk | doctor | clinic_client (approved) | clinic_client (pending) |
|---|---|---|---|---|---|---|---|---|
| `profiles` | — | R (meta/applicants) | R (self + org staff/clients) | R (self + org staff/clients) | R (self + org staff/clients) | R (self + org staff/clients) | R (self + active org doctors) / direct `UPDATE` (non-email only, guarded by `tg_profiles_guard_identity`) | R (self) |
| `platform_admins` | — | R (self) | — | — | — | — | — | — |
| `organization_applications` | — | R / RPC (approve/reject) | — | — | — | — | R (own submitted) / RPC (submit) | R (own submitted) / RPC (submit) |
| `organizations` | — | R / RPC (suspend/reactivate) | R (Org) | R (Org) | R (Org) | R (Org) | R (active/joined) | R (active/requested) |
| `branches` | — | R (Org meta) | R (Org) / RPC (manage) | R (Org) | R (Org) | R (Org) | R (active branches of approved org) | — |
| `organization_memberships` | — | — | R (Org) / RPC (manage) | R (Org) | R (Org) | R (Org) | — | — |
| `membership_roles` / `membership_branches` | — | — | R (Org) / RPC (set) | R (Org) | R (Org) | R (Org) | — | — |
| `organization_roles` / `permissions` / `role_permissions` | — | R | R | R | R | R | R (catalogue only) | R (catalogue only) |
| `staff_invitations` | — | — | R (Org) / RPC (`invite_member`) | — | — | — | — | — |
| `clinic_clients` | — | — | R (Org) / RPC (approve/reject) | R (Org) / RPC (approve) | R (Org) / RPC (approve/walk-in) | R (Org) | R (self row) | R (self status row) |
| `pets` | — | **—** | R (Org) / RPC | R (Org) / RPC | R (Org) / RPC | **R (all Org pets)** / RPC | R (guardian pets in Org) / RPC (create/update/archive) | **—** |
| `pet_guardians` | — | **—** | R (Org) / RPC | R (Org) / RPC | R (Org) / RPC | R (Org) | R (own guardianship) | **—** |
| `doctor_profiles` | — | — | R (Org) / RPC (fee, active) | R (Org) | R (Org) | R (Org) / RPC (bio/qual only) | R (active Org doctors) | **—** |
| `doctor_branch_assignments` | — | — | R (Org) / RPC | R (Org) | R (Org) | R (Org) | R (active Org assignments) | **—** |
| `doctor_schedules` | — | **—** | R (Org) / RPC | R (Org) / RPC | R (Org) | R (Org) / RPC (own) | R (active Org schedules) | **—** |
| `doctor_schedule_exceptions` | — | **—** | R (Org) / RPC | R (Org) / RPC | R (Org) | R (Org) / RPC (own) | **—** | **—** |
| `appointments` | — | **—** | R (Org) / RPC (confirm/decline/cancel/reschedule) | R (Branch) / RPC (branch-scoped) | R (Branch/Org) / RPC (confirm/check-in) | R (Org/Branch) | R (own/pet in Org) / RPC (request/cancel) | **—** |
| `appointment_status_history` | — | **—** | R (Org) | R (Branch) | R (Branch/Org) | R (Org/Branch) | R (own appointments) | **—** |
| `consultations` | — | **—** | R (Org) / RPC (activate/complete/reassign) | R (Branch) | R (Branch/Org metadata) | **R (Org clinical)** / RPC (activate/complete/reject) | R (own in Org) | **—** |
| `consultation_payments` | — | **—** | R (Org, `audit.read`) | **—** | **—** | **—** | R (own consultation payments) | **—** |
| `chat_conversations` | — | **—** | **—** *(unless treating doctor)* | **—** | **—** | **R (Treating ONLY)** | **R (Participant ONLY)** | **—** |
| `chat_messages` | — | **—** | **—** *(unless treating doctor)* | **—** | **—** | **R (Treating ONLY, incl. expired)** / RPC send (`active` & `< expires_at`) | **R (Participant ONLY, incl. expired)** / RPC send (`active` & `< expires_at`) | **—** |
| `prescriptions` & `prescription_items` | — | **—** | **—** *(requires `medical_records.read`)* | **—** | **—** | **R (all Org)** / RPC (`issue`, `void`) | R (guardian pets in Org) | **—** |
| `medical_records` | — | **—** | **—** *(requires `medical_records.read`)* | **—** | **—** | **R (all Org)** / RPC (`add`, `amend`) | R (guardian pets in Org) | **—** |
| `vaccinations` | — | **—** | **—** *(requires `medical_records.read`)* | **—** | **—** | **R (all Org)** / RPC (`record`) | R (guardian pets in Org) | **—** |
| `attachments` & `message_attachments` | — | R (`application` only) | R (`pet` only; **chat/clinical excluded**) | R (`pet` only) | R (`pet` only) | R (`pet` + `medical_record`; **chat/cons Treating ONLY**) | R (guardian pets/records; **chat/cons Participant ONLY**) | **—** |
| `reviews` | — | **—** | R (Org) | R (Org) | R (Org) | R (Org) | **—** | **—** |
| `notifications` | — | R (self) | R (self) / mark read | R (self) / mark read | R (self) / mark read | R (self) / mark read | R (self) / mark read | R (self) / mark read |
| `audit_logs` | — | R (platform events only, `organization_id IS NULL`) | R (Org, `organization_id IS NOT NULL`) | — | — | — | — | — |

---

## 5. Storage Bucket Matrix (`storage.objects`)

Bucket: `clinical-files` (Private; `public = false`; 10 MiB limit; MIME allow-list: `image/jpeg`, `image/png`, `image/webp`, `application/pdf`).

| Path Prefix | Upload Authority | Download / Signed URL Authority |
|---|---|---|
| `{org_id}/pets/{pet_id}/*` | Approved pet guardian (`pets.write`) or org doctor/staff | Pet guardian or any active `doctor` in `{org_id}` |
| `{org_id}/medical_records/{record_id}/*` | Prescribing/treating `doctor` in `{org_id}` via signed upload | Pet guardian or any active `doctor` in `{org_id}` |
| `{org_id}/consultations/{consultation_id}/*` | Consultation participant (`client` or treating `doctor`) while consultation is `active` and `now() < expires_at` | **Strictly consultation `client` or treating `doctor`** (matches D-16 rule even after expiry) |
| `{org_id}/applications/{app_id}/*` | Authenticated applicant | Applicant or `platform_admins` |

---

## 6. Explicit Invariants Verified Against Phase 1 Requirements

1. **Zero Cross-Tenant Leakage:** Every tenant table policy checks `organization_id` plus `app.is_org_active(organization_id)`, backed by composite foreign keys `(fk_id, organization_id)`.
2. **All Org Doctors Read Org Clinical Records:** `medical_records`, `vaccinations`, `prescriptions`, `prescription_items`, and `pets` grant `SELECT` to any active `doctor` in that `organization_id` via `app.has_org_permission(organization_id, 'medical_records.read')`.
3. **Strict Chat Privacy (Active & Expired):** `chat_conversations`, `chat_messages`, and consultation chat attachments verify `app.is_consultation_participant(consultation_id)`. Neither `org_admin`, `org_owner`, `front_desk`, `branch_manager`, nor `platform_admin` can read another doctor's consultation chat history.
4. **7-Day Chat Write Lock:** `send_chat_message()` and `chat_messages` RLS enforce `consultation_status = 'active' AND activated_at IS NOT NULL AND expires_at IS NOT NULL AND now() < expires_at`.
5. **Appointment Confirmation Segregation:** Only `front_desk`, `branch_manager`, `org_admin`, or `org_owner` holding `appointments.confirm` can confirm appointments. Clients cannot self-confirm; unconfirmed requests never reserve slots.
6. **Platform Owner Isolation:** `platform_admins` cannot pass `app.is_org_member()`, `app.has_org_permission()`, or `app.is_consultation_participant()`, guaranteeing zero access to patient clinical or chat data.
