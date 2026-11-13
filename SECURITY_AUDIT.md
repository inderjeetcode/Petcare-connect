# 04 — Security Audit

**Method:** static review of SQL, RLS and TypeScript. **No exploit was executed** against any database. Each finding states whether it is **VERIFIED in code** or depends on **live state (NOT VERIFIED)**. Postgres RLS semantics assumed: for `UPDATE` and `ALL` policies without `WITH CHECK`, the `USING` expression is also applied to the new row. Policies without a `TO` clause apply to every role, including `anon`.

No secrets were requested, and no service-role key is referenced anywhere in the repository (VERIFIED by grep).

## Severity summary

| ID | Title | Severity | Status |
|---|---|---|---|
| SEC-01 | Client-side-only portal authorization (role switcher, no route guards) | High | VERIFIED |
| SEC-02 | Test accounts with known password, incl. **admin**, inserted into `auth.users` by a "migration" | **Critical** if 003 ran on prod | Code VERIFIED / live NOT VERIFIED |
| SEC-03 | Doctors can bypass `activate_consultation` and rewrite consultations directly (7-day rule bypass) | **Critical** | VERIFIED |
| SEC-04 | Clients can insert consultations with arbitrary status, timestamps, doctor and pet | High | VERIFIED |
| SEC-05 | Any doctor can read all medical records, vaccinations and prescription items | **Critical** (multi-tenant) | VERIFIED |
| SEC-06 | Any doctor can write medical records and vaccinations for any pet with any `doctor_id` | High | VERIFIED |
| SEC-07 | Single global `admin` sees and modifies everything | High | VERIFIED |
| SEC-08 | Anonymous read of doctor PII and all reviews | Medium | VERIFIED |
| SEC-09 | Profile update has no column restriction (email squatting / signup denial) | Medium | VERIFIED |
| SEC-10 | Doctors can re-activate themselves and change their fee | Medium | VERIFIED |
| SEC-11 | `cleanup_test_records` deletes clinical chat and audit rows in prod; weak guard | High | VERIFIED |
| SEC-12 | Audit trail is mostly client-side; server audit forgeable | High | VERIFIED |
| SEC-13 | Hard-coded project URL and key fallback couple every build to one project | Medium | VERIFIED |
| SEC-14 | Verification scripts mutate production and print unconditional PASS | Medium | VERIFIED |
| SEC-15 | SQL security tests bypass RLS; "19/19 verified" claim unsupported | High (assurance) | VERIFIED |
| SEC-16 | Client pet deletion cascades and destroys medical records and vaccinations | High | VERIFIED |
| SEC-17 | Mock clinical data shown as real in database mode | High (patient safety) | VERIFIED |
| SEC-18 | Password-reset link lands on a non-existent route | Medium | VERIFIED |
| SEC-19 | No file storage; attachments are `blob:` or placeholder URLs | Medium (gap) | VERIFIED repo / live NOT VERIFIED |
| SEC-20 | Signup trigger not attached; global client role auto-assigned | Medium | Code VERIFIED / live NOT VERIFIED |
| SEC-21 | Direct table writes for state transitions instead of RPCs | High (design) | VERIFIED |
| SEC-22 | Global admin can read every chat | Medium | VERIFIED |
| SEC-23 | Demo mode and DB diagnostics exposed in production UI | Low | VERIFIED |
| SEC-24 | Realtime subscription unfiltered (if enabled) | Low | VERIFIED code |

---

## SEC-01 — Client-side-only portal authorization (High)
**Evidence:** `src/App.tsx:49-97` has no guard on any route. `src/context/AppContext.tsx:153` sets `currentRole` as free React state, and `:948` exports `setCurrentRole`. `src/components/common/Header.tsx:48-54` (`handleRoleChange` calls `setCurrentRole` and navigates) is rendered at `:116-150` and `:337-362` for every user, signed in or not.
**Impact:** Any visitor, or any authenticated client, can open the doctor and admin UIs. In database mode, RLS still blocks most reads and writes, so the impact is bounded by the RLS gaps below. Combined with SEC-03 to SEC-07, the UI makes those gaps easy to reach.
**Fix (PROPOSED):** Route guards driven by server-derived memberships and permissions; remove the switcher; replace it with an organization/workspace switcher that only lists the user's approved memberships.

