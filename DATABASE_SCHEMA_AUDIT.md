# 03 — Database Schema Audit

**Source of truth for this audit:** the SQL files in the repository. The **live Supabase database was not inspected** (no connection, by instruction). Every statement about live state is **NOT VERIFIED**.

## 0. Which SQL is "the schema"? (CONFIRM)

| File | Contents | Idempotent? | Conflicts |
|---|---|---|---|
| `supabase/migrations/001_initial_schema.sql` | 16 tables, enums (bare `CREATE TYPE`), indexes, `activate_consultation` | Tables yes; **enums no** (re-run fails) | Has `idx_prescriptions_client` (`:270`) that `999` lacks |
| `supabase/migrations/002_activate_consultation_rpc.sql` | `is_admin`, `is_doctor`, `activate_consultation` (same body) | yes (`CREATE OR REPLACE`) | Duplicate of 001 and policies |
| `supabase/policies/rls_policies.sql` | RLS enable, helpers, all policies | **No** — bare `CREATE POLICY` fails on re-run | Not in `migrations/` folder |
| `supabase/migrations/003_setup_test_accounts.sql` | Writes `auth.users`, `auth.identities`, profiles, roles, doctor rows, pet; `cleanup_test_records` RPC | Partly | **Must never run in production** (see SECURITY_AUDIT SEC-02) |
| `supabase/migrations/999_full_production_deploy.sql` | 001 + 002 + policies + `handle_new_user()` (no trigger) | Enums guarded; policies **not** | Numbered 999 but is a "full deploy". Ordering against 003 is ambiguous |
| `supabase/seed.sql` | Demo rows reusing test-account UUIDs | `ON CONFLICT DO NOTHING` | Collides semantically with 003 |

There is no `supabase/config.toml`, so the Supabase CLI migration history table (`supabase_migrations.schema_migrations`) is probably absent. The files look as if they were pasted into the SQL editor (`supabaseService.ts:274` tells users to "Run … in the Supabase SQL Editor"). **The applied set must be determined by read-only introspection before any change** (see `DATABASE_MIGRATION_PLAN.md` §2).

## 1. Extensions and enums

| Object | Definition | Location |
|---|---|---|
| `uuid-ossp` | extension | `001:8` |
| `pgcrypto` | extension (for test passwords) | `003:15` |
| `user_role_enum` | `client, doctor, admin` | `001:26` |
| `consultation_status_enum` | `pending, active, completed, expired, rejected` | `001:88` |
| `payment_status_enum` | `pending, completed, failed, refunded` | `001:114` |
| `message_type_enum` | `text, image, file` | `001:141` |
| `medical_record_type_enum` | `clinical_note, lab_report, vaccination, surgery, discharge` | `001:185` |
| `notification_type_enum` | `consultation, message, prescription, system` | `001:216` |

Note: Postgres enums cannot have values removed and need care to rename. The target role model should use **tables, not enums** (see gap analysis).

## 2. Tables — columns, keys, constraints (VERIFIED from `001_initial_schema.sql`)

### 2.1 `profiles` (`001:13-21`)
| Column | Type | Null | Default |
|---|---|---|---|
| id | UUID PK | no | `uuid_generate_v4()` |
| full_name | VARCHAR(150) | no | |
| email | VARCHAR(255) **UNIQUE** | no | |
| phone | VARCHAR(30) | yes | |
| avatar_url | TEXT | yes | |
| created_at / updated_at | TIMESTAMPTZ | no | `timezone('utc', now())` |

**Findings:** (a) **No FK to `auth.users(id)`**, so orphan profiles are possible, and `seed.sql` creates profiles that have no auth user. (b) The default generates a random id, which would never match an auth user. (c) `email` is duplicated from `auth.users` and is user-editable (see SEC-09). (d) There is no `updated_at` trigger anywhere, so `updated_at` never changes unless the client sets it.

### 2.2 `user_roles` (`001:28-34`)
`id PK`, `user_id → profiles(id) ON DELETE CASCADE`, `role user_role_enum DEFAULT 'client'`, `UNIQUE(user_id, role)`.
**Findings:** Roles are global, not per organization. Multiple rows per user are allowed by design, but the frontend reads only one (`authService.ts:139-151`).

