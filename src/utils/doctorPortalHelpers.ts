import {
  DoctorAppointment,
  DoctorConsultation,
  DoctorDayScheduleForm,
  DoctorScheduleException,
  DoctorSlotSummary,
} from '../types/doctor';
import {
  ChatWindowStatus,
  computeChatWindowStatus,
} from './clientPortalHelpers';

export const ISO_WEEKDAYS: Array<{ weekday: number; label: string; shortLabel: string }> = [
  { weekday: 1, label: 'Monday', shortLabel: 'Mon' },
  { weekday: 2, label: 'Tuesday', shortLabel: 'Tue' },
  { weekday: 3, label: 'Wednesday', shortLabel: 'Wed' },
  { weekday: 4, label: 'Thursday', shortLabel: 'Thu' },
  { weekday: 5, label: 'Friday', shortLabel: 'Fri' },
  { weekday: 6, label: 'Saturday', shortLabel: 'Sat' },
  { weekday: 7, label: 'Sunday', shortLabel: 'Sun' },
];

export const SCHEDULE_SLOT_DURATIONS = [15, 20, 30, 45, 60] as const;

export function parsePgTstzRange(
  rangeText: string | null | undefined
): { start: string | null; end: string | null } {
  if (!rangeText || typeof rangeText !== 'string') {
    return { start: null, end: null };
  }
  const trimmed = rangeText.trim();
  const match = trimmed.match(/^[[(]"?([^",]+)"?\s*,\s*"?([^"\])]+)"?[\])]$/);
  if (!match) {
    return { start: null, end: null };
  }
  const startRaw = match[1]?.trim();
  const endRaw = match[2]?.trim();
  const startDate = startRaw ? new Date(startRaw) : null;
  const endDate = endRaw ? new Date(endRaw) : null;
  return {
    start: startDate && !Number.isNaN(startDate.getTime()) ? startDate.toISOString() : null,
    end: endDate && !Number.isNaN(endDate.getTime()) ? endDate.toISOString() : null,
  };
}

export function normalizeHHMM(timeText: string | null | undefined, fallback: string): string {
  if (!timeText) return fallback;
  const m = timeText.trim().match(/^(\d{2}:\d{2})/);
  return m ? m[1] : fallback;
}

export function timeStringToMinutes(hhmm: string): number {
  const match = hhmm.trim().match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match) return -1;
  const hours = Number(match[1]);
  const mins = Number(match[2]);
  if (hours < 0 || hours > 23 || mins < 0 || mins > 59) return -1;
  return hours * 60 + mins;
}

/**
 * Reconstructs the 7-day working hours & break form from raw doctor_schedules rows for a branch.
 */
export function buildWeeklyScheduleForm(
  schedules: DoctorSlotSummary[],
  branchId: string
): DoctorDayScheduleForm[] {
  const branchRows = schedules.filter((s) => s.branch_id === branchId && s.is_active);
  return ISO_WEEKDAYS.map(({ weekday }) => {
    const dayRows = branchRows
      .filter((s) => s.weekday === weekday)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));

    if (dayRows.length === 0) {
      return {
        weekday,
        is_available: false,
        start_time: '09:00',
        end_time: '17:00',
        has_break: false,
        break_start: '13:00',
        break_end: '14:00',
        slot_minutes: 30,
      };
    }

    if (dayRows.length === 1) {
      return {
        weekday,
        is_available: true,
        start_time: normalizeHHMM(dayRows[0].start_time, '09:00'),
        end_time: normalizeHHMM(dayRows[0].end_time, '17:00'),
        has_break: false,
        break_start: '13:00',
        break_end: '14:00',
        slot_minutes: Number(dayRows[0].slot_minutes) || 30,
      };
    }

    const first = dayRows[0];
    const last = dayRows[dayRows.length - 1];
    return {
      weekday,
      is_available: true,
      start_time: normalizeHHMM(first.start_time, '09:00'),
      end_time: normalizeHHMM(last.end_time, '17:00'),
      has_break: true,
      break_start: normalizeHHMM(first.end_time, '13:00'),
      break_end: normalizeHHMM(dayRows[1].start_time, '14:00'),
      slot_minutes: Number(first.slot_minutes) || 30,
    };
  });
}

