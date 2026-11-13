import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useClientWorkspace } from '../../hooks/useClientWorkspace';
import { clientPortalService } from '../../services/clientPortalService';
import { formatSupabaseError } from '../../services/authService';
import {
  ClientAppointment,
  ClientConsultation,
  ClientNotification,
  ClientOrganizationOverview,
  ClientPet,
  ClientPrescription,
} from '../../types/client';
import {
  computeChatWindowStatus,
  formatDateTimeInZone,
  formatTimeRangeInZone,
} from '../../utils/clientPortalHelpers';
import { computeClientSummaryReport } from '../../utils/listManagementHelpers';
import { PageHeader } from '../../components/common/PageHeader';
import { MetricCard } from '../../components/common/MetricCard';
import { StatusBadge } from '../../components/common/StatusBadge';
import { PrescriptionModal } from '../../components/common/PrescriptionModal';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Building2,
  Calendar,
  CalendarCheck,
  ChevronRight,
  Clock,
  FileText,
  MapPin,
  MessageSquare,
  PawPrint,
  Plus,
  RefreshCw,
  Stethoscope,
} from 'lucide-react';

export const ClientDashboard: React.FC = () => {
  const { workspace, clientBasePath } = useClientWorkspace();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [orgOverview, setOrgOverview] = useState<ClientOrganizationOverview | null>(null);
  const [pets, setPets] = useState<ClientPet[]>([]);
  const [appointments, setAppointments] = useState<ClientAppointment[]>([]);
  const [consultations, setConsultations] = useState<ClientConsultation[]>([]);
  const [prescriptions, setPrescriptions] = useState<ClientPrescription[]>([]);
  const [notifications, setNotifications] = useState<ClientNotification[]>([]);
  const [selectedRx, setSelectedRx] = useState<ClientPrescription | null>(null);
  const [reportFromDate, setReportFromDate] = useState('');
  const [reportToDate, setReportToDate] = useState('');

  const loadDashboard = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    setError(null);
    try {
      const [overview, dbPets, dbAppts, dbCons, dbRx, dbNotifs] = await Promise.all([
        clientPortalService.getOrganizationOverview(workspace.organizationId),
        clientPortalService.getPets(workspace.organizationId),
        clientPortalService.getAppointments(workspace.organizationId),
        clientPortalService.getConsultations(workspace.organizationId),
        clientPortalService.getPrescriptions(
          workspace.organizationId,
          undefined,
          workspace.profileName
        ),
        clientPortalService.getNotifications(
          workspace.organizationId,
          workspace.userId
        ),
      ]);
      setOrgOverview(overview);
      setPets(dbPets);
      setAppointments(dbAppts);
      setConsultations(dbCons);
      setPrescriptions(dbRx);
      setNotifications(dbNotifs);
    } catch (err) {
      setError(formatSupabaseError(err, 'Failed to load client dashboard data.'));
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  if (!workspace || loading) {
    return (
      <div className="py-12">
        <LoadingSpinner size="lg" message="Loading your veterinary clinic dashboard..." />
      </div>
    );
  }

  const upcomingAppointments = appointments.filter((a) =>
    ['requested', 'confirmed', 'checked_in'].includes(a.status)
  );
  const activeConsultations = consultations.filter(
    (c) => computeChatWindowStatus(c).canSendMessages
  );
  const unreadNotifications = notifications.filter((n) => !n.is_read);
  const summaryReport = computeClientSummaryReport({
    pets,
    appointments,
    consultations,
    prescriptions,
    fromDate: reportFromDate,
    toDate: reportToDate,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome back, ${workspace.profileName}`}
        subtitle={`Active Clinic: ${workspace.organizationName} · Manage pets, appointments, consultations, and medical history.`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void loadDashboard()}
              className="px-3 py-2 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => navigate(`${clientBasePath}/pets`)}
              className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4 text-slate-500" />
              Manage Pets
            </button>
            <button
              type="button"
              onClick={() => navigate(`${clientBasePath}/doctors`)}
              className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg flex items-center gap-1.5 shadow-xs"
            >
              <Stethoscope className="w-4 h-4" />
              Request Appointment
            </button>
          </div>
        }
      />

      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex items-center justify-between gap-3 text-xs text-rose-800">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => void loadDashboard()}
            className="px-3 py-1.5 font-semibold bg-white border border-rose-200 rounded-lg hover:bg-rose-100"
          >
            Retry
          </button>
        </div>
      )}

      {/* KPI Metrics Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Registered Pets"
          value={pets.length}
          icon={PawPrint}
          description={`Profiles in ${workspace.organizationName}`}
        />
        <MetricCard
          label="Upcoming Appointments"
          value={upcomingAppointments.length}
          icon={Calendar}
          description={`${upcomingAppointments.filter((a) => a.status === 'confirmed').length} confirmed · ${upcomingAppointments.filter((a) => a.status === 'requested').length} pending`}
        />
        <MetricCard
          label="Active 7-Day Chats"
          value={activeConsultations.length}
          icon={MessageSquare}
          description="Live clinical messaging windows"
        />
        <MetricCard
          label="Digital Prescriptions"
          value={prescriptions.length}
          icon={FileText}
          description={`${unreadNotifications.length} unread alerts`}
        />
      </div>

      {/* Client Care & Activity Report */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Care & Activity Summary Report
            </h2>
            <p className="text-xs text-slate-500">
              Pet overview, appointment history, and consultation activity across {workspace.organizationName}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <label className="inline-flex items-center gap-1.5 text-slate-600">
              <span className="font-semibold">From:</span>
              <input
                type="date"
                value={reportFromDate}
                onChange={(e) => setReportFromDate(e.target.value)}
                aria-label="Report start date"
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-700/20"
              />
            </label>
            <label className="inline-flex items-center gap-1.5 text-slate-600">
              <span className="font-semibold">To:</span>
              <input
                type="date"
                value={reportToDate}
                onChange={(e) => setReportToDate(e.target.value)}
                aria-label="Report end date"
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-700/20"
              />
            </label>
            {(reportFromDate || reportToDate) && (
              <button
                type="button"
                onClick={() => {
                  setReportFromDate('');
                  setReportToDate('');
                }}
                className="px-2.5 py-1.5 font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-lg border border-teal-200"
              >
                Reset Dates
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 text-xs">
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
            <div className="text-[11px] font-semibold text-slate-500 uppercase">Active Pets</div>
            <div className="text-lg font-extrabold text-slate-900 tabular-nums mt-0.5">
              {summaryReport.activePets}
            </div>
            <div className="text-[11px] text-slate-400 tabular-nums">
              {summaryReport.archivedPets} archived
            </div>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
            <div className="text-[11px] font-semibold text-slate-500 uppercase">Appointments</div>
            <div className="text-lg font-extrabold text-slate-900 tabular-nums mt-0.5">
              {summaryReport.totalAppointments}
            </div>
            <div className="text-[11px] text-teal-700 tabular-nums">
              {summaryReport.completedAppointments} completed
            </div>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
            <div className="text-[11px] font-semibold text-slate-500 uppercase">Pending / Booked</div>
            <div className="text-lg font-extrabold text-slate-900 tabular-nums mt-0.5">
              {summaryReport.requestedAppointments + summaryReport.upcomingAppointments}
            </div>
            <div className="text-[11px] text-slate-500 tabular-nums">
              {summaryReport.cancelledOrDeclinedAppointments} closed
            </div>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
            <div className="text-[11px] font-semibold text-slate-500 uppercase">Consultations</div>
            <div className="text-lg font-extrabold text-slate-900 tabular-nums mt-0.5">
              {summaryReport.totalConsultations}
            </div>
            <div className="text-[11px] text-teal-700 tabular-nums">
              {summaryReport.activeConsultations} active chats
            </div>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
            <div className="text-[11px] font-semibold text-slate-500 uppercase">Closed Cases</div>
            <div className="text-lg font-extrabold text-slate-900 tabular-nums mt-0.5">
              {summaryReport.completedConsultations + summaryReport.expiredConsultations}
            </div>
            <div className="text-[11px] text-slate-500 tabular-nums">
              {summaryReport.expiredConsultations} expired
            </div>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
            <div className="text-[11px] font-semibold text-slate-500 uppercase">Issued Rx</div>
            <div className="text-lg font-extrabold text-slate-900 tabular-nums mt-0.5">
              {summaryReport.issuedPrescriptions}
            </div>
            <div className="text-[11px] text-slate-500">In selected period</div>
          </div>
        </div>

        {summaryReport.petSummaries.length > 0 && (
          <div className="overflow-x-auto border border-slate-100 rounded-lg">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-100">
                <tr>
                  <th className="py-2.5 px-3">Pet</th>
                  <th className="py-2.5 px-3">Species</th>
                  <th className="py-2.5 px-3 text-right">Appointments</th>
                  <th className="py-2.5 px-3 text-right">Consultations</th>
                  <th className="py-2.5 px-3 text-right">Last Activity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {summaryReport.petSummaries.map((row) => (
                  <tr key={row.petId} className="hover:bg-slate-50/50">
                    <td className="py-2 px-3 font-bold text-slate-900">{row.petName}</td>
                    <td className="py-2 px-3 text-slate-600 capitalize">{row.species}</td>
                    <td className="py-2 px-3 text-right font-semibold tabular-nums text-slate-800">
                      {row.appointmentCount}
                    </td>
                    <td className="py-2 px-3 text-right font-semibold tabular-nums text-slate-800">
                      {row.consultationCount}
                    </td>
                    <td className="py-2 px-3 text-right text-slate-500 tabular-nums">
                      {row.lastActivityAt
                        ? new Date(row.lastActivityAt).toLocaleDateString()
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Main 2-Column Split */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Upcoming Appointments */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Upcoming Appointments
                </h2>
                <p className="text-xs text-slate-500">
                  Confirmed clinic visits and pending appointment requests
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate(`${clientBasePath}/consultations`)}
                className="text-xs font-semibold text-teal-700 hover:text-teal-800 flex items-center gap-1"
              >
                All Appointments ({appointments.length}) <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {upcomingAppointments.length === 0 ? (
              <div className="p-6 text-center bg-slate-50 rounded-lg border border-slate-100">
                <CalendarCheck className="w-7 h-7 text-slate-400 mx-auto mb-2" />
                <p className="text-xs font-semibold text-slate-700">
                  No upcoming appointments scheduled
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Browse branches, veterinarians, and open slots to submit a request.
                </p>
                <button
                  type="button"
                  onClick={() => navigate(`${clientBasePath}/doctors`)}
                  className="mt-3 px-3 py-1.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg"
                >
                  Browse Doctors & Slots
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {upcomingAppointments.slice(0, 4).map((appt) => (
                  <div
                    key={appt.id}
                    className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={appt.status} />
                        <span className="text-xs font-semibold text-slate-800">
                          {formatDateTimeInZone(appt.requested_start, appt.branch_timezone)}
                        </span>
                        <span className="text-[11px] text-slate-500">
                          ({formatTimeRangeInZone(appt.requested_start, appt.requested_end, appt.branch_timezone)})
                        </span>
                      </div>
                      <div className="text-sm font-bold text-slate-900">
                        {appt.pet_name} ·{' '}
                        <span className="font-medium text-slate-600">{appt.doctor_name}</span>
                      </div>
                      <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                        <MapPin className="w-3 h-3 text-teal-700" />
                        <span>{appt.branch_name}</span>
                        <span>·</span>
                        <span className="line-clamp-1">{appt.reason}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate(`${clientBasePath}/consultations`)}
                      className="px-3 py-1.5 text-xs font-semibold text-teal-700 border border-teal-200 bg-white hover:bg-teal-50 rounded-lg shrink-0"
                    >
                      Manage
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Consultations */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Recent Consultations
                </h2>
                <p className="text-xs text-slate-500">
                  Active 7-day chat access windows and recent clinical cases
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate(`${clientBasePath}/consultations`)}
                className="text-xs font-semibold text-teal-700 hover:text-teal-800 flex items-center gap-1"
              >
                View all ({consultations.length}) <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {consultations.length === 0 ? (
              <div className="p-6 text-center bg-slate-50 rounded-lg border border-slate-100 text-xs text-slate-500">
                No consultations recorded yet in {workspace.organizationName}.
              </div>
            ) : (
              <div className="space-y-3">
                {consultations.slice(0, 4).map((c) => {
                  const win = computeChatWindowStatus(c);
                  return (
                    <div
                      key={c.id}
                      className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                        win.isActive
                          ? 'border-teal-200 bg-teal-50/40'
                          : 'border-slate-200 bg-white'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge status={c.consultation_status} />
                          {win.isActive && (
                            <span className="text-xs font-mono tabular-nums text-teal-800 bg-teal-100 px-2 py-0.5 rounded font-semibold flex items-center gap-1">
                              <Clock className="w-3 h-3 text-teal-700" />
                              {win.formatted}
                            </span>
                          )}
                        </div>
                        <div className="text-sm font-bold text-slate-900">
                          {c.pet_name} ·{' '}
                          <span className="text-slate-600 font-medium">{c.doctor_name}</span>
                        </div>
                        <p className="text-xs text-slate-600 line-clamp-1">
                          {c.consultation_reason}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => navigate(`${clientBasePath}/chat/${c.id}`)}
                        className="px-3.5 py-1.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg flex items-center gap-1.5 shrink-0"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        {win.canSendMessages ? 'Open Chat' : 'View History'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Recent Prescriptions */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Recent Prescriptions
                </h2>
                <p className="text-xs text-slate-500">
                  Issued digital prescriptions and medication posology
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate(`${clientBasePath}/prescriptions`)}
                className="text-xs font-semibold text-teal-700 hover:text-teal-800 flex items-center gap-1"
              >
                All Prescriptions <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {prescriptions.length === 0 ? (
              <div className="p-6 text-center bg-slate-50 rounded-lg border border-slate-100 text-xs text-slate-500">
                No prescriptions issued for your pets yet.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {prescriptions.slice(0, 3).map((rx) => (
                  <div
                    key={rx.id}
                    className="py-3 flex items-center justify-between gap-4"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-900">
                          {rx.pet_name}
                        </span>
                        <span className="text-xs text-slate-400">·</span>
                        <span className="text-xs text-slate-600">{rx.diagnosis}</span>
                        {rx.status === 'void' && <StatusBadge status="void" />}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {rx.doctor_name} · {rx.items.length} item(s) ·{' '}
                        {new Date(rx.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedRx(rx)}
                      className="px-3 py-1.5 text-xs font-semibold text-teal-700 hover:bg-teal-50 border border-teal-200 rounded-lg shrink-0 flex items-center gap-1"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      View Rx
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* Organization Information */}
          {orgOverview && (
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-teal-700" />
                  Clinic Information
                </h2>
                <button
                  type="button"
                  onClick={() => navigate(`${clientBasePath}/organizations`)}
                  className="text-xs font-semibold text-teal-700 hover:text-teal-800"
                >
                  Switch / Join
                </button>
              </div>
              <div className="text-xs space-y-1.5">
                <div className="font-bold text-slate-900">
                  {orgOverview.organization.display_name}
                </div>
                <div className="text-slate-500">
                  {orgOverview.organization.legal_name} ·{' '}
                  {orgOverview.organization.country} ({orgOverview.organization.timezone})
                </div>
                {orgOverview.organization.contact_email && (
                  <div className="text-slate-600">
                    Email: {orgOverview.organization.contact_email}
                  </div>
                )}
                {orgOverview.organization.phone && (
                  <div className="text-slate-600">
                    Phone: {orgOverview.organization.phone}
                  </div>
                )}
              </div>
              <div className="pt-2 border-t border-slate-100 space-y-1.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Active Branches ({orgOverview.branches.length})
                </div>
                {orgOverview.branches.map((b) => (
                  <div
                    key={b.id}
                    className="p-2 rounded-lg bg-slate-50 border border-slate-100 text-xs"
                  >
                    <div className="font-semibold text-slate-800">{b.name}</div>
                    {b.address && (
                      <div className="text-[11px] text-slate-500">{b.address}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pet Summary */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-slate-900">My Pets</h2>
              <button
                type="button"
                onClick={() => navigate(`${clientBasePath}/pets`)}
                className="text-xs font-semibold text-teal-700 hover:text-teal-800 flex items-center gap-1"
              >
                Manage <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
            {pets.length === 0 ? (
              <div className="p-4 text-center bg-slate-50 rounded-lg border border-slate-100 space-y-2">
                <p className="text-xs text-slate-500">
                  No pets registered in this clinic yet.
                </p>
                <button
                  type="button"
                  onClick={() => navigate(`${clientBasePath}/pets`)}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-teal-700 rounded-lg"
                >
                  Register First Pet
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                {pets.slice(0, 4).map((pet) => (
                  <div
                    key={pet.id}
                    onClick={() => navigate(`${clientBasePath}/pets/${pet.id}`)}
                    className="p-3 rounded-lg border border-slate-100 bg-slate-50/70 hover:bg-slate-100 cursor-pointer flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {pet.avatar_url ? (
                        <img
                          src={pet.avatar_url}
                          alt={pet.name}
                          className="w-10 h-10 rounded-lg object-cover border border-slate-200 shrink-0"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-teal-100 text-teal-800 flex items-center justify-center font-bold text-xs shrink-0">
                          {pet.name[0]?.toUpperCase() || 'P'}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-900 truncate">
                          {pet.name}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate">
                          {pet.species} · {pet.breed}
                        </div>
                        <div className="text-[10px] text-teal-700 font-medium">
                          {pet.weight} kg · {pet.gender}
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Notifications */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Bell className="w-4 h-4 text-teal-700" />
                Recent Alerts ({unreadNotifications.length} unread)
              </h2>
              <button
                type="button"
                onClick={() => navigate(`${clientBasePath}/notifications`)}
                className="text-xs font-semibold text-teal-700 hover:text-teal-800 flex items-center gap-1"
              >
                All <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
            {notifications.length === 0 ? (
              <p className="text-xs text-slate-500">No recent notifications.</p>
            ) : (
              <div className="space-y-2">
                {notifications.slice(0, 4).map((n) => (
                  <div
                    key={n.id}
                    onClick={() => navigate(`${clientBasePath}/notifications`)}
                    className={`p-2.5 rounded-lg border text-xs cursor-pointer ${
                      n.is_read
                        ? 'bg-slate-50 border-slate-100 text-slate-600'
                        : 'bg-teal-50/60 border-teal-200 text-slate-900'
                    }`}
                  >
                    <div className="font-bold flex items-center justify-between gap-2">
                      <span className="truncate">{n.title}</span>
                      {!n.is_read && (
                        <span className="w-2 h-2 rounded-full bg-teal-600 shrink-0" />
                      )}
                    </div>
                    <p className="text-[11px] text-slate-600 line-clamp-2 mt-0.5">
                      {n.message}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <PrescriptionModal
        prescription={selectedRx}
        isOpen={Boolean(selectedRx)}
        onClose={() => setSelectedRx(null)}
        organizationName={workspace.organizationName}
      />
    </div>
  );
};
