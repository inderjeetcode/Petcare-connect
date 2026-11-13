# Pet Connect — Staging Migration Review

**Review Date:** 2026-11-13  
**Scope:** Pre-execution inspection of all SQL files in `supabase/migrations/` (15 files), `supabase/seed.sql`, `supabase/config.toml`, `supabase/tests/rls_multi_tenant_suite.sql`, `supabase/archive/`, and comparison against Phase 10 audit reports (`FINAL_QA_REPORT.md`, `FINAL_SECURITY_AUDIT.md`, `TEST_EXECUTION_REPORT.md`, `DATABASE_MIGRATION_STATUS.md`, `PRODUCTION_READINESS_CHECKLIST.md`).  
**SQL Executed:** **None** (static inspection only; awaiting approval before applying).

---

## 1. Migration Filenames in Execution Order

`supabase/migrations/` contains **15 incremental migrations** ordered chronologically by timestamp prefix (`20261113000000` → `20261113130000`):

> **Clarification on "15 Phase 2 migrations":** The 15 files in `supabase/migrations/` comprise **1 baseline snapshot** (`000000`), **8 Phase 2 hardening/expansion/backfill/RLS migrations** (`010000`–`070000`, including `040000` + `045000`), and **6 Phase 4–9 portal/workflow/reporting migrations** (`080000`–`130000`). The 6 legacy scripts in `supabase/archive/` are excluded from execution.

| Order | Filename | Phase / Role |
| :---: | :--- | :--- |
| 1 | `20261113000000_baseline_single_tenant.sql` | Baseline (reconciled 16-table single-tenant snapshot) |
| 2 | `20261113010000_phase2a_security_hardening.sql` | Phase 2A (pre-multi-tenant security hardening) |
| 3 | `20261113020000_phase2b_expand_multi_tenant_core.sql` | Phase 2B Part 1 (multi-tenant core tables & RBAC catalog) |
| 4 | `20261113030000_phase2b_extend_existing_tables.sql` | Phase 2B Part 2 (additive tenant extensions on baseline tables) |
| 5 | `20261113040000_phase2b_app_helpers_and_rpcs.sql` | Phase 2B Part 3 (`app.*` helpers & core RPCs) |
| 6 | `20261113045000_phase2b_additional_workflow_rpcs.sql` | Phase 2B Part 4 (invitations, guardians, slots, attachments RPCs) |
| 7 | `20261113050000_phase2c_backfill_maxpetz_safe.sql` | Phase 2C (MaxPetZ pilot backfill & test-artifact quarantine) |
| 8 | `20261113060000_phase2d_validate_tenant_constraints.sql` | Phase 2D (multi-org doctor UQ & 22 composite tenant FKs) |
| 9 | `20261113070000_phase2e_switch_rls_policies.sql` | Phase 2E (atomic multi-tenant RLS & private storage switch) |
| 10 | `20261113080000_phase4_client_reviews_and_pet_updates.sql` | Phase 4 (client reviews & extended `update_pet`) |
| 11 | `20261113090000_phase5_doctor_portal_rpcs.sql` | Phase 5 (doctor schedule/exception/clinical summary RPCs) |
| 12 | `20261113100000_phase6_admin_portal_services_and_governance.sql` | Phase 6 (`clinic_services`, org/branch settings & admin governance) |
| 13 | `20261113110000_phase7_platform_owner_portal.sql` | Phase 7 (Platform Owner settings, support grants & RPCs) |
| 14 | `20261113120000_phase8_core_workflows_hardening.sql` | Phase 8 (transactional workflows, URL hygiene checks, realtime) |
| 15 | `20261113130000_phase9_reports_notifications_indexes.sql` | Phase 9 (notification dedup/read-only grant, reporting indexes & RPC) |

**Excluded Legacy Files (`supabase/archive/` — must NOT be applied):**
- `001_initial_schema.sql`
- `002_activate_consultation_rpc.sql`
- `003_setup_test_accounts.sql` (inserts 4 test accounts with hardcoded password `Password123!Secure` + defines `cleanup_test_records(UUID[])`)
- `999_full_production_deploy.sql`
- `rls_policies.sql`
- `security_tests.sql`

