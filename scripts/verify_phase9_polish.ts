/**
 * Phase 9 Reports, Notifications & UI Polish Verification Script
 *
 * Tests all Phase 9 domain logic, multi-portal reports, notification routing &
 * deduplication, filtering/sorting/pagination helpers, static SQL migration
 * invariants, and UI hygiene across all 5 portals.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  compareIsoDates,
  compareStrings,
  computeClientSummaryReport,
  computeDoctorWorkloadReport,
  deduplicateNotifications,
  getInitials,
  isWithinDateRange,
  paginateItems,
  resolveNotificationUrl,
  sortItems,
} from '../src/utils/listManagementHelpers';
import {
  buildAuditExportCsv,
  computeAdminClientPetMetrics,
  computeAdminOperationalReport,
  computeServiceUsageSummary,
} from '../src/utils/adminPortalHelpers';
import { computePlatformActivationStats } from '../src/utils/platformPortalHelpers';
import type { WorkspaceOption } from '../src/types/auth';
import type {
  ClientAppointment,
  ClientConsultation,
  ClientPet,
  ClientPrescription,
} from '../src/types/client';
import type { DoctorAppointment, DoctorConsultation } from '../src/types/doctor';
import type { Branch } from '../src/types/index';

function runSection(name: string, fn: () => void) {
  fn();
  console.log(`PASS: ${name}`);
}

function testPaginationFilteringSortingInitials() {
  const items = Array.from({ length: 23 }, (_, idx) => ({
    id: `item-${idx + 1}`,
    name: `Record ${String(idx + 1).padStart(2, '0')}`,
    created_at: `2026-11-${String((idx % 20) + 1).padStart(2, '0')}T10:00:00.000Z`,
  }));

  const p1 = paginateItems(items, 1, 10);
  assert.equal(p1.totalItems, 23);
  assert.equal(p1.totalPages, 3);
  assert.equal(p1.startIndex, 1);
  assert.equal(p1.endIndex, 10);
  assert.equal(p1.items.length, 10);

  const p3 = paginateItems(items, 3, 10);
  assert.equal(p3.startIndex, 21);
  assert.equal(p3.endIndex, 23);
  assert.equal(p3.items.length, 3);

  // Clamping out-of-range page and empty lists
  const clamped = paginateItems(items, 99, 10);
  assert.equal(clamped.currentPage, 3);
  const empty = paginateItems([], 1, 10);
  assert.equal(empty.totalPages, 1);
  assert.equal(empty.startIndex, 0);
  assert.equal(empty.endIndex, 0);

  // Date range check
  assert.equal(isWithinDateRange('2026-11-10T12:00:00.000Z', '2026-11-10', '2026-11-10'), true);
  assert.equal(isWithinDateRange('2026-11-09T12:00:00.000Z', '2026-11-10', '2026-11-12'), false);
  assert.equal(isWithinDateRange(null, '2026-11-10', ''), false);
  assert.equal(isWithinDateRange(null, '', ''), true);

  // Sorting & comparators
  const sortedAsc = sortItems(items.slice(0, 3), (a, b) => compareStrings(a.name, b.name), 'asc');
  assert.equal(sortedAsc[0].name, 'Record 01');
  const sortedDesc = sortItems(
    items.slice(0, 3),
    (a, b) => compareIsoDates(a.created_at, b.created_at),
    'desc'
  );
  assert.equal(sortedDesc[0].id, 'item-3');

  // Local initials helper (replaces external avatar image service)
  assert.equal(getInitials('Inderjeet Singh'), 'IS');
  assert.equal(getInitials('Maya'), 'MA');
  assert.equal(getInitials(''), 'PC');
}

function testNotificationsDeduplicationAndRouting() {
  const deduped = deduplicateNotifications([
    { id: 'n-1', title: 'First' },
    { id: 'n-2', title: 'Second' },
    { id: 'n-1', title: 'Duplicate' },
    { id: '', title: 'Empty ID' },
  ]);
  assert.equal(deduped.length, 2);
  assert.equal(deduped[0].title, 'First');

  const workspace: WorkspaceOption = {
    key: 'staff-org-1',
    portal: 'admin',
    organization_id: 'org-1',
    organization_slug: 'happy-paws',
    organization_name: 'Happy Paws',
    label: 'Happy Paws (Admin)',
    sublabel: 'Organization Admin',
    default_path: '/happy-paws/admin/dashboard',
    roles: ['org_admin'],
    permissions: ['audit.read'],
    branch_ids: ['branch-1'],
  };

  assert.equal(resolveNotificationUrl('/client/appointments', workspace), '/happy-paws/client/appointments');
  assert.equal(resolveNotificationUrl('/doctor/consultations', workspace), '/happy-paws/doctor/consultations');
  assert.equal(resolveNotificationUrl('/admin/reports', workspace), '/happy-paws/admin/reports');
  assert.equal(resolveNotificationUrl('/platform/organizations', workspace), '/platform/organizations');
  assert.equal(resolveNotificationUrl('/client/appointments', null), '/workspaces');
  assert.equal(resolveNotificationUrl('/happy-paws/doctor/chat', null), '/happy-paws/doctor/chat');
  assert.equal(resolveNotificationUrl('invalid-relative-link', workspace), null);
}

function testClientAndDoctorReports() {
  const pets: ClientPet[] = [
    {
      id: 'pet-1',
      organization_id: 'org-1',
      owner_id: 'user-1',
      name: 'Milo',
      species: 'Dog',
      breed: 'Labrador',
      date_of_birth: '2023-01-01',
      gender: 'Male',
      weight: 22,
      color: 'Golden',
      avatar_url: null,
      allergies: null,
      medical_notes: null,
      archived_at: null,
      created_at: '2026-10-01T00:00:00.000Z',
      updated_at: '2026-10-01T00:00:00.000Z',
    },
    {
      id: 'pet-2',
      organization_id: 'org-1',
      owner_id: 'user-1',
      name: 'Luna',
      species: 'Cat',
      breed: 'Tabby',
      date_of_birth: '2021-01-01',
      gender: 'Female',
      weight: 4.5,
      color: 'Grey',
      avatar_url: null,
      allergies: null,
      medical_notes: null,
      archived_at: '2026-11-01T00:00:00.000Z',
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-11-01T00:00:00.000Z',
    },
  ];

  const clientAppts: ClientAppointment[] = [
    {
      id: 'a-1',
      organization_id: 'org-1',
      branch_id: 'b-1',
      clinic_client_id: 'cc-1',
      pet_id: 'pet-1',
      pet_name: 'Milo',
      doctor_profile_id: 'doc-1',
      requested_start: '2026-11-10T10:00:00.000Z',
      requested_end: '2026-11-10T10:30:00.000Z',
      scheduled_range: '[2026-11-10 10:00:00+00,2026-11-10 10:30:00+00)',
      scheduled_start: '2026-11-10T10:00:00.000Z',
      scheduled_end: '2026-11-10T10:30:00.000Z',
      status: 'completed',
      reason: 'Checkup',
      decline_reason: null,
      cancellation_reason: null,
      confirmed_at: '2026-11-02T00:00:00.000Z',
      checked_in_at: '2026-11-10T09:55:00.000Z',
      completed_at: '2026-11-10T10:30:00.000Z',
      created_at: '2026-11-01T00:00:00.000Z',
      updated_at: '2026-11-10T10:30:00.000Z',
    },
    {
      id: 'a-2',
      organization_id: 'org-1',
      branch_id: 'b-1',
      clinic_client_id: 'cc-1',
      pet_id: 'pet-1',
      pet_name: 'Milo',
      doctor_profile_id: 'doc-1',
      requested_start: '2026-11-20T10:00:00.000Z',
      requested_end: '2026-11-20T10:30:00.000Z',
      scheduled_range: null,
      scheduled_start: null,
      scheduled_end: null,
      status: 'requested',
      reason: 'Follow-up',
      decline_reason: null,
      cancellation_reason: null,
      confirmed_at: null,
      checked_in_at: null,
      completed_at: null,
      created_at: '2026-11-05T00:00:00.000Z',
      updated_at: '2026-11-05T00:00:00.000Z',
    },
  ];

  const clientCons: ClientConsultation[] = [
    {
      id: 'c-1',
      organization_id: 'org-1',
      branch_id: 'b-1',
      appointment_id: 'a-1',
      pet_id: 'pet-1',
      clinic_client_id: 'cc-1',
      client_id: 'user-1',
      doctor_id: 'doc-1',
      consultation_reason: 'Checkup',
      consultation_status: 'active',
      activated_at: '2026-11-10T10:05:00.000Z',
      expires_at: '2099-11-17T10:05:00.000Z',
      completed_at: null,
      rejection_reason: null,
      created_at: '2026-11-10T10:05:00.000Z',
      updated_at: '2026-11-10T10:05:00.000Z',
    },
  ];

  const clientRx: ClientPrescription[] = [
    {
      id: 'rx-1',
      organization_id: 'org-1',
      branch_id: 'b-1',
      consultation_id: 'c-1',
      appointment_id: 'a-1',
      pet_id: 'pet-1',
      doctor_id: 'doc-1',
      client_id: 'user-1',
      status: 'issued',
      diagnosis: 'Healthy',
      instructions: null,
      follow_up_date: null,
      void_reason: null,
      voided_at: null,
      items: [],
      created_at: '2026-11-10T10:15:00.000Z',
    },
  ];

  const clientReport = computeClientSummaryReport({
    pets,
    appointments: clientAppts,
    consultations: clientCons,
    prescriptions: clientRx,
  });

  assert.equal(clientReport.totalPets, 2);
  assert.equal(clientReport.activePets, 1);
  assert.equal(clientReport.archivedPets, 1);
  assert.equal(clientReport.completedAppointments, 1);
  assert.equal(clientReport.requestedAppointments, 1);
  assert.equal(clientReport.activeConsultations, 1);
  assert.equal(clientReport.issuedPrescriptions, 1);
  assert.equal(clientReport.petSummaries[0].appointmentCount, 2);

  // Doctor workload report filtered by branch & date range
  const docAppts: DoctorAppointment[] = [
    {
      id: 'da-1',
      organization_id: 'org-1',
      branch_id: 'b-1',
      branch_name: 'Main Branch',
      clinic_client_id: 'cc-1',
      pet_id: 'pet-1',
      doctor_profile_id: 'doc-1',
      requested_start: '2026-11-10T10:00:00.000Z',
      requested_end: '2026-11-10T10:30:00.000Z',
      scheduled_range: null,
      scheduled_start: '2026-11-10T10:00:00.000Z',
      scheduled_end: '2026-11-10T10:30:00.000Z',
      status: 'completed',
      reason: 'Exam',
      decline_reason: null,
      cancellation_reason: null,
      confirmed_at: null,
      checked_in_at: null,
      completed_at: null,
      created_at: '2026-11-01T00:00:00.000Z',
      updated_at: '2026-11-10T10:30:00.000Z',
    },
    {
      id: 'da-2',
      organization_id: 'org-1',
      branch_id: 'b-2',
      branch_name: 'West Branch',
      clinic_client_id: 'cc-2',
      pet_id: 'pet-2',
      doctor_profile_id: 'doc-1',
      requested_start: '2026-11-12T10:00:00.000Z',
      requested_end: '2026-11-12T10:30:00.000Z',
      scheduled_range: null,
      scheduled_start: '2026-11-12T10:00:00.000Z',
      scheduled_end: '2026-11-12T10:30:00.000Z',
      status: 'no_show',
      reason: 'Follow-up',
      decline_reason: null,
      cancellation_reason: null,
      confirmed_at: null,
      checked_in_at: null,
      completed_at: null,
      created_at: '2026-11-02T00:00:00.000Z',
      updated_at: '2026-11-12T10:30:00.000Z',
    },
  ];

  const docCons: DoctorConsultation[] = [
    {
      id: 'dc-1',
      organization_id: 'org-1',
      branch_id: 'b-1',
      branch_name: 'Main Branch',
      appointment_id: 'da-1',
      clinic_client_id: 'cc-1',
      client_id: 'user-1',
      pet_id: 'pet-1',
      doctor_id: 'doc-1',
      consultation_reason: 'Exam',
      clinical_notes: null,
      follow_up_date: null,
      consultation_status: 'active',
      activated_at: '2026-11-10T10:05:00.000Z',
      expires_at: '2099-11-17T10:05:00.000Z',
      completed_at: null,
      rejection_reason: null,
      created_at: '2026-11-10T10:05:00.000Z',
      updated_at: '2026-11-10T10:05:00.000Z',
    },
  ];

  const fullWorkload = computeDoctorWorkloadReport({
    appointments: docAppts,
    consultations: docCons,
    medicalRecordsCount: 4,
    prescriptionsCount: 2,
    vaccinationsCount: 1,
  });
  assert.equal(fullWorkload.completionRatePct, 50);
  assert.equal(fullWorkload.uniquePatientsSeen, 2);
  assert.equal(fullWorkload.byBranch.length, 2);

  const b1Workload = computeDoctorWorkloadReport({
    appointments: docAppts,
    consultations: docCons,
    branchId: 'b-1',
  });
  assert.equal(b1Workload.totalAppointments, 1);
  assert.equal(b1Workload.completionRatePct, 100);
}

function testAdminAndPlatformReports() {
  const branches: Branch[] = [
    {
      id: 'b-1',
      organization_id: 'org-1',
      name: 'Main Clinic',
      code: 'MAIN',
      address: '123 Main St',
      city: 'Austin',
      state: 'TX',
      country: 'US',
      timezone: 'UTC',
      phone: null,
      is_active: true,
      created_at: '2026-10-01T00:00:00.000Z',
      updated_at: '2026-10-01T00:00:00.000Z',
    },
  ];
  const appts: DoctorAppointment[] = [
    {
      id: 'aa-1',
      organization_id: 'org-1',
      branch_id: 'b-1',
      service_id: 'svc-1',
      clinic_client_id: 'cc-1',
      pet_id: 'pet-1',
      doctor_profile_id: 'doc-1',
      requested_start: '2026-11-10T09:00:00.000Z',
      requested_end: '2026-11-10T09:30:00.000Z',
      scheduled_range: null,
      scheduled_start: '2026-11-10T09:00:00.000Z',
      scheduled_end: '2026-11-10T09:30:00.000Z',
      status: 'completed',
      reason: 'Vaccination',
      decline_reason: null,
      cancellation_reason: null,
      confirmed_at: null,
      checked_in_at: null,
      completed_at: null,
      created_at: '2026-11-01T00:00:00.000Z',
      updated_at: '2026-11-10T09:30:00.000Z',
    },
  ];
  const services = [
    {
      id: 'svc-1',
      name: 'Wellness Vaccination',
      code: 'VAX-01',
      category: 'vaccination' as const,
      duration_minutes: 30,
      price: 75,
      is_active: true,
    },
  ];

  const report = computeAdminOperationalReport({
    branches,
    appointments: appts,
    consultations: [],
    doctors: [{ id: 'doc-1', full_name: 'Dr. Rivera' }],
  });
  const serviceSummaries = computeServiceUsageSummary(services, appts);
  assert.equal(serviceSummaries[0].bookingCount, 1);
  assert.equal(serviceSummaries[0].estimatedCompletedRevenue, 75);

  const clientPetMetrics = computeAdminClientPetMetrics(
    [
      { status: 'approved', user_id: 'u-1' },
      { status: 'approved', user_id: null },
      { status: 'requested', user_id: 'u-2' },
    ],
    [{ archived_at: null }, { archived_at: null }, { archived_at: '2026-10-01T00:00:00Z' }]
  );
  assert.equal(clientPetMetrics.approvedClients, 2);
  assert.equal(clientPetMetrics.walkInClients, 1);
  assert.equal(clientPetMetrics.totalPets, 2);
  assert.equal(clientPetMetrics.avgPetsPerApprovedClient, 1);

  const csv = buildAuditExportCsv({
    organizationName: 'Happy Paws',
    report,
    auditLogs: [],
    serviceSummaries,
    clientPetMetrics,
  });
  assert.ok(csv.includes('Wellness Vaccination'));
  assert.ok(csv.includes('Clients & Pets'));

  // Platform Owner activation statistics (strictly non-PHI)
  const activation = computePlatformActivationStats({
    organizations: [
      { status: 'active' },
      { status: 'active' },
      { status: 'suspended' },
      { status: 'pending' },
    ],
    applications: [
      { status: 'approved' },
      { status: 'approved' },
      { status: 'rejected' },
      { status: 'pending' },
    ],
  });
  assert.equal(activation.approvalRatePct, 67);
  assert.equal(activation.activeRatioPct, 50);
  assert.equal(activation.suspensionRatePct, 25);
  assert.equal(activation.pendingApplications, 1);
}

function testSqlMigrationAndStaticUiHygiene() {
  const rootDir = process.cwd();
  const migrationPath = path.join(
    rootDir,
    'supabase/migrations/20261113130000_phase9_reports_notifications_indexes.sql'
  );
  const sql = fs.readFileSync(migrationPath, 'utf8');

  assert.ok(sql.includes('GRANT UPDATE (is_read) ON public.notifications TO authenticated'));
  assert.ok(sql.includes('CREATE OR REPLACE FUNCTION app.enqueue_notification'));
  assert.ok(sql.includes("interval '60 seconds'"));
  assert.ok(sql.includes('get_org_service_summary'));
  assert.ok(sql.includes('idx_notifications_user_unread_created_desc'));
  assert.ok(sql.includes('idx_appointments_org_doctor_status_start_desc'));

  // Verify no external avatar generator, alert, confirm, or window.open remain in src
  const srcFiles: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== 'dist') walk(full);
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        srcFiles.push(full);
      }
    }
  };
  walk(path.join(rootDir, 'src'));

  for (const file of srcFiles) {
    const content = fs.readFileSync(file, 'utf8');
    assert.ok(!content.includes('ui-avatars.com'), `External ui-avatars.com found in ${file}`);
    assert.ok(!/window\.(alert|confirm|open)\(/.test(content), `Prohibited window dialog in ${file}`);
  }
}

runSection('1. Pagination, Date Filtering, Sorting & Local Initials', testPaginationFilteringSortingInitials);
runSection('2. Notifications Deduplication & 5-Portal Navigation Routing', testNotificationsDeduplicationAndRouting);
runSection('3. Client & Doctor Authorized Report Computations', testClientAndDoctorReports);
runSection('4. Organization Admin & Platform Owner Analytics + CSV Export', testAdminAndPlatformReports);
runSection('5. SQL Migration Guarantees & Static UI Hygiene', testSqlMigrationAndStaticUiHygiene);

console.log('\nALL PHASE 9 VERIFICATION CHECKS PASSED.');