function getZonedDateParts(
  iso: string,
  timeZone: string
): { isoWeekday: number; dateKey: string; minutes: number } | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const map = new Map(parts.map((p) => [p.type, p.value]));
    const wkMap: Record<string, number> = {
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
      Sun: 7,
    };
    const isoWeekday = wkMap[map.get('weekday') || ''] || 1;
    const hour = Number(map.get('hour') || '0') % 24;
    const minute = Number(map.get('minute') || '0');
    const dateKey = `${map.get('year')}-${map.get('month')}-${map.get('day')}`;
    return { isoWeekday, dateKey, minutes: hour * 60 + minute };
  } catch {
    const day = date.getUTCDay();
    const isoWeekday = day === 0 ? 7 : day;
    const dateKey = date.toISOString().slice(0, 10);
    return {
      isoWeekday,
      dateKey,
      minutes: date.getUTCHours() * 60 + date.getUTCMinutes(),
    };
  }
}

export function validateDayScheduleForm(
  form: DoctorDayScheduleForm,
  params: {
    branchId: string;
    branchTimezone: string;
    doctorProfileId: string;
    appointments: Pick<
      DoctorAppointment,
      | 'id'
      | 'branch_id'
      | 'doctor_profile_id'
      | 'status'
      | 'scheduled_start'
      | 'scheduled_end'
      | 'pet_name'
    >[];
    nowMs?: number;
  }
): string | null {
  if (form.weekday < 1 || form.weekday > 7) {
    return 'Weekday must be between Monday (1) and Sunday (7).';
  }
  if (form.slot_minutes < 5 || form.slot_minutes > 240) {
    return 'Slot duration must be between 5 and 240 minutes.';
  }

  const startMins = timeStringToMinutes(form.start_time);
  const endMins = timeStringToMinutes(form.end_time);
  const breakStartMins = timeStringToMinutes(form.break_start);
  const breakEndMins = timeStringToMinutes(form.break_end);

  if (form.is_available) {
    if (startMins < 0 || endMins < 0 || endMins <= startMins) {
      return 'Working hours end time must be strictly after start time.';
    }
    if (form.has_break) {
      if (breakStartMins < 0 || breakEndMins < 0 || breakEndMins <= breakStartMins) {
        return 'Break end time must be strictly after break start time.';
      }
      if (breakStartMins < startMins || breakEndMins > endMins) {
        return 'Break window must fall completely within your shift hours.';
      }
      if (breakStartMins === startMins && breakEndMins === endMins) {
        return 'Break window cannot occupy the entire working shift.';
      }
    }
  }

  const nowMs = params.nowMs ?? Date.now();
  const tz = params.branchTimezone || 'UTC';

  for (const appt of params.appointments) {
    if (appt.doctor_profile_id !== params.doctorProfileId) continue;
    if (appt.branch_id !== params.branchId) continue;
    if (appt.status !== 'confirmed' && appt.status !== 'checked_in') continue;
    if (!appt.scheduled_start || !appt.scheduled_end) continue;

    const endMs = new Date(appt.scheduled_end).getTime();
    if (Number.isNaN(endMs) || endMs <= nowMs) continue;

    const localStart = getZonedDateParts(appt.scheduled_start, tz);
    const localEnd = getZonedDateParts(appt.scheduled_end, tz);
    if (!localStart || !localEnd) continue;
    if (localStart.isoWeekday !== form.weekday) continue;

    const label = appt.pet_name ? ` (${appt.pet_name})` : '';
    if (!form.is_available) {
      return `Cannot mark day off: confirmed appointment${label} is scheduled on ${localStart.dateKey}.`;
    }

    if (
      localStart.dateKey !== localEnd.dateKey ||
      localStart.minutes < startMins ||
      localEnd.minutes > endMins
    ) {
      return `Hours exclude an existing confirmed appointment${label} on ${localStart.dateKey}.`;
    }

    if (
      form.has_break &&
      localStart.minutes < breakEndMins &&
      localEnd.minutes > breakStartMins
    ) {
      return `Break window overlaps an existing confirmed appointment${label} on ${localStart.dateKey}.`;
    }
  }

  return null;
}

