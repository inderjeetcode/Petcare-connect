import React, { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '../../components/common/PageHeader';
import { Modal } from '../../components/common/Modal';
import { useAdminWorkspace } from '../../hooks/useAdminWorkspace';
import { useApp } from '../../context/AppContext';
import { onboardingService } from '../../services/onboardingService';
import { adminPortalService } from '../../services/adminPortalService';
import { formatSupabaseError } from '../../services/authService';
import {
  Branch,
  DoctorGovernanceRecord,
  OrganizationMemberView,
} from '../../types/auth';
import { validateBranchFormInput } from '../../utils/adminPortalHelpers';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Edit2,
  Eye,
  Loader2,
  MapPin,
  Plus,
  RefreshCw,
  Stethoscope,
  Users,
  XCircle,
} from 'lucide-react';

interface BranchFormState {
  id: string | null;
  name: string;
  code: string;
  timezone: string;
  address: string;
  city: string;
  state: string;
  country: string;
  phone: string;
  is_active: boolean;
  operating_hours: string;
  walk_in_enabled: boolean;
  check_in_grace_minutes: number;
  reception_note: string;
}

const EMPTY_BRANCH_FORM: BranchFormState = {
  id: null,
  name: '',
  code: '',
  timezone: 'UTC',
  address: '',
  city: '',
  state: '',
  country: '',
  phone: '',
  is_active: true,
  operating_hours: 'Mon-Sat 09:00 - 18:00',
  walk_in_enabled: true,
  check_in_grace_minutes: 15,
  reception_note: '',
};

