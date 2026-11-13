import { ClientConsultation } from '../types/client';

export const CLINICAL_FILES_BUCKET = 'clinical-files';
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB matching DB CHECK
export const ALLOWED_ATTACHMENT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

export const ALLOWED_PET_SPECIES = ['Dog', 'Cat', 'Bird', 'Rabbit', 'Other'] as const;
export const ALLOWED_PET_GENDERS = [
  'Male',
  'Female',
  'Neutered Male',
  'Spayed Female',
] as const;

export interface PetFormValidationInput {
  name: string;
  species: string;
  breed: string;
  gender: string;
  weight: number;
  date_of_birth?: string | null;
}

export function validatePetForm(input: PetFormValidationInput): string | null {
  if (!input.name || input.name.trim().length < 1 || input.name.trim().length > 100) {
    return 'Pet name must be between 1 and 100 characters.';
  }
  if (!input.species || !input.species.trim()) {
    return 'Pet species is required.';
  }
  if (!input.breed || input.breed.trim().length < 1 || input.breed.trim().length > 100) {
    return 'Pet breed is required.';
  }
  if (!input.gender || !input.gender.trim()) {
    return 'Pet gender is required.';
  }
  if (!Number.isFinite(input.weight) || input.weight <= 0 || input.weight > 500) {
    return 'Weight must be greater than 0 kg and at most 500 kg.';
  }
  if (input.date_of_birth && input.date_of_birth.trim()) {
    const dob = new Date(`${input.date_of_birth}T00:00:00Z`);
    if (Number.isNaN(dob.getTime())) {
      return 'Date of birth must be a valid calendar date.';
    }
    if (dob.getTime() > Date.now()) {
      return 'Date of birth cannot be in the future.';
    }
  }
  return null;
}

export function validateClientProfile(input: {
  full_name: string;
  phone?: string | null;
}): string | null {
  const name = input.full_name.trim();
  if (name.length < 2 || name.length > 150) {
    return 'Full name must be between 2 and 150 characters.';
  }
  const phone = (input.phone || '').trim();
  if (phone.length > 0) {
    if (phone.length > 30 || !/^[+\d()\s-]{7,30}$/.test(phone)) {
      return 'Phone number must be 7-30 characters and contain only digits, spaces, +, -, or parentheses.';
    }
    const digitCount = phone.replace(/\D/g, '').length;
    if (digitCount < 7) {
      return 'Phone number must contain at least 7 digits.';
    }
  }
  return null;
}

export function isEphemeralBlobOrDataUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  return /^blob:/i.test(trimmed) || /^data:/i.test(trimmed);
}

export function sanitizeClinicalUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || isEphemeralBlobOrDataUrl(trimmed) || trimmed.includes('..')) {
    return null;
  }
  return trimmed;
}

export function validateAppointmentRequest(input: {
  organization_id: string;
  branch_id: string;
  pet_id: string;
  doctor_profile_id: string;
  requested_start: string;
  requested_end: string;
  reason: string;
  service_id?: string | null;
  expected_service_duration_minutes?: number | null;
}): string | null {
  if (!input.organization_id) return 'Active organization is required.';
  if (!input.branch_id) return 'Please select a clinic branch.';
  if (!input.pet_id) return 'Please select a registered pet.';
  if (!input.doctor_profile_id) return 'Please select a veterinary doctor.';
  const start = new Date(input.requested_start);
  const end = new Date(input.requested_end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 'Please select a valid available appointment slot.';
  }
  if (end.getTime() <= start.getTime()) {
    return 'Appointment end time must be after start time.';
  }
  const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
  if (durationMinutes < 5 || durationMinutes > 480) {
    return 'Appointment duration must be between 5 and 480 minutes.';
  }
  if (
    input.service_id &&
    input.expected_service_duration_minutes &&
    durationMinutes !== input.expected_service_duration_minutes
  ) {
    return `Selected time slot (${durationMinutes} min) must match the service duration (${input.expected_service_duration_minutes} min).`;
  }
  if (input.reason.trim().length < 5) {
    return 'Please provide a brief clinical reason (at least 5 characters).';
  }
  if (input.reason.trim().length > 2000) {
    return 'Clinical reason must be under 2000 characters.';
  }
  return null;
}

export function validateAttachmentFile(file: {
  name: string;
  type: string;
  size: number;
}): string | null {
  if (!file.name || !file.name.trim()) {
    return 'Filename is required.';
  }
  if (
    !ALLOWED_ATTACHMENT_MIME_TYPES.includes(
      file.type as (typeof ALLOWED_ATTACHMENT_MIME_TYPES)[number]
    )
  ) {
    return 'Only JPEG, PNG, WebP images and PDF documents are supported.';
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return 'Selected file is empty.';
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return 'File size exceeds the 10 MB security limit.';
  }
  return null;
}

