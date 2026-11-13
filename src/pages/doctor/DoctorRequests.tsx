import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { useDoctorWorkspace } from '../../hooks/useDoctorWorkspace';
import { doctorPortalService } from '../../services/doctorPortalService';
import { formatSupabaseError } from '../../services/authService';
import { DoctorAppointment } from '../../types/doctor';
import {
  formatDateTimeInZone,
  formatTimeRangeInZone,
} from '../../utils/clientPortalHelpers';
import { canActivateConsultationForAppointment } from '../../utils/doctorPortalHelpers';
import { PageHeader } from '../../components/common/PageHeader';
import { StatusBadge } from '../../components/common/StatusBadge';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { EmptyState } from '../../components/common/EmptyState';
import { Pagination } from '../../components/common/Pagination';
import {
  compareIsoDates,
  isWithinDateRange,
  paginateItems,
  sortItems,
} from '../../utils/listManagementHelpers';
import {
  CalendarCheck,
  CheckCircle2,
  Clock,
  FilePlus,
  Lock,
  MessageSquare,
  PlayCircle,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react';

type AppointmentFilterTab =
  | 'all'
  | 'requested'
  | 'confirmed'
  | 'completed'
  | 'cancelled'
  | 'declined';

export const DoctorRequests: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useApp();
  const { workspace, doctorBasePath, doctorLoading } = useDoctorWorkspace();

  const [loading, setLoading] = useState(true);
  const [appointments, setAppointments] = useState<DoctorAppointment[]>([]);
  const [filter, setFilter] = useState<AppointmentFilterTab>('all');
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [busyApptId, setBusyApptId] = useState<string | null>(null);

  const loadAppointments = useCallback(async () => {
    if (!workspace) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const list = await doctorPortalService.getAppointments(
        workspace.organizationId,
        workspace.doctorProfileId
      );
      setAppointments(list);
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to load doctor appointments.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [workspace, showToast]);

  useEffect(() => {
    if (!doctorLoading) {
      void loadAppointments();
    }
  }, [doctorLoading, loadAppointments]);

  const counts = useMemo(() => {
    return {
      all: appointments.length,
      requested: appointments.filter((a) => a.status === 'requested').length,
      confirmed: appointments.filter(
        (a) => a.status === 'confirmed' || a.status === 'checked_in'
      ).length,
      completed: appointments.filter((a) => a.status === 'completed').length,
      cancelled: appointments.filter((a) => a.status === 'cancelled').length,
      declined: appointments.filter(
        (a) => a.status === 'declined' || a.status === 'no_show'
      ).length,
    };
  }, [appointments]);

  useEffect(() => {
    setPage(1);
  }, [filter, search, branchFilter, fromDate, toDate, sortOrder, pageSize]);

  const branchOptions = useMemo(() => {
    const map = new Map<string, string>();
    appointments.forEach((a) => {
      if (a.branch_id && a.branch_name) map.set(a.branch_id, a.branch_name);
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [appointments]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = appointments.filter((a) => {
      const matchesTab =
        filter === 'all' ||
        (filter === 'confirmed'
          ? a.status === 'confirmed' || a.status === 'checked_in'
          : filter === 'declined'
          ? a.status === 'declined' || a.status === 'no_show'
          : a.status === filter);
      if (!matchesTab) return false;
      if (branchFilter !== 'all' && a.branch_id !== branchFilter) return false;
      if (!isWithinDateRange(a.scheduled_start || a.requested_start, fromDate, toDate)) {
        return false;
      }
      if (!q) return true;
      return (
        (a.pet_name || '').toLowerCase().includes(q) ||
        (a.client_name || '').toLowerCase().includes(q) ||
        (a.branch_name || '').toLowerCase().includes(q) ||
        a.reason.toLowerCase().includes(q)
      );
    });
    return sortItems(
      list,
      (a, b) =>
        compareIsoDates(
          a.scheduled_start || a.requested_start,
          b.scheduled_start || b.requested_start
        ),
      sortOrder
    );
  }, [appointments, filter, search, branchFilter, fromDate, toDate, sortOrder]);

  const paged = useMemo(
    () => paginateItems(filtered, page, pageSize),
    [filtered, page, pageSize]
  );

  const handleStartConsultation = async (appt: DoctorAppointment) => {
    if (!workspace?.doctorProfileId) return;
    if (!canActivateConsultationForAppointment(appt, workspace.doctorProfileId)) {
      showToast(
        'A confirmed or checked-in appointment assigned to you is required before activating consultation.',
        'warning'
      );
      return;
    }

    setBusyApptId(appt.id);
    try {
      const consId = await doctorPortalService.createConsultationFromAppointment({
        appointment_id: appt.id,
        reason: appt.reason,
        activate_immediately: true,
      });
      showToast('7-day consultation activated for confirmed appointment.', 'success');
      await loadAppointments();
      if (consId) {
        navigate(`${doctorBasePath}/chat/${consId}`);
      }
    } catch (err) {
      showToast(formatSupabaseError(err, 'Unable to initiate consultation.'), 'error');
    } finally {
      setBusyApptId(null);
    }
  };

  const handleCompleteAppointment = async (apptId: string) => {
    setBusyApptId(apptId);
    try {
      await doctorPortalService.completeAppointment(apptId);
      showToast('Appointment marked completed.', 'success');
      await loadAppointments();
    } catch (err) {
      showToast(formatSupabaseError(err, 'Unable to complete appointment.'), 'error');
    } finally {
      setBusyApptId(null);
    }
  };

  if (doctorLoading || loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-10 flex justify-center">
        <LoadingSpinner label="Loading clinic appointments..." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Doctor Appointments Schedule"
        subtitle="Track requested, confirmed, completed, cancelled, and declined appointments across your assigned branches."
        action={
          <button
            type="button"
            onClick={() => void loadAppointments()}
            className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        }
      />

      {/* Separation-of-Duties Governance Banner */}
      <div className="p-4 rounded-xl bg-slate-900 text-slate-100 text-xs flex items-start gap-3">
        <ShieldCheck className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
        <div>
          <strong className="text-white block">
            Appointment Confirmation Governance
          </strong>
          <span className="text-slate-300">
            Requested appointments are confirmed or declined exclusively by authorized Front Desk or Clinic Administrators. Once confirmed, you can initiate consultations, manage clinical documentation, and complete the visit.
          </span>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-1">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search patient, owner, branch, or reason..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
              />
            </div>
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              aria-label="Filter appointments by branch"
              className="px-3 py-2 text-xs rounded-lg border border-slate-200 bg-slate-50 text-slate-800 font-medium"
            >
              <option value="all">All Branches</option>
              {branchOptions.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { key: 'all', label: `All (${counts.all})` },
              { key: 'requested', label: `Requested (${counts.requested})` },
              { key: 'confirmed', label: `Confirmed (${counts.confirmed})` },
              { key: 'completed', label: `Completed (${counts.completed})` },
              { key: 'cancelled', label: `Cancelled (${counts.cancelled})` },
              { key: 'declined', label: `Declined (${counts.declined})` },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFilter(tab.key as AppointmentFilterTab)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                  filter === tab.key
                    ? 'bg-teal-700 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-1.5 text-slate-600">
              <span className="font-semibold">From:</span>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                aria-label="Appointment start date"
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-700/20"
              />
            </label>
            <label className="inline-flex items-center gap-1.5 text-slate-600">
              <span className="font-semibold">To:</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                aria-label="Appointment end date"
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-700/20"
              />
            </label>
            {(fromDate || toDate || branchFilter !== 'all' || search) && (
              <button
                type="button"
                onClick={() => {
                  setFromDate('');
                  setToDate('');
                  setBranchFilter('all');
                  setSearch('');
                }}
                className="px-2.5 py-1.5 font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-lg border border-teal-200"
              >
                Clear Filters
              </button>
            )}
          </div>
          <label className="inline-flex items-center gap-1.5 text-slate-600">
            <span className="font-semibold">Sort:</span>
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as 'asc' | 'desc')}
              aria-label="Sort appointments"
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-800 font-medium"
            >
              <option value="desc">Newest First</option>
              <option value="asc">Oldest First</option>
            </select>
          </label>
        </div>
      </div>

      {/* Appointment Cards */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title="No Matching Appointments"
          description="There are no appointments matching the current status filter."
        />
      ) : (
        <div className="space-y-4">
          {paged.items.map((appt) => {
            const slotStart = appt.scheduled_start || appt.requested_start;
            const slotEnd = appt.scheduled_end || appt.requested_end;
            const isConfirmedOrCheckedIn =
              appt.status === 'confirmed' || appt.status === 'checked_in';
            const canStartConsultation =
              canActivateConsultationForAppointment(
                appt,
                workspace?.doctorProfileId
              ) && !appt.consultation_id;

            return (
              <div
                key={appt.id}
                className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={appt.status} />
                    <span className="text-xs font-bold text-slate-900">
                      {appt.branch_name}
                    </span>
                    <span className="text-slate-300">·</span>
                    <span className="text-xs text-slate-500 flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-teal-700" />
                      {formatDateTimeInZone(slotStart, appt.branch_timezone)} (
                      {formatTimeRangeInZone(slotStart, slotEnd, appt.branch_timezone)})
                    </span>
                    {appt.service_name && (
                      <span className="text-[11px] font-semibold bg-teal-50 text-teal-800 border border-teal-200 px-2 py-0.5 rounded">
                        {appt.service_name}
                        {appt.service_duration_minutes ? ` · ${appt.service_duration_minutes}m` : ''}
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] font-mono text-slate-400">
                    Appt #{appt.id.slice(0, 8)}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-100 text-xs">
                  <div>
                    <span className="text-slate-400 block font-medium">Pet Patient</span>
                    <span className="font-bold text-slate-900">{appt.pet_name}</span>
                    <span className="text-slate-500 block">
                      {[appt.pet_species, appt.pet_breed].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-medium">Pet Owner</span>
                    <span className="font-bold text-slate-900">{appt.client_name}</span>
                    {appt.client_phone && (
                      <span className="text-slate-500 block">{appt.client_phone}</span>
                    )}
                  </div>
                  <div>
                    <span className="text-slate-400 block font-medium">Visit Reason</span>
                    <span className="text-slate-800 font-medium">{appt.reason}</span>
                  </div>
                </div>

                {(appt.decline_reason || appt.cancellation_reason) && (
                  <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800">
                    <strong>
                      {appt.status === 'declined' ? 'Decline Reason: ' : 'Cancellation Reason: '}
                    </strong>
                    {appt.decline_reason || appt.cancellation_reason}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="text-[11px] text-slate-500">
                    {appt.status === 'requested' && (
                      <span className="inline-flex items-center gap-1 text-amber-800 font-medium">
                        <Lock className="w-3.5 h-3.5" />
                        Pending Front-Desk / Clinic Admin Confirmation
                      </span>
                    )}
                    {appt.consultation_id && (
                      <span className="inline-flex items-center gap-1.5 text-teal-800 font-semibold">
                        Consultation Linked ({appt.consultation_status})
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {appt.consultation_id && (
                      <button
                        type="button"
                        onClick={() =>
                          navigate(`${doctorBasePath}/chat/${appt.consultation_id}`)
                        }
                        className="px-3.5 py-1.5 text-xs font-semibold text-teal-700 bg-teal-50 border border-teal-200 hover:bg-teal-100 rounded-lg flex items-center gap-1.5"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        Open Consultation Chat
                      </button>
                    )}

                    {canStartConsultation && (
                      <button
                        type="button"
                        disabled={busyApptId === appt.id}
                        onClick={() => void handleStartConsultation(appt)}
                        className="px-3.5 py-1.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg flex items-center gap-1.5"
                      >
                        <PlayCircle className="w-3.5 h-3.5" />
                        {busyApptId === appt.id
                          ? 'Activating...'
                          : 'Start Consultation & 7-Day Chat'}
                      </button>
                    )}

                    {isConfirmedOrCheckedIn && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            navigate(`${doctorBasePath}/prescriptions`, {
                              state: { petId: appt.pet_id, appointmentId: appt.id },
                            })
                          }
                          className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg flex items-center gap-1"
                        >
                          <FilePlus className="w-3.5 h-3.5 text-teal-700" />
                          Issue Rx
                        </button>
                        <button
                          type="button"
                          disabled={busyApptId === appt.id}
                          onClick={() => void handleCompleteAppointment(appt.id)}
                          className="px-3 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-50 rounded-lg flex items-center gap-1"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Complete Visit
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
            <Pagination
              currentPage={paged.currentPage}
              totalPages={paged.totalPages}
              totalItems={paged.totalItems}
              startIndex={paged.startIndex}
              endIndex={paged.endIndex}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(next) => {
                setPageSize(next);
                setPage(1);
              }}
              itemLabel="appointments"
            />
          </div>
        </div>
      )}
    </div>
  );
};