---

## 2. What Each Migration Does & Schema Coverage Check

### 2.1 Per-Migration Summary

1. **`20261113000000_baseline_single_tenant.sql`**
   - Enables `"uuid-ossp"` extension; creates 6 enums (`user_role_enum`, `consultation_status_enum`, `payment_status_enum`, `message_type_enum`, `medical_record_type_enum`, `notification_type_enum`).
   - Creates all **16 original baseline tables** in `public`: `profiles`, `user_roles`, `pets`, `doctor_profiles`, `doctor_availability`, `consultations`, `consultation_payments`, `chat_conversations`, `chat_messages`, `prescriptions`, `prescription_items`, `medical_records`, `vaccinations`, `notifications`, `reviews`, `audit_logs`.
   - Enforces `check_seven_day_expiry` CHECK constraint on `consultations`, creates `updated_at` trigger function (`handle_updated_at`), baseline indexes, legacy `is_admin()`/`is_doctor()` helper stubs, `handle_new_user()`, and `ENABLE ROW LEVEL SECURITY` on all 16 tables (no policies yet; installed cleanly in Migration 9).

2. **`20261113010000_phase2a_security_hardening.sql`**
   - Drops `public.cleanup_test_records(UUID[])` (`SEC-11`).
   - Adds `pets.archived_at` (`TIMESTAMPTZ`).
   - Switches `medical_records.pet_id` and `vaccinations.pet_id` FKs from `ON DELETE CASCADE` to `ON DELETE RESTRICT` (`SEC-16`).
   - Creates immutability/governance triggers: `tg_profiles_guard_identity` (`profiles.id`/`email` immutable), `tg_consultations_guard_window` (`activated_at`/`expires_at` immutable, 7-day invariant, blocks reopening terminal states), `tg_doctor_profiles_guard_governance` (blocks doctor self-mutation of `is_active`/`consultation_fee`).
   - Replaces `handle_new_user()` so signups insert `profiles` only with zero auto-assigned `user_roles` (`SEC-20`), and attempts to attach `on_auth_user_created` trigger on `auth.users` (catches `insufficient_privilege` with a `NOTICE`).
   - Revokes all `anon` table access and direct `INSERT`/`UPDATE`/`DELETE` on clinical, workflow, and audit tables; restricts `profiles` `UPDATE` to `id = auth.uid()`.

3. **`20261113020000_phase2b_expand_multi_tenant_core.sql`**
   - Enables `btree_gist` extension; creates internal `app` schema (`REVOKE ALL ON SCHEMA app FROM PUBLIC, anon, authenticated;`) and `app.migration_runs`.
   - Creates `public.tg_touch_updated_at()` and `public.tg_prevent_audit_mutation()` (immutability trigger on `audit_logs`).
   - Creates **20 multi-tenant tables** in `public` (all with `ENABLE ROW LEVEL SECURITY` and direct write revocations):
     - Governance: `platform_admins`, `organizations`, `organization_applications`, `branches`.
     - RBAC: `organization_roles` (`org_owner`, `org_admin`, `branch_manager`, `doctor`, `front_desk`), `permissions` (18 seeded keys), `role_permissions`.
     - Memberships & Clients: `organization_memberships`, `membership_roles`, `membership_branches`, `staff_invitations`, `clinic_clients`, `pet_guardians`.
     - Scheduling & Appointments: `doctor_branch_assignments`, `doctor_schedules`, `doctor_schedule_exceptions`, `appointments` (with GiST `EXCLUDE USING gist (doctor_profile_id WITH =, scheduled_range WITH &&) WHERE (status IN ('confirmed', 'checked_in') AND scheduled_range IS NOT NULL)` named `no_double_booking`), `appointment_status_history`.
     - Attachments: `attachments`, `message_attachments`.