export function sanitizeAttachmentFilename(filename: string): string {
  const base = filename
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return (base || 'document').slice(0, 120);
}

export function buildClinicalStoragePath(
  organizationId: string,
  entityType: 'pet' | 'consultation' | 'chat_message' | 'medical_record',
  entityId: string,
  filename: string,
  uniqueToken: string
): string {
  const safeName = sanitizeAttachmentFilename(filename);
  return `${organizationId}/${entityType}/${entityId}/${uniqueToken}-${safeName}`;
}

export interface ChatWindowStatus {
  isActive: boolean;
  isExpired: boolean;
  isPending: boolean;
  isCompleted: boolean;
  isRejected: boolean;
  canSendMessages: boolean;
  days: number;
  hours: number;
  minutes: number;
  formatted: string;
}

export function computeChatWindowStatus(
  consultation: Pick<
    ClientConsultation,
    'consultation_status' | 'activated_at' | 'expires_at'
  >,
  nowMs: number = Date.now()
): ChatWindowStatus {
  const status = consultation.consultation_status;
  const isPending = status === 'pending';
  const isRejected = status === 'rejected';
  const isCompleted = status === 'completed';

  if (status === 'expired') {
    return {
      isActive: false,
      isExpired: true,
      isPending: false,
      isCompleted: false,
      isRejected: false,
      canSendMessages: false,
      days: 0,
      hours: 0,
      minutes: 0,
      formatted: 'Expired (7-Day Limit)',
    };
  }

  if (isPending || isRejected || isCompleted) {
    return {
      isActive: false,
      isExpired: isCompleted,
      isPending,
      isCompleted,
      isRejected,
      canSendMessages: false,
      days: 0,
      hours: 0,
      minutes: 0,
      formatted: isPending ? 'Pending Approval' : isCompleted ? 'Completed' : 'Declined',
    };
  }

  if (!consultation.activated_at || !consultation.expires_at) {
    return {
      isActive: false,
      isExpired: true,
      isPending: false,
      isCompleted: false,
      isRejected: false,
      canSendMessages: false,
      days: 0,
      hours: 0,
      minutes: 0,
      formatted: 'Window Inactive',
    };
  }

  const expiresMs = new Date(consultation.expires_at).getTime();
  const diff = expiresMs - nowMs;
  if (Number.isNaN(expiresMs) || diff <= 0) {
    return {
      isActive: false,
      isExpired: true,
      isPending: false,
      isCompleted: false,
      isRejected: false,
      canSendMessages: false,
      days: 0,
      hours: 0,
      minutes: 0,
      formatted: 'Expired (Read-Only)',
    };
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  return {
    isActive: true,
    isExpired: false,
    isPending: false,
    isCompleted: false,
    isRejected: false,
    canSendMessages: true,
    days,
    hours,
    minutes,
    formatted: `${days}d ${hours}h ${minutes}m left`,
  };
}

export function validateReviewInput(rating: number, reviewText: string): string | null {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return 'Please select a star rating between 1 and 5.';
  }
  const clean = reviewText.trim();
  if (clean.length < 5) {
    return 'Please share at least 5 characters in your consultation feedback.';
  }
  if (clean.length > 2000) {
    return 'Review feedback must be 2000 characters or fewer.';
  }
  return null;
}

export function assertTenantMatch(
  recordOrgId: string | null | undefined,
  activeOrgId: string,
  entityLabel: string
): void {
  if (!activeOrgId) {
    throw new Error(`Missing active organization context for ${entityLabel}.`);
  }
  if (recordOrgId && recordOrgId !== activeOrgId) {
    throw new Error(
      `Security isolation block: ${entityLabel} belongs to another veterinary organization.`
    );
  }
}

export function weekdayLabel(isoWeekday: number): string {
  const names = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return names[isoWeekday] || 'Day';
}

export function formatTimeRangeInZone(
  startIso: string,
  endIso: string,
  timeZone?: string
): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const opts: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  };
  try {
    return `${start.toLocaleTimeString([], opts)} – ${end.toLocaleTimeString([], opts)}`;
  } catch {
    return `${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – ${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
}

export function formatDateTimeInZone(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  const opts: Intl.DateTimeFormatOptions = {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...(timeZone ? { timeZone } : {}),
  };
  try {
    return d.toLocaleString([], opts);
  } catch {
    return d.toLocaleString();
  }
}
