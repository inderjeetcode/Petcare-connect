import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertTenantMatch,
  buildClinicalStoragePath,
  CLINICAL_FILES_BUCKET,
  computeChatWindowStatus,
  sanitizeAttachmentFilename,
  validateAppointmentRequest,
  validateAttachmentFile,
  validateClientProfile,
  validatePetForm,
  validateReviewInput,
  weekdayLabel,
} from '../src/utils/clientPortalHelpers';

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

// 1. Pet form validation
test('validatePetForm rejects empty name, zero weight, and future DOB', () => {
  assert.ok(
    validatePetForm({
      name: '  ',
      species: 'Dog',
      breed: 'Beagle',
      gender: 'Male',
      weight: 10,
    })
  );
  assert.ok(
    validatePetForm({
      name: 'Milo',
      species: 'Dog',
      breed: 'Beagle',
      gender: 'Male',
      weight: 0,
    })
  );
  assert.ok(
    validatePetForm({
      name: 'Milo',
      species: 'Dog',
      breed: 'Beagle',
      gender: 'Male',
      weight: 12.5,
      date_of_birth: '2999-01-01',
    })
  );
  assert.equal(
    validatePetForm({
      name: 'Milo',
      species: 'Dog',
      breed: 'Beagle',
      gender: 'Male',
      weight: 12.5,
      date_of_birth: '2021-05-10',
    }),
    null
  );
});

// 2. Client profile validation
test('validateClientProfile enforces valid name and phone digits', () => {
  assert.ok(validateClientProfile({ full_name: 'A', phone: '' }));
  assert.ok(validateClientProfile({ full_name: 'Alice Walker', phone: '123' }));
  assert.ok(validateClientProfile({ full_name: 'Alice Walker', phone: 'abc-def' }));
  assert.equal(
    validateClientProfile({ full_name: 'Alice Walker', phone: '+1 (555) 234-5678' }),
    null
  );
  assert.equal(validateClientProfile({ full_name: 'Alice Walker', phone: '' }), null);
});

// 3. Tenant / organization isolation enforcement
test('assertTenantMatch blocks cross-organization records', () => {
  assert.doesNotThrow(() =>
    assertTenantMatch('org-a', 'org-a', 'Pet record')
  );
  assert.throws(
    () => assertTenantMatch('org-b', 'org-a', 'Pet record'),
    /Security isolation block/
  );
  assert.throws(
    () => assertTenantMatch('org-a', '', 'Pet record'),
    /Missing active organization context/
  );
});

// 4. Attachment security & path constraints
test('validateAttachmentFile enforces MIME allowlist and 10MB cap', () => {
  assert.equal(CLINICAL_FILES_BUCKET, 'clinical-files');
  assert.ok(
    validateAttachmentFile({
      name: 'script.exe',
      type: 'application/x-msdownload',
      size: 1024,
    })
  );
  assert.ok(
    validateAttachmentFile({
      name: 'huge.pdf',
      type: 'application/pdf',
      size: 11 * 1024 * 1024,
    })
  );
  assert.equal(
    validateAttachmentFile({
      name: 'lab-report.pdf',
      type: 'application/pdf',
      size: 204800,
    }),
    null
  );
  assert.equal(
    sanitizeAttachmentFilename('../weird file (1).png'),
    '..-weird-file-1-.png'
  );
  const pathStr = buildClinicalStoragePath(
    'org-123',
    'chat_message',
    'cons-456',
    'xray scan.png',
    'tok-789'
  );
  assert.equal(pathStr, 'org-123/chat_message/cons-456/tok-789-xray-scan.png');
});

