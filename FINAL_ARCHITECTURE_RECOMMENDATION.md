# 10 — Final Architecture Recommendation

## 1. Verdict

**Evolve, don't rebuild.** Keep the React/Vite/Tailwind UI shell, the visual design system, the Supabase platform, the normalized clinical tables, and the `activate_consultation` pattern. **Replace** the state, data-access and authorization core, and the SQL and test assets, through a controlled strangler migration.

### Evidence for "not a rebuild"
- Page and shared-component files account for ≈ 7,400 of ≈ 9,400 non-blank LOC in `src/` (≈ 78%, excluding `mockData.ts`). Most of that is markup that maps cleanly to target screens (`FRONTEND_FILE_INVENTORY.md`).
- 14 of 16 tables can be **extended** in place. Only `user_roles` (deprecated) and `doctor_availability` (replaced) are not. Existing IDs and FKs survive (`EXISTING_TO_TARGET_SCHEMA_MAPPING.md`).
- The 7-day chat invariant is already modelled correctly at the database layer (`001:106-108`, `rls_policies.sql:240-255`).

### Evidence for replacing the core
- Authorization is client-side (role switcher, no guards: `Header.tsx:116-150`, `App.tsx:49-97`).
- Critical RLS gaps: doctor rewrite of consultations, global clinical read, unscoped clinical writes (SEC-03, SEC-05, SEC-06).
- `AppContext.tsx` mixes demo and production paths, so fabricated data appears in DB mode (SEC-17), and many mutations are never persisted.
- SQL sources conflict, and the test assets neither test RLS nor isolate production (SEC-02, SEC-14, SEC-15).

## 2. Target architecture (summary)

| Concern | Decision |
|---|---|
| Tenancy | Shared database, shared schema, `organization_id` on every tenant row, **composite tenant FKs** `(id, organization_id)`, RLS on every table |
| Identity | One global `auth.users`/`profiles` per person; access only via `organization_memberships` (staff) or approved `clinic_clients` (clients) |
| Platform | `platform_admins` (Platform Owner) manages applications and orgs; **no default clinical access** |
| Authorization | Membership → roles → permissions (static catalogue in v1); helpers `app.has_org_permission()`; policies via `(select …)` wrappers |
| Workflows | All state transitions via SECURITY DEFINER RPCs with state machines, row locks, audit and notifications; API roles have no direct write on workflow tables |
| Appointments | `requested` (no reservation) → `confirm_appointment()` revalidates in-transaction; Postgres **exclusion constraint** on confirmed ranges prevents double-booking under concurrency |
| Consultation chat | Existing 7-day model kept; activation only by authorized RPC; immutable window via trigger; send via RPC; expired chats read-only |
| Files | Private Supabase Storage, org-prefixed paths, `storage.objects` RLS, signed URLs, attachment metadata table |
| Audit | Append-only `audit_logs` with org, actor, before/after, written only server-side |
| Frontend | Route-based portals `/:orgSlug/{client,doctor,admin}` + `/platform`; `AuthProvider`, `OrgProvider`, permission guards; per-domain repositories over generated types; query cache |
| Payments | Excluded in v1; `organizations.plan_code` reserved; subscription tables designed, not created |
| Migrations | Supabase CLI, baseline from live schema, expand → backfill → validate → switch → contract |
| Testing | pgTAP tenant-isolation matrix as the release gate, plus Vitest and Playwright |

## 3. Development roadmap

### Phase 0 — Existing codebase audit ✅ (this deliverable)
- **Files:** `docs/architecture-audit/*` only.
- **DB objects:** none.
- **Dependencies:** none.
- **Acceptance:** 10 reports reviewed and approved; D-01…D-17 assigned to owners.
- **Security risks:** none introduced. Immediate operational actions listed in `SECURITY_AUDIT.md` (end).
- **Testing:** none executed (by design).

### Phase 1 — Final architecture and database design
- **Files:** `supabase/config.toml` (new), baseline migration, archive of `001/002/999/policies`, removal of `003`/`seed.sql` from migrations, `package.json`, `tsconfig.json`, `vite.config.ts`, `.env.example`, `src/config/supabaseClient.ts` (env-only), ADRs under `docs/adr/`.
- **DB objects:** none changed in prod. Read-only discovery (Phase 0 queries in the migration plan) executed by an operator with approval.
- **Dependencies:** Phase 0 approval; answers to D-01…D-05, D-16, D-17.
- **Acceptance:** signed ERD and RLS matrix; permission catalogue; RPC contract list; baseline migration reproduces the live schema on a fresh local stack; live inventory report filed.
- **Security risks:** a baseline dump may capture sensitive function bodies (review before commit); test accounts on prod (SEC-02) handled.
- **Testing:** `supabase db reset` applies the baseline cleanly in CI; type-check passes.

