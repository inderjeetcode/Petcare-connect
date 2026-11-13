# Pet Connect — Staging Migration Fix Report

**Report Date:** 2026-11-13  
**Scope:** Pre-apply remediation of the two confirmed SQL defects in `supabase/migrations/`, migration strategy analysis, full static security/schema re-verification, and staging post-apply operational procedures.  
**Execution Guardrail:** Zero Supabase connections made, zero SQL executed, zero migrations applied, zero users created, and zero production changes performed.

---

## 1. Exact Changed Migration Files & Corrections

Two pending migration files were corrected directly prior to initial staging execution. All 13 other migration files (including `20261113000000_baseline_single_tenant.sql` and all 16 baseline tables) remain untouched.

### 1.1 Fix 1 — `supabase/migrations/20261113130000_phase9_reports_notifications_indexes.sql`
- **Target Function:** `public.get_org_service_summary(p_organization_id UUID, p_from TIMESTAMPTZ DEFAULT NULL, p_to TIMESTAMPTZ DEFAULT NULL, p_branch_id UUID DEFAULT NULL)`
- **Root Cause:** Lines 191–192 filtered `LEFT JOIN public.appointments a` using `coalesce(a.scheduled_start, a.requested_start)`. `public.appointments` (defined in `20261113020000`, extended with `service_id` in `20261113120000`) stores `scheduled_range TSTZRANGE` (`NULL` while `status = 'requested'`) and `requested_start TIMESTAMPTZ`, and has **no** `scheduled_start` column.
- **Exact Change (Lines 191–192):**
  - Replaced:
    ```sql
    AND (p_from IS NULL OR coalesce(a.scheduled_start, a.requested_start) >= p_from)
    AND (p_to IS NULL OR coalesce(a.scheduled_start, a.requested_start) <= p_to)
    ```
  - With:
    ```sql
    AND (p_from IS NULL OR coalesce(lower(a.scheduled_range), a.requested_start) >= p_from)
    AND (p_to IS NULL OR coalesce(lower(a.scheduled_range), a.requested_start) <= p_to)
    ```
- **Schema Verification Across Full Function:**
  - `public.clinic_services cs` (`100000`): `id` (PK), `organization_id`, `branch_id`, `name`, `code`, `category`, `duration_minutes`, `price`, `is_active` — all exist with matching types; `GROUP BY cs.id` covers all selected `cs.*` columns validly in PostgreSQL.
  - `public.appointments a` (`020000`, `120000`): `id`, `organization_id`, `branch_id`, `service_id`, `status` (`'requested'`, `'confirmed'`, `'checked_in'`, `'completed'`, `'declined'`, `'cancelled'`, `'no_show'`), `scheduled_range` (`TSTZRANGE`), `requested_start` (`TIMESTAMPTZ`) — all exist; `lower(NULL::TSTZRANGE)` returns `NULL`, so unconfirmed appointments cleanly fall back to `a.requested_start`, while confirmed/completed appointments filter by the range start `lower(a.scheduled_range)`.
  - Aggregations & Ordering: `count(a.id)::int`, `FILTER (WHERE a.status ...)`, `round((... * cs.price)::numeric, 2)`, and `ORDER BY booking_count DESC, service_name ASC` resolve against `sub` aliases cleanly.
  - Security & Permissions Preserved: `STABLE SECURITY DEFINER SET search_path = ''`, auth/membership/`audit.read`/`appointments.read` checks, `REVOKE ALL ... FROM PUBLIC, anon`, and `GRANT EXECUTE ... TO authenticated` remain intact.

