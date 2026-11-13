import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { platformPortalService } from '../../services/platformPortalService';
import { formatSupabaseError } from '../../services/authService';
import { OrganizationApplication } from '../../types/auth';
import {
  PlatformAuditLogRecord,
  PlatformOrganizationOverview,
  PlatformOverviewMetrics,
  PlatformSupportGrant,
  PlatformSupportSnapshot,
} from '../../types/platform';
import {
  buildPlatformGovernanceCsv,
  computePlatformActivationStats,
  computePlatformAggregateAnalytics,
  isPlatformAuditEventPermitted,
} from '../../utils/platformPortalHelpers';
import {
  compareIsoDates,
  compareStrings,
  isWithinDateRange,
  paginateItems,
} from '../../utils/listManagementHelpers';
import { PageHeader } from '../../components/common/PageHeader';
import { MetricCard } from '../../components/common/MetricCard';
import { Modal } from '../../components/common/Modal';
import { Pagination } from '../../components/common/Pagination';
import { PlatformPrivacyBanner } from '../../components/platform/PlatformPrivacyBanner';
import {
  Activity,
  ArrowUpDown,
  BarChart3,
  Building2,
  CheckCircle2,
  Download,
  Eye,
  FileSearch,
  KeyRound,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldOff,
} from 'lucide-react';

type AnalyticsTab = 'analytics' | 'support' | 'audit';
type OrgSortBy = 'display_name' | 'appointment_count' | 'consultation_count' | 'branch_count';