export const AdminBranchesPage: React.FC = () => {
  const { workspace } = useAdminWorkspace();
  const { showToast } = useApp();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [members, setMembers] = useState<OrganizationMemberView[]>([]);
  const [doctors, setDoctors] = useState<DoctorGovernanceRecord[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<BranchFormState>(EMPTY_BRANCH_FORM);
  const [detailBranch, setDetailBranch] = useState<Branch | null>(null);
  const [toggleTarget, setToggleTarget] = useState<Branch | null>(null);

  const loadData = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    try {
      const [bList, mList, dList] = await Promise.all([
        onboardingService.getOrgBranches(workspace.organizationId),
        onboardingService.getOrgMembers(workspace.organizationId),
        onboardingService.getOrgDoctors(workspace.organizationId),
      ]);
      setBranches(bList);
      setMembers(mList);
      setDoctors(dList);
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to load clinic branches.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [workspace, showToast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  if (!workspace) return null;

  const openCreateModal = () => {
    setForm(EMPTY_BRANCH_FORM);
    setModalOpen(true);
  };

  const openEditModal = (b: Branch) => {
    setForm({
      id: b.id,
      name: b.name,
      code: b.code,
      timezone: b.timezone || 'UTC',
      address: b.address || '',
      city: b.city || '',
      state: b.state || '',
      country: b.country || '',
      phone: b.phone || '',
      is_active: b.is_active,
      operating_hours: b.settings?.operating_hours || 'Mon-Sat 09:00 - 18:00',
      walk_in_enabled: b.settings?.walk_in_enabled ?? true,
      check_in_grace_minutes: Number(b.settings?.check_in_grace_minutes ?? 15),
      reception_note: b.settings?.reception_note || '',
    });
    setModalOpen(true);
  };

  const handleSaveBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    const errMsg = validateBranchFormInput({
      name: form.name,
      code: form.code,
      timezone: form.timezone,
    });
    if (errMsg) {
      showToast(errMsg, 'warning');
      return;
    }

    setSubmitting(true);
    try {
      await adminPortalService.upsertBranch({
        organization_id: workspace.organizationId,
        branch_id: form.id,
        name: form.name,
        code: form.code,
        timezone: form.timezone,
        address: form.address || null,
        city: form.city || null,
        state: form.state || null,
        country: form.country || null,
        phone: form.phone || null,
        is_active: form.is_active,
        settings: {
          operating_hours: form.operating_hours.trim() || undefined,
          walk_in_enabled: form.walk_in_enabled,
          check_in_grace_minutes: Number(form.check_in_grace_minutes) || 15,
          reception_note: form.reception_note.trim() || undefined,
        },
      });
      showToast(
        form.id ? `Updated branch ${form.name}.` : `Created branch ${form.name}.`,
        'success'
      );
      setModalOpen(false);
      await loadData();
    } catch (err) {
      showToast(formatSupabaseError(err, 'Unable to save branch.'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmToggleStatus = async () => {
    if (!toggleTarget) return;
    setSubmitting(true);
    try {
      await adminPortalService.upsertBranch({
        organization_id: workspace.organizationId,
        branch_id: toggleTarget.id,
        name: toggleTarget.name,
        code: toggleTarget.code,
        timezone: toggleTarget.timezone,
        address: toggleTarget.address,
        city: toggleTarget.city,
        state: toggleTarget.state,
        country: toggleTarget.country,
        phone: toggleTarget.phone,
        is_active: !toggleTarget.is_active,
        settings: toggleTarget.settings || null,
      });
      showToast(
        `Branch ${toggleTarget.name} ${toggleTarget.is_active ? 'suspended' : 'activated'}.`,
        toggleTarget.is_active ? 'warning' : 'success'
      );
      setToggleTarget(null);
      await loadData();
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to change branch status.'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const getBranchStaff = (branchId: string) =>
    members.filter((m) => m.branch_ids.includes(branchId));

  const getOrgWideStaff = () =>
    members.filter((m) => m.branch_ids.length === 0 && m.status === 'active');

  const getBranchDoctors = (branchId: string) =>
    doctors.filter((d) => d.branch_ids.includes(branchId));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clinic Branch Management"
        subtitle="Create locations, update branch details, activate or suspend facilities, and inspect branch staff and doctor assignments."
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={() => void loadData()}
              disabled={loading}
              className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            {workspace.canManageBranches && (
              <button
                onClick={openCreateModal}
                className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Plus className="w-4 h-4" />
                Add Branch
              </button>
            )}
          </div>
        }
      />

      {!workspace.canManageBranches && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-900">
          Your role has read-only visibility into clinic branches. Branch creation and status changes require the <code className="font-mono">branch.manage</code> permission.
        </div>
      )}

      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-600 flex items-start gap-2.5">
        <AlertTriangle className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
        <span>
          Historical records created prior to multi-branch tracking without a verified source branch remain explicitly unmapped and are never automatically assigned to a branch.
        </span>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
          <Loader2 className="w-6 h-6 text-teal-700 animate-spin mx-auto mb-2" />
          <p className="text-xs text-slate-500">Loading clinic branches...</p>
        </div>
      ) : branches.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center space-y-3">
          <Building2 className="w-8 h-8 text-slate-400 mx-auto" />
          <div className="text-sm font-bold text-slate-900">No Clinic Branches Configured</div>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Add your first clinic location to enable doctor branch assignments, working schedules, and appointment bookings.
          </p>
          {workspace.canManageBranches && (
            <button
              onClick={openCreateModal}
              className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg inline-flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              Create First Branch
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {branches.map((branch) => {
            const branchStaff = getBranchStaff(branch.id);
            const branchDoctors = getBranchDoctors(branch.id);

            return (
              <div
                key={branch.id}
                className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col justify-between gap-4"
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-bold text-slate-900">{branch.name}</h3>
                      <div className="text-xs text-slate-500 mt-0.5 font-mono">
                        Code: {branch.code} · {branch.timezone}
                      </div>
                    </div>
                    <span
                      className={`text-xs font-semibold inline-flex items-center gap-1 shrink-0 ${
                        branch.is_active ? 'text-emerald-700' : 'text-rose-700'
                      }`}
                    >
                      {branch.is_active ? (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5" />
                      )}
                      {branch.is_active ? 'Active' : 'Suspended'}
                    </span>
                  </div>

                  <div className="text-xs text-slate-600 space-y-1 pt-1">
                    <div className="flex items-start gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                      <span>
                        {[branch.address, branch.city, branch.state, branch.country]
                          .filter(Boolean)
                          .join(', ') || 'No street address specified'}
                      </span>
                    </div>
                    {branch.phone && (
                      <div className="text-slate-500">Phone: {branch.phone}</div>
                    )}
                    {branch.settings?.operating_hours && (
                      <div className="text-slate-500">
                        Hours: {branch.settings.operating_hours}
                      </div>
                    )}
                  </div>

                  <div className="pt-2 flex items-center gap-4 text-xs text-slate-600 border-t border-slate-100">
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <Users className="w-3.5 h-3.5 text-teal-700" />
                      {branchStaff.length} Branch Staff
                    </span>
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <Stethoscope className="w-3.5 h-3.5 text-teal-700" />
                      {branchDoctors.length} Assigned Doctors
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 flex-wrap">
                  <button
                    onClick={() => setDetailBranch(branch)}
                    className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    Details & Staff
                  </button>
                  {workspace.canManageBranches && (
                    <>
                      <button
                        onClick={() => openEditModal(branch)}
                        className="px-3 py-1.5 text-xs font-semibold text-teal-700 bg-teal-50 border border-teal-200 hover:bg-teal-100 rounded-lg inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        Edit
                      </button>
                      <button
                        onClick={() => setToggleTarget(branch)}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg border whitespace-nowrap shrink-0 ${
                          branch.is_active
                            ? 'text-rose-700 border-rose-200 hover:bg-rose-50'
                            : 'text-emerald-700 border-emerald-200 hover:bg-emerald-50'
                        }`}
                      >
                        {branch.is_active ? 'Suspend' : 'Activate'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit Branch Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={form.id ? `Edit Branch — ${form.name}` : 'Create Clinic Branch'}
        subtitle="Configure physical branch location details, timezone, and operational settings."
        maxWidth="lg"
      >
        <form onSubmit={handleSaveBranch} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Branch Name *</label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Downtown Veterinary Center"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Branch Code *</label>
              <input
                type="text"
                required
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="DTWN"
                className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Timezone *</label>
              <input
                type="text"
                required
                value={form.timezone}
                onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                placeholder="Asia/Kolkata"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Contact Phone</label>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+1 555 200 1000"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">Street Address</label>
              <input
                type="text"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="450 Harbor Ave, Suite 100"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">City</label>
              <input
                type="text"
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">State / Province</label>
              <input
                type="text"
                value={form.state}
                onChange={(e) => setForm({ ...form, state: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Country</label>
              <input
                type="text"
                value={form.country}
                onChange={(e) => setForm({ ...form, country: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Check-In Grace Period (mins)
              </label>
              <input
                type="number"
                min={0}
                max={120}
                value={form.check_in_grace_minutes}
                onChange={(e) =>
                  setForm({ ...form, check_in_grace_minutes: Number(e.target.value) || 0 })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">
                Operating Hours Summary
              </label>
              <input
                type="text"
                value={form.operating_hours}
                onChange={(e) => setForm({ ...form, operating_hours: e.target.value })}
                placeholder="Mon-Sat 09:00 - 18:00"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">
                Front Desk Reception Notes
              </label>
              <input
                type="text"
                value={form.reception_note}
                onChange={(e) => setForm({ ...form, reception_note: e.target.value })}
                placeholder="Parking validation instructions or triage note"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-5 pt-1">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              />
              <span className="font-semibold text-slate-800">Branch Active</span>
            </label>

            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.walk_in_enabled}
                onChange={(e) => setForm({ ...form, walk_in_enabled: e.target.checked })}
              />
              <span className="font-semibold text-slate-800">Accept Walk-In Registration</span>
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="px-4 py-2 font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg inline-flex items-center gap-1.5"
            >
              {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {form.id ? 'Save Branch Changes' : 'Create Branch'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Branch Details & Assigned Staff Modal */}
      <Modal
        isOpen={Boolean(detailBranch)}
        onClose={() => setDetailBranch(null)}
        title={detailBranch ? `${detailBranch.name} (${detailBranch.code})` : 'Branch Details'}
        subtitle={detailBranch ? `Timezone: ${detailBranch.timezone}` : ''}
        maxWidth="lg"
      >
        {detailBranch && (
          <div className="space-y-5 text-xs">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="text-slate-500">Address</div>
                <div className="font-semibold text-slate-900 mt-0.5">
                  {[detailBranch.address, detailBranch.city, detailBranch.state, detailBranch.country]
                    .filter(Boolean)
                    .join(', ') || 'Not specified'}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Operational Status</div>
                <div className="font-semibold text-slate-900 mt-0.5">
                  {detailBranch.is_active ? 'Active' : 'Suspended'} ·{' '}
                  {detailBranch.settings?.walk_in_enabled !== false
                    ? 'Walk-ins Enabled'
                    : 'Appointments Only'}
                </div>
              </div>
            </div>

            <div>
              <h4 className="font-bold text-slate-900 mb-2">
                Assigned Doctors ({getBranchDoctors(detailBranch.id).length})
              </h4>
              {getBranchDoctors(detailBranch.id).length === 0 ? (
                <p className="text-slate-500">
                  No doctors are currently assigned to this branch. Manage assignments in Doctor Management.
                </p>
              ) : (
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                  {getBranchDoctors(detailBranch.id).map((doc) => (
                    <div key={doc.id} className="p-3 flex items-center justify-between gap-2">
                      <div>
                        <div className="font-semibold text-slate-900">{doc.full_name}</div>
                        <div className="text-[11px] text-slate-500">
                          {doc.specialization} · {doc.qualification}
                        </div>
                      </div>
                      <span
                        className={`text-[11px] font-semibold ${
                          doc.is_active ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        {doc.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h4 className="font-bold text-slate-900 mb-2">
                Branch-Scoped Staff ({getBranchStaff(detailBranch.id).length})
              </h4>
              {getBranchStaff(detailBranch.id).length === 0 ? (
                <p className="text-slate-500">
                  No branch-restricted staff members assigned specifically to this location. Organization-wide administrators ({getOrgWideStaff().length} active) also have oversight here.
                </p>
              ) : (
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                  {getBranchStaff(detailBranch.id).map((m) => (
                    <div key={m.membership_id} className="p-3 flex items-center justify-between gap-2">
                      <div>
                        <div className="font-semibold text-slate-900">{m.full_name}</div>
                        <div className="text-[11px] text-slate-500">
                          {m.email} · Roles: {m.roles.join(', ')}
                        </div>
                      </div>
                      <span className="text-[11px] font-semibold text-slate-700">{m.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Confirm Activate / Suspend Modal */}
      <Modal
        isOpen={Boolean(toggleTarget)}
        onClose={() => setToggleTarget(null)}
        title={
          toggleTarget?.is_active
            ? `Suspend Branch: ${toggleTarget?.name}`
            : `Activate Branch: ${toggleTarget?.name}`
        }
        maxWidth="sm"
      >
        {toggleTarget && (
          <div className="space-y-4 text-xs">
            <p className="text-slate-600 leading-relaxed">
              {toggleTarget.is_active
                ? 'Suspending this branch prevents new appointment requests and confirmations at this location while preserving existing historical records.'
                : 'Activating this branch allows assigned doctors and front desk teams to accept and confirm appointments again.'}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setToggleTarget(null)}
                className="px-4 py-2 font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleConfirmToggleStatus()}
                className={`px-4 py-2 font-semibold text-white rounded-lg inline-flex items-center gap-1.5 ${
                  toggleTarget.is_active
                    ? 'bg-rose-700 hover:bg-rose-800'
                    : 'bg-teal-700 hover:bg-teal-800'
                }`}
              >
                {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {toggleTarget.is_active ? 'Suspend Branch' : 'Activate Branch'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