export function validateScheduleExceptionInput(
  input: {
    doctorProfileId: string;
    branchId: string | null;
    startAt: string;
    endAt: string;
    exceptionType: DoctorScheduleException['exception_type'];
    reason: string;
  },
  appointments: Pick<
    DoctorAppointment,
    | 'id'
    | 'branch_id'
    | 'doctor_profile_id'
    | 'status'
    | 'scheduled_start'
    | 'scheduled_end'
    | 'pet_name'
  >[]
): string | null {
  const startMs = new Date(input.startAt).getTime();
  const endMs = new Date(input.endAt).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
    return 'Exception end time must be after start time.';
  }
  if (!input.reason.trim() || input.reason.trim().length < 3) {
    return 'Please specify a short reason (at least 3 characters).';
  }

  if (input.exceptionType !== 'extra_availability') {
    for (const appt of appointments) {
      if (appt.doctor_profile_id !== input.doctorProfileId) continue;
      if (input.branchId && appt.branch_id !== input.branchId) continue;
      if (appt.status !== 'confirmed' && appt.status !== 'checked_in') continue;
      if (!appt.scheduled_start || !appt.scheduled_end) continue;

      const apptStart = new Date(appt.scheduled_start).getTime();
      const apptEnd = new Date(appt.scheduled_end).getTime();
      if (Number.isNaN(apptStart) || Number.isNaN(apptEnd)) continue;

      if (apptStart < endMs && apptEnd > startMs) {
        return `Blocked window conflicts with an existing confirmed appointment${appt.pet_name ? ` (${appt.pet_name})` : ''}.`;
      }
    }
  }

  return null;
}

export function validateDoctorProfileUpdate(input: {
  full_name: string;
  phone: string;
  qualification: string;
  specialization: string;
  experience_years: number;
  registration_number: string;
}): string | null {
  if (!input.full_name || input.full_name.trim().length < 2) {
    return 'Full professional name must be at least 2 characters.';
  }
  const phone = (input.phone || '').trim();
  if (phone.length > 0 && (!/^[+\d()\s-]{7,30}$/.test(phone) || phone.replace(/\D/g, '').length < 7)) {
    return 'Phone number must be 7-30 valid characters with at least 7 digits.';
  }
  if (!input.qualification.trim()) {
    return 'Veterinary qualification is required.';
  }
  if (!input.specialization.trim()) {
    return 'Clinical specialization is required.';
  }
  if (!Number.isFinite(input.experience_years) || input.experience_years < 0 || input.experience_years > 80) {
    return 'Years of experience must be between 0 and 80.';
  }
  if (input.registration_number.trim().length > 100) {
    return 'Registration number must be 100 characters or fewer.';
  }
  return null;
}

export function validateMedicalRecordInput(input: {
  pet_id: string;
  diagnosis: string;
  notes: string;
}): string | null {
  if (!input.pet_id) return 'Please select a patient pet.';
  if (!input.diagnosis.trim() || input.diagnosis.trim().length < 3) {
    return 'Clinical diagnosis must be at least 3 characters.';
  }
  if (input.diagnosis.trim().length > 255) {
    return 'Diagnosis must be 255 characters or fewer.';
  }
  if (!input.notes.trim() || input.notes.trim().length < 5) {
    return 'Clinical notes must be at least 5 characters.';
  }
  return null;
}

export function validateVaccinationInput(input: {
  pet_id: string;
  vaccine_name: string;
  administered_date: string;
  next_due_date?: string | null;
}): string | null {
  if (!input.pet_id) return 'Please select a patient pet.';
  if (!input.vaccine_name.trim() || input.vaccine_name.trim().length < 2) {
    return 'Vaccine name is required.';
  }
  if (!input.administered_date.trim()) {
    return 'Administered date is required.';
  }
  const adminDate = new Date(`${input.administered_date}T00:00:00Z`);
  if (Number.isNaN(adminDate.getTime())) {
    return 'Administered date must be valid.';
  }
  if (input.next_due_date && input.next_due_date.trim()) {
    const nextDate = new Date(`${input.next_due_date}T00:00:00Z`);
    if (Number.isNaN(nextDate.getTime())) {
      return 'Next due date must be valid.';
    }
    if (nextDate.getTime() < adminDate.getTime()) {
      return 'Next due date cannot be earlier than administered date.';
    }
  }
  return null;
}

