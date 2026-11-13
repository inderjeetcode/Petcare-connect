import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useApp } from '../../context/AppContext';
import { onboardingService } from '../../services/onboardingService';
import { formatSupabaseError } from '../../services/authService';
import { Organization } from '../../types/auth';
import { useClientWorkspace } from '../../hooks/useClientWorkspace';
import { PageHeader } from '../../components/common/PageHeader';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock,
  Loader2,
  MapPin,
  Search,
  ShieldCheck,
  XCircle,
} from 'lucide-react';

export const ClientOrganizations: React.FC = () => {
  const { clinicClients, availableWorkspaces, setActiveWorkspaceByKey, refreshContext } =
    useAuth();
  const { workspace } = useClientWorkspace();
  const { showToast } = useApp();
  const navigate = useNavigate();

  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joiningOrgId, setJoiningOrgId] = useState<string | null>(null);

  const loadOrgs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await onboardingService.listActiveOrganizationsForDiscovery();
      setOrgs(list);
    } catch (err) {
      setError(formatSupabaseError(err, 'Failed to load veterinary organizations.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOrgs();
  }, [loadOrgs]);

  const approvedClients = clinicClients.filter(
    (cc) => cc.client_status === 'approved' && cc.organization_status === 'active'
  );
  const pendingOrRejected = clinicClients.filter(
    (cc) => cc.client_status !== 'approved' || cc.organization_status !== 'active'
  );

  const handleSwitchClinic = (organizationId: string, slug: string) => {
    const ws = availableWorkspaces.find(
      (w) => w.portal === 'client' && w.organization_id === organizationId
    );
    if (ws) {
      setActiveWorkspaceByKey(ws.key);
    }
    navigate(`/${slug}/client/dashboard`);
  };

  const handleRequestJoin = async (org: Organization) => {
    setJoiningOrgId(org.id);
    try {
      await onboardingService.requestClinicJoin(org.id);
      await refreshContext();
      showToast(
        `Join request sent to ${org.display_name}. Pending clinic approval.`,
        'success'
      );
    } catch (err) {
      showToast(formatSupabaseError(err, 'Unable to submit join request.'), 'error');
    } finally {
      setJoiningOrgId(null);
    }
  };

  const filteredOrgs = orgs.filter((o) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      o.display_name.toLowerCase().includes(q) ||
      o.slug.toLowerCase().includes(q) ||
      o.country.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clinics & Organization Access"
        subtitle="Switch between approved clinics, monitor join requests, or request membership at another veterinary clinic. Pet and medical data never cross organization boundaries."
      />

      {/* Tenant Isolation Notice */}
      <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 text-xs text-teal-900 flex items-start gap-2.5">
        <ShieldCheck className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
        <div>
          <strong>Strict Organization Isolation:</strong> Each clinic maintains independent client directories, pet profiles, appointments, prescriptions, and clinical history. Switching clinics changes your active workspace cleanly without exposing records from any other clinic.
        </div>
      </div>

      {/* Approved Client Memberships */}
      <section className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-3">
        <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          Approved Clinic Memberships ({approvedClients.length})
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {approvedClients.map((cc) => {
            const isCurrent = workspace?.organizationId === cc.organization_id;
            return (
              <div
                key={cc.clinic_client_id}
                className={`p-4 rounded-xl border flex items-center justify-between gap-3 ${
                  isCurrent
                    ? 'border-teal-600 bg-teal-50/40'
                    : 'border-slate-200 bg-slate-50/40'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-900 truncate">
                      {cc.organization_name}
                    </span>
                    {isCurrent && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-teal-700 text-white uppercase">
                        Active
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    /{cc.organization_slug} · Approved{' '}
                    {cc.approved_at
                      ? new Date(cc.approved_at).toLocaleDateString()
                      : 'Active'}
                  </div>
                </div>
                {isCurrent ? (
                  <span className="text-xs font-semibold text-teal-800 shrink-0">
                    Current Clinic
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      handleSwitchClinic(cc.organization_id, cc.organization_slug)
                    }
                    className="px-3 py-1.5 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-lg inline-flex items-center gap-1 shrink-0"
                  >
                    Switch <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Pending / Restricted Requests */}
      {pendingOrRejected.length > 0 && (
        <section className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-3">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-600" />
            Pending & Previous Join Requests ({pendingOrRejected.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            {pendingOrRejected.map((cc) => (
              <div
                key={cc.clinic_client_id}
                className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between gap-3"
              >
                <div>
                  <div className="font-bold text-slate-900">{cc.organization_name}</div>
                  <div className="text-[11px] text-slate-500">
                    Requested {new Date(cc.requested_at).toLocaleDateString()}
                  </div>
                </div>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase inline-flex items-center gap-1 ${
                    cc.client_status === 'requested'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-rose-100 text-rose-800'
                  }`}
                >
                  {cc.client_status === 'requested' ? (
                    <Clock className="w-3 h-3" />
                  ) : (
                    <XCircle className="w-3 h-3" />
                  )}
                  {cc.client_status}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Discover Available Organizations */}
      <section className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Building2 className="w-4 h-4 text-teal-700" />
              Available Veterinary Clinics
            </h2>
            <p className="text-xs text-slate-500">
              Request access to join additional clinics using your single global identity.
            </p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search clinics by name or region..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
            />
          </div>
        </div>

        {loading ? (
          <LoadingSpinner size="md" message="Loading active veterinary organizations..." />
        ) : error ? (
          <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800">
            {error}
          </div>
        ) : filteredOrgs.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500">
            No active veterinary organizations match your filter.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filteredOrgs.map((org) => {
              const existing = clinicClients.find(
                (cc) => cc.organization_id === org.id
              );
              return (
                <div
                  key={org.id}
                  className="p-4 rounded-xl border border-slate-200 bg-slate-50/40 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-900 truncate">
                        {org.display_name}
                      </span>
                      <span className="font-mono text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                        /{org.slug}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                      <MapPin className="w-3 h-3 text-slate-400" />
                      <span>
                        {org.country} · {org.timezone}
                      </span>
                    </div>
                  </div>
                  <div className="shrink-0">
                    {existing?.client_status === 'approved' ? (
                      <button
                        type="button"
                        onClick={() => handleSwitchClinic(org.id, org.slug)}
                        className="px-3 py-1.5 text-xs font-bold text-teal-800 bg-teal-50 border border-teal-200 hover:bg-teal-100 rounded-lg"
                      >
                        Open Clinic
                      </button>
                    ) : existing?.client_status === 'requested' ? (
                      <span className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-amber-100 text-amber-800">
                        Pending Approval
                      </span>
                    ) : existing?.client_status === 'suspended' ? (
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
                        {existing?.client_status === 'rejected'
                          ? 'Re-request Join'
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
    </div>
  );
};
