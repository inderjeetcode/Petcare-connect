# 05 — Multi-Tenant Gap Analysis

Everything in §3 onward is **PROPOSED** architecture. Gaps in §1 to §2 are **VERIFIED** against the repository.

## 1. Requirement-by-requirement gap

| # | Approved requirement | Current state (evidence) | Gap |
|---|---|---|---|
| 1 | Multiple independent veterinary organizations | No org entity anywhere | **Full** |
| 2 | Each org has multiple branches | None | **Full** |
| 3 | Clinics self-register | Only client signup (`AuthModal.tsx:370`) | **Full**: registration flow and `organization_applications` |
| 4 | Manual Platform Owner approval | No platform-owner principal; `admin` is global (`001:26`) | **Full** |
| 5 | Clients request to join; clinic approval mandatory | Signup grants global access; `handle_new_user` assigns `client` role (`999:413-415`) | **Full**: `clinic_clients.status` workflow |
| 6 | One global account → many orgs | `auth.users`/`profiles` are global ✔ | **Partial**: identity exists; memberships missing |
| 7 | Client and pet records separate per clinic | `pets.owner_id` global; consultations reference global profile | **Full**: per-org `clinic_clients`, per-org `pets`, `pet_guardians` |
| 8 | Doctors across branches within same org | `doctor_profiles.user_id UNIQUE`; no branch | **Full**: per-org doctor profile and `doctor_branch_assignments` |
| 9 | Appointment: Request → Clinic Confirmation | Consultation "pending → active" by doctor; free-text `preferred_time` | **Full**: `appointments` entity and state machine |
| 10 | Pending requests do not reserve slots | No slots exist | **Design**: only `confirmed` occupies time |
| 11 | Transactional revalidation on confirm | None | **Full**: `confirm_appointment()` RPC and exclusion constraint |
| 12 | Chat active exactly 7 days after authorized activation | ✔ CHECK (`001:106-108`), RPC (`001:339-340`), RLS (`rls_policies.sql:240-255`) | **Partial**: bypassable (SEC-03); add org scope |
| 13 | Expired chat readable, no new messages | ✔ (`rls_policies.sql:223-255`) | **Partial**: keep; route sends through RPC |
| 14 | No payment gateway in v1 | ✔ placeholder pages | Hide pages in v1 |
| 15 | Future subscription and payment support | `consultation_payments` only | **Design**: reserve schema; no tables in v1 (CONFIRM) |

## 2. Cross-cutting gaps

| Area | Gap |
|---|---|
| Tenant key | No `organization_id` on any table |
| Tenant-safe FKs | Child rows can reference parents of any tenant |
| Authorization model | Enum roles instead of membership, role and permission |
| Workflow integrity | State transitions via direct `UPDATE` |
| Audit | Mostly client-side; not tenant-scoped |
| Files | No storage |
| Notifications | No producer |
| Testing | No meaningful RLS tests |
| Frontend | No org context, guards or permission-aware navigation |

## 3. Target domain model (PROPOSED)

```
auth.users 1─1 profiles (global person)
                 │
   ┌─────────────┼────────────────────────────┬───────────────────────┐
   │             │                            │                       │
platform_admins  organization_memberships ─* membership_roles ─ organization_roles ─* role_permissions ─ permissions
                 │ (user × org, status)
                 │
organizations ─* branches
   │  ▲
   │  └─ organization_applications (self-registration, Platform Owner review)
   │
   ├─* clinic_clients (org-scoped client record; optional user_id link; status requested|approved|rejected|suspended)
   │        └─* pet_guardians *─ pets (org-scoped)
   │
   ├─* doctor_profiles (org × user) ─* doctor_branch_assignments ─ branches
   │        └─* doctor_schedules (branch-specific weekly) + doctor_schedule_exceptions
   │
   ├─* appointments (requested → confirmed | declined | cancelled | no_show | completed)
   │        └─* appointment_status_history
   │
   ├─* consultations (clinical episode; optional appointment_id; 7-day chat window)
   │        ├─1 chat_conversations ─* chat_messages ─* message_attachments
   │        ├─* prescriptions ─* prescription_items
   │        └─* medical_records
   ├─* vaccinations
   ├─* notifications
   ├─* attachments (storage metadata)
   └─* audit_logs
```

