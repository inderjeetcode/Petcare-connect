# PET CONNECT — Migration Safety, Rehearsal & Rollback Plan

**Document Status:** Phase 1 Execution Governance  
**Mandatory Rule:** **No migration, backfill, or schema mutation may run against production in Phase 1.** All Phase 2+ database changes follow **Expand → Backfill → Validate → Switch → Contract**, rehearsed first on a staging database restored from a production backup.

---

## 1. Pre-Execution Prerequisites (Hard Blockers)

No Phase 2 database migration may begin until an authorized operator completes and signs off:
1. **Point-in-Time Recovery (PITR) & Backup Drill:** Verify PITR (or recent automated backup) is enabled on the target Supabase project, restore a copy into an isolated **staging** project, and verify checksum/count parity.
2. **Phase 0 Read-Only Discovery Output:** Run the SELECT-only discovery queries (`DATABASE_MIGRATION_PLAN.md` §2) against production to determine exact live tables, RLS policies, attached triggers (especially `handle_new_user`), indexes (`001` vs `999`), test accounts (`003`), and data volumes.
3. **Production Baseline Capture:** Operator runs `supabase db dump --schema public` on production, audits any sensitive function definitions, and commits a reproducible timestamped baseline migration + marks it applied via `supabase migration repair --status applied` (never `db reset` against live!).
4. **Incident Remediation for `003` & `cleanup_test_records`:** If Phase 0 confirms `003_setup_test_accounts.sql` ran in production, rotate/disable the four `*@petconnect.com` and `vet.tester.petconnect@gmail.com` Auth accounts via Supabase Dashboard before opening traffic, and schedule `DROP FUNCTION public.cleanup_test_records(uuid[])` in the first hardening migration (`Phase 2a`).
5. **Signed MaxPetZ Data Manifest:** Written approval of `HISTORICAL_BRANCH_MAPPING_PLAN.md` decisions (`D-03`, `D-07`, `D-08`, `D-09`, `D-11`, `D-12`, `D-13`, `D-14`, `D-15`).

---

## 2. Phase-by-Phase Safety Protocol

### Phase 2a — Critical Single-Tenant Security Hardening
- **Scope:** Drops `cleanup_test_records`, locks `consultations` updates behind RPCs + immutability trigger (`consultations_guard_window`), forces `request_consultation()` validation, replaces global `OR is_doctor()` reads, converts `medical_records.pet_id` / `vaccinations.pet_id` to `ON DELETE RESTRICT`, adds `TO authenticated` on base-table policies, blocks `profiles.email` edits, and restricts `audit_logs` inserts to `SECURITY DEFINER` RPCs.
- **Safety Gate:** Frontend service calls (`reject`, `complete`, `issue_prescription`, `add_medical_record`, `record_vaccination`) must deploy in sync with direct-write revocations so active workflows do not break.
- **Lock Budget:** `SET lock_timeout = '3s'; SET statement_timeout = '60s';`.

### Phase 2b — Additive Multi-Tenant Expand
- **Scope:** Creates `app` helper schema, `platform_admins`, `organizations`, `organization_applications`, `branches`, role/permission tables, `organization_memberships`, `clinic_clients`, `pet_guardians`, `doctor_branch_assignments`, `doctor_schedules`, `doctor_schedule_exceptions`, `appointments` (with `btree_gist` exclusion constraint), `attachments`, and nullable `organization_id` / `branch_id` columns on existing tables.
- **Safety Gate:** Zero destructive DDL (`DROP`, `RENAME`, `SET NOT NULL`). Existing single-tenant reads/writes remain uninterrupted during the additive expand window. All new tables enable RLS immediately.

### Phase 2c — Deterministic Backfill (Zero Branch Guessing)
- **Scope:** Inserts **MaxPetZ** (`organizations`), verified **MaxPetZ** `branches`, verified staff memberships, approved `clinic_clients`, `pet_guardians`, and populates `organization_id` (plus verified `branch_id`) across existing tables in batches of 5,000–10,000 rows.
- **Auditability:** Every batch updates/inserts a `migration_runs` tracking row (`migration_name`, `started_at`, `finished_at`, `rows_affected`, `checksum_before`, `checksum_after`, `operator`).
- **Ambiguity Guard:** Any historical row whose branch cannot be deterministically verified from source records stays unmapped/quarantined rather than receiving a fabricated branch ID.

