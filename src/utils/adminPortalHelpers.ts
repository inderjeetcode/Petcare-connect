import { Branch, OrgRoleCode } from '../types/auth';
import {
  AdminAuditLogItem,
  ClinicServiceCategory,
} from '../types/admin';
import {
  DoctorAppointment,
  DoctorConsultation,
  DoctorSlotSummary,
} from '../types/doctor';

export const ORG_ASSIGNABLE_ROLES: Array<{
  code: OrgRoleCode;
  label: string;
  description: string;
  requiresAssignAdmin: boolean;
  supportsBranchScope: boolean;
}> = [
  {
    code: 'org_owner',
    label: 'Organization Owner',
    description: 'Full tenant governance, organization settings, and admin role assignment.',
    requiresAssignAdmin: true,
    supportsBranchScope: false,
  },
  {
    code: 'org_admin',
    label: 'Clinic Administrator',
    description: 'Manages branches, staff, doctor governance, scheduling, clients, and reports.',
    requiresAssignAdmin: true,
    supportsBranchScope: false,
  },
  {
    code: 'branch_manager',
    label: 'Branch Manager',
    description: 'Manages schedules, appointments, and client onboarding for assigned branches.',
    requiresAssignAdmin: false,
    supportsBranchScope: true,
  },
  {
    code: 'doctor',
    label: 'Veterinary Doctor',
    description: 'Clinical practitioner across assigned organization branches.',
    requiresAssignAdmin: false,
    supportsBranchScope: true,
  },
  {
    code: 'front_desk',
    label: 'Front Desk Coordinator',
    description: 'Approves clinic clients, registers walk-ins, and confirms/checks in appointments.',
    requiresAssignAdmin: false,
    supportsBranchScope: true,
  },
];

export const SERVICE_CATEGORIES: Array<{ value: ClinicServiceCategory; label: string }> = [
  { value: 'consultation', label: 'Clinical Consultation' },
  { value: 'vaccination', label: 'Vaccination & Immunization' },
  { value: 'diagnostics', label: 'Diagnostics & Lab' },
  { value: 'preventive', label: 'Preventive Care' },
  { value: 'dental', label: 'Dental Procedure' },
  { value: 'surgery', label: 'Surgical Procedure' },
  { value: 'emergency', label: 'Emergency Triage' },
  { value: 'follow_up', label: 'Follow-Up Review' },
];

export function canAssignRoleList(
  requestedRoles: OrgRoleCode[],
  canAssignAdmin: boolean
): { valid: boolean; message?: string } {
  if (!requestedRoles || requestedRoles.length === 0) {
    return { valid: false, message: 'Select at least one organization role.' };
  }

  const normalized = requestedRoles.map((r) => String(r).trim().toLowerCase());
  if (normalized.includes('platform_admin') || normalized.includes('platform_owner')) {
    return {
      valid: false,
      message: 'Organization Administrators cannot assign Platform Owner privileges.',
    };
  }

  const validCodes = new Set<string>(ORG_ASSIGNABLE_ROLES.map((r) => r.code));
  for (const r of normalized) {
    if (!validCodes.has(r)) {
      return { valid: false, message: `Unsupported organization role "${r}".` };
    }
  }

  const includesPrivilegedAdmin =
    normalized.includes('org_owner') || normalized.includes('org_admin');
  if (includesPrivilegedAdmin && !canAssignAdmin) {
    return {
      valid: false,
      message: 'Only Organization Owners (roles.assign_admin) can grant org_owner or org_admin.',
    };
  }

  return { valid: true };
}

export function isBranchAccessibleToMember(
  membershipBranchIds: string[],
  targetBranchId: string | null | undefined
): boolean {
  // Empty membership_branches represents org-wide access (org_owner / org_admin)
  if (!membershipBranchIds || membershipBranchIds.length === 0) {
    return true;
  }
  if (!targetBranchId) {
    return false;
  }
  return membershipBranchIds.includes(targetBranchId);
}

export function validateBranchFormInput(input: {
  name: string;
  code: string;
  timezone: string;
}): string | null {
  if (!input.name.trim()) return 'Branch name is required.';
  if (!input.code.trim()) return 'Branch code is required.';
  if (!/^[A-Za-z0-9_-]{2,20}$/.test(input.code.trim())) {
    return 'Branch code must be 2-20 alphanumeric, dash, or underscore characters.';
  }
  if (!input.timezone.trim()) return 'Branch timezone is required.';
  return null;
}

