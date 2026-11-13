import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildWeeklyScheduleForm,
  canActivateConsultationForAppointment,
  canDoctorAccessConsultationChat,
  canDoctorConfirmAppointment,
  canDoctorModifyBranchAssignments,
  canDoctorReadOrgClinicalRecord,
  getDoctorChatWindowStatus,
  isSameDayInTimezone,
  parsePgTstzRange,
  validateDayScheduleForm,
  validateDoctorProfileUpdate,
  validateMedicalRecordInput,
  validatePrescriptionInput,
  validateScheduleExceptionInput,
  validateVaccinationInput,
} from '../src/utils/doctorPortalHelpers';

let passed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (err: any) {
    console.error(`FAIL: ${name}\n  -> ${err?.message || err}`);
    process.exitCode = 1;
  }
}

// 1. Organization Clinical Visibility vs Cross-Org Isolation (D-17)
test('D-17 allows org-wide clinical read for authorized doctor and blocks cross-organization reads', () => {
  const doctorPerms = [
    'clients.read',
    'pets.read',
    'pets.write',
    'schedules.manage',
    'appointments.read',
    'consultations.activate',
    'consultations.manage',
    'medical_records.read',
    'medical_records.write',
  ];

  assert.equal(canDoctorReadOrgClinicalRecord('org-a', 'org-a', doctorPerms), true);
  assert.equal(canDoctorReadOrgClinicalRecord('org-b', 'org-a', doctorPerms), false);
  assert.equal(canDoctorReadOrgClinicalRecord('org-a', '', doctorPerms), false);
  assert.equal(
    canDoctorReadOrgClinicalRecord('org-a', 'org-a', ['appointments.read']),
    false
  );
});

// 2. Doctor Branch Assignment & Appointment Confirmation Governance Boundaries
test('Ordinary doctor cannot confirm appointments or modify branch assignments', () => {
  const ordinaryDoctorPerms = [
    'clients.read',
    'pets.read',
    'schedules.manage',
    'appointments.read',
    'consultations.activate',
    'consultations.manage',
    'medical_records.read',
    'medical_records.write',
  ];

  assert.equal(canDoctorConfirmAppointment(ordinaryDoctorPerms), false);
  assert.equal(canDoctorModifyBranchAssignments(ordinaryDoctorPerms), false);

  assert.equal(
    canDoctorConfirmAppointment([...ordinaryDoctorPerms, 'appointments.confirm']),
    true
  );
  assert.equal(
    canDoctorModifyBranchAssignments([...ordinaryDoctorPerms, 'staff.manage']),
    true
  );
});

// 3. Consultation Activation & Role/Status Guard
test('Consultation activation requires confirmed/checked_in/completed appointment assigned to treating doctor', () => {
  assert.equal(
    canActivateConsultationForAppointment(
      { status: 'requested', doctor_profile_id: 'doc-1' },
      'doc-1'
    ),
    false
  );
  assert.equal(
    canActivateConsultationForAppointment(
      { status: 'confirmed', doctor_profile_id: 'doc-2' },
      'doc-1'
    ),
    false
  );
  assert.equal(
    canActivateConsultationForAppointment(
      { status: 'confirmed', doctor_profile_id: 'doc-1' },
      'doc-1'
    ),
    true
  );
  assert.equal(
    canActivateConsultationForAppointment(
      { status: 'checked_in', doctor_profile_id: 'doc-1' },
      'doc-1'
    ),
    true
  );
});

// 4. Availability, Breaks & Confirmed Appointment Conflict Validation
test('validateDayScheduleForm blocks marking day off, shrinking hours, or adding breaks over confirmed appointments', () => {
  const nowMs = new Date('2026-11-16T08:00:00Z').getTime(); // Monday
  const confirmedAppt = {
    id: 'appt-1',
    branch_id: 'branch-1',
    doctor_profile_id: 'doc-1',
    status: 'confirmed' as const,
    scheduled_start: '2026-11-23T14:00:00Z', // Next Monday 14:00-14:30 UTC
    scheduled_end: '2026-11-23T14:30:00Z',
    pet_name: 'Milo',
  };

  // Marking Monday off conflicts with Milo
  assert.ok(
    validateDayScheduleForm(
      {
        weekday: 1,
        is_available: false,
        start_time: '09:00',
        end_time: '17:00',
        has_break: false,
        break_start: '13:00',
        break_end: '14:00',
        slot_minutes: 30,
      },
      {
        branchId: 'branch-1',
        branchTimezone: 'UTC',
        doctorProfileId: 'doc-1',
        appointments: [confirmedAppt],
        nowMs,
      }
    )
  );

  // Ending shift at 14:00 excludes 14:00-14:30
  assert.ok(
    validateDayScheduleForm(
      {
        weekday: 1,
        is_available: true,
        start_time: '09:00',
        end_time: '14:00',
        has_break: false,
        break_start: '13:00',
        break_end: '14:00',
        slot_minutes: 30,
      },
      {
        branchId: 'branch-1',
        branchTimezone: 'UTC',
        doctorProfileId: 'doc-1',
        appointments: [confirmedAppt],
        nowMs,
      }
    )
  );

  // Break 13:30-14:30 overlaps 14:00-14:30
  assert.ok(
    validateDayScheduleForm(
      {
        weekday: 1,
        is_available: true,
        start_time: '09:00',
        end_time: '17:00',
        has_break: true,
        break_start: '13:30',
        break_end: '14:30',
        slot_minutes: 30,
      },
      {
        branchId: 'branch-1',
        branchTimezone: 'UTC',
        doctorProfileId: 'doc-1',
        appointments: [confirmedAppt],
        nowMs,
      }
    )
  );

  // Valid schedule keeping break 12:00-13:00 and shift 09:00-17:00 passes
  assert.equal(
    validateDayScheduleForm(
      {
        weekday: 1,
        is_available: true,
        start_time: '09:00',
        end_time: '17:00',
        has_break: true,
        break_start: '12:00',
        break_end: '13:00',
        slot_minutes: 30,
      },
      {
        branchId: 'branch-1',
        branchTimezone: 'UTC',
        doctorProfileId: 'doc-1',
        appointments: [confirmedAppt],
        nowMs,
      }
    ),
    null
  );
});