4. **`20261113030000_phase2b_extend_existing_tables.sql`**
   - Zero drops. Appends `organization_id`, `branch_id`, `clinic_client_id`, `appointment_id`, `created_by`, `is_legacy_unmapped_branch`, `archived_by`, `archive_reason`, provenance, and void/amendment columns across the 16 baseline tables.
   - Adds composite `UNIQUE (id, organization_id)` constraints on parent tables (`pets`, `doctor_profiles`, `consultations`, `chat_conversations`, `prescriptions`, `medical_records`, `notifications`) so child composite tenant FKs can bind tightly in Migration 8.
   - Relaxes `prescriptions.consultation_id` and `vaccinations.next_due_date` to nullable; converts `consultation_payments.consultation_id` to `ON DELETE RESTRICT`; appends `'appointment'` and `'platform'` to `notification_type_enum`.

5. **`20261113040000_phase2b_app_helpers_and_rpcs.sql`**
   - Defines internal `app.*` predicates (`SECURITY DEFINER`, `SET search_path = ''`, revoked from `PUBLIC, anon, authenticated`): `is_platform_admin`, `is_org_active`, `is_org_member`, `org_role_codes`, `has_org_permission`, `has_branch_access`, `current_clinic_client_id`, `is_pet_guardian`, `is_consultation_participant`, `write_audit_log`, `enqueue_notification`, `notify_pet_guardians`.
   - Defines initial core `SECURITY DEFINER` RPCs (all `SET search_path = ''`, granted strictly to `authenticated`): context hydration (`get_my_context`), organization application & lifecycle (`submit_organization_application`, `approve_organization_application`, `reject_organization_application`, `suspend_organization`, `reactivate_organization`), branches/memberships/roles, clinic client onboarding, pets (`create_pet`, `update_pet`, `archive_pet`), schedules/appointments, consultations/chat, prescriptions/records/vaccinations, notifications.

6. **`20261113045000_phase2b_additional_workflow_rpcs.sql`**
   - Adds `invite_member`, `accept_invitation`, `add_pet_guardian`, `update_doctor_self_profile`, `admin_update_doctor_governance`, `get_available_slots`, `reschedule_appointment`, `check_in_appointment`, `complete_appointment`, `mark_no_show`, and `register_attachment`.

7. **`20261113050000_phase2c_backfill_maxpetz_safe.sql`**
   - Idempotently ensures `'maxpetz'` pilot organization exists (`status = 'active'`).
   - Attributes real existing non-test data (`profiles`, `doctor_profiles`, `pets`, `consultations`, `chat_*`, `prescriptions`, `medical_records`, `vaccinations`, `notifications`, `reviews`, `consultation_payments`, `audit_logs`) to `maxpetz`, preserves historical `branch_id = NULL` with `is_legacy_unmapped_branch = true` (zero fabricated branches), expires overdue active consultations, quarantines legacy test-account artifacts (`%@petconnect.com`, `client.test.%@gmail.com`, `vet.tester.petconnect@gmail.com`, `[CONTROLLED-TEST]%`), and logs counts into `app.migration_runs`.

8. **`20261113060000_phase2d_validate_tenant_constraints.sql`**
   - Drops global unique constraint `doctor_profiles_user_id_key` and creates per-org uniqueness `uq_doctor_profiles_org_user (organization_id, user_id)` (allowing a doctor to practice across multiple clinics).
   - Adds and validates **22 composite `(entity_id, organization_id)` foreign keys** (`NOT VALID` followed by `VALIDATE CONSTRAINT`), enforcing tenant consistency at the constraint level (`MATCH SIMPLE` permits nullable `branch_id` on legacy/org-wide rows while rejecting cross-org `branch_id` or parent FKs).

