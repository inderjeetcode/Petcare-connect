# 09 — Testing and Release Plan

## 1. Current test reality (VERIFIED)

| Asset | Claimed | Actual |
|---|---|---|
| `supabase/tests/security_tests.sql` | "19 verified scenarios" (`AdminSettings.tsx:544-549`) | No `SET ROLE authenticated`, so RLS is bypassed when run as owner. FK failure expected at A4 (`:92`, un-seeded `c2000000-…`). **Result: NOT VERIFIED, not counted as passed** |
| `scripts/test_controlled_rpc.cjs` | 12-step RPC suite | Plausible assertions, but it runs against **production**, depends on known-password accounts from 003 and the destructive cleanup RPC. **Not run; NOT VERIFIED** |
| `scripts/verify_remote_supabase.cjs` | Live verification | Unconditional PASS lines (`:347-348`, `:378`); writes prod data. **Not a test** |
| Unit / component / E2E tests | — | **None** |
| Type-check | `npm run lint` | Not run in this audit; **NOT VERIFIED** |
| CI | — | **None** |

**No test was executed during this audit, and no result is reported as passed.**

## 2. Environments (PROPOSED)

| Env | Purpose | Data | Who can deploy |
|---|---|---|---|
| Local | Dev and unit/DB tests | `supabase start` + fixture seed | Developers |
| CI | Automated gates | Ephemeral local Supabase in container | CI |
| Staging | Migration rehearsal, UAT, pen-test | Restored prod snapshot (PII approval) **or** synthetic | Release manager |
| Pilot (prod) | MaxPetZ Hospitals | Real | Release manager + approval |

The production project URL must **never** be a code fallback (SEC-13).

## 3. Test layers

### 3.1 Database tests — pgTAP via `supabase test db` (highest priority)
Each test sets identity explicitly:
```sql
-- illustrative
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :uid, 'role','authenticated')::text, true);
```
Mandatory suites:

| Suite | Cases (minimum) |
|---|---|
| **Tenant isolation matrix** | For every tenant table × {SELECT, INSERT, UPDATE, DELETE} × {member of A, member of B, client of A, client of B, platform admin, anon}: rows of org A are never visible or writable by B |
| Composite FK | Inserting a child with a parent from another org fails with `23503` even as service role |
| Roles and permissions | Each system role gets exactly its permission set; suspended membership has zero access |
| Org onboarding | Application → approve creates org, branch and owner membership atomically; reject leaves no org; non-platform users cannot approve |
| Clinic join | Request → pending (no data access) → approve (access) → suspend (no access) |
| Appointments | Requested doesn't block a slot; confirm validates schedule, branch and assignment; **concurrent confirm of overlapping slots → exactly one succeeds** (two sessions with `dblink` or the app-level test in 3.3); exclusion error mapped |
| Consultation window | Activation sets `expires_at = activated_at + 7 days` exactly; cannot be altered afterwards (trigger); message insert allowed at `expires_at - 1s`, rejected at `expires_at`; expired chat readable by participants; non-participants never read |
| Clinical writes | Only via RPC; `doctor_id`/`created_by` forced to caller; cross-org pet rejected |
| Deletion safety | Client cannot delete pets with clinical history; FK RESTRICT on clinical tables |
| Audit | Every RPC writes exactly one audit row with org and actor; API roles cannot insert, update or delete audit rows |
| Storage | Object under `org_A/…` unreadable by org B members; signed URL generation requires permission |
| Regression for SEC-01..24 | One test per finding proving the fix |

### 3.2 Unit and component tests — Vitest + React Testing Library
- Guards: routes render or redirect per session, membership and permission fixture.
- Permission hook, workspace switcher, slot picker, chat expiry banner (server-time driven), error mapping (`23P01` → "slot no longer available", `42501` → forbidden).
- Repository functions with MSW-mocked PostgREST and RPC responses.

### 3.3 Integration tests — Vitest against local Supabase
- Real JWTs for fixture users (created by local seed using the Auth admin API inside CI only).
- Concurrency: fire N parallel `confirm_appointment` calls for overlapping slots; assert one success.
- Realtime: message inserted by A delivered to B only within the same conversation.

### 3.4 End-to-end — Playwright (staging)
Critical journeys per portal:
1. Clinic self-registration → Platform Owner approves → owner logs in → creates branch → invites doctor.
2. Client signs up → requests to join MaxPetZ → admin approves → adds pet → requests appointment → front desk confirms → doctor activates consultation → chat → prescription → client views and prints.
3. Day-8 expiry (clock-controlled in staging via DB function override or seeded timestamps): input disabled, history visible.
4. Cross-tenant attempt with a second org: URL tampering returns 404/403 and no data.

### 3.5 Non-functional
- **Security:** OWASP ASVS L2 checklist; dependency audit (`npm audit`), secret scanning (gitleaks) in CI; Supabase Advisors (security and performance) reviewed before each release; an external pen-test before pilot go-live (CONFIRM budget).
- **Performance:** RLS query plans (`EXPLAIN ANALYZE` under `authenticated`) for top 10 screens; target p95 < 300 ms API at pilot volumes.
- **Accessibility:** axe checks on key pages; WCAG 2.1 AA target.
- **Backup/restore drill:** restore staging from prod backup and run the reconciliation report.

## 4. CI gates (PROPOSED)

| Gate | Blocking |
|---|---|
| Type-check (`tsc --noEmit`, strict) | yes |
| Lint (ESLint + react-hooks) | yes |
| Unit/component tests | yes |
| `supabase db reset` + migrations apply cleanly from zero | yes |
| pgTAP suites incl. tenant isolation matrix | yes |
| Integration tests | yes |
| gitleaks, npm audit (high/critical) | yes |
| Build | yes |
| E2E on staging | yes for release branches |

## 5. Release plan

### 5.1 Release train
- Trunk-based with short-lived branches; every DB change is a timestamped migration and a matching PR.
- Feature flags (DB table `feature_flags` or env) for: new auth routes, appointment booking, platform portal, legacy UI fallback.

### 5.2 Per-release checklist
1. Migration rehearsal on staging (from a fresh prod snapshot) with a reconciliation report attached to the PR.
2. Down-migration tested on staging.
3. Backup verified less than 24 h old; PITR window confirmed.
4. Approval recorded (product owner + technical owner).
5. Deploy DB migration, then the frontend (expand first, contract later; frontend must tolerate both states during the window).
6. Post-deploy smoke tests (read-only, synthetic test org in prod, **never** real-patient writes).
7. Monitor errors (frontend error tracking, Postgres logs, Advisors) for 24 h.

### 5.3 MaxPetZ pilot rollout
| Step | Exit criterion |
|---|---|
| P0 Internal staging UAT with MaxPetZ staff accounts | All E2E journeys pass; zero open High/Critical security issues |
| P1 Pilot with one branch, staff only | 1 week, no data-integrity incidents |
| P2 Invite existing clients (join approvals) | Join flow > 95% success; support playbook ready |
| P3 All MaxPetZ branches | Performance within targets |
| P4 Open self-registration for other clinics | Platform Owner review process documented |

### 5.4 Rollback triggers
Any cross-tenant data exposure, audit write failures, chat window violations, or migration reconciliation mismatch: freeze releases, roll back the frontend flag, apply the down-migration if safe, and start the incident process.
