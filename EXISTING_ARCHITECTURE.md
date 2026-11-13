# 01 — Existing Architecture

**Audit date:** 2026-11-13
**Scope:** Complete repository snapshot supplied as `pet-connect (1).zip` (74 files).
**Method:** Static source inspection only. Nothing was installed, built, executed, or connected to Supabase.

## Evidence legend

| Tag | Meaning |
|---|---|
| **VERIFIED** | Confirmed by reading the repository source at the cited location. |
| **CONCERN** | Implemented in the repository, with a security or correctness problem. |
| **PROPOSED** | Target-state recommendation. It does not exist yet. |
| **CONFIRM** | Assumption or decision that needs human confirmation. |
| **NOT VERIFIED** | Could not be inspected (live database, deployed config, runtime behaviour). |

---

## 1. What the system is today

Pet Connect today is a **single-tenant, single-clinic prototype** generated in Google AI Studio (`.aistudio/artifacts/brain/.../implementation_plan.md`, `metadata.json`). It is a React 19 + Vite SPA that runs in one of two modes:

1. **Demo mode** (`isDemoMode = true`): all data lives in React state seeded from `src/services/mockData.ts` and is saved to `localStorage` (`src/context/AppContext.tsx:157-237`).
2. **Database mode**: the same React state is filled from Supabase through `src/services/supabaseService.ts`. Some mutations go to Supabase. Others still change only local state (see §5).

The implementation plan says the design came from an explicit decision to build a **role-switcher preview app** (`implementation_plan.md:10`, "Confirmed Decision 1 (Portal Navigation)"). That explains most of the architectural gaps found here. The UI was built as a demo first, and persistence was added later.

### There is no concept of:
- organizations or tenants, branches, or memberships (VERIFIED: no such tables or types exist anywhere in `supabase/` or `src/types/index.ts`);
- appointments or time slots (VERIFIED: `consultations.preferred_time` is free-text `VARCHAR(100)`, `001_initial_schema.sql:101`);
- a Platform Owner distinct from a clinic administrator (VERIFIED: one global `admin` enum value, `001_initial_schema.sql:26`);
- file storage (VERIFIED: no `supabase.storage` call and no bucket DDL anywhere in the repository).

---

## 2. Technology stack (VERIFIED from `package.json`)

| Layer | Technology | Notes |
|---|---|---|
| UI | React `^19.0.1`, react-dom `^19.0.1` | Function components, hooks |
| Routing | react-router-dom `^7.18.5` | `BrowserRouter`, flat route table in `src/App.tsx` |
| Styling | Tailwind CSS `^4.3.3` via `@tailwindcss/vite` | Utility classes inline; teal palette |
| Icons | lucide-react `^0.546.0` | |
| Build | Vite `^8.3.0`, TypeScript `^7.0.2` | `npm run lint` = `tsc --noEmit`; **no `strict` flag** in `tsconfig.json` |
| Backend | Supabase (`@supabase/supabase-js ^2.119.0`) | Postgres + Auth + (intended) Realtime |
| Unused deps | `@google/genai`, `express`, `dotenv`, `motion`, `tsx` | No imports under `src/` (VERIFIED by grep) |
| Tests | **None** | No test runner, no `test` script |
| Package managers | **Both** `package-lock.json` and `bun.lock` present | Source of non-reproducible installs |

Package name is still `"react-example"` (`package.json:2`).

Build success under TypeScript 7 / Vite 8: **NOT VERIFIED** (building was out of scope).

---

## 3. Runtime topology

```
Browser (SPA, Vite build)
 ├── AppProvider (src/context/AppContext.tsx) — single 1,000-line god context
 │     ├── demo state  ← mockData.ts + localStorage
 │     └── db state    ← supabaseService.ts ──► Supabase PostgREST (anon/publishable key + user JWT)
 │                                         └─► RPC activate_consultation()
 ├── AppLayout → Header (role switcher, demo toggle, AuthModal) + Sidebar + <Outlet/>
 └── 33 page components under src/pages/{client,doctor,admin}

Supabase project (ntnzspsscbfmziintsru — hard-coded fallback, src/config/supabaseClient.ts:12)
 ├── 16 public tables (DDL in supabase/migrations/001 or 999)
 ├── RLS policies (supabase/policies/rls_policies.sql or 999 §9)
 ├── SECURITY DEFINER functions: is_admin, is_doctor, activate_consultation, handle_new_user*, cleanup_test_records
 └── auth.users (test accounts inserted directly by 003_setup_test_accounts.sql)

CLI scripts (Node, run against the LIVE project)
 ├── scripts/verify_remote_supabase.cjs   — creates real users/pets/consultations
 └── scripts/test_controlled_rpc.cjs      — uses fixed test accounts + cleanup RPC
```