## SEC-02 — Known-password test accounts inserted into Auth, including an admin (Critical if applied to production)
**Evidence:** `supabase/migrations/003_setup_test_accounts.sql`
- `:68` comment and `:91,100,124,133,157,166,190,199` `crypt('Password123!Secure', …)`, the password committed in plaintext.
- `:276-282` gives `a1000000-…` the role `'admin'`, which means global access to every row through `is_admin()`.
- `:21-51` **DELETE FROM auth.identities / auth.users** (scoped to test emails, but it is still a destructive write on the Auth schema).
- `:56-64` forces `email_confirmed_at` for `vet.tester.petconnect@gmail.com`, a real external mailbox address not otherwise defined in the repo.

The file is placed in `migrations/`, so any tool that applies the folder will create these accounts. The frontend admin page advertises the file (`AdminSettings.tsx:532`).
**Live state:** **NOT VERIFIED** whether 003 was applied. `test_controlled_rpc.cjs:317-319` tells the operator to run it in the SQL editor, which suggests it may have been.
**Fix:** Treat as an incident until disproven. Check `auth.users` for those emails (read-only). If present, an authorized operator rotates or disables them through the Supabase dashboard. Move test-account creation to a local or staging-only seed. Never place it in `migrations/`. Purge the password from git history (CONFIRM: whether the repo has been pushed to a shared remote).

## SEC-03 — Doctor bypass of the activation RPC (Critical)
**Evidence:** `rls_policies.sql:181-189` (and `999:494-496`):
```sql
CREATE POLICY "Assigned doctors and admins can update consultations"
ON public.consultations FOR UPDATE
USING (public.is_admin() OR EXISTS (… dp.id = consultations.doctor_id AND dp.user_id = auth.uid()));
```
There is no `WITH CHECK` and no column restriction, so every column is writable. The CHECK `expires_at = activated_at + 7 days` (`001:106-108`) only requires internal consistency.
**Attack (assigned doctor, PostgREST):**
1. `PATCH /consultations?id=eq.X {consultation_status:'active', activated_at:'2027-01-01', expires_at:'2027-01-08'}` extends the chat window by months, or re-opens an expired consultation. The chat INSERT policy (`:240-255`) trusts these columns.
2. Change `client_id`/`pet_id` to another client's IDs. The doctor then gains SELECT on that pet (`pets` policy `:146-157`) and that client's records via the pet.
3. Activate without the RPC, which skips audit and conversation creation.
The frontend already does direct updates for reject and complete (`supabaseService.ts:356-382`), with client-supplied timestamps.
**Fix:** Revoke table UPDATE from `authenticated` on `consultations`; all transitions go through SECURITY DEFINER RPCs (`activate_`, `reject_`, `complete_`, `reassign_consultation`) with state-machine checks and audit. Optionally add a trigger that forbids changes to `activated_at`/`expires_at` once set.

## SEC-04 — Unrestricted client consultation insert (High)
**Evidence:** `rls_policies.sql:177-179` `WITH CHECK (client_id = auth.uid())` only.
**Attack:** A client inserts `{client_id: self, doctor_id: any, pet_id: <someone else's pet id>, consultation_status: 'completed', activated_at, expires_at}`.
- Skips clinic approval (status `active` or `completed` without any doctor action).
- The review policy (`:343-353`) then allows a review for any doctor, so the client can manufacture public reviews at will.
- References another user's pet. Pet UUIDs are hard to guess, but the FK accepts them, and the assigned doctor then gets visibility of that pet.
**Fix:** `request_appointment()` and `request_consultation()` RPCs that validate pet guardianship, clinic membership and doctor-branch assignment, and force `status='requested'`. Revoke direct INSERT.

## SEC-05 — Global clinical read for every doctor (Critical in multi-tenant)
**Evidence:**
- `medical_records` SELECT: `… OR public.is_doctor()` (`rls_policies.sql:308-316`).
- `vaccinations` SELECT: `… OR public.is_doctor()` (`:322-330`).
- `prescription_items` SELECT: `p.client_id = auth.uid() OR public.is_doctor() OR public.is_admin()` (`:284-292`).
**Impact:** Any account with the `doctor` role reads **every** pet's medical history and every prescription line platform-wide. After multi-tenancy, a doctor at Clinic A would read Clinic B's records, a direct cross-tenant breach.
**Fix:** Scope by `organization_id` and a permission (`medical_records.read`). Within an org, optionally restrict to doctors assigned to the pet's branch or who have treated the patient (CONFIRM the clinical access policy).

