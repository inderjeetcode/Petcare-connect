# PET CONNECT — Historical MaxPetZ Branch & Data Mapping Plan

**Document Status:** Phase 1 Data Governance Plan  
**Core Rule:** **NEVER invent, guess, or fabricate a branch mapping.** Every historical row assigned to a MaxPetZ branch must trace directly to a verified source record or an explicit signed-off clinic mapping table produced after Phase 0 read-only discovery.

---

## 1. Purpose & Confirmed Tenancy Scope

Confirmed architectural rules for existing data:
- **Initial Pilot Organization:** **MaxPetZ** (`slug = 'maxpetz'`).
- **Tenancy Attribution:** Existing verified clinical production rows belong to MaxPetZ.
- **Branch Provenance Mandate:** Current tables (`profiles`, `pets`, `doctor_profiles`, `consultations`, `medical_records`, `vaccinations`, `prescriptions`, `audit_logs`) contain **no `organization_id` and no `branch_id` columns** (`DATABASE_SCHEMA_AUDIT.md`). Therefore, branch membership cannot be inferred from schema columns alone and **must not be fabricated**.

---

## 2. Phase 0 Read-Only Discovery Prerequisites (Unexecuted)

Before any backfill runs in staging or production, an authorized operator must execute the read-only discovery inventory (`DATABASE_MIGRATION_PLAN.md` §2) and collect clinic source-of-truth records:

1. **Database Object & Row Inventory (Read-Only):**
   - Exact list of `profiles`, `user_roles`, `doctor_profiles`, `pets`, `consultations`, `chat_conversations`, `chat_messages`, `prescriptions`, `medical_records`, `vaccinations`, `consultation_payments`, `reviews`, and `audit_logs`.
2. **Anomaly & Test-Artifact Detection:**
   - Presence of `003_setup_test_accounts.sql` users (`*@petconnect.com`, `vet.tester.petconnect@gmail.com`).
   - Presence of `verify_remote_supabase.cjs` generated users (`client.test.<ts>@gmail.com`) and `Automated Test:%` / `[CONTROLLED-TEST]` consultations.
   - Presence of `supabase/seed.sql` fixed UUIDs (`c1000000-...`, `d1000000-...`..`d4000000-...`, `a1000000-...`).
   - Orphan `profiles` without matching `auth.users` rows.
   - Stale consultations (`consultation_status = 'active' AND expires_at < now()`).
   - Broken chat/consultation attachments (`blob:` or `example.com`).

---

## 3. Verified Source Records Required Before Backfill

To backfill `branches`, `doctor_branch_assignments`, and `consultations.branch_id` / `prescriptions.branch_id` without inventing data, MaxPetZ operations must provide signed source records:

| Data Entity | Required Verified Source | Mapping Rule |
|---|---|---|
| **MaxPetZ Branches (`branches`)** | Official MaxPetZ branch directory (clinic code, legal/display name, full address, contact phone, local IANA timezone) | Create **only** branches confirmed by MaxPetZ leadership. Do **not** invent placeholder branches without written approval. |
| **Platform Owner vs Org Admin (`platform_admins` vs `organization_memberships`)** | Explicit signed roster mapping each `user_roles (role='admin')` UUID/email to Platform Owner, MaxPetZ `org_owner` / `org_admin`, or revoked test account | Never promote all existing `'admin'` rows blindly into `platform_admins` or `org_owner`. |
| **Doctors & Branch Assignments (`doctor_profiles`, `doctor_branch_assignments`)** | Official MaxPetZ clinician roster mapping each existing `doctor_profiles.id` / `user_id` to verified veterinary registration number and active branch code(s) | Doctors may be assigned to **one or multiple branches** in MaxPetZ per verified roster. Unassigned doctors remain without branch assignments until confirmed. |
| **Historical Consultations & Prescriptions (`branch_id`)** | Clinic appointment/EMR dispatch logs, billing/booking sheets, or doctor-at-single-branch uniqueness | **Case A (Deterministic):** If an existing doctor works at **only one** verified MaxPetZ branch, their historical consultations trace deterministically to that branch.<br>**Case B (Multi-Branch Doctor with Clinic Source Log):** Match by `(doctor_id, consultation_id / created_at / pet / client)` against MaxPetZ's verified operational log.<br>**Case C (Multi-Branch Doctor with Ambiguous/Unverified Source):** **DO NOT GUESS.** Keep `branch_id` nullable or route to a quarantined manual-resolution queue until clinic staff reconcile from physical/EMR records. |
| **Clinic Clients & Pets (`clinic_clients`, `pets`, `pet_guardians`)** | Existing `pets.owner_id` and `consultations.client_id` cross-checked against MaxPetZ client registry | Every real profile that owns a pet or has a consultation in MaxPetZ maps to `clinic_clients (organization_id = maxpetz_id, status = 'approved')`. Signed-up accounts with zero activity remain unlinked or pending per D-07 confirmation. |