## 4. Table-by-table decision (do not blindly create)

| Proposed table | Decision | Rationale |
|---|---|---|
| organizations | **Create** | Tenant root. Columns: `id, slug UNIQUE, legal_name, display_name, status (pending/active/suspended/closed), timezone, country, contact_email, phone, created_by, approved_by, approved_at`, `plan_code NULL` (future billing hook) |
| organization_applications | **Create** | Keeps unapproved submissions out of the tenant table: `applicant_user_id, proposed_name, proposed_slug, documents, status, reviewed_by, reviewed_at, decision_reason, organization_id NULL`. On approval an RPC creates the org, the first branch and an owner membership atomically |
| branches | **Create** | `organization_id, name, code, address…, timezone, phone, is_active`; `UNIQUE(organization_id, code)` |
| organization_memberships | **Create** | Staff link `user_id × organization_id`, `status (invited/active/suspended/left)`, `invited_by`, `UNIQUE(organization_id, user_id)`. Optional `branch_scope` handled by `membership_branches` if branch-restricted staff are needed (CONFIRM) |
| organization_roles | **Create (system roles only in v1)** | `org_owner, org_admin, branch_manager, doctor, front_desk`. `organization_id NULL` = system role; per-org custom roles deferred |
| permissions | **Create** (static catalogue) | e.g. `org.manage, branch.manage, staff.manage, clients.approve, clients.read, pets.read, pets.write, appointments.manage, appointments.confirm, consultations.activate, chat.participate, medical_records.read, medical_records.write, prescriptions.write, audit.read` |
| role_permissions | **Create** | Seeded mapping; changes only through migrations in v1 |
| membership_roles | **Create** (not in original list) | A membership may hold several roles (e.g. doctor + branch_manager) |
| platform_admins | **Create** (not in original list) | Platform Owner principal, separate from tenant roles. Replaces global `admin` |
| clinic_clients | **Create** | Per-org client record (requirement 7). `organization_id, user_id NULL` (walk-in clients without login), `status`, `full_name, phone, email` (clinic-owned copy), `requested_at, approved_by, approved_at`; partial `UNIQUE(organization_id, user_id) WHERE user_id IS NOT NULL` |
| pets | **Retain and extend** | Add `organization_id`, `archived_at`, `created_by`; keep `owner_id` during transition then deprecate in favour of guardians |
| pet_guardians | **Create** | `pet_id, clinic_client_id, organization_id, relationship, is_primary`; supports multiple guardians |
| doctor_profiles | **Retain and extend** | Add `organization_id`, `registration_number`, `display_name`; replace `UNIQUE(user_id)` with `UNIQUE(organization_id, user_id)`; add `UNIQUE(id, organization_id)` |
| doctor_branch_assignments | **Create** | `doctor_profile_id, branch_id, organization_id, is_active, effective_from/to` |
| doctor_availability | **Rename → doctor_schedules (via new table + backfill)** | Needs `branch_id`, `weekday SMALLINT`, `slot_minutes`, `effective_from/to`; plus `doctor_schedule_exceptions` for leave and closures. Current table unused by UI and probably empty (CONFIRM) |
| appointments | **Create** | Requirement 9. See §7 |
| appointment_status_history | **Create** | Append-only transitions with actor and reason |
| consultations | **Retain and extend** | Add `organization_id, branch_id, clinic_client_id, appointment_id NULL, activated_by, rejected_by, completed_by`. Keep the 7-day CHECK. Add a trigger forbidding mutation of `activated_at`/`expires_at` once set |
| chat_conversations | **Retain and extend** | Add `organization_id`; stop trusting denormalized `client_id`/`doctor_id` (derive from consultation or keep in sync by RPC) |
| chat_messages | **Retain and extend** | Add `organization_id` (for RLS efficiency); inserts only via `send_chat_message()` RPC; attachments → `message_attachments` |
| medical_records | **Retain and extend** | Add `organization_id, created_by, amended_from_id`; `pet_id` FK → RESTRICT |
| prescriptions / prescription_items | **Retain and extend** | Add `organization_id, branch_id, status (issued/void)`, `voided_by/at/reason`; make `consultation_id` nullable with `appointment_id` alternative (CONFIRM) |
| vaccinations | **Retain and extend** | Add `organization_id, doctor_profile_id, created_at, created_by, batch_number`; `next_due_date` nullable |
| notifications | **Retain and extend** | Add `organization_id NULL`; produced by RPCs and triggers |
| audit_logs | **Retain and extend** | Add `organization_id, actor_user_id, before jsonb, after jsonb, request_id`; append-only |
| reviews | **Retain, freeze** | Add `organization_id`; hide from UI in v1 (CONFIRM) |
| consultation_payments | **Retain, unused** | Change FK to RESTRICT; add `organization_id`; no v1 UI |
| user_roles | **Deprecate** | Read-only after membership backfill; drop in contract phase |
| Future subscription tables | **Design only, do not create in v1** | `subscription_plans`, `organization_subscriptions`, `invoices`, `payment_transactions`, `payment_provider_events`. Only `organizations.plan_code` is reserved now |