export const PlatformAnalyticsPage: React.FC = () => {
  const { showToast } = useApp();

  const [tab, setTab] = useState<AnalyticsTab>('analytics');
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<PlatformOverviewMetrics | null>(null);
  const [organizations, setOrganizations] = useState<PlatformOrganizationOverview[]>([]);
  const [applications, setApplications] = useState<OrganizationApplication[]>([]);
  const [supportGrants, setSupportGrants] = useState<PlatformSupportGrant[]>([]);
  const [auditLogs, setAuditLogs] = useState<PlatformAuditLogRecord[]>([]);

  // Organization analytics filter, sort, pagination
  const [orgSearch, setOrgSearch] = useState('');
  const [orgStatusFilter, setOrgStatusFilter] = useState('all');
  const [orgSortBy, setOrgSortBy] = useState<OrgSortBy>('appointment_count');
  const [orgSortOrder, setOrgSortOrder] = useState<'asc' | 'desc'>('desc');
  const [orgPage, setOrgPage] = useState(1);
  const [orgPageSize, setOrgPageSize] = useState(10);

  // Support grants pagination
  const [supportPage, setSupportPage] = useState(1);
  const [supportPageSize, setSupportPageSize] = useState(10);

  // Audit filters, sorting, pagination & diff modal
  const [auditSearch, setAuditSearch] = useState('');
  const [auditActionFilter, setAuditActionFilter] = useState('ALL');
  const [auditFromDate, setAuditFromDate] = useState('');
  const [auditToDate, setAuditToDate] = useState('');
  const [auditSortBy, setAuditSortBy] = useState<'created_at' | 'action'>('created_at');
  const [auditSortOrder, setAuditSortOrder] = useState<'asc' | 'desc'>('desc');
  const [auditPage, setAuditPage] = useState(1);
  const [auditPageSize, setAuditPageSize] = useState(15);
  const [selectedLog, setSelectedLog] = useState<PlatformAuditLogRecord | null>(null);

  // Scoped Support Snapshot modal
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshot, setSnapshot] = useState<PlatformSupportSnapshot | null>(null);
  const [busyGrantId, setBusyGrantId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [m, orgs, apps, grants, logs] = await Promise.all([
        platformPortalService.getOverviewMetrics(),
        platformPortalService.listOrganizationsOverview(),
        platformPortalService.listApplications(),
        platformPortalService.listSupportGrants(),
        platformPortalService.listAuditLogs({ limit: 250 }),
      ]);
      setMetrics(m);
      setOrganizations(orgs);
      setApplications(apps);
      setSupportGrants(grants);
      setAuditLogs(
        logs.filter((l) => isPlatformAuditEventPermitted(l.action, l.organization_id))
      );
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to load platform analytics & audit logs.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const aggregateSummary = useMemo(
    () => computePlatformAggregateAnalytics(organizations),
    [organizations]
  );

  const activationStats = useMemo(
    () => computePlatformActivationStats({ organizations, applications }),
    [organizations, applications]
  );

  const filteredOrgs = useMemo(() => {
    const q = orgSearch.trim().toLowerCase();
    const list = organizations.filter((org) => {
      if (orgStatusFilter !== 'all' && org.status !== orgStatusFilter) return false;
      if (!q) return true;
      return (
        org.display_name.toLowerCase().includes(q) ||
        org.slug.toLowerCase().includes(q) ||
        org.country.toLowerCase().includes(q)
      );
    });
    const factor = orgSortOrder === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      if (orgSortBy === 'display_name') return compareStrings(a.display_name, b.display_name) * factor;
      if (orgSortBy === 'branch_count') return ((a.branch_count || 0) - (b.branch_count || 0)) * factor;
      if (orgSortBy === 'consultation_count') {
        return ((a.consultation_count || 0) - (b.consultation_count || 0)) * factor;
      }
      return ((a.appointment_count || 0) - (b.appointment_count || 0)) * factor;
    });
  }, [organizations, orgSearch, orgStatusFilter, orgSortBy, orgSortOrder]);

  const pagedOrgs = useMemo(
    () => paginateItems(filteredOrgs, orgPage, orgPageSize),
    [filteredOrgs, orgPage, orgPageSize]
  );

  const pagedSupportGrants = useMemo(
    () => paginateItems(supportGrants, supportPage, supportPageSize),
    [supportGrants, supportPage, supportPageSize]
  );

  const uniqueAuditActions = useMemo(() => {
    const actions = Array.from(new Set(auditLogs.map((l) => l.action))).sort();
    return ['ALL', ...actions];
  }, [auditLogs]);

  const filteredLogs = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    const list = auditLogs.filter((l) => {
      if (auditActionFilter !== 'ALL' && l.action !== auditActionFilter) return false;
      if (!isWithinDateRange(l.created_at, auditFromDate, auditToDate)) return false;
      if (!q) return true;
      return (
        l.action.toLowerCase().includes(q) ||
        (l.details || '').toLowerCase().includes(q) ||
        (l.organization_name || '').toLowerCase().includes(q) ||
        (l.actor_email || '').toLowerCase().includes(q) ||
        (l.actor_name || '').toLowerCase().includes(q)
      );
    });
    const factor = auditSortOrder === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      if (auditSortBy === 'action') return compareStrings(a.action, b.action) * factor;
      return compareIsoDates(a.created_at, b.created_at) * factor;
    });
  }, [auditLogs, auditSearch, auditActionFilter, auditFromDate, auditToDate, auditSortBy, auditSortOrder]);

  const pagedAuditLogs = useMemo(
    () => paginateItems(filteredLogs, auditPage, auditPageSize),
    [filteredLogs, auditPage, auditPageSize]
  );

  const handleViewSnapshot = async (grant: PlatformSupportGrant) => {
    setSnapshotOpen(true);
    setSnapshotLoading(true);
    setSnapshot(null);
    try {
      const snap = await platformPortalService.getScopedSupportSnapshot(grant.id);
      setSnapshot(snap);
      showToast('Scoped operational diagnostics loaded and logged to audit trail.', 'info');
      await loadData();
    } catch (err) {
      showToast(formatSupabaseError(err, 'Unable to open scoped support snapshot.'), 'error');
      setSnapshotOpen(false);
    } finally {
      setSnapshotLoading(false);
    }
  };

  const handleRevokeGrant = async (grant: PlatformSupportGrant) => {
    setBusyGrantId(grant.id);
    try {
      await platformPortalService.revokeSupportGrant(
        grant.id,
        'Revoked by Platform Owner'
      );
      showToast(`Support access grant for ${grant.organization_name} revoked.`, 'info');
      await loadData();
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to revoke support grant.'), 'error');
    } finally {
      setBusyGrantId(null);
    }
  };

  const handleExportCsv = () => {
    const csv = buildPlatformGovernanceCsv({
      metrics,
      organizations,
      auditLogs: filteredLogs,
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `pet-connect-platform-governance-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('Exported privacy-preserving platform governance CSV.', 'success');
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Platform Analytics, Support Access & Audit"
        subtitle="Privacy-preserving organization usage analytics, explicitly authorized support diagnostics, and administrative security monitoring."
        action={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadData}
              disabled={loading}
              className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-xl inline-flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              className="px-3.5 py-2 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-xl inline-flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              Export Aggregate CSV
            </button>
          </div>
        }
      />

      <PlatformPrivacyBanner />

      {/* Sub-navigation tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-2">
        <button
          type="button"
          onClick={() => setTab('analytics')}
          className={`px-4 py-2 text-xs font-bold rounded-xl inline-flex items-center gap-1.5 ${
            tab === 'analytics' ? 'bg-teal-700 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          Aggregate Usage Analytics
        </button>
        <button
          type="button"
          onClick={() => setTab('support')}
          className={`px-4 py-2 text-xs font-bold rounded-xl inline-flex items-center gap-1.5 ${
            tab === 'support' ? 'bg-teal-700 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <KeyRound className="w-4 h-4" />
          Scoped Support Grants ({supportGrants.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('audit')}
          className={`px-4 py-2 text-xs font-bold rounded-xl inline-flex items-center gap-1.5 ${
            tab === 'audit' ? 'bg-teal-700 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <FileSearch className="w-4 h-4" />
          Governance Audit Logs ({filteredLogs.length})
        </button>
      </div>

      {loading ? (
        <div className="py-12 flex items-center justify-center gap-2 text-xs text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin text-teal-700" />
          <span>Loading platform analytics & audit state...</span>
        </div>
      ) : tab === 'analytics' ? (
        <div className="space-y-6">
          {/* Privacy-preserving platform KPIs */}
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              label="Total Active Clinics"
              value={aggregateSummary.activeOrganizations}
              icon={Building2}
              description={`${aggregateSummary.avgBranchesPerActiveOrg} avg branches / active org`}
            />
            <MetricCard
              label="Total Appointments"
              value={aggregateSummary.totalAppointments}
              icon={Activity}
              description={`${metrics?.usage.completed_appointments ?? 0} completed`}
            />
            <MetricCard
              label="Total Consultations"
              value={aggregateSummary.totalConsultations}
              icon={BarChart3}
              description={`${aggregateSummary.activeConsultations} active · ${metrics?.usage.expired_consultations ?? 0} expired`}
            />
            <MetricCard
              label="24h Security Events"
              value={metrics?.security.recent_audit_events_24h ?? 0}
              icon={ShieldAlert}
              description={`${metrics?.security.active_support_grants ?? 0} active support grants`}
            />
          </section>

          {/* Organization Activation Statistics */}
          <section className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-teal-700" />
              <h2 className="text-sm font-bold text-slate-900">
                Organization Onboarding & Activation Statistics
              </h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs tabular-nums">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                <div className="text-[11px] font-semibold text-slate-500">Applications</div>
                <div className="text-lg font-bold text-slate-900 mt-0.5">
                  {activationStats.totalApplications}
                </div>
                <div className="text-[10px] text-slate-500">
                  {activationStats.pendingApplications} pending review
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                <div className="text-[11px] font-semibold text-slate-500">Approval Rate</div>
                <div className="text-lg font-bold text-teal-800 mt-0.5">
                  {activationStats.approvalRatePct}%
                </div>
                <div className="text-[10px] text-slate-500">
                  {activationStats.approvedApplications} approved · {activationStats.rejectedApplications} rejected
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                <div className="text-[11px] font-semibold text-slate-500">Active Ratio</div>
                <div className="text-lg font-bold text-emerald-700 mt-0.5">
                  {activationStats.activeRatioPct}%
                </div>
                <div className="text-[10px] text-slate-500">
                  {activationStats.activeOrganizations} of {activationStats.totalOrganizations} orgs
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                <div className="text-[11px] font-semibold text-slate-500">Suspension Rate</div>
                <div className="text-lg font-bold text-rose-700 mt-0.5">
                  {activationStats.suspensionRatePct}%
                </div>
                <div className="text-[10px] text-slate-500">
                  {activationStats.suspendedOrganizations} suspended
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                <div className="text-[11px] font-semibold text-slate-500">Approved Clients</div>
                <div className="text-lg font-bold text-slate-900 mt-0.5">
                  {aggregateSummary.totalApprovedClients}
                </div>
                <div className="text-[10px] text-slate-500">Across all clinics</div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                <div className="text-[11px] font-semibold text-slate-500">Active Staff</div>
                <div className="text-lg font-bold text-slate-900 mt-0.5">
                  {aggregateSummary.totalActiveStaff}
                </div>
                <div className="text-[10px] text-slate-500">
                  {aggregateSummary.avgStaffPerActiveOrg} avg / active org
                </div>
              </div>
            </div>
          </section>

          {/* Clinical Data Restriction Matrix */}
          <section className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-teal-700" />
              <h2 className="text-sm font-bold text-slate-900">
                Clinical & Chat Data Privilege Boundary Matrix
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
              {[
                { label: 'Private Medical Records', rule: 'RLS Blocked · Count Only' },
                { label: 'Digital Prescriptions', rule: 'RLS Blocked · Count Only' },
                { label: 'Vaccination Histories', rule: 'RLS Blocked · Count Only' },
                { label: 'Private Clinical Notes', rule: 'RLS Blocked · Never Exposed' },
                { label: 'Expired & Active Chats', rule: 'RLS Blocked · Zero Transcript Access' },
              ].map((item) => (
                <div
                  key={item.label}
                  className="p-3 rounded-xl bg-slate-50 border border-slate-200/80"
                >
                  <div className="font-bold text-slate-900">{item.label}</div>
                  <div className="text-[11px] text-emerald-700 font-semibold mt-1">
                    {item.rule}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Organization-Level Aggregate Usage Table */}
          <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
            <div className="px-5 py-4 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900">
                  Organization-Level Aggregate Usage
                </h2>
                <p className="text-[11px] text-slate-500">
                  Strictly aggregated tenant volume counters with zero patient PHI or transcript content.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-full sm:w-52">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={orgSearch}
                    onChange={(e) => {
                      setOrgSearch(e.target.value);
                      setOrgPage(1);
                    }}
                    placeholder="Filter organization..."
                    aria-label="Filter organizations in aggregate usage"
                    className="w-full pl-8 pr-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                  />
                </div>
                <select
                  value={orgStatusFilter}
                  onChange={(e) => {
                    setOrgStatusFilter(e.target.value);
                    setOrgPage(1);
                  }}
                  aria-label="Filter organization status"
                  className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="all">All Statuses</option>
                  <option value="active">Active</option>
                  <option value="pending">Pending</option>
                  <option value="suspended">Suspended</option>
                  <option value="closed">Closed</option>
                </select>
                <select
                  value={orgSortBy}
                  onChange={(e) => {
                    setOrgSortBy(e.target.value as OrgSortBy);
                    setOrgPage(1);
                  }}
                  aria-label="Sort organizations by metric"
                  className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="appointment_count">Sort: Appointments</option>
                  <option value="consultation_count">Sort: Consultations</option>
                  <option value="branch_count">Sort: Branches</option>
                  <option value="display_name">Sort: Name</option>
                </select>
                <button
                  type="button"
                  onClick={() => setOrgSortOrder((o) => (o === 'desc' ? 'asc' : 'desc'))}
                  className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1"
                >
                  <ArrowUpDown className="w-3.5 h-3.5" />
                  {orgSortOrder === 'desc' ? 'High–Low' : 'Low–High'}
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                  <tr>
                    <th className="py-3 px-4">Organization</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Branches</th>
                    <th className="py-3 px-4">Active Staff</th>
                    <th className="py-3 px-4">Doctors</th>
                    <th className="py-3 px-4">Clients</th>
                    <th className="py-3 px-4">Pets (Count)</th>
                    <th className="py-3 px-4">Appointments</th>
                    <th className="py-3 px-4">Consultations</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {pagedOrgs.items.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-10 text-center text-slate-500">
                        No organizations match your current filter.
                      </td>
                    </tr>
                  ) : (
                    pagedOrgs.items.map((org) => (
                      <tr key={org.id} className="hover:bg-slate-50/50">
                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-900">{org.display_name}</div>
                          <div className="font-mono text-[11px] text-slate-500">/{org.slug}</div>
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              org.status === 'active'
                                ? 'bg-emerald-100 text-emerald-800'
                                : org.status === 'pending'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {org.status}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          {org.active_branch_count}/{org.branch_count}
                        </td>
                        <td className="py-3 px-4">{org.active_staff_count}</td>
                        <td className="py-3 px-4">{org.active_doctor_count}</td>
                        <td className="py-3 px-4">{org.approved_client_count}</td>
                        <td className="py-3 px-4">{org.pet_count}</td>
                        <td className="py-3 px-4">{org.appointment_count}</td>
                        <td className="py-3 px-4">
                          {org.consultation_count}{' '}
                          <span className="text-[11px] text-slate-500">
                            ({org.active_consultation_count} active)
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <Pagination
              currentPage={pagedOrgs.currentPage}
              totalPages={pagedOrgs.totalPages}
              totalItems={pagedOrgs.totalItems}
              startIndex={pagedOrgs.startIndex}
              endIndex={pagedOrgs.endIndex}
              pageSize={pagedOrgs.pageSize}
              onPageChange={setOrgPage}
              onPageSizeChange={(size) => {
                setOrgPageSize(size);
                setOrgPage(1);
              }}
              itemLabel="organizations"
            />
          </section>
        </div>
      ) : tab === 'support' ? (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-slate-900 text-white text-xs flex items-start gap-3">
            <KeyRound className="w-4 h-4 text-teal-300 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">Two-Party Time-Limited Support Access: </span>
              Platform Owners can request scoped diagnostics from the Organizations page, but only an Organization Owner (`org.manage`) inside that clinic can approve it. Approved grants expire automatically and still exclude medical records, prescriptions, vaccinations, and chat messages.
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                  <tr>
                    <th className="py-3 px-4">Organization</th>
                    <th className="py-3 px-4">Scope & Justification</th>
                    <th className="py-3 px-4">Duration / Window</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pagedSupportGrants.items.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-10 text-center text-slate-500">
                        No support access requests have been logged.
                      </td>
                    </tr>
                  ) : (
                    pagedSupportGrants.items.map((g) => (
                      <tr key={g.id} className="hover:bg-slate-50/50">
                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-900">{g.organization_name}</div>
                          <div className="font-mono text-[11px] text-slate-500">
                            /{g.organization_slug}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-mono font-bold text-slate-800">{g.scope}</div>
                          <div className="text-[11px] text-slate-600 max-w-md">{g.reason}</div>
                          {g.approved_by_email && (
                            <div className="text-[10px] text-emerald-700 mt-0.5">
                              Approved by {g.approved_by_email}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-[11px] text-slate-600 tabular-nums">
                          <div>{g.duration_minutes} mins</div>
                          {g.expires_at && (
                            <div className="text-slate-500">
                              Expires: {new Date(g.expires_at).toLocaleString()}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              g.status === 'approved'
                                ? 'bg-emerald-100 text-emerald-800'
                                : g.status === 'requested'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {g.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap space-x-1.5">
                          {g.status === 'approved' && (
                            <button
                              type="button"
                              onClick={() => handleViewSnapshot(g)}
                              className="px-2.5 py-1.5 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-lg inline-flex items-center gap-1"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              Inspect Snapshot
                            </button>
                          )}
                          {(g.status === 'requested' || g.status === 'approved') && (
                            <button
                              type="button"
                              disabled={busyGrantId === g.id}
                              onClick={() => handleRevokeGrant(g)}
                              className="px-2.5 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-lg inline-flex items-center gap-1"
                            >
                              <ShieldOff className="w-3.5 h-3.5" />
                              Revoke
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <Pagination
              currentPage={pagedSupportGrants.currentPage}
              totalPages={pagedSupportGrants.totalPages}
              totalItems={pagedSupportGrants.totalItems}
              startIndex={pagedSupportGrants.startIndex}
              endIndex={pagedSupportGrants.endIndex}
              pageSize={pagedSupportGrants.pageSize}
              onPageChange={setSupportPage}
              onPageSizeChange={(size) => {
                setSupportPageSize(size);
                setSupportPage(1);
              }}
              itemLabel="support grants"
            />
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={auditActionFilter}
                onChange={(e) => {
                  setAuditActionFilter(e.target.value);
                  setAuditPage(1);
                }}
                aria-label="Filter audit logs by action"
                className="px-3 py-1.5 text-xs border border-slate-300 rounded-xl bg-white font-mono"
              >
                {uniqueAuditActions.map((act) => (
                  <option key={act} value={act}>
                    {act === 'ALL' ? 'All Governance Actions' : act}
                  </option>
                ))}
              </select>

              <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                <span>From</span>
                <input
                  type="date"
                  value={auditFromDate}
                  onChange={(e) => {
                    setAuditFromDate(e.target.value);
                    setAuditPage(1);
                  }}
                  aria-label="Audit log start date"
                  className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-xl bg-white"
                />
              </label>

              <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                <span>To</span>
                <input
                  type="date"
                  value={auditToDate}
                  onChange={(e) => {
                    setAuditToDate(e.target.value);
                    setAuditPage(1);
                  }}
                  aria-label="Audit log end date"
                  className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-xl bg-white"
                />
              </label>

              <select
                value={auditSortBy}
                onChange={(e) => {
                  setAuditSortBy(e.target.value as 'created_at' | 'action');
                  setAuditPage(1);
                }}
                aria-label="Sort audit logs"
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-xl bg-white"
              >
                <option value="created_at">Sort: Timestamp</option>
                <option value="action">Sort: Action</option>
              </select>

              <button
                type="button"
                onClick={() => setAuditSortOrder((o) => (o === 'desc' ? 'asc' : 'desc'))}
                className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl inline-flex items-center gap-1"
              >
                <ArrowUpDown className="w-3.5 h-3.5" />
                {auditSortOrder === 'desc' ? 'Newest' : 'Oldest'}
              </button>

              {(auditActionFilter !== 'ALL' || auditFromDate || auditToDate || auditSearch) && (
                <button
                  type="button"
                  onClick={() => {
                    setAuditActionFilter('ALL');
                    setAuditFromDate('');
                    setAuditToDate('');
                    setAuditSearch('');
                    setAuditPage(1);
                  }}
                  className="px-2.5 py-1.5 text-xs font-semibold text-teal-800 hover:underline"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="relative w-full sm:w-72">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={auditSearch}
                onChange={(e) => {
                  setAuditSearch(e.target.value);
                  setAuditPage(1);
                }}
                placeholder="Filter by actor, org, action, or details..."
                aria-label="Search governance audit logs"
                className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-xl bg-white"
              />
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                  <tr>
                    <th className="py-3 px-4">Timestamp</th>
                    <th className="py-3 px-4">Action</th>
                    <th className="py-3 px-4">Actor</th>
                    <th className="py-3 px-4">Scope / Organization</th>
                    <th className="py-3 px-4">Details</th>
                    <th className="py-3 px-4 text-right">Payload</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pagedAuditLogs.items.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-slate-500">
                        No matching governance audit events found.
                      </td>
                    </tr>
                  ) : (
                    pagedAuditLogs.items.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50/50">
                        <td className="py-3 px-4 text-slate-500 whitespace-nowrap tabular-nums">
                          {new Date(log.created_at).toLocaleString()}
                        </td>
                        <td className="py-3 px-4 font-mono font-bold text-slate-900">
                          {log.action}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-800">{log.actor_name}</div>
                          <div className="text-[11px] text-slate-500 font-mono">
                            {log.actor_email || 'System'}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-slate-700">
                          {log.organization_name || 'Platform Global'}
                        </td>
                        <td className="py-3 px-4 text-slate-600 max-w-md">
                          {log.details || `${log.entity_type} ${log.entity_id || ''}`}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {(log.before_json || log.after_json) && (
                            <button
                              type="button"
                              onClick={() => setSelectedLog(log)}
                              className="px-2.5 py-1 text-xs font-semibold text-teal-800 bg-teal-50 hover:bg-teal-100 rounded-lg"
                            >
                              Diff
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <Pagination
              currentPage={pagedAuditLogs.currentPage}
              totalPages={pagedAuditLogs.totalPages}
              totalItems={pagedAuditLogs.totalItems}
              startIndex={pagedAuditLogs.startIndex}
              endIndex={pagedAuditLogs.endIndex}
              pageSize={pagedAuditLogs.pageSize}
              onPageChange={setAuditPage}
              onPageSizeChange={(size) => {
                setAuditPageSize(size);
                setAuditPage(1);
              }}
              pageSizeOptions={[15, 25, 50]}
              itemLabel="audit events"
            />
          </div>
        </div>
      )}

      {/* Audit Diff Modal */}
      <Modal
        isOpen={Boolean(selectedLog)}
        onClose={() => setSelectedLog(null)}
        title={`Audit Payload: ${selectedLog?.action || ''}`}
        subtitle={
          selectedLog
            ? `${selectedLog.entity_type} · ${new Date(selectedLog.created_at).toLocaleString()}`
            : ''
        }
        maxWidth="xl"
      >
        {selectedLog && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="space-y-1.5">
              <div className="font-bold text-slate-700">Before State</div>
              <pre className="p-3 rounded-xl bg-slate-900 text-slate-100 overflow-x-auto text-[11px] font-mono">
                {JSON.stringify(selectedLog.before_json ?? {}, null, 2)}
              </pre>
            </div>
            <div className="space-y-1.5">
              <div className="font-bold text-slate-700">After State</div>
              <pre className="p-3 rounded-xl bg-slate-900 text-emerald-200 overflow-x-auto text-[11px] font-mono">
                {JSON.stringify(selectedLog.after_json ?? {}, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </Modal>

      {/* Scoped Support Diagnostic Snapshot Modal */}
      <Modal
        isOpen={snapshotOpen}
        onClose={() => setSnapshotOpen(false)}
        title={`Scoped Diagnostics: ${snapshot?.organization.display_name || ''}`}
        subtitle={
          snapshot
            ? `Scope: ${snapshot.scope} · Expires ${new Date(snapshot.expires_at).toLocaleString()}`
            : 'Verifying time-limited grant...'
        }
        maxWidth="xl"
      >
        {snapshotLoading || !snapshot ? (
          <div className="py-10 flex items-center justify-center gap-2 text-xs text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin text-teal-700" />
            <span>Loading authorized non-PHI snapshot...</span>
          </div>
        ) : (
          <div className="space-y-4 text-xs">
            <div className="p-3 rounded-xl bg-teal-50 border border-teal-200 text-teal-900 font-medium">
              {snapshot.clinical_privacy_notice}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="font-bold text-slate-800 mb-1.5">Appointments by Status</div>
                <pre className="font-mono text-[11px] text-slate-700">
                  {JSON.stringify(snapshot.appointment_status_counts, null, 2)}
                </pre>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="font-bold text-slate-800 mb-1.5">Consultations by Status</div>
                <pre className="font-mono text-[11px] text-slate-700">
                  {JSON.stringify(snapshot.consultation_status_counts, null, 2)}
                </pre>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="font-bold text-slate-800 mb-1.5">Payments by Status</div>
                <pre className="font-mono text-[11px] text-slate-700">
                  {JSON.stringify(snapshot.payment_status_counts, null, 2)}
                </pre>
              </div>
            </div>

            <div>
              <div className="font-bold text-slate-800 mb-1.5">
                Branches Summary ({snapshot.branches_summary.length})
              </div>
              <div className="border border-slate-200 rounded-xl divide-y divide-slate-100">
                {snapshot.branches_summary.map((b) => (
                  <div key={b.id} className="px-3 py-2 flex items-center justify-between">
                    <span>
                      <strong>{b.name}</strong> ({b.code}) · {b.timezone}
                    </span>
                    <span className="font-mono text-[11px]">
                      {b.is_active ? 'active' : 'inactive'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
