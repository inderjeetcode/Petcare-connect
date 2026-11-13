# 06 — Existing → Target Schema Mapping

Action legend: **KEEP** (unchanged) · **EXTEND** (add columns/constraints, same table) · **NEW** · **REPLACE** (new table plus backfill, old table frozen) · **DEPRECATE** (read-only, dropped in the contract phase) · **DROP** (only after sign-off).
"Backfill source" says where historical values come from. **Values marked CONFIRM must not be guessed.**

## 1. Table-level mapping

| Existing table | Target | Action | Backfill / notes |
|---|---|---|---|
| — | organizations | NEW | Insert MaxPetZ Hospitals **only after confirmation** that historical data belongs to it (D-01) |
| — | organization_applications | NEW | None (MaxPetZ can be created directly as pre-approved, recorded with an audit note) |
| — | branches | NEW | MaxPetZ branch list (D-02) |
| — | platform_admins | NEW | From `user_roles.role='admin'` **only for users confirmed as Platform Owner** (D-04) |
| — | organization_memberships, membership_roles | NEW | From `user_roles` (doctor → doctor role; admin → org_admin if confirmed) and `doctor_profiles` |
| — | organization_roles, permissions, role_permissions | NEW | Static seed through migration |
| user_roles | — | DEPRECATE → DROP | Keep read-only until the new auth layer is live; drop in contract phase |
| profiles | profiles | EXTEND | Add FK `id → auth.users(id)` **after** orphan check (D-08); stop exposing `email` writes; add `updated_at` trigger |
| — | clinic_clients | NEW | One row per (org, profile) for every profile that owns a pet or appears as `consultations.client_id` (D-07 for users without activity) |
| pets | pets | EXTEND | `organization_id` ← org of the clinic that served the pet (D-01/D-06); `archived_at`; keep `owner_id` temporarily |
| — | pet_guardians | NEW | `(pet_id, clinic_client_id of owner, is_primary=true)` |
| doctor_profiles | doctor_profiles | EXTEND | `organization_id` (D-05); swap `UNIQUE(user_id)` → `UNIQUE(organization_id,user_id)`; add `UNIQUE(id,organization_id)` |
| — | doctor_branch_assignments | NEW | Per doctor → branch list (D-05) |
| doctor_availability | doctor_schedules (+ doctor_schedule_exceptions) | REPLACE | Copy rows if any exist, mapping `day_of_week` text → ISO weekday, `branch_id` (D-05). Freeze old table |
| — | appointments, appointment_status_history | NEW | **No historical backfill.** Existing consultations were never appointments (D-10) |
| consultations | consultations | EXTEND | `organization_id`, `branch_id` (D-02), `clinic_client_id` (from client_id), `appointment_id NULL`, `activated_by` (from audit_logs `ACTIVATE_CONSULTATION` where present, else NULL), normalize stale `active` → `expired` (D-09) |
| consultation_payments | consultation_payments | EXTEND | `organization_id` from consultation; FK → RESTRICT. Expected empty (verify) |
| chat_conversations | chat_conversations | EXTEND | `organization_id` from consultation |
| chat_messages | chat_messages | EXTEND | `organization_id` from conversation; `blob:` attachment URLs → NULL with an audit note (D-12) |
| — | message_attachments / attachments | NEW | None (no stored files exist) |
| prescriptions | prescriptions | EXTEND | `organization_id`, `branch_id` from consultation; `status='issued'` |
| prescription_items | prescription_items | EXTEND | `organization_id` from parent |
| medical_records | medical_records | EXTEND | `organization_id` from pet; `created_by` = doctor's user where `doctor_id` set, else NULL; FK pet → RESTRICT |
| vaccinations | vaccinations | EXTEND | `organization_id` from pet; `created_at` = NULL-safe default (**do not fabricate**: allow NULL for historical rows or set to migration time with `backfilled=true`, D-13) |
| notifications | notifications | EXTEND | `organization_id` NULL for historical |
| reviews | reviews | EXTEND / FREEZE | `organization_id` from consultation; review authenticity questionable (SEC-04), D-14 |
| audit_logs | audit_logs | EXTEND | `organization_id` from entity where resolvable; rows from test runs flagged (D-11) |

## 2. Column-level mapping (key tables)

### consultations
| Existing column | Target column | Transform |
|---|---|---|
| id | id | keep |
| client_id (profile) | client_id (kept, deprecated) + **clinic_client_id** | lookup `clinic_clients(organization_id, user_id=client_id)` |
| doctor_id | doctor_profile_id (rename later; keep name in v1) | keep |
| pet_id | pet_id | keep; composite FK (pet_id, organization_id) |
| consultation_reason | reason | keep name in v1 |
| consultation_status | status | keep enum; add values only if needed (`cancelled`) |
| activated_at / expires_at | same | keep; immutability trigger |
| completed_at | same | keep |
| rejection_reason | same | keep |
| preferred_time (free text) | — | keep read-only; superseded by appointments |
| attachment_url | → attachments row | only if a real storage object exists; placeholders `https://example.com/*` → NULL |
| — | organization_id, branch_id, appointment_id, activated_by, rejected_by, completed_by | new |