9. **`20261113070000_phase2e_switch_rls_policies.sql`**
   - Drops legacy permissive policies dynamically via `pg_policies` loop, then creates strict `TO authenticated` multi-tenant RLS policies across all tables (`organizations`, `branches`, `memberships`, `clinic_clients`, `pets`, `appointments`, `consultations`, **D-16 participant-only** `chat_conversations` / `chat_messages` / `message_attachments` / consultation `attachments`, **D-17 org-wide clinical read** `medical_records` / `prescriptions` / `prescription_items` / `vaccinations`, `consultation_payments`, `reviews`, `notifications`, `audit_logs`).
   - Provisions private Storage bucket `clinical-files` (`public = false`, 10 MiB limit, `image/jpeg`, `image/png`, `image/webp`, `application/pdf`) and `storage.objects` policies `clinical_files_select_tenant` and `clinical_files_insert_tenant` (catching `insufficient_privilege` with a `NOTICE`).

10. **`20261113080000_phase4_client_reviews_and_pet_updates.sql`**
    - Adds `reviews_select_tenant` policy; defines `submit_review(UUID, SMALLINT, TEXT)`; updates `update_pet(UUID, JSONB)` to support `date_of_birth`, clearable nullable fields, positive weight check, and `archived_at IS NOT NULL` check.

11. **`20261113090000_phase5_doctor_portal_rpcs.sql`**
    - Replaces `add_schedule_exception` with confirmation-conflict detection; adds `save_doctor_branch_day_schedule`, `remove_schedule_exception`, and `update_consultation_clinical_summary`.

12. **`20261113100000_phase6_admin_portal_services_and_governance.sql`**
    - Adds `organizations.operational_settings` and `branches.settings`.
    - Creates `public.clinic_services` (RLS enabled, direct DML revoked, `clinic_services_select_tenant`, `updated_at` trigger).
    - Adds `admin_upsert_branch`, `update_organization_settings`, `upsert_clinic_service`, `reactivate_member`, `revoke_staff_invitation`, `suspend_clinic_client`, `reactivate_clinic_client`, `admin_update_doctor_profile_and_governance`.

13. **`20261113110000_phase7_platform_owner_portal.sql`**
    - Creates `public.platform_settings` and `public.platform_support_access_grants` (RLS enabled, direct DML revoked).
    - Hardens `tg_profiles_guard_identity` to also prevent users from mutating `profiles.platform_status` or `platform_suspended_at`; hardens `app.is_platform_admin()` to require active `profiles.platform_status`.
    - Enhances `get_my_context()` (`platform_status`, `platform_settings`); adds audited Platform Owner RPCs (`platform_get_overview_metrics`, `platform_list_organizations`, `platform_list_organization_applications`, `platform_get_organization_telemetry`, `platform_list_users`, `platform_suspend_user`, `platform_reactivate_user`, `platform_grant_platform_admin`, `platform_revoke_platform_admin`, `platform_update_settings`, `platform_request_support_access`, `platform_list_support_access_grants`, `platform_get_scoped_support_snapshot`, `platform_get_audit_logs`, `platform_get_analytics_series`, plus org-owner `approve_platform_support_access`, `reject_platform_support_access`, `revoke_platform_support_access`).

14. **`20261113120000_phase8_core_workflows_hardening.sql`**
    - Adds `appointments.service_id` + `appointments_service_org_fk` composite FK; adds `CHECK` constraints blocking `blob:`, `data:`, and `..` traversal on `attachments.object_path` and `chat_messages.attachment_url`.
    - Drops old 4/7/4-arg signatures of `get_available_slots`, `request_appointment`, and `confirm_appointment` cleanly and installs service-aware + cross-branch-conflict-checked appointment/consultation/chat/clinical RPCs + `expire_due_consultations`.
    - Enrolls `chat_messages`, `notifications`, `appointments`, `consultations` in `supabase_realtime` publication (if publication exists).
    - **Regression conflict:** Also redefines `public.update_pet(UUID, JSONB)` (see Section 4.2).

15. **`20261113130000_phase9_reports_notifications_indexes.sql`**
    - Restricts `notifications` `UPDATE` from whole-row to column-only `GRANT UPDATE (is_read)` + `notifications_update_own_read` RLS policy.
    - Updates `app.enqueue_notification` with 60-second deduplication; adds 10 reporting/filtering composite indexes.
    - Adds `public.get_org_service_summary(...)` (**contains runtime column defect** — see Section 4.1).

