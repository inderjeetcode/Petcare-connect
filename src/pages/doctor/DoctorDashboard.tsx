import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { useDoctorWorkspace } from '../../hooks/useDoctorWorkspace';
import { doctorPortalService } from '../../services/doctorPortalService';
import { formatSupabaseError } from '../../services/authService';
import { Branch } from '../../types/auth';
import {
  DoctorAppointment,
  DoctorBranchAssignment,
  DoctorConsultation,
  DoctorNotification,
} from '../../types/doctor';
import {
  formatDateTimeInZone,
  formatTimeRangeInZone,
} from '../../utils/clientPortalHelpers';
import {
  canActivateConsultationForAppointment,
  getDoctorChatWindowStatus,
  isSameDayInTimezone,
} from '../../utils/doctorPortalHelpers';
import { computeDoctorWorkloadReport } from '../../utils/listManagementHelpers';
import { PageHeader } from '../../components/common/PageHeader';
import { MetricCard } from '../../components/common/MetricCard';
import { StatusBadge } from '../../components/common/StatusBadge';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { EmptyState } from '../../components/common/EmptyState';
import {
  Bell,
  Building2,
  CalendarCheck,
  CheckCircle2,
  ChevronRight,
  Clock,
  FilePlus,
  MapPin,
  MessageSquare,
  PlayCircle,
  RefreshCw,
  Stethoscope,
} from 'lucide-react';

