# PET CONNECT — PostgreSQL & Supabase Database Architecture

## 1. Entity Relationship (ER) Diagram

```
                 ┌────────────────────────────────┐
                 │            PROFILES            │
                 │ ────────────────────────────── │
                 │ PK  id (UUID)                  │
                 │     full_name (VARCHAR)        │
                 │     email (VARCHAR, UNIQUE)    │
                 │     phone (VARCHAR)            │
                 │     avatar_url (TEXT)          │
                 │     created_at (TIMESTAMPTZ)   │
                 └──────────────┬─────────────────┘
                                │ 1
                                │
        ┌───────────────────────┼───────────────────────────┐
        │ 1                     │ 1                         │ 1
        ▼ *                     ▼ 1                         ▼ *
┌────────────────┐     ┌─────────────────────┐     ┌────────────────┐
│   USER_ROLES   │     │   DOCTOR_PROFILES   │     │      PETS      │
│ ────────────── │     │ ─────────────────── │     │ ────────────── │
│ PK id          │     │ PK id               │     │ PK id          │
│ FK user_id     │     │ FK user_id          │     │ FK owner_id    │
│    role        │     │    qualification    │     │    name        │
└────────────────┘     │    specialization   │     │    species     │
                       │    consultation_fee │     │    breed       │
                       │    is_active        │     │    weight      │
                       └──────────┬──────────┘     │    allergies   │
                                  │ 1              └────────┬───────┘
                                  │                         │ 1
                                  │         ┌───────────────┘
                                  ▼ *       ▼ *
                       ┌─────────────────────────────────────┐
                       │            CONSULTATIONS            │
                       │ ─────────────────────────────────── │
                       │ PK  id (UUID)                       │
                       │ FK  client_id ──────> PROFILES      │
                       │ FK  doctor_id ──────> DOCTOR_PROF.  │
                       │ FK  pet_id    ──────> PETS          │
                       │     consultation_reason (TEXT)      │
                       │     consultation_status (ENUM)      │
                       │     activated_at (TIMESTAMPTZ)      │
                       │     expires_at (TIMESTAMPTZ) ───────┼──> (activated_at + 7 days)
                       │     completed_at (TIMESTAMPTZ)      │
                       └──────────┬──────────────────────────┘
                                  │ 1
           ┌──────────────────────┼───────────────────────┐
           │ 1                    │ 1                     │ 1
           ▼ 1                    ▼ *                     ▼ 1
┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐
│ CHAT_CONVERSATIONS  │  │    PRESCRIPTIONS    │  │CONSULTATION_PAYMENTS│
│ ─────────────────── │  │ ─────────────────── │  │ ─────────────────── │
│ PK id               │  │ PK id               │  │ PK id               │
│ FK consultation_id  │  │ FK consultation_id  │  │ FK consultation_id  │
│ FK client_id        │  │ FK pet_id           │  │    amount           │
│    created_at       │  │ FK doctor_id        │  │    payment_status   │
└──────────┬──────────┘  │    diagnosis        │  │    gateway (future) │
           │ 1           │    follow_up_date   │  │    transaction_id   │
           ▼ *           └──────────┬──────────┘  └─────────────────────┘
┌─────────────────────┐             │ 1
│    CHAT_MESSAGES    │             ▼ *
│ ─────────────────── │  ┌─────────────────────┐
│ PK id               │  │ PRESCRIPTION_ITEMS  │
│ FK conversation_id  │  │ ─────────────────── │
│ FK sender_id        │  │ PK id               │
│    message_type     │  │ FK prescription_id  │
│    message_content  │  │    medicine_name    │
│    read_at          │  │    dosage, freq     │
└─────────────────────┘  │    duration, instr  │
                         └─────────────────────┘
```

---

## 2. Normalized Design & Structural Improvements

In accordance with Section 6 of the Master Specification, the initial database design incorporates key normalization enhancements:

1. **Normalized Multi-Item Prescriptions (`prescriptions` + `prescription_items`)**:
   - Rather than storing medications as un-queryable JSON or comma-separated strings, `prescription_items` normalizes each medication line item (name, dosage, frequency, duration, instructions).
   - This allows strict clinical posology auditing and drug allergy cross-referencing.

2. **Precise 7-Day Access Window Constraint**:
   - The PostgreSQL schema enforces that `expires_at = activated_at + INTERVAL '7 days'`. Simple calendar day arithmetic is prohibited; exact timestamps protect against premature closure across timezone boundaries.

3. **Row-Level Security (RLS) Chat Lockdown Policy**:
   - The RLS policy for `chat_messages` enforces:
     ```sql
     AND c.consultation_status = 'active'
     AND (c.expires_at IS NULL OR now() <= c.expires_at)
     ```
   - Once a consultation expires, clients can no longer insert messages, but prior chat history remains permanently queryable via `SELECT`.

4. **Future-Proof Payment Gateway Ledger (`consultation_payments`)**:
   - Retains clean transactional fields (`amount`, `payment_status`, `gateway`, `transaction_id`) ready for Razorpay or Stripe webhooks without introducing dummy/fake transaction UI.

5. **Performance Indexing**:
   - Foreign key indexes (`idx_consultations_client`, `idx_consultations_doctor`, `idx_consultations_pet`) and composite indexes (`idx_notifications_user(user_id, is_read)`) ensure fast execution times under scale.
