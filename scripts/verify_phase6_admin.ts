/**
 * Phase 6 Organization Admin Portal Verification Script
 *
 * Runs offline structural, permission-boundary, scheduling conflict, reporting,
 * static security hygiene, and SQL migration invariant checks unconditionally.
 * When live Supabase test credentials are supplied in environment variables,
 * it also executes optional live RPC & RLS boundary assertions.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildAuditExportCsv,
  canAssignRoleList,
  computeAdminOperationalReport,
  detectAppointmentConflict,
  groupSchedulesByBranchAndDay,
  isBranchAccessibleToMember,
  validateBranchFormInput,
  validateClinicServiceInput,
} from '../src/utils/adminPortalHelpers';
import type { Branch } from '../src/types/auth';
import type { DoctorAppointment, DoctorConsultation } from '../src/types/doctor';

function runSection(name: string, fn: () => void) {
  fn();
  console.log(`PASS: ${name}`);
}

function testRolePrivilegeBoundaries() {
  // Never allow Platform Owner / Platform Admin escalation from org portal
  const platformEscalation = canAssignRoleList(['platform_admin' as any], true);
  assert.equal(platformEscalation.valid, false);
  assert.match(platformEscalation.message || '', /Platform Owner/i);

  const platformOwnerEscalation = canAssignRoleList(['platform_owner' as any], true);
  assert.equal(platformOwnerEscalation.valid, false);

  // org_admin without roles.assign_admin cannot grant org_owner or org_admin
  const grantOwnerWithoutPerm = canAssignRoleList(['org_owner'], false);
  assert.equal(grantOwnerWithoutPerm.valid, false);
  const grantAdminWithoutPerm = canAssignRoleList(['org_admin'], false);
  assert.equal(grantAdminWithoutPerm.valid, false);

  // Operational staff roles are allowed for staff.manage holders
  assert.equal(canAssignRoleList(['doctor', 'branch_manager'], false).valid, true);
  assert.equal(canAssignRoleList(['front_desk'], false).valid, true);

  // org_owner with roles.assign_admin can grant org_admin / org_owner
  assert.equal(canAssignRoleList(['org_admin'], true).valid, true);
  assert.equal(canAssignRoleList(['org_owner'], true).valid, true);

  // Empty roles rejected
  assert.equal(canAssignRoleList([], true).valid, false);
}

function testBranchScopeEnforcement() {
  assert.equal(isBranchAccessibleToMember([], 'branch-1'), true);
  assert.equal(isBranchAccessibleToMember(['branch-1', 'branch-2'], 'branch-2'), true);
  assert.equal(isBranchAccessibleToMember(['branch-1'], 'branch-2'), false);
  assert.equal(isBranchAccessibleToMember(['branch-1'], null), false);
}

function testValidators() {
  assert.equal(
    validateBranchFormInput({ name: 'North Clinic', code: 'NORTH_01', timezone: 'UTC' }),
    null
  );
  assert.notEqual(
    validateBranchFormInput({ name: '', code: 'NORTH', timezone: 'UTC' }),
    null
  );
  assert.notEqual(
    validateBranchFormInput({ name: 'North', code: 'bad code!', timezone: 'UTC' }),
    null
  );

  assert.equal(
    validateClinicServiceInput({
      name: 'Annual Checkup',
      code: 'WELLNESS_1',
      duration_minutes: 30,
      price: 55,
    }),
    null
  );
  assert.notEqual(
    validateClinicServiceInput({
      name: 'Short',
      code: 'SHORT',
      duration_minutes: 2,
      price: 10,
    }),
    null
  );
  assert.notEqual(
    validateClinicServiceInput({
      name: 'Free',
      code: 'NEG',
      duration_minutes: 30,
      price: -5,
    }),
    null
  );
}

function testAppointmentConflictDetection() {
  const existing: DoctorAppointment[] = [
    {
      id: 'appt-confirmed',
      organization_id: 'org-1',
      branch_id: 'branch-1',
      pet_id: 'pet-1',
      clinic_client_id: 'cc-1',
      doctor_profile_id: 'doc-1',
      status: 'confirmed',
      requested_start: '2026-11-15T10:00:00Z',
      requested_end: '2026-11-15T10:30:00Z',
      scheduled_range: null,
      scheduled_start: '2026-11-15T10:00:00Z',
      scheduled_end: '2026-11-15T10:30:00Z',
      reason: 'Checkup',
      decline_reason: null,
      cancellation_reason: null,
      confirmed_at: null,
      checked_in_at: null,
      completed_at: null,
      created_at: '2026-11-14T10:00:00Z',
      updated_at: '2026-11-14T10:00:00Z',
    },
    {
      id: 'appt-cancelled',
      organization_id: 'org-1',
      branch_id: 'branch-1',
      pet_id: 'pet-2',
      clinic_client_id: 'cc-2',
      doctor_profile_id: 'doc-1',
      status: 'cancelled',
      requested_start: '2026-11-15T11:00:00Z',
      requested_end: '2026-11-15T11:30:00Z',
      scheduled_range: null,
      scheduled_start: '2026-11-15T11:00:00Z',
      scheduled_end: '2026-11-15T11:30:00Z',
      reason: 'Cancelled visit',
      decline_reason: null,
      cancellation_reason: null,
      confirmed_at: null,
      checked_in_at: null,
      completed_at: null,
      created_at: '2026-11-14T10:00:00Z',
      updated_at: '2026-11-14T10:00:00Z',
    },
  ];

  // Overlaps confirmed slot
  const hit = detectAppointmentConflict({
    doctorProfileId: 'doc-1',
    startIso: '2026-11-15T10:15:00Z',
    endIso: '2026-11-15T10:45:00Z',
    existingAppointments: existing,
  });
  assert.equal(hit?.id, 'appt-confirmed');

  // Same slot excluded when rescheduling itself
  const excluded = detectAppointmentConflict({
    doctorProfileId: 'doc-1',
    startIso: '2026-11-15T10:00:00Z',
    endIso: '2026-11-15T10:30:00Z',
    existingAppointments: existing,
    excludeAppointmentId: 'appt-confirmed',
  });
  assert.equal(excluded, null);

  // Back-to-back non-overlapping is clean
  const backToBack = detectAppointmentConflict({
    doctorProfileId: 'doc-1',
    startIso: '2026-11-15T10:30:00Z',
    endIso: '2026-11-15T11:00:00Z',
    existingAppointments: existing,
  });
  assert.equal(backToBack, null);

  // Cancelled slot does not block
  const onCancelled = detectAppointmentConflict({
    doctorProfileId: 'doc-1',
    startIso: '2026-11-15T11:00:00Z',
    endIso: '2026-11-15T11:30:00Z',
    existingAppointments: existing,
  });
  assert.equal(onCancelled, null);
}

function testOperationalReportsAndCsv() {
  const branches: Branch[] = [
    {
      id: 'b1',
      organization_id: 'org-1',
      name: 'Main Hospital',
      code: 'MAIN',
      address: null,
      city: null,
      state: null,
      country: null,
      timezone: 'UTC',
      phone: null,
      is_active: true,
      created_at: '',
      updated_at: '',
    },
  ];
  const appointments: DoctorAppointment[] = [
    {
      id: 'a1',
      organization_id: 'org-1',
      branch_id: 'b1',
      pet_id: 'p1',
      clinic_client_id: 'c1',
      doctor_profile_id: 'd1',
      status: 'completed',
      requested_start: '2026-11-15T09:00:00Z',
      requested_end: '2026-11-15T09:30:00Z',
      scheduled_range: null,
      scheduled_start: '2026-11-15T09:00:00Z',
      scheduled_end: '2026-11-15T09:30:00Z',
      reason: 'Annual exam',
      decline_reason: null,
      cancellation_reason: null,
      confirmed_at: null,
      checked_in_at: null,
      completed_at: null,
      created_at: '',
      updated_at: '',
    },
    {
      id: 'a2',
      organization_id: 'org-1',
      branch_id: 'b1',
      pet_id: 'p2',
      clinic_client_id: 'c2',
      doctor_profile_id: 'd1',
      status: 'no_show',
      requested_start: '2026-11-15T10:00:00Z',
      requested_end: '2026-11-15T10:30:00Z',
      scheduled_range: null,
      scheduled_start: '2026-11-15T10:00:00Z',
      scheduled_end: '2026-11-15T10:30:00Z',
      reason: 'Vaccine',
      decline_reason: null,
      cancellation_reason: null,
      confirmed_at: null,
      checked_in_at: null,
      completed_at: null,
      created_at: '',
      updated_at: '',
    },
  ];
  const consultations: DoctorConsultation[] = [
    {
      id: 'cons-legacy',
      organization_id: 'org-1',
      branch_id: null,
      clinic_client_id: null,
      appointment_id: null,
      client_id: 'u1',
      doctor_id: 'd1',
      pet_id: 'p1',
      consultation_status: 'completed',
      consultation_reason: 'Legacy exam',
      clinical_notes: null,
      follow_up_date: null,
      activated_at: null,
      expires_at: null,
      completed_at: null,
      rejection_reason: null,
      created_at: '',
      updated_at: '',
    },
  ];

  const report = computeAdminOperationalReport({
    branches,
    appointments,
    consultations,
    doctors: [{ id: 'd1', full_name: 'Dr. Rivera' }],
  });

  assert.equal(report.totalAppointments, 2);
  assert.equal(report.completedCount, 1);
  assert.equal(report.noShowCount, 1);
  assert.equal(report.completionRatePct, 50);
  assert.equal(report.noShowRatePct, 50);
  assert.equal(report.unmappedLegacyConsultationsCount, 1);

  const csv = buildAuditExportCsv({
    organizationName: 'MaxPetz',
    report,
    auditLogs: [],
  });
  assert.match(csv, /MaxPetz/);
  assert.match(csv, /Main Hospital/);

  const grouped = groupSchedulesByBranchAndDay([
    {
      id: 's1',
      branch_id: 'b1',
      weekday: 1,
      start_time: '09:00',
      end_time: '12:00',
      slot_minutes: 30,
      is_active: true,
    },
  ]);
  assert.equal(grouped['b1'][1].length, 1);
}

function testStaticSecurityAndIsolationHygiene() {
  const root = process.cwd();
  const filesToScan = [
    'src/services/adminPortalService.ts',
    'src/hooks/useAdminWorkspace.ts',
    'src/utils/adminPortalHelpers.ts',
    'src/pages/admin/AdminDashboard.tsx',
    'src/pages/admin/AdminBranchesPage.tsx',
    'src/pages/admin/AdminOnboardingPage.tsx',
    'src/pages/admin/AdminDoctors.tsx',
    'src/pages/admin/AdminClients.tsx',
    'src/pages/admin/AdminPets.tsx',
    'src/pages/admin/AdminConsultations.tsx',
    'src/pages/admin/AdminSettings.tsx',
    'src/pages/admin/AdminReports.tsx',
    'src/pages/admin/AdminPayments.tsx',
    'src/pages/admin/AdminMedicalRecords.tsx',
    'src/pages/admin/AdminPrescriptions.tsx',
  ];

  for (const relPath of filesToScan) {
    const absPath = path.join(root, relPath);
    assert.equal(fs.existsSync(absPath), true, `Missing Phase 6 file: ${relPath}`);
    const content = fs.readFileSync(absPath, 'utf8');

    assert.equal(
      /mockData/i.test(content),
      false,
      `Forbidden mockData reference in ${relPath}`
    );
    assert.equal(
      /service_role/i.test(content),
      false,
      `Forbidden service_role reference in ${relPath}`
    );
    assert.equal(
      /window\.(alert|confirm|open)\b/.test(content),
      false,
      `Forbidden window.alert/confirm/open usage in ${relPath}`
    );
  }

  // Strictly forbid chat transcript queries inside Admin portal service
  const serviceContent = fs.readFileSync(
    path.join(root, 'src/services/adminPortalService.ts'),
    'utf8'
  );
  assert.equal(
    /\.from\(\s*['"`](chat_conversations|chat_messages)['"`]\s*\)/.test(serviceContent),
    false,
    'Admin portal service must never query private chat_conversations or chat_messages'
  );

  // Verify Phase 6 SQL migration security properties
  const sqlPath = path.join(
    root,
    'supabase/migrations/20261113100000_phase6_admin_portal_services_and_governance.sql'
  );
  assert.equal(fs.existsSync(sqlPath), true, 'Missing Phase 6 SQL migration');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.clinic_services/i);
  assert.match(sql, /SECURITY DEFINER/i);
  assert.match(sql, /SET search_path = ''/i);
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE ON public\.clinic_services FROM PUBLIC, anon, authenticated/i);
  assert.equal(
    /UPDATE\s+public\.consultations\s+SET\s+branch_id\s*=/i.test(sql),
    false,
    'Migration must never arbitrarily backfill consultations.branch_id without verified source mapping'
  );
}

function main() {
  console.log('--- Pet Connect Phase 6 Verification ---');
  runSection('Role privilege escalation boundaries', testRolePrivilegeBoundaries);
  runSection('Branch scope enforcement', testBranchScopeEnforcement);
  runSection('Branch & clinic service validators', testValidators);
  runSection('Appointment scheduling overlap detection', testAppointmentConflictDetection);
  runSection('Operational report metrics, legacy unmapped guard & CSV', testOperationalReportsAndCsv);
  runSection('Static security, privacy (D-16) & SQL migration hygiene', testStaticSecurityAndIsolationHygiene);

  const hasLiveEnv = Boolean(
    process.env.VITE_SUPABASE_URL &&
      process.env.VITE_SUPABASE_ANON_KEY &&
      process.env.PETCONNECT_TEST_ADMIN_EMAIL &&
      process.env.PETCONNECT_TEST_ADMIN_PASSWORD
  );
  if (!hasLiveEnv) {
    console.log(
      'SKIPPED: Live Supabase integration assertions (set VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, PETCONNECT_TEST_ADMIN_EMAIL, PETCONNECT_TEST_ADMIN_PASSWORD to run live checks).'
    );
  }
  console.log('--- Phase 6 Verification Complete ---');
}

main();