### 2.3 `pets` (`001:39-54`)
`owner_id → profiles(id) ON DELETE CASCADE`; NOT NULL `name, species, breed, gender, weight (>0)`; free-text `allergies`, `medical_notes`.
**Findings:** A pet has a single global owner and no clinic. `species` and `gender` are free VARCHAR, while the TS union types differ. **Cascade chain:** deleting a profile deletes pets, which deletes `medical_records` and `vaccinations` (both `ON DELETE CASCADE`, `001:189, 204`).

### 2.4 `doctor_profiles` (`001:59-70`)
`user_id UNIQUE → profiles(id) CASCADE`, qualification, specialization, `experience_years ≥ 0`, `consultation_fee NUMERIC(8,2) DEFAULT 50.00`, `is_active`.
**Findings:** `UNIQUE(user_id)` allows one doctor profile per person globally, which blocks multi-organization doctors. There is no registration or licence number, no branch, and no organization.

### 2.5 `doctor_availability` (`001:75-83`)
`doctor_id → doctor_profiles CASCADE`, `day_of_week VARCHAR(15)`, `start_time/end_time TIME`, `CHECK end>start`, `is_available`.
**Findings:** No branch, timezone, slot length, effective dates or exceptions. `day_of_week` is free text. The table is not used by the UI (`DoctorAvailabilityPage` uses mock data). There is no index on `doctor_id`.

### 2.6 `consultations` (`001:90-109`)
| Column | Type | Notes |
|---|---|---|
| client_id | → profiles **RESTRICT** | global person, not per-clinic client |
| doctor_id | → doctor_profiles RESTRICT | |
| pet_id | → pets RESTRICT | **no check that pet belongs to client** |
| consultation_reason | TEXT NOT NULL | |
| consultation_status | enum DEFAULT pending | |
| activated_at / expires_at / completed_at | TIMESTAMPTZ | |
| rejection_reason, preferred_time (VARCHAR 100), attachment_url | | |
| **CHECK** `check_seven_day_expiry` | `activated_at IS NULL OR expires_at = activated_at + 7 days` | ✔ strong invariant |

**Findings:** (a) It combines "request" and "clinical episode" in one row, with no appointment or slot concept. (b) Nothing transitions `active` to `expired`. Expiry is evaluated in RLS with `now()`, but the stored status goes stale. (c) The CHECK does not stop `activated_at` from being set to an arbitrary past or future value by a direct UPDATE (SEC-03). (d) There is no `activated_by`, `rejected_by` or `completed_by` column.

### 2.7 `consultation_payments` (`001:116-125`)
`consultation_id → consultations CASCADE`, amount, status enum, `gateway DEFAULT 'razorpay'`, transaction_id, paid_at. No UI writes to it. **Findings:** CASCADE from consultations would delete financial records. That is not acceptable for a ledger, so it should be RESTRICT. There is no index on `consultation_id`.

### 2.8 `chat_conversations` (`001:130-136`)
`consultation_id UNIQUE → consultations CASCADE`, `client_id → profiles CASCADE`, `doctor_id → doctor_profiles CASCADE`.
**Findings:** `client_id` and `doctor_id` are denormalized copies of the consultation's columns. If the consultation is reassigned, they diverge (and the UI reassign is local-only today). CASCADE deletes from consultations or profiles destroy clinical chat history. There are no indexes on `client_id` or `doctor_id`, which RLS uses.

### 2.9 `chat_messages` (`001:143-152`)
`conversation_id → chat_conversations CASCADE`, `sender_id → profiles RESTRICT`, `message_type`, `message_content TEXT NOT NULL`, `attachment_url`, `read_at`.
**Findings:** `read_at` can never be set because there is no UPDATE policy. Attachments are bare URLs with no storage object reference. Indexes are `(conversation_id)` and `(created_at)` separately; a composite `(conversation_id, created_at)` is preferable.

### 2.10 `prescriptions` (`001:157-167`) and `prescription_items` (`001:172-180`)
Rx: `consultation_id NOT NULL RESTRICT`, `pet_id`, `doctor_id`, `client_id` (RESTRICT), diagnosis, instructions, follow_up_date. Items: `prescription_id CASCADE`, medicine, dosage, frequency, duration, instructions.
**Findings:** `consultation_id NOT NULL` means a prescription cannot be issued for an in-clinic appointment that has no chat consultation. There is no consistency check that `pet_id`, `client_id` and `doctor_id` match the consultation. Prescriptions have no `updated_at`, versioning or void/amend workflow. There is no index on `doctor_id`.

