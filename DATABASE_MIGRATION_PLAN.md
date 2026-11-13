# 08 — Database Migration Plan

**Nothing in this document has been executed.** All SQL is illustrative. Every step requires explicit approval, a fresh backup, and execution by an authorized operator. No step resets the database, drops a populated table, or deletes production records without a separate signed-off decision (see D-xx in `EXISTING_TO_TARGET_SCHEMA_MAPPING.md`).

## 1. Principles

1. **Expand → Backfill → Validate → Switch → Contract.** Each step is a separate, reversible migration.
2. **Additive first.** New tables and nullable columns. Constraints are added `NOT VALID` and validated later.
3. **No guessing.** Tenant ownership is assigned only from confirmed decisions (D-01, D-02, D-04, D-05).
4. **Staging rehearsal.** Every migration runs first on a staging project restored from a production backup, with row-count and checksum reports.
5. **Short locks.** `SET lock_timeout = '3s'; SET statement_timeout = '60s'` for DDL; batch backfills in chunks of 5–10k rows.
6. **Single migration source.** Supabase CLI (`supabase/migrations/<timestamp>_name.sql`) with history in `supabase_migrations.schema_migrations`.
7. **Audit every data change.** Backfill writes a `migration_runs` record (id, name, started/finished, row counts, operator).

## 2. Phase 0 — Read-only discovery (requires approval to run; read-only)

Goal: learn which of 001/002/policies/003/999/seed are actually applied, and the data volumes. An authorized operator runs these **SELECT-only** queries in the SQL editor or with a read-only role and shares the output.

```sql
-- 2.1 Objects present
SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1;
SELECT schemaname, tablename, policyname, cmd, roles, qual, with_check FROM pg_policies WHERE schemaname='public' ORDER BY 2,3;
SELECT p.proname, p.prosecdef, pg_get_function_identity_arguments(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public';
SELECT tgname, tgrelid::regclass FROM pg_trigger WHERE NOT tgisinternal;          -- is handle_new_user attached?
SELECT indexname, tablename FROM pg_indexes WHERE schemaname='public';            -- idx_prescriptions_client present? (001 vs 999)
SELECT pubname, tablename FROM pg_publication_tables;                              -- realtime
SELECT id, name, public FROM storage.buckets;                                      -- storage
SELECT * FROM supabase_migrations.schema_migrations;                               -- may not exist

-- 2.2 Volumes
SELECT 'profiles',count(*) FROM profiles UNION ALL SELECT 'pets',count(*) FROM pets
UNION ALL SELECT 'consultations',count(*) FROM consultations UNION ALL SELECT 'chat_messages',count(*) FROM chat_messages
UNION ALL SELECT 'prescriptions',count(*) FROM prescriptions UNION ALL SELECT 'medical_records',count(*) FROM medical_records
UNION ALL SELECT 'vaccinations',count(*) FROM vaccinations UNION ALL SELECT 'doctor_profiles',count(*) FROM doctor_profiles
UNION ALL SELECT 'doctor_availability',count(*) FROM doctor_availability UNION ALL SELECT 'consultation_payments',count(*) FROM consultation_payments
UNION ALL SELECT 'reviews',count(*) FROM reviews UNION ALL SELECT 'audit_logs',count(*) FROM audit_logs;

-- 2.3 Test / seed artefacts (D-03, D-11, D-15)
SELECT id, email, created_at FROM auth.users
 WHERE email LIKE '%@petconnect.com' OR email LIKE 'client.test.%@gmail.com' OR email='vet.tester.petconnect@gmail.com';
SELECT id, full_name, email FROM profiles WHERE id::text LIKE ANY (ARRAY['c1000000-%','d1000000-%','d2000000-%','d3000000-%','d4000000-%','a1000000-%']);
SELECT count(*) FROM consultations WHERE consultation_reason LIKE '%[CONTROLLED-TEST]%' OR consultation_reason LIKE 'Automated Test:%';

-- 2.4 Integrity
SELECT count(*) FROM profiles p LEFT JOIN auth.users u ON u.id=p.id WHERE u.id IS NULL;                 -- orphans (D-08)
SELECT count(*) FROM consultations c JOIN pets p ON p.id=c.pet_id WHERE p.owner_id<>c.client_id;          -- foreign-pet consultations (SEC-04)
SELECT count(*) FROM consultations WHERE consultation_status='active' AND expires_at < now();            -- stale (D-09)
SELECT user_id, array_agg(role) FROM user_roles GROUP BY 1 HAVING count(*)>1;                             -- multi-role users
SELECT count(*) FROM chat_messages WHERE attachment_url LIKE 'blob:%' OR attachment_url LIKE '%example.com%'; -- D-12
SELECT count(*) FROM chat_conversations cc JOIN consultations c ON c.id=cc.consultation_id
 WHERE cc.client_id<>c.client_id OR cc.doctor_id<>c.doctor_id;                                              -- denormalization drift
SELECT DISTINCT species FROM pets; SELECT DISTINCT gender FROM pets; SELECT DISTINCT day_of_week FROM doctor_availability;
```