## SEC-06 — Unscoped clinical writes by any doctor (High)
**Evidence:** `medical_records` INSERT `WITH CHECK (public.is_doctor() OR public.is_admin())` (`:318-320`); `vaccinations` INSERT same (`:332-334`). There is no check on `pet_id`, `doctor_id` or `consultation_id`.
**Impact:** A doctor can attribute records to another doctor and write into any pet's history. That breaks clinical record integrity and non-repudiation.
**Fix:** RPC `add_medical_record()` sets `doctor_id`/`created_by` from `auth.uid()`, verifies the org and the pet relationship, and audits.

## SEC-07 — Monolithic global admin (High)
**Evidence:** `is_admin()` (`002:8-25`) is OR'ed into nearly every policy (profiles, roles, pets, consultations, payments, chats, prescriptions, records, audit).
**Impact:** "Clinic director" and "platform operator" are the same principal with unrestricted clinical, PII and role-management power. It cannot express "MaxPetZ admin manages only MaxPetZ".
**Fix:** Split into (a) `platform_admins` (Platform Owner): manages organizations and applications, **no default clinical data access**; (b) org-scoped roles through `organization_memberships` and permissions.

## SEC-08 — Anonymous PII exposure (Medium)
**Evidence:** `profiles` SELECT includes `EXISTS (… doctor_profiles … is_active = true)` (`:73-79`) without `TO authenticated`, so `anon` with the publishable key reads `email` and `phone` of every active doctor. `reviews` `USING (true)` (`:339-341`) exposes all reviews and client IDs to anon.
**Fix:** A public directory view exposing only the fields you intend to publish; `TO authenticated` on all base-table policies.

## SEC-09 — Unrestricted own-profile update (Medium)
**Evidence:** `:85-87` `FOR UPDATE USING (auth.uid() = id)`, with no column control. `profiles.email` is `UNIQUE` (`001:16`).
**Impact:** A user sets their `profiles.email` to someone else's address. When that person later signs up, `handle_new_user()` (`999:404-411`) hits `ON CONFLICT (id)`, not `(email)`, so the unique-violation on email **aborts their signup**. Profile email can also disagree with the auth email shown to staff.
**Fix:** Drop `email` from `profiles` (read from `auth.users` through a view or RPC), or make it non-updatable by trigger; restrict updatable columns.

## SEC-10 — Doctor self-service on governance fields (Medium)
**Evidence:** `doctor_profiles` UPDATE `USING (user_id = auth.uid() OR public.is_admin())` (`:125-127`).
**Impact:** A deactivated doctor sets `is_active = true` and becomes bookable and able to activate consultations again (the RPC checks `dp.is_active`, `001:327`). They can also change `consultation_fee`.
**Fix:** Column-level split: doctors edit bio and qualifications through an RPC; status, fee and assignments are admin-only.

## SEC-11 — Destructive cleanup RPC in production (High)
**Evidence:** `003:308-398`. Any `admin` can call it (`GRANT EXECUTE … TO authenticated`, `:398`). The guard (`:337-345`) rejects only when a row has **both** a non-test client **and** a reason without `[CONTROLLED-TEST]`. Because `consultation_reason` is client-controlled, any real consultation whose text contains that marker, and every consultation of client `c1000000-…-0001` (which is "Sarah Jenkins" in `seed.sql:10`), can be deleted together with its chat messages (`:349-352`) and audit rows (`:371-386`).
**Impact:** A SECURITY DEFINER path to destroy immutable clinical communications and erase audit evidence.
**Fix:** Drop this function from production (via an approved migration). Test cleanup belongs in disposable environments.

