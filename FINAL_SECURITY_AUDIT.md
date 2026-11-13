# Pet Connect — Final Security Audit Report (Phase 10)

**Audit Date:** 2026-11-13  
**Auditor Role:** Principal Software Architect & Supabase Security Auditor  
**Audit Scope:** Credentials & Environment Hygiene, RLS Policies, `SECURITY DEFINER` Functions, Direct Table Access vs RPC Enforcement, Multi-Tenant & Platform Owner Privilege Boundaries, Storage Security, Cascading Data Deletion, and Production Script Safety.

---

## 1. Executive Security Verdict

The Pet Connect multi-tenant schema (`20261113000000`–`20261113130000`) and active portal services (`authService.ts`, `onboardingService.ts`, `clientPortalService.ts`, `doctorPortalService.ts`, `adminPortalService.ts`, `platformPortalService.ts`) implement **defense-in-depth multi-tenant isolation** in PostgreSQL:
- Direct DML on workflow, clinical, chat, and audit tables is revoked from `anon` and `authenticated`.
- All 38 tables in `public` have Row Level Security enabled (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`).
- All `SECURITY DEFINER` RPCs enforce `SET search_path = ''`, authenticate `auth.uid()`, validate organization/branch/role membership, and restrict `EXECUTE` grants to `authenticated` only.
- **Critical Caveat:** Static SQL/code inspection **PASSES** security checks (with specific non-blocking code hygiene & local-config findings below), whereas **live authenticated multi-user RLS runtime verification is BLOCKED** until executed against a live Postgres/Supabase database (`supabase/tests/rls_multi_tenant_suite.sql`).

---

## 2. Credentials, Secrets & `service_role` Leakage Audit

| Check | Status | Observed Evidence |
| :--- | :--- | :--- |
| Hardcoded Supabase URLs or keys in `src/` or `scripts/` | **PASS** | `grep` across `src/` and `scripts/` found zero hardcoded `supabase.co` URLs or JWT keys. `src/config/supabaseClient.ts` reads strictly `import.meta.env.VITE_SUPABASE_URL` and `import.meta.env.VITE_SUPABASE_ANON_KEY`, failing closed (`supabase = null`, `isSupabaseConfigured = false`) when absent. |
| `service_role` key exposure in frontend or scripts | **PASS** | Zero occurrences of `service_role` in `src/` or `scripts/`. `.env.example` contains only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. |
| `.env` / `.env.local` committed to repository | **PASS** | No `.env` or `.env.local` files exist in workspace; `.gitignore` excludes env files. |
| `supabase/archive/003_setup_test_accounts.sql` | **QUARANTINED** | Legacy test-account SQL resides exclusively in `supabase/archive/`, excluded from `supabase/migrations/`. Must never be applied to staging/production. |

---

## 3. Database Security Controls Audit

### 3.1 Table Grants & Direct Mutation Prevention
Verified across `20261113010000`, `20261113020000`, `20261113100000`, `20261113110000`, and `20261113130000`:
- `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;` (Phase 2a).
- `REVOKE INSERT, UPDATE, DELETE ... FROM PUBLIC, anon, authenticated` applied to: `user_roles`, `pets`, `doctor_profiles`, `doctor_availability`, `consultations`, `consultation_payments`, `chat_conversations`, `chat_messages`, `prescriptions`, `prescription_items`, `medical_records`, `vaccinations`, `reviews`, `audit_logs`, `clinic_services`, `platform_settings`, `platform_support_access_grants`, and all Phase 2B core tenant tables.
- **Profiles:** Direct `INSERT`/`DELETE` revoked; `UPDATE` permitted only for `id = auth.uid()` and guarded by `tg_profiles_guard_identity` trigger (`profiles.id` and `profiles.email` immutable for `authenticated`/`anon`).
- **Notifications:** `REVOKE UPDATE ON public.notifications FROM PUBLIC, anon, authenticated; GRANT UPDATE (is_read) ON public.notifications TO authenticated;` (`20261113130000`) plus `notifications_update_own_read` RLS policy (`user_id = auth.uid()`), preventing clients from tampering with notification titles, messages, or target links.

### 3.2 `SECURITY DEFINER` Function Hygiene
Automated AST/pattern scan across all 15 files in `supabase/migrations/`:
- **0 missing `SET search_path` issues:** Every `SECURITY DEFINER` function in Phases 2a–9 sets `SET search_path = ''` (and the two deprecated baseline stubs `public.is_admin()` / `public.is_doctor()` set `SET search_path = public, pg_temp`).
- **0 `PUBLIC` or `anon` grants:** Automated check of all `GRANT EXECUTE` statements across all 15 migrations confirmed **0** grants to `PUBLIC` or `anon`. Every RPC uses `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon; GRANT EXECUTE ... TO authenticated;`, and internal `app.*` helpers revoke from `PUBLIC, anon, authenticated`.

### 3.3 RLS Policy & Tenant Isolation Review (`20261113070000_phase2e_switch_rls_policies.sql`)
- Atomic policy switch drops legacy permissive single-tenant policies inside the migration transaction before creating strict `TO authenticated` multi-tenant policies.
- **No `USING (true)` on tenant/clinical tables:** Only static RBAC catalogue tables (`organization_roles`, `permissions`, `role_permissions`) allow `SELECT TO authenticated USING (true)`.
- **Composite Tenant Foreign Keys (`20261113060000`):** Enforce `(child_fk, organization_id)` integrity via `NOT VALID` + `VALIDATE CONSTRAINT` so cross-tenant links fail at the constraint layer (`23503`) even if RLS were bypassed.
- **Consultation 7-Day Window Immutability:** Enforced via `check_seven_day_expiry` CHECK constraint, `tg_consultations_guard_window` BEFORE UPDATE trigger (blocks changing `activated_at`/`expires_at` once set and blocks reopening terminal states `completed`/`expired`/`rejected`), and `activate_consultation` / `send_chat_message` RPCs.
- **D-16 Strict Chat & Attachment Privacy:** `chat_conversations_select_participants_only`, `chat_messages_select_participants_only`, `message_attachments_select_participants_only`, and `attachments_select_tenant` (`consultation` / `chat_message`) evaluate `app.is_consultation_participant(...)`, permitting **only** the consultation's client and treating doctor (explicitly excluding `org_admin`, `org_owner`, `front_desk`, `branch_manager`, peer doctors, and `platform_admin`).
- **D-17 Org-Wide Doctor Clinical Read:** `medical_records`, `prescriptions`, `prescription_items`, and `vaccinations` allow reads to pet guardians (`app.is_pet_guardian`) and active org members with `medical_records.read` within the same active organization.

---

## 4. Privilege Escalation & Platform Owner Boundaries

| Boundary | Enforcement Mechanism | Audit Result |
| :--- | :--- | :--- |
| **Platform Owner vs Clinical PHI** | `platform_admins` grants zero SELECT access to `pets`, `consultations`, `chat_conversations`, `chat_messages`, `prescriptions`, `medical_records`, `vaccinations`, `clinic_clients`, `consultation_payments`. `platformPortalService.ts` and `AppContext.tsx` (when `portal === 'platform'`) make zero clinical queries. | **PASS (Static)** / **BLOCKED (Live RLS)** |
| **Exceptional Support Access** | `platform_support_access_grants` (`20261113110000`) limits scope to `'org_diagnostics' \| 'billing_audit' \| 'schedule_support'`, defaults/caps duration (`15..480` min), requires **Organization Owner** (`org.manage`) approval (`approve_platform_support_access`), is revocable, auto-expires, writes audit logs, and `platform_get_scoped_support_snapshot` returns **aggregate counts only** (zero patient/clinical/chat rows). | **PASS (Static)** / **BLOCKED (Live RLS)** |
| **Self-Promotion / Global Admin** | `handle_new_user()` (`SEC-20`) creates `profiles` only with zero role grants. `platform_grant_platform_admin` requires an existing active `platform_admin` and rejects self-revocation (`platform_revoke_platform_admin`). Org `set_member_roles` prevents non-owners from assigning `org_owner` or `org_admin` and prevents owners from removing their own `org_owner` role when they are the sole owner. | **PASS (Static)** / **BLOCKED (Live RLS)** |
| **Client Approval Gate** | Pending `clinic_clients` (`status = 'requested'`) see 0 doctors, branches, or schedules (`current_clinic_client_id()` requires `status = 'approved'`). | **PASS (Static)** / **BLOCKED (Live RLS)** |

---

## 5. Storage Security Review (`clinical-files` Bucket)

Verified in `20261113070000_phase2e_switch_rls_policies.sql` (lines 408–468) and `20261113120000_phase8_core_workflows_hardening.sql` (lines 47–64):
- Bucket `clinical-files` is forced `public = false`, `file_size_limit = 10485760` (10 MiB), `allowed_mime_types = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']`.
- `storage.objects` policies enforce UUID-prefixed paths (`<organization_id>/...`), membership/client checks on `INSERT`, and matching `public.attachments` metadata registration on `SELECT`.
- `attachments_no_ephemeral_url_chk` and `chat_messages_no_blob_url_chk` reject `blob:`, `data:`, and `..` path traversal at the PostgreSQL `CHECK` constraint layer.
- **Deployment Note:** If the SQL migration runner lacks ownership on `storage.objects`, `20261113070000` catches `insufficient_privilege` and logs a `NOTICE` — operators must verify the two `storage.objects` policies exist after migration.

---

## 6. Destructive Functions & Cascade Deletion Audit

| Risk Area | Findings | Severity | Status / Remediation |
| :--- | :--- | :--- | :--- |
| **`cleanup_test_records(UUID[])` (`SEC-11`)** | Explicitly dropped via `DROP FUNCTION IF EXISTS public.cleanup_test_records(UUID[]);` in `20261113010000` and asserted absent in `rls_multi_tenant_suite.sql` TEST 1. Only remains in archived `supabase/archive/003_setup_test_accounts.sql`. | **Critical (Remediated)** | **Mitigated** in active migrations. **Do not** run `supabase/archive/003_setup_test_accounts.sql`. Update or retire `scripts/test_controlled_rpc.cjs` (which still references it). |
| **Clinical History Cascade Deletion (`SEC-16`)** | `20261113010000` converted `medical_records.pet_id` and `vaccinations.pet_id` from `ON DELETE CASCADE` to `ON DELETE RESTRICT`. `consultations.pet_id` and `prescriptions.pet_id` are already `ON DELETE RESTRICT`. `20261113030000` converted `consultation_payments.consultation_id` to `ON DELETE RESTRICT`. Pet removal uses soft archival (`archive_pet` -> `pets.archived_at`). | **Low (Residual Note)** | Baseline `pets.owner_id REFERENCES profiles(id) ON DELETE CASCADE` and `reviews` / `chat_*` cascades remain in `20261113000000`, though `profiles` DELETE is revoked from API users and child clinical `RESTRICT` constraints block deleting pets with clinical records. Recommend switching `pets.owner_id` to `ON DELETE RESTRICT` in a future migration. |
| **Legacy `supabaseService.ts` + `mockData.ts` in Bundle** | `src/context/AppContext.tsx` retains `isDemoMode = !isSupabaseConfigured`, imports `mockData.ts`, and imports legacy `supabaseService.ts` (direct `.from(...)` writes without `organization_id`). | **Medium (Code Hygiene)** | Portal pages do not invoke legacy `AppContext` CRUD methods, `RequireAuth` blocks portal access when unconfigured, and Postgres `REVOKE` blocks direct table writes. Remove `supabaseService.ts`, `mockData.ts`, and `isDemoMode` fallback in a cleanup commit. |
| **`verify_remote_supabase.cjs` Prod Risk** | `scripts/verify_remote_supabase.cjs` creates synthetic users, pets, and legacy consultations against whatever `VITE_SUPABASE_URL` is supplied. | **Medium (Ops Risk)** | Never run against production; use `supabase/tests/rls_multi_tenant_suite.sql` (`BEGIN...ROLLBACK`) on local/staging. |
| **`supabase/config.toml` Auth Hardening** | Local config has `enable_confirmations = false`, `secure_password_change = false`, `site_url = "http://localhost:3000"`. | **High if copied to Prod** | Configure production HTTPS URLs, enable email confirmations, and enable `secure_password_change` in Supabase Dashboard before launch. |
| **Frontend Route Guards vs DB Security** | `RouteGuards.tsx` explicitly documents guards as UX-only; real enforcement lives in RLS + `SECURITY DEFINER` RPCs. | **Informational** | Sound architecture; live multi-user JWT test required to confirm runtime behavior. |

---

## 7. Security Sign-Off Status

- **Static & Architectural Security:** **PASS (with 2 medium code-cleanup recommendations and 2 operational config gates).**
- **Runtime Authenticated Security Proof:** **BLOCKED** — Must execute `supabase/tests/rls_multi_tenant_suite.sql` (Suites 1–13) against a migrated staging Postgres instance before Go-Live.
