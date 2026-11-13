# 02 — Frontend File Inventory

LOC = non-blank lines. All rows are **VERIFIED** by reading source unless marked otherwise.
Classification key: **A** Retain · **B** Reuse with modifications · **C** Refactor · **D** Replace.
Risk is the risk of *changing* the file: L = low, M = medium, H = high (central, many dependants).

## 1. Entry, routing, layout

| File | LOC | Current functionality | Key dependencies | Class | Risk |
|---|---|---|---|---|---|
| `index.html` | — | Shell, Google Fonts, title "Pet Connect — Veterinary Healthcare Platform" | — | A | L |
| `src/main.tsx` | 4 | `createRoot` → `<App/>` | App | A | L |
| `src/index.css` | 38 | Tailwind import, font vars, scrollbar, print rules | — | A | L |
| `src/App.tsx` | 94 | Flat route table, 36 routes; no guards; `*` → `/client/dashboard` | all pages, AppProvider, AppLayout | **C** | H |
| `src/layouts/AppLayout.tsx` | 23 | Header + Sidebar + Outlet + Toasts | Header, Sidebar | B | L |

## 2. Context, services, config, types

| File | LOC | Current functionality | Key dependencies | Class | Risk |
|---|---|---|---|---|---|
| `src/context/AppContext.tsx` | 915 | God context: auth state, role switcher state, demo/db mode, every collection, every mutation, client-side audit, toasts | mockData, authService, supabaseService, types | **D** (controlled split) | H |
| `src/services/authService.ts` | 150 | Supabase Auth wrapper; `fetchUserRole` via `maybeSingle` (`:139-151`); reset redirect to non-existent `/reset-password` (`:117`) | supabaseClient | B | M |
| `src/services/supabaseService.ts` | 555 | Direct table CRUD for all domains; `activateConsultationRPC`; `verifyAllTables`/`checkRPCDeployment` diagnostics; unused realtime subscription | supabaseClient, types | **C** → split into per-domain repositories that call RPCs | H |
| `src/services/mockData.ts` | 738 | Demo profiles, pets, doctors, consultations, chat, Rx, records, vaccines, notifications, audit, availability | types | **D** (move to test fixtures / Storybook; drop from prod bundle) | M |
| `src/config/supabaseClient.ts` | 109 | `createClient`; **hard-coded URL and publishable key fallback** (`:10-20`); connection ping | supabase-js | B | M |
| `src/types/index.ts` | 198 | Hand-written domain types mixing DB columns with UI "enriched" fields | — | **D** (generate DB types; keep separate view-model types) | M |

## 3. Shared components (`src/components/common/`)

| File | LOC | Functionality | Class | Risk | Notes |
|---|---|---|---|---|---|
| `Modal.tsx` | 69 | Generic modal | A | L | Add focus trap / aria later |
| `PageHeader.tsx` | 35 | Title/subtitle/action | A | L | |
| `MetricCard.tsx` | 46 | KPI tile | A | L | |
| `EmptyState.tsx` | 35 | Empty placeholder | A | L | |
| `StatusBadge.tsx` | 66 | Consultation status pill | B | L | Extend for appointment statuses |
| `ToastContainer.tsx` | 43 | Renders toasts from context | B | L | Decouple from AppContext |
| `PrescriptionModal.tsx` | 185 | Printable Rx | B | L | Needs org/branch letterhead, doctor reg. no. |
| `Sidebar.tsx` | 164 | Role-based nav from `currentRole` (`:75-76`) | **C** | M | Drive from permissions + active org |
| `Header.tsx` | 351 | Brand, **role switcher** (`:116-150`, `:337-362`), **demo toggle** (`:92-113`), notifications, profile menu | **C** | M | Replace switcher with org/workspace switcher; remove demo toggle in prod |
| `AuthModal.tsx` | 405 | Sign in / register (client only) / reset; cosmetic portal tabs; demo toggle | **C** | M | Becomes dedicated `/login`, `/register`, `/register-clinic`, `/reset-password` routes |