### 2.2 Baseline Preservation & Capability Checklist

| Requirement | Verified Status | Evidence |
| :--- | :---: | :--- |
| Preserves all 16 original baseline tables | **YES** | All 16 tables in `000000` remain intact (`profiles`, `user_roles`, `pets`, `doctor_profiles`, `doctor_availability`, `consultations`, `consultation_payments`, `chat_conversations`, `chat_messages`, `prescriptions`, `prescription_items`, `medical_records`, `vaccinations`, `notifications`, `reviews`, `audit_logs`); zero tables or columns dropped. |
| Organizations & Applications | **YES** | `organizations`, `organization_applications` + approval/suspension RPCs (`020000`, `040000`, `110000`). |
| Branches | **YES** | `branches`, `doctor_branch_assignments`, `membership_branches`, branch-scoped RPCs (`020000`, `040000`, `100000`). |
| Memberships & RBAC | **YES** | `organization_roles`, `permissions`, `role_permissions`, `organization_memberships`, `membership_roles`, `staff_invitations`, `clinic_clients`, `pet_guardians`, `platform_admins` (`020000`, `040000`, `045000`). |
| RLS across all `public` tables | **YES** | All **39** `public` tables have `ENABLE ROW LEVEL SECURITY` and `TO authenticated` multi-tenant policies (`070000`, `080000`, `100000`, `110000`, `130000`). |
| `SECURITY DEFINER` RPCs | **YES** | Hardened workflow/clinical/admin/platform RPCs enforce `SET search_path = ''`, check `auth.uid()` & permissions, and revoke `EXECUTE` from `PUBLIC`/`anon`. |
| Triggers | **YES** | `tg_profiles_guard_identity` (`010000`/`110000`), `consultations_guard_window` (`010000`), `doctor_profiles_guard_governance` (`010000`), `tg_prevent_audit_mutation` (`020000`), `updated_at` triggers (`000000`/`020000`/`100000`/`110000`), `on_auth_user_created` (`010000`). |
| Storage policies | **YES (Privilege-gated)** | `clinical-files` private bucket + `clinical_files_select_tenant` & `clinical_files_insert_tenant` on `storage.objects` (`070000`). |
| Destructive statements | **Safe** | Only drops `cleanup_test_records(UUID[])` (`010000`), superseded `doctor_profiles_user_id_key` UQ (`060000`), legacy policies before replacement (`070000`+), and 3 old RPC signatures immediately recreated with extended params (`120000`). No `DROP TABLE` or `TRUNCATE`. |
| Test-account creation in `supabase/migrations/` | **None** | `003_setup_test_accounts.sql` is quarantined in `supabase/archive/`. `050000` references legacy test emails only to quarantine pre-existing test rows, never inserting test users. |

---

## 3. Dependency Graph Between Migrations

```text
000000 (uuid-ossp, 6 enums, 16 baseline tables, handle_updated_at, handle_new_user stub)
  ├─► 010000 (drops cleanup_test_records; adds pets.archived_at; RESTRICT FKs; guard triggers; revokes direct DML)
  │     └─► 020000 (btree_gist, app schema + migration_runs, 20 core tenant/RBAC/scheduling/attachment tables, GiST no_double_booking)
  │           └─► 030000 (adds organization_id/branch_id/etc. + UNIQUE(id, organization_id) on 16 baseline tables; extends notification_type_enum)
  │                 ├─► 040000 (app.* helpers & core RPCs referencing 020000 tables + 030000 columns + 030000 enum values)
  │                 │     └─► 045000 (additional workflow RPCs using app.* helpers & 030000/040000 contracts)
  │                 │           └─► 050000 (backfills non-test data to maxpetz; logs into app.migration_runs)
  │                 │                 └─► 060000 (validates 22 composite FKs relying on 030000 UNIQUEs & 050000 attribution)
  │                 │                       └─► 070000 (switches all RLS to app.* + 060000-validated tenant FKs; creates clinical-files storage bucket/policies)
  │                 │                             ├─► 080000 (Phase 4 reviews policy/RPC & update_pet)
  │                 │                             ├─► 090000 (Phase 5 doctor schedules/exceptions/clinical summary RPCs)
  │                 │                             ├─► 100000 (Phase 6 clinic_services + branches.id/organization_id FK + admin governance RPCs)
  │                 │                             │     └─► 110000 (Phase 7 platform_settings, grants, updated tg_profiles_guard_identity & get_my_context)
  │                 │                             │           └─► 120000 (Phase 8 appointments.service_id -> 100000 clinic_services; drops 040000/045000 4/7/4-arg signatures; overwrites update_pet; adds check_no_blob & realtime)
  │                 │                             │                 └─► 130000 (Phase 9 notifications column grant, app.enqueue_notification dedup, indexes, get_org_service_summary -> 100000 clinic_services & 120000 appointments.service_id)
```

