# Pet Connect — Local & Staging Deployment Guide (Phase 10)

This guide covers standing up Pet Connect locally or in an isolated staging Supabase environment, applying all 15 migrations, running verification tests, and starting the frontend. **Never point these commands at a live production database without explicit authorization and backups.**

---

## 1. Prerequisites

- **Node.js** `20+` and `npm`
- **Docker Desktop / Docker Engine** (required by local Supabase stack)
- **Supabase CLI** (`npm install -g supabase` or OS package manager)
- **PostgreSQL client (`psql`)** for executing `supabase/tests/rls_multi_tenant_suite.sql`

Install Node dependencies:

```bash
npm install
```

---

## 2. Local Supabase Stack Setup

1. **Start local Supabase services** (uses `supabase/config.toml` with Postgres 15 on `54322`, API on `54321`, Studio on `54323`, Inbucket mail catcher on `54324`):

   ```bash
   supabase start
   ```

2. **Apply all 15 incremental migrations cleanly** (lexicographical order `20261113000000` → `20261113130000`):

   ```bash
   supabase db reset
   ```

   *(Note: If running against an isolated staging project via Supabase CLI, link with `supabase link --project-ref <staging-ref>` and push with `supabase db push` after verifying schema state and backups. Do NOT execute files under `supabase/archive/`.)*

3. **Verify `auth.users` trigger & `storage.objects` policies:**
   Check `supabase db reset` output for any `NOTICE` regarding `auth.users` or `storage.objects` ownership. On local `supabase start`, Postgres owns both and attaches them automatically; on hosted staging, confirm in Dashboard SQL Editor if needed.

4. **Capture local connection credentials** from `supabase status` and create `.env.local` (never commit `.env.local`):

   ```env
   VITE_SUPABASE_URL=http://127.0.0.1:54321
   VITE_SUPABASE_ANON_KEY=<anon-key-from-supabase-status>
   ```

---

## 3. Running Verification Suites Against Local / Staging DB

1. **Execute the Multi-Tenant RLS & Business Workflow Suite** (runs 13 suites inside `BEGIN; ... ROLLBACK;` with real `SET LOCAL ROLE authenticated;` and JWT claims, leaving zero test rows):

   ```bash
   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
     -v ON_ERROR_STOP=1 \
     -f supabase/tests/rls_multi_tenant_suite.sql
   ```

   Confirm `TEST 1 PASSED` through `TEST 12 PASSED` and `TEST 13 PASSED` notice output with exit code `0`.

2. **Run Static Typecheck, Production Build & Offline Verification Scripts:**

   ```bash
   npm run lint
   npm run build
   npx tsx scripts/verify_phase3_auth.ts
   npx tsx scripts/verify_phase4_client.ts
   npx tsx scripts/verify_phase5_doctor.ts
   npx tsx scripts/verify_phase6_admin.ts
   npx tsx scripts/verify_phase7_platform.ts
   npx tsx scripts/verify_phase8_workflows.ts
   npx tsx scripts/verify_phase9_polish.ts
   ```

   *(Note: Do **not** rely on `scripts/test_controlled_rpc.cjs` or `scripts/verify_remote_supabase.cjs`; both target pre-hardening schemas/RPCs (`cleanup_test_records` was removed per `SEC-11`).)*

---

## 4. Bootstrapping Local Accounts & Platform Owner

1. Start the frontend dev server on port `3000`:

   ```bash
   npm run dev
   ```

2. Open `http://localhost:3000/signup` and create test users in GoTrue (confirmation emails appear in Inbucket at `http://127.0.0.1:54324` if confirmations are enabled).
3. To grant **Platform Owner** console access (`/platform/dashboard`) to a specific local test user, insert their `auth.users.id` manually in Postgres/Studio SQL Editor:

   ```sql
   INSERT INTO public.platform_admins (user_id, granted_by, is_active, notes)
   VALUES ('<your-user-uuid>', '<your-user-uuid>', true, 'Local Platform Owner bootstrap');
   ```

4. Register a clinic organization from `/workspaces` → **Register a Clinic**, sign in as the Platform Owner to approve it at `/platform/applications`, then test Organization Admin, Doctor, and Client workflows across separate browser sessions.

---

## 5. Production Build Check (Before Hosting Deployment)

```bash
npm run lint && npm run build
```

Serve `dist/` over HTTPS with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` configured at build time, after completing all items in `/PRODUCTION_READINESS_CHECKLIST.md`.
