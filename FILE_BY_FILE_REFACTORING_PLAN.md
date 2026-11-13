# 07 — File-by-File Refactoring Plan

Classification: **A** Retain · **B** Reuse with modifications · **C** Refactor · **D** Replace (controlled).
Risk is the risk of the change itself. "Phase" refers to the roadmap in `FINAL_ARCHITECTURE_RECOMMENDATION.md`.

A **full rebuild is not justified.** The page and component layer (≈ 78% of non-blank `src/` LOC excluding mock data) is largely reusable. What must be replaced is the state, data-access and authorization core (`AppContext`, `supabaseService`, `mockData`, `types`, route table) and the SQL assets, and that can be done incrementally behind the existing UI.

## 1. Target `src/` structure (PROPOSED)

```
src/
  app/            App.tsx, router.tsx, providers.tsx
  auth/           AuthProvider, useSession, guards (RequireAuth, RequirePermission, RequirePlatformAdmin)
  org/            OrgProvider, useActiveOrg, WorkspaceSwitcher
  lib/            supabase.ts (env-only), errors.ts (Postgres code → message), dates.ts
  db/             database.types.ts (generated), repositories/{orgs,branches,clients,pets,doctors,appointments,consultations,chat,clinical,notifications,audit}.ts
  features/       client/, doctor/, org-admin/, platform/  (pages + feature components)
  components/ui/  Modal, PageHeader, MetricCard, EmptyState, StatusBadge, Toast, DataTable, FormField
  layouts/        AppLayout, PortalLayout
  test/           fixtures (former mockData), msw handlers
```

## 2. Root and configuration

| File | Class | Current | Reason | Depends on | Risk | Action | Phase |
|---|---|---|---|---|---|---|---|
| `package.json` | B | name `react-example`, unused deps, no tests | Hygiene and reproducibility | — | L | Rename; remove `@google/genai`, `express`, `dotenv`, `motion`, `tsx` if confirmed unused; add `vitest`, `@testing-library/react`, `supabase` CLI (dev), scripts `typecheck`, `test`, `test:db`, `gen:types` | 1 |
| `package-lock.json` / `bun.lock` | B | Two lockfiles | Non-deterministic installs | — | L | Keep one (CONFIRM npm vs bun) | 1 |
| `tsconfig.json` | B | No `strict`; `@` → repo root | Type safety | all TS | M | Enable `strict` incrementally (`strictNullChecks` first); `@/*` → `src/*` | 1 |
| `vite.config.ts` | B | AI Studio HMR flags | Cleanup | — | L | Remove AI Studio comments; alias to `src` | 1 |
| `.env.example` | B | Gemini/APP_URL, test passwords | Misleading | — | L | Keep `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`; document CI secrets separately | 1 |
| `.gitignore` | A | OK | — | — | L | Add `supabase/.temp`, `.aistudio/` | 1 |
| `metadata.json`, `.aistudio/**` | D | AI Studio artefacts | Not product code | — | L | Move to `docs/history/` or delete (CONFIRM) | 1 |
| `README.md`, `docs/ER_DIAGRAM.md` | B | Single-tenant docs | Outdated | — | L | Rewrite after Phase 1 | 1 |
| `index.html` | A | Shell | — | — | L | Retain; title from brand config | — |

## 3. SQL assets (`supabase/`)

| File | Class | Reason | Risk | Action | Phase |
|---|---|---|---|---|---|
| `migrations/001_initial_schema.sql` | D (archive) | Conflicts with 999; non-idempotent enums | H if re-run | **Do not re-run.** Replace with a **baseline migration generated from the live schema** (`supabase db dump --schema public`, read-only, by an authorized operator) and mark it as applied | 1–2 |
| `migrations/002_activate_consultation_rpc.sql` | D (archive) | Duplicate | M | Superseded by baseline | 1–2 |
| `migrations/003_setup_test_accounts.sql` | D | Writes auth schema, known password, destructive RPC | **Critical** | Remove from `migrations/`; replace with local-only `supabase/seed/test_users.sql` using Supabase CLI local stack | 1 |
| `migrations/999_full_production_deploy.sql` | D (archive) | Mixed responsibilities | H | Archive; never run | 1 |
| `policies/rls_policies.sql` | D | Global-role policies, gaps SEC-03..10 | H | Replaced by per-table policy migrations in Phase 2 | 2 |
| `seed.sql` | D | Shares UUIDs with test accounts | M | Replace with deterministic local fixtures in a demo org; never applied to prod | 1 |
| `tests/security_tests.sql` | D | Bypasses RLS | M | Replace with pgTAP suite under `supabase/tests/` using `SET LOCAL ROLE` | 2, 10 |
| *(new)* `supabase/config.toml` | New | CLI project config | L | `supabase init` | 1 |