### 1.2 Fix 2 — `supabase/migrations/20261113120000_phase8_core_workflows_hardening.sql`
- **Target Function:** `public.update_pet(p_pet_id UUID, p_updates JSONB)` (lines 1744–1807)
- **Root Cause:** Migration `20261113120000` redefined `public.update_pet(UUID, JSONB)` from the older `20261113040000` body plus `blob:`/`data:` avatar validation, overwriting the Phase 4 enhancements added in `20261113080000` (`date_of_birth`, nullable field clearing, `weight <= 0` validation, and `archived_at IS NOT NULL` check).
- **Exact Restored & Merged Behavior:**
  1. **Archived Pet Protection:** `SELECT * INTO v_pet FROM public.pets WHERE id = p_pet_id FOR UPDATE; IF NOT FOUND OR v_pet.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Pet not found or archived' USING ERRCODE = 'P0002'; END IF;`
  2. **Authorization & Organization Ownership Unchanged:** Continues enforcing `v_uid IS NOT NULL` (`28000`) and `app.is_pet_guardian(v_pet.organization_id, p_pet_id) OR app.has_org_permission(v_pet.organization_id, 'pets.write')` (`42501`), both of which return `false` if `v_pet.organization_id` is `NULL`, inactive, or belongs to another organization.
  3. **`avatar_url` Hygiene & Clearing:** Retains `22023` rejection for `^blob:` and `^data:` URLs while allowing explicit clearing (`NULL` / `''` when `'avatar_url'` key is present in `p_updates`) and preserving existing value when the key is omitted.
  4. **Weight Validation:** When `p_updates ? 'weight'` and `NULLIF(trim(COALESCE(p_updates->>'weight', '')), '') IS NOT NULL`, casts to `NUMERIC` and enforces `v_new_weight > 0` (`22023` `'Pet weight must be positive'`); otherwise preserves `v_pet.weight`.
  5. **`date_of_birth` Updates & Clearing:** When `p_updates ? 'date_of_birth'`, converts `NULLIF(trim(COALESCE(p_updates->>'date_of_birth', '')), '')::DATE` (supporting both date updates and clearing to `NULL`); otherwise preserves `v_pet.date_of_birth`.
  6. **Clearing Nullable Fields (`color`, `allergies`, `medical_notes`):** Uses `CASE WHEN p_updates ? '<field>' THEN NULLIF(trim(COALESCE(p_updates->>'<field>', '')), '') ELSE <field> END`, matching `080000` and `clientPortalService.ts` (`color: ''`, `allergies: ''`, `medical_notes: ''`).
  7. **Audit & `updated_at`:** Sets `updated_at = timezone('utc'::text, now())` and preserves `app.write_audit_log(..., 'UPDATE_PET', ...)` and `REVOKE ALL ... FROM PUBLIC, anon; GRANT EXECUTE ... TO authenticated;`.

---

## 2. Migration Strategy Rationale

1. **Why Direct Pre-Apply Correction Was Chosen for Fresh Staging:**
   - As verified in `STAGING_MIGRATION_REVIEW.md`, **no migrations have been executed** against the new isolated staging database yet (`supabase_migrations.schema_migrations` has zero applied rows).
   - Patching `20261113120000` and `20261113130000` directly keeps the repository cleanly at 15 canonical migrations (`20261113000000` → `20261113130000`), avoids leaving a broken `130000` function or a regressed `120000` state in fresh replays, and preserves the 16-table baseline (`000000`) completely untouched.
2. **Required Forward-Only Strategy for Any Already-Migrated Environment:**
   - If another environment (e.g., an existing local developer DB or another project) has **already** applied `20261113120000` or `20261113130000`, **do not** force-reset or alter `supabase_migrations.schema_migrations` history in production or shared environments.
   - Instead, create a **forward-only corrective migration** (e.g., `supabase/migrations/20261113140000_fix_update_pet_and_service_summary.sql`) containing idempotent `CREATE OR REPLACE FUNCTION` definitions for `public.update_pet(UUID, JSONB)` and `public.get_org_service_summary(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID)` plus their `REVOKE`/`GRANT` statements. That allows `supabase db push` to advance already-migrated databases without checksum/history conflicts.

---

## 3. Additional Pre-Apply Verification & Operational Procedures

### 3.1 Static Verification Summary Across All 15 Migrations
- **Execution Order (15 files):** Confirmed strict lexicographical sequence `20261113000000` → `20261113130000`.
- **RLS Coverage:** Confirmed all **39** tables in `public` (`16` baseline + `20` Phase 2B + `1` `clinic_services` + `2` Phase 7) have `ENABLE ROW LEVEL SECURITY` (`Missing RLS: []`). `app.migration_runs` lives in the private `app` schema (`REVOKE ALL ON SCHEMA app FROM PUBLIC, anon, authenticated`).
- **Function Signatures, `search_path`, & Permissions:** Inspected all **98** distinct functions across the 15 migrations:
  - `0` `SECURITY DEFINER` functions missing `SET search_path` (`SET search_path = ''` everywhere except legacy baseline `is_admin()`/`is_doctor()` stubs which use `SET search_path = public, pg_temp`).
  - `0` `GRANT EXECUTE` statements to `PUBLIC` or `anon`.
  - `0` public non-trigger functions missing `REVOKE ALL ... FROM PUBLIC, anon` or `GRANT EXECUTE ... TO authenticated`.
- **MaxPetZ Idempotency (`20261113050000_phase2c_backfill_maxpetz_safe.sql`):**
  - `INSERT INTO public.organizations (...) VALUES ('maxpetz', ...) ON CONFLICT (slug) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id INTO v_maxpetz_id;` is idempotent.
  - Subsequent backfills check `organization_id IS NULL` or `ON CONFLICT DO NOTHING` and log counts cleanly into `app.migration_runs`. On a fresh empty DB, it safely creates only the idle `'maxpetz'` row and records 0 backfilled clinical/client rows.
- **Excluded Files (`seed.sql` & `supabase/archive/`):**
  - Confirmed `supabase/seed.sql` remains excluded (single-tenant fixtures without `organization_id` or `auth.users`). Do **not** run `supabase/seed.sql` or `supabase db reset` with seeding enabled on staging.
  - Confirmed `supabase/archive/*` (`001_initial_schema.sql`, `002_activate_consultation_rpc.sql`, `003_setup_test_accounts.sql`, `999_full_production_deploy.sql`, `rls_policies.sql`, `security_tests.sql`) remain quarantined and excluded from `supabase/migrations/`.

