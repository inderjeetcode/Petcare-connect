import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useAdminWorkspace } from '../../hooks/useAdminWorkspace';
import { adminPortalService } from '../../services/adminPortalService';
import { formatSupabaseError } from '../../services/authService';
import {
  buildAuditExportCsv,
  computeAdminOperationalReport,
} from '../../utils/adminPortalHelpers';
import { AdminOperationalOverview } from '../../types/admin';
import { PageHeader } from '../../components/common/PageHeader';
import {
  AlertTriangle,
  Download,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react';

export const AdminReports: React.FC = () => {
  const { workspace } = useAdminWorkspace();
  const { showToast } = useApp();

  const orgId = workspace?.organizationId || '';
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<AdminOperationalOverview | null>(null);
  const [auditSearch, setAuditSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('all');

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
        membershipBranchIds: workspace.membershipBranchIds,
      });
      setOverview(data);
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to load operational analytics.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [orgId, workspace, showToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const report = useMemo(() => {
    if (!overview) return null;
    return computeAdminOperationalReport({
      branches: overview.branches,
      appointments: overview.appointments,
      consultations: overview.consultations,
      doctors: overview.doctors,
    });
  }, [overview]);

  const auditActions = useMemo(() => {
    if (!overview) return [];
    return Array.from(new Set(overview.auditLogs.map((l) => l.action))).sort();
  }, [overview]);

  const filteredLogs = useMemo(() => {
    if (!overview) return [];
    const q = auditSearch.trim().toLowerCase();
    return overview.auditLogs.filter((log) => {
      if (actionFilter !== 'all' && log.action !== actionFilter) return false;
      if (!q) return true;
      return (
        log.actor_name.toLowerCase().includes(q) ||
        log.actor_email.toLowerCase().includes(q) ||
        log.action.toLowerCase().includes(q) ||
        log.entity_type.toLowerCase().includes(q) ||
        (log.details || '').toLowerCase().includes(q)
      );
    });
  }, [overview, auditSearch, actionFilter]);

  const handleExportCsv = () => {
    if (!report || !overview) return;
    const csv = buildAuditExportCsv({
      organizationName: workspace?.organizationName || 'Organization',
      report,
      auditLogs: filteredLogs,
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

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader
        title={`${workspace?.organizationName || 'Clinic'} — Analytics & Audit Reports`}
        subtitle="Real tenant-scoped appointment metrics, branch volume, doctor workload, and governance audit logs."
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
                {overview.consultations.filter((c) => c.consultation_status === 'active').length}
              </div>
              <span className="text-xs text-slate-500 mt-1 block">
                {overview.consultations.length} total cases logged
              </span>
            </div>
          </div>

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
                <div className="divide-y divide-slate-100 text-xs">
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
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                    <tr>
                      <th className="py-3 px-4">Timestamp</th>
                      <th className="py-3 px-4">Actor</th>
                      <th className="py-3 px-4">Action</th>
                      <th className="py-3 px-4">Entity</th>
                      <th className="py-3 px-4">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredLogs.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-slate-500">
                          No audit entries match the current filters.
                        </td>
                      </tr>
                    ) : (
                      filteredLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-slate-50/50">
                          <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500 whitespace-nowrap">
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
            )}
          </div>
        </>
      )}
    </div>
  );
};