---

## 4. Risks, Conflicts, Applied Corrections & Comparison with Phase 10 Audit Reports

### 4.1 Resolved Runtime Bug in Migration 15 (`20261113130000`) — Missed by Phase 10
- **Location:** `supabase/migrations/20261113130000_phase9_reports_notifications_indexes.sql`, lines 191–192 inside `public.get_org_service_summary(...)`.
- **Previous Conflict:** Filtered on `coalesce(a.scheduled_start, a.requested_start)`, referencing a non-existent `appointments.scheduled_start` column (`public.appointments` uses `scheduled_range TSTZRANGE` + `requested_start TIMESTAMPTZ`). Because PL/pgSQL defers table-column validation until execution, creating the function would succeed while any runtime call would fail with `42703: column a.scheduled_start does not exist`.
- **Correction Applied:** Updated lines 191–192 in `20261113130000_phase9_reports_notifications_indexes.sql` to `coalesce(lower(a.scheduled_range), a.requested_start)`. All remaining column references (`cs.id`, `cs.name`, `cs.code`, `cs.category`, `cs.duration_minutes`, `cs.price`, `cs.is_active`, `cs.organization_id`, `cs.branch_id`, `a.id`, `a.service_id`, `a.organization_id`, `a.branch_id`, `a.status`, `a.requested_start`, `a.scheduled_range`), joins, `GROUP BY cs.id`, and status filters match the migration-created schema.

### 4.2 Resolved Regression Conflict Between Phase 4 (`080000`) and Phase 8 (`120000`) — Missed by Phase 10
- **Location:** `supabase/migrations/20261113120000_phase8_core_workflows_hardening.sql`, lines 1744–1807 (`public.update_pet(UUID, JSONB)`).
- **Previous Conflict:** `120000` overwrote Phase 4's (`080000`) `update_pet` implementation from the older `040000` body + `blob:`/`data:` avatar check, silently losing `date_of_birth` updates, clearable nullable fields (`color`, `allergies`, `medical_notes`, `avatar_url`), explicit `weight <= 0` validation (`22023`), and the `v_pet.archived_at IS NOT NULL` guard (`P0002`).
- **Correction Applied:** Updated `public.update_pet(UUID, JSONB)` in `20261113120000_phase8_core_workflows_hardening.sql` to merge **all** Phase 4 capabilities (`date_of_birth` updates/clearing, nullable field clearing, `weight <= 0` check with safe blank handling, `archived_at IS NOT NULL` block, `updated_at` timestamp refresh) together with Phase 8's `blob:`/`data:` `avatar_url` rejection and full guardian / `pets.write` + `app.write_audit_log` security controls.

### 4.3 Migration Correction Strategy (Pre-Apply vs. Already-Migrated Environments)
- **Fresh Staging (No Migrations Executed Yet):** Direct surgical edits in `20261113120000` and `20261113130000` are safe because zero migrations have been applied to the new staging database (`supabase_migrations.schema_migrations` is empty), avoiding redundant duplicate migrations while preserving the 15-file sequence and 16-table baseline intact.
- **Any Environment Already Migrated (`20261113120000`/`20261113130000` Already Recorded):** **Do not** rely on rewritten historical files there (rewriting recorded migrations causes migration history/checksum mismatches in Supabase CLI and will not re-execute). Apply a new **forward-only** migration (e.g., `20261113140000_fix_update_pet_and_service_summary.sql`) containing `CREATE OR REPLACE FUNCTION` for both functions.

