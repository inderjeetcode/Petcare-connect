# PET CONNECT — Phase 2 Database Change Report

**Phase:** Phase 2 — Database & Multi-Tenant Security  
**Migration Strategy:** Expand → Backfill → Validate → Switch *(Contract deferred to Phase 11)*  
**Execution Guardrail:** All changes authored as deterministic, timestamped SQL migrations under `supabase/migrations/`. No remote production commands were run; no baseline tables were dropped or recreated.

---

## 1. Legacy Migration Conflict Audit & Archival

Prior to authoring Phase 2 migrations, all pre-existing SQL files were inspected and resolved for conflicts (`SEC-02`, `SEC-11`, `SEC-15`, duplicate `001`/`002`/`999` execution risk):

| Legacy File | Issue Identified | Phase 2 Action |
|---|---|---|
| `supabase/migrations/001_initial_schema.sql` | Conflicted with `999_full_production_deploy.sql`; lacked multi-tenant columns & `RESTRICT` FKs | Moved to `supabase/archive/001_initial_schema.sql`; reconciled into `20261113000000_baseline_single_tenant.sql` |
| `supabase/migrations/002_activate_consultation_rpc.sql` | Superseded single-tenant `activate_consultation` RPC | Moved to `supabase/archive/002_activate_consultation_rpc.sql` |
| `supabase/migrations/003_setup_test_accounts.sql` | **`SEC-02`/`SEC-11` Critical:** Hardcoded `Password123!` accounts and `cleanup_test_records(UUID[])` in auto-run `migrations/` folder | Moved to `supabase/archive/003_setup_test_accounts.sql`; `cleanup_test_records(UUID[])` explicitly dropped in `20261113010000` |
| `supabase/999_full_production_deploy.sql` | Monolithic non-incremental script duplicating `001`+`002`+policies | Moved to `supabase/archive/999_full_production_deploy.sql` |
| `supabase/policies/rls_policies.sql` | Standalone legacy global-role RLS definitions bypassing multi-tenancy | Moved to `supabase/archive/rls_policies.sql` |
| `supabase/tests/security_tests.sql` | **`SEC-15`:** Tested RLS without switching `ROLE authenticated` | Moved to `supabase/archive/security_tests.sql`; replaced by `supabase/tests/rls_multi_tenant_suite.sql` |

---

## 2. Chronological Migration Sequence (`supabase/migrations/`)

| Order | Migration File | Lifecycle Stage | Summary of Changes |
|---|---|---|---|
| 1 | `20261113000000_baseline_single_tenant.sql` | Reconciled Baseline | Idempotent baseline of all 16 existing tables, enums, indexes, and legacy helper baseline for clean local `supabase db reset` replay |
| 2 | `20261113010000_phase2a_security_hardening.sql` | Phase 2a Hardening | Drops `cleanup_test_records(UUID[])` (`SEC-11`); adds `tg_touch_updated_at`, `tg_profiles_guard_identity` (`SEC-09`), `tg_consultations_guard_window` (`SEC-03`), `tg_doctor_profiles_guard_governance` (`SEC-10`); switches `medical_records.pet_id` & `vaccinations.pet_id` FKs to `ON DELETE RESTRICT` + adds `pets.archived_at`/`archived_by`/`created_by` (`SEC-16`); replaces `handle_new_user()` to create `profiles` only (`SEC-20`); revokes direct `INSERT`/`UPDATE`/`DELETE` from `authenticated`/`anon` and all privileges from `anon` (`SEC-03/04/06/08/12/21`) |
| 3 | `20261113020000_phase2b_expand_multi_tenant_core.sql` | Phase 2b Expand (Part 1) | Enables `btree_gist`; creates `app` schema + `app.migration_runs`; creates 20 multi-tenant tables (`platform_admins`, `organizations`, `organization_applications`, `branches`, `organization_roles`, `permissions`, `role_permissions`, `organization_memberships`, `membership_roles`, `membership_branches`, `staff_invitations`, `clinic_clients`, `pet_guardians`, `doctor_branch_assignments`, `doctor_schedules`, `doctor_schedule_exceptions`, `appointments` with `EXCLUDE USING gist`, `appointment_status_history`, `attachments`, `message_attachments`); seeds 5 roles & 16 permissions; enables RLS & revokes direct table writes |
| 4 | `20261113030000_phase2b_extend_existing_tables.sql` | Phase 2b Expand (Part 2) | Non-destructively extends existing baseline tables with `organization_id`, `branch_id`, provenance/audit columns, `UNIQUE(id, organization_id)` parent keys, `consultation_payments` FK `CASCADE → RESTRICT`, nullable `prescriptions.consultation_id` (allowing `appointment_id`), nullable `vaccinations.next_due_date`, extended `notification_type_enum`, pending composite FKs on `pet_guardians`/`appointments`/`doctor_*`, and 35 tenant/FK indexes |
| 5 | `20261113040000_phase2b_app_helpers_and_rpcs.sql` | Phase 2b Helpers & Core RPCs | Creates `app.*` security helpers (`is_platform_admin`, `is_org_active`, `is_org_member`, `has_org_permission`, `has_branch_access`, `current_clinic_client_id`, `is_pet_guardian`, `is_consultation_participant`, internal `write_audit_log`, internal `enqueue_notification`) and hardened `SECURITY DEFINER` RPCs for context, onboarding, branches, clients, pets, schedules, appointments, consultations (incl. `activate_consultation(UUID)`), chat, and clinical records |
| 6 | `20261113045000_phase2b_additional_workflow_rpcs.sql` | Phase 2b Workflow RPCs | Completes remaining contract RPCs: `invite_member`, `accept_invitation` (using PG built-in `pg_catalog.sha256` & `gen_random_uuid()`), `add_pet_guardian`, `update_doctor_self_profile`, `admin_update_doctor_governance`, `get_available_slots`, `reschedule_appointment`, `check_in_appointment`, `complete_appointment`, `mark_no_show`, and `register_attachment` |
| 7 | `20261113050000_phase2c_backfill_maxpetz_safe.sql` | Phase 2c Backfill | Registers `MaxPetZ` (`slug = 'maxpetz'`) **with zero invented branches**; attributes verified non-test entities to MaxPetZ while setting `branch_id = NULL` & `is_legacy_unmapped_branch = true` on historical consultations/prescriptions; expires stale consultations (`expires_at < now()`); sanitizes `blob:`/`example.com` attachments; quarantines `003`/script test artifacts; logs metrics to `app.migration_runs` |
| 8 | `20261113060000_phase2d_validate_tenant_constraints.sql` | Phase 2d Validate | Replaces global `doctor_profiles` `UNIQUE(user_id)` with `UNIQUE(organization_id, user_id)`; adds and validates 22 composite tenant FKs `(fk_id, organization_id)` via `NOT VALID` + `VALIDATE CONSTRAINT` |
| 9 | `20261113070000_phase2e_switch_rls_policies.sql` | Phase 2e Switch | Atomically drops legacy policies and installs hardened `TO authenticated` multi-tenant & branch-scoped RLS policies, strict participant-only chat policies, and private `clinical-files` Storage bucket + `{organization_id}/` path policies |

