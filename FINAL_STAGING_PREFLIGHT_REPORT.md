# Pet Connect — Final Staging Migration Pre-Flight Report

**Pre-Flight Date:** 2026-11-13  
**Reviewed Artifacts:** `STAGING_MIGRATION_REVIEW.md`, `STAGING_MIGRATION_FIX_REPORT.md`, `supabase/config.toml`, `supabase/migrations/` (15 files), `supabase/seed.sql`, `supabase/archive/` (6 files)  
**Pre-Flight Verdict:** **BLOCKED / ACTION REQUIRED BEFORE `npx supabase db push`**  
*(Repository migration files are verified and ready, but the workspace has no linked Supabase project or staging credentials, and `supabase/config.toml` uses `[inbucket]` which Supabase CLI `3.1.0` rejects.)*

---

## 1. Pre-Flight Checklist Summary

| # | Check | Status | Observed Evidence |
| :-: | :--- | :---: | :--- |
| 1 | `STAGING_MIGRATION_REVIEW.md` & `STAGING_MIGRATION_FIX_REPORT.md` reviewed | **PASS** | Both documents inspected in full; both SQL fixes (`get_org_service_summary` and `update_pet`) are confirmed present in `130000` and `120000`. |
| 2 | All 15 corrected migration files present and ordered | **PASS** | `supabase/migrations/` contains exact 15 files ordered `20261113000000` → `20261113130000`. |
| 3 | Linked Supabase project ref matches new `pet-connect-staging` | **FAIL (NOT LINKED)** | `supabase/.temp` does not exist; `/root/.supabase` does not exist; no `.env` or `.env.local` exists (only `.env.example`); zero `SUPABASE_*`, `VITE_SUPABASE_*`, `DATABASE_*`, or `PG*` env vars are set in this container. |
| 4 | Credentials kept private (none exposed/printed) | **PASS** | Zero secrets, tokens, passwords, or connection strings were read or printed. |
| 5 | Confirm linked project is NOT the old MaxPetZ/Pet Connect project | **PARTIAL / CODE CLEAN** | `grep` across `src/`, `scripts/`, `supabase/`, and `.env*` confirmed **0** occurrences of the historical project ref (`ntnzspsscbfmziintsru`). However, because no project is linked in this container, the live staging project ref cannot yet be verified here until linked. |
| 6 | `npx supabase db push --dry-run` executed only | **EXECUTED (`EXIT 1`)** | Ran `npx supabase db push --dry-run`; aborted on `supabase/config.toml` `[inbucket]` validation before remote connection. |
| 7 | `supabase/seed.sql` & `supabase/archive/` excluded | **PASS** | `supabase/seed.sql` resides outside `supabase/migrations/` (`db push` ignores it); all 6 legacy scripts remain isolated in `supabase/archive/`. |
| 8 | Zero SQL / migrations / user creation / DB edits executed | **PASS** | No SQL executed, no `db push` applied, no users created, no DB objects modified. |

---

## 2. Actual Command Results

### 2.1 Environment & Linked Project State Check
```text
ls -la .env* supabase/.temp
ls: cannot access 'supabase/.temp': No such file or directory
-rw-r--r-- 1 root root 312 Nov 13 12:08 .env.example

ls -la /root/.supabase /root/.config
ls: cannot access '/root/.supabase': No such file or directory
ls: cannot access '/root/.config': No such file or directory

Relevant env var names present (SUPABASE|VITE_|DATABASE|PG): []
```
- Also verified zero references to the legacy production project ref (`ntnzspsscbfmziintsru`) in `src/`, `scripts/`, `supabase/`, or `.env*` (`NO_OLD_PROJECT_REF_IN_CODE_OR_CONFIG`).

### 2.2 `npx supabase db push --dry-run` Output
**Command:** `npx supabase db push --dry-run` (using `supabase@3.1.0` via `npx`)  
**Exit Code:** `1`  
**Observed Output:**
```text
[inbucket] in supabase/config.toml is no longer supported. Use [local_smtp] instead.
Try rerunning the command with --debug to troubleshoot the error.
```

**Debug Run (`npx supabase db push --dry-run --debug`):**
```text
No profile file at /root/.supabase/profile; using the default profile.
[inbucket] in supabase/config.toml is no longer supported. Use [local_smtp] instead.
```