## 4. Client portal (`src/pages/client/`)

| File | LOC | Functionality | Data source | Class | Risk | Key issue |
|---|---|---|---|---|---|---|
| `ClientDashboard.tsx` | 260 | KPIs, active consultations, pets | context arrays | B | M | Must become per-org |
| `MyPets.tsx` | 399 | Pet CRUD + filters | context | B | M | `owner_id: 'user-client-1'` hard-coded (`:91`) → DB inserts fail |
| `PetDetails.tsx` | 303 | Pet profile, records, vaccines, Rx | context | B | M | Per-clinic pet record |
| `FindDoctor.tsx` | 283 | Doctor directory + booking modal | context | **C** | M | Booking becomes appointment request (branch, doctor, slot); mock upload URL (`:55-57`) |
| `MyConsultations.tsx` | 249 | Consultations list + countdowns | context | B | M | Split appointments vs consultations |
| `ClientChat.tsx` | 350 | Chat UI, expiry banner | context | B | M | `blob:` attachments (`:72-79`); no realtime |
| `ClientPrescriptions.tsx` | 120 | Rx list + print | context | B | L | |
| `ClientMedicalRecords.tsx` | 171 | Records + vaccines | context | B | L | |
| `ClientNotifications.tsx` | 69 | Notification list | context | B | L | |
| `ClientPayments.tsx` | 43 | Placeholder copy | static | A (hide in v1) | L | |
| `ClientProfile.tsx` | 110 | Profile form → toast only (`:19`) | none | B | L | Persist via RPC |
| `ClientSettings.tsx` | 98 | Preference toggles → toast only | none | B | L | |
| *(missing)* | — | Join-clinic request, clinic picker, appointment booking with slots | — | **New** | — | |

## 5. Doctor portal (`src/pages/doctor/`)

| File | LOC | Functionality | Class | Risk | Key issue |
|---|---|---|---|---|---|
| `DoctorDashboard.tsx` | 248 | Caseload KPIs; quick approve | B | M | Must filter by branch assignments |
| `DoctorRequests.tsx` | 168 | Pending queue; approve (RPC) / reject (direct update) | **C** | M | Becomes appointment-confirmation queue; reject → RPC |
| `DoctorConsultations.tsx` | 138 | Active list; complete (direct update) | B | M | Complete → RPC |
| `DoctorChat.tsx` | 248 | Chat UI | B | M | No realtime; no attachments |
| `DoctorPatients.tsx` | 103 | Patients list | B | L | Per-org clinic clients |
| `DoctorPrescriptions.tsx` | 337 | Rx writer | **C** | M | `doctor_id: currentProfile.id` (wrong FK, `:75`), `'cons-direct'` fake id (`:73`), hard-coded `client_name: 'Sarah Jenkins'` (`:82`) and qualification (`:84`); non-atomic insert |
| `DoctorMedicalRecords.tsx` | 192 | Record logger | **C** | M | `doctor_id: currentProfile.id` (`:37`); fake `https://example.com/record.pdf` (`:41`); non-column fields sent |
| `DoctorAvailabilityPage.tsx` | 102 | Weekly schedule | **D** | L | Pure mock (`INITIAL_AVAILABILITY`, `:5-9`); save is a toast (`:24-26`) |
| `DoctorProfilePage.tsx` | 110 | Profile form → toast only | B | L | |
| `DoctorSettingsPage.tsx` | 68 | Preferences → toast only | B | L | |

## 6. Admin portal (`src/pages/admin/`)

