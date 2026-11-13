import { WorkspaceOption } from '../types/auth';
import {
  ClientAppointment,
  ClientConsultation,
  ClientPet,
  ClientPrescription,
} from '../types/client';
import { DoctorAppointment, DoctorConsultation } from '../types/doctor';

export interface PaginationResult<T> {
  items: T[];
  totalItems: number;
  totalPages: number;
  currentPage: number;
  pageSize: number;
  startIndex: number;
  endIndex: number;
}

export function paginateItems<T>(
  items: T[],
  requestedPage: number,
  requestedPageSize: number
): PaginationResult<T> {
  const pageSize = Math.max(1, Math.floor(requestedPageSize || 10));
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(Math.max(1, Math.floor(requestedPage || 1)), totalPages);
  const startOffset = (currentPage - 1) * pageSize;
  const paged = items.slice(startOffset, startOffset + pageSize);

  return {
    items: paged,
    totalItems,
    totalPages,
    currentPage,
    pageSize,
    startIndex: totalItems === 0 ? 0 : startOffset + 1,
    endIndex: totalItems === 0 ? 0 : startOffset + paged.length,
  };
}

export function isWithinDateRange(
  isoDate: string | null | undefined,
  fromDate: string,
  toDate: string
): boolean {
  if (!fromDate && !toDate) return true;
  if (!isoDate) return false;
  const ts = new Date(isoDate).getTime();
  if (!Number.isFinite(ts)) return false;

  if (fromDate) {
    const fromTs = new Date(`${fromDate}T00:00:00.000`).getTime();
    if (Number.isFinite(fromTs) && ts < fromTs) return false;
  }
  if (toDate) {
    const toTs = new Date(`${toDate}T23:59:59.999`).getTime();
    if (Number.isFinite(toTs) && ts > toTs) return false;
  }
  return true;
}

export function sortItems<T>(
  items: T[],
  compareFn: (a: T, b: T) => number,
  direction: 'asc' | 'desc' = 'desc'
): T[] {
  const factor = direction === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => compareFn(a, b) * factor);
}

export function compareIsoDates(
  a: string | null | undefined,
  b: string | null | undefined
): number {
  const aTs = a ? new Date(a).getTime() : 0;
  const bTs = b ? new Date(b).getTime() : 0;
  return (Number.isFinite(aTs) ? aTs : 0) - (Number.isFinite(bTs) ? bTs : 0);
}

export function compareStrings(
  a: string | null | undefined,
  b: string | null | undefined
): number {
  return String(a || '').localeCompare(String(b || ''), undefined, {
    sensitivity: 'base',
  });
}

export function getInitials(name: string | null | undefined): string {
  const cleaned = String(name || '').trim();
  if (!cleaned) return 'PC';
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
}

export function deduplicateNotifications<T extends { id: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of list) {
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }
  return result;
}

export function resolveNotificationUrl(
  rawLink: string | null | undefined,
  activeWorkspace: WorkspaceOption | null | undefined,
  portalOverride?: 'client' | 'doctor' | 'admin' | 'platform' | 'global'
): string | null {
  if (!rawLink) return null;
  const link = rawLink.trim();
  if (!link) return null;

  const orgSlug = activeWorkspace?.organization_slug;

  if (link.startsWith('/client/')) {
    return orgSlug ? `/${orgSlug}/client/${link.slice('/client/'.length)}` : '/workspaces';
  }
  if (link.startsWith('/doctor/')) {
    return orgSlug ? `/${orgSlug}/doctor/${link.slice('/doctor/'.length)}` : '/workspaces';
  }
  if (link.startsWith('/admin/')) {
    return orgSlug ? `/${orgSlug}/admin/${link.slice('/admin/'.length)}` : '/workspaces';
  }
  if (link.startsWith('/platform/') || link === '/platform') {
    return link;
  }
  if (link === '/workspaces' || link === '/accept-invite') {
    return link;
  }
  // Already tenant-prefixed path e.g. /:orgSlug/...
  if (/^\/[a-z0-9-]+\/(client|doctor|admin)\//i.test(link)) {
    return link;
  }

  if (portalOverride === 'platform' && link.startsWith('/')) {
    return `/platform${link}`;
  }

  return link.startsWith('/') ? link : null;
}