export function validatePrescriptionInput(input: {
  pet_id: string;
  consultation_id?: string | null;
  appointment_id?: string | null;
  diagnosis: string;
  items: Array<{
    medicine_name: string;
    dosage: string;
    frequency: string;
    duration: string;
  }>;
}): string | null {
  if (!input.pet_id) return 'Please select a patient pet.';
  if (!input.consultation_id && !input.appointment_id) {
    return 'Prescription must be linked to an active/completed consultation or appointment in this organization.';
  }
  if (!input.diagnosis.trim() || input.diagnosis.trim().length < 3) {
    return 'Clinical diagnosis must be at least 3 characters.';
  }
  if (!input.items || input.items.length === 0) {
    return 'At least one medication item is required.';
  }
  for (let i = 0; i < input.items.length; i += 1) {
    const item = input.items[i];
    if (
      !item.medicine_name.trim() ||
      !item.dosage.trim() ||
      !item.frequency.trim() ||
      !item.duration.trim()
    ) {
      return `Medication #${i + 1} requires medicine name, dosage, frequency, and duration.`;
    }
  }
  return null;
}

/**
 * Policy helpers reflecting confirmed Phase 1-5 business & RLS boundaries.
 */
export function canDoctorConfirmAppointment(permissions: string[]): boolean {
  // Confirmation belongs strictly to front_desk / branch_manager / org_admin / org_owner (`appointments.confirm`).
  // An ordinary doctor membership does NOT hold `appointments.confirm`.
  return permissions.includes('appointments.confirm');
}

export function canDoctorModifyBranchAssignments(permissions: string[]): boolean {
  // Branch assignments are governed strictly by `staff.manage` (Clinic Admin / Owner).
  return permissions.includes('staff.manage');
}

export function canActivateConsultationForAppointment(
  appointment: Pick<DoctorAppointment, 'status' | 'doctor_profile_id'>,
  doctorProfileId: string | null | undefined
): boolean {
  if (!doctorProfileId) return false;
  if (appointment.doctor_profile_id !== doctorProfileId) return false;
  return (
    appointment.status === 'confirmed' ||
    appointment.status === 'checked_in' ||
    appointment.status === 'completed'
  );
}

export function canDoctorAccessConsultationChat(
  consultation: Pick<DoctorConsultation, 'organization_id' | 'doctor_id'>,
  activeOrgId: string,
  doctorProfileId: string | null | undefined
): boolean {
  // D-16: Strictly treating doctor + client only (not peer doctors, not org admins).
  if (!activeOrgId || !doctorProfileId) return false;
  return (
    consultation.organization_id === activeOrgId &&
    consultation.doctor_id === doctorProfileId
  );
}

export function canDoctorReadOrgClinicalRecord(
  recordOrgId: string,
  activeOrgId: string,
  permissions: string[]
): boolean {
  // D-17: All active authorized doctors in the same organization can read org clinical records.
  return (
    Boolean(activeOrgId) &&
    recordOrgId === activeOrgId &&
    permissions.includes('medical_records.read')
  );
}

export function getDoctorChatWindowStatus(
  consultation: Pick<
    DoctorConsultation,
    'consultation_status' | 'activated_at' | 'expires_at'
  >,
  nowMs: number = Date.now()
): ChatWindowStatus {
  return computeChatWindowStatus(consultation, nowMs);
}

export function isSameDayInTimezone(
  iso: string | null | undefined,
  timeZone = 'UTC',
  referenceDate = new Date()
): boolean {
  if (!iso) return false;
  const targetParts = getZonedDateParts(iso, timeZone);
  const nowParts = getZonedDateParts(referenceDate.toISOString(), timeZone);
  if (!targetParts || !nowParts) return false;
  return targetParts.dateKey === nowParts.dateKey;
}
