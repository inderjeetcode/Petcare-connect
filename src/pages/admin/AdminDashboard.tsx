import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/common/PageHeader';
import { MetricCard } from '../../components/common/MetricCard';
import { useAdminWorkspace } from '../../hooks/useAdminWorkspace';
import { adminPortalService } from '../../services/adminPortalService';
import { formatSupabaseError } from '../../services/authService';
import { useApp } from '../../context/AppContext';
import { AdminOperationalOverview } from '../../types/admin';
import { computeAdminOperationalReport } from '../../utils/adminPortalHelpers';
import {
  Activity,
  ArrowRight,
  Building2,
  CalendarCheck,
  Clock,
  Loader2,
  MapPin,
  PawPrint,
  RefreshCw,
  ShieldCheck,
  Stethoscope,
  UserCheck,
  Users,
} from 'lucide-react';

export const AdminDashboard: React.FC = () => {
  const { workspace, adminBasePath } = useAdminWorkspace();
  const { showToast } = useApp();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<AdminOperationalOverview | null>(null);

  const loadDashboard = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    try {
      const data = await adminPortalService.getOperationalOverview({
        organizationId: workspace.organizationId,
        canManageStaff: workspace.canManageStaff,
        canReadClients: workspace.canReadClients,
        canReadPets: workspace.canReadPets,
        canReadAppointments: workspace.canReadAppointments,
        canReadAudit: workspace.canReadAudit,
        membershipBranchIds: workspace.isBranchScoped
          ? workspace.membershipBranchIds
          : undefined,
      });
      setOverview(data);
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to load organization overview.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [workspace, showToast]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  if (!workspace) {
    return null;
  }

  const org = overview?.organization;
  const branches = overview?.branches || [];
  const activeBranches = branches.filter((b) => b.is_active);
  const members = overview?.members || [];
  const activeStaff = members.filter((m) => m.status === 'active');
  const pendingInvites = (overview?.invitations || []).filter(
    (inv) => !inv.accepted_at && !inv.revoked_at && new Date(inv.expires_at) > new Date()
  );
  const doctors = overview?.doctors || [];
  const activeDoctors = doctors.filter((d) => d.is_active);
  const clients = overview?.clients || [];
  const approvedClients = clients.filter((c) => c.status === 'approved');
  const pendingClients = clients.filter((c) => c.status === 'requested');
  const pets = overview?.pets || [];
  const appointments = overview?.appointments || [];
  const consultations = overview?.consultations || [];
  const services = overview?.services || [];
  const auditLogs = overview?.auditLogs || [];

  const report = computeAdminOperationalReport({
    branches,
    appointments,
    consultations,
    doctors,
  });

  const activeConsultations = consultations.filter((c) => c.consultation_status === 'active');
  const pendingAppointmentRequests = appointments.filter((a) => a.status === 'requested');

  const todayIsoDate = new Date().toISOString().slice(0, 10);
  const todaysAppointments = appointments.filter((a) => {
    const dt = a.scheduled_start || a.requested_start;
    return dt.slice(0, 10) === todayIsoDate && a.status !== 'cancelled' && a.status !== 'declined';
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${workspace.organizationName} — Admin Portal`}
        subtitle="Tenant-isolated clinical operations, branch governance, staff permissions, and appointment oversight."
        action={
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => void loadDashboard()}
              disabled={loading}
              className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            {workspace.canConfirmAppointments && (
              <button
                onClick={() => navigate(`${adminBasePath}/consultations`)}
                className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <CalendarCheck className="w-4 h-4" />
                Appointments Queue ({pendingAppointmentRequests.length})
              </button>
            )}
          </div>
        }
      />

      {/* Organization Metadata Strip */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Building2 className="w-4 h-4 text-teal-700 shrink-0" />
            <span className="font-semibold text-slate-900">
              {org?.legal_name || workspace.organizationName}
            </span>
            <span aria-hidden="true">·</span>
            <span>Status: {org?.status || 'active'}</span>
            <span aria-hidden="true">·</span>
            <span>Timezone: {org?.timezone || 'UTC'}</span>
            {org?.country && (
              <>
                <span aria-hidden="true">·</span>
                <span>Region: {org.country}</span>
              </>
            )}
          </div>
          <div className="text-xs text-slate-500 flex items-center gap-2 flex-wrap">
            <span>Signed in as {workspace.userName}</span>
            <span aria-hidden="true">·</span>
            <span>Roles: {workspace.roles.join(', ')}</span>
            <span aria-hidden="true">·</span>
            <span>
              Scope:{' '}
              {workspace.isBranchScoped
                ? `${workspace.membershipBranchIds.length} assigned branch(es)`
                : 'Organization-wide'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {workspace.canManageBranches && (
            <button
              onClick={() => navigate(`${adminBasePath}/branches`)}
              className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              Branches ({activeBranches.length}/{branches.length})
            </button>
          )}
          {workspace.canManageStaff && (
            <button
              onClick={() => navigate(`${adminBasePath}/onboarding`)}
              className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              Staff & Invites ({activeStaff.length})
            </button>
          )}
          {workspace.canManageOrg && (
            <button
              onClick={() => navigate(`${adminBasePath}/settings`)}
              className="px-3 py-1.5 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              Services & Settings ({services.filter((s) => s.is_active).length})
            </button>
          )}
        </div>
      </div>

      {loading && !overview ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
          <Loader2 className="w-6 h-6 text-teal-700 animate-spin mx-auto mb-2" />
          <p className="text-xs text-slate-500">Loading organization metrics...</p>
        </div>
      ) : (
        <>
          {/* Primary Metric Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              label="Clinic Branches"
              value={activeBranches.length}
              icon={MapPin}
              description={`${branches.length} total · ${branches.length - activeBranches.length} suspended`}
            />
            <MetricCard
              label="Staff & Doctors"
              value={activeStaff.length}
              icon={Stethoscope}
              description={`${activeDoctors.length} active doctors · ${pendingInvites.length} pending invites`}
            />
            <MetricCard
              label="Clinic Clients & Pets"
              value={approvedClients.length}
              icon={Users}
              description={`${pendingClients.length} pending approval · ${pets.length} active pets`}
            />
            <MetricCard
              label="Total Appointments"
              value={appointments.length}
              icon={CalendarCheck}
              description={`${todaysAppointments.length} scheduled today · ${activeConsultations.length} active chats`}
            />
          </div>

          {/* Operational Indicators Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-xl border border-slate-200">
              <div className="text-xs font-semibold text-slate-500">Pending Appointment Requests</div>
              <div className="text-2xl font-bold text-amber-700 tabular-nums mt-1">
                {report.requestedCount}
              </div>
              <div className="text-xs text-slate-500 mt-1">Awaiting front desk or admin confirmation</div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200">
              <div className="text-xs font-semibold text-slate-500">Confirmed & Checked In</div>
              <div className="text-2xl font-bold text-teal-800 tabular-nums mt-1">
                {report.confirmedCount + report.checkedInCount}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {report.confirmedCount} confirmed · {report.checkedInCount} checked in
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200">
              <div className="text-xs font-semibold text-slate-500">Confirmation & Completion</div>
              <div className="text-2xl font-bold text-slate-900 tabular-nums mt-1">
                {report.confirmationRatePct}% / {report.completionRatePct}%
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {report.completedCount} completed · {report.noShowCount} no-show
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200">
              <div className="text-xs font-semibold text-slate-500">Active Clinic Services</div>
              <div className="text-2xl font-bold text-slate-900 tabular-nums mt-1">
                {services.filter((s) => s.is_active).length}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {services.length} total catalogued procedures
              </div>
            </div>
          </div>

          {/* Main Operational Queues & Branch Summary */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              {/* Branch Operations Summary */}
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">Branch Operational Summary</h2>
                    <p className="text-xs text-slate-500">
                      Appointment load and practitioner coverage across clinic locations
                    </p>
                  </div>
                  <button
                    onClick={() => navigate(`${adminBasePath}/branches`)}
                    className="text-xs font-semibold text-teal-700 hover:text-teal-800 inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                  >
                    Manage Branches
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                {branches.length === 0 ? (
                  <p className="text-xs text-slate-500 py-4">No branches found for this organization.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                        <tr>
                          <th className="py-2.5 px-3">Branch</th>
                          <th className="py-2.5 px-3">Status</th>
                          <th className="py-2.5 px-3 text-right">Doctors</th>
                          <th className="py-2.5 px-3 text-right">Pending</th>
                          <th className="py-2.5 px-3 text-right">Total Appts</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {branches.map((branch) => {
                          const branchStats = report.byBranch.find((b) => b.branchId === branch.id);
                          const assignedDocsCount = doctors.filter((d) =>
                            d.branch_ids.includes(branch.id)
                          ).length;

                          return (
                            <tr key={branch.id} className="hover:bg-slate-50/70">
                              <td className="py-2.5 px-3">
                                <div className="font-semibold text-slate-900">{branch.name}</div>
                                <div className="text-[11px] text-slate-500 font-mono">
                                  {branch.code} · {branch.timezone}
                                </div>
                              </td>
                              <td className="py-2.5 px-3">
                                <span
                                  className={`text-xs font-semibold ${
                                    branch.is_active ? 'text-emerald-700' : 'text-rose-700'
                                  }`}
                                >
                                  {branch.is_active ? 'Active' : 'Suspended'}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700">
                                {assignedDocsCount}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono tabular-nums text-amber-700 font-semibold">
                                {branchStats?.requestedCount || 0}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-900 font-semibold">
                                {branchStats?.totalAppointments || 0}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {report.unmappedLegacyConsultationsCount > 0 && (
                  <p className="text-[11px] text-slate-500 mt-3 pt-3 border-t border-slate-100">
                    Note: {report.unmappedLegacyConsultationsCount} historical consultation(s) have no verified source branch and remain intentionally unmapped to preserve audit integrity.
                  </p>
                )}
              </div>

              {/* Pending Appointment Requests */}
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">
                      Pending Appointment Confirmations
                    </h2>
                    <p className="text-xs text-slate-500">
                      Requested visits requiring schedule verification and branch confirmation
                    </p>
                  </div>
                  <button
                    onClick={() => navigate(`${adminBasePath}/consultations`)}
                    className="text-xs font-semibold text-teal-700 hover:text-teal-800 inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                  >
                    Review Queue
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                {pendingAppointmentRequests.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-lg">
                    No appointment requests are currently awaiting confirmation.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {pendingAppointmentRequests.slice(0, 5).map((appt) => (
                      <div
                        key={appt.id}
                        className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-slate-900">
                            {appt.pet_name} · {appt.client_name}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5 truncate">
                            {appt.branch_name} · {appt.doctor_name} ·{' '}
                            {new Date(appt.requested_start).toLocaleString()}
                          </div>
                        </div>
                        <button
                          onClick={() => navigate(`${adminBasePath}/consultations`)}
                          className="px-3 py-1.5 text-xs font-semibold text-teal-700 hover:bg-teal-50 border border-teal-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
                        >
                          Review Slot
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Action Queues & Organization Audit */}
            <div className="space-y-6">
              {/* Pending Client Approvals */}
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                    <UserCheck className="w-4 h-4 text-teal-700" />
                    Client Join Requests
                  </h3>
                  <button
                    onClick={() => navigate(`${adminBasePath}/clients`)}
                    className="text-xs font-semibold text-teal-700 hover:text-teal-800 whitespace-nowrap shrink-0"
                  >
                    View All
                  </button>
                </div>

                {pendingClients.length === 0 ? (
                  <p className="text-xs text-slate-500">All clinic join requests are processed.</p>
                ) : (
                  <div className="space-y-2.5">
                    {pendingClients.slice(0, 4).map((client) => (
                      <div
                        key={client.id}
                        className="p-2.5 rounded-lg bg-slate-50 border border-slate-100 text-xs flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900 truncate">
                            {client.full_name}
                          </div>
                          <div className="text-[11px] text-slate-500 truncate">
                            {client.email || client.phone || 'No contact provided'}
                          </div>
                        </div>
                        <button
                          onClick={() => navigate(`${adminBasePath}/clients`)}
                          className="px-2.5 py-1 text-[11px] font-semibold text-teal-700 bg-white border border-teal-200 rounded-md hover:bg-teal-50 shrink-0"
                        >
                          Review
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Recent Audit Activity */}
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                    <Activity className="w-4 h-4 text-teal-700" />
                    Recent Organization Audit
                  </h3>
                  {workspace.canReadAudit && (
                    <button
                      onClick={() => navigate(`${adminBasePath}/reports`)}
                      className="text-xs font-semibold text-teal-700 hover:text-teal-800 whitespace-nowrap shrink-0"
                    >
                      Full Log
                    </button>
                  )}
                </div>

                {!workspace.canReadAudit ? (
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-100 text-xs text-slate-600 flex items-start gap-2">
                    <ShieldCheck className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                    <span>
                      Audit logs are restricted to roles with the <code className="font-mono">audit.read</code> permission.
                    </span>
                  </div>
                ) : auditLogs.length === 0 ? (
                  <p className="text-xs text-slate-500">No recent audit events recorded.</p>
                ) : (
                  <div className="space-y-2.5">
                    {auditLogs.slice(0, 6).map((log) => (
                      <div
                        key={log.id}
                        className="p-2.5 rounded-lg bg-slate-50 border border-slate-100 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="font-mono font-bold text-teal-900 truncate">
                            {log.action}
                          </span>
                          <span className="text-slate-400 font-mono tabular-nums shrink-0">
                            {new Date(log.created_at).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                        {log.details && (
                          <p className="text-slate-600 text-[11px] mt-1 leading-snug">
                            {log.details}
                          </p>
                        )}
                        <div className="text-[11px] text-slate-400 mt-1">
                          {log.actor_name} · {log.entity_type}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Privacy & Security Notice */}
              <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 text-xs text-slate-600 flex items-start gap-2.5">
                <Clock className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-slate-900">Consultation Chat Privacy</div>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                    Administrative roles supervise appointments and metadata only. Private 7-day chat transcripts remain restricted to clients and treating veterinarians.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