## SEC-12 — Audit logging not trustworthy (High)
**Evidence:** `AppContext.tsx:368-381` `logAudit` only prepends to React state, so reject, complete, prescription, records, pet edits, doctor changes and reassignments are **never** written server-side. The only server audit is in `activate_consultation` (`001:367-382`). `audit_logs` INSERT is allowed for admins with an arbitrary `user_id` (`rls_policies.sql:371-373`). SEC-11 deletes audit rows.
**Fix:** Audit written only inside SECURITY DEFINER RPCs and triggers; revoke INSERT/UPDATE/DELETE on `audit_logs` from all API roles; add `organization_id`, `actor_user_id`, `action`, `entity`, `before`/`after` jsonb, `request_id`; consider monthly partitioning.

## SEC-13 — Hard-coded backend fallback (Medium)
**Evidence:** `src/config/supabaseClient.ts:10-20`, `scripts/test_controlled_rpc.cjs:33-34`, `scripts/verify_remote_supabase.cjs:10-12` embed `https://ntnzspsscbfmziintsru.supabase.co` and the `sb_publishable_…` key.
**Assessment:** Publishable keys are designed to be public, so this is **not a secret leak**. The risk is environmental: any build or script without env vars silently targets this (presumably production) project. `isSupabaseConfigured` is therefore always true, and demo mode is never the default.
**Fix:** Fail closed. Throw at startup if env vars are missing, and keep separate dev, staging and prod projects.

## SEC-14 — Scripts write to production and over-report (Medium)
**Evidence:** `verify_remote_supabase.cjs` signs up real users (`:107-116`, `@gmail.com` addresses, fixed password `:101`), inserts pets and consultations (`:226-307`), never cleans up, and prints `PASS` unconditionally at `:347-348` and `:378`.
**Fix:** Retire this script. Integration tests run only against local or staging Supabase with seeded fixtures and real assertions.

## SEC-15 — RLS tests do not test RLS (High, assurance)
**Evidence:** `supabase/tests/security_tests.sql:49` etc. use `set_config('request.jwt.claim.sub', …)` but never `SET LOCAL ROLE authenticated`. Executed as `postgres` (SQL editor default), RLS is bypassed, so A1 to A3 and E3 to E5 would **fail**, not pass, or the script would abort earlier at `:92` (FK on un-seeded `c2000000-…`). `:308-312` inserts a conversation directly, which only works because RLS is bypassed. `AdminSettings.tsx:547-549` displays "19/19 Tests Verified" as static text.
**Conclusion:** No RLS behaviour is evidenced by the repository. **No test result in this audit is marked as passed.**
**Fix:** pgTAP (`supabase test db`) with `SET LOCAL ROLE authenticated` and `request.jwt.claims` per case; run in CI against a local stack.

## SEC-16 — Client pet deletion destroys clinical records (High)
**Evidence:** `pets` policy `FOR ALL USING (owner_id = auth.uid() OR is_admin())` (`:159-161`); `medical_records.pet_id … ON DELETE CASCADE` (`001:189`); `vaccinations.pet_id … ON DELETE CASCADE` (`001:204`). `consultations`/`prescriptions` use RESTRICT, so deletion only succeeds for pets without those. But records added directly (`DoctorMedicalRecords.tsx:36` sets `consultation_id: null`) **will** cascade.
**Fix:** Clients never hard-delete clinical entities. Use soft-delete (`archived_at`) and `ON DELETE RESTRICT` on clinical FKs.

## SEC-17 — Fabricated clinical data presented as real (High, patient safety)
**Evidence:** `AppContext.tsx:157-192` initializes every collection from `mockData.ts`/`localStorage`; `:307-314` only replaces a collection when the DB returns rows. `currentProfile` falls back to mock profiles when no `authProfile` (`:335-344`).
**Impact:** In database mode, a real client or doctor with no rows sees demo pets, prescriptions and medical records, and may act on them.
**Fix:** Remove mock data from the production bundle; empty states only.

## SEC-18 — Broken password-recovery flow (Medium)
**Evidence:** `authService.ts:116-118` redirects to `${origin}/reset-password`; no such route (`App.tsx:96` falls back to `/client/dashboard`). `detectSessionInUrl: true` (`supabaseClient.ts:34`) establishes a recovery session with no password-update UI.
**Fix:** A dedicated reset route handling the `PASSWORD_RECOVERY` event and calling `updateUser({password})`.