export interface ClientSummaryReport {
  totalPets: number;
  activePets: number;
  archivedPets: number;
  totalAppointments: number;
  requestedAppointments: number;
  upcomingAppointments: number;
  completedAppointments: number;
  cancelledOrDeclinedAppointments: number;
  totalConsultations: number;
  activeConsultations: number;
  expiredConsultations: number;
  completedConsultations: number;
  issuedPrescriptions: number;
  petSummaries: Array<{
    petId: string;
    petName: string;
    species: string;
    appointmentCount: number;
    consultationCount: number;
    lastActivityAt: string | null;
  }>;
}

export function computeClientSummaryReport(params: {
  pets: ClientPet[];
  appointments: ClientAppointment[];
  consultations: ClientConsultation[];
  prescriptions?: ClientPrescription[];
  fromDate?: string;
  toDate?: string;
}): ClientSummaryReport {
  const fromDate = params.fromDate || '';
  const toDate = params.toDate || '';

  const filteredAppts = params.appointments.filter((a) =>
    isWithinDateRange(a.scheduled_start || a.requested_start, fromDate, toDate)
  );
  const filteredCons = params.consultations.filter((c) =>
    isWithinDateRange(c.activated_at || c.created_at, fromDate, toDate)
  );
  const filteredRx = (params.prescriptions || []).filter(
    (rx) => rx.status === 'issued' && isWithinDateRange(rx.created_at, fromDate, toDate)
  );

  const nowMs = Date.now();
  const activePetsList = params.pets.filter((p) => !p.archived_at);

  const petSummaries = activePetsList.map((pet) => {
    const petAppts = filteredAppts.filter((a) => a.pet_id === pet.id);
    const petCons = filteredCons.filter((c) => c.pet_id === pet.id);
    const timestamps = [
      ...petAppts.map((a) => a.scheduled_start || a.requested_start),
      ...petCons.map((c) => c.activated_at || c.created_at),
    ]
      .filter(Boolean)
      .sort((a, b) => compareIsoDates(b, a));

    return {
      petId: pet.id,
      petName: pet.name,
      species: pet.species,
      appointmentCount: petAppts.length,
      consultationCount: petCons.length,
      lastActivityAt: timestamps[0] || null,
    };
  });

  return {
    totalPets: params.pets.length,
    activePets: activePetsList.length,
    archivedPets: params.pets.length - activePetsList.length,
    totalAppointments: filteredAppts.length,
    requestedAppointments: filteredAppts.filter((a) => a.status === 'requested').length,
    upcomingAppointments: filteredAppts.filter(
      (a) => a.status === 'confirmed' || a.status === 'checked_in'
    ).length,
    completedAppointments: filteredAppts.filter((a) => a.status === 'completed').length,
    cancelledOrDeclinedAppointments: filteredAppts.filter(
      (a) => a.status === 'cancelled' || a.status === 'declined' || a.status === 'no_show'
    ).length,
    totalConsultations: filteredCons.length,
    activeConsultations: filteredCons.filter(
      (c) =>
        c.consultation_status === 'active' &&
        (!c.expires_at || new Date(c.expires_at).getTime() > nowMs)
    ).length,
    expiredConsultations: filteredCons.filter(
      (c) =>
        c.consultation_status === 'expired' ||
        (c.consultation_status === 'active' &&
          Boolean(c.expires_at) &&
          new Date(c.expires_at as string).getTime() <= nowMs)
    ).length,
    completedConsultations: filteredCons.filter(
      (c) => c.consultation_status === 'completed'
    ).length,
    issuedPrescriptions: filteredRx.length,
    petSummaries,
  };
}

export interface DoctorWorkloadReport {
  totalAppointments: number;
  requestedAppointments: number;
  confirmedAppointments: number;
  checkedInAppointments: number;
  completedAppointments: number;
  missedOrCancelledAppointments: number;
  completionRatePct: number;
  totalConsultations: number;
  activeChatsCount: number;
  expiredChatsCount: number;
  completedConsultationsCount: number;
  uniquePatientsSeen: number;
  medicalRecordsCount: number;
  prescriptionsCount: number;
  vaccinationsCount: number;
  byBranch: Array<{
    branchId: string;
    branchName: string;
    appointmentCount: number;
    completedCount: number;
    activeConsultationCount: number;
  }>;
}