### Phase 2 — Multi-tenant database foundation
- **Files:** `supabase/migrations/*` (2a hardening, 2b expand, 2c backfill, 2d validate); `supabase/tests/*.sql` (pgTAP); minimal frontend patch to call the new reject/complete/Rx/record RPCs.
- **DB objects:** new `app` helpers; `platform_admins`, `organizations`, `organization_applications`, `branches`, roles/permissions, memberships, `clinic_clients`, `pet_guardians`, `doctor_branch_assignments`, `doctor_schedules(+exceptions)`, `appointments(+history)`, `attachments`; `organization_id` on existing tables; composite FKs; indexes; storage bucket and policies. **Drop** `cleanup_test_records`; tighten the consultations, clinical and pets policies.
- **Dependencies:** Phase 1; D-01, D-02, D-04, D-05, D-11 answered; staging restored from prod.
- **Acceptance:** zero NULL `organization_id` in tenant tables; all composite FKs validated; reconciliation counts match; SEC-03/04/05/06/10/11/16 regression tests pass on staging.
- **Security risks:** OR-ing of permissive policies (handled by same-transaction swap); lock contention on constraint validation; backfill misattribution (blocked by D-xx sign-off).
- **Testing:** pgTAP isolation matrix for all new tables; hardening regression tests; migration rehearsal with down-scripts.

### Phase 3 — Authentication, organizations and memberships
- **Files:** `src/app/router.tsx`, `src/auth/*`, `src/org/*`, `src/lib/supabase.ts`, `src/db/database.types.ts`, `Header.tsx`, `Sidebar.tsx`, `AuthModal.tsx` → routed pages (Login, Register, RegisterClinic, ResetPassword), `authService.ts`, first slice removal from `AppContext.tsx`, removal of `mockData.ts` from the bundle.
- **DB objects:** `get_my_context()` RPC; `submit_organization_application`; `invite_member`/`accept_invitation`; `request_clinic_join`; replacement `handle_new_user` (profile only) with verified trigger.
- **Dependencies:** Phase 2.
- **Acceptance:** no route renders without the required session, membership or permission; role switcher and demo toggle gone from production build; password reset works end-to-end; a user with two org memberships can switch workspaces and sees only that org's data.
- **Security risks:** guard bypass via deep links (covered by tests); invitation token leakage (single-use, expiring, hashed).
- **Testing:** guard unit tests; E2E for signup, join and reset; pgTAP for membership states.

### Phase 4 — Client portal
- **Files:** `ClientDashboard`, `MyPets`, `PetDetails`, `ClientProfile`, `ClientSettings`, new `JoinClinic`, `SelectWorkspace`; repositories `clients`, `pets`.
- **DB objects:** `create_pet`, `update_pet`, `archive_pet`, `add_pet_guardian`; client-facing views.
- **Dependencies:** Phase 3.
- **Acceptance:** a client sees only pets and records within the active clinic; the same person in two clinics has separate pet records; pending clients see a status page with no clinical data.
- **Security risks:** IDOR on pet IDs (RLS and composite FKs); guardian escalation (only staff can add guardians, CONFIRM).
- **Testing:** component tests; E2E cross-clinic separation; pgTAP pet/guardian policies.

### Phase 5 — Doctor portal
- **Files:** `DoctorDashboard`, `DoctorPatients`, `DoctorAvailabilityPage` (rebuild), `DoctorProfilePage`, `DoctorSettingsPage`; repositories `doctors`, `schedules`.
- **DB objects:** `upsert_doctor_schedule`, `add_schedule_exception`; doctor views filtered by branch assignment.
- **Dependencies:** Phase 3; D-05, D-17.
- **Acceptance:** a doctor assigned to branches X and Y sees only those caseloads (or the org-wide policy chosen in D-17); schedules persist per branch.
- **Security risks:** doctor editing governance fields (blocked); schedule tampering for other doctors.
- **Testing:** pgTAP schedule policies; component tests.

### Phase 6 — Organization Admin portal
- **Files:** `AdminDashboard`, `AdminClients` (replace), `AdminDoctors`, `AdminPets`, `AdminConsultations`, `AdminPrescriptions`, `AdminMedicalRecords`, `AdminReports`, `AdminSettings` (replace); new `Branches`, `Staff`, `Roles`, `JoinRequests`, `AuditLog`.
- **DB objects:** `approve_clinic_client`, `reject_clinic_client`, `set_member_roles`, `suspend_member`, `assign_doctor_to_branch`, reporting views, org audit view.
- **Dependencies:** Phases 3–5.
- **Acceptance:** an org admin manages only their org; every admin action appears in the audit log; join approvals gate client access.
- **Security risks:** privilege escalation via role assignment (owner-only for admin roles; cannot grant more than you hold).
- **Testing:** pgTAP role-assignment rules; E2E admin journeys.

### Phase 7 — Platform Owner portal
- **Files:** `src/features/platform/*` (Applications, Organizations, OrganizationDetail, PlatformAudit, PlatformAdmins).
- **DB objects:** `approve_organization_application`, `reject_organization_application`, `suspend_organization`, `reactivate_organization`; platform views (no clinical data).
- **Dependencies:** Phase 3.
- **Acceptance:** a new clinic can self-register and is unusable until approved; a suspended org's members lose access immediately; the Platform Owner cannot read clinical rows.
- **Security risks:** platform-admin account compromise (MFA required, CONFIRM); approval race (row lock).
- **Testing:** pgTAP for platform functions; E2E onboarding.

