import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useAdminWorkspace } from '../../hooks/useAdminWorkspace';
import { adminPortalService } from '../../services/adminPortalService';
import { formatSupabaseError } from '../../services/authService';
import {
  buildAuditExportCsv,
  computeAdminClientPetMetrics,
  computeAdminOperationalReport,
  computeServiceUsageSummary,
} from '../../utils/adminPortalHelpers';
import {
  compareIsoDates,
  compareStrings,
  isWithinDateRange,
  paginateItems,
  sortItems,
} from '../../utils/listManagementHelpers';
import { AdminOperationalOverview } from '../../types/admin';
import { PageHeader } from '../../components/common/PageHeader';
import { Pagination } from '../../components/common/Pagination';
import {
  AlertTriangle,
  ArrowUpDown,
  BriefcaseMedical,
  Calendar,
  Download,
  Loader2,
  Lock,
  PawPrint,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react';

export const AdminReports: React.FC = () => {
  const { workspace } = useAdminWorkspace();
  const { showToast } = useApp();

  const orgId = workspace?.organizationId || '';
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<AdminOperationalOverview | null>(null);

  // Operational report filters
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [branchFilter, setBranchFilter] = useState('all');
  const [doctorFilter, setDoctorFilter] = useState('all');

  // Service summary table pagination
  const [servicePage, setServicePage] = useState(1);
  const [servicePageSize, setServicePageSize] = useState(10);

  // Audit log filters, sorting & pagination
  const [auditSearch, setAuditSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [auditSortBy, setAuditSortBy] = useState<'created_at' | 'action' | 'actor_name'>('created_at');
  const [auditSortDir, setAuditSortDir] = useState<'asc' | 'desc'>('desc');
  const [auditPage, setAuditPage] = useState(1);
  const [auditPageSize, setAuditPageSize] = useState(15);

  const loadData = useCallback(async () => {
    if (!orgId || !workspace) return;
    setLoading(true);
    try {
      const data = await adminPortalService.getOperationalOverview({
        organizationId: orgId,
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
      showToast(formatSupabaseError(err, 'Failed to load operational analytics.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [orgId, workspace, showToast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    setServicePage(1);
    setAuditPage(1);
  }, [fromDate, toDate, branchFilter, doctorFilter, auditSearch, actionFilter, auditSortBy, auditSortDir]);

  const filteredAppointments = useMemo(() => {
    if (!overview) return [];
    return overview.appointments.filter((appt) => {
      if (branchFilter !== 'all' && appt.branch_id !== branchFilter) return false;
      if (doctorFilter !== 'all' && appt.doctor_profile_id !== doctorFilter) return false;
      const targetDate = appt.scheduled_start || appt.requested_start || appt.created_at;
      return isWithinDateRange(targetDate, fromDate, toDate);
    });
  }, [overview, branchFilter, doctorFilter, fromDate, toDate]);

  const filteredConsultations = useMemo(() => {
    if (!overview) return [];
    return overview.consultations.filter((cons) => {
      if (branchFilter !== 'all' && cons.branch_id !== branchFilter) return false;
      if (doctorFilter !== 'all' && cons.doctor_id !== doctorFilter) return false;
      const targetDate = cons.activated_at || cons.created_at;
      return isWithinDateRange(targetDate, fromDate, toDate);
    });
  }, [overview, branchFilter, doctorFilter, fromDate, toDate]);

  const scopedBranches = useMemo(() => {
    if (!overview) return [];
    if (branchFilter === 'all') return overview.branches;
    return overview.branches.filter((b) => b.id === branchFilter);
  }, [overview, branchFilter]);

  const scopedDoctors = useMemo(() => {
    if (!overview) return [];
    if (doctorFilter === 'all') return overview.doctors;
    return overview.doctors.filter((d) => d.id === doctorFilter);
  }, [overview, doctorFilter]);

  const report = useMemo(() => {
    if (!overview) return null;
    return computeAdminOperationalReport({
      branches: scopedBranches,
      appointments: filteredAppointments,
      consultations: filteredConsultations,
      doctors: scopedDoctors,
    });
  }, [overview, scopedBranches, filteredAppointments, filteredConsultations, scopedDoctors]);

  const clientPetMetrics = useMemo(() => {
    if (!overview) return null;
    return computeAdminClientPetMetrics(overview.clients, overview.pets);
  }, [overview]);

  const serviceSummaries = useMemo(() => {
    if (!overview) return [];
    const scopedServices =
      branchFilter === 'all'
        ? overview.services
        : overview.services.filter((s) => !s.branch_id || s.branch_id === branchFilter);
    return computeServiceUsageSummary(scopedServices, filteredAppointments);
  }, [overview, branchFilter, filteredAppointments]);

  const paginatedServices = useMemo(
    () => paginateItems(serviceSummaries, servicePage, servicePageSize),
    [serviceSummaries, servicePage, servicePageSize]
  );

  const auditActions = useMemo(() => {
    if (!overview) return [];
    return Array.from(new Set(overview.auditLogs.map((l) => l.action))).sort();
  }, [overview]);

  const filteredLogs = useMemo(() => {
    if (!overview) return [];
    const q = auditSearch.trim().toLowerCase();
    const filtered = overview.auditLogs.filter((log) => {
      if (actionFilter !== 'all' && log.action !== actionFilter) return false;
      if (!isWithinDateRange(log.created_at, fromDate, toDate)) return false;
      if (!q) return true;
      return (
        log.actor_name.toLowerCase().includes(q) ||
        log.actor_email.toLowerCase().includes(q) ||
        log.action.toLowerCase().includes(q) ||
        log.entity_type.toLowerCase().includes(q) ||
        (log.details || '').toLowerCase().includes(q)
      );
    });
    return sortItems(
      filtered,
      (a, b) => {
        if (auditSortBy === 'action') return compareStrings(a.action, b.action);
        if (auditSortBy === 'actor_name') return compareStrings(a.actor_name, b.actor_name);
        return compareIsoDates(a.created_at, b.created_at);
      },
      auditSortDir
    );
  }, [overview, auditSearch, actionFilter, fromDate, toDate, auditSortBy, auditSortDir]);

  const paginatedLogs = useMemo(
    () => paginateItems(filteredLogs, auditPage, auditPageSize),
    [filteredLogs, auditPage, auditPageSize]
  );

  const toggleAuditSort = (column: 'created_at' | 'action' | 'actor_name') => {
    if (auditSortBy === column) {
      setAuditSortDir((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setAuditSortBy(column);
      setAuditSortDir(column === 'created_at' ? 'desc' : 'asc');
    }
  };

  const handleExportCsv = () => {
    if (!report || !overview) return;
    const csv = buildAuditExportCsv({
      organizationName: workspace?.organizationName || 'Organization',
      report,
      auditLogs: filteredLogs,
      serviceSummaries,
      clientPetMetrics: clientPetMetrics || undefined,
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const safeSlug = (workspace?.organizationSlug || 'clinic').replace(/[^a-z0-9-_]/gi, '-');
    link.download = `${safeSlug}-operational-report-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('Downloaded organization operational & audit CSV report.', 'success');
  };

  const hasFilters = Boolean(fromDate || toDate || branchFilter !== 'all' || doctorFilter !== 'all');

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader
        title={`${workspace?.organizationName || 'Clinic'} — Analytics & Audit Reports`}
        subtitle="Real tenant-scoped appointment metrics, branch & doctor workload, service summaries, client/pet growth, and governance audit logs."
        action={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadData}
              disabled={loading}
              className="px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={loading || !report}
              className="px-4 py-2 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Download className="w-4 h-4" />
              Export CSV Report
            </button>
          </div>
        }
      />

      {/* Global Operational Filters */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <Calendar className="w-4 h-4 text-teal-700 shrink-0" />
          <label className="font-semibold" htmlFor="admin-report-from">From</label>
          <input
            id="admin-report-from"
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
          />
          <label className="font-semibold" htmlFor="admin-report-to">To</label>
          <input
            id="admin-report-to"
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
          />
        </div>

        <select
          value={branchFilter}
          onChange={(e) => setBranchFilter(e.target.value)}
          aria-label="Filter reports by branch"
          className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
        >
          <option value="all">All Accessible Branches</option>
          {(overview?.branches || []).map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} ({b.code})
            </option>
          ))}
        </select>

        <select
          value={doctorFilter}
          onChange={(e) => setDoctorFilter(e.target.value)}
          aria-label="Filter reports by doctor"
          className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
        >
          <option value="all">All Doctors</option>
          {(overview?.doctors || []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.full_name}
            </option>
          ))}
        </select>

        {hasFilters && (
          <button
            type="button"
            onClick={() => {
              setFromDate('');
              setToDate('');
              setBranchFilter('all');
              setDoctorFilter('all');
            }}
            className="px-3 py-1.5 text-xs font-semibold text-teal-800 bg-teal-50 hover:bg-teal-100 rounded-lg"
          >
            Clear Filters
          </button>
        )}
      </div>

      {loading || !report || !overview ? (
        <div className="py-16 flex items-center justify-center gap-2 text-xs text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin text-teal-700" />
          <span>Aggregating organization operational metrics...</span>
        </div>
      ) : (
        <>
          {/* KPI Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-xl border border-slate-200">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Total Appointments
              </span>
              <div className="mt-2 text-2xl font-bold text-slate-900 font-mono tabular-nums">
                {report.totalAppointments}
              </div>
              <span className="text-xs text-slate-500 mt-1 block">
                {report.requestedCount} pending · {report.confirmedCount + report.checkedInCount}{' '}
                upcoming
              </span>
            </div>

            <div className="bg-white p-5 rounded-xl border border-slate-200">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Confirmation Rate
              </span>
              <div className="mt-2 text-2xl font-bold text-teal-800 font-mono tabular-nums">
                {report.confirmationRatePct}%
              </div>
              <span className="text-xs text-slate-500 mt-1 block">
                {report.declinedCount} declined · {report.cancelledCount} cancelled
              </span>
            </div>

            <div className="bg-white p-5 rounded-xl border border-slate-200">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Completion Rate
              </span>
              <div className="mt-2 text-2xl font-bold text-emerald-700 font-mono tabular-nums">
                {report.completionRatePct}%
              </div>
              <span className="text-xs text-slate-500 mt-1 block">
                {report.completedCount} completed · {report.noShowCount} no-show ({report.noShowRatePct}%)
              </span>
            </div>

            <div className="bg-white p-5 rounded-xl border border-slate-200">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Active Consultations
              </span>
              <div className="mt-2 text-2xl font-bold text-slate-900 font-mono tabular-nums">
                {filteredConsultations.filter((c) => c.consultation_status === 'active').length}
              </div>
              <span className="text-xs text-slate-500 mt-1 block">
                {filteredConsultations.length} total cases logged
              </span>
            </div>
          </div>

          {/* Client & Pet Metrics */}
          {clientPetMetrics && (
            <div className="bg-white p-5 rounded-xl border border-slate-200 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Users className="w-4 h-4 text-teal-700" />
                  Client & Pet Directory Metrics
                </h2>
                <span className="text-[11px] text-slate-500">
                  Tenant-wide patient & guardian coverage
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/80">
                  <div className="text-slate-500 font-medium">Approved Clients</div>
                  <div className="text-lg font-bold text-slate-900 font-mono tabular-nums mt-0.5">
                    {clientPetMetrics.approvedClients}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/80">
                  <div className="text-slate-500 font-medium">Pending Requests</div>
                  <div className="text-lg font-bold text-amber-700 font-mono tabular-nums mt-0.5">
                    {clientPetMetrics.requestedClients}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/80">
                  <div className="text-slate-500 font-medium">Registered vs Walk-In</div>
                  <div className="text-lg font-bold text-slate-900 font-mono tabular-nums mt-0.5">
                    {clientPetMetrics.registeredClients} / {clientPetMetrics.walkInClients}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/80">
                  <div className="text-slate-500 font-medium">Active Pets</div>
                  <div className="text-lg font-bold text-teal-800 font-mono tabular-nums mt-0.5 flex items-center gap-1">
                    <PawPrint className="w-3.5 h-3.5" />
                    {clientPetMetrics.totalPets}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/80">
                  <div className="text-slate-500 font-medium">Suspended / Rejected</div>
                  <div className="text-lg font-bold text-rose-700 font-mono tabular-nums mt-0.5">
                    {clientPetMetrics.suspendedOrRejectedClients}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/80">
                  <div className="text-slate-500 font-medium">Avg Pets / Client</div>
                  <div className="text-lg font-bold text-slate-900 font-mono tabular-nums mt-0.5">
                    {clientPetMetrics.avgPetsPerApprovedClient}
                  </div>
                </div>
              </div>
            </div>
          )}

          {report.unmappedLegacyConsultationsCount > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-900 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <strong className="font-bold block">
                  {report.unmappedLegacyConsultationsCount} Unmapped Historical Consultations
                </strong>
                <span>
                  These legacy cases lack a verified branch assignment and are intentionally excluded from branch-level totals to preserve data integrity.
                </span>
              </div>
            </div>
          )}

          {/* Branch & Doctor Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white p-5 rounded-xl border border-slate-200 space-y-4">
              <h2 className="text-sm font-bold text-slate-900">Branch Volume Distribution</h2>
              {report.byBranch.length === 0 ? (
                <p className="text-xs text-slate-500">No branches configured.</p>
              ) : (
                <div className="space-y-3">
                  {report.byBranch.map((br) => {
                    const pct =
                      report.totalAppointments > 0
                        ? Math.round((br.totalAppointments / report.totalAppointments) * 100)
                        : 0;
                    return (
                      <div key={br.branchId} className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs gap-2">
                          <span className="font-semibold text-slate-900">
                            {br.branchName}{' '}
                            <span className="font-mono text-slate-400">({br.branchCode})</span>
                          </span>
                          <span className="font-mono tabular-nums text-slate-600 shrink-0">
                            {br.totalAppointments} total · {br.completedCount} completed ·{' '}
                            {br.requestedCount} pending
                          </span>
                        </div>
                        <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-teal-700 rounded-full"
                            style={{ width: `${Math.max(pct, br.totalAppointments > 0 ? 6 : 0)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="bg-white p-5 rounded-xl border border-slate-200 space-y-4">
              <h2 className="text-sm font-bold text-slate-900">Doctor Caseload Summary</h2>
              {report.byDoctor.length === 0 ? (
                <p className="text-xs text-slate-500">No doctors registered in this clinic.</p>
              ) : (
                <div className="divide-y divide-slate-100 text-xs max-h-72 overflow-y-auto pr-1">
                  {report.byDoctor.map((doc) => (
                    <div
                      key={doc.doctorId}
                      className="py-2.5 flex items-center justify-between gap-3"
                    >
                      <span className="font-semibold text-slate-900">{doc.doctorName}</span>
                      <span className="font-mono tabular-nums text-slate-600">
                        {doc.appointmentCount} appts · {doc.completedCount} completed ·{' '}
                        {doc.consultationCount} cases
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Service-Related Summaries */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <BriefcaseMedical className="w-4 h-4 text-teal-700" />
                  Service-Related Summaries ({serviceSummaries.length})
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Booking demand, completion rate, and estimated service fee revenue across catalogued procedures.
                </p>
              </div>
            </div>

            {serviceSummaries.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                No clinic services catalogued for the selected branch filter yet.
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                      <tr>
                        <th className="py-3 px-4">Service & Code</th>
                        <th className="py-3 px-4">Category</th>
                        <th className="py-3 px-4 text-right">Duration / Fee</th>
                        <th className="py-3 px-4 text-right">Bookings</th>
                        <th className="py-3 px-4 text-right">Active / Pending</th>
                        <th className="py-3 px-4 text-right">Completed</th>
                        <th className="py-3 px-4 text-right">Est. Completed Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 tabular-nums">
                      {paginatedServices.items.map((svc) => (
                        <tr key={svc.serviceId} className="hover:bg-slate-50/50">
                          <td className="py-2.5 px-4">
                            <div className="font-semibold text-slate-900">{svc.serviceName}</div>
                            <div className="font-mono text-[11px] text-slate-400">
                              {svc.serviceCode} · {svc.isActive ? 'Active' : 'Inactive'}
                            </div>
                          </td>
                          <td className="py-2.5 px-4 capitalize text-slate-600">
                            {svc.category.replace('_', ' ')}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono text-slate-700">
                            {svc.durationMinutes}m · ${svc.price.toFixed(2)}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono font-bold text-slate-900">
                            {svc.bookingCount}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono text-slate-600">
                            {svc.activeCount} / {svc.requestedCount}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono text-emerald-700 font-semibold">
                            {svc.completedCount}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono font-bold text-slate-900">
                            ${svc.estimatedCompletedRevenue.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  currentPage={paginatedServices.currentPage}
                  totalPages={paginatedServices.totalPages}
                  totalItems={paginatedServices.totalItems}
                  startIndex={paginatedServices.startIndex}
                  endIndex={paginatedServices.endIndex}
                  pageSize={paginatedServices.pageSize}
                  onPageChange={setServicePage}
                  onPageSizeChange={(size) => {
                    setServicePageSize(size);
                    setServicePage(1);
                  }}
                  itemLabel="services"
                />
              </>
            )}
          </div>

          {/* Governance Audit Logs */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-teal-700" />
                  Organization Audit Log Trail ({filteredLogs.length})
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Captures governance, appointment, and member mutations without exposing private chat message content.
                </p>
              </div>
              {workspace?.canReadAudit && (
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={auditSearch}
                      onChange={(e) => setAuditSearch(e.target.value)}
                      placeholder="Filter actor, action, entity..."
                      className="pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                    />
                  </div>
                  <select
                    value={actionFilter}
                    onChange={(e) => setActionFilter(e.target.value)}
                    aria-label="Filter audit logs by action"
                    className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="all">All Actions</option>
                    {auditActions.map((act) => (
                      <option key={act} value={act}>
                        {act}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {!workspace?.canReadAudit ? (
              <div className="p-8 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
                <Lock className="w-5 h-5 text-slate-400" />
                <span>Audit log inspection requires the audit.read permission.</span>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                      <tr>
                        <th className="py-3 px-4">
                          <button
                            type="button"
                            onClick={() => toggleAuditSort('created_at')}
                            className="inline-flex items-center gap-1 hover:text-slate-900"
                          >
                            Timestamp
                            <ArrowUpDown className="w-3 h-3" />
                          </button>
                        </th>
                        <th className="py-3 px-4">
                          <button
                            type="button"
                            onClick={() => toggleAuditSort('actor_name')}
                            className="inline-flex items-center gap-1 hover:text-slate-900"
                          >
                            Actor
                            <ArrowUpDown className="w-3 h-3" />
                          </button>
                        </th>
                        <th className="py-3 px-4">
                          <button
                            type="button"
                            onClick={() => toggleAuditSort('action')}
                            className="inline-flex items-center gap-1 hover:text-slate-900"
                          >
                            Action
                            <ArrowUpDown className="w-3 h-3" />
                          </button>
                        </th>
                        <th className="py-3 px-4">Entity</th>
                        <th className="py-3 px-4">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {paginatedLogs.items.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-slate-500">
                            No audit entries match the current filters.
                          </td>
                        </tr>
                      ) : (
                        paginatedLogs.items.map((log) => (
                          <tr key={log.id} className="hover:bg-slate-50/50">
                            <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500 whitespace-nowrap tabular-nums">
                              {new Date(log.created_at).toLocaleString()}
                            </td>
                            <td className="py-2.5 px-4">
                              <div className="font-semibold text-slate-900">{log.actor_name}</div>
                              {log.actor_email && (
                                <div className="text-[11px] text-slate-500 font-mono">
                                  {log.actor_email}
                                </div>
                              )}
                            </td>
                            <td className="py-2.5 px-4 font-mono font-bold text-teal-800">
                              {log.action}
                            </td>
                            <td className="py-2.5 px-4 text-slate-700">
                              <span className="font-mono">{log.entity_type}</span>
                            </td>
                            <td className="py-2.5 px-4 text-slate-600 max-w-md">
                              {log.details || '—'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  currentPage={paginatedLogs.currentPage}
                  totalPages={paginatedLogs.totalPages}
                  totalItems={paginatedLogs.totalItems}
                  startIndex={paginatedLogs.startIndex}
                  endIndex={paginatedLogs.endIndex}
                  pageSize={paginatedLogs.pageSize}
                  onPageChange={setAuditPage}
                  onPageSizeChange={(size) => {
                    setAuditPageSize(size);
                    setAuditPage(1);
                  }}
                  pageSizeOptions={[15, 30, 50]}
                  itemLabel="audit events"
                />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
};

