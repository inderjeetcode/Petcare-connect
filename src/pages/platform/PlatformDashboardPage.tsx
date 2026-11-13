import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { platformPortalService } from '../../services/platformPortalService';
import { formatSupabaseError } from '../../services/authService';
import { OrganizationApplication } from '../../types/auth';
import {
  PlatformAuditLogRecord,
  PlatformOrganizationOverview,
  PlatformOverviewMetrics,
  PlatformSupportGrant,
} from '../../types/platform';
import { computePlatformActivationStats } from '../../utils/platformPortalHelpers';
import { PageHeader } from '../../components/common/PageHeader';
import { MetricCard } from '../../components/common/MetricCard';
import { PlatformPrivacyBanner } from '../../components/platform/PlatformPrivacyBanner';
import {
  Activity,
  ArrowRight,
  Bell,
  Building2,
  CalendarCheck,
  CheckCircle2,
  Clock,
  FileCheck,
  Loader2,
  PauseCircle,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Stethoscope,
  TrendingUp,
  Users,
} from 'lucide-react';

export const PlatformDashboardPage: React.FC = () => {
  const { showToast } = useApp();

  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<PlatformOverviewMetrics | null>(null);
  const [applications, setApplications] = useState<OrganizationApplication[]>([]);
  const [organizations, setOrganizations] = useState<PlatformOrganizationOverview[]>([]);
  const [auditLogs, setAuditLogs] = useState<PlatformAuditLogRecord[]>([]);
  const [supportGrants, setSupportGrants] = useState<PlatformSupportGrant[]>([]);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const [m, apps, orgs, logs, grants] = await Promise.all([
        platformPortalService.getOverviewMetrics(),
        platformPortalService.listApplications(),
        platformPortalService.listOrganizationsOverview(),
        platformPortalService.listAuditLogs({ limit: 8 }),
        platformPortalService.listSupportGrants(),
      ]);
      setMetrics(m);
      setApplications(apps);
      setOrganizations(orgs);
      setAuditLogs(logs);
      setSupportGrants(grants);
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to load platform overview metrics.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const pendingApps = applications.filter((a) => a.status === 'pending');
  const activeGrants = supportGrants.filter((g) => g.status === 'approved');
  const pendingGrants = supportGrants.filter((g) => g.status === 'requested');

  const activationStats = useMemo(
    () => computePlatformActivationStats({ organizations, applications }),
    [organizations, applications]
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Platform Owner Overview"
        subtitle="Real-time multi-tenant operational metrics, organization onboarding queue, and security governance status."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/platform/notifications"
              className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-xl inline-flex items-center gap-1.5"
            >
              <Bell className="w-3.5 h-3.5" />
              Notifications
            </Link>
            <button
              type="button"
              onClick={loadDashboard}
              disabled={loading}
              className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-xl inline-flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <Link
              to="/platform/applications"
              className="px-3.5 py-2 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-xl inline-flex items-center gap-1.5"
            >
              Review Queue
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        }
      />

      <PlatformPrivacyBanner />

      {loading && !metrics ? (
        <div className="py-16 flex items-center justify-center gap-2 text-xs text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin text-teal-700" />
          <span>Aggregating platform metrics...</span>
        </div>
      ) : (
        <>
          {/* Organization Lifecycle Summary */}
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              label="Total Organizations"
              value={metrics?.organizations.total ?? 0}
              icon={Building2}
              description={`${metrics?.organizations.closed ?? 0} closed`}
            />
            <MetricCard
              label="Pending Org Requests"
              value={(metrics?.applications.pending ?? 0) + (metrics?.organizations.pending ?? 0)}
              icon={Clock}
              description={`${metrics?.applications.pending ?? 0} applications awaiting review`}
            />
            <MetricCard
              label="Active Organizations"
              value={metrics?.organizations.active ?? 0}
              icon={CheckCircle2}
              trendPositive
              trend="Operational"
              description={`${metrics?.usage.active_branches ?? 0} active branches`}
            />
            <MetricCard
              label="Suspended Organizations"
              value={metrics?.organizations.suspended ?? 0}
              icon={PauseCircle}
              description="Tenant access locked"
            />
          </section>

          {/* Organization Activation Statistics */}
          <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-teal-50 text-teal-700 flex items-center justify-center">
                  <TrendingUp className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900">Organization Activation Statistics</h2>
                  <p className="text-[11px] text-slate-500">
                    Onboarding approval rate, active clinic ratio, and tenant lifecycle standing
                  </p>
                </div>
              </div>
              <Link
                to="/platform/analytics"
                className="text-xs font-bold text-teal-700 hover:text-teal-800 inline-flex items-center gap-1"
              >
                Full Platform Analytics <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                <div className="text-[11px] font-semibold text-slate-500">Application Approval Rate</div>
                <div className="text-lg font-bold text-teal-800 tabular-nums mt-0.5">
                  {activationStats.approvalRatePct}%
                </div>
                <div className="text-[10px] text-slate-500 tabular-nums">
                  {activationStats.approvedApplications} approved · {activationStats.rejectedApplications} rejected
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                <div className="text-[11px] font-semibold text-slate-500">Active Tenant Ratio</div>
                <div className="text-lg font-bold text-emerald-700 tabular-nums mt-0.5">
                  {activationStats.activeRatioPct}%
                </div>
                <div className="text-[10px] text-slate-500 tabular-nums">
                  {activationStats.activeOrganizations} of {activationStats.totalOrganizations} organizations active
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                <div className="text-[11px] font-semibold text-slate-500">Suspension Rate</div>
                <div className="text-lg font-bold text-rose-700 tabular-nums mt-0.5">
                  {activationStats.suspensionRatePct}%
                </div>
                <div className="text-[10px] text-slate-500 tabular-nums">
                  {activationStats.suspendedOrganizations} suspended tenants
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                <div className="text-[11px] font-semibold text-slate-500">Pending & Closed Orgs</div>
                <div className="text-lg font-bold text-slate-900 tabular-nums mt-0.5">
                  {activationStats.pendingOrganizations + activationStats.closedOrganizations}
                </div>
                <div className="text-[10px] text-slate-500 tabular-nums">
                  {activationStats.pendingOrganizations} pending · {activationStats.closedOrganizations} closed
                </div>
              </div>
            </div>
          </section>

          {/* Platform User & Usage Aggregates */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Platform User Statistics */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-teal-50 text-teal-700 flex items-center justify-center">
                    <Users className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">Platform User Statistics</h2>
                    <p className="text-[11px] text-slate-500">
                      Aggregated account & membership counts across all tenants
                    </p>
                  </div>
                </div>
                <Link
                  to="/platform/users"
                  className="text-xs font-bold text-teal-700 hover:text-teal-800 inline-flex items-center gap-1"
                >
                  Manage Users <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                  <div className="text-[11px] font-semibold text-slate-500">Total Accounts</div>
                  <div className="text-lg font-bold text-slate-900 tabular-nums mt-0.5">
                    {metrics?.users.total_profiles ?? 0}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                  <div className="text-[11px] font-semibold text-slate-500">Platform Owners</div>
                  <div className="text-lg font-bold text-teal-800 tabular-nums mt-0.5">
                    {metrics?.users.platform_admins_active ?? 0}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                  <div className="text-[11px] font-semibold text-slate-500">Suspended Accounts</div>
                  <div className="text-lg font-bold text-rose-700 tabular-nums mt-0.5">
                    {metrics?.users.suspended_profiles ?? 0}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                  <div className="text-[11px] font-semibold text-slate-500">Active Staff Roles</div>
                  <div className="text-lg font-bold text-slate-900 tabular-nums mt-0.5">
                    {metrics?.users.active_org_memberships ?? 0}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                  <div className="text-[11px] font-semibold text-slate-500">Active Doctors</div>
                  <div className="text-lg font-bold text-slate-900 tabular-nums mt-0.5">
                    {metrics?.usage.active_doctors ?? 0}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                  <div className="text-[11px] font-semibold text-slate-500">Approved Clients</div>
                  <div className="text-lg font-bold text-slate-900 tabular-nums mt-0.5">
                    {metrics?.users.approved_clinic_clients ?? 0}
                  </div>
                </div>
              </div>
            </div>

            {/* Platform Usage Metrics (Privacy-Preserving) */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-teal-50 text-teal-700 flex items-center justify-center">
                    <Activity className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">
                      Usage Metrics (Aggregate Only)
                    </h2>
                    <p className="text-[11px] text-slate-500">
                      Zero clinical content or patient chat transcripts exposed
                    </p>
                  </div>
                </div>
                <Link
                  to="/platform/analytics"
                  className="text-xs font-bold text-teal-700 hover:text-teal-800 inline-flex items-center gap-1"
                >
                  Analytics <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                  <div className="text-[11px] font-semibold text-slate-500">Total Appointments</div>
                  <div className="text-lg font-bold text-slate-900 tabular-nums mt-0.5">
                    {metrics?.usage.total_appointments ?? 0}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {metrics?.usage.confirmed_appointments ?? 0} active · {metrics?.usage.completed_appointments ?? 0} completed
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                  <div className="text-[11px] font-semibold text-slate-500">Consultations</div>
                  <div className="text-lg font-bold text-slate-900 tabular-nums mt-0.5">
                    {metrics?.usage.total_consultations ?? 0}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {metrics?.usage.active_consultations ?? 0} active · {metrics?.usage.expired_consultations ?? 0} expired
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                  <div className="text-[11px] font-semibold text-slate-500">Registered Pets</div>
                  <div className="text-lg font-bold text-slate-900 tabular-nums mt-0.5">
                    {metrics?.usage.total_pets ?? 0}
                  </div>
                  <div className="text-[10px] text-slate-500">Count only (PHI restricted)</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                  <div className="text-[11px] font-semibold text-slate-500">Prescriptions Count</div>
                  <div className="text-lg font-bold text-slate-900 tabular-nums mt-0.5">
                    {metrics?.usage.total_prescriptions ?? 0}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                  <div className="text-[11px] font-semibold text-slate-500">Medical Records</div>
                  <div className="text-lg font-bold text-slate-900 tabular-nums mt-0.5">
                    {metrics?.usage.total_medical_records ?? 0}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                  <div className="text-[11px] font-semibold text-slate-500">Vaccinations</div>
                  <div className="text-lg font-bold text-slate-900 tabular-nums mt-0.5">
                    {metrics?.usage.total_vaccinations ?? 0}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Operational Overview: Pending Applications & Security Monitoring */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Pending Applications Queue */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-teal-700" />
                  <h2 className="text-sm font-bold text-slate-900">
                    Pending Organization Requests ({pendingApps.length})
                  </h2>
                </div>
                <Link
                  to="/platform/applications"
                  className="text-xs font-bold text-teal-700 hover:text-teal-800"
                >
                  Open Review Queue
                </Link>
              </div>

              {pendingApps.length === 0 ? (
                <div className="p-6 rounded-xl bg-slate-50 border border-slate-200/80 text-center text-xs text-slate-500">
                  All clinic registration requests have been processed.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {pendingApps.slice(0, 5).map((app) => (
                    <div
                      key={app.id}
                      className="p-3.5 rounded-xl border border-slate-200 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-900 truncate">
                          {app.proposed_name}{' '}
                          <span className="font-mono text-[11px] font-normal text-slate-500">
                            /{app.proposed_slug}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 truncate">
                          {app.applicant_name} ({app.applicant_email}) · {app.country}
                        </div>
                      </div>
                      <Link
                        to="/platform/applications"
                        className="px-3 py-1.5 text-[11px] font-bold text-teal-800 bg-teal-50 hover:bg-teal-100 rounded-lg shrink-0"
                      >
                        Review
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Security & Governance Overview */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-teal-700" />
                  <h2 className="text-sm font-bold text-slate-900">
                    Security & Governance Overview
                  </h2>
                </div>
                <Link
                  to="/platform/analytics"
                  className="text-xs font-bold text-teal-700 hover:text-teal-800"
                >
                  Audit & Security
                </Link>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                  <div className="text-[11px] font-semibold text-slate-500">
                    24h Governance Events
                  </div>
                  <div className="text-lg font-bold text-slate-900 tabular-nums mt-0.5">
                    {metrics?.security.recent_audit_events_24h ?? 0}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                  <div className="text-[11px] font-semibold text-slate-500">
                    Active Support Grants
                  </div>
                  <div className="text-lg font-bold text-slate-900 tabular-nums mt-0.5">
                    {activeGrants.length}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {pendingGrants.length} awaiting org owner approval
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Recent Platform Audit Events
                </div>
                {auditLogs.length === 0 ? (
                  <div className="p-4 rounded-xl bg-slate-50 text-xs text-slate-500 text-center">
                    No governance audit events recorded yet.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
                    {auditLogs.slice(0, 5).map((log) => (
                      <div key={log.id} className="px-3.5 py-2.5 flex items-start justify-between gap-3 text-xs">
                        <div className="min-w-0">
                          <div className="font-mono text-[11px] font-bold text-slate-800">
                            {log.action}
                          </div>
                          <div className="text-[11px] text-slate-600 truncate">
                            {log.details || `${log.entity_type} ${log.entity_id || ''}`}
                          </div>
                        </div>
                        <span className="text-[10px] text-slate-400 whitespace-nowrap shrink-0">
                          {new Date(log.created_at).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Operational Health Footer Cards */}
          <section className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                <Stethoscope className="w-4 h-4" />
              </div>
              <div>
                <div className="font-bold text-slate-900">
                  {metrics?.usage.active_branches ?? 0} / {metrics?.usage.total_branches ?? 0} Active Branches
                </div>
                <div className="text-slate-500">Multi-branch clinic coverage across tenants</div>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center shrink-0">
                <CalendarCheck className="w-4 h-4" />
              </div>
              <div>
                <div className="font-bold text-slate-900">
                  {metrics?.usage.paid_payments_count ?? 0} / {metrics?.usage.total_payments ?? 0} Settled Payments
                </div>
                <div className="text-slate-500">Consultation ledger completion volume</div>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-teal-50 text-teal-700 flex items-center justify-center shrink-0">
                <FileCheck className="w-4 h-4" />
              </div>
              <div>
                <div className="font-bold text-slate-900">RLS Clinical Isolation Enforced</div>
                <div className="text-slate-500">
                  Platform Owner holds zero unrestricted clinical or chat access
                </div>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
};
