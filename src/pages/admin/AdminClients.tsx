import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../../components/common/PageHeader';
import { Modal } from '../../components/common/Modal';
import { Pagination } from '../../components/common/Pagination';
import { useAdminWorkspace } from '../../hooks/useAdminWorkspace';
import { useApp } from '../../context/AppContext';
import { onboardingService } from '../../services/onboardingService';
import { adminPortalService } from '../../services/adminPortalService';
import { formatSupabaseError } from '../../services/authService';
import { ClinicClientRecord } from '../../types/auth';
import { AdminPetDirectoryItem } from '../../types/admin';
import {
  compareIsoDates,
  compareStrings,
  isWithinDateRange,
  paginateItems,
  sortItems,
} from '../../utils/listManagementHelpers';
import {
  Ban,
  CheckCircle2,
  Eye,
  Loader2,
  PawPrint,
  Plus,
  RefreshCw,
  Search,
  Users,
  XCircle,
} from 'lucide-react';

export const AdminClients: React.FC = () => {
  const { workspace } = useAdminWorkspace();
  const { showToast } = useApp();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [clients, setClients] = useState<ClinicClientRecord[]>([]);
  const [pets, setPets] = useState<AdminPetDirectoryItem[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'requested' | 'approved' | 'rejected' | 'suspended'
  >('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'name' | 'status'>('date');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [selectedClient, setSelectedClient] = useState<ClinicClientRecord | null>(null);
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [walkInForm, setWalkInForm] = useState({ full_name: '', phone: '', email: '' });
  const [actionTarget, setActionTarget] = useState<{
    client: ClinicClientRecord;
    mode: 'reject' | 'suspend';
  } | null>(null);
  const [reason, setReason] = useState('');

  const loadData = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    try {
      const [cList, pList] = await Promise.all([
        onboardingService.getOrgClinicClients(workspace.organizationId),
        workspace.canReadPets
          ? adminPortalService.getOrgPetsDirectory(workspace.organizationId, false).catch(() => [])
          : Promise.resolve([]),
      ]);
      setClients(cList);
      setPets(pList);
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to load clinic clients.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [workspace, showToast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, fromDate, toDate, sortBy, sortOrder]);

  const getClientPets = useCallback(
    (clientId: string) =>
      pets.filter((pet) => pet.guardians.some((g) => g.clinic_client_id === clientId)),
    [pets]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = clients.filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (!isWithinDateRange(c.approved_at || c.requested_at, fromDate, toDate)) return false;
      if (!q) return true;
      return (
        c.full_name.toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        (c.phone || '').toLowerCase().includes(q)
      );
    });
    return sortItems(
      list,
      (a, b) => {
        if (sortBy === 'name') return compareStrings(a.full_name, b.full_name);
        if (sortBy === 'status') return compareStrings(a.status, b.status);
        return compareIsoDates(a.approved_at || a.requested_at, b.approved_at || b.requested_at);
      },
      sortOrder
    );
  }, [clients, statusFilter, fromDate, toDate, search, sortBy, sortOrder]);

  const paginatedClients = useMemo(
    () => paginateItems(filtered, page, pageSize),
    [filtered, page, pageSize]
  );

  if (!workspace) return null;

  const handleApprove = async (cc: ClinicClientRecord) => {
    setSubmitting(true);
    try {
      await onboardingService.approveClinicClient(cc.id);
      showToast(`Approved client ${cc.full_name}.`, 'success');
      await loadData();
    } catch (err) {
      showToast(formatSupabaseError(err, 'Unable to approve client.'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReactivate = async (cc: ClinicClientRecord) => {
    setSubmitting(true);
    try {
      await adminPortalService.reactivateClinicClient(cc.id);
      showToast(`Reactivated client ${cc.full_name}.`, 'success');
      await loadData();
    } catch (err) {
      showToast(formatSupabaseError(err, 'Unable to reactivate client.'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReasonAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actionTarget || !reason.trim()) return;
    setSubmitting(true);
    try {
      if (actionTarget.mode === 'reject') {
        await onboardingService.rejectClinicClient(actionTarget.client.id, reason.trim());
        showToast(`Declined join request from ${actionTarget.client.full_name}.`, 'info');
      } else {
        await adminPortalService.suspendClinicClient(actionTarget.client.id, reason.trim());
        showToast(`Suspended client ${actionTarget.client.full_name}.`, 'warning');
      }
      setActionTarget(null);
      setReason('');
      await loadData();
    } catch (err) {
      showToast(formatSupabaseError(err, 'Action failed.'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateWalkIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!walkInForm.full_name.trim() || !walkInForm.phone.trim()) return;
    setSubmitting(true);
    try {
      await onboardingService.createWalkInClient(
        workspace.organizationId,
        walkInForm.full_name.trim(),
        walkInForm.phone.trim(),
        walkInForm.email.trim() || undefined
      );
      showToast(`Registered walk-in client ${walkInForm.full_name.trim()}.`, 'success');
      setWalkInOpen(false);
      setWalkInForm({ full_name: '', phone: '', email: '' });
      await loadData();
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to register walk-in client.'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const selectedClientPets = selectedClient ? getClientPets(selectedClient.id) : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clinic Client Management"
        subtitle="Manage organization-scoped client profiles, approve join requests, register walk-in owners, and review associated pets."
        action={
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => void loadData()}
              disabled={loading}
              className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            {workspace.canApproveClients && (
              <button
                type="button"
                onClick={() => setWalkInOpen(true)}
                className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Plus className="w-4 h-4" />
                Register Walk-In Client
              </button>
            )}
          </div>
        }
      />

      {/* Search & Status Filters */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="relative w-full lg:w-88">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search clients by name, email, or phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              aria-label="Joined from date"
              className="px-2.5 py-2 text-xs border border-slate-200 rounded-lg bg-white"
            />
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              aria-label="Joined to date"
              className="px-2.5 py-2 text-xs border border-slate-200 rounded-lg bg-white"
            />
            <select
              value={`${sortBy}:${sortOrder}`}
              onChange={(e) => {
                const [by, dir] = e.target.value.split(':') as ['date' | 'name' | 'status', 'asc' | 'desc'];
                setSortBy(by);
                setSortOrder(dir);
              }}
              aria-label="Sort clients"
              className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
            >
              <option value="date:desc">Newest Joined</option>
              <option value="date:asc">Oldest Joined</option>
              <option value="name:asc">Name (A–Z)</option>
              <option value="name:desc">Name (Z–A)</option>
              <option value="status:asc">Status</option>
            </select>
            {(search || statusFilter !== 'all' || fromDate || toDate) && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setStatusFilter('all');
                  setFromDate('');
                  setToDate('');
                }}
                className="px-2.5 py-2 text-xs font-semibold text-teal-800 bg-teal-50 hover:bg-teal-100 rounded-lg"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto w-fit max-w-full">
          {(['all', 'requested', 'approved', 'suspended', 'rejected'] as const).map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter(status)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                statusFilter === status
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {status === 'all'
                ? `All (${clients.length})`
                : `${status.charAt(0).toUpperCase() + status.slice(1)} (${
                    clients.filter((c) => c.status === status).length
                  })`}
            </button>
          ))}
        </div>
      </div>

      {/* Clients Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-10 text-center">
            <Loader2 className="w-6 h-6 text-teal-700 animate-spin mx-auto mb-2" />
            <p className="text-xs text-slate-500">Loading clinic client directory...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <Users className="w-8 h-8 text-slate-400 mx-auto" />
            <div className="text-sm font-bold text-slate-900">No Matching Clients</div>
            <p className="text-xs text-slate-500">
              No client memberships match the current filter inside {workspace.organizationName}.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
              <tr>
                <th className="py-3 px-4">Client</th>
                <th className="py-3 px-4">Contact</th>
                <th className="py-3 px-4">Origin</th>
                <th className="py-3 px-4">Pets</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Requested / Joined</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedClients.items.map((client) => {
                const clientPets = getClientPets(client.id);
                return (
                  <tr key={client.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-900">{client.full_name}</div>
                      <div className="text-[11px] font-mono text-slate-400">
                        {client.user_id ? 'Registered Account' : 'Walk-In Profile'}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      <div>{client.email || '—'}</div>
                      <div className="text-[11px] text-slate-400">{client.phone || 'No phone'}</div>
                    </td>
                    <td className="py-3 px-4 text-slate-600 capitalize">{client.source}</td>
                    <td className="py-3 px-4 text-slate-700 tabular-nums">
                      {clientPets.length > 0 ? (
                        <span className="inline-flex items-center gap-1 font-medium">
                          <PawPrint className="w-3.5 h-3.5 text-teal-700" />
                          {clientPets.length} ({clientPets.map((p) => p.name).join(', ')})
                        </span>
                      ) : (
                        <span className="text-slate-400">0 pets</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`font-semibold capitalize ${
                          client.status === 'approved'
                            ? 'text-emerald-700'
                            : client.status === 'requested'
                            ? 'text-amber-700'
                            : 'text-rose-700'
                        }`}
                      >
                        {client.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-500 font-mono tabular-nums">
                      {new Date(client.approved_at || client.requested_at).toLocaleDateString()}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5 justify-end">
                        <button
                          onClick={() => setSelectedClient(client)}
                          className="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          Profile
                        </button>

                        {workspace.canApproveClients && client.status === 'requested' && (
                          <>
                            <button
                              disabled={submitting}
                              onClick={() => void handleApprove(client)}
                              className="px-2.5 py-1 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Approve
                            </button>
                            <button
                              disabled={submitting}
                              onClick={() => {
                                setActionTarget({ client, mode: 'reject' });
                                setReason('');
                              }}
                              className="px-2.5 py-1 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 rounded-lg inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              Reject
                            </button>
                          </>
                        )}

                        {workspace.canApproveClients && client.status === 'approved' && (
                          <button
                            disabled={submitting}
                            onClick={() => {
                              setActionTarget({ client, mode: 'suspend' });
                              setReason('');
                            }}
                            className="px-2.5 py-1 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 rounded-lg inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                          >
                            <Ban className="w-3.5 h-3.5" />
                            Suspend
                          </button>
                        )}

                        {workspace.canApproveClients &&
                          (client.status === 'suspended' || client.status === 'rejected') && (
                            <button
                              disabled={submitting}
                              onClick={() => void handleReactivate(client)}
                              className="px-2.5 py-1 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg whitespace-nowrap shrink-0"
                            >
                              Reactivate
                            </button>
                          )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pagination
            currentPage={paginatedClients.currentPage}
            totalPages={paginatedClients.totalPages}
            totalItems={paginatedClients.totalItems}
            startIndex={paginatedClients.startIndex}
            endIndex={paginatedClients.endIndex}
            pageSize={paginatedClients.pageSize}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
            itemLabel="clients"
          />
          </div>
        )}
      </div>

      {/* Client Profile Details Modal */}
      <Modal
        isOpen={Boolean(selectedClient)}
        onClose={() => setSelectedClient(null)}
        title={selectedClient?.full_name || 'Client Profile'}
        subtitle={`Clinic Membership Status: ${selectedClient?.status || ''}`}
        maxWidth="lg"
      >
        {selectedClient && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
              <div>
                <div className="text-slate-500">Email</div>
                <div className="font-semibold text-slate-900 mt-0.5">
                  {selectedClient.email || 'Not provided'}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Phone</div>
                <div className="font-semibold text-slate-900 mt-0.5">
                  {selectedClient.phone || 'Not provided'}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Onboarding Source</div>
                <div className="font-semibold text-slate-900 mt-0.5 capitalize">
                  {selectedClient.source}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Requested / Approved</div>
                <div className="font-mono text-slate-900 mt-0.5">
                  {new Date(selectedClient.requested_at).toLocaleDateString()}
                  {selectedClient.approved_at
                    ? ` · Approved ${new Date(selectedClient.approved_at).toLocaleDateString()}`
                    : ''}
                </div>
              </div>
            </div>

            {selectedClient.rejection_reason && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800">
                <strong>Note / Reason:</strong> {selectedClient.rejection_reason}
              </div>
            )}

            <div>
              <h4 className="font-bold text-slate-900 mb-2">
                Registered Organization Pets ({selectedClientPets.length})
              </h4>
              {selectedClientPets.length === 0 ? (
                <p className="text-slate-500">No pets linked to this client in {workspace.organizationName}.</p>
              ) : (
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
                  {selectedClientPets.map((pet) => (
                    <div key={pet.id} className="p-3 flex items-center justify-between gap-2">
                      <div>
                        <div className="font-bold text-slate-900">
                          {pet.name} · {pet.species}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {pet.breed} · {pet.gender} · {pet.weight} kg
                        </div>
                      </div>
                      <span className="font-mono text-[11px] text-slate-600 tabular-nums">
                        {pet.appointment_count} appts
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Register Walk-In Modal */}
      <Modal
        isOpen={walkInOpen}
        onClose={() => setWalkInOpen(false)}
        title="Register Walk-In Clinic Client"
        subtitle="Creates an approved organization-specific client record for in-person owners."
        maxWidth="md"
      >
        <form onSubmit={handleCreateWalkIn} className="space-y-3.5 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Full Name *</label>
            <input
              type="text"
              required
              value={walkInForm.full_name}
              onChange={(e) => setWalkInForm({ ...walkInForm, full_name: e.target.value })}
              placeholder="Client full name"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Phone Number *</label>
            <input
              type="tel"
              required
              value={walkInForm.phone}
              onChange={(e) => setWalkInForm({ ...walkInForm, phone: e.target.value })}
              placeholder="+1 555 000 0000"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Email (Optional)</label>
            <input
              type="email"
              value={walkInForm.email}
              onChange={(e) => setWalkInForm({ ...walkInForm, email: e.target.value })}
              placeholder="client@example.com"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setWalkInOpen(false)}
              className="px-4 py-2 font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg inline-flex items-center gap-1.5"
            >
              {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Create Client
            </button>
          </div>
        </form>
      </Modal>

      {/* Reject / Suspend Client Reason Modal */}
      <Modal
        isOpen={Boolean(actionTarget)}
        onClose={() => setActionTarget(null)}
        title={
          actionTarget?.mode === 'reject'
            ? `Reject Request — ${actionTarget.client.full_name}`
            : `Suspend Client — ${actionTarget?.client.full_name || ''}`
        }
        maxWidth="md"
      >
        <form onSubmit={handleReasonAction} className="space-y-4 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Reason *</label>
            <textarea
              required
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Provide reason recorded in audit log..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setActionTarget(null)}
              className="px-4 py-2 font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 font-semibold text-white bg-rose-700 hover:bg-rose-800 rounded-lg inline-flex items-center gap-1.5"
            >
              {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {actionTarget?.mode === 'reject' ? 'Confirm Rejection' : 'Suspend Client'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