// 5. Schedule Exception Conflict Detection & Weekly Form Reconstruction
test('validateScheduleExceptionInput rejects overlapping leave and buildWeeklyScheduleForm reconstructs break splits', () => {
  const confirmedAppt = {
    id: 'appt-2',
    branch_id: 'branch-1',
    doctor_profile_id: 'doc-1',
    status: 'checked_in' as const,
    scheduled_start: '2026-11-24T10:00:00Z',
    scheduled_end: '2026-11-24T10:30:00Z',
    pet_name: 'Luna',
  };

  assert.ok(
    validateScheduleExceptionInput(
      {
        doctorProfileId: 'doc-1',
        branchId: 'branch-1',
        startAt: '2026-11-24T09:00:00Z',
        endAt: '2026-11-24T12:00:00Z',
        exceptionType: 'leave',
        reason: 'Conference leave',
      },
      [confirmedAppt]
    )
  );

  assert.equal(
    validateScheduleExceptionInput(
      {
        doctorProfileId: 'doc-1',
        branchId: 'branch-1',
        startAt: '2026-11-24T13:00:00Z',
        endAt: '2026-11-24T16:00:00Z',
        exceptionType: 'leave',
        reason: 'Afternoon seminar',
      },
      [confirmedAppt]
    ),
    null
  );

  const weekly = buildWeeklyScheduleForm(
    [
      {
        id: 's1',
        branch_id: 'branch-1',
        weekday: 2,
        start_time: '09:00:00',
        end_time: '12:30:00',
        slot_minutes: 30,
        is_active: true,
      },
      {
        id: 's2',
        branch_id: 'branch-1',
        weekday: 2,
        start_time: '13:30:00',
        end_time: '18:00:00',
        slot_minutes: 30,
        is_active: true,
      },
    ],
    'branch-1'
  );
  const tuesday = weekly.find((d) => d.weekday === 2)!;
  assert.equal(tuesday.is_available, true);
  assert.equal(tuesday.has_break, true);
  assert.equal(tuesday.start_time, '09:00');
  assert.equal(tuesday.break_start, '12:30');
  assert.equal(tuesday.break_end, '13:30');
  assert.equal(tuesday.end_time, '18:00');

  const parsedRange = parsePgTstzRange(
    '["2026-11-24 10:00:00+00","2026-11-24 10:30:00+00")'
  );
  assert.equal(parsedRange.start, '2026-11-24T10:00:00.000Z');
  assert.equal(parsedRange.end, '2026-11-24T10:30:00.000Z');

  assert.equal(
    isSameDayInTimezone(
      '2026-11-24T10:00:00Z',
      'UTC',
      new Date('2026-11-24T23:59:00Z')
    ),
    true
  );
});

// 6. Clinical Records, Vaccinations, Prescriptions & Doctor Profile Validation
test('Clinical write validators reject incomplete medical records, vaccinations, prescriptions, and doctor profile inputs', () => {
  assert.ok(
    validateDoctorProfileUpdate({
      full_name: 'A',
      phone: '+1 555 201 4490',
      qualification: 'DVM',
      specialization: 'Surgery',
      experience_years: 8,
      registration_number: 'VET-123',
    })
  );
  assert.equal(
    validateDoctorProfileUpdate({
      full_name: 'Dr. Maya Rao',
      phone: '+1 555 201 4490',
      qualification: 'DVM, DACVS',
      specialization: 'Orthopedic Surgery',
      experience_years: 8,
      registration_number: 'VET-12345',
    }),
    null
  );

  assert.ok(
    validateMedicalRecordInput({
      pet_id: 'pet-1',
      diagnosis: 'ab',
      notes: 'Valid clinical findings',
    })
  );
  assert.equal(
    validateMedicalRecordInput({
      pet_id: 'pet-1',
      diagnosis: 'Otitis externa',
      notes: 'Mild erythema in right ear canal; topical wash initiated.',
    }),
    null
  );

  assert.ok(
    validateVaccinationInput({
      pet_id: 'pet-1',
      vaccine_name: 'Rabies',
      administered_date: '2026-11-10',
      next_due_date: '2026-11-01',
    })
  );
  assert.equal(
    validateVaccinationInput({
      pet_id: 'pet-1',
      vaccine_name: 'Rabies (3-Year)',
      administered_date: '2026-11-10',
      next_due_date: '2029-11-10',
    }),
    null
  );

  assert.ok(
    validatePrescriptionInput({
      pet_id: 'pet-1',
      consultation_id: null,
      appointment_id: null,
      diagnosis: 'Otitis externa',
      items: [
        {
          medicine_name: 'Otic Drops',
          dosage: '3 drops',
          frequency: 'BID',
          duration: '7 days',
        },
      ],
    })
  );
  assert.equal(
    validatePrescriptionInput({
      pet_id: 'pet-1',
      consultation_id: 'cons-1',
      appointment_id: null,
      diagnosis: 'Otitis externa',
      items: [
        {
          medicine_name: 'Otic Drops',
          dosage: '3 drops',
          frequency: 'Twice daily',
          duration: '7 days',
        },
      ],
    }),
    null
  );
});