**Exit criteria:** a signed inventory report plus answers to D-01 … D-17.

## 3. Phase 1 — Baseline and tooling

1. `supabase init`; link to a **staging** project first.
2. Generate a baseline from production with a read-only schema dump (`supabase db dump --schema public` by the operator). Commit it as `<ts>_baseline.sql` and mark it as applied in prod with `supabase migration repair --status applied` (operator action, approval required).
3. Archive `001`, `002`, `999`, `policies/rls_policies.sql` to `supabase/archive/` (never executed again). Move `003` and `seed.sql` to local-only seed.
4. Generate TypeScript types from staging.

## 4. Phase 2a — Security hardening on the existing single-tenant schema

Separate migration, deployable before tenancy. It fixes the critical findings without waiting for the full redesign:

| Step | Change | Fixes |
|---|---|---|
| H1 | `DROP FUNCTION IF EXISTS public.cleanup_test_records(uuid[])` (after D-11 confirmation) | SEC-11 |
| H2 | Create `reject_consultation`, `complete_consultation`, `reassign_consultation` RPCs; then `DROP POLICY "Assigned doctors and admins can update consultations"`; `REVOKE UPDATE ON consultations FROM authenticated` | SEC-03 |
| H3 | Trigger `consultations_guard_window` that raises if `activated_at`/`expires_at` change once non-null, or status goes `expired/completed/rejected → active` | SEC-03 (defence in depth) |
| H4 | `request_consultation` RPC (validates pet ownership, forces `pending`); drop the client INSERT policy | SEC-04 |
| H5 | Replace `OR is_doctor()` in medical_records/vaccinations/prescription_items SELECT with "doctor has a consultation for this pet" (interim, single-tenant) | SEC-05 |
| H6 | `add_medical_record`, `record_vaccination`, `issue_prescription` RPCs; drop direct INSERT policies | SEC-06, SEC-21 |
| H7 | `medical_records.pet_id` and `vaccinations.pet_id` FK → `ON DELETE RESTRICT`; pets policy split so clients cannot DELETE (archive column instead) | SEC-16 |
| H8 | `doctor_profiles` UPDATE limited by trigger to non-governance columns for non-admins | SEC-10 |
| H9 | Add `TO authenticated` to every policy; public doctor directory view | SEC-08 |
| H10 | Profiles: block `email` changes via trigger | SEC-09 |
| H11 | `REVOKE INSERT ON audit_logs FROM authenticated`; audit only from DEFINER functions | SEC-12 |

The frontend must ship the matching RPC calls **in the same release** (`supabaseService` reject/complete/Rx/records). Otherwise those buttons fail. Coordinate with Phase 3, or ship a minimal frontend patch with H2–H6.

## 5. Phase 2b — Tenancy expand (additive)

Order matters for FKs. Each line is a migration file.

1. `create_app_schema_and_helpers` — schema `app`; `app.is_platform_admin()`, `app.is_org_member()`, `app.has_org_permission()` (return false until data exists).
2. `create_platform_admins`
3. `create_organizations`, `create_organization_applications`, `create_branches`
4. `create_roles_permissions` (+ seed of system roles and permission catalogue)
5. `create_organization_memberships`, `create_membership_roles`
6. `create_clinic_clients`, `create_pet_guardians`
7. `add_org_columns` — nullable `organization_id` (+ `branch_id` where relevant) on pets, doctor_profiles, consultations, consultation_payments, chat_conversations, chat_messages, prescriptions, prescription_items, medical_records, vaccinations, notifications, reviews, audit_logs, doctor_availability
8. `create_doctor_branch_assignments`, `create_doctor_schedules`, `create_doctor_schedule_exceptions`
9. `create_appointments`, `create_appointment_status_history` (with `btree_gist` exclusion constraint)
10. `create_attachments` (+ private storage bucket `clinical-files` and `storage.objects` policies keyed by `org_id` path prefix)
11. `create_indexes_tenant` — `(organization_id)` and `(organization_id, <fk>)` on all tenant tables; membership lookup `(user_id, organization_id) WHERE status='active'`; `(conversation_id, created_at)`
12. RLS **enabled on all new tables** with tenant policies from creation (no data yet, so no exposure).

