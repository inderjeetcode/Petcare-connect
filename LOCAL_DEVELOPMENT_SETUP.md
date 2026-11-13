# PET CONNECT — Local Development Setup Guide

**Goal:** Enable engineers to develop, typecheck, build, and test Pet Connect locally against an isolated local Supabase stack without ever touching production data or embedding project credentials in source files.

---

## 1. Prerequisites

| Tool | Purpose | Notes |
|---|---|---|
| **Node.js (v20+ LTS) & npm** | Frontend build, typecheck, Vite dev server | `package.json` uses React 19, Vite 8.3, TypeScript 7, Tailwind 4 |
| **Docker Desktop / Engine** | Runs local Supabase PostgreSQL, Auth, Storage, Studio | Required for `supabase start` |
| **Supabase CLI** | Local DB lifecycle, migrations, pgTAP tests, typegen | Configured via `supabase/config.toml` (not installed inside ephemeral web IDE containers; install on workstation/CI via `brew install supabase/tap/supabase` or `npx supabase`) |

> **Package Manager Note:** Both `package-lock.json` and `bun.lock` currently exist in the repository from container provisioning. Use `npm install` consistently on developer workstations and update lockfiles intentionally when adding dependencies.

---

## 2. Environment Variables (`.env.local`)

1. Copy the template:
   ```bash
   cp .env.example .env.local
   ```
2. Notice `.gitignore` ignores `.env*` while keeping `!.env.example`. **Never commit `.env` or `.env.local`.**
3. **Fail-Closed Behavior:** `src/config/supabaseClient.ts` reads **only** `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`:
   - When `.env.local` is absent or contains placeholders (`your-local-or-env-supabase-anon-key`), `isSupabaseConfigured` evaluates to `false`, `supabase` is `null`, and the app runs cleanly in **isolated local browser state (Local Demo Mode)** without contacting any remote server.
   - When pointing at local Supabase (`supabase start`), set:
     ```env
     VITE_SUPABASE_URL="http://127.0.0.1:54321"
     VITE_SUPABASE_ANON_KEY="<anon-key-printed-by-supabase-start>"
     ```
4. **Strict Secret Rules:**
   - **Never** set `service_role` keys in `.env.local` for frontend use or prefix any secret with `VITE_`.
   - **Never** set `PETCONNECT_TEST_*` variables with a `VITE_` prefix.

---

## 3. Starting the Local Supabase Stack (Workstation / CI)

1. Verify `supabase/config.toml` settings (`project_id = "pet-connect"`, API port `54321`, DB port `54322`, Studio `54323`, Auth `site_url = "http://localhost:3000"`).
2. Start local services:
   ```bash
   supabase start
   ```
3. Inspect local keys and copy the **anon / publishable key** into `.env.local`:
   ```bash
   supabase status
   ```
4. Open local Supabase Studio at `http://127.0.0.1:54323` and local Inbucket email catch-all at `http://127.0.0.1:54324` (to test signup and `/reset-password` flows safely).

> **Important Note on Legacy SQL Files (Phase 1):**  
> Do **not** run `supabase/migrations/003_setup_test_accounts.sql` against staging or production. Until Phase 2 replaces the legacy SQL files (`001`, `002`, `003`, `999`, `rls_policies.sql`) with the audited baseline and ordered CLI migrations, only test SQL locally inside disposable containers.

---

## 4. Running the Frontend Locally

1. Install dependencies (if `node_modules/` is missing):
   ```bash
   npm install
   ```
2. Start the Vite dev server (configured on port `3000`):
   ```bash
   npm run dev
   ```
3. Typecheck and build locally:
   ```bash
   npm run lint
   npm run build
   ```

---

## 5. Local Database & RPC Testing Guardrails

- `scripts/test_controlled_rpc.cjs` and `scripts/verify_remote_supabase.cjs` have been updated in Phase 1 to **fail closed** if `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (or `SUPABASE_URL` / `SUPABASE_ANON_KEY`) are not explicitly provided in the shell environment.
- **Strictly Prohibited:** Never point `scripts/test_controlled_rpc.cjs` or `scripts/verify_remote_supabase.cjs` at the production Supabase project URL. `verify_remote_supabase.cjs` is deprecated and scheduled for retirement in favor of pgTAP (`supabase test db`) + Vitest integration tests against local/staging Supabase (`TESTING_AND_RELEASE_PLAN.md`).