### 3.2 Manual `platform_admins` Bootstrap Procedure (Post-Migration)
No migration populates `public.platform_admins`. After migrations are applied on staging:
1. Have the designated Platform Owner operator create/confirm their user via Supabase Auth (`/signup` or Dashboard → Authentication → Users).
2. Capture their `auth.users.id` UUID and run the following in the **Supabase Dashboard SQL Editor** (privileged role):
   ```sql
   INSERT INTO public.platform_admins (user_id, granted_by, is_active, notes)
   VALUES ('<operator-auth-user-uuid>', '<operator-auth-user-uuid>', true, 'Initial staging Platform Owner bootstrap')
   ON CONFLICT (user_id) DO UPDATE
     SET is_active = true,
         notes = EXCLUDED.notes;
   ```
3. Verify `SELECT user_id, is_active, granted_at FROM public.platform_admins;` returns the operator row. Subsequent admins can then be managed via `public.platform_grant_platform_admin(...)`.

### 3.3 Hosted Auth Trigger & Storage Policy Verification Procedure (Post-Migration)
Because `20261113010000` (`on_auth_user_created`) and `20261113070000` (`storage.objects` policies) catch `insufficient_privilege` and log a `NOTICE` if the migration role lacks table ownership on `auth.users` or `storage.objects`, verify both explicitly after applying migrations:

```sql
-- 1. Verify auth.users signup trigger (should return 1 enabled row: on_auth_user_created -> handle_new_user)
SELECT tgname, tgenabled, pg_get_triggerdef(oid)
FROM pg_trigger
WHERE tgrelid = 'auth.users'::regclass
  AND tgname = 'on_auth_user_created';

-- 2. Verify private clinical-files bucket & storage.objects RLS policies
SELECT id, public, file_size_limit, allowed_mime_types
FROM storage.buckets
WHERE id = 'clinical-files';

SELECT schemaname, tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND policyname IN ('clinical_files_select_tenant', 'clinical_files_insert_tenant');
```
If either the trigger or storage policies are missing due to ownership restrictions, execute the corresponding `CREATE TRIGGER` (`20261113010000:215–222`) or `CREATE POLICY` (`20261113070000:425–463`) block directly in the Supabase Dashboard SQL Editor as the privileged owner role.

---

## 4. Verification & Testing Executed (Honest Disclosure)

| Check | Status | Details & Evidence |
| :--- | :---: | :--- |
| **PostgreSQL CLI / Runtime Check (`psql`, `postgres`, `pg_ctl`, `supabase`, `docker`)** | **NOT AVAILABLE / NOT EXECUTED** | None of `psql`, `postgres`, `pg_ctl`, `supabase`, or `docker` are installed in this container (`NOT INSTALLED`). Per instructions, zero Supabase connections or SQL executions were performed. |
| **Static SQL AST/Regex Verification across 15 migrations** | **PASS** | Custom Node scan confirmed: 15 migration files in order, 39/39 `public` tables with RLS enabled, 98 functions checked with 0 missing `SET search_path`, 0 grants to `PUBLIC`/`anon`, 0 public non-trigger functions missing `REVOKE`/`GRANT`, 0 unbalanced `$$` dollar quotes, and 0 remaining `scheduled_start` references in `supabase/migrations/`. |
| **TypeScript Static Typecheck (`npm run lint`)** | **PASS** | `tsc --noEmit` exited with code `0` and zero errors. |
| **`npx tsx scripts/verify_phase4_client.ts`** | **PASS (Offline)** | All 9 offline checks passed (`validatePetForm`, `validateClientProfile`, tenant checks, MIME/size checks, slot/chat/review validators, Phase 4 SQL contract). |
| **`npx tsx scripts/verify_phase8_workflows.ts`** | **PASS (Offline) / SKIPPED (Live DB)** | All 4 offline contract & hygiene sections passed; live Postgres RPC/RLS `TEST 13` skipped (no live DB configured). |
| **`npx tsx scripts/verify_phase9_polish.ts`** | **PASS (Offline)** | All 5 groups passed, including `20261113130000` SQL migration guarantees (`get_org_service_summary`, `notifications` column grant, `enqueue_notification` 60s dedup, indexes) and static UI hygiene. |
| **Live Postgres Compilation & Execution of `get_org_service_summary` and `update_pet`** | **PENDING STAGING APPLY** | Must be verified against the live staging PostgreSQL 15+ database after approval to apply migrations (`psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_multi_tenant_suite.sql` + smoke calls for both corrected RPCs). |

---
*Status: Corrections completed and statically verified; zero SQL executed. Stopped and awaiting explicit user approval before applying migrations to staging.*