### Phase 2d — Constraint Validation & Reconciliation
- **Two-Step Constraints:**
  1. Add composite tenant FKs `(child_fk, organization_id)` and `CHECK (organization_id IS NOT NULL)` with **`NOT VALID`** (short metadata lock).
  2. Run **`ALTER TABLE ... VALIDATE CONSTRAINT ...`** separately (acquires only `SHARE UPDATE EXCLUSIVE`, allowing concurrent reads/writes).
  3. On PostgreSQL 12+, promote `SET NOT NULL` after validating the `CHECK (organization_id IS NOT NULL)` constraint to avoid full-table `ACCESS EXCLUSIVE` scans.
- **Exit Reconciliation:** Assert `0` unexpected NULL `organization_id` values, identical row counts before/after, and `id`-set checksums match pre-backfill snapshots.

### Phase 3+ — Same-Transaction RLS Policy Switch
- **Critical Concurrency & Security Rule:** For each table, execute `CREATE POLICY <new_tenant_policy>` and `DROP POLICY <legacy_policy>` **inside a single atomic transaction**.
  - Never drop legacy policies before new policies exist (prevents an open/unprotected or fail-closed outage window).
  - Never leave legacy permissive policies active alongside new tenant policies (PostgreSQL ORs permissive policies, which would silently bypass tenant isolation).

### Phase 11 — Contract Phase (Delayed Cleanup)
- **Rule:** Legacy columns/tables (`user_roles`, `pets.owner_id`, `consultations.client_id`, `doctor_availability`, `is_admin()`, `is_doctor()`) remain read-only for at least **2 stable release cycles** verified via `pg_stat_user_tables` scan deltas before any `DROP` migration is approved.

---

## 3. Staging Rehearsal & Verification Gates

Every migration script in `supabase/migrations/` must pass all local & staging gates prior to production promotion:
1. `supabase db reset` applies cleanly from zero in CI.
2. Staging rehearsal runs against a **production snapshot** (with PII handling approved) and produces a signed Reconciliation Report.
3. **Down-migration verification:** Tested on staging before production deployment.
4. **pgTAP Isolation Matrix (`supabase test db`):** Executes with explicit `SET LOCAL ROLE authenticated` + `request.jwt.claims` (fixing `SEC-15`), proving:
   - Zero cross-org read/write across every table.
   - Org doctors read all clinical records inside their org (`D-17`) and zero outside.
   - Expired consultation chat history readable **only** by client & treating doctor (`D-16`), and new inserts rejected at/after `expires_at`.
   - Concurrent `confirm_appointment` race returns one success and `23P01` on conflicting slot.
   - `activate_consultation` rejects missing/unconfirmed appointments (`22023`), clients (`42501`), and unassigned doctors (`42501`).

---

## 4. Rollback Playbook & Emergency Triggers

### Automatic Release Freeze / Rollback Triggers
- Any cross-tenant data visibility or write path detected.
- Any failure of server-side audit log insertion.
- Any violation of the exact 7-day consultation chat window (`expires_at <> activated_at + 7 days` or post-expiry message acceptance).
- Any reconciliation count or ID-checksum mismatch during backfill.

### Phase Rollback Strategy
| Phase | Rollback Mechanism |
|---|---|
| **2a (Hardening)** | Execute tested down-migration restoring exact Phase 0 `pg_policies` & function definitions + toggle frontend patch flag. |
| **2b (Additive Expand)** | Existing app ignores new tables/nullable columns; down-script drops new empty tables/columns cleanly. |
| **2c (Backfill)** | Reverse updates back to `NULL` and delete rows tagged with `migration_runs.id` (`source = 'legacy-backfill'`). |
| **3+ (Policy Switch)** | Atomic per-table transaction re-creating prior policies and dropping new policies. |
| **11 (Contract Drops)** | **Irreversible via SQL alone** — requires Supabase PITR restore to pre-contract timestamp (verified via DR drill beforehand). |
