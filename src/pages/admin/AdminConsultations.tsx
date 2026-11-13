import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../../components/common/PageHeader';
import { StatusBadge } from '../../components/common/StatusBadge';
import { Modal } from '../../components/common/Modal';
import { Pagination } from '../../components/common/Pagination';
import { useAdminWorkspace } from '../../hooks/useAdminWorkspace';
import { useApp } from '../../context/AppContext';
import { onboardingService } from '../../services/onboardingService';
import { adminPortalService } from '../../services/adminPortalService';
import { formatSupabaseError } from '../../services/authService';
import { Branch, DoctorGovernanceRecord } from '../../types/auth';
import {
  DoctorAppointment,
  DoctorAvailableSlot,
  DoctorConsultation,
} from '../../types/doctor';
import {
  detectAppointmentConflict,
  validateServiceDurationAlignment,
} from '../../utils/adminPortalHelpers';
import { getDoctorChatWindowStatus } from '../../utils/doctorPortalHelpers';
import {
  compareIsoDates,
  isWithinDateRange,
  paginateItems,
  sortItems,
} from '../../utils/listManagementHelpers';
import {
  AlertTriangle,
  CalendarCheck,
  CheckCircle2,
  Clock,
  Loader2,
  Lock,
  MessageSquare,
  RefreshCw,
  RotateCw,
  Search,
  UserCheck,
  XCircle,
} from 'lucide-react';

type AppointmentFilter =
  | 'all'
  | 'requested'
  | 'confirmed'
  | 'checked_in'
  | 'completed'
  | 'declined'
  | 'cancelled'
  | 'no_show';