## 5. Tenant-safe foreign keys (PROPOSED pattern)

Every tenant-owned parent gets `UNIQUE (id, organization_id)`. Every child references the **pair**:

```sql
-- illustrative only, not executed
ALTER TABLE pets ADD CONSTRAINT pets_id_org_uq UNIQUE (id, organization_id);
ALTER TABLE consultations
  ADD CONSTRAINT consultations_pet_fk
  FOREIGN KEY (pet_id, organization_id) REFERENCES pets (id, organization_id);
```

With this, the database itself **cannot** store a consultation of org A that points to a pet, client, doctor or branch of org B, independently of RLS. Apply it to: branches, clinic_clients, pets, pet_guardians, doctor_profiles, doctor_branch_assignments, appointments, consultations, chat_*, prescriptions, prescription_items, medical_records, vaccinations, attachments.

## 6. Authorization layer (PROPOSED)

### 6.1 Helper functions (STABLE, SECURITY DEFINER, `search_path = ''`, fully qualified names)
- `app.is_platform_admin() → bool`
- `app.is_org_member(org uuid) → bool` (active membership)
- `app.has_org_permission(org uuid, perm text) → bool`
- `app.has_branch_access(branch uuid, perm text) → bool`
- `app.is_clinic_client(org uuid) → uuid` (returns approved clinic_client id for `auth.uid()`)
- `app.is_pet_guardian(pet uuid) → bool`

Policies call them as `(select app.has_org_permission(organization_id, 'pets.read'))` so the planner evaluates them once per statement. Supporting indexes are listed in the migration plan.

### 6.2 Policy shape per table (example: `medical_records`)
- SELECT: `has_org_permission(organization_id,'medical_records.read') OR is_pet_guardian(pet_id)`
- INSERT/UPDATE/DELETE: **none** for API roles; writes via `add_medical_record()` / `amend_medical_record()`.
- Platform admin: **no** clinical access by default.

### 6.3 Active organization context
The frontend sends the active org explicitly (route param `/:orgSlug/...` or a header), and every query filters by `organization_id`. RLS checks membership per row, so no JWT custom claim is required in v1. A custom access-token hook adding `org_ids` can be introduced later for performance (CONFIRM if needed).

### 6.4 RPC catalogue (SECURITY DEFINER, audited, idempotent where sensible)

