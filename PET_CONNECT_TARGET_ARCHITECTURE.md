# PET CONNECT — Target Multi-Tenant SaaS Architecture

**Document Status:** Phase 1 Architecture Specification (Approved Baseline)  
**Pilot Tenant:** **MaxPetZ** (`maxpetz`)  
**Scope:** Multi-tenant SaaS veterinary clinic, appointment scheduling, tele-consultation chat, and clinical record platform.

---

## 1. Architectural Strategy: Strangler Evolution

Pet Connect evolves from its existing React 19 + Vite 8 + TypeScript + Tailwind CSS 4 + Supabase PostgreSQL baseline through a controlled strangler migration rather than a ground-up UI rewrite:

- **Preserve:** Visual design system, React portal layouts/pages (~78% of existing UI markup), Supabase Auth + PostgreSQL + Realtime + Storage platform, normalized clinical entities, and the database-enforced 7-day consultation chat invariant.
- **Replace:** Client-side-only role switching (`currentRole` state in `AppContext`), global monolithic `is_admin()` / `is_doctor()` RLS bypasses, mixed mock/production state fallbacks, direct client writes to workflow tables, and hardcoded environment fallbacks.

---

## 2. Confirmed Business & Governance Decisions

All target schemas, policies, RPCs, and UI portals conform strictly to these confirmed decisions:

1. **Multi-tenant SaaS:** Independent veterinary organizations share a single PostgreSQL cluster with strict logical isolation keyed by `organization_id`.
2. **Initial Pilot Organization:** **MaxPetZ** is the initial pilot organization; verified existing production clinical records belong to MaxPetZ.
3. **Strict Historical Branch Provenance:** Historical branch ownership must be mapped **only from verified source records**. Branch mappings must never be invented or guessed.
4. **Global User Identity, Multi-Org Membership:** One global identity (`auth.users` / `profiles`) per person can belong to multiple organizations as staff and/or approved clinic client.
5. **Organization-Scoped Clinical & Client Records:** `clinic_clients` and `pets` (and all downstream clinical records) remain strictly scoped to a single `organization_id`. There is **no automatic medical-record sharing between organizations**.
6. **Multi-Branch Doctors Within One Organization:** A doctor belongs to an organization via `doctor_profiles (organization_id, user_id)` and can work across multiple branches within that organization via `doctor_branch_assignments`.
7. **Org-Wide Clinical Read for Authorized Doctors:** All authorized doctors in an organization can read that organization's clinical records (`pets`, `medical_records`, `vaccinations`, `prescriptions`, `prescription_items`), strictly bounded to their organization.
8. **Strict Privacy on Expired Chat History:** Expired consultation chat history is readable **only by the consultation's client and treating doctor** (excluding organization admins, other doctors, and platform admins).
9. **Authorized Appointment Confirmation:** Appointment confirmation is performed by authorized **front desk** (`front_desk`) or **clinic admin** (`org_admin` / `org_owner`) staff.
10. **Appointment Mandatory Before Consultation Activation:** A confirmed/completed appointment is mandatory before a 7-day consultation chat can be activated (`consultations.appointment_id NOT NULL` for new consultations).
11. **Fixed 7-Day Chat Window:** Consultation chat access lasts **exactly 7 days** from database-side activation (`expires_at = activated_at + INTERVAL '7 days'`), enforced by CHECK constraint, immutability trigger, RPC logic, and RLS.
12. **No Payment Gateway in v1:** Online payment gateways are excluded from initial release (`organizations.plan_code` reserved for future SaaS billing).

---

## 3. Target Tenancy & Domain Topology

