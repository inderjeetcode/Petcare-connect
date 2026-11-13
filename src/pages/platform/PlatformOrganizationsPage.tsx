import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { platformPortalService } from '../../services/platformPortalService';
import { formatSupabaseError } from '../../services/authService';
import { OrganizationApplication } from '../../types/auth';
import {
  PlatformOrganizationDetails,
  PlatformOrganizationOverview,
  PlatformSupportScope,
} from '../../types/platform';
import {
  ALLOWED_SUPPORT_SCOPES,
  validatePlatformOrgTransition,
  validateSupportAccessRequest,
} from '../../utils/platformPortalHelpers';
import {
  compareIsoDates,
  compareStrings,
  paginateItems,
} from '../../utils/listManagementHelpers';
import { PageHeader } from '../../components/common/PageHeader';
import { Modal } from '../../components/common/Modal';
import { Pagination } from '../../components/common/Pagination';
import { PlatformPrivacyBanner } from '../../components/platform/PlatformPrivacyBanner';
import {
  ArrowUpDown,
  Building2,
  CheckCircle2,
  Clock,
  Edit3,
  Eye,
  KeyRound,
  Loader2,
  MapPin,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  XCircle,
} from 'lucide-react';

export const PlatformOrganizationsPage: React.FC = () => {
  const { showToast } = useApp();
  const location = useLocation();
  const navigate = useNavigate();

  const routeTab: 'applications' | 'organizations' = location.pathname.includes('/organizations')
    ? 'organizations'
    : 'applications';

  const [applications, setApplications] = useState<OrganizationApplication[]>([]);
  const [organizations, setOrganizations] = useState<PlatformOrganizationOverview[]>([]);
  const [appStatusFilter, setAppStatusFilter] = useState<string>('pending');
  const [orgStatusFilter, setOrgStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [appSortOrder, setAppSortOrder] = useState<'desc' | 'asc'>('desc');
  const [orgSortBy, setOrgSortBy] = useState<'created_at' | 'display_name' | 'appointment_count'>('created_at');
  const [orgSortOrder, setOrgSortOrder] = useState<'desc' | 'asc'>('desc');
  const [appPage, setAppPage] = useState(1);
  const [appPageSize, setAppPageSize] = useState(10);
  const [orgPage, setOrgPage] = useState(1);
  const [orgPageSize, setOrgPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Application Detail & Rejection modals
  const [detailApp, setDetailApp] = useState<OrganizationApplication | null>(null);
  const [rejectTarget, setRejectTarget] = useState<OrganizationApplication | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Organization Detail / Operational Overview modal
  const [orgDetailsOpen, setOrgDetailsOpen] = useState(false);
  const [orgDetailsLoading, setOrgDetailsLoading] = useState(false);
  const [orgDetails, setOrgDetails] = useState<PlatformOrganizationDetails | null>(null);

  // Organization Metadata Edit modal
  const [editOrg, setEditOrg] = useState<PlatformOrganizationOverview | null>(null);
  const [metaForm, setMetaForm] = useState({
    display_name: '',
    legal_name: '',
    timezone: 'UTC',
    country: 'IN',
    contact_email: '',
    phone: '',
    plan_code: '',
  });

  // Organization Suspend modal
  const [suspendTarget, setSuspendTarget] = useState<PlatformOrganizationOverview | null>(null);
  const [suspendReason, setSuspendReason] = useState('');

  // Support Access Request modal
  const [supportTargetOrg, setSupportTargetOrg] = useState<PlatformOrganizationOverview | null>(null);
  const [supportScope, setSupportScope] = useState<PlatformSupportScope>('org_diagnostics');
  const [supportDuration, setSupportDuration] = useState<number>(60);
  const [supportReason, setSupportReason] = useState('');
  const [maxSupportMinutes, setMaxSupportMinutes] = useState<number>(60);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [apps, orgs, settings] = await Promise.all([
        platformPortalService.listApplications(),
        platformPortalService.listOrganizationsOverview(),
        platformPortalService.getSettings().catch(() => null),
      ]);
      setApplications(apps);
      setOrganizations(orgs);
      if (settings?.max_support_access_minutes) {
        setMaxSupportMinutes(settings.max_support_access_minutes);
        setSupportDuration((prev) => Math.min(prev, settings.max_support_access_minutes));
      }
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to load platform governance data.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleApproveApp = async (app: OrganizationApplication) => {
    setBusyId(app.id);
    try {
      await platformPortalService.approveApplication(app.id);
      showToast(
        `Approved ${app.proposed_name}. Organization, initial branch, and org_owner membership provisioned.`,
        'success'
      );
      setDetailApp(null);
      await loadData();
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to approve application.'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleRejectApp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectTarget || !rejectReason.trim()) return;
    setBusyId(rejectTarget.id);
    try {
      await platformPortalService.rejectApplication(rejectTarget.id, rejectReason.trim());
      showToast(`Rejected application for ${rejectTarget.proposed_name}.`, 'info');
      setRejectTarget(null);
      setRejectReason('');
      setDetailApp(null);
      await loadData();
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to reject application.'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleActivateOrg = async (org: PlatformOrganizationOverview) => {
    const errMsg = validatePlatformOrgTransition('activate', org.status);
    if (errMsg) {
      showToast(errMsg, 'warning');
      return;
    }
    setBusyId(org.id);
    try {
      await platformPortalService.activateOrganization(org.id);
      showToast(`Activated ${org.display_name}.`, 'success');
      await loadData();
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to activate organization.'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleSuspendOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!suspendTarget) return;
    const errMsg = validatePlatformOrgTransition('suspend', suspendTarget.status, suspendReason);
    if (errMsg) {
      showToast(errMsg, 'warning');
      return;
    }
    setBusyId(suspendTarget.id);
    try {
      await platformPortalService.suspendOrganization(suspendTarget.id, suspendReason.trim());
      showToast(`Suspended ${suspendTarget.display_name}.`, 'warning');
      setSuspendTarget(null);
      setSuspendReason('');
      await loadData();
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to suspend organization.'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleReactivateOrg = async (org: PlatformOrganizationOverview) => {
    const errMsg = validatePlatformOrgTransition('reactivate', org.status);
    if (errMsg) {
      showToast(errMsg, 'warning');
      return;
    }
    setBusyId(org.id);
    try {
      await platformPortalService.reactivateOrganization(org.id);
      showToast(`Reactivated ${org.display_name}.`, 'success');
      await loadData();
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to reactivate organization.'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const openOrgDetails = async (org: PlatformOrganizationOverview) => {
    setOrgDetailsOpen(true);
    setOrgDetailsLoading(true);
    setOrgDetails(null);
    try {
      const details = await platformPortalService.getOrganizationDetails(org.id);
      setOrgDetails(details);
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to load organization operational overview.'), 'error');
      setOrgDetailsOpen(false);
    } finally {
      setOrgDetailsLoading(false);
    }
  };

  const openEditMetadata = (org: PlatformOrganizationOverview) => {
    setEditOrg(org);
    setMetaForm({
      display_name: org.display_name || '',
      legal_name: org.legal_name || '',
      timezone: org.timezone || 'UTC',
      country: org.country || 'IN',
      contact_email: org.contact_email || '',
      phone: org.phone || '',
      plan_code: org.plan_code || '',
    });
  };

  const handleSaveMetadata = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editOrg) return;
    setBusyId(editOrg.id);
    try {
      await platformPortalService.updateOrganizationMetadata({
        organization_id: editOrg.id,
        display_name: metaForm.display_name,
        legal_name: metaForm.legal_name,
        timezone: metaForm.timezone,
        country: metaForm.country,
        contact_email: metaForm.contact_email.trim() || null,
        phone: metaForm.phone.trim() || null,
        plan_code: metaForm.plan_code.trim() || null,
      });
      showToast(`Updated metadata for ${metaForm.display_name}.`, 'success');
      setEditOrg(null);
      await loadData();
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to update organization metadata.'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleSubmitSupportRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supportTargetOrg) return;
    const validationErr = validateSupportAccessRequest({
      scope: supportScope,
      reason: supportReason,
      durationMinutes: supportDuration,
      maxMinutes: maxSupportMinutes,
    });
    if (validationErr) {
      showToast(validationErr, 'warning');
      return;
    }

    setBusyId(supportTargetOrg.id);
    try {
      await platformPortalService.requestSupportAccess({
        organization_id: supportTargetOrg.id,
        scope: supportScope,
        reason: supportReason.trim(),
        duration_minutes: supportDuration,
      });
      showToast(
        `Support access request sent to ${supportTargetOrg.display_name}. An Organization Owner must approve it before diagnostics are unlocked.`,
        'success'
      );
      setSupportTargetOrg(null);
      setSupportReason('');
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to submit support access request.'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const filteredApps = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = applications.filter((a) => {
      if (appStatusFilter !== 'all' && a.status !== appStatusFilter) return false;
      if (!q) return true;
      return (
        a.proposed_name.toLowerCase().includes(q) ||
        a.proposed_slug.toLowerCase().includes(q) ||
        a.legal_name.toLowerCase().includes(q) ||
        (a.applicant_email || '').toLowerCase().includes(q)
      );
    });
    const factor = appSortOrder === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => compareIsoDates(a.created_at, b.created_at) * factor);
  }, [applications, appStatusFilter, searchQuery, appSortOrder]);

  const pagedApps = useMemo(
    () => paginateItems(filteredApps, appPage, appPageSize),
    [filteredApps, appPage, appPageSize]
  );

  const filteredOrgs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = organizations.filter((org) => {
      if (orgStatusFilter !== 'all' && org.status !== orgStatusFilter) return false;
      if (!q) return true;
      return (
        org.display_name.toLowerCase().includes(q) ||
        org.legal_name.toLowerCase().includes(q) ||
        org.slug.toLowerCase().includes(q) ||
        org.country.toLowerCase().includes(q)
      );
    });
    const factor = orgSortOrder === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      if (orgSortBy === 'display_name') return compareStrings(a.display_name, b.display_name) * factor;
      if (orgSortBy === 'appointment_count') {
        return ((a.appointment_count || 0) - (b.appointment_count || 0)) * factor;
      }
      return compareIsoDates(a.created_at, b.created_at) * factor;
    });
  }, [organizations, orgStatusFilter, searchQuery, orgSortBy, orgSortOrder]);

  const pagedOrgs = useMemo(
    () => paginateItems(filteredOrgs, orgPage, orgPageSize),
    [filteredOrgs, orgPage, orgPageSize]
  );

  const pendingCount = applications.filter((a) => a.status === 'pending').length;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Organizations & Approval Governance"
        subtitle="Review clinic registration requests, inspect operational overviews, update metadata, and govern tenant lifecycle."
        action={
          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-xl inline-flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        }
      />

      <PlatformPrivacyBanner compact />

      {/* Route-synced Tabs + Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate('/platform/applications')}
            className={`px-4 py-2 text-xs font-bold rounded-xl transition-colors inline-flex items-center gap-1.5 ${
              routeTab === 'applications'
                ? 'bg-teal-700 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            Clinic Applications
            {pendingCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-amber-400 text-slate-900">
                {pendingCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => navigate('/platform/organizations')}
            className={`px-4 py-2 text-xs font-bold rounded-xl transition-colors inline-flex items-center gap-1.5 ${
              routeTab === 'organizations'
                ? 'bg-teal-700 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Building2 className="w-4 h-4" />
            Organizations ({organizations.length})
          </button>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setAppPage(1);
              setOrgPage(1);
            }}
            placeholder="Search clinic, slug, legal entity..."
            aria-label="Search clinic applications and organizations"
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
          />
        </div>
      </div>

      {loading ? (
        <div className="py-12 flex items-center justify-center gap-2 text-xs text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin text-teal-700" />
          <span>Loading platform organizations & queue...</span>
        </div>
      ) : routeTab === 'applications' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {['pending', 'approved', 'rejected', 'withdrawn', 'all'].map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => {
                    setAppStatusFilter(st);
                    setAppPage(1);
                  }}
                  className={`px-3 py-1 text-xs font-semibold rounded-lg border capitalize ${
                    appStatusFilter === st
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setAppSortOrder((o) => (o === 'desc' ? 'asc' : 'desc'))}
              className="px-3 py-1 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg inline-flex items-center gap-1"
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              {appSortOrder === 'desc' ? 'Newest First' : 'Oldest First'}
            </button>
          </div>

          {pagedApps.items.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-xs text-slate-500">
              No {appStatusFilter === 'all' ? '' : appStatusFilter} organization applications found.
            </div>
          ) : (
            <div className="space-y-3">
              {pagedApps.items.map((app) => (
                <div
                  key={app.id}
                  className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 shadow-xs"
                >
                  <div className="space-y-1.5 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-bold text-slate-900">
                        {app.proposed_name}
                      </span>
                      <span className="font-mono text-[11px] px-2 py-0.5 bg-slate-100 rounded text-slate-700">
                        /{app.proposed_slug}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          app.status === 'pending'
                            ? 'bg-amber-100 text-amber-800'
                            : app.status === 'approved'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {app.status}
                      </span>
                    </div>
                    <div className="text-slate-600">
                      Legal Entity: <strong>{app.legal_name}</strong> · Applicant:{' '}
                      {app.applicant_name} ({app.applicant_email})
                    </div>
                    <div className="text-slate-500">
                      Initial Branch: <strong>{app.initial_branch_name}</strong> ({app.initial_branch_code}) ·{' '}
                      {app.initial_branch_address} · {app.country} ({app.timezone})
                    </div>
                    {app.decision_reason && (
                      <div className="text-rose-700 font-medium">
                        Decision Reason: {app.decision_reason}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setDetailApp(app)}
                      className="px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl inline-flex items-center gap-1.5"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Details
                    </button>
                    {app.status === 'pending' && (
                      <>
                        <button
                          type="button"
                          disabled={busyId === app.id}
                          onClick={() => handleApproveApp(app)}
                          className="px-3.5 py-2 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-xl inline-flex items-center gap-1.5"
                        >
                          {busyId === app.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          )}
                          Approve & Activate
                        </button>
                        <button
                          type="button"
                          disabled={busyId === app.id}
                          onClick={() => {
                            setRejectTarget(app);
                            setRejectReason('');
                          }}
                          className="px-3.5 py-2 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl inline-flex items-center gap-1.5"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          Reject
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <Pagination
                  currentPage={pagedApps.currentPage}
                  totalPages={pagedApps.totalPages}
                  totalItems={pagedApps.totalItems}
                  startIndex={pagedApps.startIndex}
                  endIndex={pagedApps.endIndex}
                  pageSize={pagedApps.pageSize}
                  onPageChange={setAppPage}
                  onPageSizeChange={(size) => {
                    setAppPageSize(size);
                    setAppPage(1);
                  }}
                  itemLabel="applications"
                />
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {['all', 'active', 'pending', 'suspended', 'closed'].map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => {
                    setOrgStatusFilter(st);
                    setOrgPage(1);
                  }}
                  className={`px-3 py-1 text-xs font-semibold rounded-lg border capitalize ${
                    orgStatusFilter === st
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <select
                value={orgSortBy}
                onChange={(e) => {
                  setOrgSortBy(e.target.value as 'created_at' | 'display_name' | 'appointment_count');
                  setOrgPage(1);
                }}
                aria-label="Sort organizations"
                className="px-2.5 py-1 text-xs border border-slate-200 rounded-lg bg-white"
              >
                <option value="created_at">Sort: Created Date</option>
                <option value="display_name">Sort: Name</option>
                <option value="appointment_count">Sort: Appointments</option>
              </select>
              <button
                type="button"
                onClick={() => setOrgSortOrder((o) => (o === 'desc' ? 'asc' : 'desc'))}
                className="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg inline-flex items-center gap-1"
              >
                <ArrowUpDown className="w-3.5 h-3.5" />
                {orgSortOrder === 'desc' ? 'Desc' : 'Asc'}
              </button>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                  <tr>
                    <th className="py-3 px-4">Organization</th>
                    <th className="py-3 px-4">Slug & Region</th>
                    <th className="py-3 px-4">Operational Aggregates</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Created</th>
                    <th className="py-3 px-4 text-right">Governance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pagedOrgs.items.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-slate-500">
                        No matching organizations found.
                      </td>
                    </tr>
                  ) : (
                    pagedOrgs.items.map((org) => (
                      <tr key={org.id} className="hover:bg-slate-50/50">
                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-900">{org.display_name}</div>
                          <div className="text-[11px] text-slate-500">{org.legal_name}</div>
                          {org.plan_code && (
                            <span className="mt-1 inline-block px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono text-[10px]">
                              Plan: {org.plan_code}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-mono text-slate-800">/{org.slug}</div>
                          <div className="text-[11px] text-slate-500">
                            {org.country} · {org.timezone}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-[11px] text-slate-600 tabular-nums">
                          <div>
                            <strong>{org.active_branch_count}</strong>/{org.branch_count} branches ·{' '}
                            <strong>{org.active_staff_count}</strong> staff ·{' '}
                            <strong>{org.active_doctor_count}</strong> doctors
                          </div>
                          <div className="text-slate-500">
                            {org.approved_client_count} clients · {org.appointment_count} appts ·{' '}
                            {org.consultation_count} consults
                          </div>
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
                        <td className="py-3 px-4 text-slate-500 whitespace-nowrap tabular-nums">
                          {new Date(org.created_at).toLocaleDateString()}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap space-x-1.5">
                          <button
                            type="button"
                            onClick={() => openOrgDetails(org)}
                            className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            Overview
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditMetadata(org)}
                            className="px-2.5 py-1.5 text-xs font-semibold text-teal-800 bg-teal-50 hover:bg-teal-100 rounded-lg inline-flex items-center gap-1"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            Metadata
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSupportTargetOrg(org);
                              setSupportReason('');
                              setSupportScope('org_diagnostics');
                              setSupportDuration(Math.min(60, maxSupportMinutes));
                            }}
                            className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg inline-flex items-center gap-1"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                            Support
                          </button>
                          {org.status === 'pending' && (
                            <button
                              type="button"
                              disabled={busyId === org.id}
                              onClick={() => handleActivateOrg(org)}
                              className="px-2.5 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg inline-flex items-center gap-1"
                            >
                              <PlayCircle className="w-3.5 h-3.5" />
                              Activate
                            </button>
                          )}
                          {org.status === 'active' && (
                            <button
                              type="button"
                              disabled={busyId === org.id}
                              onClick={() => {
                                setSuspendTarget(org);
                                setSuspendReason('');
                              }}
                              className="px-2.5 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-lg inline-flex items-center gap-1"
                            >
                              <PauseCircle className="w-3.5 h-3.5" />
                              Suspend
                            </button>
                          )}
                          {org.status === 'suspended' && (
                            <button
                              type="button"
                              disabled={busyId === org.id}
                              onClick={() => handleReactivateOrg(org)}
                              className="px-2.5 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg inline-flex items-center gap-1"
                            >
                              <PlayCircle className="w-3.5 h-3.5" />
                              Reactivate
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
          </div>
        </div>
      )}

      {/* Application Detail Modal */}
      <Modal
        isOpen={Boolean(detailApp)}
        onClose={() => setDetailApp(null)}
        title={detailApp?.proposed_name || 'Organization Application'}
        subtitle={`Application ID: ${detailApp?.id || ''}`}
        maxWidth="lg"
      >
        {detailApp && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
              <div>
                <div className="text-slate-500">Proposed Slug</div>
                <div className="font-mono font-bold text-slate-900">/{detailApp.proposed_slug}</div>
              </div>
              <div>
                <div className="text-slate-500">Legal Entity</div>
                <div className="font-bold text-slate-900">{detailApp.legal_name}</div>
              </div>
              <div>
                <div className="text-slate-500">Applicant</div>
                <div className="font-semibold text-slate-900">
                  {detailApp.applicant_name} ({detailApp.applicant_email})
                </div>
              </div>
              <div>
                <div className="text-slate-500">Contact & Phone</div>
                <div className="font-semibold text-slate-900">
                  {detailApp.contact_email} · {detailApp.phone}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Region & Timezone</div>
                <div className="font-semibold text-slate-900">
                  {detailApp.country} · {detailApp.timezone}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Submitted At</div>
                <div className="font-semibold text-slate-900">
                  {new Date(detailApp.created_at).toLocaleString()}
                </div>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 space-y-1.5">
              <div className="font-bold text-slate-900 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-teal-700" />
                Initial Branch Provisioning Spec
              </div>
              <div className="text-slate-700">
                <strong>{detailApp.initial_branch_name}</strong> ({detailApp.initial_branch_code})
              </div>
              <div className="text-slate-500">{detailApp.initial_branch_address}</div>
            </div>

            {detailApp.documents && detailApp.documents.length > 0 && (
              <div className="p-4 rounded-xl border border-slate-200 space-y-1.5">
                <div className="font-bold text-slate-900">Submitted Verification Documents</div>
                <ul className="space-y-1">
                  {detailApp.documents.map((doc, idx) => (
                    <li key={idx} className="font-mono text-[11px] text-teal-800">
                      • {doc.name || 'Document'} {doc.type ? `[${doc.type}]` : ''}{' '}
                      {doc.url ? `— ${doc.url}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {detailApp.status === 'pending' && (
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setRejectTarget(detailApp);
                    setRejectReason('');
                  }}
                  className="px-4 py-2 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl"
                >
                  Reject
                </button>
                <button
                  type="button"
                  disabled={busyId === detailApp.id}
                  onClick={() => handleApproveApp(detailApp)}
                  className="px-4 py-2 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-xl"
                >
                  Approve & Activate Organization
                </button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Organization Operational Overview Modal */}
      <Modal
        isOpen={orgDetailsOpen}
        onClose={() => setOrgDetailsOpen(false)}
        title={orgDetails?.organization.display_name || 'Organization Operational Overview'}
        subtitle={
          orgDetails
            ? `/${orgDetails.organization.slug} · ${orgDetails.organization.legal_name}`
            : 'Loading privacy-preserving tenant summary...'
        }
        maxWidth="xl"
      >
        {orgDetailsLoading || !orgDetails ? (
          <div className="py-10 flex items-center justify-center gap-2 text-xs text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin text-teal-700" />
            <span>Loading aggregate tenant overview...</span>
          </div>
        ) : (
          <div className="space-y-5 text-xs">
            <div className="p-3 rounded-xl bg-teal-50 border border-teal-200 text-teal-900">
              <strong>Ownership & Membership Safeguard:</strong> Platform Owner views aggregate role counts and operational metrics only. Organization ownership and staff memberships cannot be silently altered.
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-slate-500">Active Staff</div>
                <div className="text-lg font-bold text-slate-900 tabular-nums">
                  {orgDetails.metrics.active_staff}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-slate-500">Active Doctors</div>
                <div className="text-lg font-bold text-slate-900 tabular-nums">
                  {orgDetails.metrics.active_doctors}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-slate-500">Approved Clients</div>
                <div className="text-lg font-bold text-slate-900 tabular-nums">
                  {orgDetails.metrics.approved_clients}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-slate-500">Pets (Count)</div>
                <div className="text-lg font-bold text-slate-900 tabular-nums">
                  {orgDetails.metrics.pets}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-slate-500">Appointments</div>
                <div className="text-lg font-bold text-slate-900 tabular-nums">
                  {orgDetails.metrics.appointments_total}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-slate-500">Consultations</div>
                <div className="text-lg font-bold text-slate-900 tabular-nums">
                  {orgDetails.metrics.consultations_total}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-slate-500">Prescriptions Count</div>
                <div className="text-lg font-bold text-slate-900 tabular-nums">
                  {orgDetails.metrics.prescriptions_total}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-slate-500">Medical Records Count</div>
                <div className="text-lg font-bold text-slate-900 tabular-nums">
                  {orgDetails.metrics.medical_records_total}
                </div>
              </div>
            </div>

            <div>
              <h3 className="font-bold text-slate-900 mb-2">Role Distribution (Aggregate)</h3>
              <div className="flex flex-wrap gap-2">
                {Object.entries(orgDetails.role_counts).length === 0 ? (
                  <span className="text-slate-500">No active role assignments recorded.</span>
                ) : (
                  Object.entries(orgDetails.role_counts).map(([role, count]) => (
                    <span
                      key={role}
                      className="px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 font-mono text-[11px] text-slate-800"
                    >
                      {role}: <strong>{count}</strong>
                    </span>
                  ))
                )}
              </div>
            </div>

            <div>
              <h3 className="font-bold text-slate-900 mb-2">
                Branches ({orgDetails.branches.length})
              </h3>
              <div className="border border-slate-200 rounded-xl divide-y divide-slate-100">
                {orgDetails.branches.length === 0 ? (
                  <div className="p-3 text-slate-500">No branches configured yet.</div>
                ) : (
                  orgDetails.branches.map((b) => (
                    <div key={b.id} className="px-3.5 py-2.5 flex items-center justify-between">
                      <div>
                        <span className="font-bold text-slate-900">{b.name}</span>{' '}
                        <span className="font-mono text-slate-500">({b.code})</span>
                        <div className="text-[11px] text-slate-500">
                          {b.timezone} {b.city ? `· ${b.city}` : ''}
                        </div>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          b.is_active
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {b.is_active ? 'active' : 'inactive'}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Edit Organization Metadata Modal */}
      <Modal
        isOpen={Boolean(editOrg)}
        onClose={() => setEditOrg(null)}
        title={`Edit Metadata: ${editOrg?.display_name || ''}`}
        subtitle="Updates organization metadata only. Ownership and staff memberships remain strictly unchanged."
        maxWidth="lg"
      >
        <form onSubmit={handleSaveMetadata} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">Display Name *</label>
              <input
                type="text"
                required
                value={metaForm.display_name}
                onChange={(e) => setMetaForm({ ...metaForm, display_name: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Legal Name *</label>
              <input
                type="text"
                required
                value={metaForm.legal_name}
                onChange={(e) => setMetaForm({ ...metaForm, legal_name: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Country</label>
              <input
                type="text"
                required
                value={metaForm.country}
                onChange={(e) => setMetaForm({ ...metaForm, country: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Timezone</label>
              <input
                type="text"
                required
                value={metaForm.timezone}
                onChange={(e) => setMetaForm({ ...metaForm, timezone: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Contact Email</label>
              <input
                type="email"
                value={metaForm.contact_email}
                onChange={(e) => setMetaForm({ ...metaForm, contact_email: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Phone</label>
              <input
                type="text"
                value={metaForm.phone}
                onChange={(e) => setMetaForm({ ...metaForm, phone: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block font-bold text-slate-700 mb-1">SaaS Plan Code</label>
              <input
                type="text"
                value={metaForm.plan_code}
                onChange={(e) => setMetaForm({ ...metaForm, plan_code: e.target.value })}
                placeholder="e.g. pilot, clinic-standard, multi-branch"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setEditOrg(null)}
              className="px-4 py-2 font-semibold text-slate-700 bg-slate-100 rounded-xl"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={Boolean(busyId)}
              className="px-4 py-2 font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-xl"
            >
              Save Metadata
            </button>
          </div>
        </form>
      </Modal>

      {/* Request Scoped Support Access Modal */}
      <Modal
        isOpen={Boolean(supportTargetOrg)}
        onClose={() => setSupportTargetOrg(null)}
        title={`Request Scoped Support Access: ${supportTargetOrg?.display_name || ''}`}
        subtitle="Requires explicit Organization Owner approval. Strictly non-clinical and time-limited."
        maxWidth="md"
      >
        <form onSubmit={handleSubmitSupportRequest} className="space-y-4 text-xs">
          <div>
            <label className="block font-bold text-slate-700 mb-1">Diagnostic Scope *</label>
            <select
              value={supportScope}
              onChange={(e) => setSupportScope(e.target.value as PlatformSupportScope)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
            >
              {ALLOWED_SUPPORT_SCOPES.map((sc) => (
                <option key={sc.value} value={sc.value}>
                  {sc.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-500 mt-1">
              {ALLOWED_SUPPORT_SCOPES.find((s) => s.value === supportScope)?.description}
            </p>
          </div>
          <div>
            <label className="block font-bold text-slate-700 mb-1">
              Time Limit (Minutes, 15–{maxSupportMinutes}) *
            </label>
            <input
              type="number"
              min={15}
              max={maxSupportMinutes}
              value={supportDuration}
              onChange={(e) => setSupportDuration(Number(e.target.value))}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block font-bold text-slate-700 mb-1">Justification / Ticket *</label>
            <textarea
              required
              rows={3}
              value={supportReason}
              onChange={(e) => setSupportReason(e.target.value)}
              placeholder="Ticket #PC-104: Investigate branch timezone configuration mismatch..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setSupportTargetOrg(null)}
              className="px-4 py-2 font-semibold text-slate-700 bg-slate-100 rounded-xl"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={Boolean(busyId)}
              className="px-4 py-2 font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-xl"
            >
              Send Approval Request
            </button>
          </div>
        </form>
      </Modal>

      {/* Reject Application Modal */}
      <Modal
        isOpen={Boolean(rejectTarget)}
        onClose={() => setRejectTarget(null)}
        title={`Reject Application: ${rejectTarget?.proposed_name || ''}`}
        subtitle="Provide a clear reason to record in the audit trail and notify the applicant."
        maxWidth="md"
      >
        <form onSubmit={handleRejectApp} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Rejection Reason *
            </label>
            <textarea
              required
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Missing veterinary clinic license verification..."
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setRejectTarget(null)}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 rounded-xl"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={Boolean(busyId)}
              className="px-4 py-2 text-xs font-bold text-white bg-rose-700 hover:bg-rose-800 rounded-xl"
            >
              Confirm Rejection
            </button>
          </div>
        </form>
      </Modal>

      {/* Suspend Organization Modal */}
      <Modal
        isOpen={Boolean(suspendTarget)}
        onClose={() => setSuspendTarget(null)}
        title={`Suspend Organization: ${suspendTarget?.display_name || ''}`}
        subtitle="Suspended organizations immediately lose access to all staff and client workspaces."
        maxWidth="md"
      >
        <form onSubmit={handleSuspendOrg} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Suspension Reason *
            </label>
            <textarea
              required
              rows={3}
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              placeholder="Compliance review or administrative suspension reason..."
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setSuspendTarget(null)}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 rounded-xl"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={Boolean(busyId)}
              className="px-4 py-2 text-xs font-bold text-white bg-rose-700 hover:bg-rose-800 rounded-xl"
            >
              Suspend Organization
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