### 4.4 Hosted Supabase Privilege Caveats (`auth.users` & `storage.objects`)
- **Location:** `20261113010000` (lines 211–227) and `20261113070000` (lines 422–468).
- **Risk:** Both blocks wrap privileged DDL (`CREATE TRIGGER on_auth_user_created ON auth.users` and `CREATE POLICY ... ON storage.objects`) in `EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE ...`. On a hosted Supabase project, if the migration execution role lacks ownership of `auth.users` or `storage.objects`, the migrations complete with exit code 0 **without** creating the signup trigger or storage RLS policies.
- **Mitigation:** After applying migrations on staging, inspect SQL notices and explicitly verify in `pg_trigger` and `pg_policies` that `on_auth_user_created`, `clinical_files_select_tenant`, and `clinical_files_insert_tenant` are active (see `STAGING_MIGRATION_FIX_REPORT.md` Section 3 for verification SQL).

### 4.5 Production-Specific Pilot Assumption on Empty Staging (`050000`)
- **Location:** `20261113050000_phase2c_backfill_maxpetz_safe.sql`.
- **Behavior:** Unconditionally inserts `'maxpetz'` (`MaxPetZ Veterinary Hospitals`, `status = 'active'`) into `public.organizations` via `INSERT ... ON CONFLICT (slug) DO UPDATE`, even when applied to a brand-new empty staging DB, and filters against legacy test patterns (`%@petconnect.com`, `client.test.%@gmail.com`, `vet.tester.petconnect@gmail.com`, `[CONTROLLED-TEST]%`).
- **Impact:** Safe and idempotent on re-runs and empty DBs (backfills 0 rows, records telemetry in `app.migration_runs`), though `'maxpetz'` will exist in `organizations` as an unstaffed active org unless intentionally kept or deactivated in staging.

### 4.6 Incompatible `supabase/seed.sql` & Legacy Scripts
- `supabase/seed.sql` inserts single-tenant fixtures directly into `profiles`, `user_roles`, `doctor_profiles`, `pets`, `consultations`, `prescriptions`, and `vaccinations` **without** `organization_id`, `clinic_clients`, `pet_guardians`, or `auth.users` identities. **Do not execute `supabase/seed.sql`** against the migrated staging project (`supabase db push` does not run `seed.sql`; avoid `supabase db reset` with `seed.sql` enabled).
- Keep `supabase/archive/*` (`003_setup_test_accounts.sql`, etc.), `scripts/test_controlled_rpc.cjs` (calls dropped `cleanup_test_records`), and `scripts/verify_remote_supabase.cjs` excluded from staging/production execution.

### 4.7 Comparison with Phase 10 Audit Reports

