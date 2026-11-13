# PET CONNECT — Architecture Decision Records (ADRs)

**Document Status:** Phase 1 Confirmed Decisions Register  
This log freezes the foundational architecture, tenancy, authorization, clinical visibility, and operational rules governing all subsequent Pet Connect development phases.

---

| ADR ID | Decision | Status |
|---|---|---|
| **ADR-001** | Strangler evolution of existing React 19 / Vite 8 / Supabase stack | **Confirmed** |
| **ADR-002** | Multi-tenant SaaS shared-schema isolation via `organization_id` + composite FKs | **Confirmed** |
| **ADR-003** | **MaxPetZ** as initial pilot organization owning existing verified production records | **Confirmed** |
| **ADR-004** | Verified source-record branch mapping only (never invent historical branches) | **Confirmed** |
| **ADR-005** | One global `auth.users` / `profiles` identity across multiple organizations | **Confirmed** |
| **ADR-006** | Organization-scoped `clinic_clients` & `pets`; zero auto-sharing across orgs | **Confirmed** |
| **ADR-007** | Multi-branch doctor assignments within a single organization | **Confirmed** |
| **ADR-008** | All authorized doctors in an org can read that organization's clinical records | **Confirmed** |
| **ADR-009** | Expired chat history readable **only** by consultation client and treating doctor | **Confirmed** |
| **ADR-010** | Appointment confirmation performed by authorized `front_desk` or clinic admin | **Confirmed** |
| **ADR-011** | Confirmed/completed appointment mandatory before consultation activation | **Confirmed** |
| **ADR-012** | Fixed 7-day consultation chat window enforced server-side | **Confirmed** |
| **ADR-013** | Exclude payment gateways in v1; reserve `organizations.plan_code` | **Confirmed** |
| **ADR-014** | Dedicated `Platform Owner` (`platform_admins`) with zero default clinical data access | **Confirmed** |
| **ADR-015** | RPC-only workflow & clinical state mutations (`SECURITY DEFINER`, `search_path = ''`) | **Confirmed** |
| **ADR-016** | Strict environment-only Supabase config failing closed (no prod fallbacks) | **Confirmed (Implemented Phase 1)** |
| **ADR-017** | Supabase CLI migration pipeline + `SET LOCAL ROLE authenticated` pgTAP gates | **Confirmed** |

---

## Detailed Records

### ADR-001 — Strangler Evolution Over Ground-Up Rewrite
- **Context:** Audit shows ~78% of `src/` LOC comprises functional portal UIs/components, 14 of 16 normalized tables can be extended in place, and the 7-day chat invariant is already modeled cleanly in PostgreSQL.
- **Decision:** Keep the React/Vite/Tailwind UI shell and core table schemas while incrementally replacing client-side auth state (`AppContext`), global RLS shortcuts (`is_admin()`/`is_doctor()`), direct writes, and mock fallbacks.

### ADR-002 — Shared-Schema Multi-Tenancy with Composite Tenant Foreign Keys
- **Decision:** Add `organization_id` to every tenant-owned table, enforce `UNIQUE (id, organization_id)` on parents, and reference `(parent_id, organization_id)` via composite foreign keys in children, backed by RLS (`TO authenticated`) on all tables.
- **Rationale:** Guarantees structural cross-tenant integrity at the relational constraint layer independently of RLS or application query filters.

### ADR-003 — Pilot Organization: MaxPetZ
- **Decision:** Create **MaxPetZ** (`slug = 'maxpetz'`) as the initial pilot organization during Phase 2c backfill and attribute verified historical production records to MaxPetZ.

### ADR-004 — Zero-Guessing Historical Branch Mapping
- **Decision:** Current tables lack `branch_id` and location metadata. Historical branch ownership for MaxPetZ (`branches`, `doctor_branch_assignments`, `consultations.branch_id`, `prescriptions.branch_id`) must be derived strictly from verified MaxPetZ source records or left in an explicit legacy/quarantine state for manual clinic reconciliation. **Never fabricate branch mappings.**

### ADR-005 & ADR-006 — Global Identity vs. Organization-Scoped Clinical Data
- **Decision:** One `auth.users` + `public.profiles` record identifies a human globally and can participate in multiple organizations via `organization_memberships` (staff) and/or `clinic_clients` (patients). However, `clinic_clients`, `pets`, `pet_guardians`, `appointments`, `consultations`, `medical_records`, `prescriptions`, and `vaccinations` are strictly scoped to one `organization_id` with **zero automatic cross-organization sharing**.
- **Signup Rule:** Global signup creates only a `profiles` row (no global `client` role). Access to a clinic requires clinic approval (`clinic_clients.status = 'approved'`) or an accepted staff invitation.