export function validateClinicServiceInput(input: {
  name: string;
  code: string;
  duration_minutes: number;
  price: number;
}): string | null {
  if (!input.name.trim()) return 'Service name is required.';
  if (!input.code.trim()) return 'Service code is required.';
  if (!/^[A-Za-z0-9_-]{2,32}$/.test(input.code.trim())) {
    return 'Service code must be 2-32 alphanumeric, dash, or underscore characters.';
  }
  if (
    !Number.isFinite(input.duration_minutes) ||
    input.duration_minutes < 5 ||
    input.duration_minutes > 480
  ) {
    return 'Service duration must be between 5 and 480 minutes.';
  }
  if (!Number.isFinite(input.price) || input.price < 0) {
    return 'Service fee cannot be negative.';
  }
  return null;
}

export function detectAppointmentConflict(params: {
  doctorProfileId: string;
  startIso: string;
  endIso: string;
  existingAppointments: DoctorAppointment[];
  excludeAppointmentId?: string;
}): DoctorAppointment | null {
  const startMs = new Date(params.startIso).getTime();
  const endMs = new Date(params.endIso).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return null;
  }

  for (const appt of params.existingAppointments) {
    if (params.excludeAppointmentId && appt.id === params.excludeAppointmentId) {
      continue;
    }
    if (appt.doctor_profile_id !== params.doctorProfileId) continue;
    if (appt.status !== 'confirmed' && appt.status !== 'checked_in') continue;

    const existingStart = new Date(appt.scheduled_start || appt.requested_start).getTime();
    const existingEnd = new Date(appt.scheduled_end || appt.requested_end).getTime();
    if (!Number.isFinite(existingStart) || !Number.isFinite(existingEnd)) continue;

    // [start, end) overlap check
    if (startMs < existingEnd && endMs > existingStart) {
      return appt;
    }
  }
  return null;
}

export interface AdminAppointmentReportMetrics {
  totalAppointments: number;
  requestedCount: number;
  confirmedCount: number;
  checkedInCount: number;
  completedCount: number;
  declinedCount: number;
  cancelledCount: number;
  noShowCount: number;
  confirmationRatePct: number;
  completionRatePct: number;
  noShowRatePct: number;
  unmappedLegacyConsultationsCount: number;
  byBranch: Array<{
    branchId: string;
    branchName: string;
    branchCode: string;
    totalAppointments: number;
    completedCount: number;
    confirmedCount: number;
    requestedCount: number;
  }>;
  byDoctor: Array<{
    doctorId: string;
    doctorName: string;
    appointmentCount: number;
    completedCount: number;
    consultationCount: number;
  }>;
}

