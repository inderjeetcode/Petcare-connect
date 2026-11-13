# Pet Connect — Veterinary Healthcare Platform

Pet Connect is a production-oriented veterinary healthcare platform connecting pet owners with veterinary doctors and clinic administrators with consultation workflows, digital prescriptions, medical records, and an enforced 7-day consultation chat access model.

---

## 1. Key Platform Features

### Three Role-Specific Portals
1. **Client Portal (Pet Owners)**:
   - Dashboard with active 7-day consultations and pet health metrics.
   - Pet Management (Profile, species, breed, DOB, weight, allergens, chronic conditions).
   - Find a Specialist Doctor directory with credentials, charges, and booking modal.
   - Consultation management with live countdown timers.
   - WhatsApp-style chat interface with attachment support.
   - Digital Prescriptions viewer with printable official clinical prescription format.
   - Medical Records & longitudinal vaccination timeline.
   - Notifications center, profile management, and settings.

2. **Doctor Portal (Veterinary Surgeons & Specialists)**:
   - Clinical Dashboard with triage caseload, active chats, and issued prescriptions.
   - Consultation Triage Queue with 1-click case approval (starts 7-day timer) or decline with clinical rationale.
   - Live Patient Chat with 7-day countdown and direct prescription generation link.
   - Digital Prescription Writer with multi-drug posology configuration (dosage, frequency, duration).
   - Medical Record Logger with attachments (lab reports, radiographs, surgical notes).
   - Assigned Patients Directory.
   - Weekly Clinic Availability scheduler.
   - Doctor Credentials profile and clinical settings.

3. **Admin Portal (Hospital Administration)**:
   - Master Dashboard with 7 critical platform metrics and live PostgreSQL audit logs.
   - Client Management with account status and pet verification.
   - Doctor Roster Management with credential auditing and activation/deactivation.
   - Consultation Supervision & Doctor Reassignment.
   - Pet Directory.
   - Prescription and Medical Record Audit trails.
   - Compliant Payment Ledger placeholder (ready for Razorpay/Stripe webhooks).
   - Clinical Analytics & Reports (caseload distribution, top diagnoses, resolution rate).
   - System settings, RLS configuration status, and demo reset.

---

## 2. 7-Day Consultation Chat Business Logic

The platform enforces a strict 7-day consultation access window:
1. **Clinical Request**: Client selects a pet, describes symptoms, and submits a triage request.
2. **Approval**: An authorized doctor approves the request.
3. **Activation**: `activated_at` is set to the current UTC timestamp, and `expires_at = activated_at + 7 days`.
4. **Live Chat**: The client and doctor communicate via WhatsApp-style chat while `now < expires_at`. A live countdown displays remaining time (`X days Y hours left`).
5. **Lockdown upon Expiry**: When `now >= expires_at`, the chat message input is disabled and replaced with an alert banner. Past messages remain permanently accessible in read-only mode for medical auditability.

---

## 3. Technology Stack

- **Frontend**: React 19, Vite, Tailwind CSS v4, React Router DOM, Lucide React icons.
- **Database Architecture**: PostgreSQL, Supabase, Row Level Security (RLS) policies.
- **State Engine**: Centralized reactive AppContext with local storage persistence and pre-populated sample clinical cases.

---

## 4. Database Architecture & Migrations

All SQL files are organized in the `supabase/` directory:
- `supabase/migrations/001_initial_schema.sql`: 16 normalized tables, UUID primary keys, check constraints, foreign keys, and indexes.
- `supabase/policies/rls_policies.sql`: Row Level Security policies enforcing data privacy and blocking chat inserts on expired consultations.
- `supabase/seed.sql`: Realistic veterinary demonstration records.
- `docs/ER_DIAGRAM.md`: Entity relationship diagrams and design notes.

---

## 5. Quick Start & Setup

```bash
# 1. Install dependencies
npm install

# 2. Run development server (Vite on port 3000)
npm run dev

# 3. Build for production
npm run build
```

Switch between the **Client Portal**, **Doctor Portal**, and **Admin Portal** using the persistent role switcher bar in the top navigation header.