## SEC-19 — No secure file handling (Medium, gap)
**Evidence:** no storage code or policies. `ClientChat.tsx:76` stores `URL.createObjectURL(file)`, a `blob:` URL only valid in the sender's tab, as `attachment_url`.
**Fix:** Private buckets with org-prefixed object keys (`{org_id}/{entity}/{id}/{uuid}`), `storage.objects` RLS mirroring table permissions, signed URLs, MIME and size limits, and an attachment metadata table.

## SEC-20 — Signup provisioning undefined (Medium)
**Evidence:** `handle_new_user()` defined (`999:397-419`) but no `CREATE TRIGGER … ON auth.users` in the repository. If no trigger exists live, new users have no profile, and `profiles` INSERT from the client is possible (`:81-83`) with arbitrary `full_name`/`email`. If a trigger exists, every signup gets a **global `client` role**, which conflicts with "clinic approval mandatory".
**Live:** NOT VERIFIED.
**Fix:** Signup creates a profile only; clinic access requires an approved `clinic_clients` row or membership.

## SEC-21 — Direct writes instead of guarded RPCs (High, design)
**Evidence:** reject/complete (`supabaseService.ts:356-382`), booking (`:236-256`), prescriptions plus items as two non-atomic inserts (`:517-543`), medical records (`:556-565`), vaccinations (`:578-587`), pets (`:133-160`), chat messages (`:423-449`).
**Fix:** RPC catalogue in `MULTI_TENANT_GAP_ANALYSIS.md` §6; table-level `REVOKE INSERT, UPDATE, DELETE` for API roles on workflow tables.

## SEC-22 — Global admin reads all chats (Medium)
**Evidence:** `chat_messages` SELECT includes `OR public.is_admin()` (`:230`); `chat_conversations` (`:215`).
**Fix:** Org admins may read chats only with an explicit permission and an audited "break-glass" read (CONFIRM policy); the Platform Owner has none by default.

## SEC-23 — Diagnostics and demo controls in production UI (Low)
**Evidence:** `Header.tsx:92-113` demo toggle; `AdminSettings.tsx` table counts, RPC probes, and the CLI test command panel (`:507-525`).
**Fix:** Build-time flag; remove from production builds.

## SEC-24 — Realtime subscription design (Low)
**Evidence:** `supabaseService.ts:462-479` subscribes to all `chat_messages` INSERTs without a filter, then re-queries per event. Postgres-changes respects RLS when enabled, so this is a performance concern rather than a leak, provided RLS stays correct.
**Fix:** Filter by `conversation_id=eq.{id}` or use broadcast channels authorized by RLS on `realtime.messages`.

---

## Authorization assumptions checklist

| Assumption asked about | Finding |
|---|---|
| Global admin roles | Present and over-powered (SEC-07) |
| Organization-scoped permissions | **Absent** |
| Branch-level access | **Absent** |
| Cross-tenant leakage | Inevitable without redesign (SEC-05, SEC-07, SEC-22) |
| IDOR | Consultation insert accepts foreign `pet_id`/`doctor_id` (SEC-04); doctor can repoint `client_id`/`pet_id` (SEC-03). Frontend `:id` routes rely on RLS (acceptable once RLS is fixed) |
| Client-side-only authorization | Portal access and pre-activation checks (SEC-01) |
| Direct writes that should be RPCs | SEC-21 |
| Chat authorization and expiry | INSERT policy sound; undermined by SEC-03. Expired chats are readable ✔ |
| Medical record access | SEC-05, SEC-06, SEC-16 |
| Storage | None (SEC-19) |
| Audit logging | SEC-12, SEC-11 |
| Test accounts and credentials | SEC-02, SEC-14 |
| Secret management | No service-role or private secrets in repo ✔; test password committed (SEC-02); hard-coded publishable fallback (SEC-13) |

## Immediate, non-code actions recommended before Phase 2 (CONFIRM owner)
1. Read-only check of the live project for the four `*@petconnect.com` test users and `vet.tester.petconnect@gmail.com`; if present, disable or rotate them via the dashboard.
2. Read-only check whether `cleanup_test_records` exists live; plan its removal in the first approved migration.
3. Stop running `scripts/verify_remote_supabase.cjs` and `scripts/test_controlled_rpc.cjs` against production.
4. Confirm whether this repository exists on a shared remote (for history rewrite of the committed password).