export const DoctorDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { showToast, markNotificationRead } = useApp();
  const { workspace, doctorBasePath, doctorLoading } = useDoctorWorkspace();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [appointments, setAppointments] = useState<DoctorAppointment[]>([]);
  const [consultations, setConsultations] = useState<DoctorConsultation[]>([]);
  const [assignedBranches, setAssignedBranches] = useState<Branch[]>([]);
  const [assignments, setAssignments] = useState<DoctorBranchAssignment[]>([]);
  const [notifications, setNotifications] = useState<DoctorNotification[]>([]);
  const [clinicalCounts, setClinicalCounts] = useState({
    records: 0,
    prescriptions: 0,
    vaccinations: 0,
  });
  const [reportBranchId, setReportBranchId] = useState('all');
  const [reportFromDate, setReportFromDate] = useState('');
  const [reportToDate, setReportToDate] = useState('');
  const [startingApptId, setStartingApptId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const loadDashboard = useCallback(async () => {
    if (!workspace) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [orgData, appts, cons, notifs, recs, rxs, vaxs] = await Promise.all([
        doctorPortalService.getOrganizationAndBranches(
          workspace.organizationId,
          workspace.doctorProfileId
        ),
        doctorPortalService.getAppointments(
          workspace.organizationId,
          workspace.doctorProfileId
        ),
        doctorPortalService.getConsultations(
          workspace.organizationId,
          workspace.doctorProfileId
        ),
        doctorPortalService.getNotifications(workspace.organizationId, workspace.userId),
        doctorPortalService.getMedicalRecords(workspace.organizationId).catch(() => []),
        doctorPortalService.getPrescriptions(workspace.organizationId).catch(() => []),
        doctorPortalService.getVaccinations(workspace.organizationId).catch(() => []),
      ]);
      setAssignedBranches(orgData.assignedBranches);
      setAssignments(orgData.assignments.filter((a) => a.is_active));
      setAppointments(appts);
      setConsultations(cons);
      setNotifications(notifs);
      setClinicalCounts({
        records: recs.length,
        prescriptions: rxs.length,
        vaccinations: vaxs.length,
      });
    } catch (err) {
      setError(formatSupabaseError(err, 'Failed to load doctor dashboard data.'));
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => {
    if (!doctorLoading) {
      void loadDashboard();
    }
  }, [doctorLoading, loadDashboard]);

  const todaysAppointments = useMemo(() => {
    const now = new Date(nowMs);
    return appointments.filter((a) => {
      if (a.status === 'cancelled' || a.status === 'declined') return false;
      const targetIso = a.scheduled_start || a.requested_start;
      return isSameDayInTimezone(targetIso, a.branch_timezone || 'UTC', now);
    });
  }, [appointments, nowMs]);

  const upcomingAppointments = useMemo(() => {
    return appointments
      .filter((a) => {
        if (a.status !== 'confirmed' && a.status !== 'checked_in' && a.status !== 'requested') {
          return false;
        }
        const target = new Date(a.scheduled_start || a.requested_start).getTime();
        return !Number.isNaN(target) && target >= nowMs;
      })
      .sort((a, b) =>
        (a.scheduled_start || a.requested_start).localeCompare(
          b.scheduled_start || b.requested_start
        )
      )
      .slice(0, 6);
  }, [appointments, nowMs]);

  const pendingClinicalWork = useMemo(() => {
    const confirmedWithoutConsult = appointments.filter(
      (a) =>
        (a.status === 'confirmed' || a.status === 'checked_in') &&
        !a.consultation_id
    );
    const pendingConsults = consultations.filter(
      (c) => c.consultation_status === 'pending'
    );
    const activeConsults = consultations.filter(
      (c) => c.consultation_status === 'active'
    );
    return {
      confirmedWithoutConsult,
      pendingConsults,
      activeConsults,
      totalCount:
        confirmedWithoutConsult.length + pendingConsults.length + activeConsults.length,
    };
  }, [appointments, consultations]);

  const recentConsultations = useMemo(() => consultations.slice(0, 5), [consultations]);

  const workloadReport = useMemo(
    () =>
      computeDoctorWorkloadReport({
        appointments,
        consultations,
        medicalRecordsCount: clinicalCounts.records,
        prescriptionsCount: clinicalCounts.prescriptions,
        vaccinationsCount: clinicalCounts.vaccinations,
        branchId: reportBranchId,
        fromDate: reportFromDate,
        toDate: reportToDate,
      }),
    [
      appointments,
      consultations,
      clinicalCounts,
      reportBranchId,
      reportFromDate,
      reportToDate,
    ]
  );

  const handleStartConsultation = async (appt: DoctorAppointment) => {
    if (!workspace?.doctorProfileId) return;
    setStartingApptId(appt.id);
    try {
      const consId = await doctorPortalService.createConsultationFromAppointment({
        appointment_id: appt.id,
        reason: appt.reason,
        activate_immediately: true,
      });
      showToast('Consultation activated and 7-day chat initiated.', 'success');
      await loadDashboard();
      if (consId) {
        navigate(`${doctorBasePath}/chat/${consId}`);
      }
    } catch (err) {
      showToast(formatSupabaseError(err, 'Unable to start consultation.'), 'error');
    } finally {
      setStartingApptId(null);
    }
  };

  if (doctorLoading || loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12 flex justify-center">
        <LoadingSpinner label="Loading clinical dashboard..." />
      </div>
    );
  }

  if (!workspace || !workspace.doctorProfileId) {
    return (
      <EmptyState
        icon={Stethoscope}
        title="Doctor Profile Pending Provisioning"
        description="Your active doctor membership does not yet have an initialized clinical doctor profile in this organization."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Clinical Dashboard — ${workspace.profileName}`}
        subtitle={`${workspace.organizationName} · Multi-branch veterinary schedule, consultations, and clinical workflow`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void loadDashboard()}
              className="px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => navigate(`${doctorBasePath}/prescriptions`)}
              className="px-3.5 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors flex items-center gap-1.5 shadow-xs"
            >
              <FilePlus className="w-4 h-4" />
              Prescriptions
            </button>
            <button
              type="button"
              onClick={() => navigate(`${doctorBasePath}/requests`)}
              className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-1.5"
            >
              <CalendarCheck className="w-4 h-4 text-teal-700" />
              Appointments
            </button>
          </div>
        }
      />

      {error && (
        <div className="p-4 rounded-xl border border-rose-200 bg-rose-50 text-xs text-rose-800 flex items-center justify-between gap-3">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void loadDashboard()}
            className="px-3 py-1 font-semibold bg-white border border-rose-200 rounded-lg hover:bg-rose-100"
          >
            Retry
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <MetricCard
          label="Today's Appointments"
          value={todaysAppointments.length}
          icon={CalendarCheck}
          description="Scheduled in branch timezone"
        />
        <MetricCard
          label="Upcoming Visits"
          value={upcomingAppointments.length}
          icon={Clock}
          description="Future confirmed & requested"
        />
        <MetricCard
          label="Pending Clinical Work"
          value={pendingClinicalWork.totalCount}
          icon={Stethoscope}
          description="Visits & active cases"
          trend={pendingClinicalWork.totalCount > 0 ? 'Clinical action' : 'Up to date'}
          trendPositive={pendingClinicalWork.totalCount === 0}
        />
        <MetricCard
          label="Active 7-Day Chats"
          value={pendingClinicalWork.activeConsults.length}
          icon={MessageSquare}
          description="Live patient follow-ups"
        />
        <MetricCard
          label="Assigned Branches"
          value={assignedBranches.length}
          icon={Building2}
          description="Admin-governed locations"
        />
      </div>

      {/* Clinical Summary & Workload Indicators */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Clinical Summary & Workload Indicators
            </h2>
            <p className="text-xs text-slate-500">
              Appointment outcomes, consultation load, and branch distribution for your practice
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              value={reportBranchId}
              onChange={(e) => setReportBranchId(e.target.value)}
              aria-label="Filter workload report by branch"
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-teal-700/20"
            >
              <option value="all">All Assigned Branches</option>
              {assignedBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <label className="inline-flex items-center gap-1.5 text-slate-600">
              <span className="font-semibold">From:</span>
              <input
                type="date"
                value={reportFromDate}
                onChange={(e) => setReportFromDate(e.target.value)}
                aria-label="Workload report start date"
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-700/20"
              />
            </label>
            <label className="inline-flex items-center gap-1.5 text-slate-600">
              <span className="font-semibold">To:</span>
              <input
                type="date"
                value={reportToDate}
                onChange={(e) => setReportToDate(e.target.value)}
                aria-label="Workload report end date"
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-700/20"
              />
            </label>
            {(reportBranchId !== 'all' || reportFromDate || reportToDate) && (
              <button
                type="button"
                onClick={() => {
                  setReportBranchId('all');
                  setReportFromDate('');
                  setReportToDate('');
                }}
                className="px-2.5 py-1.5 font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-lg border border-teal-200"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
            <div className="text-[11px] font-semibold text-slate-500 uppercase">Appointments</div>
            <div className="text-lg font-extrabold text-slate-900 tabular-nums mt-0.5">
              {workloadReport.totalAppointments}
            </div>
            <div className="text-[11px] text-teal-700 tabular-nums">
              {workloadReport.completedAppointments} completed
            </div>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
            <div className="text-[11px] font-semibold text-slate-500 uppercase">Completion Rate</div>
            <div className="text-lg font-extrabold text-slate-900 tabular-nums mt-0.5">
              {workloadReport.completionRatePct}%
            </div>
            <div className="text-[11px] text-slate-500 tabular-nums">
              {workloadReport.missedOrCancelledAppointments} missed/closed
            </div>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
            <div className="text-[11px] font-semibold text-slate-500 uppercase">Consultations</div>
            <div className="text-lg font-extrabold text-slate-900 tabular-nums mt-0.5">
              {workloadReport.totalConsultations}
            </div>
            <div className="text-[11px] text-teal-700 tabular-nums">
              {workloadReport.activeChatsCount} active chats
            </div>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
            <div className="text-[11px] font-semibold text-slate-500 uppercase">Unique Patients</div>
            <div className="text-lg font-extrabold text-slate-900 tabular-nums mt-0.5">
              {workloadReport.uniquePatientsSeen}
            </div>
            <div className="text-[11px] text-slate-500">In selected scope</div>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
            <div className="text-[11px] font-semibold text-slate-500 uppercase">Medical Records</div>
            <div className="text-lg font-extrabold text-slate-900 tabular-nums mt-0.5">
              {workloadReport.medicalRecordsCount}
            </div>
            <div className="text-[11px] text-slate-500 tabular-nums">
              {workloadReport.vaccinationsCount} vaccines logged
            </div>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
            <div className="text-[11px] font-semibold text-slate-500 uppercase">Prescriptions</div>
            <div className="text-lg font-extrabold text-slate-900 tabular-nums mt-0.5">
              {workloadReport.prescriptionsCount}
            </div>
            <div className="text-[11px] text-slate-500">Org clinical ledger</div>
          </div>
        </div>

        {workloadReport.byBranch.length > 0 && (
          <div className="overflow-x-auto border border-slate-100 rounded-lg">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-100">
                <tr>
                  <th className="py-2.5 px-3">Branch</th>
                  <th className="py-2.5 px-3 text-right">Appointments</th>
                  <th className="py-2.5 px-3 text-right">Completed</th>
                  <th className="py-2.5 px-3 text-right">Active 7-Day Chats</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {workloadReport.byBranch.map((row) => (
                  <tr key={row.branchId} className="hover:bg-slate-50/50">
                    <td className="py-2 px-3 font-bold text-slate-900">{row.branchName}</td>
                    <td className="py-2 px-3 text-right font-semibold tabular-nums text-slate-800">
                      {row.appointmentCount}
                    </td>
                    <td className="py-2 px-3 text-right font-semibold tabular-nums text-emerald-700">
                      {row.completedCount}
                    </td>
                    <td className="py-2 px-3 text-right font-semibold tabular-nums text-teal-700">
                      {row.activeConsultationCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Clinical Column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Today's & Upcoming Appointments */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Today's & Upcoming Appointments
                </h2>
                <p className="text-xs text-slate-500">
                  Confirmed slots ready for clinical intake; requested slots await front-desk confirmation.
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate(`${doctorBasePath}/requests`)}
                className="text-xs font-semibold text-teal-700 hover:text-teal-800 flex items-center gap-1"
              >
                All appointments <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {todaysAppointments.length === 0 && upcomingAppointments.length === 0 ? (
              <div className="p-6 text-center bg-slate-50 rounded-xl border border-slate-100 text-xs text-slate-500">
                No appointments scheduled for today or upcoming dates.
              </div>
            ) : (
              <div className="space-y-3">
                {(todaysAppointments.length > 0 ? todaysAppointments : upcomingAppointments).map(
                  (appt) => {
                    const slotStart = appt.scheduled_start || appt.requested_start;
                    const slotEnd = appt.scheduled_end || appt.requested_end;
                    const canStart =
                      canActivateConsultationForAppointment(
                        appt,
                        workspace.doctorProfileId
                      ) && !appt.consultation_id;

                    return (
                      <div
                        key={appt.id}
                        className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge status={appt.status} />
                            <span className="text-xs font-bold text-slate-900">
                              {appt.pet_name}
                            </span>
                            {appt.pet_species && (
                              <span className="text-xs text-slate-500">
                                ({appt.pet_species})
                              </span>
                            )}
                            <span className="text-slate-300">·</span>
                            <span className="text-xs text-slate-600">
                              Owner: {appt.client_name}
                            </span>
                          </div>
                          <div className="text-xs text-slate-700 truncate">{appt.reason}</div>
                          <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-2">
                            <span className="font-medium text-teal-800">
                              {appt.branch_name}
                            </span>
                            <span>·</span>
                            <span>
                              {formatDateTimeInZone(slotStart, appt.branch_timezone)} (
                              {formatTimeRangeInZone(slotStart, slotEnd, appt.branch_timezone)})
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {appt.consultation_id ? (
                            <button
                              type="button"
                              onClick={() =>
                                navigate(`${doctorBasePath}/chat/${appt.consultation_id}`)
                              }
                              className="px-3 py-1.5 text-xs font-semibold text-teal-700 bg-white border border-teal-200 hover:bg-teal-50 rounded-lg flex items-center gap-1"
                            >
                              <MessageSquare className="w-3.5 h-3.5" />
                              Open Case
                            </button>
                          ) : canStart ? (
                            <button
                              type="button"
                              disabled={startingApptId === appt.id}
                              onClick={() => void handleStartConsultation(appt)}
                              className="px-3 py-1.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg flex items-center gap-1"
                            >
                              <PlayCircle className="w-3.5 h-3.5" />
                              {startingApptId === appt.id ? 'Starting...' : 'Start Consultation'}
                            </button>
                          ) : (
                            <span className="text-[11px] font-medium text-slate-500 px-2.5 py-1 bg-white border border-slate-200 rounded-lg">
                              {appt.status === 'requested'
                                ? 'Front-Desk Review'
                                : appt.status}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  }
                )}
              </div>
            )}
          </div>

          {/* Pending Clinical Work & Recent Consultations */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Recent Consultations & Pending Clinical Work
                </h2>
                <p className="text-xs text-slate-500">
                  Consultations linked to confirmed appointments with 7-day chat telemetry
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate(`${doctorBasePath}/consultations`)}
                className="text-xs font-semibold text-teal-700 hover:text-teal-800 flex items-center gap-1"
              >
                View all ({consultations.length}) <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {recentConsultations.length === 0 ? (
              <div className="p-6 text-center bg-slate-50 rounded-xl border border-slate-100 text-xs text-slate-500">
                No consultations assigned yet.
              </div>
            ) : (
              <div className="space-y-3">
                {recentConsultations.map((c) => {
                  const win = getDoctorChatWindowStatus(c, nowMs);
                  return (
                    <div
                      key={c.id}
                      className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge status={c.consultation_status} />
                          <span className="text-xs font-bold text-slate-900">
                            {c.pet_name}
                          </span>
                          <span className="text-xs text-slate-500">· {c.client_name}</span>
                          {c.branch_name && (
                            <span className="text-[11px] text-teal-700 font-medium">
                              · {c.branch_name}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-600 line-clamp-1">
                          {c.consultation_reason}
                        </p>
                      </div>

                      <div className="flex items-center gap-2.5 shrink-0">
                        {c.consultation_status === 'active' && (
                          <span className="text-[11px] font-mono font-bold text-teal-800 bg-teal-100/70 px-2 py-0.5 rounded flex items-center gap-1">
                            <Clock className="w-3 h-3 text-teal-700" />
                            {win.formatted}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => navigate(`${doctorBasePath}/chat/${c.id}`)}
                          className="px-3 py-1.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg flex items-center gap-1"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                          {win.canSendMessages ? 'Chat' : 'History'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Sidebar Column: Assigned Branches & Notifications */}
        <div className="space-y-6">
          {/* Assigned Branches (Read-Only) */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <Building2 className="w-4 h-4 text-teal-700" />
                Assigned Clinic Branches
              </h3>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                Read-Only
              </span>
            </div>

            {assignedBranches.length === 0 ? (
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-100 text-xs text-slate-500">
                No active branch assignments yet. Contact your clinic administrator.
              </div>
            ) : (
              <div className="space-y-2.5">
                {assignedBranches.map((branch) => {
                  const assignment = assignments.find((a) => a.branch_id === branch.id);
                  return (
                    <div
                      key={branch.id}
                      className="p-3 rounded-lg bg-slate-50 border border-slate-200/80 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-slate-900">{branch.name}</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600">
                          {branch.code}
                        </span>
                      </div>
                      {branch.address && (
                        <div className="text-[11px] text-slate-500 flex items-start gap-1">
                          <MapPin className="w-3 h-3 mt-0.5 shrink-0 text-slate-400" />
                          <span>{branch.address}</span>
                        </div>
                      )}
                      <div className="text-[11px] text-slate-500 flex items-center justify-between pt-1">
                        <span>TZ: {branch.timezone}</span>
                        {assignment?.effective_from && (
                          <span>Since {assignment.effective_from}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <button
              type="button"
              onClick={() => navigate(`${doctorBasePath}/availability`)}
              className="w-full py-2 text-xs font-semibold text-teal-700 border border-teal-200 hover:bg-teal-50 rounded-lg transition-colors"
            >
              Manage Branch Working Hours
            </button>
          </div>

          {/* Notifications */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <Bell className="w-4 h-4 text-teal-700" />
                Clinical Notifications
              </h3>
              <button
                type="button"
                onClick={() => navigate(`${doctorBasePath}/notifications`)}
                className="text-[11px] font-semibold text-teal-700 hover:text-teal-800"
              >
                {notifications.filter((n) => !n.is_read).length} unread · View all
              </button>
            </div>

            {notifications.length === 0 ? (
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-100 text-xs text-slate-500 text-center">
                No notifications yet.
              </div>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {notifications.slice(0, 6).map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => {
                      void markNotificationRead(n.id);
                      setNotifications((prev) =>
                        prev.map((item) =>
                          item.id === n.id ? { ...item, is_read: true } : item
                        )
                      );
                      if (n.link_url) {
                        const resolved = n.link_url.startsWith('/doctor/')
                          ? `${doctorBasePath}/${n.link_url.slice('/doctor/'.length)}`
                          : n.link_url;
                        navigate(resolved);
                      }
                    }}
                    className={`w-full text-left p-3 rounded-lg border text-xs transition-colors ${
                      n.is_read
                        ? 'bg-white border-slate-100 hover:bg-slate-50'
                        : 'bg-teal-50/60 border-teal-200 hover:bg-teal-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-slate-900 truncate">{n.title}</span>
                      {!n.is_read && (
                        <CheckCircle2 className="w-3.5 h-3.5 text-teal-700 shrink-0" />
                      )}
                    </div>
                    <p className="text-[11px] text-slate-600 mt-1 line-clamp-2">{n.message}</p>
                    <div className="text-[10px] text-slate-400 mt-1">
                      {new Date(n.created_at).toLocaleString()}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
