# Pet Connect — Production Readiness Checklist (Go / No-Go)

**Current Release Decision:** **NO-GO (Pending Staging Verification & External Environment Setup)**  
**Code & Static Checks Status:** Complete (`tsc --noEmit` + `vite build` + Phase 3–9 unit/contract suites PASS).  
**Live Runtime Gates:** Incomplete until deployed to an isolated staging Supabase project and verified below.

---

## 1. Environment & External Configuration Requirements

- [ ] **Supabase Project Provisioned** (PostgreSQL 15+, GoTrue Auth, Realtime, Storage enabled).
- [ ] **Frontend Build Environment Variables Configured** (in hosting provider / CI — **never** commit `.env` or put `service_role` in `VITE_*`):
  - `VITE_SUPABASE_URL` = `https://<project-ref>.supabase.co`
  - `VITE_SUPABASE_ANON_KEY` = `<publishable-anon-key>`
- [ ] **Supabase Auth Production URLs Configured** (Dashboard → Authentication → URL Configuration):
  - Set **Site URL** to production HTTPS origin (replace `http://localhost:3000` from `supabase/config.toml`).
  - Add production **Redirect URLs**: `https://<domain>/login`, `https://<domain>/reset-password`.
- [ ] **Supabase Auth Security Settings Hardened** (override `supabase/config.toml` local-dev values):
  - [ ] Enable Email Confirmations (`enable_confirmations = true`) with production SMTP provider configured (not Inbucket).
  - [ ] Enable `secure_password_change = true`.
  - [ ] Verify `enable_anonymous_sign_ins = false` and `enable_refresh_token_rotation = true`.

---

## 2. Database, Migrations & Backfill

- [ ] **Pre-Migration Backup Taken** (full `pg_dump` + verified PITR recovery point on target database).
- [ ] **All 15 Migrations Applied in Exact Order** (`20261113000000` → `20261113130000`).
  - If upgrading an existing 16-table DB, run read-only schema check first and repair `20261113000000` instead of re-creating baseline tables.
- [ ] **Verify `auth.users` Signup Trigger Attached:** Confirm `on_auth_user_created` executes `public.handle_new_user()` (profile-only creation; zero auto-assigned roles).
- [ ] **Verify `app.migration_runs` Backfill Audit:** Confirm MaxPetZ pilot org (`slug = 'maxpetz'`), quarantined test artifacts, and zero fabricated branches (`is_legacy_unmapped_branch = true`).
- [ ] **Bootstrap Initial Platform Owner:** Insert authorized operator UUID(s) into `public.platform_admins` manually via privileged SQL console.
- [ ] **Verify Historical Branch Resolution Plan:** Confirm whether MaxPetZ historical `consultations`/`prescriptions` (`branch_id = NULL`) have been mapped to verified branches or remain intentionally flagged `is_legacy_unmapped_branch = true`.

---

## 3. Storage & Realtime

- [ ] **Private Storage Bucket Verified:** Confirm `storage.buckets` contains `clinical-files` with `public = false`, `file_size_limit = 10485760` (10 MiB), and MIME allowlist (`image/jpeg`, `image/png`, `image/webp`, `application/pdf`).
- [ ] **Storage RLS Policies Active:** Verify `clinical_files_select_tenant` and `clinical_files_insert_tenant` exist on `storage.objects` (apply via Dashboard Storage owner if migration emitted an ownership `NOTICE`).
- [ ] **Realtime Publication Verified:** Confirm `supabase_realtime` includes `public.chat_messages`, `public.notifications`, `public.appointments`, and `public.consultations`.

---

## 4. Security & RLS Staging Verification (Mandatory Before Go-Live)

- [ ] **Execute `supabase/tests/rls_multi_tenant_suite.sql`** against staging DB (`ON_ERROR_STOP=1`) and confirm all 13 suites print `PASSED` with zero residual fixture rows.
- [ ] **Verify Live Auth Flows:** Signup + email verification, sign-in, session refresh across reload, sign-out, password reset email -> `/reset-password`, and suspended user lockout.
- [ ] **Verify Cross-Tenant & Privilege Boundaries with Live JWTs:**
  - Client A cannot access Org B pets/doctors/records.
  - Pending client sees 0 doctors/branches.
  - Peer doctor cannot activate another doctor's consultation or access private consultation chat (`D-16`), but can read org clinical records (`D-17`).
  - Org Admin / Front Desk / Branch Manager respect branch scopes and cannot read private chat transcripts (`D-16`).
  - Platform Owner console displays aggregate telemetry only and receives 0 rows on clinical tables; scoped support access requires Org Owner approval and expires automatically.
- [ ] **Verify 7-Day Chat & Appointment Exclusion Rules:**
  - Pending appointment request does not reserve slots; concurrent `confirm_appointment` raises `23P01` / conflict error.
  - Consultation cannot activate without eligible confirmed appointment.
  - Chat rejects new messages once `expires_at` (`activated_at + 7 days`) passes while preserving participant-only read-only history.
- [ ] **Ensure Archived/Legacy Scripts Are Excluded:** Confirm `supabase/archive/*`, `scripts/verify_remote_supabase.cjs`, and `scripts/test_controlled_rpc.cjs` are **never** executed against production.

---

## 5. Frontend Build, Code Hygiene & Monitoring

- [x] `npm run lint` (`tsc --noEmit`) passes with 0 errors.
- [x] `npm run build` (`vite build`) succeeds cleanly (`dist/` produced).
- [ ] **Staging Smoke & Responsive UI Verification:** Verify Desktop, Tablet, and Mobile layouts + console-error-free rendering across all 5 portals + CSV exports + notification bell/center.
- [ ] **Post-Audit Cleanup (Recommended):** Remove unused `src/services/supabaseService.ts`, `src/services/mockData.ts`, and `AppContext` legacy CRUD/`isDemoMode` fallback; split portal routes with `React.lazy()` to reduce initial `1.95 MB` JS bundle.
- [ ] **Operational Monitoring & Scheduled Jobs:**
  - Schedule or trigger `public.expire_due_consultations()` periodically (or verify on-demand expiry checks) and monitor `public.audit_logs` + Supabase Postgres/Auth logs.