| File | LOC | Functionality | Class | Risk | Key issue |
|---|---|---|---|---|---|
| `AdminDashboard.tsx` | 194 | Platform KPIs, audit list | **C** | M | Split into Org Admin dashboard and Platform Owner dashboard |
| `AdminClients.tsx` | 170 | **Hard-coded 3 clients** (`:15-35`) | **D** | L | Replace with clinic-client approval and directory |
| `AdminDoctors.tsx` | 263 | Doctor roster; add / toggle (local only) | **C** | M | Invite doctor, branch assignment, persist via RPC |
| `AdminPets.tsx` | 98 | Pet directory | B | L | Org scope |
| `AdminConsultations.tsx` | 183 | Supervision, reassign (local only) | **C** | M | Reassign → RPC with audit |
| `AdminPrescriptions.tsx` | 78 | Rx audit list | B | L | |
| `AdminMedicalRecords.tsx` | 65 | Records audit list | B | L | |
| `AdminPayments.tsx` | 49 | Placeholder copy | A (hide in v1) | L | |
| `AdminReports.tsx` | 104 | Client-side aggregates | B | L | Move aggregates to SQL views/RPC |
| `AdminSettings.tsx` | 618 | DB diagnostics, fake "19/19 verified" register (`:547-549`), no-op "Enforce RLS" toggle (`:628-633`), fake save (`:116-118`), demo reset | **D** | L | Remove diagnostics from prod UI; real org settings page |
| *(missing)* | — | Branch management, staff invitations, roles and permissions, client join approvals, appointment calendar, org profile | **New** | — | |
| *(missing)* | — | **Platform Owner portal**: organization applications approve/reject, org suspension, platform audit | **New** | — | |

## 7. Routes inventory (VERIFIED `src/App.tsx:49-97`)

| Path | Component | Guard today | Target guard (PROPOSED) |
|---|---|---|---|
| `/` | → `/client/dashboard` | none | → `/select-workspace` or role home |
| `/client/dashboard` … `/client/settings` (13) | client pages | none | authenticated + approved `clinic_clients` in active org |
| `/doctor/dashboard` … `/doctor/settings` (12) | doctor pages | none | active membership with `doctor` role in active org |
| `/admin/dashboard` … `/admin/profile` (11) | admin pages | none | membership with org-admin permission |
| `*` | → `/client/dashboard` | none | 404 page |
| *(new)* `/login`, `/register`, `/reset-password`, `/register-clinic`, `/join/:orgSlug`, `/select-workspace`, `/platform/*` | — | — | per route |

## 8. Hooks, context providers, forms, tables

- **Context providers:** one (`AppProvider`). **Custom hooks:** one (`useApp`). No data-fetching hooks.
- **Forms:** uncontrolled-to-controlled `useState` forms in `MyPets`, `FindDoctor`, `DoctorPrescriptions`, `DoctorMedicalRecords`, `AdminDoctors`, `AuthModal`, profile pages. No schema validation and no server-error mapping.
- **Tables:** hand-written `<table>` markup in `DoctorAvailabilityPage`, `AdminSettings`, `AdminClients`, `AdminDoctors`, `AdminPets`, `AdminPrescriptions`, `AdminMedicalRecords`, `AdminReports`. No sorting, pagination or virtualization.
- **Realtime:** none active (`subscribeToChatMessages` never imported).
- **Storage:** none.

## 9. Non-source repository files

| File | Classification | Note |
|---|---|---|
| `README.md` | B | Describes role switcher as a feature; rewrite |
| `docs/ER_DIAGRAM.md` | B | Single-tenant ERD; supersede |
| `.aistudio/artifacts/brain/*/implementation_plan.md` (+ metadata) | Archive | Historical design intent; remove from product repo |
| `metadata.json` | D | AI Studio applet manifest declaring Gemini capability that is unused |
| `.env.example` | B | Remove `GEMINI_API_KEY`, `APP_URL`; keep Supabase vars; move test passwords to CI secrets doc |
| `.gitignore` | A | Covers `.env*`; add `supabase/.temp`, `.aistudio/` |
| `package.json` | B | Rename, remove unused deps, add test and typecheck scripts |
| `package-lock.json` / `bun.lock` | B | Pick **one** package manager (CONFIRM) |
| `tsconfig.json` | B | Enable `strict`; fix `@` alias to `src` |
| `vite.config.ts` | B | Remove AI Studio HMR comments; alias `@` → `./src` |