## 4. Scripts

| File | Class | Reason | Risk | Action | Phase |
|---|---|---|---|---|---|
| `scripts/verify_remote_supabase.cjs` | D | Writes to prod; fake PASS; hard-coded project | M | Delete (CONFIRM); replace with staging smoke test with real assertions | 1 |
| `scripts/test_controlled_rpc.cjs` | D | Depends on 003 accounts and cleanup RPC; prod fallback | M | Replace with Vitest integration tests against local Supabase | 10 |

## 5. Core app (`src/`)

| File | Class | Current | Reason | Depends on → dependants | Risk | Action | Phase |
|---|---|---|---|---|---|---|---|
| `src/main.tsx` | A | root render | — | App | L | Keep | — |
| `src/App.tsx` | C | flat routes, no guards | SEC-01; no org context | all pages | H | Split into `router.tsx` with nested `/:orgSlug/{client,doctor,admin}` and `/platform`; wrap with guards; add auth routes incl. `/reset-password`; 404 page | 3 |
| `src/layouts/AppLayout.tsx` | B | Header/Sidebar/Outlet | Fine structurally | Header, Sidebar | L | Keep; add `PortalLayout` per portal | 3 |
| `src/context/AppContext.tsx` | **D (strangler)** | god context | SEC-01/12/17; local-only mutations; mock bleed | everything → 33 pages | **H** | Step 1: remove mock fallbacks and role switcher exports in DB mode. Step 2: extract `AuthProvider`, `OrgProvider`, `ToastProvider`. Step 3: move each domain to repository + query hooks, page by page. Step 4: delete file | 3–9 |
| `src/services/authService.ts` | B | auth wrapper | multi-role bug (`:139-151`); bad reset route | supabaseClient → AppContext | M | Return profile + memberships + platform flag from one RPC `get_my_context()`; fix reset redirect; remove role inference | 3 |
| `src/services/supabaseService.ts` | C | direct CRUD | SEC-21; non-atomic Rx; wrong FKs | → AppContext, AdminSettings | H | Split into `db/repositories/*`; mutations → RPCs; reads → views with explicit `organization_id` filter; delete diagnostics methods | 3–9 |
| `src/services/mockData.ts` | D | demo data | SEC-17 | → AppContext, DoctorAvailabilityPage | M | Move to `src/test/fixtures`; exclude from prod build | 3 |
| `src/config/supabaseClient.ts` | B | client + hard-coded fallback | SEC-13 | → services | M | Env-only; throw when missing; remove `verifySupabaseConnection` from prod | 1 |
| `src/types/index.ts` | D | hand-written types | Drift from DB | → all | M | Generate `database.types.ts`; define view-models per feature; delete enriched-field unions | 2–3 |
| `src/index.css` | A | Tailwind + print | — | — | L | Keep | — |

## 6. Shared components

| File | Class | Action | Risk | Phase |
|---|---|---|---|---|
| `Modal.tsx`, `PageHeader.tsx`, `MetricCard.tsx`, `EmptyState.tsx` | A | Move to `components/ui`; add a11y (focus trap, aria-labelledby) | L | 4 |
| `StatusBadge.tsx` | B | Add appointment, membership and client statuses | L | 8 |
| `ToastContainer.tsx` | B | Use `ToastProvider` | L | 3 |
| `PrescriptionModal.tsx` | B | Org/branch letterhead, doctor registration no., void watermark | L | 9 |
| `Sidebar.tsx` | C | Nav from permissions and active portal, not `currentRole` | M | 3 |
| `Header.tsx` | C | Remove role switcher and demo toggle; add WorkspaceSwitcher, real notifications | M | 3 |
| `AuthModal.tsx` | C | Replace with routed pages: Login, Register (person), Register Clinic (application), Reset Password | M | 3 |
| *(new)* `DataTable`, `FormField`, `ConfirmDialog`, `DateTimeSlotPicker`, `FileUploader` | New | Shared primitives | L | 4–9 |

## 7. Client portal