### 2.11 `medical_records` (`001:187-197`)
`pet_id CASCADE`, `consultation_id SET NULL`, `doctor_id SET NULL`, `record_type` enum, `diagnosis VARCHAR(255) NOT NULL`, `notes TEXT NOT NULL`, `attachment_url`.
**Findings:** Records are destroyed when a pet is deleted (CASCADE). There is no `created_by`, amendment history or organization. There are no indexes on `doctor_id` or `consultation_id`.

### 2.12 `vaccinations` (`001:202-211`)
`pet_id CASCADE`, vaccine_name, administered_date, `next_due_date ≥ administered_date`, notes, `administered_by VARCHAR(150)`.
**Findings:** There is **no `created_at`**, and no `doctor_id` (free-text `administered_by`), batch or lot number, or organization. `next_due_date NOT NULL` forces a value for one-off vaccines.

### 2.13 `notifications` (`001:218-227`)
`user_id → profiles CASCADE`, title, message, type, is_read, link_url. **Findings:** No INSERT policy and no triggers, so nothing can create notifications under RLS. Index `(user_id, is_read)` ✔.

### 2.14 `reviews` (`001:232-240`)
`consultation_id UNIQUE CASCADE`, client, doctor, `rating 1..5`, text. **Findings:** Publicly readable (`USING (true)`). It is gameable through SEC-04. No index on `doctor_id`.

### 2.15 `audit_logs` (`001:245-253`)
`user_id → profiles SET NULL`, `action VARCHAR(100)`, `entity_type`, `entity_id VARCHAR(100)`, `details TEXT`.
**Findings:** No organization, no before/after snapshot, no request metadata, and not append-only (admins can INSERT arbitrary rows with any `user_id`, and `cleanup_test_records` deletes rows). Only one code path writes to it (`activate_consultation`).

## 3. Index inventory (VERIFIED `001:258-275`; `999:238-251` omits `idx_prescriptions_client`)

| Index | Table(cols) | Assessment |
|---|---|---|
| idx_pets_owner_id | pets(owner_id) | ✔ |
| idx_consultations_client / _doctor / _pet / _status / _expires_at | consultations | ✔; consider composite `(doctor_id, consultation_status)` |
| idx_chat_messages_conv, idx_chat_messages_created | chat_messages | replace with `(conversation_id, created_at)` |
| idx_prescriptions_consultation / _pet / _client* | prescriptions | *missing in 999 |
| idx_medical_records_pet | medical_records(pet_id) | ✔ |
| idx_vaccinations_pet | vaccinations(pet_id) | ✔ |
| idx_notifications_user | notifications(user_id,is_read) | ✔ |
| idx_audit_logs_user | audit_logs(user_id) | add `(entity_type, entity_id)`, `(created_at)` |
| **Missing FK indexes** | `doctor_availability.doctor_id`, `consultation_payments.consultation_id`, `chat_conversations.client_id/doctor_id`, `chat_messages.sender_id`, `prescriptions.doctor_id`, `medical_records.doctor_id/consultation_id`, `reviews.doctor_id/client_id` | used by RLS joins and FK checks |

## 4. Functions and RPCs

| Function | Security | Purpose | Assessment | Location |
|---|---|---|---|---|
| `is_admin()` | DEFINER, `search_path=public,pg_temp`, EXECUTE authenticated | global admin check | Sound mechanics; wrong model for multi-tenant | `002:8-25`, `rls_policies.sql:30-48`, `999:272-289` |
| `is_doctor()` | same | global doctor check | Used to grant **global** clinical read (SEC-05) | `002:28-45` |
| `activate_consultation(uuid)` | DEFINER, authenticated | lock → state check → caller check → set 7-day window → one conversation → audit | **Strong.** Needs org/branch scoping and permission-based check | `001:280-392`, `002:48-157`, `999:311-394` |
| `handle_new_user()` | DEFINER | profile + `client` role on signup | **No trigger attached** in repo. Auto-assigns a global client role, which conflicts with "clinic approval mandatory" | `999:397-419` |
| `cleanup_test_records(uuid[])` | DEFINER, authenticated (admin check inside) | deletes messages, conversations, consultations, audit rows | **Dangerous in production** (SEC-11) | `003:308-398` |