\* `handle_new_user()` is defined in `999_full_production_deploy.sql:397-419`, but **no `CREATE TRIGGER` exists anywhere in the repository** (VERIFIED by grep). Whether a trigger exists in the live database is **NOT VERIFIED**.

---

## 4. Frontend architecture (VERIFIED)

### 4.1 Routing — `src/App.tsx:44-102`
- Has one layout route, `/`, with 36 child routes split into `client/*` (13), `doctor/*` (12) and `admin/*` (11).
- **No route guards.** No component checks `authUser` or role before rendering. Unknown paths redirect to `/client/dashboard`.
- `admin/profile` renders `AdminDashboard` (`App.tsx:93`), a placeholder.
- `/reset-password` is used as the password-reset redirect (`authService.ts:117`), but the route does not exist.

### 4.2 Authorization model in the UI
- `currentRole` is plain React state that defaults to `'client'` (`AppContext.tsx:153`).
- `setCurrentRole` is exported (`AppContext.tsx:948-949`). The Header renders a **Client / Doctor / Admin switcher that is always visible**, including for authenticated users in database mode (`Header.tsx:48-54, 116-150, 337-362`).
- On login, the role comes from `user_roles` through `.maybeSingle()` (`authService.ts:139-151`). If a user has more than one role row, the query returns an error, which is swallowed, and the role falls back to `'client'`.
- Role checks before activation are client-side only (`AppContext.tsx:607-631`). The database RPC re-checks them, which is good.

### 4.3 State management
- **One context** (`AppContext.tsx`, 1,011 lines) holds identity, mode, every domain collection, every mutation, toasts and demo reset.
- No query cache, no pagination, no per-tenant scoping. `reloadFromDatabase()` loads **everything the RLS allows** in eight parallel queries. It then loads chat messages for every consultation in a sequential N+1 loop (`AppContext.tsx:283-326`).
- **Mock data bleeds into database mode.** A collection is only replaced when the DB returns at least one row (`AppContext.tsx:307-314`). A real user with zero pets therefore sees the demo pets from `mockData.ts`.

### 4.4 Service layer
- `src/services/authService.ts` (173 lines) wraps Supabase Auth.
- `src/services/supabaseService.ts` (621 lines) does direct table CRUD for every domain. It has one RPC call (`activate_consultation`) and an **unused** realtime subscription (`subscribeToChatMessages`, `supabaseService.ts:454-488`, never imported).
- `src/config/supabaseClient.ts` creates the client and falls back to **hard-coded project URL and publishable key** (`:10-20`).

### 4.5 UI design system (VERIFIED — worth retaining)
- Shared components in `src/components/common/`: `Modal`, `PageHeader`, `MetricCard`, `EmptyState`, `StatusBadge`, `ToastContainer`, `PrescriptionModal` (print layout), `Sidebar`, `Header`, `AuthModal`.
- Visual language: teal brand (`#0F766E`), slate neutrals, Plus Jakarta Sans and JetBrains Mono (`index.html`, `index.css`), consistent card and border styling, print stylesheet for prescriptions (`index.css:28-38`).
- There is no form library, no validation library and no table component. Tables are hand-written per page.

---

## 5. Persistence reality per feature (VERIFIED)

| Feature | Demo mode | Database mode | Evidence |
|---|---|---|---|
| Sign in / sign up / reset | n/a | Supabase Auth | `authService.ts` |
| Add pet | local | `pets.insert` **with `owner_id: 'user-client-1'`** → fails RLS and UUID cast | `MyPets.tsx:90-94` |
| Update / delete pet | local | direct table write | `supabaseService.ts:144-160` |
| Book consultation | local | direct insert (`status: 'pending'`) | `supabaseService.ts:236-256` |
| Approve (activate) | local | **RPC `activate_consultation`** ✔ | `supabaseService.ts:264-285` |
| Reject / complete | local | direct `UPDATE` with client timestamps | `supabaseService.ts:356-382` |
| Reassign consultation | local | **local only — never persisted** | `AppContext.tsx:743-760` |
| Doctor activate/deactivate, add doctor | local | **local only — never persisted** | `AppContext.tsx:484-505` |
| Doctor availability | mock | **mock only; "Save" shows a toast and does nothing** | `DoctorAvailabilityPage.tsx:5-26` |
| Chat send | local | direct insert into `chat_messages` | `supabaseService.ts:423-449` |
| Chat attachments | `blob:` URL | `blob:` URL stored in DB (useless to the recipient) | `ClientChat.tsx:72-79` |
| Chat realtime | n/a | **not wired** | `subscribeToChatMessages` unused |
| Prescription | local | two non-atomic inserts; payload includes non-column fields and `doctor_id = profile id` → expected to fail (NOT VERIFIED by execution) | `DoctorPrescriptions.tsx:72-89`, `supabaseService.ts:517-543` |
| Medical record | local | direct insert; includes non-column `attachment_name`, `doctor_name`, `pet_name`; `doctor_id = profile id` | `DoctorMedicalRecords.tsx:34-45` |
| Vaccination | local | direct insert | `supabaseService.ts:578-587` |
| Notifications | mock | read API exists but is never called in `reloadFromDatabase`; no insert path; "mark all read" is local only | `AppContext.tsx:283-326, 913-916` |
| Audit log | local array | **only `activate_consultation` writes a server audit row**; every other `logAudit` is client memory | `AppContext.tsx:368-381` |
| Admin client list | hard-coded 3 clients | hard-coded | `AdminClients.tsx:15-35` |
| Profile edits (client/doctor) | toast only | toast only | `ClientProfile.tsx:19`, `DoctorProfilePage.tsx:22` |
| Admin "Save Settings" / "Enforce RLS" toggle | toast only | toast only (no effect) | `AdminSettings.tsx:116-118, 628-633` |
| Payments | placeholder page | placeholder page | `ClientPayments.tsx`, `AdminPayments.tsx` |