**Warnings & Findings from CLI Execution:**
1. **Breaking `supabase/config.toml` Directive for CLI v3.1.0:** Lines 31–33 of `supabase/config.toml` define `[inbucket]`, which is no longer supported by Supabase CLI `3.1.0` and must be updated to `[local_smtp]` (or removed/migrated) before `npx supabase db push --dry-run` or `npx supabase db push` can run.
2. **Unlinked CLI Workspace:** Because `/root/.supabase` and `supabase/.temp/project-ref` are absent and no `SUPABASE_ACCESS_TOKEN` / `SUPABASE_DB_URL` env vars exist in this container, `supabase link --project-ref <pet-connect-staging-ref>` (or `--db-url` in an authorized environment) has not yet been performed here. Consequently, the CLI could not connect to inspect remote `supabase_migrations.schema_migrations`.

---

## 3. Exact Pending Migration List (On Disk, Ready to Apply in Order)

All 15 files in `supabase/migrations/` are present in exact chronological order:

1. `supabase/migrations/20261113000000_baseline_single_tenant.sql`
2. `supabase/migrations/20261113010000_phase2a_security_hardening.sql`
3. `supabase/migrations/20261113020000_phase2b_expand_multi_tenant_core.sql`
4. `supabase/migrations/20261113030000_phase2b_extend_existing_tables.sql`
5. `supabase/migrations/20261113040000_phase2b_app_helpers_and_rpcs.sql`
6. `supabase/migrations/20261113045000_phase2b_additional_workflow_rpcs.sql`
7. `supabase/migrations/20261113050000_phase2c_backfill_maxpetz_safe.sql`
8. `supabase/migrations/20261113060000_phase2d_validate_tenant_constraints.sql`
9. `supabase/migrations/20261113070000_phase2e_switch_rls_policies.sql`
10. `supabase/migrations/20261113080000_phase4_client_reviews_and_pet_updates.sql`
11. `supabase/migrations/20261113090000_phase5_doctor_portal_rpcs.sql`
12. `supabase/migrations/20261113100000_phase6_admin_portal_services_and_governance.sql`
13. `supabase/migrations/20261113110000_phase7_platform_owner_portal.sql`
14. `supabase/migrations/20261113120000_phase8_core_workflows_hardening.sql` *(corrected: `update_pet`)*
15. `supabase/migrations/20261113130000_phase9_reports_notifications_indexes.sql` *(corrected: `get_org_service_summary`)*

---

## 4. Confirmed Excluded Files (`seed.sql` & `supabase/archive/`)

- **Excluded Seed File:** `supabase/seed.sql` (single-tenant demo fixture; not located inside `supabase/migrations/`, so `supabase db push` does not execute it; do **not** run it manually or via `db reset`).
- **Excluded Archive Directory (`supabase/archive/`):**
  - `supabase/archive/001_initial_schema.sql`
  - `supabase/archive/002_activate_consultation_rpc.sql`
  - `supabase/archive/003_setup_test_accounts.sql`
  - `supabase/archive/999_full_production_deploy.sql`
  - `supabase/archive/rls_policies.sql`
  - `supabase/archive/security_tests.sql`

---

## 5. Required Actions Before Re-Running Pre-Flight & `npx supabase db push`

1. **Fix `supabase/config.toml` Compatibility (with approval):** Update `[inbucket]` (lines 31–33) to `[local_smtp]` so Supabase CLI `3.1.0` parses `config.toml` cleanly.
2. **Link the New `pet-connect-staging` Project:** Ensure the CLI session is authenticated (`supabase login` or `SUPABASE_ACCESS_TOKEN`) and linked via `npx supabase link --project-ref <pet-connect-staging-project-ref>`, verifying `cat supabase/.temp/project-ref` matches your **new** staging project (and **not** the old production ref).
3. **Re-run `npx supabase db push --dry-run`:** Confirm it connects to `pet-connect-staging` and lists all 15 pending migrations cleanly with exit code `0` before approving `npx supabase db push`.

---
*Status: Zero migrations or SQL executed. Stopped and awaiting explicit instructions/approval.*