## 6. Phase 2c — Backfill (only after D-01/D-02/D-04/D-05 are answered)

Run in a transaction per table, in batches, on staging first; produce before/after counts.

```sql
-- illustrative
INSERT INTO organizations (id, slug, display_name, status, timezone) VALUES (:maxpetz_id,'maxpetz','MaxPetZ Hospitals','active',:tz);
INSERT INTO branches (id, organization_id, name, code) VALUES (:legacy_branch_id, :maxpetz_id, :confirmed_name, :code);
UPDATE pets SET organization_id = :maxpetz_id WHERE organization_id IS NULL AND id IN (SELECT id FROM pets LIMIT 5000);  -- loop
INSERT INTO clinic_clients (organization_id, user_id, full_name, email, phone, status, approved_at, approved_by_note)
  SELECT :maxpetz_id, p.id, p.full_name, p.email, p.phone, 'approved', now(), 'legacy-backfill'
  FROM profiles p WHERE EXISTS (SELECT 1 FROM pets x WHERE x.owner_id=p.id) OR EXISTS (SELECT 1 FROM consultations c WHERE c.client_id=p.id);
INSERT INTO pet_guardians (organization_id, pet_id, clinic_client_id, is_primary)
  SELECT p.organization_id, p.id, cc.id, true FROM pets p JOIN clinic_clients cc ON cc.user_id=p.owner_id AND cc.organization_id=p.organization_id;
```

Excluded from backfill until decided: test and seed artefacts (D-03, D-11), orphan profiles (D-08), stale statuses (D-09).

## 7. Phase 2d — Validate

- `SELECT count(*) … WHERE organization_id IS NULL` = 0 for every tenant table (except allowed-NULL tables such as notifications and history).
- Composite FKs `(x_id, organization_id)` added `NOT VALID`, then `VALIDATE CONSTRAINT` (validation takes only a SHARE UPDATE EXCLUSIVE lock).
- `ALTER COLUMN organization_id SET NOT NULL` (on PG12+, preceded by a validated `CHECK (organization_id IS NOT NULL)` to avoid a full scan under an exclusive lock).
- Reconciliation report: counts per table before and after, plus checksums of `id` sets.

## 8. Phase 3+ — Switch policies

Per table, in **one transaction**: create the tenant policies, then drop the legacy policies. This prevents both an "open window" (no policy dropped before the replacement exists) and the OR-ing of permissive policies (legacy policies removed in the same step). Order follows frontend migration: pets → clinic_clients → consultations → chat → clinical → notifications → audit.

## 9. Phase 11 — Contract (each requires separate sign-off)

- Drop `user_roles` (after 2 release cycles with no reads; verify with `pg_stat_user_tables.seq_scan/idx_scan` deltas).
- Drop `pets.owner_id` and `consultations.client_id` → `clinic_client_id` only.
- Drop `is_admin()`, `is_doctor()`.
- Drop `doctor_availability` after `doctor_schedules` parity is confirmed.
- Add FK `profiles.id → auth.users(id) ON DELETE RESTRICT` (after D-08).

## 10. Rollback strategy

| Phase | Rollback |
|---|---|
| 2a hardening | Each migration ships a down script re-creating the previous policy and function definitions (captured from the Phase 0 `pg_policies` output) |
| 2b expand | New objects are unused by the old app; down = drop new objects (only if empty) |
| 2c backfill | Backfill only fills NULL columns. Down = set back to NULL, keyed by `migration_runs` ids. Inserted rows (orgs, clinic_clients, guardians) are tagged `source='legacy-backfill'` |
| 3 policy switch | Per-table transaction; down re-creates legacy policies |
| 11 contract | Point-in-time recovery is the only rollback. Requires PITR enabled and a verified restore drill beforehand |

## 11. Pre-requisites (CONFIRM)

- PITR or daily backups enabled on the production project, and a restore tested on staging.
- A staging project restored from production for rehearsal (PII handling approved).
- A named operator with production access to run approved migrations.
- A maintenance window for constraint validation on large tables (expected small for a pilot, NOT VERIFIED).