**Conclusion:** Database mode is only partly functional. Several workflows a clinic depends on (adding pets, prescriptions, medical records, doctor management, availability, reassignment, audit) either do not persist or are expected to fail at the database boundary.

---

## 6. Database architecture (summary — details in `DATABASE_SCHEMA_AUDIT.md`)

- 16 tables in `public`, UUID primary keys (`uuid_generate_v4()`), seven Postgres enums.
- `profiles.id` is **not** a foreign key to `auth.users(id)` (`001_initial_schema.sql:13-21`).
- One global role table, `user_roles(user_id, role)`, with `client | doctor | admin`.
- One business RPC, `activate_consultation`, which is solid: it locks the row, checks state and caller, writes an exact 7-day expiry, creates one conversation and writes an audit row.
- The 7-day rule is enforced by a CHECK constraint (`001:106-108`) and by the chat INSERT RLS policy (`rls_policies.sql:240-255`).
- Four overlapping SQL sources disagree with each other: `001`, `002`, `rls_policies.sql` and `999`. Which ones were applied to the live project is **NOT VERIFIED**.

---

## 7. Development and test infrastructure

| Item | State |
|---|---|
| Migrations | Hand-numbered SQL files with no Supabase CLI config (`supabase/config.toml` absent). `999_*` duplicates `001`+`002`+policies. `003` writes directly into `auth.users` / `auth.identities`. |
| Seed | `supabase/seed.sql` reuses the **same UUIDs** as the test accounts in `003` (for example `c1000000-…-0001` is "Sarah Jenkins" in the seed and "[CONTROLLED-TEST] Jane Client" in 003). |
| SQL tests | `supabase/tests/security_tests.sql` calls `set_config('request.jwt.claim.sub', …)` but never `SET ROLE authenticated`. Run as `postgres`, it **bypasses RLS**, so the RLS assertions are not meaningful. It also references an un-seeded `c2000000-…` profile, which causes an FK failure at test A4. Pass status: **NOT VERIFIED**. The "19/19 verified" claims in `AdminSettings.tsx:547-549` are unsubstantiated. |
| Node scripts | Both target the **live** project. `verify_remote_supabase.cjs` creates real Auth users with a fixed password and prints unconditional PASS lines (`:347-348`, `:378`). |
| CI | None. |
| Env | `.env.example` lists `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, four test passwords and an unused `GEMINI_API_KEY`. `.gitignore` excludes `.env*` except the example (good). |

---

## 8. Architectural strengths to preserve

1. The `activate_consultation` RPC pattern (row lock, state machine check, server timestamps, audit), and a 7-day CHECK constraint that cannot drift.
2. Chat INSERT policy that enforces sender identity, participation and the expiry window at the database level.
3. Messages and conversations treated as immutable (no UPDATE/DELETE policies).
4. A clean, consistent visual design system and reusable presentational components.
5. Normalized prescription model (`prescriptions` plus `prescription_items`).
6. Strict `REVOKE … FROM PUBLIC, anon` on SECURITY DEFINER functions with fixed `search_path`.

## 9. Architectural liabilities

1. No tenancy anywhere: schema, RLS, types or UI.
2. Authorization lives in the UI (role switcher, no guards). Database RLS is the only real control, and it has gaps (see `SECURITY_AUDIT.md`).
3. A god-context state model that mixes demo and production data paths.
4. Business mutations are done as direct table writes instead of guarded RPCs.
5. Test assets touch production and overstate their coverage.
6. The live database state is unknown: four conflicting SQL sources and no migration history.