No `updated_at` triggers. No triggers of any kind attached in the repository.

## 5. RLS policy inventory (VERIFIED `supabase/policies/rls_policies.sql`; mirrored in `999`)

All 16 tables have RLS enabled (`:8-23`). None of the policies specify `TO authenticated`, so they all apply to the `anon` role as well.

| Table | SELECT | INSERT | UPDATE | DELETE | Key gaps |
|---|---|---|---|---|---|
| profiles | own, admin, **any active doctor's profile (incl. anon)** `:73-79` | own id or admin | own (no WITH CHECK) `:85-87` | — | anon sees doctor email/phone; email squatting |
| user_roles | own or admin | admin | admin | admin | global admin |
| doctor_profiles | active or own or admin | admin | own or admin `:125-127` | — | doctor edits own `is_active`, fee |
| doctor_availability | available or admin or own | ALL: admin or own (`:135-141`) | same | same | — |
| pets | owner, admin, doctor with any consultation on pet | ALL: owner or admin (`:159-161`) | same | same | client delete cascades records |
| consultations | client, admin, assigned doctor | `client_id = auth.uid()` **only** `:177-179` | admin or assigned doctor, **all columns** `:181-189` | — | SEC-03, SEC-04 |
| consultation_payments | admin, consultation client | ALL admin | | | — |
| chat_conversations | client, admin, doctor | **none** (RPC only) ✔ | none | none | — |
| chat_messages | participants or admin `:223-232` | participant + sender=self + active + `now()<expires_at` ✔ `:240-255` | none ✔ | none ✔ | admin global read |
| prescriptions | client, admin, prescribing doctor | admin or doctor_id is self `:274-282` | none | none | no consultation consistency |
| prescription_items | client of Rx, **any doctor**, admin `:284-292` | prescribing doctor or admin | none | none | SEC-05 |
| medical_records | admin, pet owner, **any doctor** `:308-316` | **any doctor** or admin `:318-320` | none | none | SEC-05, SEC-06 |
| vaccinations | admin, pet owner, **any doctor** `:322-330` | any doctor or admin | none | none | SEC-05, SEC-06 |
| reviews | **everyone incl. anon** `:339-341` | client with completed consultation | none | none | SEC-04 chain |
| notifications | own | **none** | own (no column restriction) | none | can't be created |
| audit_logs | admin | admin (any `user_id`) | none | none | forgeable |

## 6. Storage

**VERIFIED (repository):** no bucket DDL, no `storage.objects` policies, no `supabase.storage` usage. Attachments are `blob:` URLs (`ClientChat.tsx:76`) or placeholders (`FindDoctor.tsx:56`, `DoctorMedicalRecords.tsx:41`).
**NOT VERIFIED (live):** whether buckets exist in the project.

## 7. Realtime

**VERIFIED (repository):** no `ALTER PUBLICATION supabase_realtime ADD TABLE …`. The only subscription helper is unused and unfiltered (it listens to all `chat_messages` inserts, then re-queries per event, `supabaseService.ts:462-479`).
**NOT VERIFIED (live):** publication membership.

## 8. Data-quality hazards already present in the design

1. Seed and test accounts share UUIDs (`seed.sql:10-15` vs `003:87,120,153,186`). If both ran, profile names were overwritten by 003 (`ON CONFLICT DO UPDATE`).
2. `verify_remote_supabase.cjs:100-101` creates real auth users `client.test.<timestamp>@gmail.com` with a fixed password and leaves pets and consultations behind (no cleanup).
3. `verify_remote_supabase.cjs:277-294` tries an **anon** upsert of a doctor profile if none exist. RLS should block it, but the attempt shows the intent to write production data from scripts.
4. `consultations` stuck at `active` after `expires_at`.
5. `chat_messages.attachment_url` values that are `blob:` URLs (if any were sent in DB mode).
6. Rows created during manual testing with `[CONTROLLED-TEST]` markers.

All of the above need a **read-only inventory** before migration (see `DATABASE_MIGRATION_PLAN.md`).