| Item | Phase 10 Reports Claim | Independent Verification Result |
| :--- | :--- | :--- |
| Public table count | `FINAL_QA_REPORT.md` (`:16`), `FINAL_SECURITY_AUDIT.md` (`:13`), `TEST_EXECUTION_REPORT.md` (`:45`) state **38** tables in `public` with RLS. | Actual count is **39** tables in `public` (`16` baseline + `20` Phase 2B + `1` `clinic_services` + `2` Phase 7) plus `app.migration_runs` (`40` total). All **39** `public` tables have `ENABLE ROW LEVEL SECURITY`. |
| `SECURITY DEFINER` `SET search_path` & `GRANT EXECUTE` hygiene | `FINAL_SECURITY_AUDIT.md` & `TEST_EXECUTION_REPORT.md`: **PASS** (`0` issues, `0` grants to `PUBLIC`/`anon`). | **Confirmed.** Every `SECURITY DEFINER` RPC sets `search_path = ''` (baseline `is_admin`/`is_doctor` stubs set `public, pg_temp`), `0` grants to `PUBLIC`/`anon`, and all `98` distinct functions match expected `REVOKE`/`GRANT` rules. |
| Runtime column validity in RPCs | Not caught by static AST/regex scans in Phase 10. | **Fixed:** `get_org_service_summary` (`130000`) `a.scheduled_start` defect corrected to `lower(a.scheduled_range)`. |
| Cross-migration RPC regression | Not caught by Phase 10 checks. | **Fixed:** `update_pet` (`120000`) restored to preserve all Phase 4 (`080000`) capabilities alongside Phase 8 avatar validation. |
| Platform Settings vs DB constraint alignment | `platform_settings.default_consultation_window_days` (`1..30`) documented as configurable (`110000`). | **Discrepancy:** `check_seven_day_expiry` (`000000`), `consultations_guard_window` (`010000`), and `activate_consultation` (`120000`) enforce an immutable `7 days` window, so changing `default_consultation_window_days` has no runtime effect. |
| Quarantine of `003_setup_test_accounts.sql` & `cleanup_test_records` | Quarantined in `archive/` and dropped in `010000`. | **Confirmed.** |
| Manual `platform_admins` bootstrap | Required post-migration via SQL Editor (`PRODUCTION_READINESS_CHECKLIST.md:32`). | **Confirmed.** Zero migrations seed `platform_admins`. |

---

## 5. Fresh Staging Database Safety Verdict & Verification Status

**Verdict: SAFE TO APPLY TO THE FRESH ISOLATED STAGING DATABASE AFTER APPROVAL.**

1. **Both Confirmed SQL Defects Corrected Pre-Apply:**
   - `20261113130000_phase9_reports_notifications_indexes.sql` (`public.get_org_service_summary`) now uses `coalesce(lower(a.scheduled_range), a.requested_start)`.
   - `20261113120000_phase8_core_workflows_hardening.sql` (`public.update_pet`) now preserves all Phase 4 rules (`date_of_birth`, nullable clearing, `weight > 0`, `archived_at IS NOT NULL` rejection) plus Phase 8's `blob:`/`data:` avatar guard.
2. **Pre-Apply & Local Verification Status:**
   - **Static & Offline Checks Executed (PASS):** 15 migrations verified in lexicographical order; 39/39 `public` tables RLS-enabled; 98 functions verified for `SECURITY DEFINER` `search_path` and `REVOKE`/`GRANT` discipline; balanced `$$` delimiters across all 15 files; zero remaining `scheduled_start` references in `supabase/migrations/`; `npm run lint` (`tsc --noEmit`), `scripts/verify_phase4_client.ts`, `scripts/verify_phase8_workflows.ts`, and `scripts/verify_phase9_polish.ts` passed.
   - **Live PostgreSQL Compilation & Runtime Tests (NOT EXECUTED):** No `psql`, `postgres`, `supabase` CLI, or `docker` binary is installed in this workspace, and no database connection or SQL execution was performed per instructions. Live PL/pgSQL compilation and execution of `get_org_service_summary`, `update_pet`, and `supabase/tests/rls_multi_tenant_suite.sql` remain to be verified against the staging Postgres 15+ instance once migration execution is approved.
3. **Mandatory Post-Apply Operational Steps (Once Approved):**
   - Apply **only** `supabase/migrations/20261113000000` → `20261113130000` (exclude `supabase/seed.sql` and `supabase/archive/*`).
   - Verify `on_auth_user_created` (`auth.users`) and `clinical_files_select_tenant` / `clinical_files_insert_tenant` (`storage.objects`) exist.
   - Manually insert the authorized staging Platform Owner UUID into `public.platform_admins`.
   - Execute `supabase/tests/rls_multi_tenant_suite.sql` (`psql -v ON_ERROR_STOP=1`) plus direct test calls to `public.update_pet` and `public.get_org_service_summary`.

---
*Status: Corrections complete and statically verified; zero SQL executed. Stopped and awaiting explicit approval before applying migrations.*