```
auth.users (Supabase Auth — Global Authentication)
  └── 1:1 ── public.profiles (Global User Identity: name, phone, avatar; email read-only mirror)
                │
                ├── platform_admins (Platform Owner — manages orgs & onboarding; ZERO clinical access)
                │
                ├── organization_memberships (user_id × organization_id, status)
                │      ├── membership_roles ── organization_roles ── role_permissions ── permissions
                │      └── membership_branches (optional branch restriction for branch_manager/front_desk)
                │
                └── clinic_clients (organization_id × optional user_id; status: requested|approved|rejected|suspended)
                       └── pet_guardians ── pets (organization_id-scoped)

organizations (Tenant Root: id, slug, display_name, status, timezone, plan_code)
  ├── organization_applications (Self-registration queue reviewed by platform_admins)
  ├── branches (organization_id, code, name, timezone, is_active)
  ├── doctor_profiles (organization_id, user_id, registration_number, is_active)
  │      ├── doctor_branch_assignments (doctor_profile_id × branch_id, organization_id)
  │      ├── doctor_schedules (branch_id, weekday, start_time, end_time, slot_minutes)
  │      └── doctor_schedule_exceptions (leave, closures, overrides)
  ├── appointments (organization_id, branch_id, clinic_client_id, pet_id, doctor_profile_id,
  │                 requested_start, requested_end, scheduled_range tstzrange, status)
  │      └── appointment_status_history (append-only state transitions)
  ├── consultations (organization_id, branch_id, appointment_id, clinic_client_id, doctor_id, pet_id,
  │                  consultation_status, activated_at, expires_at = activated_at + 7 days)
  │      ├── 1:1 chat_conversations
  │      │      └── chat_messages (sender_id, message_type, message_content)
  │      │             └── message_attachments ── attachments (Supabase Storage metadata)
  │      ├── prescriptions ── prescription_items
  │      └── medical_records (clinical_note, lab_report, surgery, discharge, amendments)
  ├── vaccinations (organization_id, pet_id, doctor_profile_id, vaccine_name, batch_number)
  ├── notifications (organization_id, user_id, type, is_read)
  └── audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, before_json, after_json)
```

---

## 4. Tenant Isolation & Database Security Architecture

### 4.1 Defense-in-Depth Layering
1. **Layer 1 — Composite Tenant Foreign Keys:**  
   Every tenant-owned parent table exposes `UNIQUE (id, organization_id)`. Every child table references `(parent_id, organization_id)` via composite foreign keys. Even a privileged connection or buggy RPC is physically prevented by PostgreSQL from linking a consultation, pet, appointment, or prescription across two different organizations.
2. **Layer 2 — Row Level Security (`TO authenticated` Only):**  
   Every application table enables RLS and restricts policies explicitly to `TO authenticated` (revoking `anon` direct table access; public doctor directory uses a curated read-only view if needed). Helper functions live in a dedicated `app` schema (`SECURITY DEFINER`, `STABLE`, `SET search_path = ''`) and are invoked with scalar subqueries `(SELECT app.has_org_permission(...))` so PostgreSQL initializes them cleanly per statement.
3. **Layer 3 — RPC-Only State Transitions:**  
   Direct `INSERT`, `UPDATE`, and `DELETE` grants on workflow and clinical tables (`consultations`, `appointments`, `chat_messages`, `prescriptions`, `medical_records`, `vaccinations`, `clinic_clients`, `organization_memberships`, `audit_logs`) are revoked from `authenticated`. All state transitions execute inside hardened `SECURITY DEFINER` RPCs with `SET search_path = ''`, `SELECT ... FOR UPDATE` row locks, state-machine validation, and atomic server-side audit logging.
4. **Layer 4 — Database Triggers (Invariants):**
   - `consultations_guard_window`: Prevents modifying `activated_at` or `expires_at` once set and blocks backwards transitions from `expired`, `completed`, or `rejected` back to `active`.
   - `profiles_guard_email`: Prevents users from modifying `profiles.email` directly to avoid email squatting and signup conflicts.
   - `set_updated_at`: Maintains `updated_at = now()` on mutable entities.

---

## 5. Core Domain Lifecycles

### 5.1 Organization Onboarding & Tenant Lifecycle
1. Clinic representative signs up (global auth identity) and submits `organization_applications`.
2. **Platform Owner** (`platform_admins`) reviews and runs `approve_organization_application(p_application_id)`:
   - Atomically creates `organizations` (`status = 'active'`), an initial `branches` record, `organization_memberships` (`status = 'active'`), and `membership_roles` (`org_owner`).
3. Suspended organizations (`status = 'suspended'`) immediately fail active-organization checks inside `app.is_org_member()` and `app.has_org_permission()`, halting all clinic data access without deleting rows.

### 5.2 Client Join & Onboarding Flow
1. A user creates a global account (`auth.users` + `profiles` only; **zero automatic role or clinic access**).
2. The user requests to join a clinic (`request_clinic_join(p_org_id)`), creating `clinic_clients` with `status = 'requested'`.
3. Pending clients see only a join-request status screen and have zero read access to clinic doctors, schedules, or records.
4. Clinic staff (`front_desk` or `org_admin`/`org_owner` with `clients.approve`) call `approve_clinic_client(p_clinic_client_id)` to grant access. Walk-in clients without an online account can be registered with `user_id = NULL` and linked later upon verified email/invite claim.

