# Pet Connect — Database Migration Status (Phase 10)

**Audit Date:** 2026-11-13  
**Database Engine Target:** PostgreSQL 15+ (Supabase)  
**Execution Status in Current Workspace:** **NOT APPLIED IN WORKSPACE** (Workspace has no Postgres/Supabase CLI or `.env` database credentials; all 15 migrations were audited statically for ordering, idempotency, FK integrity, baseline preservation, and rollback strategy).

---

## 1. Chronological Migration Inventory (15 Incremental Migrations)

Deploy strictly in lexicographical order under `supabase/migrations/`:

| # | Migration File | Purpose & Scope | Preserves 16-Table Baseline? | Key Guarantees & Safety Notes |
| :---: | :--- | :--- | :--- | :--- |
| 0 | `20261113000000_baseline_single_tenant.sql` | Reconciled 16-table single-tenant baseline snapshot | **YES** | Establishes baseline 16 tables + 6 enums + RLS enablement. **For an existing live DB** that already has these 16 tables, mark applied via `supabase migration repair --status applied 20261113000000` after schema diffing; do not re-run legacy `archive/` scripts. |
| 1 | `20261113010000_phase2a_security_hardening.sql` | Pre-multi-tenant security hardening (`SEC-03`..`SEC-21`) | **YES** | Drops `cleanup_test_records(UUID[])`; adds immutable triggers (`profiles_guard_identity`, `consultations_guard_window`, `doctor_profiles_guard_governance`); switches `medical_records.pet_id` & `vaccinations.pet_id` to `ON DELETE RESTRICT`; adds `pets.archived_at`; fixes `handle_new_user()`; revokes direct DML on workflow/clinical/audit tables. |
| 2 | `20261113020000_phase2b_expand_multi_tenant_core.sql` | Additive multi-tenant schema expansion (Part 1) | **YES** | Enables `btree_gist`; creates `app` schema (`app.migration_runs`) and 19 multi-tenant tables (`platform_admins`, `organizations`, `organization_applications`, `branches`, RBAC catalogues, `organization_memberships`, `membership_roles`, `membership_branches`, `staff_invitations`, `clinic_clients`, `pet_guardians`, `doctor_branch_assignments`, `doctor_schedules`, `doctor_schedule_exceptions`, `appointments`, `appointment_status_history`, `attachments`, `message_attachments`) + GiST `no_double_booking` constraint. |
| 3 | `20261113030000_phase2b_extend_existing_tables.sql` | Non-destructive extension of baseline tables (Part 2) | **YES** | Zero columns/tables dropped. Adds `organization_id`, `branch_id`, provenance fields, composite `UNIQUE (id, organization_id)`, converts `consultation_payments.consultation_id` to `ON DELETE RESTRICT`, adds performance indexes. |
| 4 | `20261113040000_phase2b_app_helpers_and_rpcs.sql` | `app.*` helper predicates & core tenant RPCs | **YES** | Adds `app.is_platform_admin`, `app.is_org_active`, `app.is_org_member`, `app.has_org_permission`, `app.has_branch_access`, `app.current_clinic_client_id`, `app.is_pet_guardian`, `app.is_consultation_participant`, `app.write_audit_log`, `app.enqueue_notification` + core RPCs. |
| 5 | `20261113045000_phase2b_additional_workflow_rpcs.sql` | Extended workflow & attachment RPCs | **YES** | `invite_member`, `accept_invitation`, `add_pet_guardian`, `update_doctor_self_profile`, `admin_update_doctor_governance`, `get_available_slots`, `reschedule_appointment`, `check_in_appointment`, `complete_appointment`, `mark_no_show`, `register_attachment`. |
| 6 | `20261113050000_phase2c_backfill_maxpetz_safe.sql` | Deterministic MaxPetZ pilot data backfill | **YES** | Idempotently creates `maxpetz` org (`status = 'active'`), attributes real doctors/clients/pets/consultations/clinical records to MaxPetZ, leaves `branch_id = NULL` with `is_legacy_unmapped_branch = true` (zero fabricated branches), expires stale active consultations, quarantines test artifacts, logs full counts in `app.migration_runs`. |
| 7 | `20261113060000_phase2d_validate_tenant_constraints.sql` | Composite tenant foreign keys & validation | **YES** | Swaps global `doctor_profiles(user_id)` uniqueness to `(organization_id, user_id)`; adds & validates 22 composite `(entity_id, organization_id)` FKs (`MATCH SIMPLE` permits legacy `branch_id = NULL`). |
| 8 | `20261113070000_phase2e_switch_rls_policies.sql` | Atomic multi-tenant RLS & private storage switch | **YES** | Drops legacy single-tenant policies and enables strict tenant-scoped RLS across all tables + creates private `clinical-files` storage bucket & `{organization_id}/` policies. |
| 9 | `20261113080000_phase4_client_reviews_and_pet_updates.sql` | Client portal RPCs (`submit_review`, `update_pet`) | **YES** | Adds client review visibility/submission & guarded pet profile update RPC. |
| 10 | `20261113090000_phase5_doctor_portal_rpcs.sql` | Doctor schedule & clinical summary RPCs | **YES** | Adds `save_doctor_branch_day_schedule`, `add_schedule_exception`, `remove_schedule_exception`, `update_consultation_clinical_summary` with conflict rechecks against confirmed appointments. |
| 11 | `20261113100000_phase6_admin_portal_services_and_governance.sql` | Clinic services table & org admin governance RPCs | **YES** | Creates `public.clinic_services` + `admin_upsert_branch`, `update_organization_settings`, `upsert_clinic_service`, `reactivate_member`, `revoke_staff_invitation`, `suspend_clinic_client`, `reactivate_clinic_client`, `admin_update_doctor_profile_and_governance`. |
| 12 | `20261113110000_phase7_platform_owner_portal.sql` | Platform Owner console tables & governance RPCs | **YES** | Creates `platform_settings`, `platform_support_access_grants`, enhances `get_my_context()`, and adds audited `platform_*` & `approve/reject/revoke_platform_support_access` RPCs. |
| 13 | `20261113120000_phase8_core_workflows_hardening.sql` | Transactional workflows, hygiene checks & realtime | **YES** | Links `appointments.service_id` -> `clinic_services`, adds `blob:`/`data:`/`..` CHECK constraints, hardens `confirm_appointment`, `activate_consultation`, `expire_due_consultations`, `send_chat_message`, clinical RPCs, notifications, and `supabase_realtime` publication enrollment. |
| 14 | `20261113130000_phase9_reports_notifications_indexes.sql` | Reporting RPC, notification dedup & composite indexes | **YES** | Restricts `notifications` UPDATE to `is_read`, adds 60s deduplication in `app.enqueue_notification`, adds 10 reporting/filter indexes, adds `get_org_service_summary`. |