### pets
| Existing | Target | Transform |
|---|---|---|
| owner_id | pet_guardians(primary) | create guardian row; keep column until contract phase |
| species / gender (free text) | same with CHECK or lookup | validate distinct values first (inventory query) |
| allergies / medical_notes | same | keep (clinical text) |
| — | organization_id, archived_at, created_by | new |

### doctor_profiles
| Existing | Target | Transform |
|---|---|---|
| user_id UNIQUE | user_id + organization_id, UNIQUE(org,user) | add column, backfill, swap constraint in one migration with lock-timeout |
| consultation_fee | keep (informational; billing later) | |
| is_active | keep; admin-only via RPC | |
| — | registration_number, display_name | new (nullable; collect later) |

### audit_logs
| Existing | Target | Transform |
|---|---|---|
| user_id | actor_user_id | copy |
| action / entity_type / entity_id | same | keep |
| details (text) | details + before/after jsonb | keep text; new columns NULL for history |
| — | organization_id, request_id, ip (if captured by edge function) | new |

## 3. Enum mapping

| Enum | Target | Action |
|---|---|---|
| user_role_enum | `organization_roles` table + `platform_admins` | Deprecate with `user_roles` |
| consultation_status_enum | keep | Possibly add `cancelled` (CONFIRM) |
| — | `appointment_status` (new enum or CHECK) | `requested, confirmed, declined, cancelled, checked_in, completed, no_show` |
| — | `membership_status`, `clinic_client_status`, `org_status`, `application_status` | New (CHECK constraints preferred over enums for easier evolution) |
| payment_status_enum, message_type_enum, medical_record_type_enum, notification_type_enum | keep | Extend notification types (`appointment`, `membership`, `join_request`) |

## 4. Function mapping

| Existing | Target | Action |
|---|---|---|
| `is_admin()` | `app.is_platform_admin()` + `app.has_org_permission()` | Replace usages; drop in contract phase |
| `is_doctor()` | `app.has_org_permission(org,'…')` | Replace; drop |
| `activate_consultation(uuid)` | same signature, extended body (org permission, branch, audit with org) | Keep the name for API stability |
| `handle_new_user()` | `app.handle_new_user()`: profile only, **no role** | Replace; attach trigger explicitly (verify live first) |
| `cleanup_test_records(uuid[])` | — | **DROP** in first remediation migration (CONFIRM) |

## 5. Policy mapping

Every existing policy is **replaced**, not edited in place. New policies are created with new names under a feature flag window, then old policies are dropped in the same transaction per table to avoid an open window (details in `DATABASE_MIGRATION_PLAN.md` §6).

## 6. Data-mapping decisions requiring human confirmation

| ID | Decision | Why it can't be inferred |
|---|---|---|
| D-01 | Do **all** existing rows belong to MaxPetZ Hospitals? | No tenant column exists; the repo never mentions MaxPetZ |
| D-02 | Which MaxPetZ branch does each historical consultation, pet and doctor belong to? Is a single "Main/Legacy" branch acceptable? | No location data stored |
| D-03 | Are the seed rows (`seed.sql`: Sarah Jenkins, Drs. Vance/Rostova/Chen/Patel, pets Barnaby/Cleo/Pip) present in the live DB? If so: delete, quarantine in a `demo` org, or keep? | Seed and real rows are indistinguishable except by fixed UUIDs |
| D-04 | Which existing `admin` users become **Platform Owner** vs **MaxPetZ org admin** vs neither? | One global role today |
| D-05 | For each existing doctor: organization, branches, registration number | Not stored |
| D-06 | If a pet owner has consulted doctors who end up in different orgs (only relevant if D-01 = "no"): duplicate the pet per org? | Requirement 7 says separate records per clinic |
| D-07 | Registered users with no pet or consultation: create `clinic_clients` in MaxPetZ (approved), as pending requests, or not at all? | Clinic approval is mandatory going forward |
| D-08 | Profiles without a matching `auth.users` row (seed, scripts): delete, keep as walk-in `clinic_clients` with `user_id NULL`, or archive? | Needed before adding the FK |
| D-09 | Consultations with status `active` and `expires_at < now()`: set to `expired` (recommended), with an audit entry? | Changes stored state |
| D-10 | Should historical consultations get synthetic appointments? (Recommendation: **no**) | Would fabricate data |
| D-11 | Test artefacts in live DB: the `*@petconnect.com` users, `client.test.<ts>@gmail.com` users from scripts, `[CONTROLLED-TEST]` consultations, related audit rows. Delete, archive or keep? | Destructive, owner decision |
| D-12 | Chat messages whose `attachment_url` is `blob:` or `example.com`: null out (keep text) or leave? | Alters clinical record |
| D-13 | Vaccinations have no `created_at`. Leave NULL for history or stamp migration time with a `backfilled` flag? | Avoid fabricating timestamps |
| D-14 | Reviews: keep, hide, or purge given SEC-04? | Authenticity unknown |
| D-15 | `vet.tester.petconnect@gmail.com`: whose account is it and should it exist? | Not explained in repo |
| D-16 | Who may see expired chats: participants only, or also org admins (with audit)? | Policy choice |
| D-17 | Clinical record visibility within an org: all doctors in the org, doctors at the same branch, or treating doctors only? | Policy choice |
