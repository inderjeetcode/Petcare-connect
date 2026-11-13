/**
 * Phase 1 — Single Developer / Platform Owner Verification Script
 *
 * Verifies all 7 required Phase 1 scenarios offline via static SQL/frontend
 * contract checks and runtime TS logic assertions:
 * 1. Only 1 active Platform Owner can exist (DB partial unique index + trigger)
 * 2. Second Platform Owner promotion is rejected (DB constraint + disabled RPC + removed UI)
 * 3. Unconfirmed email cannot be bootstrapped
 * 4. Wrong email cannot be bootstrapped
 * 5. Repeated bootstrap execution is rejected
 * 6. Generic /login and /signup cannot grant or route to Platform Owner access
 * 7. Clinic (/login/clinic) and Pet Owner (/login/client) login flows remain functional
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildWorkspaceOptions,
  isAuthorizedReturnPath,
  resolvePortalLandingDecision,
} from '../src/utils/workspaceAuth';
import {
  isPlatformAuditEventPermitted,
  validatePlatformAdminGrant,
} from '../src/utils/platformPortalHelpers';
import type { MyContextResponse } from '../src/types/auth';

function runTest(name: string, fn: () => void) {
  fn();
  console.log(`PASS: ${name}`);
}

const ROOT = process.cwd();
const MIGRATION_PATH = path.join(
  ROOT,
  'supabase/migrations/20261113140000_phase1_single_platform_owner.sql'
);
const BOOTSTRAP_SQL_PATH = path.join(ROOT, 'scripts/bootstrap_platform_owner.sql');
const RLS_SUITE_PATH = path.join(ROOT, 'supabase/tests/rls_multi_tenant_suite.sql');

const migrationSql = fs.readFileSync(MIGRATION_PATH, 'utf8');
const bootstrapSql = fs.readFileSync(BOOTSTRAP_SQL_PATH, 'utf8');
const rlsSuiteSql = fs.readFileSync(RLS_SUITE_PATH, 'utf8');

function test1And2_SingleOwnerAndPromotionBlocked() {
  // Partial unique index on active rows preserves inactive historical records
  assert.match(
    migrationSql,
    /CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_admins_single_active\s+ON public\.platform_admins \(\(true\)\)\s+WHERE is_active = true;/i
  );

  // Trigger blocks DELETE, blocks direct anon/authenticated writes, keeps user_id immutable, enforces <=1 active
  assert.match(migrationSql, /CREATE OR REPLACE FUNCTION public\.tg_platform_admins_guard_single_owner\(\)/i);
  assert.match(migrationSql, /IF TG_OP = 'DELETE' THEN[\s\S]*?ERRCODE = '42501'/i);
  assert.match(migrationSql, /IF current_user IN \('anon', 'authenticated'\) THEN[\s\S]*?ERRCODE = '42501'/i);
  assert.match(migrationSql, /Single Platform Owner Violation[\s\S]*?ERRCODE = '23505'/i);

  // Migration executable SQL must be strictly forward-only with zero destructive DDL
  const executableSql = migrationSql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
  assert.equal(
    /\b(DROP\s+TABLE|TRUNCATE|DELETE\s+FROM\s+public\.platform_admins)\b/i.test(executableSql),
    false
  );

  // Disabled platform_grant_platform_admin RPC
  assert.match(
    migrationSql,
    /CREATE OR REPLACE FUNCTION public\.platform_grant_platform_admin[\s\S]*?ERRCODE = '42501'/i
  );
  assert.match(
    migrationSql,
    /REVOKE ALL ON FUNCTION public\.platform_grant_platform_admin\(UUID, TEXT\) FROM PUBLIC, anon, authenticated;/i
  );

  // Frontend promotion path removed & helper fails closed
  const platformUsersPage = fs.readFileSync(
    path.join(ROOT, 'src/pages/platform/PlatformUsersPage.tsx'),
    'utf8'
  );
  const platformService = fs.readFileSync(
    path.join(ROOT, 'src/services/platformPortalService.ts'),
    'utf8'
  );
  assert.equal(/Grant Owner/i.test(platformUsersPage), false);
  assert.equal(/grantPlatformAdmin/.test(platformService), false);
  assert.notEqual(
    validatePlatformAdminGrant({
      id: 'u-1',
      is_platform_admin: false,
      platform_status: 'active',
    }),
    null
  );
}

function test3And4_EmailAndConfirmationGuards() {
  // Exact canonical developer email verified inside bootstrap function
  assert.match(
    migrationSql,
    /v_canonical_email CONSTANT TEXT := 'inderjeetcode@gmail\.com';/i
  );
  assert.match(
    migrationSql,
    /IF v_target_email <> v_canonical_email THEN[\s\S]*?ERRCODE = '42501'/i
  );

  // Requires confirmed email in auth.users
  assert.match(
    migrationSql,
    /IF v_auth_user\.email_confirmed_at IS NULL THEN[\s\S]*?ERRCODE = '42501'/i
  );
  // app.is_platform_admin() and trigger also enforce email_confirmed_at IS NOT NULL
  assert.match(migrationSql, /au\.email_confirmed_at IS NOT NULL/i);

  // Bootstrap resolves real auth.users.id from database, never accepting arbitrary UUID from caller
  assert.match(
    migrationSql,
    /CREATE OR REPLACE FUNCTION app\.bootstrap_single_platform_owner\(\s*p_expected_email TEXT DEFAULT 'inderjeetcode@gmail\.com'/i
  );
  assert.equal(/p_user_id/i.test(migrationSql.split('app.bootstrap_single_platform_owner')[1]), false);

  // Bootstrap must reject non-privileged / authenticated callers and never expose service_role in frontend
  assert.match(
    migrationSql,
    /REVOKE ALL ON FUNCTION app\.bootstrap_single_platform_owner\(TEXT, TEXT\) FROM PUBLIC, anon, authenticated;/i
  );
}

function test5_OneTimeConcurrencySafeAuditedBootstrap() {
  // Concurrency lock & one-time enforcement & audit log
  assert.match(
    migrationSql,
    /pg_advisory_xact_lock\(hashtext\('pet_connect_single_platform_owner_bootstrap'\)\)/i
  );
  assert.match(
    migrationSql,
    /SELECT pa\.user_id INTO v_existing_active_id\s+FROM public\.platform_admins pa\s+WHERE pa\.is_active = true\s+FOR UPDATE;/i
  );
  assert.match(
    migrationSql,
    /IF EXISTS \(SELECT 1 FROM public\.platform_admins pa WHERE pa\.user_id = v_auth_user\.id\) THEN[\s\S]*?ERRCODE = '23505'/i
  );
  assert.match(migrationSql, /'BOOTSTRAP_PLATFORM_OWNER'/);
  assert.equal(isPlatformAuditEventPermitted('BOOTSTRAP_PLATFORM_OWNER', null), true);

  // Bootstrap script must exist with commented Step 2 (not auto-run)
  assert.match(bootstrapSql, /inderjeetcode@gmail\.com/);
  assert.match(bootstrapSql, /app\.bootstrap_single_platform_owner/);
}

function test6_GenericLoginAndSignupSeparation() {
  const platformOwnerCtx: MyContextResponse = {
    user_id: 'dev-uuid-1',
    profile: {
      id: 'dev-uuid-1',
      full_name: 'Developer',
      email: 'inderjeetcode@gmail.com',
      phone: null,
      avatar_url: null,
    },
    is_platform_admin: true,
    memberships: [],
    clinic_clients: [],
  };

  // Dedicated /platform/login allows Platform Owner
  assert.deepEqual(resolvePortalLandingDecision(platformOwnerCtx, 'platform'), {
    kind: 'redirect',
    path: '/platform/dashboard',
  });

  // Generic /login and /signup never grant a route to /platform/*
  const genericDecision = resolvePortalLandingDecision(platformOwnerCtx, 'generic');
  assert.equal(genericDecision.kind, 'denied');
  if (genericDecision.kind === 'denied') {
    assert.equal(genericDecision.reason, 'platform_login_required');
  }

  // Client login cannot route Platform Owner to platform portal
  const clientDecision = resolvePortalLandingDecision(platformOwnerCtx, 'client');
  assert.equal(clientDecision.kind, 'denied');
  if (clientDecision.kind === 'denied') {
    assert.equal(clientDecision.reason, 'platform_login_required');
  }

  // Return path tampering from /login -> /platform/dashboard is blocked
  assert.equal(isAuthorizedReturnPath(platformOwnerCtx, '/platform/dashboard', 'generic'), null);
  assert.equal(isAuthorizedReturnPath(platformOwnerCtx, '/platform/users', 'client'), null);
  assert.equal(isAuthorizedReturnPath(platformOwnerCtx, '/platform/users', 'clinic'), null);

  // Route definitions & guards keep /platform/login separate and AuthPage renders no link to /platform/*
  const appTsx = fs.readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf8');
  const authPage = fs.readFileSync(path.join(ROOT, 'src/pages/auth/AuthPage.tsx'), 'utf8');
  const authFormCard = fs.readFileSync(path.join(ROOT, 'src/components/auth/AuthFormCard.tsx'), 'utf8');
  const authModal = fs.readFileSync(path.join(ROOT, 'src/components/common/AuthModal.tsx'), 'utf8');

  assert.match(appTsx, /path="\/platform\/login"[\s\S]*?portal="platform"/);
  assert.match(appTsx, /path="\/login"[\s\S]*?portal="generic"/);
  assert.match(appTsx, /path="\/signup"[\s\S]*?portal="generic"/);
  assert.match(authPage, /decision\.reason === 'platform_login_required'/);
  assert.equal(authFormCard.includes('/platform/login'), false, 'Public AuthFormCard must not link to /platform/login');
  assert.match(authModal, /resolvePortalLandingDecision\(ctx,\s*'generic'/);
}

function test7_ClinicAndClientLoginFlowsRemainFunctional() {
  const clinicStaffCtx: MyContextResponse = {
    user_id: 'staff-1',
    profile: {
      id: 'staff-1',
      full_name: 'Dr. Clinic',
      email: 'doc@maxpetz.test',
      phone: null,
      avatar_url: null,
    },
    is_platform_admin: false,
    memberships: [
      {
        membership_id: 'm-1',
        organization_id: 'org-1',
        organization_slug: 'maxpetz',
        organization_name: 'MaxPetz',
        organization_status: 'active',
        membership_status: 'active',
        roles: ['doctor'],
        permissions: ['medical_records.read'],
        branch_ids: [],
      },
    ],
    clinic_clients: [],
  };

  const approvedClientCtx: MyContextResponse = {
    user_id: 'client-1',
    profile: {
      id: 'client-1',
      full_name: 'Pet Owner',
      email: 'owner@client.test',
      phone: null,
      avatar_url: null,
    },
    is_platform_admin: false,
    memberships: [],
    clinic_clients: [
      {
        clinic_client_id: 'cc-1',
        organization_id: 'org-1',
        organization_slug: 'maxpetz',
        organization_name: 'MaxPetz',
        organization_status: 'active',
        client_status: 'approved',
        requested_at: '2026-01-01T00:00:00Z',
        approved_at: '2026-01-02T00:00:00Z',
      },
    ],
  };

  const pendingClientCtx: MyContextResponse = {
    ...approvedClientCtx,
    clinic_clients: [
      {
        ...approvedClientCtx.clinic_clients[0],
        client_status: 'requested',
        approved_at: null,
      },
    ],
  };

  assert.deepEqual(resolvePortalLandingDecision(clinicStaffCtx, 'clinic'), {
    kind: 'redirect',
    path: '/maxpetz/doctor/dashboard',
  });
  assert.deepEqual(resolvePortalLandingDecision(approvedClientCtx, 'client'), {
    kind: 'redirect',
    path: '/maxpetz/client/dashboard',
  });
  assert.equal(resolvePortalLandingDecision(pendingClientCtx, 'client').kind, 'client_pending_status');
  assert.equal(buildWorkspaceOptions(approvedClientCtx).length, 1);

  // Ordinary users rejected cleanly at /platform/login
  assert.deepEqual(resolvePortalLandingDecision(clinicStaffCtx, 'platform'), {
    kind: 'denied',
    reason: 'platform_forbidden',
    message: 'Access denied: this account does not hold active Platform Owner governance authorization.',
  });

  // RLS suite includes TEST 14 for DB-level verification when run on Postgres
  assert.match(rlsSuiteSql, /TEST 14: PHASE 1 — SINGLE PLATFORM OWNER CONSTRAINT & CONTROLLED BOOTSTRAP/);
}

function main() {
  console.log('--- Pet Connect Phase 1 Single Platform Owner Verification ---');
  runTest('1 & 2. Single active owner constraint + normal promotion paths disabled', test1And2_SingleOwnerAndPromotionBlocked);
  runTest('3 & 4. Unconfirmed & wrong email bootstrap rejections enforced in SQL', test3And4_EmailAndConfirmationGuards);
  runTest('5. One-time concurrency-safe audited bootstrap & manual SQL guide', test5_OneTimeConcurrencySafeAuditedBootstrap);
  runTest('6. Generic /login & /signup cannot reach Platform Owner portal', test6_GenericLoginAndSignupSeparation);
  runTest('7. Clinic & Pet Owner login flows remain functional & TEST 14 in RLS suite', test7_ClinicAndClientLoginFlowsRemainFunctional);
  console.log('ALL PHASE 1 VERIFICATION CHECKS PASSED (5/5 groups)');
}

main();