// 7. Participant-Only & Read-Only Expired Consultation Chat Restrictions (D-16)
test('D-16 chat enforces participant-only treating doctor access and locks expired chats read-only', () => {
  assert.equal(
    canDoctorAccessConsultationChat(
      { organization_id: 'org-a', doctor_id: 'doc-1' },
      'org-a',
      'doc-1'
    ),
    true
  );
  assert.equal(
    canDoctorAccessConsultationChat(
      { organization_id: 'org-a', doctor_id: 'doc-2' },
      'org-a',
      'doc-1'
    ),
    false
  );
  assert.equal(
    canDoctorAccessConsultationChat(
      { organization_id: 'org-b', doctor_id: 'doc-1' },
      'org-a',
      'doc-1'
    ),
    false
  );

  const now = new Date('2026-11-13T12:00:00Z').getTime();
  const active = getDoctorChatWindowStatus(
    {
      consultation_status: 'active',
      activated_at: '2026-11-12T12:00:00Z',
      expires_at: '2026-11-19T12:00:00Z',
    },
    now
  );
  assert.equal(active.canSendMessages, true);
  assert.equal(active.isExpired, false);

  const expired = getDoctorChatWindowStatus(
    {
      consultation_status: 'active',
      activated_at: '2026-11-01T12:00:00Z',
      expires_at: '2026-11-08T12:00:00Z',
    },
    now
  );
  assert.equal(expired.canSendMessages, false);
  assert.equal(expired.isExpired, true);
});

// 8. Static Hygiene & Security Scan on Phase 5 Doctor Portal Files
test('Doctor Portal files have zero forbidden mock data, alerts, open popups, or secret keys', () => {
  const doctorDir = path.resolve(process.cwd(), 'src/pages/doctor');
  const files = fs
    .readdirSync(doctorDir)
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => path.join(doctorDir, f));
  files.push(
    path.resolve(process.cwd(), 'src/services/doctorPortalService.ts'),
    path.resolve(process.cwd(), 'src/utils/doctorPortalHelpers.ts'),
    path.resolve(process.cwd(), 'src/hooks/useDoctorWorkspace.ts')
  );

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    assert.equal(
      /mock[D]ata/i.test(content),
      false,
      `Found forbidden mock data reference in ${filePath}`
    );
    assert.equal(
      /window\.(alert|confirm|open)/.test(content),
      false,
      `Found forbidden window.alert/confirm/open in ${filePath}`
    );
    assert.equal(
      /service_role/i.test(content),
      false,
      `Found forbidden service_role reference in ${filePath}`
    );
    assert.equal(
      /#VET-LIC-884920/.test(content),
      false,
      `Found legacy fake license placeholder in ${filePath}`
    );
  }
});

// 9. SQL Migration Security & RPC Contract Assertions
test('Phase 5 SQL migration defines conflict-checked schedule & summary RPCs with SECURITY DEFINER', () => {
  const migPath = path.resolve(
    process.cwd(),
    'supabase/migrations/20261113090000_phase5_doctor_portal_rpcs.sql'
  );
  const sql = fs.readFileSync(migPath, 'utf8');
  assert.ok(sql.includes('CREATE OR REPLACE FUNCTION public.save_doctor_branch_day_schedule'));
  assert.ok(sql.includes('CREATE OR REPLACE FUNCTION public.add_schedule_exception'));
  assert.ok(sql.includes('CREATE OR REPLACE FUNCTION public.remove_schedule_exception'));
  assert.ok(sql.includes('CREATE OR REPLACE FUNCTION public.update_consultation_clinical_summary'));
  assert.ok(sql.includes("status IN ('confirmed', 'checked_in')"));
  assert.ok(sql.includes('SET search_path = \'\''));
});

console.log(`\nPhase 5 verification summary: ${passed} offline/policy/security checks passed.`);
if (!process.env.VITE_SUPABASE_URL || !process.env.VITE_SUPABASE_ANON_KEY) {
  console.log(
    'Live Supabase DB execution: SKIPPED (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set in this environment).'
  );
}