---

## 3. Existing 16-Table Baseline Preservation Matrix

Every baseline table remains intact with zero `DROP TABLE` or destructive column removal:

1. `profiles` — Retained; added `tg_profiles_guard_identity` (`SEC-09`); email immutable by `authenticated`/`anon`.
2. `user_roles` — Retained read-only (`user_id = auth.uid()`); direct writes revoked; scheduled for Phase 11 removal.
3. `pets` — Added `organization_id`, `archived_at`, `archived_by`, `created_by`, `UNIQUE(id, organization_id)`, `pets_touch_updated_at`.
4. `doctor_profiles` — Added `organization_id`, `registration_number`, `display_name`, `UNIQUE(id, organization_id)`, `UNIQUE(organization_id, user_id)`, `tg_doctor_profiles_guard_governance`.
5. `doctor_availability` — Added `organization_id`, `branch_id`; retained read-only during transition (superseded by `doctor_schedules`).
6. `consultations` — Added `organization_id`, `branch_id`, `clinic_client_id`, `appointment_id`, `activated_by`, `rejected_by`, `completed_by`, `is_legacy_unmapped_branch`, `UNIQUE(id, organization_id)`, `uq_consultations_appointment_active`, `tg_consultations_guard_window`, and 5 composite tenant FKs.
7. `consultation_payments` — Added `organization_id`; changed `consultation_id` FK from `ON DELETE CASCADE` to `ON DELETE RESTRICT`; added composite FK `(consultation_id, organization_id)`.
8. `chat_conversations` — Added `organization_id`, `UNIQUE(id, organization_id)`, composite FKs `(consultation_id, organization_id)` & `(doctor_id, organization_id)`.
9. `chat_messages` — Added `organization_id`, composite FK `(conversation_id, organization_id)`.
10. `prescriptions` — Added `organization_id`, `branch_id`, `appointment_id`, `status ('issued'|'void')`, `voided_by`, `voided_at`, `void_reason`, `is_legacy_unmapped_branch`, `UNIQUE(id, organization_id)`; `consultation_id` nullable with `CHECK (consultation_id IS NOT NULL OR appointment_id IS NOT NULL)`; 5 composite tenant FKs.
11. `prescription_items` — Added `organization_id`, composite FK `(prescription_id, organization_id)`.
12. `medical_records` — Added `organization_id`, `created_by`, `amended_from_id`, `UNIQUE(id, organization_id)`; `pet_id` FK hardened to `ON DELETE RESTRICT`; 4 composite tenant FKs.
13. `vaccinations` — Added `organization_id`, `doctor_profile_id`, `batch_number`, `created_at`, `created_by`, `is_backfilled`; `pet_id` FK hardened to `ON DELETE RESTRICT`; `next_due_date` nullable; 2 composite tenant FKs.
14. `notifications` — Added `organization_id`; extended `notification_type_enum` with `'appointment'`, `'membership'`, `'join_request'`.
15. `reviews` — Added `organization_id`, composite FK `(consultation_id, organization_id)`.
16. `audit_logs` — Added `organization_id`, `actor_user_id`, `before_json`, `after_json`, `request_id`.

---

## 4. Historical MaxPetZ Branch Preservation Guarantee

Per `HISTORICAL_BRANCH_MAPPING_PLAN.md`:
- `20261113050000_phase2c_backfill_maxpetz_safe.sql` creates ONLY the `MaxPetZ` organization record (`slug = 'maxpetz'`) and **zero synthetic branches** (no `"Main"`, `"Legacy"`, or `"Default"` branch).
- Historical consultations and prescriptions retain `branch_id = NULL` and `is_legacy_unmapped_branch = true`.
- Composite FKs `consultations_branch_org_fk` and `prescriptions_branch_org_fk` use PostgreSQL `MATCH SIMPLE`, permitting `branch_id = NULL` while guaranteeing any non-null `branch_id` belongs to the exact same `organization_id`.

---

## 5. Deferred Phase 11 Contract Cleanups

- Drop deprecated `public.user_roles` and `public.doctor_availability` tables once all portals switch to `organization_memberships` and `doctor_schedules`.
- Drop deprecated `public.is_admin()` / `public.is_doctor()` functions if still present in remote DBs.
- Enforce `NOT NULL` on `organization_id` across backfilled legacy tables after verifying zero quarantined legacy rows remain.
