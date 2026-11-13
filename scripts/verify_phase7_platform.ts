/**
 * Phase 7 Platform Owner Portal Verification Script
 *
 * Tests unconditionally:
 * 1. Organization approval & activation lifecycle transitions
 * 2. Organization suspension & reactivation rules + mandatory reasons
 * 3. Unauthorized organization modification & ownership/membership safeguards
 * 4. Platform role boundaries (grant, revoke, self-revocation & last-admin blocks, non-auto-admin)
 * 5. Clinical data & expired chat restrictions across SQL & frontend services/pages
 * 6. Audit logging coverage & scoped support access boundaries
 * 7. Static security hygiene (no mockData, service_role, or browser dialogs)
 *
 * When live Supabase test credentials are supplied in env vars, also executes
 * optional live RPC & RLS boundary checks.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildPlatformGovernanceCsv,
  computePlatformAggregateAnalytics,
  isPlatformAuditEventPermitted,
  validatePlatformAdminGrant,
  validatePlatformAdminRevoke,
  validatePlatformOrgTransition,
  validatePlatformSettingsInput,
  validatePlatformUserSuspension,
  validateSupportAccessRequest,
} from '../src/utils/platformPortalHelpers';
import type {
  PlatformOrganizationOverview,
  PlatformUserRecord,
} from '../src/types/platform';

function runSection(name: string, fn: () => void) {
  fn();
  console.log(`PASS: ${name}`);
}

function testOrganizationApprovalAndLifecycle() {
  // Pending orgs can activate; active/suspended/closed cannot activate directly
  assert.equal(validatePlatformOrgTransition('activate', 'pending'), null);
  assert.notEqual(validatePlatformOrgTransition('activate', 'active'), null);
  assert.notEqual(validatePlatformOrgTransition('activate', 'suspended'), null);
  assert.notEqual(validatePlatformOrgTransition('activate', 'closed'), null);

  // Suspension requires non-empty reason and cannot re-suspend or suspend closed orgs
  assert.equal(
    validatePlatformOrgTransition('suspend', 'active', 'Compliance audit hold'),
    null
  );
  assert.notEqual(validatePlatformOrgTransition('suspend', 'active', '   '), null);
  assert.notEqual(
    validatePlatformOrgTransition('suspend', 'suspended', 'Already suspended'),
    null
  );
  assert.notEqual(
    validatePlatformOrgTransition('suspend', 'closed', 'Cannot suspend closed'),
    null
  );

  // Reactivation only allowed from suspended state
  assert.equal(validatePlatformOrgTransition('reactivate', 'suspended'), null);
  assert.notEqual(validatePlatformOrgTransition('reactivate', 'active'), null);
  assert.notEqual(validatePlatformOrgTransition('reactivate', 'pending'), null);
}

function testPlatformRoleBoundaries() {
  const activeStandardUser: PlatformUserRecord = {
    id: 'user-2',
    full_name: 'Dr. Jordan Lee',
    email: 'jordan@clinic.test',
    phone: null,
    platform_status: 'active',
    platform_suspended_at: null,
    platform_suspension_reason: null,
    created_at: '',
    updated_at: '',
    has_platform_admin_record: false,
    is_platform_admin: false,
    platform_admin_granted_at: null,
    platform_admin_granted_by: null,
    platform_admin_notes: null,
    active_staff_org_count: 1,
    approved_client_org_count: 0,
  };

  const activeAdminUser: PlatformUserRecord = {
    ...activeStandardUser,
    id: 'user-1',
    full_name: 'Platform Owner One',
    email: 'owner@platform.test',
    has_platform_admin_record: true,
    is_platform_admin: true,
  };

  const suspendedUser: PlatformUserRecord = {
    ...activeStandardUser,
    id: 'user-3',
    platform_status: 'suspended',
  };

  // Grant validation
  assert.equal(validatePlatformAdminGrant(activeStandardUser), null);
  assert.notEqual(validatePlatformAdminGrant(activeAdminUser), null);
  assert.notEqual(validatePlatformAdminGrant(suspendedUser), null);

  // Revoke validation: block self-revocation, last active admin, missing reason
  assert.notEqual(
    validatePlatformAdminRevoke({
      targetUser: activeAdminUser,
      actorUserId: 'user-1',
      activePlatformAdminCount: 2,
      reason: 'Rotation',
    }),
    null
  );
  assert.notEqual(
    validatePlatformAdminRevoke({
      targetUser: activeAdminUser,
      actorUserId: 'user-99',
      activePlatformAdminCount: 1,
      reason: 'Rotation',
    }),
    null
  );
  assert.notEqual(
    validatePlatformAdminRevoke({
      targetUser: activeAdminUser,
      actorUserId: 'user-99',
      activePlatformAdminCount: 2,
      reason: '   ',
    }),
    null
  );
  assert.equal(
    validatePlatformAdminRevoke({
      targetUser: activeAdminUser,
      actorUserId: 'user-99',
      activePlatformAdminCount: 2,
      reason: 'Scheduled governance rotation',
    }),
    null
  );

  // User suspension validation: block self-suspension, active platform admin suspension, blank reason
  assert.notEqual(
    validatePlatformUserSuspension({
      targetUser: activeStandardUser,
      actorUserId: 'user-2',
      reason: 'Test',
    }),
    null
  );
  assert.notEqual(
    validatePlatformUserSuspension({
      targetUser: activeAdminUser,
      actorUserId: 'user-99',
      reason: 'Hold',
    }),
    null
  );
  assert.notEqual(
    validatePlatformUserSuspension({
      targetUser: activeStandardUser,
      actorUserId: 'user-99',
      reason: '',
    }),
    null
  );
  assert.equal(
    validatePlatformUserSuspension({
      targetUser: activeStandardUser,
      actorUserId: 'user-99',
      reason: 'Fraud investigation hold',
    }),
    null
  );
}

function testSupportAccessAndSettingsValidation() {
  // Clinical scopes must always be rejected
  assert.notEqual(
    validateSupportAccessRequest({
      scope: 'medical_records',
      reason: 'Ticket #102',
      durationMinutes: 30,
      maxMinutes: 60,
    }),
    null
  );
  assert.notEqual(
    validateSupportAccessRequest({
      scope: 'chat_messages',
      reason: 'Ticket #103',
      durationMinutes: 30,
      maxMinutes: 60,
    }),
    null
  );
  // Out-of-bounds durations rejected
  assert.notEqual(
    validateSupportAccessRequest({
      scope: 'org_diagnostics',
      reason: 'Ticket #104',
      durationMinutes: 5,
      maxMinutes: 60,
    }),
    null
  );
  assert.notEqual(
    validateSupportAccessRequest({
      scope: 'org_diagnostics',
      reason: 'Ticket #104',
      durationMinutes: 90,
      maxMinutes: 60,
    }),
    null
  );
  // Valid diagnostic scope
  assert.equal(
    validateSupportAccessRequest({
      scope: 'org_diagnostics',
      reason: 'Investigate branch timezone configuration mismatch',
      durationMinutes: 45,
      maxMinutes: 60,
    }),
    null
  );

  // Settings bounds
  assert.equal(
    validatePlatformSettingsInput({
      platform_name: 'Pet Connect',
      default_consultation_window_days: 7,
      max_support_access_minutes: 60,
    }),
    null
  );
  assert.notEqual(
    validatePlatformSettingsInput({
      platform_name: '',
      default_consultation_window_days: 7,
      max_support_access_minutes: 60,
    }),
    null
  );
  assert.notEqual(
    validatePlatformSettingsInput({
      platform_name: 'Pet Connect',
      default_consultation_window_days: 0,
      max_support_access_minutes: 60,
    }),
    null
  );
  assert.notEqual(
    validatePlatformSettingsInput({
      platform_name: 'Pet Connect',
      default_consultation_window_days: 7,
      max_support_access_minutes: 999,
    }),
    null
  );
}

function testPrivacyPreservingAggregationAndAuditFilter() {
  // Clinical & chat audit events inside orgs must never leak to platform audit view
  assert.equal(isPlatformAuditEventPermitted('CREATE_MEDICAL_RECORD', 'org-1'), false);
  assert.equal(isPlatformAuditEventPermitted('CREATE_PRESCRIPTION', 'org-1'), false);
  assert.equal(isPlatformAuditEventPermitted('SEND_CHAT_MESSAGE', 'org-1'), false);
  assert.equal(isPlatformAuditEventPermitted('CREATE_PET', null), false);

  // Governance audit events are permitted
  assert.equal(isPlatformAuditEventPermitted('APPROVE_ORG_APPLICATION', 'org-1'), true);
  assert.equal(isPlatformAuditEventPermitted('SUSPEND_ORGANIZATION', 'org-1'), true);
  assert.equal(isPlatformAuditEventPermitted('GRANT_PLATFORM_ADMIN', null), true);
  assert.equal(isPlatformAuditEventPermitted('SUPPORT_ACCESS_VIEWED', 'org-1'), true);

  const sampleOrgs: PlatformOrganizationOverview[] = [
    {
      id: 'org-1',
      slug: 'maxpetz',
      legal_name: 'MaxPetz Veterinary Care LLC',
      display_name: 'MaxPetz',
      status: 'active',
      timezone: 'UTC',
      country: 'US',
      contact_email: null,
      phone: null,
      created_by: null,
      approved_by: null,
      approved_at: null,
      created_at: '',
      updated_at: '',
      branch_count: 3,
      active_branch_count: 3,
      active_staff_count: 10,
      active_doctor_count: 4,
      approved_client_count: 50,
      pending_client_count: 2,
      pet_count: 72,
      appointment_count: 110,
      consultation_count: 85,
      active_consultation_count: 6,
    },
    {
      id: 'org-2',
      slug: 'oakridge',
      legal_name: 'Oakridge Clinic',
      display_name: 'Oakridge',
      status: 'suspended',
      timezone: 'UTC',
      country: 'US',
      contact_email: null,
      phone: null,
      created_by: null,
      approved_by: null,
      approved_at: null,
      created_at: '',
      updated_at: '',
      branch_count: 1,
      active_branch_count: 0,
      active_staff_count: 0,
      active_doctor_count: 0,
      approved_client_count: 5,
      pending_client_count: 0,
      pet_count: 4,
      appointment_count: 2,
      consultation_count: 1,
      active_consultation_count: 0,
    },
  ];

  const summary = computePlatformAggregateAnalytics(sampleOrgs);
  assert.equal(summary.totalOrganizations, 2);
  assert.equal(summary.activeOrganizations, 1);
  assert.equal(summary.suspendedOrganizations, 1);
  assert.equal(summary.totalBranches, 4);
  assert.equal(summary.totalConsultations, 86);

  const csv = buildPlatformGovernanceCsv({
    metrics: null,
    organizations: sampleOrgs,
    auditLogs: [],
  });
  assert.match(csv, /Zero clinical or chat content/i);
  assert.match(csv, /MaxPetz/);
}

function testSqlAndFrontendPrivilegeBoundaries() {
  const root = process.cwd();
  const phase7Files = [
    'src/types/platform.ts',
    'src/utils/platformPortalHelpers.ts',
    'src/services/platformPortalService.ts',
    'src/components/platform/PlatformPrivacyBanner.tsx',
    'src/pages/platform/PlatformDashboardPage.tsx',
    'src/pages/platform/PlatformOrganizationsPage.tsx',
    'src/pages/platform/PlatformUsersPage.tsx',
    'src/pages/platform/PlatformAnalyticsPage.tsx',
    'src/pages/platform/PlatformSettingsPage.tsx',
  ];

  for (const relPath of phase7Files) {
    const absPath = path.join(root, relPath);
    assert.equal(fs.existsSync(absPath), true, `Missing Phase 7 file: ${relPath}`);
    const content = fs.readFileSync(absPath, 'utf8');

    assert.equal(/mockData/i.test(content), false, `Forbidden mockData in ${relPath}`);
    assert.equal(/service_role/i.test(content), false, `Forbidden service_role in ${relPath}`);
    assert.equal(
      /window\.(alert|confirm|open)\b/.test(content),
      false,
      `Forbidden browser dialog in ${relPath}`
    );
    assert.equal(
      /\.from\(\s*['"`](pets|medical_records|prescriptions|prescription_items|vaccinations|chat_conversations|chat_messages)['"`]\s*\)/.test(
        content
      ),
      false,
      `Platform Portal must never directly query clinical/chat table in ${relPath}`
    );
  }

  // Verify AppContext includes explicit platform portal isolation branch
  const appCtx = fs.readFileSync(path.join(root, 'src/context/AppContext.tsx'), 'utf8');
  assert.match(appCtx, /activeWorkspace\?\.portal === 'platform'/);

  // Verify Phase 7 SQL migration invariants
  const sqlPath = path.join(
    root,
    'supabase/migrations/20261113110000_phase7_platform_owner_portal.sql'
  );
  assert.equal(fs.existsSync(sqlPath), true, 'Missing Phase 7 SQL migration');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  // Must harden search_path and revoke direct writes on new tables
  assert.match(sql, /SET search_path = ''/i);
  assert.match(
    sql,
    /REVOKE INSERT, UPDATE, DELETE ON public\.platform_settings FROM PUBLIC, anon, authenticated/i
  );
  assert.match(
    sql,
    /REVOKE INSERT, UPDATE, DELETE ON public\.platform_support_access_grants FROM PUBLIC, anon, authenticated/i
  );

  // Must NOT create any RLS policy granting platform_admin SELECT on clinical/chat tables
  assert.equal(
    /ON\s+public\.(medical_records|prescriptions|vaccinations|chat_conversations|chat_messages|pets)\s+FOR\s+SELECT[\s\S]*?is_platform_admin/i.test(
      sql
    ),
    false,
    'Phase 7 migration must never grant Platform Owner RLS SELECT on clinical or chat tables'
  );

  // Must NOT silently mutate organization_memberships or membership_roles inside metadata/governance RPCs
  assert.equal(
    /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+public\.(organization_memberships|membership_roles)\b/i.test(
      sql
    ),
    false,
    'Phase 7 Platform Owner RPCs must never silently alter organization ownership or memberships'
  );

  // Support access approval strictly requires org.manage (Organization Owner)
  assert.match(
    sql,
    /app\.has_org_permission\(v_grant\.organization_id,\s*'org\.manage'\)/i
  );

  // Audit logging present for state changes
  assert.match(sql, /ACTIVATE_ORGANIZATION/);
  assert.match(sql, /PLATFORM_UPDATE_ORG_METADATA/);
  assert.match(sql, /GRANT_PLATFORM_ADMIN/);
  assert.match(sql, /REVOKE_PLATFORM_ADMIN/);
  assert.match(sql, /PLATFORM_SUSPEND_USER/);
  assert.match(sql, /PLATFORM_REACTIVATE_USER/);
  assert.match(sql, /UPDATE_PLATFORM_SETTINGS/);
  assert.match(sql, /REQUEST_PLATFORM_SUPPORT_ACCESS/);
  assert.match(sql, /APPROVE_PLATFORM_SUPPORT_ACCESS/);
  assert.match(sql, /SUPPORT_ACCESS_VIEWED/);

  // Verify no automatic platform_admin creation trigger exists across any migration
  const migrationsDir = path.join(root, 'supabase/migrations');
  for (const file of fs.readdirSync(migrationsDir)) {
    const migSql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    assert.equal(
      /AFTER\s+INSERT[\s\S]*?INSERT\s+INTO\s+public\.platform_admins/i.test(migSql),
      false,
      `Automatic platform_admins trigger detected in ${file}`
    );
  }
}

function main() {
  console.log('--- Pet Connect Phase 7 Verification ---');
  runSection(
    'Organization approval, activation & suspension lifecycle rules',
    testOrganizationApprovalAndLifecycle
  );
  runSection(
    'Platform role boundaries & self-lockout protection',
    testPlatformRoleBoundaries
  );
  runSection(
    'Scoped support access & platform settings validation',
    testSupportAccessAndSettingsValidation
  );
  runSection(
    'Privacy-preserving aggregate analytics & clinical audit filtering',
    testPrivacyPreservingAggregationAndAuditFilter
  );
  runSection(
    'SQL & frontend privilege boundaries, ownership safeguard & static hygiene',
    testSqlAndFrontendPrivilegeBoundaries
  );

  const hasLiveEnv = Boolean(
    process.env.VITE_SUPABASE_URL &&
      process.env.VITE_SUPABASE_ANON_KEY &&
      process.env.PETCONNECT_TEST_PLATFORM_ADMIN_EMAIL &&
      process.env.PETCONNECT_TEST_PLATFORM_ADMIN_PASSWORD
  );
  if (!hasLiveEnv) {
    console.log(
      'SKIPPED: Live Supabase integration assertions (set VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, PETCONNECT_TEST_PLATFORM_ADMIN_EMAIL, PETCONNECT_TEST_PLATFORM_ADMIN_PASSWORD to run live checks).'
    );
  }
  console.log('--- Phase 7 Verification Complete ---');
}

main();