---

## 4. Handling Ambiguity, Quarantine, & Non-Production Artifacts

### 4.1 Schema Accommodations for Uninvented Branch History
- For **new** consultations/appointments created after Phase 2 switchover, `branch_id NOT NULL` is enforced by RPCs and validated constraints (`appointment_id NOT NULL`, `branch_id NOT NULL`).
- For **historical** pre-multi-tenant rows where clinic source logs cannot deterministically identify one of multiple branches:
  - Prefer keeping `consultations.branch_id` and `prescriptions.branch_id` nullable **only for legacy rows (`is_legacy_unmapped_branch = true` or `appointment_id IS NULL`)**, OR assigning only after MaxPetZ signs off a formal remediation spreadsheet mapping `consultation_id -> branch_code`.
  - **Prohibited:** Random assignment, picking `MIN(branch_id)` silently, or fabricating synthetic `appointments` rows (`D-10` — historical consultations must keep `appointment_id = NULL` rather than fabricating fake appointments).

### 4.2 Test Artifacts, Seed Collisions, & Data Hygiene Queue
Every non-clinical or defective row uncovered during Phase 0 discovery is logged in a signed **Data Remediation Manifest** before backfill:

| Artifact Category | Detection Signature | Required Operator Decision & Handling |
|---|---|---|
| **Migration `003` test accounts** (`SEC-02`) | `client.test@petconnect.com`, `doctor.assigned@petconnect.com`, `doctor.other@petconnect.com`, `admin.test@petconnect.com`, `vet.tester.petconnect@gmail.com` | Disable/rotate immediately in Auth; delete/archive rows only under written sign-off. **Never migrate into active MaxPetZ staff/client rosters.** |
| **Script test users** (`SEC-14`) | `client.test.<timestamp>@gmail.com`, `Automated Test:%` | Exclude from MaxPetZ backfill; archive or purge per owner approval. |
| **Seed fixed UUIDs** (`seed.sql`) | `c1000000-...`, `d1000000-...`, `70000000-...`, `80000000-...`, `90000000-...` | Verify whether rows are demo fixtures or real data (check email/names in Phase 0). Never mix demo records into live MaxPetZ charts. |
| **Orphan profiles** (`D-08`) | `profiles` with no `auth.users(id)` | Quarantine before adding FK `profiles.id -> auth.users(id)`. Convert real walk-in owners to `clinic_clients (user_id = NULL)` only if verified as MaxPetZ patients. |
| **Stale active consultations** (`D-09`) | `consultation_status = 'active' AND expires_at < now()` | Normalize `consultation_status = 'expired'` with an explicit `migration_runs` audit entry (already expired by time). |
| **Broken `blob:` / placeholder attachments** (`D-12`) | `attachment_url LIKE 'blob:%' OR '%example.com%'` | Null out unusable client-local URLs while preserving original message text and recording audit note. |

---

## 5. Reconciliation & Sign-Off Gate

Backfill to MaxPetZ production is blocked until all five artifacts are signed by both Engineering and MaxPetZ Clinic Operations:
1. Phase 0 Read-Only Inventory Report (verified row counts and checksums).
2. Signed MaxPetZ Branch Master List (`code`, `name`, `timezone`, `address`).
3. Signed Staff & Multi-Branch Doctor Assignment CSV (`user_id` / `email`, roles, `branch_codes`, registration number).
4. Deterministic Historical Branch Mapping CSV (`consultation_id` → verified `branch_code`, or explicit quarantine flag for ambiguous rows).
5. Test-Artifact & Orphan Disposition Approval (`D-03`, `D-08`, `D-11`, `D-15`).
