import assert from 'node:assert/strict';
import {
  buildWorkspaceOptions,
  checkWorkspacePortalAccess,
  deriveLegacyPortalRole,
  hasBranchAccess,
  hasOrgPermission,
} from '../src/utils/workspaceAuth';
import { formatSupabaseError } from '../src/services/authService';
import type { MyContextResponse } from '../src/types/auth';

const ORG_A_ID = '11111111-1111-4111-8111-111111111111';
const ORG_B_ID = '22222222-2222-4222-8222-222222222222';
const ORG_PENDING_ID = '33333333-3333-4333-8333-333333333333';
const BRANCH_1_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BRANCH_2_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const multiOrgContext: MyContextResponse = {
  user_id: 'user-global-1',
  profile: {
    id: 'user-global-1',
    full_name: 'Dr. Jordan Patel',
    email: 'jordan@example.com',
    phone: '+1-555-0100',
    avatar_url: null,
  },
  is_platform_admin: false,
  memberships: [
    {
      membership_id: 'mem-a',
      organization_id: ORG_A_ID,
      organization_slug: 'maxpetz',
      organization_name: 'MaxPetz Clinic',
      organization_status: 'active',
      membership_status: 'active',
      roles: ['doctor'],
      permissions: ['clients.read', 'pets.read', 'medical_records.read', 'medical_records.write'],
      branch_ids: [BRANCH_1_ID],
    },
    {
      membership_id: 'mem-b',
      organization_id: ORG_B_ID,
      organization_slug: 'oakridge-vet',
      organization_name: 'Oakridge Vet',
      organization_status: 'active',
      membership_status: 'active',
      roles: ['org_admin'],
      permissions: ['staff.manage', 'clients.approve', 'branch.manage'],
      branch_ids: [],
    },
    {
      membership_id: 'mem-pending',
      organization_id: ORG_PENDING_ID,
      organization_slug: 'pending-clinic',
      organization_name: 'Pending Clinic',
      organization_status: 'pending',
      membership_status: 'active',
      roles: ['org_owner'],
      permissions: ['org.manage', 'staff.manage'],
      branch_ids: [],
    },
  ],
  clinic_clients: [
    {
      clinic_client_id: 'cc-b',
      organization_id: ORG_B_ID,
      organization_slug: 'oakridge-vet',
      organization_name: 'Oakridge Vet',
      organization_status: 'active',
      client_status: 'approved',
      requested_at: '2026-01-01T00:00:00Z',
      approved_at: '2026-01-02T00:00:00Z',
    },
    {
      clinic_client_id: 'cc-a-pending',
      organization_id: ORG_A_ID,
      organization_slug: 'maxpetz',
      organization_name: 'MaxPetz Clinic',
      organization_status: 'active',
      client_status: 'requested',
      requested_at: '2026-01-05T00:00:00Z',
      approved_at: null,
    },
  ],
};

// 1. Multi-org single identity workspace derivation & pending org exclusion
const workspaces = buildWorkspaceOptions(multiOrgContext);
assert.equal(workspaces.length, 3, 'Should produce doctor@maxpetz, admin@oakridge-vet, client@oakridge-vet only');
assert.ok(workspaces.some((w) => w.key === `doctor:${ORG_A_ID}`));
assert.ok(workspaces.some((w) => w.key === `admin:${ORG_B_ID}`));
assert.ok(workspaces.some((w) => w.key === `client:${ORG_B_ID}`));
assert.ok(!workspaces.some((w) => w.organization_id === ORG_PENDING_ID), 'Pending org must NOT yield active workspace');
assert.ok(!workspaces.some((w) => w.key === `client:${ORG_A_ID}`), 'Pending client join must NOT yield client workspace');

// 2. Pending organization guard blocks portal access explicitly
const pendingCheck = checkWorkspacePortalAccess(multiOrgContext, 'pending-clinic', 'admin');
assert.equal(pendingCheck.allowed, false);
if (!pendingCheck.allowed) {
  assert.equal(pendingCheck.reason, 'org_pending');
}

// 3. Pending client join request blocks client portal cleanly
const clientRequestedCheck = checkWorkspacePortalAccess(multiOrgContext, 'maxpetz', 'client');
assert.equal(clientRequestedCheck.allowed, false);
if (!clientRequestedCheck.allowed) {
  assert.equal(clientRequestedCheck.reason, 'client_requested');
}

// 4. Unauthorized role check: doctor at maxpetz cannot enter maxpetz admin portal
const doctorAsAdminCheck = checkWorkspacePortalAccess(multiOrgContext, 'maxpetz', 'admin');
assert.equal(doctorAsAdminCheck.allowed, false);
if (!doctorAsAdminCheck.allowed) {
  assert.equal(doctorAsAdminCheck.reason, 'forbidden');
}

// 5. Authorized portals pass
assert.equal(checkWorkspacePortalAccess(multiOrgContext, 'maxpetz', 'doctor').allowed, true);
assert.equal(checkWorkspacePortalAccess(multiOrgContext, 'oakridge-vet', 'admin').allowed, true);
assert.equal(checkWorkspacePortalAccess(multiOrgContext, 'oakridge-vet', 'client').allowed, true);

// 6. Branch scoping & permission helpers
const maxpetzMembership = multiOrgContext.memberships[0];
const oakridgeMembership = multiOrgContext.memberships[1];
assert.equal(hasBranchAccess(maxpetzMembership, BRANCH_1_ID, 'medical_records.write'), true);
assert.equal(hasBranchAccess(maxpetzMembership, BRANCH_2_ID, 'medical_records.write'), false);
assert.equal(hasBranchAccess(oakridgeMembership, BRANCH_2_ID, 'clients.approve'), true, 'Empty branch_ids = org-wide');
assert.equal(hasOrgPermission(maxpetzMembership, 'staff.manage'), false);

// 7. Platform admin console included only for platform_admins
const platformCtx: MyContextResponse = {
  ...multiOrgContext,
  is_platform_admin: true,
};
assert.ok(buildWorkspaceOptions(platformCtx).some((w) => w.portal === 'platform'));

// 8. Legacy role derivation & error formatting
assert.equal(deriveLegacyPortalRole(workspaces[0]), 'doctor');
assert.match(formatSupabaseError({ code: '28000', message: 'Unauthorized' }), /expired|unauthenticated/i);
assert.match(formatSupabaseError({ code: '23505', message: 'duplicate key value violates unique constraint slug' }), /slug/i);

console.log('ALL PHASE 3 AUTH & WORKSPACE UNIT ASSERTIONS PASSED (8/8 groups)');
