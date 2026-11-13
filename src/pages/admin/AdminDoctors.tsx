import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/common/PageHeader';
import { Modal } from '../../components/common/Modal';
import { Pagination } from '../../components/common/Pagination';
import { useAdminWorkspace } from '../../hooks/useAdminWorkspace';
import { useApp } from '../../context/AppContext';
import { onboardingService } from '../../services/onboardingService';
import { adminPortalService } from '../../services/adminPortalService';
import { formatSupabaseError } from '../../services/authService';
import { Branch, DoctorGovernanceRecord } from '../../types/auth';
import { AdminDoctorAvailabilityView } from '../../types/admin';
import { groupSchedulesByBranchAndDay } from '../../utils/adminPortalHelpers';
import { ISO_WEEKDAYS } from '../../utils/doctorPortalHelpers';
import {
  compareStrings,
  paginateItems,
  sortItems,
} from '../../utils/listManagementHelpers';
import {
  Building2,
  CalendarClock,
  CheckCircle2,
  Copy,
  Edit2,
  Loader2,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  Stethoscope,
  XCircle,
} from 'lucide-react';

export const AdminDoctors: React.FC = () => {
  const { workspace, adminBasePath } = useAdminWorkspace();
  const { showToast } = useApp();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [doctors, setDoctors] = useState<DoctorGovernanceRecord[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [branchFilter, setBranchFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'name' | 'fee' | 'experience'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Edit doctor governance + clinical details modal
  const [editDoc, setEditDoc] = useState<DoctorGovernanceRecord | null>(null);
  const [editForm, setEditForm] = useState({
    display_name: '',
    qualification: '',
    specialization: '',
    experience_years: 0,
    registration_number: '',
    bio: '',
    consultation_fee: 0,
    is_active: true,
  });

  // Invite doctor modal
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteBranchIds, setInviteBranchIds] = useState<string[]>([]);
  const [inviteTokenResult, setInviteTokenResult] = useState<{
    token: string;
    email: string;
    expires_at: string;
  } | null>(null);

  // Availability visibility modal
  const [availDoc, setAvailDoc] = useState<DoctorGovernanceRecord | null>(null);
  const [availLoading, setAvailLoading] = useState(false);
  const [availability, setAvailability] = useState<AdminDoctorAvailabilityView | null>(null);

  const loadAll = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    try {
      const [dList, bList] = await Promise.all([
        onboardingService.getOrgDoctors(workspace.organizationId),
        onboardingService.getOrgBranches(workspace.organizationId),
      ]);
      setDoctors(dList);
      setBranches(bList);
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to load doctors roster.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [workspace, showToast]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, branchFilter, sortBy, sortOrder]);

  const branchNameMap = useMemo(
    () => new Map(branches.map((b) => [b.id, b.name])),
    [branches]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = doctors.filter((doc) => {
      if (statusFilter === 'active' && !doc.is_active) return false;
      if (statusFilter === 'inactive' && doc.is_active) return false;
      if (branchFilter !== 'all' && !doc.branch_ids.includes(branchFilter)) return false;

      if (!q) return true;
      return (
        (doc.full_name || '').toLowerCase().includes(q) ||
        doc.specialization.toLowerCase().includes(q) ||
        doc.qualification.toLowerCase().includes(q) ||
        (doc.email || '').toLowerCase().includes(q)
      );
    });
    return sortItems(
      list,
      (a, b) => {
        if (sortBy === 'fee') return Number(a.consultation_fee || 0) - Number(b.consultation_fee || 0);
        if (sortBy === 'experience') return Number(a.experience_years || 0) - Number(b.experience_years || 0);
        return compareStrings(a.full_name, b.full_name);
      },
      sortOrder
    );
  }, [doctors, statusFilter, branchFilter, search, sortBy, sortOrder]);

  const paginatedDoctors = useMemo(
    () => paginateItems(filtered, page, pageSize),
    [filtered, page, pageSize]
  );

  if (!workspace) return null;

  const openEditModal = (doc: DoctorGovernanceRecord) => {
    setEditDoc(doc);
    setEditForm({
      display_name: doc.display_name || doc.full_name || '',
      qualification: doc.qualification || '',
      specialization: doc.specialization || '',
      experience_years: Number(doc.experience_years || 0),
      registration_number: doc.registration_number || '',
      bio: doc.bio || '',
      consultation_fee: Number(doc.consultation_fee || 0),
      is_active: doc.is_active,
    });
  };

  const handleSaveDoctorGovernance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editDoc) return;
    setSubmitting(true);
    try {
      await adminPortalService.updateDoctorProfileAndGovernance({
        doctor_profile_id: editDoc.id,
        display_name: editForm.display_name.trim() || null,
        qualification: editForm.qualification.trim() || null,
        specialization: editForm.specialization.trim() || null,
        experience_years: Number(editForm.experience_years) || 0,
        registration_number: editForm.registration_number.trim() || null,
        bio: editForm.bio,
        consultation_fee: Number(editForm.consultation_fee) || 0,
        is_active: editForm.is_active,
      });
      showToast(`Updated practitioner governance for ${editForm.display_name || editDoc.full_name}.`, 'success');
      setEditDoc(null);
      await loadAll();
    } catch (err) {
      showToast(formatSupabaseError(err, 'Unable to update doctor record.'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (doc: DoctorGovernanceRecord) => {
    setSubmitting(true);
    try {
      await adminPortalService.updateDoctorProfileAndGovernance({
        doctor_profile_id: doc.id,
        is_active: !doc.is_active,
      });
      showToast(
        `${doc.full_name} marked ${doc.is_active ? 'inactive' : 'active'}.`,
        doc.is_active ? 'warning' : 'success'
      );
      await loadAll();
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to toggle doctor status.'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleBranchAssignment = async (
    doc: DoctorGovernanceRecord,
    branchId: string
  ) => {
    const currentlyAssigned = doc.branch_ids.includes(branchId);
    setSubmitting(true);
    try {
      await onboardingService.assignDoctorToBranch(
        workspace.organizationId,
        doc.id,
        branchId,
        !currentlyAssigned
      );
      showToast(
        `${!currentlyAssigned ? 'Assigned' : 'Removed'} ${doc.full_name} ${
          !currentlyAssigned ? 'to' : 'from'
        } ${branchNameMap.get(branchId) || 'branch'}.`,
        'success'
      );
      await loadAll();
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to update branch assignment.'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleInviteDoctor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setSubmitting(true);
    try {
      const res = await onboardingService.inviteMember({
        organization_id: workspace.organizationId,
        email: inviteEmail.trim(),
        role_codes: ['doctor'],
        branch_ids: inviteBranchIds,
      });
      setInviteTokenResult({
        token: res.token,
        email: inviteEmail.trim(),
        expires_at: res.expires_at,
      });
      setInviteOpen(false);
      setInviteEmail('');
      setInviteBranchIds([]);
      showToast(`Doctor invitation created for ${inviteEmail.trim()}.`, 'success');
    } catch (err) {
      showToast(formatSupabaseError(err, 'Unable to invite doctor.'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const openAvailabilityModal = async (doc: DoctorGovernanceRecord) => {
    setAvailDoc(doc);
    setAvailability(null);
    setAvailLoading(true);
    try {
      const data = await adminPortalService.getDoctorAvailability(
        workspace.organizationId,
        doc.id
      );
      setAvailability(data);
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to load doctor availability.'), 'error');
    } finally {
      setAvailLoading(false);
    }
  };

  const groupedAvail = availability
    ? groupSchedulesByBranchAndDay(availability.schedules)
    : {};

  return (
    <div className="space-y-6">
      <PageHeader
        title="Veterinary Doctor Management"
        subtitle="Manage doctor onboarding invitations, clinical credentials, multi-branch assignments, active status, and branch availability."
        action={
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => void loadAll()}
              disabled={loading}
              className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            {workspace.canManageStaff && (
              <button
                type="button"
                onClick={() => setInviteOpen(true)}
                className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Plus className="w-4 h-4" />
                Invite Doctor
              </button>
            )}
          </div>
        }
      />

      {inviteTokenResult && (
        <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 text-xs text-teal-900 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <strong className="font-bold">
              Doctor Invitation Ready for {inviteTokenResult.email}
            </strong>
            <button
              onClick={() => setInviteTokenResult(null)}
              className="text-teal-700 hover:underline font-semibold"
            >
              Dismiss
            </button>
          </div>
          <p>
            Share this single-use token so the veterinarian can accept it on{' '}
            <code className="font-mono bg-white px-1 py-0.5 rounded">/accept-invite</code> (expires{' '}
            {new Date(inviteTokenResult.expires_at).toLocaleString()}).
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 font-mono bg-white border border-teal-200 px-3 py-2 rounded-lg select-all break-all">
              {inviteTokenResult.token}
            </code>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(inviteTokenResult.token);
                showToast('Invitation token copied to clipboard.', 'success');
              }}
              className="px-3 py-2 bg-teal-700 text-white font-semibold rounded-lg inline-flex items-center gap-1 shrink-0"
            >
              <Copy className="w-3.5 h-3.5" />
              Copy
            </button>
          </div>
        </div>
      )}

      {/* Search & Status Filters */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="relative w-full lg:w-96">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search doctors by name, qualification, or specialization..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              aria-label="Filter doctors by branch"
              className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
            >
              <option value="all">All Branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.code})
                </option>
              ))}
            </select>
            <select
              value={`${sortBy}:${sortOrder}`}
              onChange={(e) => {
                const [by, dir] = e.target.value.split(':') as ['name' | 'fee' | 'experience', 'asc' | 'desc'];
                setSortBy(by);
                setSortOrder(dir);
              }}
              aria-label="Sort doctors"
              className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
            >
              <option value="name:asc">Name (A–Z)</option>
              <option value="name:desc">Name (Z–A)</option>
              <option value="experience:desc">Most Experienced</option>
              <option value="fee:desc">Fee (High–Low)</option>
              <option value="fee:asc">Fee (Low–High)</option>
            </select>
            {(search || statusFilter !== 'all' || branchFilter !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setStatusFilter('all');
                  setBranchFilter('all');
                }}
                className="px-2.5 py-2 text-xs font-semibold text-teal-800 bg-teal-50 hover:bg-teal-100 rounded-lg"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start w-fit">
          {(['all', 'active', 'inactive'] as const).map((status) => (
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
                ? `All (${doctors.length})`
                : status === 'active'
                ? `Active (${doctors.filter((d) => d.is_active).length})`
                : `Inactive (${doctors.filter((d) => !d.is_active).length})`}
            </button>
          ))}
        </div>
      </div>

      {/* Doctor Roster */}
      {loading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
          <Loader2 className="w-6 h-6 text-teal-700 animate-spin mx-auto mb-2" />
          <p className="text-xs text-slate-500">Loading veterinary practitioners...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center space-y-3">
          <Stethoscope className="w-8 h-8 text-slate-400 mx-auto" />
          <div className="text-sm font-bold text-slate-900">No Matching Doctors Found</div>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Invite licensed veterinarians via staff invitation or clear the current search filter.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {paginatedDoctors.items.map((doc) => (
            <div
              key={doc.id}
              className="bg-white rounded-xl border border-slate-200 p-5 space-y-4"
            >
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-bold text-slate-900">
                      {doc.full_name}
                    </h3>
                    <span
                      className={`text-xs font-semibold inline-flex items-center gap-1 ${
                        doc.is_active ? 'text-emerald-700' : 'text-rose-700'
                      }`}
                    >
                      {doc.is_active ? (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5" />
                      )}
                      {doc.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div className="text-xs text-slate-600 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span>{doc.specialization || 'General Veterinary Medicine'}</span>
                    <span aria-hidden="true">·</span>
                    <span>{doc.qualification || 'BVSc'}</span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">{doc.experience_years} yrs exp</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono font-semibold text-slate-900 tabular-nums">
                      Fee: ${doc.consultation_fee}
                    </span>
                    {doc.registration_number && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">Reg #{doc.registration_number}</span>
                      </>
                    )}
                  </div>
                  {doc.email && (
                    <div className="text-xs text-slate-500">
                      {doc.email}
                      {doc.phone ? ` · ${doc.phone}` : ''}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => void openAvailabilityModal(doc)}
                    className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    <CalendarClock className="w-3.5 h-3.5 text-teal-700" />
                    Availability
                  </button>
                  {workspace.canManageStaff && (
                    <>
                      <button
                        onClick={() => openEditModal(doc)}
                        className="px-3 py-1.5 text-xs font-semibold text-teal-700 bg-teal-50 border border-teal-200 hover:bg-teal-100 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        Manage Profile & Fee
                      </button>
                      <button
                        onClick={() => void handleToggleActive(doc)}
                        disabled={submitting}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg border whitespace-nowrap shrink-0 ${
                          doc.is_active
                            ? 'text-rose-700 border-rose-200 hover:bg-rose-50'
                            : 'text-emerald-700 border-emerald-200 hover:bg-emerald-50'
                        }`}
                      >
                        {doc.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Multi-Branch Assignment Matrix */}
              <div className="pt-3 border-t border-slate-100">
                <div className="text-[11px] font-semibold text-slate-500 mb-2 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-teal-700" />
                  Assigned Clinic Branches ({doc.branch_ids.length} active)
                </div>
                {branches.length === 0 ? (
                  <span className="text-xs text-slate-500">
                    No branches available.
                    {(workspace.canManageBranches || workspace.canManageSchedules) && (
                      <>
                        {' '}
                        <button
                          type="button"
                          onClick={() => navigate(`${adminBasePath}/branches`)}
                          className="text-teal-700 underline font-semibold"
                        >
                          Configure branches
                        </button>
                      </>
                    )}
                  </span>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {branches.map((branch) => {
                      const assigned = doc.branch_ids.includes(branch.id);
                      return (
                        <button
                          key={branch.id}
                          type="button"
                          disabled={!workspace.canManageStaff || submitting}
                          onClick={() => void handleToggleBranchAssignment(doc, branch.id)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
                            assigned
                              ? 'bg-teal-700 text-white border-teal-700'
                              : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                          } disabled:opacity-60`}
                        >
                          <Building2 className="w-3 h-3 inline mr-1.5" />
                          {branch.name} ({branch.code})
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <Pagination
              currentPage={paginatedDoctors.currentPage}
              totalPages={paginatedDoctors.totalPages}
              totalItems={paginatedDoctors.totalItems}
              startIndex={paginatedDoctors.startIndex}
              endIndex={paginatedDoctors.endIndex}
              pageSize={paginatedDoctors.pageSize}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
              itemLabel="doctors"
            />
          </div>
        </div>
      )}

      {/* Invite Doctor Modal */}
      <Modal
        isOpen={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite Veterinary Doctor"
        subtitle="Generates a single-use staff invitation with the doctor role and selected branch assignments."
        maxWidth="md"
      >
        <form onSubmit={handleInviteDoctor} className="space-y-4 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Doctor Email *</label>
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="veterinarian@clinic.org"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1.5">
              Initial Branch Access (optional)
            </label>
            <div className="flex flex-wrap gap-2">
              {branches.map((b) => {
                const checked = inviteBranchIds.includes(b.id);
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() =>
                      setInviteBranchIds((prev) =>
                        checked ? prev.filter((id) => id !== b.id) : [...prev, b.id]
                      )
                    }
                    className={`px-3 py-1.5 rounded-lg border text-xs font-medium whitespace-nowrap shrink-0 ${
                      checked
                        ? 'bg-teal-700 text-white border-teal-700'
                        : 'bg-slate-50 text-slate-700 border-slate-200'
                    }`}
                  >
                    {b.name} ({b.code})
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setInviteOpen(false)}
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
              Create Doctor Invite
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Doctor Governance & Profile Modal */}
      <Modal
        isOpen={Boolean(editDoc)}
        onClose={() => setEditDoc(null)}
        title={`Manage Doctor: ${editDoc?.full_name || ''}`}
        subtitle="Update practitioner credentials, clinical status, and organization consultation fee."
        maxWidth="lg"
      >
        <form onSubmit={handleSaveDoctorGovernance} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Display Name *</label>
              <input
                type="text"
                required
                value={editForm.display_name}
                onChange={(e) => setEditForm({ ...editForm, display_name: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Qualification *</label>
              <input
                type="text"
                required
                value={editForm.qualification}
                onChange={(e) => setEditForm({ ...editForm, qualification: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Specialization *</label>
              <input
                type="text"
                required
                value={editForm.specialization}
                onChange={(e) => setEditForm({ ...editForm, specialization: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                License / Registration #
              </label>
              <input
                type="text"
                value={editForm.registration_number}
                onChange={(e) =>
                  setEditForm({ ...editForm, registration_number: e.target.value })
                }
                className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Experience (Years)</label>
              <input
                type="number"
                min={0}
                value={editForm.experience_years}
                onChange={(e) =>
                  setEditForm({ ...editForm, experience_years: Number(e.target.value) || 0 })
                }
                className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Consultation Fee ($ USD)
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={editForm.consultation_fee}
                onChange={(e) =>
                  setEditForm({ ...editForm, consultation_fee: Number(e.target.value) || 0 })
                }
                className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">Clinical Bio</label>
              <textarea
                rows={3}
                value={editForm.bio}
                onChange={(e) => setEditForm({ ...editForm, bio: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={editForm.is_active}
              onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })}
            />
            <span className="font-semibold text-slate-800">
              Active for Clinical Appointments & Consultations
            </span>
          </label>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setEditDoc(null)}
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
              Save Changes
            </button>
          </div>
        </form>
      </Modal>

      {/* Doctor Availability Visibility Modal */}
      <Modal
        isOpen={Boolean(availDoc)}
        onClose={() => setAvailDoc(null)}
        title={`Branch Availability — ${availDoc?.full_name || ''}`}
        subtitle="Weekly recurring branch shifts and scheduled leave/holiday exceptions."
        maxWidth="lg"
      >
        {availLoading ? (
          <div className="py-10 text-center">
            <Loader2 className="w-6 h-6 text-teal-700 animate-spin mx-auto mb-2" />
            <p className="text-xs text-slate-500">Loading branch schedules...</p>
          </div>
        ) : (
          <div className="space-y-5 text-xs">
            <div>
              <h4 className="font-bold text-slate-900 mb-2">Weekly Branch Working Hours</h4>
              {!availability || availability.schedules.length === 0 ? (
                <p className="text-slate-500">
                  No recurring weekly schedules configured for this doctor yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {Object.entries(groupedAvail).map(([branchId, daysMap]) => (
                    <div
                      key={branchId}
                      className="border border-slate-200 rounded-xl overflow-hidden"
                    >
                      <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-200 font-bold text-slate-800">
                        {branchNameMap.get(branchId) || 'Branch'}
                      </div>
                      <div className="divide-y divide-slate-100">
                        {Object.entries(daysMap).map(([dayNum, windows]) => {
                          const dayLabel =
                            ISO_WEEKDAYS.find((d) => d.weekday === Number(dayNum))?.label ||
                            `Day ${dayNum}`;
                          return (
                            <div
                              key={dayNum}
                              className="px-3.5 py-2 flex items-center justify-between gap-2"
                            >
                              <span className="font-semibold text-slate-800">{dayLabel}</span>
                              <span className="font-mono text-slate-600 tabular-nums">
                                {windows
                                  .map(
                                    (w) =>
                                      `${w.start_time.slice(0, 5)}–${w.end_time.slice(0, 5)} (${w.slot_minutes}m)`
                                  )
                                  .join(' , ')}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h4 className="font-bold text-slate-900 mb-2">
                Schedule Exceptions ({availability?.exceptions.length || 0})
              </h4>
              {!availability || availability.exceptions.length === 0 ? (
                <p className="text-slate-500">No leave or holiday exceptions recorded.</p>
              ) : (
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
                  {availability.exceptions.map((exc) => (
                    <div key={exc.id} className="p-3 flex items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold text-slate-900">
                          {exc.exception_type.replace('_', ' ')} ·{' '}
                          {exc.branch_id ? branchNameMap.get(exc.branch_id) || 'Branch' : 'All Branches'}
                        </div>
                        {exc.reason && <div className="text-slate-500">{exc.reason}</div>}
                      </div>
                      <div className="text-right font-mono text-[11px] text-slate-600 tabular-nums shrink-0">
                        <div>{new Date(exc.start_at).toLocaleString()}</div>
                        <div>to {new Date(exc.end_at).toLocaleString()}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