### 5.3 Appointment Concurrency & Consultation Activation
1. **Request (`requested`):** Approved clinic client submits `request_appointment(...)` for a branch, pet, and desired slot. `scheduled_range` remains `NULL`; pending requests **do not block calendar slots**.
2. **Confirmation (`confirmed`):** Authorized `front_desk` or `org_admin`/`org_owner` executes `confirm_appointment(p_appointment_id, p_start, p_end)`. Inside one transaction with row locking, PostgreSQL revalidates:
   - Doctor active and assigned to the target branch.
   - Slot matches `doctor_schedules` and falls outside `doctor_schedule_exceptions`.
   - Clinic client status is `approved` and guardian link to `pet_id` is valid.
   - A GiST exclusion constraint (`btree_gist`) on `(doctor_profile_id WITH =, scheduled_range WITH &&) WHERE (status IN ('confirmed', 'checked_in'))` guarantees zero double-booking under concurrent requests (`SQLSTATE 23P01`).
3. **Consultation Activation (`active`, 7 Days):**  
   Once the appointment is `confirmed` or `completed` (and has not already spawned an active/completed consultation), an authorized clinician or admin invokes `activate_consultation(p_appointment_id)` (or `p_consultation_id` linked to `appointment_id`):
   - Sets `activated_at = now()` and `expires_at = now() + INTERVAL '7 days'`.
   - Creates exactly one `chat_conversations` record.
   - Writes an immutable `audit_logs` entry and triggers notifications.
4. **Chat Lifecycle & Expiry:**
   - Messages are sent exclusively via `send_chat_message()` RPC, enforcing `consultation_status = 'active'` and server-side `now() < expires_at`.
   - After `expires_at` passes (and via scheduled/lazy transition to `'expired'`), sending is strictly rejected.
   - **Expired chat history remains read-only strictly to the consultation's `client` and treating `doctor`** (never org admins or platform admins).

---

## 6. File Storage & Realtime Architecture

### 6.1 Private Clinical Storage
- **Bucket:** Private bucket `clinical-files` (zero public buckets for clinical data).
- **Object Key Convention:** `{organization_id}/{entity_type}/{entity_id}/{uuid}-{sanitized_filename}`
- **Access:** Controlled by `storage.objects` RLS policies parsing the leading `organization_id` and verifying membership/guardian rights; served to authorized clients solely via short-lived signed URLs (`60s–300s`).
- **Metadata:** Tracked in `attachments` and `message_attachments` (MIME allow-list, size limits, uploader, checksum/size; legacy `blob:` URLs purged/nulled during backfill).

### 6.2 Realtime Subscriptions
- Realtime enabled selectively for `chat_messages` and `notifications`, subscribed with explicit row filters (`conversation_id=eq.<id>`, `user_id=eq.<uid>`).
- RLS enforces that PostgreSQL Changes events are broadcast only to authorized recipients (and for `chat_messages`, strictly to participants, excluding org admins on expired/non-participant threads).

---

## 7. Target Frontend Architecture

| Layer | Current Baseline | Target Architecture |
|---|---|---|
| **Routing & Portals** | Unprotected flat routes `/client/*`, `/doctor/*`, `/admin/*` | Route-scoped multi-tenant paths `/:orgSlug/client/*`, `/:orgSlug/doctor/*`, `/:orgSlug/admin/*`, `/platform/*`, `/workspaces`, `/reset-password` |
| **Auth & Session** | Mixed inside `AppContext.tsx` | Dedicated `AuthProvider` listening to `onAuthStateChange` (including `PASSWORD_RECOVERY`) + `get_my_context()` |
| **Organization Context** | None | `OrgProvider` resolving `:orgSlug` from validated memberships/approved `clinic_clients` |
| **Authorization Guards** | Client-side role switcher | `<RequireAuth>`, `<RequireMembership>`, `<RequirePermission>`, `<RequirePlatformAdmin>`; switcher replaced by verified Workspace Switcher |
| **Data Access** | `supabaseService.ts` + `mockData.ts` fallback | Domain repositories calling hardened RPCs & typed PostgREST views; zero mock data in production bundle |
| **Client Configuration** | Hardcoded fallback URL/key removed in Phase 1 | Strictly `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`, failing closed when absent |

---

## 8. Non-Functional & Compliance Guardrails

- **Audit Trail:** Append-only `audit_logs` written exclusively by server-side `SECURITY DEFINER` functions/triggers (`before_json`, `after_json`, `actor_user_id`, `organization_id`, `request_id`).
- **Zero Production Secrets in Browser:** `service_role` keys, test runner passwords, and database admin credentials never appear in `VITE_*` variables or browser bundles.
- **No Unapproved Data Deletion:** Soft archival (`archived_at`) replaces hard deletes on pets, doctors, and clinical assets; clinical foreign keys use `ON DELETE RESTRICT`.
