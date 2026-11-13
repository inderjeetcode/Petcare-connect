import React, { useEffect, useState, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { onboardingService } from '../../services/onboardingService';
import { formatSupabaseError } from '../../services/authService';
import { Organization, OrganizationApplication } from '../../types/auth';
import { PageHeader } from '../../components/common/PageHeader';
import { Modal } from '../../components/common/Modal';
import {
  ShieldCheck,
  Building2,
  CheckCircle2,
  XCircle,
  Clock,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Lock,
  Loader2,
} from 'lucide-react';

export const PlatformOrganizationsPage: React.FC = () => {
  const { showToast } = useApp();

  const [activeTab, setActiveTab] = useState<'applications' | 'organizations'>('applications');
  const [applications, setApplications] = useState<OrganizationApplication[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [rejectTarget, setRejectTarget] = useState<OrganizationApplication | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const [suspendTarget, setSuspendTarget] = useState<Organization | null>(null);
  const [suspendReason, setSuspendReason] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [apps, orgs] = await Promise.all([
        onboardingService.getAllOrganizationApplications(),
        onboardingService.listAllOrganizations(),
      ]);
      setApplications(apps);
      setOrganizations(orgs);
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
      await onboardingService.approveOrganizationApplication(app.id);
      showToast(
        `Approved ${app.proposed_name}. Organization, initial branch, and org_owner membership provisioned.`,
        'success'
      );
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
      await onboardingService.rejectOrganizationApplication(
        rejectTarget.id,
        rejectReason.trim()
      );
      showToast(`Rejected application for ${rejectTarget.proposed_name}.`, 'info');
      setRejectTarget(null);
      setRejectReason('');
      await loadData();
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to reject application.'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleSuspendOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!suspendTarget || !suspendReason.trim()) return;
    setBusyId(suspendTarget.id);
    try {
      await onboardingService.suspendOrganization(
        suspendTarget.id,
        suspendReason.trim()
      );
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

  const handleReactivateOrg = async (org: Organization) => {
    setBusyId(org.id);
    try {
      await onboardingService.reactivateOrganization(org.id);
      showToast(`Reactivated ${org.display_name}.`, 'success');
      await loadData();
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to reactivate organization.'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const filteredApps = applications.filter((a) =>
    statusFilter === 'all' ? true : a.status === statusFilter
  );

  const pendingCount = applications.filter((a) => a.status === 'pending').length;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <PageHeader
        title="Platform Owner Governance Console"
        subtitle="Manually review new veterinary clinic applications and govern active/suspended organizations."
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

      {/* Zero Clinical Data Boundary Notice */}
      <div className="p-4 rounded-xl bg-teal-50 border border-teal-200 flex items-start gap-3 text-xs text-teal-900">
        <Lock className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
        <div>
          <span className="font-bold">Strict Privacy & Tenant Isolation: </span>
          Platform Owner access is scoped exclusively to organization onboarding and tenant lifecycle status. Pet profiles, clinical notes, consultations, prescriptions, and patient chats remain inaccessible under database RLS.
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('applications')}
          className={`px-4 py-2 text-xs font-bold rounded-xl transition-colors inline-flex items-center gap-1.5 ${
            activeTab === 'applications'
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
          onClick={() => setActiveTab('organizations')}
          className={`px-4 py-2 text-xs font-bold rounded-xl transition-colors inline-flex items-center gap-1.5 ${
            activeTab === 'organizations'
              ? 'bg-teal-700 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Building2 className="w-4 h-4" />
          Organizations ({organizations.length})
        </button>
      </div>

      {loading ? (
        <div className="py-12 flex items-center justify-center gap-2 text-xs text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin text-teal-700" />
          <span>Loading governance queue...</span>
        </div>
      ) : activeTab === 'applications' ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            {['pending', 'approved', 'rejected', 'all'].map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1 text-xs font-semibold rounded-lg border capitalize ${
                  statusFilter === st
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {st}
              </button>
            ))}
          </div>

          {filteredApps.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-xs text-slate-500">
              No {statusFilter === 'all' ? '' : statusFilter} organization applications found.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredApps.map((app) => (
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
                    {app.documents && app.documents.length > 0 && (
                      <div className="text-teal-800 font-mono text-[11px]">
                        Docs: {app.documents.map((d) => d.url || d.name).join(', ')}
                      </div>
                    )}
                    {app.decision_reason && (
                      <div className="text-rose-700 font-medium">
                        Decision Reason: {app.decision_reason}
                      </div>
                    )}
                  </div>

                  {app.status === 'pending' && (
                    <div className="flex items-center gap-2 shrink-0">
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
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto shadow-xs">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
              <tr>
                <th className="py-3 px-4">Organization</th>
                <th className="py-3 px-4">Slug</th>
                <th className="py-3 px-4">Region</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Created</th>
                <th className="py-3 px-4 text-right">Governance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {organizations.map((org) => (
                <tr key={org.id} className="hover:bg-slate-50/50">
                  <td className="py-3 px-4">
                    <div className="font-bold text-slate-900">{org.display_name}</div>
                    <div className="text-[11px] text-slate-500">{org.legal_name}</div>
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-700">/{org.slug}</td>
                  <td className="py-3 px-4 text-slate-600">
                    {org.country} · {org.timezone}
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
                  <td className="py-3 px-4 text-slate-500">
                    {new Date(org.created_at).toLocaleDateString()}
                  </td>
                  <td className="py-3 px-4 text-right">
                    {org.status === 'active' ? (
                      <button
                        type="button"
                        disabled={busyId === org.id}
                        onClick={() => {
                          setSuspendTarget(org);
                          setSuspendReason('');
                        }}
                        className="px-3 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-lg inline-flex items-center gap-1"
                      >
                        <PauseCircle className="w-3.5 h-3.5" />
                        Suspend
                      </button>
                    ) : org.status === 'suspended' ? (
                      <button
                        type="button"
                        disabled={busyId === org.id}
                        onClick={() => handleReactivateOrg(org)}
                        className="px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg inline-flex items-center gap-1"
                      >
                        <PlayCircle className="w-3.5 h-3.5" />
                        Reactivate
                      </button>
                    ) : (
                      <span className="text-slate-400 inline-flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {org.status}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