### ADR-007 — Multi-Branch Doctors Within an Organization
- **Decision:** Replace `doctor_profiles.user_id UNIQUE` with `UNIQUE (organization_id, user_id)` and introduce `doctor_branch_assignments (doctor_profile_id, branch_id, organization_id)` so one user can practice at multiple branches within MaxPetZ (or independently at multiple clinic organizations).

### ADR-008 — Organization-Wide Clinical Read for Authorized Doctors (Resolves D-17)
- **Decision:** Within an active organization, **all authorized doctors** (`organization_memberships` active + `doctor` role holding `medical_records.read`) may read all clinical records (`pets`, `medical_records`, `vaccinations`, `prescriptions`, `prescription_items`) belonging to **that organization**.
- **Rationale:** Supports collaborative veterinary care across branches and shift handoffs within MaxPetZ while strictly blocking cross-organization reads (`SEC-05` fixed).

### ADR-009 — Strict Participant-Only Access to Expired Consultation Chats (Resolves D-16)
- **Decision:** Expired consultation chat history (`chat_conversations`, `chat_messages`, and consultation chat attachments) is readable **strictly by the consultation's client and treating doctor** (`app.is_consultation_participant()`). Organization admins (`org_owner`, `org_admin`), other org doctors, `front_desk`, and `platform_admins` are excluded.
- **Rationale:** Protects sensitive doctor-client communications while honoring patient/doctor continuity of care.

### ADR-010 — Appointment Confirmation Authority
- **Decision:** Pending appointment requests (`status = 'requested'`) do not block doctor calendar slots. Confirmation (`confirm_appointment()`) is restricted to authorized **front desk** (`front_desk`) and **clinic admin** (`org_admin`, `org_owner`, `branch_manager`) roles holding `appointments.confirm`, enforced inside a `FOR UPDATE` transaction with a PostgreSQL `btree_gist` exclusion constraint (`23P01` on concurrent double-booking).

### ADR-011 & ADR-012 — Mandatory Appointment & Exact 7-Day Chat Window
- **Decision:** New consultations require an existing confirmed/completed appointment (`appointment_id NOT NULL` for post-migration rows; historical pre-appointment consultations keep `appointment_id NULL` per D-10). `activate_consultation()` atomically sets `activated_at = now()`, `expires_at = activated_at + INTERVAL '7 days'`, creates one `chat_conversations` row, and logs an audit entry. Both `send_chat_message()` RPC and `consultations_guard_window` trigger forbid extending or bypassing the 7-day window.

### ADR-013 — Exclusion of Payment Gateway in v1
- **Decision:** Exclude online payment integrations in the initial multi-tenant release. Keep `consultation_payments` inactive/hidden (FK switched to `RESTRICT`) and reserve `organizations.plan_code` (nullable) for future SaaS subscription billing.

### ADR-014 — Platform Owner Isolation
- **Decision:** `platform_admins` manage `organization_applications` and tenant lifecycle (`active`/`suspended`) but have **zero default access** to any organization's clinical charts, pets, chats, or prescriptions.

### ADR-015 — Hardened RPC Mutation Boundary
- **Decision:** Revoke direct `INSERT`/`UPDATE`/`DELETE` on workflow and clinical tables from `authenticated` and `anon`; route all transitions through `SECURITY DEFINER` RPCs (`SET search_path = ''`, row locks, audit logs, notifications). Drop `003`'s `cleanup_test_records()` in Phase 2a.

### ADR-016 — Environment-Driven Fail-Closed Supabase Client (Implemented in Phase 1)
- **Decision:** Remove all hardcoded production project URL and publishable key fallbacks from `src/config/supabaseClient.ts` and `scripts/*.cjs`. Missing or placeholder `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` values fail closed (`supabase = null`, `isSupabaseConfigured = false`) rather than silently targeting production.

### ADR-017 — Tooling & Assurance Standards
- **Decision:** Standardize migrations under `supabase/migrations/` via Supabase CLI (`supabase/config.toml`), replace `security_tests.sql` with proper `SET LOCAL ROLE authenticated` pgTAP suites, retire `verify_remote_supabase.cjs` production writes, and align package lockfiles cleanly when modifying dependencies.