| Domain | RPC |
|---|---|
| Onboarding | `submit_organization_application`, `approve_organization_application` (platform), `reject_organization_application` (platform), `suspend_organization` (platform) |
| Staff | `invite_member`, `accept_invitation`, `set_member_roles`, `suspend_member`, `assign_doctor_to_branch` |
| Clients | `request_clinic_join(org)`, `approve_clinic_client`, `reject_clinic_client`, `create_walk_in_client` |
| Pets | `create_pet`, `update_pet`, `archive_pet`, `add_pet_guardian` |
| Scheduling | `upsert_doctor_schedule`, `add_schedule_exception`, `get_available_slots(branch, doctor, date)` |
| Appointments | `request_appointment`, `confirm_appointment`, `decline_appointment`, `cancel_appointment`, `reschedule_appointment`, `mark_no_show`, `complete_appointment` |
| Consultations | `activate_consultation` (extended), `reject_consultation`, `complete_consultation`, `reassign_consultation` |
| Chat | `send_chat_message`, `mark_messages_read` |
| Clinical | `issue_prescription(header, items jsonb)` (atomic), `void_prescription`, `add_medical_record`, `amend_medical_record`, `record_vaccination` |
| Notifications | internal `enqueue_notification` (not exposed) |

## 7. Appointment concurrency design (requirements 9 to 11)

```
requested ──confirm_appointment()──► confirmed ──► checked_in ──► completed
    │                                    │
    ├─decline──► declined                ├─cancel──► cancelled
    └─cancel───► cancelled               └─no_show─► no_show
```

- `appointments(organization_id, branch_id, doctor_profile_id NULL, clinic_client_id, pet_id, requested_start, requested_end, scheduled_range tstzrange NULL, status, reason, …)`.
- **Requests do not reserve:** `scheduled_range` is set only on confirmation. The overlap constraint applies only to confirmed rows:
  ```sql
  -- illustrative only
  CREATE EXTENSION IF NOT EXISTS btree_gist;
  ALTER TABLE appointments ADD CONSTRAINT no_double_booking
    EXCLUDE USING gist (doctor_profile_id WITH =, scheduled_range WITH &&)
    WHERE (status IN ('confirmed','checked_in'));
  ```
- `confirm_appointment(id, start, end)`, in one transaction:
  1. `SELECT … FOR UPDATE` the appointment; assert `status='requested'` and the caller has `appointments.confirm` for its branch.
  2. Revalidate: doctor assigned to branch and active; slot inside schedule and not in an exception; branch open; client approved; pet guardianship.
  3. `UPDATE … SET status='confirmed', scheduled_range=…`. The exclusion constraint guarantees no overlap even under concurrent confirmations (a conflicting transaction fails with `23P01`, which is mapped to a user-facing "slot no longer available").
  4. Insert `appointment_status_history`, `audit_logs`, notifications.
- Consultation activation (7-day chat) is a separate, explicit, authorized action (`activate_consultation`), typically after a confirmed or completed appointment. **CONFIRM:** whether activation may also happen without an appointment (pure tele-consult), and who may activate (doctor only, or front desk too).

## 8. Frontend gaps

| Need | Current | Target |
|---|---|---|
| Org context | none | `OrgProvider` with active org from route `/:orgSlug`; workspace switcher |
| Auth context | inside god context | `AuthProvider` (session, profile, memberships, platform flag) |
| Permission checks | `currentRole` string | `usePermission('appointments.confirm')` from server-provided permission set |
| Data access | `supabaseService` direct CRUD | Per-domain repositories calling RPCs and views; generated DB types; query cache (TanStack Query, CONFIRM) |
| Guards | none | `<RequireAuth>`, `<RequireMembership>`, `<RequirePermission>`, `<RequirePlatformAdmin>` |
| Portals | client/doctor/admin | client, doctor, org admin, **platform owner** |
| Mock data | in prod bundle | test fixtures only |