---

## 2. Baseline Preservation & Historical Branch Mapping Verification

- **16-Table Baseline Preserved:** All 16 original tables (`profiles`, `user_roles`, `pets`, `doctor_profiles`, `doctor_availability`, `consultations`, `consultation_payments`, `chat_conversations`, `chat_messages`, `prescriptions`, `prescription_items`, `medical_records`, `vaccinations`, `notifications`, `reviews`, `audit_logs`) remain intact; zero columns were dropped.
- **Historical Branch Integrity (`20261113050000` + `20261113060000`):**
  - Historical `consultations` and `prescriptions` retain `branch_id = NULL` and `is_legacy_unmapped_branch = true` until verified branch source mappings are supplied.
  - Composite FKs `consultations_branch_org_fk` and `prescriptions_branch_org_fk` use PostgreSQL's default `MATCH SIMPLE` semantics so `branch_id = NULL` remains valid while any non-null `branch_id` must belong to the same `organization_id`.
- **Archived Legacy Scripts (`supabase/archive/`):** The 6 legacy files (`001_initial_schema.sql`, `002_activate_consultation_rpc.sql`, `003_setup_test_accounts.sql`, `999_full_production_deploy.sql`, `rls_policies.sql`, `security_tests.sql`) are **excluded** from the migration chain and must never be run.

---

## 3. SQL Verification Suite Status (`supabase/tests/rls_multi_tenant_suite.sql`)

- **Suite Coverage:** 13 end-to-end test suites inside a self-rolling-back `BEGIN; ... ROLLBACK;` transaction using genuine `SET LOCAL ROLE authenticated;` and `request.jwt.claims` (never bypassing RLS for assertions):
  - Suite 1: Confirms `cleanup_test_records(UUID[])` does not exist (`SEC-11`).
  - Suite 2: Multi-org application/approval, branch creation, RBAC privilege boundary (`org_admin` cannot assign `org_admin`).
  - Suite 3: Client approval gate & multi-org global identity.
  - Suite 4: Composite tenant FK violation (`23503`) across orgs.
  - Suite 5: Pending non-reservation, front-desk confirmation, concurrent GiST exclusion (`23P01`), branch-scoped isolation.
  - Suite 6: Mandatory appointment prerequisite (`22023`), 7-day activation window, post-expiry chat rejection, D-16 participant-only chat history.
  - Suite 7: D-17 org-wide doctor clinical read & cross-org isolation.
  - Suite 8: Platform Owner zero clinical access boundary.
  - Suite 9: Organization suspension lockdown & reactivation.
  - Suite 10: Direct table write revocations (`42501`).
  - Suite 11: Pet soft-archival lock & clinical history preservation (`SEC-16`).
  - Suite 12: Staff invitation email binding, doctor self/governance split, consultation attachment privacy.
  - Suite 13: Phase 8 service alignment, cross-branch conflict prevention, `expire_due_consultations`, append-only medical record amendments, prescription voiding, and notification persistence.
- **Execution Status:** **BLOCKED** — Not executed in this workspace because no PostgreSQL/Supabase runtime is available.

---

## 4. Safe Rollout, Backup & Rollback Recommendations

### Pre-Migration Requirements
1. **Take Full Logical & PITR Backup** (`pg_dump` + verify Supabase PITR snapshot) before applying migrations to any existing staging/production project.
2. **Existing Database Reconciliation (if upgrading a legacy 16-table DB):** Run read-only schema comparison first; repair `20261113000000` in migration history if baseline tables already exist, and check `auth.users` trigger & `storage.objects` ownership permissions (migrations log a safe `NOTICE` if restricted, requiring manual Dashboard SQL attachment as `postgres`/storage owner).
3. **Bootstrap Initial Platform Owner:** After migrations complete, manually insert the first verified operator into `public.platform_admins` (never auto-promoted from legacy `user_roles`).
4. **Verify Backfill Telemetry:** Inspect `SELECT * FROM app.migration_runs ORDER BY started_at DESC;` to confirm MaxPetZ attribution counts and quarantined test rows.

### Rollback Strategy
- Migrations `20261113010000`–`20261113130000` are strictly additive/hardening; **point-in-time restore (PITR) or pre-migration snapshot restoration** is the recommended rollback mechanism for production upgrades.
- Because `20261113020000`–`20261113060000` preserve existing columns and tables, application rollback of frontend assets before `phase2e` policy switch does not break legacy data, whereas rolling back *after* `20261113070000` requires restoring the pre-migration snapshot.