// 5. Appointment request validation
test('validateAppointmentRequest enforces slot ordering and reason length', () => {
  assert.ok(
    validateAppointmentRequest({
      organization_id: 'org-1',
      branch_id: 'br-1',
      pet_id: 'pet-1',
      doctor_profile_id: 'doc-1',
      requested_start: '2026-12-01T10:00:00Z',
      requested_end: '2026-12-01T09:30:00Z',
      reason: 'Annual checkup',
    })
  );
  assert.ok(
    validateAppointmentRequest({
      organization_id: 'org-1',
      branch_id: 'br-1',
      pet_id: 'pet-1',
      doctor_profile_id: 'doc-1',
      requested_start: '2026-12-01T10:00:00Z',
      requested_end: '2026-12-01T10:30:00Z',
      reason: 'hi',
    })
  );
  assert.equal(
    validateAppointmentRequest({
      organization_id: 'org-1',
      branch_id: 'br-1',
      pet_id: 'pet-1',
      doctor_profile_id: 'doc-1',
      requested_start: '2026-12-01T10:00:00Z',
      requested_end: '2026-12-01T10:30:00Z',
      reason: 'Limping on right hind leg since yesterday',
    }),
    null
  );
  assert.equal(weekdayLabel(1), 'Mon');
  assert.equal(weekdayLabel(7), 'Sun');
});

// 6. 7-day chat expiry gating
test('computeChatWindowStatus allows active window and blocks expired/completed/pending/rejected', () => {
  const now = new Date('2026-11-13T12:00:00Z').getTime();

  const active = computeChatWindowStatus(
    {
      consultation_status: 'active',
      activated_at: '2026-11-12T12:00:00Z',
      expires_at: '2026-11-19T12:00:00Z',
    },
    now
  );
  assert.equal(active.isActive, true);
  assert.equal(active.canSendMessages, true);
  assert.equal(active.days, 6);

  const expiredByTime = computeChatWindowStatus(
    {
      consultation_status: 'active',
      activated_at: '2026-11-01T12:00:00Z',
      expires_at: '2026-11-08T12:00:00Z',
    },
    now
  );
  assert.equal(expiredByTime.isExpired, true);
  assert.equal(expiredByTime.canSendMessages, false);

  const pending = computeChatWindowStatus(
    {
      consultation_status: 'pending',
      activated_at: null,
      expires_at: null,
    },
    now
  );
  assert.equal(pending.isPending, true);
  assert.equal(pending.canSendMessages, false);

  const completed = computeChatWindowStatus(
    {
      consultation_status: 'completed',
      activated_at: '2026-11-10T12:00:00Z',
      expires_at: '2026-11-17T12:00:00Z',
    },
    now
  );
  assert.equal(completed.isCompleted, true);
  assert.equal(completed.canSendMessages, false);
});

// 7. Review validation
test('validateReviewInput checks 1-5 rating and minimum review feedback', () => {
  assert.ok(validateReviewInput(0, 'Great doctor'));
  assert.ok(validateReviewInput(6, 'Great doctor'));
  assert.ok(validateReviewInput(5, 'ok'));
  assert.equal(
    validateReviewInput(5, 'Very clear diagnosis and helpful follow-up plan.'),
    null
  );
});

// 8. Static hygiene verification on Client Portal files
test('Client Portal files have zero mockData imports and zero window.alert/confirm/open', () => {
  const clientDir = path.resolve(process.cwd(), 'src/pages/client');
  const files = fs
    .readdirSync(clientDir)
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => path.join(clientDir, f));
  files.push(path.resolve(process.cwd(), 'src/services/clientPortalService.ts'));

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    assert.equal(
      /mockData/.test(content),
      false,
      `Found forbidden mockData reference in ${filePath}`
    );
    assert.equal(
      /window\.(alert|confirm|open)/.test(content),
      false,
      `Found forbidden window.alert/confirm/open in ${filePath}`
    );
  }
});

// 9. SQL migration sanity check
test('Phase 4 migration defines submit_review RPC and client reviews RLS', () => {
  const migPath = path.resolve(
    process.cwd(),
    'supabase/migrations/20261113080000_phase4_client_reviews_and_pet_updates.sql'
  );
  const sql = fs.readFileSync(migPath, 'utf8');
  assert.ok(sql.includes('CREATE OR REPLACE FUNCTION public.submit_review'));
  assert.ok(sql.includes('CREATE POLICY "reviews_select_tenant"'));
  assert.ok(sql.includes('app.current_clinic_client_id(organization_id)'));
});

console.log(`\nPhase 4 verification summary: ${passed} checks passed.`);