### Phase 8 — Appointments and consultations
- **Files:** `FindDoctor` (refactor), `MyConsultations`, `DoctorRequests`, `DoctorConsultations`, `AdminConsultations`, new `AppointmentDetail`, calendar component, `StatusBadge`.
- **DB objects:** `get_available_slots`, `request_appointment`, `confirm_appointment`, `decline_appointment`, `cancel_appointment`, `reschedule_appointment`, `mark_no_show`, `complete_appointment`; extended `activate_consultation`, `reject_`, `complete_`, `reassign_consultation`; exclusion constraint.
- **Dependencies:** Phases 4–6.
- **Acceptance:** requests never block slots; concurrent overlapping confirmations produce exactly one success; confirmation revalidates schedule, assignment and client status; consultation activation sets an exact 7-day window recorded in history and audit.
- **Security risks:** booking spam (rate limit per client per day, CONFIRM); timezone errors (store `timestamptz`, branch timezone for display).
- **Testing:** concurrency integration test; pgTAP state machine; E2E booking journey.

### Phase 9 — Chat, medical records and notifications
- **Files:** `ClientChat`, `DoctorChat`, `DoctorPrescriptions`, `DoctorMedicalRecords`, `ClientPrescriptions`, `ClientMedicalRecords`, `PetDetails`, `ClientNotifications`, `Header` notifications, `PrescriptionModal`, `FileUploader`.
- **DB objects:** `send_chat_message`, `mark_messages_read`, `issue_prescription`, `void_prescription`, `add_medical_record`, `amend_medical_record`, `record_vaccination`, `enqueue_notification`; realtime publication for `chat_messages` and `notifications`; storage policies.
- **Dependencies:** Phase 8.
- **Acceptance:** messages are delivered in realtime only to participants; send is rejected at or after `expires_at` using server time; prescriptions are atomic (header and items or nothing); attachments are private and served via signed URLs; notifications are generated for key events.
- **Security risks:** malicious uploads (MIME and size allow-list, no inline HTML rendering); realtime channel leakage (RLS-authorized channels).
- **Testing:** pgTAP chat window boundary tests; storage policy tests; realtime integration test.

### Phase 10 — Security, testing and MaxPetZ pilot
- **Files:** test suites; CI workflow; runbooks under `docs/ops/`.
- **DB objects:** drop remaining legacy policies, `is_admin`, `is_doctor`; Advisors findings resolved.
- **Dependencies:** Phases 1–9.
- **Acceptance:** full tenant-isolation matrix green; zero High/Critical findings from the external pen-test; MaxPetZ UAT sign-off; pilot steps P0–P2 complete (`TESTING_AND_RELEASE_PLAN.md` §5.3).
- **Security risks:** residual legacy paths; staff phishing (MFA for staff, CONFIRM).
- **Testing:** complete pgTAP + Vitest + Playwright; load test at pilot volume; restore drill.

### Phase 11 — Production readiness
- **Files:** `docs/ops/*` (incident response, backup and restore, on-call), privacy policy and DPA templates (legal input), monitoring config.
- **DB objects:** contract migrations (drop `user_roles`, `pets.owner_id`, `doctor_availability`; FK `profiles → auth.users`); audit-log partitioning or retention job.
- **Dependencies:** Phase 10 stable for at least 2 release cycles.
- **Acceptance:** PITR enabled and a restore drill documented; SLOs defined and monitored; data retention policy approved; P3–P4 rollout criteria met.
- **Security risks:** irreversible contract steps (PITR required; separate approval per drop).
- **Testing:** regression suite after each contract migration; DR drill.

## 4. Top decisions needed from you before Phase 1

1. **D-01 / D-02:** Do all existing records belong to MaxPetZ Hospitals, and under which branch(es)?
2. **D-03 / D-11 / D-15:** What to do with seed data, test accounts and script-created users in the live database?
3. **D-04:** Who is the Platform Owner? Which current admins become MaxPetZ admins?
4. **D-16 / D-17:** Clinical visibility within an org (all doctors vs branch vs treating doctor) and whether org admins can read chats.
5. **Appointments:** Who confirms (front desk, doctor, both)? Can a consultation be activated without an appointment (pure tele-consult)?
6. **Tooling:** npm or bun; TanStack Query adoption; MFA for staff and Platform Owner.
7. **Environments:** Approval to create a staging project and to run the read-only discovery queries against production.

## 5. What was NOT verified

- Live database: applied migrations, policies, triggers, data volumes, presence of test accounts, storage buckets, realtime publication.
- Whether the app builds or type-checks with the pinned TypeScript 7 / Vite 8 versions.
- Whether any SQL test or script passes. **No test was executed, and none is reported as passed.**
- Deployment hosting, domain, and Supabase Auth settings (email confirmation, redirect URLs, MFA).