export function computeDoctorWorkloadReport(params: {
  appointments: DoctorAppointment[];
  consultations: DoctorConsultation[];
  medicalRecordsCount?: number;
  prescriptionsCount?: number;
  vaccinationsCount?: number;
  branchId?: string;
  fromDate?: string;
  toDate?: string;
}): DoctorWorkloadReport {
  const fromDate = params.fromDate || '';
  const toDate = params.toDate || '';
  const branchId = params.branchId && params.branchId !== 'all' ? params.branchId : '';

  const filteredAppts = params.appointments.filter((a) => {
    if (branchId && a.branch_id !== branchId) return false;
    return isWithinDateRange(a.scheduled_start || a.requested_start, fromDate, toDate);
  });

  const filteredCons = params.consultations.filter((c) => {
    if (branchId && c.branch_id !== branchId) return false;
    return isWithinDateRange(c.activated_at || c.created_at, fromDate, toDate);
  });

  const nowMs = Date.now();
  const requestedAppointments = filteredAppts.filter((a) => a.status === 'requested').length;
  const confirmedAppointments = filteredAppts.filter((a) => a.status === 'confirmed').length;
  const checkedInAppointments = filteredAppts.filter((a) => a.status === 'checked_in').length;
  const completedAppointments = filteredAppts.filter((a) => a.status === 'completed').length;
  const noShowCount = filteredAppts.filter((a) => a.status === 'no_show').length;
  const missedOrCancelledAppointments = filteredAppts.filter(
    (a) => a.status === 'cancelled' || a.status === 'declined' || a.status === 'no_show'
  ).length;

  const outcomeTotal = completedAppointments + noShowCount;
  const completionRatePct =
    outcomeTotal > 0 ? Math.round((completedAppointments / outcomeTotal) * 100) : 0;

  const activeChatsCount = filteredCons.filter(
    (c) =>
      c.consultation_status === 'active' &&
      (!c.expires_at || new Date(c.expires_at).getTime() > nowMs)
  ).length;
  const expiredChatsCount = filteredCons.filter(
    (c) =>
      c.consultation_status === 'expired' ||
      (c.consultation_status === 'active' &&
        Boolean(c.expires_at) &&
        new Date(c.expires_at as string).getTime() <= nowMs)
  ).length;
  const completedConsultationsCount = filteredCons.filter(
    (c) => c.consultation_status === 'completed'
  ).length;

  const uniquePets = new Set<string>();
  filteredAppts.forEach((a) => a.pet_id && uniquePets.add(a.pet_id));
  filteredCons.forEach((c) => c.pet_id && uniquePets.add(c.pet_id));

  const branchMap = new Map<
    string,
    { branchId: string; branchName: string; appointmentCount: number; completedCount: number; activeConsultationCount: number }
  >();
  for (const a of filteredAppts) {
    const key = a.branch_id || 'unknown';
    const existing = branchMap.get(key) || {
      branchId: key,
      branchName: a.branch_name || 'Assigned Branch',
      appointmentCount: 0,
      completedCount: 0,
      activeConsultationCount: 0,
    };
    existing.appointmentCount += 1;
    if (a.status === 'completed') existing.completedCount += 1;
    branchMap.set(key, existing);
  }
  for (const c of filteredCons) {
    if (!c.branch_id) continue;
    const existing = branchMap.get(c.branch_id) || {
      branchId: c.branch_id,
      branchName: c.branch_name || 'Assigned Branch',
      appointmentCount: 0,
      completedCount: 0,
      activeConsultationCount: 0,
    };
    if (
      c.consultation_status === 'active' &&
      (!c.expires_at || new Date(c.expires_at).getTime() > nowMs)
    ) {
      existing.activeConsultationCount += 1;
    }
    branchMap.set(c.branch_id, existing);
  }

  return {
    totalAppointments: filteredAppts.length,
    requestedAppointments,
    confirmedAppointments,
    checkedInAppointments,
    completedAppointments,
    missedOrCancelledAppointments,
    completionRatePct,
    totalConsultations: filteredCons.length,
    activeChatsCount,
    expiredChatsCount,
    completedConsultationsCount,
    uniquePatientsSeen: uniquePets.size,
    medicalRecordsCount: params.medicalRecordsCount ?? 0,
    prescriptionsCount: params.prescriptionsCount ?? 0,
    vaccinationsCount: params.vaccinationsCount ?? 0,
    byBranch: Array.from(branchMap.values()).sort(
      (a, b) => b.appointmentCount - a.appointmentCount
    ),
  };
}