export const AdminConsultations: React.FC = () => {
  const { workspace } = useAdminWorkspace();
  const { showToast, reloadFromDatabase } = useApp();

  const [activeTab, setActiveTab] = useState<'appointments' | 'consultations'>('appointments');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [branches, setBranches] = useState<Branch[]>([]);
  const [doctors, setDoctors] = useState<DoctorGovernanceRecord[]>([]);
  const [appointments, setAppointments] = useState<DoctorAppointment[]>([]);
  const [consultations, setConsultations] = useState<DoctorConsultation[]>([]);

  const [apptFilter, setApptFilter] = useState<AppointmentFilter>('all');
  const [branchFilter, setBranchFilter] = useState<string>('all');
  const [doctorFilter, setDoctorFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [apptPage, setApptPage] = useState(1);
  const [apptPageSize, setApptPageSize] = useState(10);
  const [consPage, setConsPage] = useState(1);
  const [consPageSize, setConsPageSize] = useState(10);

  // Confirm / Reschedule Modal State (with availability recheck & conflict check)
  const [slotModalTarget, setSlotModalTarget] = useState<{
    appointment: DoctorAppointment;
    mode: 'confirm' | 'reschedule';
  } | null>(null);
  const [slotDoctorId, setSlotDoctorId] = useState('');
  const [slotDate, setSlotDate] = useState('');
  const [availableSlots, setAvailableSlots] = useState<DoctorAvailableSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedStartIso, setSelectedStartIso] = useState('');
  const [selectedEndIso, setSelectedEndIso] = useState('');

  // Decline / Cancel / Reject Consultation Reason Modal
  const [reasonModalTarget, setReasonModalTarget] = useState<{
    id: string;
    kind: 'decline_appt' | 'cancel_appt' | 'reject_cons';
    title: string;
  } | null>(null);
  const [actionReason, setActionReason] = useState('');

  // Reassign Consultation Modal
  const [reassignTarget, setReassignTarget] = useState<DoctorConsultation | null>(null);
  const [reassignDoctorId, setReassignDoctorId] = useState('');
  const [reassignReason, setReassignReason] = useState('');

  const loadData = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    try {
      await adminPortalService.expireDueConsultations(workspace.organizationId).catch(() => 0);
      const branchScope = workspace.isBranchScoped
        ? workspace.membershipBranchIds
        : undefined;
      const [bList, dList, aList, cList] = await Promise.all([
        onboardingService.getOrgBranches(workspace.organizationId),
        onboardingService.getOrgDoctors(workspace.organizationId),
        workspace.canReadAppointments
          ? adminPortalService.getAppointments(workspace.organizationId, branchScope)
          : Promise.resolve([]),
        adminPortalService.getConsultations(workspace.organizationId).catch(() => []),
      ]);
      setBranches(bList);
      setDoctors(dList);
      setAppointments(aList);
      setConsultations(cList);
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to load appointments and cases.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [workspace, showToast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    setApptPage(1);
    setConsPage(1);
  }, [apptFilter, branchFilter, doctorFilter, search, fromDate, toDate, sortOrder, activeTab]);

  const fetchSlotsForModal = useCallback(
    async (branchId: string, doctorId: string, dateStr: string, serviceId?: string | null) => {
      if (!workspace || !branchId || !doctorId || !dateStr) return;
      setSlotsLoading(true);
      try {
        const slots = await adminPortalService.getAvailableSlots(
          workspace.organizationId,
          branchId,
          doctorId,
          dateStr,
          serviceId ?? null
        );
        setAvailableSlots(slots);
      } catch {
        setAvailableSlots([]);
      } finally {
        setSlotsLoading(false);
      }
    },
    [workspace]
  );

  if (!workspace) return null;

  const openSlotModal = (appointment: DoctorAppointment, mode: 'confirm' | 'reschedule') => {
    const startVal = appointment.scheduled_start || appointment.requested_start;
    const endVal = appointment.scheduled_end || appointment.requested_end;
    const datePart = new Date(startVal).toISOString().slice(0, 10);

    setSlotModalTarget({ appointment, mode });
    setSlotDoctorId(appointment.doctor_profile_id);
    setSlotDate(datePart);
    setSelectedStartIso(startVal);
    setSelectedEndIso(endVal);
    void fetchSlotsForModal(
      appointment.branch_id,
      appointment.doctor_profile_id,
      datePart,
      appointment.service_id ?? null
    );
  };

  const conflictAppt =
    slotModalTarget && slotDoctorId && selectedStartIso && selectedEndIso
      ? detectAppointmentConflict({
          doctorProfileId: slotDoctorId,
          startIso: selectedStartIso,
          endIso: selectedEndIso,
          existingAppointments: appointments,
          excludeAppointmentId: slotModalTarget.appointment.id,
        })
      : null;

  const handleSaveSlotModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slotModalTarget) return;
    if (conflictAppt) {
      showToast('Selected slot overlaps another confirmed appointment for this doctor.', 'error');
      return;
    }

    const durationErr = validateServiceDurationAlignment(
      selectedStartIso,
      selectedEndIso,
      slotModalTarget.appointment.service_duration_minutes
    );
    if (durationErr) {
      showToast(durationErr, 'error');
      return;
    }

    setSubmitting(true);
    try {
      if (slotModalTarget.mode === 'confirm') {
        await adminPortalService.confirmAppointment({
          appointment_id: slotModalTarget.appointment.id,
          confirmed_start: selectedStartIso,
          confirmed_end: selectedEndIso,
          doctor_profile_id: slotDoctorId,
          service_id: slotModalTarget.appointment.service_id ?? null,
        });
        showToast('Appointment confirmed and slot locked.', 'success');
      } else {
        await adminPortalService.rescheduleAppointment(
          slotModalTarget.appointment.id,
          selectedStartIso,
          selectedEndIso
        );
        showToast('Appointment rescheduled successfully.', 'success');
      }
      setSlotModalTarget(null);
      await loadData();
      await reloadFromDatabase();
    } catch (err) {
      showToast(formatSupabaseError(err, 'Could not confirm/reschedule slot.'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLifecycleAction = async (
    kind: 'check_in' | 'complete_appt' | 'no_show' | 'activate_cons' | 'complete_cons',
    targetId: string
  ) => {
    setSubmitting(true);
    try {
      if (kind === 'check_in') {
        await adminPortalService.checkInAppointment(targetId);
        showToast('Patient checked in at branch.', 'success');
      } else if (kind === 'complete_appt') {
        await adminPortalService.completeAppointment(targetId);
        showToast('Appointment marked completed.', 'success');
      } else if (kind === 'no_show') {
        await adminPortalService.markNoShow(targetId);
        showToast('Appointment marked no-show.', 'warning');
      } else if (kind === 'activate_cons') {
        await adminPortalService.createConsultationFromAppointment({
          appointment_id: targetId,
          activate_immediately: true,
        });
        showToast('7-day clinical consultation activated for client and doctor.', 'success');
      } else if (kind === 'complete_cons') {
        await adminPortalService.completeConsultation(targetId);
        showToast('Consultation marked completed.', 'success');
      }
      await loadData();
      await reloadFromDatabase();
    } catch (err) {
      showToast(formatSupabaseError(err, 'Operation failed.'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitReasonModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reasonModalTarget) return;
    if (reasonModalTarget.kind !== 'cancel_appt' && !actionReason.trim()) return;

    setSubmitting(true);
    try {
      if (reasonModalTarget.kind === 'decline_appt') {
        await adminPortalService.declineAppointment(reasonModalTarget.id, actionReason.trim());
        showToast('Appointment request declined.', 'info');
      } else if (reasonModalTarget.kind === 'cancel_appt') {
        await adminPortalService.cancelAppointment(reasonModalTarget.id, actionReason.trim());
        showToast('Appointment cancelled.', 'warning');
      } else {
        await adminPortalService.rejectConsultation(reasonModalTarget.id, actionReason.trim());
        showToast('Consultation rejected.', 'info');
      }
      setReasonModalTarget(null);
      setActionReason('');
      await loadData();
      await reloadFromDatabase();
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to process action.'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmReassign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reassignTarget || !reassignDoctorId) return;
    setSubmitting(true);
    try {
      await adminPortalService.reassignConsultation(
        reassignTarget.id,
        reassignDoctorId,
        reassignReason
      );
      showToast('Consultation reassigned to new veterinary doctor.', 'success');
      setReassignTarget(null);
      setReassignReason('');
      await loadData();
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to reassign consultation.'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const filteredAppointments = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = appointments.filter((a) => {
      if (apptFilter !== 'all' && a.status !== apptFilter) return false;
      if (branchFilter !== 'all' && a.branch_id !== branchFilter) return false;
      if (doctorFilter !== 'all' && a.doctor_profile_id !== doctorFilter) return false;
      const targetDate = a.scheduled_start || a.requested_start || a.created_at;
      if (!isWithinDateRange(targetDate, fromDate, toDate)) return false;

      if (!q) return true;
      return (
        (a.pet_name || '').toLowerCase().includes(q) ||
        (a.client_name || '').toLowerCase().includes(q) ||
        (a.doctor_name || '').toLowerCase().includes(q) ||
        a.reason.toLowerCase().includes(q)
      );
    });
    return sortItems(
      list,
      (a, b) => compareIsoDates(a.scheduled_start || a.requested_start, b.scheduled_start || b.requested_start),
      sortOrder
    );
  }, [appointments, apptFilter, branchFilter, doctorFilter, fromDate, toDate, search, sortOrder]);

  const paginatedAppointments = useMemo(
    () => paginateItems(filteredAppointments, apptPage, apptPageSize),
    [filteredAppointments, apptPage, apptPageSize]
  );

  const filteredConsultations = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = consultations.filter((c) => {
      if (branchFilter !== 'all' && c.branch_id !== branchFilter) return false;
      if (doctorFilter !== 'all' && c.doctor_id !== doctorFilter) return false;
      if (!isWithinDateRange(c.activated_at || c.created_at, fromDate, toDate)) return false;
      if (!q) return true;
      return (
        (c.pet_name || '').toLowerCase().includes(q) ||
        (c.client_name || '').toLowerCase().includes(q) ||
        (c.doctor_name || '').toLowerCase().includes(q) ||
        c.consultation_reason.toLowerCase().includes(q)
      );
    });
    return sortItems(
      list,
      (a, b) => compareIsoDates(a.activated_at || a.created_at, b.activated_at || b.created_at),
      sortOrder
    );
  }, [consultations, branchFilter, doctorFilter, fromDate, toDate, search, sortOrder]);

  const paginatedConsultations = useMemo(
    () => paginateItems(filteredConsultations, consPage, consPageSize),
    [filteredConsultations, consPage, consPageSize]
  );

  const eligibleBranchDoctors = slotModalTarget
    ? doctors.filter(
        (d) =>
          d.is_active && d.branch_ids.includes(slotModalTarget.appointment.branch_id)
      )
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Appointments & Consultation Governance"
        subtitle="Confirm requested appointments with real-time branch schedule verification, manage check-ins, and supervise clinical cases."
        action={
          <button
            onClick={() => void loadData()}
            disabled={loading}
            className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        }
      />

      {/* Primary Section Tabs */}
      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start w-fit">
        <button
          onClick={() => setActiveTab('appointments')}
          className={`px-4 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
            activeTab === 'appointments'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Appointments Queue ({appointments.length})
        </button>
        <button
          onClick={() => setActiveTab('consultations')}
          className={`px-4 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
            activeTab === 'consultations'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Consultations Supervision ({consultations.length})
        </button>
      </div>

      {/* Filters Toolbar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="relative w-full lg:w-88">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search pet, client, doctor, or visit reason..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              aria-label="Filter by branch"
              className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
            >
              <option value="all">All Accessible Branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.code})
                </option>
              ))}
            </select>

            <select
              value={doctorFilter}
              onChange={(e) => setDoctorFilter(e.target.value)}
              aria-label="Filter by doctor"
              className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
            >
              <option value="all">All Doctors</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.full_name}
                </option>
              ))}
            </select>

            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              aria-label="From date"
              className="px-2.5 py-2 text-xs border border-slate-200 rounded-lg bg-white"
            />
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              aria-label="To date"
              className="px-2.5 py-2 text-xs border border-slate-200 rounded-lg bg-white"
            />
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as 'desc' | 'asc')}
              aria-label="Sort order"
              className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
            >
              <option value="desc">Newest First</option>
              <option value="asc">Oldest First</option>
            </select>
            {(search || branchFilter !== 'all' || doctorFilter !== 'all' || fromDate || toDate || apptFilter !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setBranchFilter('all');
                  setDoctorFilter('all');
                  setFromDate('');
                  setToDate('');
                  setApptFilter('all');
                }}
                className="px-2.5 py-2 text-xs font-semibold text-teal-800 bg-teal-50 hover:bg-teal-100 rounded-lg"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {activeTab === 'appointments' && (
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
            {(
              [
                ['all', 'All'],
                ['requested', 'Requested'],
                ['confirmed', 'Confirmed'],
                ['checked_in', 'Checked In'],
                ['completed', 'Completed'],
                ['declined', 'Declined'],
                ['cancelled', 'Cancelled'],
                ['no_show', 'No Show'],
              ] as Array<[AppointmentFilter, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setApptFilter(key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  apptFilter === key
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label} (
                {key === 'all'
                  ? appointments.length
                  : appointments.filter((a) => a.status === key).length}
                )
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Tab Content */}
      {loading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
          <Loader2 className="w-6 h-6 text-teal-700 animate-spin mx-auto mb-2" />
          <p className="text-xs text-slate-500">Loading clinical schedule data...</p>
        </div>
      ) : activeTab === 'appointments' ? (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {filteredAppointments.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <CalendarCheck className="w-8 h-8 text-slate-400 mx-auto" />
              <div className="text-sm font-bold text-slate-900">No Appointments Match Filter</div>
              <p className="text-xs text-slate-500">
                Appointments requested by approved clients inside your branch scope appear here.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Pet & Guardian</th>
                  <th className="py-3 px-4">Branch & Doctor</th>
                  <th className="py-3 px-4">Scheduled / Requested Window</th>
                  <th className="py-3 px-4">Reason</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Workflow Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedAppointments.items.map((appt) => {
                  const windowStart = appt.scheduled_start || appt.requested_start;
                  const windowEnd = appt.scheduled_end || appt.requested_end;
                  return (
                    <tr key={appt.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900">
                          {appt.pet_name} {appt.pet_species ? `(${appt.pet_species})` : ''}
                        </div>
                        <div className="text-[11px] text-slate-500">{appt.client_name}</div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-800">{appt.branch_name}</div>
                        <div className="text-[11px] text-teal-800">{appt.doctor_name}</div>
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-slate-700">
                        <div>{new Date(windowStart).toLocaleDateString()}</div>
                        <div className="text-[11px] text-slate-500">
                          {new Date(windowStart).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}{' '}
                          –{' '}
                          {new Date(windowEnd).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-700 max-w-xs">
                        <div className="truncate" title={appt.reason}>
                          {appt.reason}
                        </div>
                        {appt.service_name && (
                          <span className="inline-block mt-1 px-1.5 py-0.5 text-[10px] font-semibold bg-teal-50 text-teal-800 border border-teal-200 rounded">
                            {appt.service_name}
                            {appt.service_duration_minutes ? ` · ${appt.service_duration_minutes}m` : ''}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <StatusBadge status={appt.status} />
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5 flex-wrap justify-end">
                          {workspace.canConfirmAppointments && appt.status === 'requested' && (
                            <>
                              <button
                                disabled={submitting}
                                onClick={() => openSlotModal(appt, 'confirm')}
                                className="px-2.5 py-1 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Confirm
                              </button>
                              <button
                                disabled={submitting}
                                onClick={() => {
                                  setReasonModalTarget({
                                    id: appt.id,
                                    kind: 'decline_appt',
                                    title: `Decline Appointment — ${appt.pet_name}`,
                                  });
                                  setActionReason('');
                                }}
                                className="px-2.5 py-1 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 rounded-lg inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                                Decline
                              </button>
                            </>
                          )}

                          {workspace.canConfirmAppointments && appt.status === 'confirmed' && (
                            <>
                              <button
                                disabled={submitting}
                                onClick={() => void handleLifecycleAction('check_in', appt.id)}
                                className="px-2.5 py-1 text-xs font-semibold text-teal-700 bg-teal-50 border border-teal-200 hover:bg-teal-100 rounded-lg inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                              >
                                <UserCheck className="w-3.5 h-3.5" />
                                Check In
                              </button>
                              <button
                                disabled={submitting}
                                onClick={() => openSlotModal(appt, 'reschedule')}
                                className="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg whitespace-nowrap shrink-0"
                              >
                                Reschedule
                              </button>
                              <button
                                disabled={submitting}
                                onClick={() => void handleLifecycleAction('no_show', appt.id)}
                                className="px-2.5 py-1 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-lg whitespace-nowrap shrink-0"
                              >
                                No Show
                              </button>
                              <button
                                disabled={submitting}
                                onClick={() => {
                                  setReasonModalTarget({
                                    id: appt.id,
                                    kind: 'cancel_appt',
                                    title: `Cancel Appointment — ${appt.pet_name}`,
                                  });
                                  setActionReason('');
                                }}
                                className="px-2.5 py-1 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 rounded-lg whitespace-nowrap shrink-0"
                              >
                                Cancel
                              </button>
                            </>
                          )}

                          {workspace.canConfirmAppointments &&
                            (appt.status === 'checked_in' || appt.status === 'confirmed') && (
                              <button
                                disabled={submitting}
                                onClick={() =>
                                  void handleLifecycleAction('complete_appt', appt.id)
                                }
                                className="px-2.5 py-1 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg whitespace-nowrap shrink-0"
                              >
                                Complete Visit
                              </button>
                            )}

                          {workspace.canActivateConsultations &&
                            (appt.status === 'confirmed' ||
                              appt.status === 'checked_in' ||
                              appt.status === 'completed') &&
                            !appt.consultation_id && (
                              <button
                                disabled={submitting}
                                onClick={() =>
                                  void handleLifecycleAction('activate_cons', appt.id)
                                }
                                className="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                              >
                                <MessageSquare className="w-3.5 h-3.5 text-teal-700" />
                                Activate 7d Consult
                              </button>
                            )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pagination
              currentPage={paginatedAppointments.currentPage}
              totalPages={paginatedAppointments.totalPages}
              totalItems={paginatedAppointments.totalItems}
              startIndex={paginatedAppointments.startIndex}
              endIndex={paginatedAppointments.endIndex}
              pageSize={paginatedAppointments.pageSize}
              onPageChange={setApptPage}
              onPageSizeChange={(size) => {
                setApptPageSize(size);
                setApptPage(1);
              }}
              itemLabel="appointments"
            />
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-700 flex items-start gap-2.5">
            <Lock className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
            <span>
              <strong>Chat Transcript Privacy Enforced:</strong> Organization Administrators supervise consultation lifecycle metadata and doctor assignments only. Private and expired 7-day chat transcripts remain strictly accessible only to the client and treating veterinarian.
            </span>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            {filteredConsultations.length === 0 ? (
              <div className="p-10 text-center space-y-2">
                <Clock className="w-8 h-8 text-slate-400 mx-auto" />
                <div className="text-sm font-bold text-slate-900">No Consultations Found</div>
                <p className="text-xs text-slate-500">
                  Activated consultations linked to confirmed appointments appear here.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4">Patient & Client</th>
                    <th className="py-3 px-4">Branch</th>
                    <th className="py-3 px-4">Treating Doctor</th>
                    <th className="py-3 px-4">Status & Window</th>
                    <th className="py-3 px-4">Created</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paginatedConsultations.items.map((cons) => {
                    const timer = getDoctorChatWindowStatus(cons);
                    return (
                      <tr key={cons.id} className="hover:bg-slate-50/70">
                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-900">
                            {cons.pet_name} {cons.pet_species ? `(${cons.pet_species})` : ''}
                          </div>
                          <div className="text-[11px] text-slate-500">{cons.client_name}</div>
                        </td>
                        <td className="py-3 px-4 text-slate-700">{cons.branch_name}</td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-teal-900">{cons.doctor_name}</div>
                          <div className="text-[11px] text-slate-500">
                            {cons.doctor_specialization}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <StatusBadge status={cons.consultation_status} />
                            {cons.consultation_status === 'active' && (
                              <span className="font-mono text-[11px] text-teal-800 font-semibold tabular-nums">
                                {timer.formatted}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4 font-mono tabular-nums text-slate-500">
                          {new Date(cons.created_at).toLocaleDateString()}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="inline-flex items-center gap-1.5 justify-end">
                            {workspace.canManageStaff && workspace.canManageConsultations && (
                              <button
                                onClick={() => {
                                  setReassignTarget(cons);
                                  setReassignDoctorId(cons.doctor_id);
                                  setReassignReason('');
                                }}
                                className="px-2.5 py-1 text-xs font-semibold text-teal-700 bg-teal-50 border border-teal-200 hover:bg-teal-100 rounded-lg inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                              >
                                <RotateCw className="w-3.5 h-3.5" />
                                Reassign
                              </button>
                            )}
                            {workspace.canManageStaff &&
                              workspace.canManageConsultations &&
                              cons.consultation_status === 'active' && (
                                <button
                                  disabled={submitting}
                                  onClick={() =>
                                    void handleLifecycleAction('complete_cons', cons.id)
                                  }
                                  className="px-2.5 py-1 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg whitespace-nowrap shrink-0"
                                >
                                  Complete
                                </button>
                              )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <Pagination
                currentPage={paginatedConsultations.currentPage}
                totalPages={paginatedConsultations.totalPages}
                totalItems={paginatedConsultations.totalItems}
                startIndex={paginatedConsultations.startIndex}
                endIndex={paginatedConsultations.endIndex}
                pageSize={paginatedConsultations.pageSize}
                onPageChange={setConsPage}
                onPageSizeChange={(size) => {
                  setConsPageSize(size);
                  setConsPage(1);
                }}
                itemLabel="consultations"
              />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Confirm / Reschedule Slot Modal */}
      <Modal
        isOpen={Boolean(slotModalTarget)}
        onClose={() => setSlotModalTarget(null)}
        title={
          slotModalTarget?.mode === 'confirm'
            ? `Confirm Appointment — ${slotModalTarget.appointment.pet_name}`
            : `Reschedule Appointment — ${slotModalTarget?.appointment.pet_name || ''}`
        }
        subtitle={
          slotModalTarget
            ? `Branch: ${slotModalTarget.appointment.branch_name} (${slotModalTarget.appointment.branch_timezone})`
            : ''
        }
        maxWidth="lg"
      >
        {slotModalTarget && (
          <form onSubmit={handleSaveSlotModal} className="space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Assigned Doctor *
                </label>
                <select
                  disabled={slotModalTarget.mode === 'reschedule'}
                  value={slotDoctorId}
                  onChange={(e) => {
                    const nextDoc = e.target.value;
                    setSlotDoctorId(nextDoc);
                    void fetchSlotsForModal(
                      slotModalTarget.appointment.branch_id,
                      nextDoc,
                      slotDate,
                      slotModalTarget.appointment.service_id ?? null
                    );
                  }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                >
                  {(eligibleBranchDoctors.length > 0 ? eligibleBranchDoctors : doctors).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.full_name} ({d.specialization})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Recheck Schedule Date
                </label>
                <input
                  type="date"
                  value={slotDate}
                  onChange={(e) => {
                    const nextDate = e.target.value;
                    setSlotDate(nextDate);
                    void fetchSlotsForModal(
                      slotModalTarget.appointment.branch_id,
                      slotDoctorId,
                      nextDate,
                      slotModalTarget.appointment.service_id ?? null
                    );
                  }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div>
              <div className="font-semibold text-slate-700 mb-1.5">
                Available Open Slots for {slotDate}
              </div>
              {slotsLoading ? (
                <div className="py-3 flex items-center gap-2 text-slate-500">
                  <Loader2 className="w-4 h-4 animate-spin text-teal-700" />
                  Checking branch schedule and existing bookings...
                </div>
              ) : availableSlots.length === 0 ? (
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-slate-600">
                  No pre-computed slots returned for this date. You may verify the requested timestamp below; PostgreSQL GIST constraints will enforce conflict protection on save.
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-44 overflow-y-auto p-1">
                  {availableSlots.map((slot) => {
                    const selected =
                      slot.slot_start === selectedStartIso &&
                      slot.slot_end === selectedEndIso;
                    return (
                      <button
                        key={slot.slot_start}
                        type="button"
                        onClick={() => {
                          setSelectedStartIso(slot.slot_start);
                          setSelectedEndIso(slot.slot_end);
                        }}
                        className={`px-2.5 py-2 rounded-lg border font-mono text-[11px] tabular-nums ${
                          selected
                            ? 'bg-teal-700 text-white border-teal-700 font-bold'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {new Date(slot.slot_start).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}{' '}
                        –{' '}
                        {new Date(slot.slot_end).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
              <div>
                <div className="text-slate-500">Selected Start</div>
                <div className="font-mono font-semibold text-slate-900 mt-0.5">
                  {new Date(selectedStartIso).toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Selected End</div>
                <div className="font-mono font-semibold text-slate-900 mt-0.5">
                  {new Date(selectedEndIso).toLocaleString()}
                </div>
              </div>
            </div>

            {conflictAppt && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  Conflict detected with confirmed appointment for{' '}
                  <strong>{conflictAppt.pet_name}</strong> during this window. Choose a non-overlapping slot.
                </span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setSlotModalTarget(null)}
                className="px-4 py-2 font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || Boolean(conflictAppt)}
                className="px-5 py-2 font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg inline-flex items-center gap-1.5"
              >
                {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {slotModalTarget.mode === 'confirm' ? 'Confirm Slot' : 'Save Reschedule'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Decline / Cancel Reason Modal */}
      <Modal
        isOpen={Boolean(reasonModalTarget)}
        onClose={() => setReasonModalTarget(null)}
        title={reasonModalTarget?.title || 'Provide Reason'}
        maxWidth="md"
      >
        <form onSubmit={handleSubmitReasonModal} className="space-y-4 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Reason {reasonModalTarget?.kind === 'cancel_appt' ? '(Optional)' : '*'}
            </label>
            <textarea
              required={reasonModalTarget?.kind !== 'cancel_appt'}
              rows={3}
              value={actionReason}
              onChange={(e) => setActionReason(e.target.value)}
              placeholder="Reason recorded in appointment status history and audit logs..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setReasonModalTarget(null)}
              className="px-4 py-2 font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 font-semibold text-white bg-rose-700 hover:bg-rose-800 rounded-lg inline-flex items-center gap-1.5"
            >
              {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Confirm Action
            </button>
          </div>
        </form>
      </Modal>

      {/* Reassign Consultation Doctor Modal */}
      <Modal
        isOpen={Boolean(reassignTarget)}
        onClose={() => setReassignTarget(null)}
        title="Reassign Consultation Doctor"
        subtitle={
          reassignTarget
            ? `Patient: ${reassignTarget.pet_name} · Current: ${reassignTarget.doctor_name}`
            : ''
        }
        maxWidth="md"
      >
        <form onSubmit={handleConfirmReassign} className="space-y-4 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Target Active Doctor *
            </label>
            <select
              required
              value={reassignDoctorId}
              onChange={(e) => setReassignDoctorId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
            >
              {doctors
                .filter((d) => d.is_active)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.full_name} — {d.specialization}
                  </option>
                ))}
            </select>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Reassignment Reason *
            </label>
            <textarea
              required
              rows={2}
              value={reassignReason}
              onChange={(e) => setReassignReason(e.target.value)}
              placeholder="Doctor shift handoff / specialist escalation..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setReassignTarget(null)}
              className="px-4 py-2 font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg inline-flex items-center gap-1.5"
            >
              {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Save Reassignment
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
