import React, { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useApp } from '../../context/AppContext';
import { onboardingService } from '../../services/onboardingService';
import { formatSupabaseError } from '../../services/authService';
import { Organization, OrganizationApplication, WorkspaceOption } from '../../types/auth';
import { PageHeader } from '../../components/common/PageHeader';
import { Modal } from '../../components/common/Modal';
import {
  Building2,
  Stethoscope,
  UserCheck,
  ShieldCheck,
  ArrowRight,
  Plus,
  Search,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Ticket,
  RefreshCw,
  MapPin,
  Loader2,
} from 'lucide-react';

function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 78);
}

export const WorkspacesPage: React.FC = () => {
  const {
    profile,
    user,
    availableWorkspaces,
    memberships,
    clinicClients,
    isPlatformAdmin,
    setActiveWorkspaceByKey,
    refreshContext,
  } = useAuth();
  const { showToast } = useApp();
  const navigate = useNavigate();

  const [discoverableOrgs, setDiscoverableOrgs] = useState<Organization[]>([]);
  const [myApplications, setMyApplications] = useState<OrganizationApplication[]>([]);
  const [orgSearch, setOrgSearch] = useState('');
  const [loadingDirectory, setLoadingDirectory] = useState(true);
  const [joiningOrgId, setJoiningOrgId] = useState<string | null>(null);
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [submittingApp, setSubmittingApp] = useState(false);
  const [appError, setAppError] = useState('');

  const [regForm, setRegForm] = useState({
    proposed_name: '',
    proposed_slug: '',
    slugTouched: false,
    legal_name: '',
    contact_email: profile?.email || user?.email || '',
    phone: profile?.phone || '',
    country: 'US',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    branch_name: 'Main Hospital',
    branch_code: 'MAIN',
    branch_address: '',
    license_ref: '',
  });

  const loadDirectoryAndApplications = useCallback(async () => {
    setLoadingDirectory(true);
    try {
      const [orgs, apps] = await Promise.all([
        onboardingService.listActiveOrganizationsForDiscovery(),
        onboardingService.getMyOrganizationApplications(),
      ]);
      setDiscoverableOrgs(orgs);
      setMyApplications(apps);
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to load clinics directory.'), 'error');
    } finally {
      setLoadingDirectory(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadDirectoryAndApplications();
  }, [loadDirectoryAndApplications]);

  useEffect(() => {
    if (profile?.email && !regForm.contact_email) {
      setRegForm((prev) => ({
        ...prev,
        contact_email: profile.email,
        phone: prev.phone || profile.phone || '',
      }));
    }
  }, [profile, regForm.contact_email]);

  const handleOpenWorkspace = (ws: WorkspaceOption) => {
    setActiveWorkspaceByKey(ws.key);
    navigate(ws.default_path);
  };

  const handleRequestJoin = async (org: Organization) => {
    setJoiningOrgId(org.id);
    try {
      await onboardingService.requestClinicJoin(org.id);
      await refreshContext();
      showToast(
        `Join request submitted to ${org.display_name}. Clinic approval is required before booking.`,
        'success'
      );
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to submit join request.'), 'error');
    } finally {
      setJoiningOrgId(null);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAppError('');
    const slug = regForm.proposed_slug.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/.test(slug)) {
      setAppError(
        'Organization URL slug must be 3-80 characters of lowercase letters, numbers, and hyphens (no leading/trailing hyphen).'
      );
      return;
    }

    setSubmittingApp(true);
    try {
      await onboardingService.submitOrganizationApplication({
        proposed_name: regForm.proposed_name,
        proposed_slug: slug,
        legal_name: regForm.legal_name || regForm.proposed_name,
        contact_email: regForm.contact_email,
        phone: regForm.phone,
        country: regForm.country,
        timezone: regForm.timezone,
        branch_name: regForm.branch_name,
        branch_code: regForm.branch_code,
        branch_address: regForm.branch_address,
        documents: regForm.license_ref.trim()
          ? [{ name: 'Clinic Registration Reference', type: 'license_ref', url: regForm.license_ref.trim() }]
          : [],
      });
      showToast(
        'Organization application submitted! Pending manual Platform Owner approval.',
        'success'
      );
      setShowRegisterModal(false);
      setRegForm((prev) => ({
        ...prev,
        proposed_name: '',
        proposed_slug: '',
        slugTouched: false,
        legal_name: '',
        branch_address: '',
        license_ref: '',
      }));
      await loadDirectoryAndApplications();
    } catch (err) {
      setAppError(formatSupabaseError(err, 'Failed to submit organization application.'));
    } finally {
      setSubmittingApp(false);
    }
  };

  const filteredOrgs = discoverableOrgs.filter((org) => {
    const q = orgSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      org.display_name.toLowerCase().includes(q) ||
      org.slug.toLowerCase().includes(q) ||
      org.country.toLowerCase().includes(q)
    );
  });

  const inactiveMemberships = memberships.filter(
    (m) => m.membership_status !== 'active' || m.organization_status !== 'active'
  );
  const nonApprovedClients = clinicClients.filter(
    (c) => c.client_status !== 'approved' || c.organization_status !== 'active'
  );

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <PageHeader
        title="My Workspaces & Clinic Onboarding"
        subtitle={`Signed in as ${profile?.full_name || user?.email || 'Authenticated User'} (${profile?.email || user?.email || ''})`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/accept-invite"
              className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-xl inline-flex items-center gap-1.5"
            >
              <Ticket className="w-3.5 h-3.5 text-teal-700" />
              Accept Staff Invite
            </Link>
            <button
              type="button"
              onClick={() => setShowRegisterModal(true)}
              className="px-4 py-2 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-xl inline-flex items-center gap-1.5 shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              Register Veterinary Clinic
            </button>
          </div>
        }
      />

      {/* Verified Active Workspaces */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900">
            Authorized Workspaces ({availableWorkspaces.length})
          </h2>
          <button
            type="button"
            onClick={() => {
              void refreshContext();
              void loadDirectoryAndApplications();
            }}
            className="text-xs font-semibold text-teal-700 hover:text-teal-800 inline-flex items-center gap-1"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh Access
          </button>
        </div>

        {availableWorkspaces.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center space-y-2">
            <Building2 className="w-8 h-8 text-slate-400 mx-auto" />
            <div className="text-sm font-bold text-slate-900">
              No Active Clinic Workspaces Yet
            </div>
            <p className="text-xs text-slate-600 max-w-lg mx-auto">
              Request to join an active veterinary clinic below as a pet owner, accept a staff invitation token, or submit a new clinic organization application for Platform Owner review.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {availableWorkspaces.map((ws) => {
              const Icon =
                ws.portal === 'platform'
                  ? ShieldCheck
                  : ws.portal === 'doctor'
                  ? Stethoscope
                  : ws.portal === 'admin'
                  ? Building2
                  : UserCheck;
              return (
                <button
                  key={ws.key}
                  type="button"
                  onClick={() => handleOpenWorkspace(ws)}
                  className="text-left bg-white rounded-2xl border border-slate-200 hover:border-teal-600 hover:shadow-md transition-all p-5 flex flex-col justify-between gap-4 group"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="w-10 h-10 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center border border-teal-100">
                        <Icon className="w-5 h-5" />
                      </div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-teal-100 text-teal-900">
                        {ws.portal === 'platform' ? 'Platform Owner' : ws.portal}
                      </span>
                    </div>
                    <div>
                      <div className="text-sm font-bold text-slate-900 group-hover:text-teal-800">
                        {ws.label}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">{ws.sublabel}</div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-slate-100 text-xs font-bold text-teal-700">
                    <span>Enter Workspace</span>
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Pending / Restricted Memberships & Join Requests */}
      {(inactiveMemberships.length > 0 || nonApprovedClients.length > 0) && (
        <section className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-600" />
            Pending & Restricted Clinic Access
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            {nonApprovedClients.map((cc) => (
              <div
                key={cc.clinic_client_id}
                className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between gap-3"
              >
                <div>
                  <div className="font-bold text-slate-900">{cc.organization_name}</div>
                  <div className="text-[11px] text-slate-500">
                    Pet Owner Join Request · Requested {new Date(cc.requested_at).toLocaleDateString()}
                  </div>
                </div>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                    cc.client_status === 'requested'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-rose-100 text-rose-800'
                  }`}
                >
                  {cc.client_status}
                </span>
              </div>
            ))}
            {inactiveMemberships.map((m) => (
              <div
                key={m.membership_id}
                className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between gap-3"
              >
                <div>
                  <div className="font-bold text-slate-900">{m.organization_name}</div>
                  <div className="text-[11px] text-slate-500">
                    Staff Membership · Org: {m.organization_status} · Member: {m.membership_status}
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-100 text-amber-800">
                  Restricted
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* My Submitted Organization Applications */}
      {myApplications.length > 0 && (
        <section className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900">
              My Organization Registration Applications
            </h2>
            {isPlatformAdmin && (
              <Link
                to="/platform/applications"
                className="text-xs font-bold text-teal-700 hover:underline"
              >
                Review Queue in Platform Console →
              </Link>
            )}
          </div>
          <div className="space-y-2.5">
            {myApplications.map((app) => (
              <div
                key={app.id}
                className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-900">
                      {app.proposed_name}
                    </span>
                    <span className="font-mono text-[11px] text-slate-500">
                      /{app.proposed_slug}
                    </span>
                  </div>
                  <div className="text-xs text-slate-600">
                    Initial Branch: {app.initial_branch_name} ({app.initial_branch_code}) · Submitted{' '}
                    {new Date(app.created_at).toLocaleDateString()}
                  </div>
                  {app.status === 'rejected' && app.decision_reason && (
                    <div className="text-xs text-rose-700 font-medium">
                      Rejection Reason: {app.decision_reason}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {app.status === 'pending' && (
                    <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 inline-flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      Pending Platform Approval
                    </span>
                  )}
                  {app.status === 'approved' && (
                    <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 inline-flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Approved & Active
                    </span>
                  )}
                  {app.status === 'rejected' && (
                    <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 inline-flex items-center gap-1">
                      <XCircle className="w-3.5 h-3.5" />
                      Rejected
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Client Onboarding: Discover & Join Active Veterinary Clinics */}
      <section className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              Join a Veterinary Clinic as a Pet Owner
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Client profiles and pet records remain strictly separated inside each veterinary organization.
            </p>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={orgSearch}
              onChange={(e) => setOrgSearch(e.target.value)}
              placeholder="Search active clinics..."
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>
        </div>

        {loadingDirectory ? (
          <div className="py-8 flex items-center justify-center gap-2 text-xs text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin text-teal-700" />
            <span>Loading active veterinary clinics...</span>
          </div>
        ) : filteredOrgs.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500">
            No active veterinary organizations match your search.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filteredOrgs.map((org) => {
              const existingClient = clinicClients.find(
                (cc) => cc.organization_id === org.id
              );
              const existingStaff = memberships.find(
                (m) => m.organization_id === org.id && m.membership_status === 'active'
              );
              return (
                <div
                  key={org.id}
                  className="p-4 rounded-xl border border-slate-200 hover:border-slate-300 bg-slate-50/40 flex items-center justify-between gap-3"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-900 truncate">
                        {org.display_name}
                      </span>
                      <span className="font-mono text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                        /{org.slug}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 flex items-center gap-2">
                      <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                      <span>
                        {org.country} · {org.timezone}
                      </span>
                    </div>
                  </div>

                  <div className="shrink-0">
                    {existingClient?.client_status === 'approved' ? (
                      <button
                        type="button"
                        onClick={() => navigate(`/${org.slug}/client/dashboard`)}
                        className="px-3 py-1.5 text-xs font-bold text-teal-800 bg-teal-50 border border-teal-200 hover:bg-teal-100 rounded-lg"
                      >
                        Open Portal
                      </button>
                    ) : existingClient?.client_status === 'requested' ? (
                      <span className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-amber-100 text-amber-800">
                        Pending Approval
                      </span>
                    ) : existingClient?.client_status === 'suspended' ? (
                      <span className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-rose-100 text-rose-800">
                        Suspended
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={joiningOrgId === org.id}
                        onClick={() => handleRequestJoin(org)}
                        className="px-3 py-1.5 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg inline-flex items-center gap-1"
                      >
                        {joiningOrgId === org.id && (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        )}
                        {existingClient?.client_status === 'rejected'
                          ? 'Re-request Join'
                          : existingStaff
                          ? 'Also Join as Client'
                          : 'Request to Join'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Register Organization Modal */}
      <Modal
        isOpen={showRegisterModal}
        onClose={() => setShowRegisterModal(false)}
        title="Register a Veterinary Organization"
        subtitle="New clinics remain pending until manually approved by the Platform Owner."
        maxWidth="xl"
      >
        <form onSubmit={handleRegisterSubmit} className="space-y-4">
          {appError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>{appError}</div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs">
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Clinic Display Name *
              </label>
              <input
                type="text"
                required
                value={regForm.proposed_name}
                onChange={(e) => {
                  const val = e.target.value;
                  setRegForm((prev) => ({
                    ...prev,
                    proposed_name: val,
                    proposed_slug: prev.slugTouched ? prev.proposed_slug : slugifyName(val),
                  }));
                }}
                placeholder="Oakridge Veterinary Hospital"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                URL Slug *
              </label>
              <input
                type="text"
                required
                value={regForm.proposed_slug}
                onChange={(e) =>
                  setRegForm((prev) => ({
                    ...prev,
                    proposed_slug: e.target.value.toLowerCase(),
                    slugTouched: true,
                  }))
                }
                placeholder="oakridge-vet"
                className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Legal Entity Name *
              </label>
              <input
                type="text"
                required
                value={regForm.legal_name}
                onChange={(e) => setRegForm({ ...regForm, legal_name: e.target.value })}
                placeholder="Oakridge Veterinary Care LLC"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Official Contact Email *
              </label>
              <input
                type="email"
                required
                value={regForm.contact_email}
                onChange={(e) => setRegForm({ ...regForm, contact_email: e.target.value })}
                placeholder="director@oakridgevet.com"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Clinic Phone *
              </label>
              <input
                type="tel"
                required
                value={regForm.phone}
                onChange={(e) => setRegForm({ ...regForm, phone: e.target.value })}
                placeholder="+1 (555) 234-5678"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Country *</label>
                <input
                  type="text"
                  required
                  value={regForm.country}
                  onChange={(e) => setRegForm({ ...regForm, country: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Timezone *</label>
                <input
                  type="text"
                  required
                  value={regForm.timezone}
                  onChange={(e) => setRegForm({ ...regForm, timezone: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Primary Branch Name *
              </label>
              <input
                type="text"
                required
                value={regForm.branch_name}
                onChange={(e) => setRegForm({ ...regForm, branch_name: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Primary Branch Code *
              </label>
              <input
                type="text"
                required
                value={regForm.branch_code}
                onChange={(e) =>
                  setRegForm({ ...regForm, branch_code: e.target.value.toUpperCase() })
                }
                placeholder="MAIN"
                className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block font-bold text-slate-700 mb-1">
                Primary Branch Address *
              </label>
              <input
                type="text"
                required
                value={regForm.branch_address}
                onChange={(e) => setRegForm({ ...regForm, branch_address: e.target.value })}
                placeholder="1200 Medical Parkway, Suite 200"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block font-bold text-slate-700 mb-1">
                Veterinary License / Accreditation Reference (Optional)
              </label>
              <input
                type="text"
                value={regForm.license_ref}
                onChange={(e) => setRegForm({ ...regForm, license_ref: e.target.value })}
                placeholder="State Veterinary Board Permit # or verification URL"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowRegisterModal(false)}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submittingApp}
              className="px-4 py-2 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-xl inline-flex items-center gap-1.5"
            >
              {submittingApp && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Submit Application for Review
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