| File | Class | Action | Risk | Phase |
|---|---|---|---|---|
| `ClientDashboard.tsx` | B | Data from org-scoped hooks; show join status if not yet approved | M | 4 |
| `MyPets.tsx` | B | Remove `owner_id: 'user-client-1'` (`:91`); call `create_pet` RPC (server sets org and guardian); archive instead of delete | M | 4 |
| `PetDetails.tsx` | B | Org-scoped pet, records and vaccines | M | 4 |
| `FindDoctor.tsx` | C | Branch → doctor → slot picker using `get_available_slots`; `request_appointment`; real uploads | M | 8 |
| `MyConsultations.tsx` | B | Split into "Appointments" and "Consultations" tabs | M | 8 |
| `ClientChat.tsx` | B | Realtime per conversation; `send_chat_message` RPC; storage uploads with signed URLs; server-time expiry | M | 9 |
| `ClientPrescriptions.tsx`, `ClientMedicalRecords.tsx` | B | Org-scoped reads | L | 9 |
| `ClientNotifications.tsx` | B | Real notifications; persist mark-all-read | L | 9 |
| `ClientProfile.tsx`, `ClientSettings.tsx` | B | Persist via RPC | L | 4 |
| `ClientPayments.tsx` | A | Hide route in v1 | L | 4 |
| *(new)* `JoinClinic.tsx`, `SelectWorkspace.tsx`, `AppointmentDetail.tsx` | New | Join request and workspace selection | M | 4, 8 |

## 8. Doctor portal

| File | Class | Action | Risk | Phase |
|---|---|---|---|---|
| `DoctorDashboard.tsx` | B | Branch-aware KPIs | M | 5 |
| `DoctorRequests.tsx` | C | Appointment confirmation queue (if doctors confirm; CONFIRM) + consultation activation; reject via RPC | M | 8 |
| `DoctorConsultations.tsx` | B | Complete via RPC | M | 8 |
| `DoctorChat.tsx` | B | Same as ClientChat | M | 9 |
| `DoctorPatients.tsx` | B | Clinic clients/pets in assigned branches | L | 5 |
| `DoctorPrescriptions.tsx` | C | Use `issue_prescription` (atomic); remove hard-coded `doctor_id` (`:75`), `'cons-direct'` (`:73`), `'Sarah Jenkins'` (`:82`), qualification (`:84`) | M | 9 |
| `DoctorMedicalRecords.tsx` | C | `add_medical_record` RPC; real attachments; remove fake URL (`:41`) | M | 9 |
| `DoctorAvailabilityPage.tsx` | D | Rebuild on `doctor_schedules` per branch + exceptions | M | 5 |
| `DoctorProfilePage.tsx`, `DoctorSettingsPage.tsx` | B | Persist editable fields via RPC | L | 5 |

## 9. Org Admin portal (from current Admin)

| File | Class | Action | Risk | Phase |
|---|---|---|---|---|
| `AdminDashboard.tsx` | C | Org-scoped KPIs from SQL views | M | 6 |
| `AdminClients.tsx` | D | Clinic-client directory and **join-request approval queue** | M | 6 |
| `AdminDoctors.tsx` | C | Invite staff, roles, branch assignments, activate/deactivate via RPC | M | 6 |
| `AdminPets.tsx` | B | Org-scoped | L | 6 |
| `AdminConsultations.tsx` | C | Reassign via RPC; appointment calendar view | M | 6, 8 |
| `AdminPrescriptions.tsx`, `AdminMedicalRecords.tsx` | B | Org-scoped, permission-gated | L | 6 |
| `AdminReports.tsx` | B | SQL aggregate views | L | 6 |
| `AdminPayments.tsx` | A | Hide in v1 | L | 6 |
| `AdminSettings.tsx` | D | Real org settings (profile, branches, hours); remove diagnostics, fake toggles, fake test register | L | 6 |
| *(new)* `Branches.tsx`, `Staff.tsx`, `Roles.tsx`, `JoinRequests.tsx`, `AuditLog.tsx` | New | | M | 6 |

## 10. Platform Owner portal (all new)

`platform/Applications.tsx` (approve/reject), `platform/Organizations.tsx` (suspend/reactivate), `platform/OrganizationDetail.tsx`, `platform/PlatformAudit.tsx`, `platform/PlatformAdmins.tsx`. No clinical data views. Phase 7.

## 11. Execution order to minimise breakage

1. Phase 1: Configuration and SQL hygiene (no behaviour change).
2. Phase 2a: **Security hardening of the existing policies** (SEC-03, 04, 05, 06, 10, 11, 16), done as its own approved migration. Postgres combines permissive policies with OR, so new tenant policies cannot fix over-broad legacy ones. Those must be dropped or tightened explicitly.
3. Phase 2b: Database expand migrations and backfill. The old app keeps working because the columns are additive.
4. Phase 3: New auth/org providers and guards, with the old pages still reading through a thin compatibility layer. Per table, legacy policies are replaced by tenant policies in the same transaction, starting with the tables whose pages have migrated.
5. Phases 4–9: Migrate pages portal by portal from `useApp()` to repository hooks. Each PR removes the corresponding slice of `AppContext`.
6. Phase 10: Verify no legacy policy remains; drop `is_admin`/`is_doctor`; full pgTAP and E2E isolation suite.
7. Phase 11: Contract phase (drop `user_roles`, `owner_id`, archived files).