export function computeAdminOperationalReport(params: {
  branches: Branch[];
  appointments: DoctorAppointment[];
  consultations: DoctorConsultation[];
  doctors: Array<{ id: string; full_name?: string | null; display_name?: string | null }>;
}): AdminAppointmentReportMetrics {
  const { branches, appointments, consultations, doctors } = params;

  const requestedCount = appointments.filter((a) => a.status === 'requested').length;
  const confirmedCount = appointments.filter((a) => a.status === 'confirmed').length;
  const checkedInCount = appointments.filter((a) => a.status === 'checked_in').length;
  const completedCount = appointments.filter((a) => a.status === 'completed').length;
  const declinedCount = appointments.filter((a) => a.status === 'declined').length;
  const cancelledCount = appointments.filter((a) => a.status === 'cancelled').length;
  const noShowCount = appointments.filter((a) => a.status === 'no_show').length;

  const decidedTotal =
    confirmedCount +
    checkedInCount +
    completedCount +
    declinedCount +
    cancelledCount +
    noShowCount;

  const confirmationRatePct =
    decidedTotal > 0
      ? Math.round(((confirmedCount + checkedInCount + completedCount + noShowCount) / decidedTotal) * 100)
      : 0;

  const scheduledOutcomeTotal = completedCount + noShowCount;
  const completionRatePct =
    scheduledOutcomeTotal > 0 ? Math.round((completedCount / scheduledOutcomeTotal) * 100) : 0;
  const noShowRatePct =
    scheduledOutcomeTotal > 0 ? Math.round((noShowCount / scheduledOutcomeTotal) * 100) : 0;

  // Never guess or assign branch for legacy consultations lacking verified branch_id
  const unmappedLegacyConsultationsCount = consultations.filter(
    (c) => !c.branch_id
  ).length;

  const byBranch = branches.map((b) => {
    const branchAppts = appointments.filter((a) => a.branch_id === b.id);
    return {
      branchId: b.id,
      branchName: b.name,
      branchCode: b.code,
      totalAppointments: branchAppts.length,
      completedCount: branchAppts.filter((a) => a.status === 'completed').length,
      confirmedCount: branchAppts.filter(
        (a) => a.status === 'confirmed' || a.status === 'checked_in'
      ).length,
      requestedCount: branchAppts.filter((a) => a.status === 'requested').length,
    };
  });

  const byDoctor = doctors.map((d) => {
    const docAppts = appointments.filter((a) => a.doctor_profile_id === d.id);
    const docCons = consultations.filter((c) => c.doctor_id === d.id);
    return {
      doctorId: d.id,
      doctorName: d.full_name || d.display_name || 'Veterinary Doctor',
      appointmentCount: docAppts.length,
      completedCount: docAppts.filter((a) => a.status === 'completed').length,
      consultationCount: docCons.length,
    };
  });

  return {
    totalAppointments: appointments.length,
    requestedCount,
    confirmedCount,
    checkedInCount,
    completedCount,
    declinedCount,
    cancelledCount,
    noShowCount,
    confirmationRatePct,
    completionRatePct,
    noShowRatePct,
    unmappedLegacyConsultationsCount,
    byBranch,
    byDoctor,
  };
}

export function buildAuditExportCsv(params: {
  organizationName: string;
  report: AdminAppointmentReportMetrics;
  auditLogs: AdminAuditLogItem[];
}): string {
  const escape = (val: unknown): string => {
    const s = String(val ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const lines: string[] = [
    ['Section', 'Metric / Timestamp', 'Category / Actor', 'Value / Entity', 'Details'].join(','),
    ['Summary', 'Organization', 'Tenant', escape(params.organizationName), 'Org-scoped operational summary'].join(','),
    ['Appointments', 'Total Appointments', 'All Statuses', String(params.report.totalAppointments), ''].join(','),
    ['Appointments', 'Requested', 'Pending Confirmation', String(params.report.requestedCount), ''].join(','),
    ['Appointments', 'Confirmed & Checked In', 'Upcoming Active', String(params.report.confirmedCount + params.report.checkedInCount), ''].join(','),
    ['Appointments', 'Completed', 'Concluded Visits', String(params.report.completedCount), ''].join(','),
    ['Appointments', 'No-Show', 'Missed Visits', String(params.report.noShowCount), `${params.report.noShowRatePct}% rate`].join(','),
  ];

  for (const branch of params.report.byBranch) {
    lines.push(
      [
        'Branch Volume',
        escape(branch.branchName),
        escape(branch.branchCode),
        String(branch.totalAppointments),
        `Completed: ${branch.completedCount}, Pending: ${branch.requestedCount}`,
      ].join(',')
    );
  }

  for (const log of params.auditLogs.slice(0, 100)) {
    lines.push(
      [
        'Audit Log',
        escape(log.created_at),
        escape(log.actor_name),
        escape(`${log.action} (${log.entity_type})`),
        escape(log.details || ''),
      ].join(',')
    );
  }

  return lines.join('\n');
}

export function groupSchedulesByBranchAndDay(
  schedules: DoctorSlotSummary[]
): Record<string, Record<number, DoctorSlotSummary[]>> {
  const grouped: Record<string, Record<number, DoctorSlotSummary[]>> = {};
  for (const s of schedules) {
    if (!grouped[s.branch_id]) grouped[s.branch_id] = {};
    if (!grouped[s.branch_id][s.weekday]) grouped[s.branch_id][s.weekday] = [];
    grouped[s.branch_id][s.weekday].push(s);
  }
  return grouped;
}
