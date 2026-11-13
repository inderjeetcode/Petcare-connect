import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useApp } from '../../context/AppContext';
import { onboardingService } from '../../services/onboardingService';
import { adminPortalService } from '../../services/adminPortalService';
import { formatSupabaseError } from '../../services/authService';
import { canAssignRoleList } from '../../utils/adminPortalHelpers';
import {
  Branch,
  ClinicClientRecord,
  DoctorGovernanceRecord,
  OrganizationMemberView,
  OrgRoleCode,
  StaffInvitationRecord,
} from '../../types/auth';
import { PageHeader } from '../../components/common/PageHeader';
import { Modal } from '../../components/common/Modal';
import {
  Users,
  UserPlus,
  Building2,
  Stethoscope,
  CheckCircle2,
  XCircle,
  Copy,
  RefreshCw,
  Shield,
  Plus,
  Loader2,
  Ban,
} from 'lucide-react';

const ALL_ORG_ROLES: Array<{ code: OrgRoleCode; label: string; adminOnly?: boolean }> = [
  { code: 'org_owner', label: 'Organization Owner', adminOnly: true },
  { code: 'org_admin', label: 'Clinic Admin', adminOnly: true },
  { code: 'branch_manager', label: 'Branch Manager' },
  { code: 'doctor', label: 'Veterinary Doctor' },
  { code: 'front_desk', label: 'Front Desk Coordinator' },
];

export const AdminOnboardingPage: React.FC = () => {
  const { activeWorkspace, user, hasPermission } = useAuth();
  const { showToast } = useApp();

  const orgId = activeWorkspace?.organization_id || '';
  const orgSlug = activeWorkspace?.organization_slug || '';
  const orgName = activeWorkspace?.organization_name || 'Organization';
  const canApproveClients = orgId ? hasPermission(orgId, 'clients.approve') : false;
  const canManageStaff = orgId ? hasPermission(orgId, 'staff.manage') : false;
  const canAssignAdmin = orgId ? hasPermission(orgId, 'roles.assign_admin') : false;
  const canManageBranches = orgId ? hasPermission(orgId, 'branch.manage') : false;
  const canAccessBranchesRoute = orgId
    ? hasPermission(orgId, 'branch.manage') || hasPermission(orgId, 'schedules.manage')
    : false;

  const [tab, setTab] = useState<'clients' | 'staff' | 'branches'>('clients');
  const [loading, setLoading] = useState(true);

  const [clients, setClients] = useState<ClinicClientRecord[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [members, setMembers] = useState<OrganizationMemberView[]>([]);
  const [invitations, setInvitations] = useState<StaffInvitationRecord[]>([]);
  const [doctors, setDoctors] = useState<DoctorGovernanceRecord[]>([]);

  // Client modals / forms
  const [rejectClientTarget, setRejectClientTarget] = useState<ClinicClientRecord | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [walkInForm, setWalkInForm] = useState({ full_name: '', phone: '', email: '' });

  // Invite staff form
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState<{
    email: string;
    role_codes: OrgRoleCode[];
    branch_ids: string[];
  }>({ email: '', role_codes: ['doctor'], branch_ids: [] });
  const [generatedInvite, setGeneratedInvite] = useState<{
    token: string;
    email: string;
    expires_at: string;
  } | null>(null);

  // Edit member roles / suspend
  const [editMember, setEditMember] = useState<OrganizationMemberView | null>(null);
  const [editRoles, setEditRoles] = useState<OrgRoleCode[]>([]);
  const [editBranches, setEditBranches] = useState<string[]>([]);
  const [suspendTarget, setSuspendTarget] = useState<OrganizationMemberView | null>(null);
  const [suspendReason, setSuspendReason] = useState('');

  // Branch create modal
  const [branchModalOpen, setBranchModalOpen] = useState(false);
  const [branchForm, setBranchForm] = useState({
    name: '',
    code: '',
    timezone: 'UTC',
    address: '',
    phone: '',
  });

  // Doctor governance modal
  const [govDoctor, setGovDoctor] = useState<DoctorGovernanceRecord | null>(null);
  const [govForm, setGovForm] = useState({
    is_active: true,
    consultation_fee: 0,
    display_name: '',
  });

  const [submitting, setSubmitting] = useState(false);

  const loadAll = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [cList, bList, mList, invList, dList] = await Promise.all([
        onboardingService.getOrgClinicClients(orgId),
        onboardingService.getOrgBranches(orgId),
        onboardingService.getOrgMembers(orgId),
        canManageStaff ? onboardingService.getOrgInvitations(orgId) : Promise.resolve([]),
        onboardingService.getOrgDoctors(orgId),
      ]);
      setClients(cList);
      setBranches(bList);
      setMembers(mList);
      setInvitations(invList);
      setDoctors(dList);
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to load onboarding data.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [orgId, canManageStaff, showToast]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleApproveClient = async (cc: ClinicClientRecord) => {
    try {
      await onboardingService.approveClinicClient(cc.id);
      showToast(`Approved client ${cc.full_name}.`, 'success');
      await loadAll();
    } catch (err) {
      showToast(formatSupabaseError(err), 'error');
    }
  };

  const handleRejectClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectClientTarget || !rejectReason.trim()) return;
    setSubmitting(true);
    try {
      await onboardingService.rejectClinicClient(rejectClientTarget.id, rejectReason.trim());
      showToast(`Declined request from ${rejectClientTarget.full_name}.`, 'info');
      setRejectClientTarget(null);
      setRejectReason('');
      await loadAll();
    } catch (err) {
      showToast(formatSupabaseError(err), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateWalkIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onboardingService.createWalkInClient(
        orgId,
        walkInForm.full_name,
        walkInForm.phone,
        walkInForm.email || undefined
      );
      showToast(`Registered walk-in client ${walkInForm.full_name}.`, 'success');
      setWalkInOpen(false);
      setWalkInForm({ full_name: '', phone: '', email: '' });
      await loadAll();
    } catch (err) {
      showToast(formatSupabaseError(err), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const roleCheck = canAssignRoleList(inviteForm.role_codes, canAssignAdmin);
    if (!roleCheck.valid) {
      showToast(roleCheck.message || 'Invalid role selection.', 'warning');
      return;
    }
    setSubmitting(true);
    try {
      const res = await onboardingService.inviteMember({
        organization_id: orgId,
        email: inviteForm.email,
        role_codes: inviteForm.role_codes,
        branch_ids: inviteForm.branch_ids,
      });
      setGeneratedInvite({
        token: res.token,
        email: inviteForm.email,
        expires_at: res.expires_at,
      });
      showToast(`Invitation created for ${inviteForm.email}.`, 'success');
      setInviteOpen(false);
      setInviteForm({ email: '', role_codes: ['doctor'], branch_ids: [] });
      await loadAll();
    } catch (err) {
      showToast(formatSupabaseError(err), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveMemberRoles = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editMember) return;
    const roleCheck = canAssignRoleList(editRoles, canAssignAdmin);
    if (!roleCheck.valid) {
      showToast(roleCheck.message || 'Invalid role selection.', 'warning');
      return;
    }
    setSubmitting(true);
    try {
      await onboardingService.setMemberRoles(editMember.membership_id, editRoles, editBranches);
      showToast(`Updated roles for ${editMember.full_name}.`, 'success');
      setEditMember(null);
      await loadAll();
    } catch (err) {
      showToast(formatSupabaseError(err), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSuspendMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!suspendTarget || !suspendReason.trim()) return;
    setSubmitting(true);
    try {
      await onboardingService.suspendMember(suspendTarget.membership_id, suspendReason.trim());
      showToast(`Suspended ${suspendTarget.full_name}.`, 'warning');
      setSuspendTarget(null);
      setSuspendReason('');
      await loadAll();
    } catch (err) {
      showToast(formatSupabaseError(err), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReactivateMember = async (m: OrganizationMemberView) => {
    setSubmitting(true);
    try {
      await adminPortalService.reactivateMember(m.membership_id);
      showToast(`Reactivated ${m.full_name}.`, 'success');
      await loadAll();
    } catch (err) {
      showToast(formatSupabaseError(err), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevokeInvitation = async (inv: StaffInvitationRecord) => {
    setSubmitting(true);
    try {
      await adminPortalService.revokeInvitation(inv.id);
      showToast(`Revoked invitation for ${inv.email}.`, 'info');
      await loadAll();
    } catch (err) {
      showToast(formatSupabaseError(err), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onboardingService.createOrUpdateBranch({
        organization_id: orgId,
        name: branchForm.name,
        code: branchForm.code,
        timezone: branchForm.timezone,
        address: branchForm.address,
        phone: branchForm.phone,
      });
      showToast(`Branch ${branchForm.name} created.`, 'success');
      setBranchModalOpen(false);
      setBranchForm({ name: '', code: '', timezone: 'UTC', address: '', phone: '' });
      await loadAll();
    } catch (err) {
      showToast(formatSupabaseError(err), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleDoctorBranch = async (
    doc: DoctorGovernanceRecord,
    branchId: string,
    currentlyAssigned: boolean
  ) => {
    try {
      await onboardingService.assignDoctorToBranch(
        orgId,
        doc.id,
        branchId,
        !currentlyAssigned
      );
      showToast(
        `${!currentlyAssigned ? 'Assigned' : 'Removed'} ${doc.full_name} ${!currentlyAssigned ? 'to' : 'from'} branch.`,
        'success'
      );
      await loadAll();
    } catch (err) {
      showToast(formatSupabaseError(err), 'error');
    }
  };

  const handleSaveDoctorGovernance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!govDoctor) return;
    setSubmitting(true);
    try {
      await onboardingService.adminUpdateDoctorGovernance({
        doctor_profile_id: govDoctor.id,
        is_active: govForm.is_active,
        consultation_fee: govForm.consultation_fee,
        display_name: govForm.display_name,
      });
      showToast(`Updated doctor governance for ${govDoctor.full_name}.`, 'success');
      setGovDoctor(null);
      await loadAll();
    } catch (err) {
      showToast(formatSupabaseError(err), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const pendingClientsCount = clients.filter((c) => c.status === 'requested').length;

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader
        title={`${orgName} — Onboarding & Access Governance`}
        subtitle="Approve clinic clients, invite veterinary doctors & staff, configure branches, and enforce branch scoping."
        action={
          <button
            type="button"
            onClick={loadAll}
            disabled={loading}
            className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-xl inline-flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        }
      />

      {/* Generated Invite Token Callout */}
      {generatedInvite && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-950 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-bold flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-700" />
              Single-Use Invitation Ready for {generatedInvite.email}
            </span>
            <button
              type="button"
              onClick={() => setGeneratedInvite(null)}
              className="text-emerald-800 hover:underline font-semibold"
            >
              Dismiss
            </button>
          </div>
          <p className="text-[11px] text-emerald-800">
            Share this link with the invitee. The raw token is shown once (only its SHA-256 hash is stored in PostgreSQL). Expires {new Date(generatedInvite.expires_at).toLocaleString()}.
          </p>
          <div className="flex items-center gap-2 bg-white border border-emerald-200 rounded-xl p-2">
            <code className="flex-1 font-mono text-[11px] truncate select-all">
              {`${window.location.origin}/accept-invite?token=${generatedInvite.token}`}
            </code>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(
                  `${window.location.origin}/accept-invite?token=${generatedInvite.token}`
                );
                showToast('Invitation link copied to clipboard', 'success');
              }}
              className="px-2.5 py-1 bg-teal-700 text-white rounded-lg font-semibold inline-flex items-center gap-1 shrink-0"
            >
              <Copy className="w-3 h-3" /> Copy Link
            </button>
          </div>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-2">
        <button
          type="button"
          onClick={() => setTab('clients')}
          className={`px-4 py-2 text-xs font-bold rounded-xl inline-flex items-center gap-1.5 ${
            tab === 'clients' ? 'bg-teal-700 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Users className="w-4 h-4" />
          Clinic Clients
          {pendingClientsCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-amber-400 text-slate-900">
              {pendingClientsCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setTab('staff')}
          className={`px-4 py-2 text-xs font-bold rounded-xl inline-flex items-center gap-1.5 ${
            tab === 'staff' ? 'bg-teal-700 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Shield className="w-4 h-4" />
          Staff & Invitations ({members.length})
        </button>

        <button
          type="button"
          onClick={() => setTab('branches')}
          className={`px-4 py-2 text-xs font-bold rounded-xl inline-flex items-center gap-1.5 ${
            tab === 'branches' ? 'bg-teal-700 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Building2 className="w-4 h-4" />
          Branches & Doctors ({branches.length})
        </button>
      </div>

      {loading ? (
        <div className="py-12 flex items-center justify-center gap-2 text-xs text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin text-teal-700" />
          <span>Loading organization directory...</span>
        </div>
      ) : tab === 'clients' ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900">
              Organization-Scoped Client Directory ({clients.length})
            </h2>
            {canApproveClients && (
              <button
                type="button"
                onClick={() => setWalkInOpen(true)}
                className="px-3.5 py-2 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-xl inline-flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                Register Walk-In Client
              </button>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto shadow-xs">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                <tr>
                  <th className="py-3 px-4">Pet Owner</th>
                  <th className="py-3 px-4">Contact</th>
                  <th className="py-3 px-4">Source</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {clients.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500">
                      No client memberships or requests in this clinic yet.
                    </td>
                  </tr>
                ) : (
                  clients.map((cc) => (
                    <tr key={cc.id} className="hover:bg-slate-50/50">
                      <td className="py-3 px-4 font-bold text-slate-900">{cc.full_name}</td>
                      <td className="py-3 px-4 text-slate-600">
                        <div>{cc.email || '—'}</div>
                        <div className="text-[11px] text-slate-400">{cc.phone || 'No phone'}</div>
                      </td>
                      <td className="py-3 px-4 uppercase text-[10px] font-bold text-slate-500">
                        {cc.source}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            cc.status === 'approved'
                              ? 'bg-emerald-100 text-emerald-800'
                              : cc.status === 'requested'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {cc.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        {cc.status === 'requested' && canApproveClients && (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleApproveClient(cc)}
                              className="px-2.5 py-1 bg-teal-700 hover:bg-teal-800 text-white rounded-lg font-semibold inline-flex items-center gap-1"
                            >
                              <CheckCircle2 className="w-3 h-3" />
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setRejectClientTarget(cc);
                                setRejectReason('');
                              }}
                              className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg font-semibold inline-flex items-center gap-1"
                            >
                              <XCircle className="w-3 h-3" />
                              Reject
                            </button>
                          </div>
                        )}
                        {cc.status === 'rejected' && cc.rejection_reason && (
                          <span className="text-[11px] text-rose-600">{cc.rejection_reason}</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : tab === 'staff' ? (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900">
              Organization Staff & Doctors ({members.length})
            </h2>
            {canManageStaff && (
              <button
                type="button"
                onClick={() => setInviteOpen(true)}
                className="px-3.5 py-2 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-xl inline-flex items-center gap-1.5"
              >
                <UserPlus className="w-3.5 h-3.5" />
                Invite Doctor / Staff
              </button>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto shadow-xs">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                <tr>
                  <th className="py-3 px-4">Member</th>
                  <th className="py-3 px-4">Roles</th>
                  <th className="py-3 px-4">Branch Scope</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Governance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {members.map((m) => (
                  <tr key={m.membership_id} className="hover:bg-slate-50/50">
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-900">{m.full_name}</div>
                      <div className="text-[11px] text-slate-500 font-mono">{m.email}</div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap gap-1">
                        {m.roles.map((r) => (
                          <span
                            key={r}
                            className="px-2 py-0.5 rounded bg-teal-50 text-teal-800 border border-teal-200 text-[10px] font-bold uppercase"
                          >
                            {r.replace('_', ' ')}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      {m.branch_ids.length === 0
                        ? 'All Branches (Org-wide)'
                        : branches
                            .filter((b) => m.branch_ids.includes(b.id))
                            .map((b) => b.code)
                            .join(', ')}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          m.status === 'active'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {m.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right space-x-1.5 whitespace-nowrap">
                      {canManageStaff && m.status === 'active' && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setEditMember(m);
                              setEditRoles(m.roles);
                              setEditBranches(m.branch_ids);
                            }}
                            className="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
                          >
                            Edit Roles
                          </button>
                          {m.user_id !== user?.id && (
                            <button
                              type="button"
                              onClick={() => {
                                setSuspendTarget(m);
                                setSuspendReason('');
                              }}
                              className="px-2.5 py-1 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-lg inline-flex items-center gap-1"
                            >
                              <Ban className="w-3 h-3" />
                              Suspend
                            </button>
                          )}
                        </>
                      )}
                      {canManageStaff && m.status === 'suspended' && (
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => handleReactivateMember(m)}
                          className="px-2.5 py-1 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg inline-flex items-center gap-1"
                        >
                          <CheckCircle2 className="w-3 h-3" />
                          Reactivate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {canManageStaff && invitations.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Staff Invitations History ({invitations.length})
              </h3>
              <div className="divide-y divide-slate-100 text-xs">
                {invitations.map((inv) => {
                  const isPending = !inv.accepted_at && !inv.revoked_at;
                  return (
                    <div key={inv.id} className="py-2.5 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <span className="font-mono font-bold text-slate-800">{inv.email}</span>
                        <span className="ml-2 text-slate-500">
                          Roles: {inv.role_codes.join(', ')}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            inv.accepted_at
                              ? 'bg-emerald-100 text-emerald-800'
                              : inv.revoked_at
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {inv.accepted_at ? 'Accepted' : inv.revoked_at ? 'Revoked' : 'Pending'}
                        </span>
                        {isPending && (
                          <button
                            type="button"
                            disabled={submitting}
                            onClick={() => handleRevokeInvitation(inv)}
                            className="px-2 py-0.5 text-[11px] font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-md whitespace-nowrap"
                          >
                            Revoke
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-slate-900">
              Clinic Branches ({branches.length})
            </h2>
            <div className="flex items-center gap-2">
              {orgSlug && canAccessBranchesRoute && (
                <Link
                  to={`/${orgSlug}/admin/branches`}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-xl whitespace-nowrap"
                >
                  Open Branch Governance
                </Link>
              )}
              {canManageBranches && (
                <button
                  type="button"
                  onClick={() => setBranchModalOpen(true)}
                  className="px-3.5 py-2 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-xl inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Branch
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {branches.map((b) => (
              <div
                key={b.id}
                className="bg-white rounded-2xl border border-slate-200 p-4 space-y-1 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-900">{b.name}</span>
                  <span className="font-mono px-2 py-0.5 bg-slate-100 rounded text-[11px] font-bold">
                    {b.code}
                  </span>
                </div>
                <div className="text-slate-600">{b.address || 'Address not specified'}</div>
                <div className="text-slate-500">
                  Timezone: {b.timezone} · Status: {b.is_active ? 'Active' : 'Inactive'}
                </div>
              </div>
            ))}
          </div>

          {/* Doctor Branch Assignments & Governance */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Stethoscope className="w-4 h-4 text-teal-700" />
              Organization Doctors & Multi-Branch Assignments ({doctors.length})
            </h3>
            {doctors.length === 0 ? (
              <p className="text-xs text-slate-500">
                No doctor profiles yet. Invite a staff member with the Veterinary Doctor role.
              </p>
            ) : (
              <div className="space-y-3">
                {doctors.map((doc) => (
                  <div
                    key={doc.id}
                    className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 text-sm">
                          {doc.full_name}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            doc.is_active
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {doc.is_active ? 'Active' : 'Inactive'}
                        </span>
                        <span className="text-slate-500 font-mono">
                          Fee: ${doc.consultation_fee}
                        </span>
                      </div>
                      <div className="text-slate-600">
                        {doc.specialization} · {doc.qualification}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <span className="text-[11px] font-semibold text-slate-500">
                          Assigned Branches:
                        </span>
                        {branches.map((br) => {
                          const assigned = doc.branch_ids.includes(br.id);
                          return (
                            <button
                              key={br.id}
                              type="button"
                              disabled={!canManageStaff}
                              onClick={() => handleToggleDoctorBranch(doc, br.id, assigned)}
                              className={`px-2 py-0.5 rounded text-[11px] font-bold border transition-colors ${
                                assigned
                                  ? 'bg-teal-700 text-white border-teal-700'
                                  : 'bg-white text-slate-600 border-slate-300 hover:border-teal-600'
                              }`}
                            >
                              {br.code} {assigned ? '✓' : '+'}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {canManageStaff && (
                      <button
                        type="button"
                        onClick={() => {
                          setGovDoctor(doc);
                          setGovForm({
                            is_active: doc.is_active,
                            consultation_fee: doc.consultation_fee,
                            display_name: doc.display_name || doc.full_name || '',
                          });
                        }}
                        className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg shrink-0"
                      >
                        Governance & Fee
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Reject Client Modal */}
      <Modal
        isOpen={Boolean(rejectClientTarget)}
        onClose={() => setRejectClientTarget(null)}
        title={`Decline Client Request: ${rejectClientTarget?.full_name || ''}`}
        maxWidth="md"
      >
        <form onSubmit={handleRejectClient} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Reason *
            </label>
            <textarea
              required
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Unable to verify pet owner eligibility..."
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setRejectClientTarget(null)}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 rounded-xl"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-xs font-bold text-white bg-rose-700 rounded-xl"
            >
              Confirm Decline
            </button>
          </div>
        </form>
      </Modal>

      {/* Walk-In Client Modal */}
      <Modal
        isOpen={walkInOpen}
        onClose={() => setWalkInOpen(false)}
        title="Register Walk-In Clinic Client"
        subtitle="Creates an approved organization-specific client record without requiring prior self-signup."
        maxWidth="md"
      >
        <form onSubmit={handleCreateWalkIn} className="space-y-3.5 text-xs">
          <div>
            <label className="block font-bold text-slate-700 mb-1">Full Name *</label>
            <input
              type="text"
              required
              value={walkInForm.full_name}
              onChange={(e) => setWalkInForm({ ...walkInForm, full_name: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block font-bold text-slate-700 mb-1">Phone Number *</label>
            <input
              type="tel"
              required
              value={walkInForm.phone}
              onChange={(e) => setWalkInForm({ ...walkInForm, phone: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block font-bold text-slate-700 mb-1">Email (Optional)</label>
            <input
              type="email"
              value={walkInForm.email}
              onChange={(e) => setWalkInForm({ ...walkInForm, email: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setWalkInOpen(false)}
              className="px-4 py-2 font-semibold text-slate-700 bg-slate-100 rounded-xl"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 font-bold text-white bg-teal-700 rounded-xl"
            >
              Create Approved Client
            </button>
          </div>
        </form>
      </Modal>

      {/* Invite Staff / Doctor Modal */}
      <Modal
        isOpen={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite Doctor or Staff Member"
        subtitle="Generates a single-use SHA-256 hashed invitation token bound to the invitee email."
        maxWidth="lg"
      >
        <form onSubmit={handleInviteSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block font-bold text-slate-700 mb-1">Invitee Email *</label>
            <input
              type="email"
              required
              value={inviteForm.email}
              onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
              placeholder="dr.patel@example.com"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            />
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1.5">Assign Roles *</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {ALL_ORG_ROLES.filter((r) => !r.adminOnly || canAssignAdmin).map((role) => {
                const checked = inviteForm.role_codes.includes(role.code);
                return (
                  <label
                    key={role.code}
                    className={`p-2.5 rounded-xl border flex items-center gap-2 cursor-pointer ${
                      checked
                        ? 'bg-teal-50 border-teal-600 text-teal-900'
                        : 'bg-white border-slate-200 text-slate-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setInviteForm((prev) => ({
                          ...prev,
                          role_codes: checked
                            ? prev.role_codes.filter((c) => c !== role.code)
                            : [...prev.role_codes, role.code],
                        }))
                      }
                    />
                    <span className="font-semibold">{role.label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {branches.length > 0 && (
            <div>
              <label className="block font-bold text-slate-700 mb-1.5">
                Branch Restrictions (leave all unchecked for Org-wide access)
              </label>
              <div className="flex flex-wrap gap-2">
                {branches.map((b) => {
                  const checked = inviteForm.branch_ids.includes(b.id);
                  return (
                    <label
                      key={b.id}
                      className={`px-3 py-1.5 rounded-lg border flex items-center gap-1.5 cursor-pointer ${
                        checked
                          ? 'bg-teal-50 border-teal-600 text-teal-900'
                          : 'bg-white border-slate-200 text-slate-700'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setInviteForm((prev) => ({
                            ...prev,
                            branch_ids: checked
                              ? prev.branch_ids.filter((id) => id !== b.id)
                              : [...prev.branch_ids, b.id],
                          }))
                        }
                      />
                      <span>
                        {b.name} ({b.code})
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setInviteOpen(false)}
              className="px-4 py-2 font-semibold text-slate-700 bg-slate-100 rounded-xl"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 font-bold text-white bg-teal-700 rounded-xl"
            >
              Generate Invitation Token
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Member Roles Modal */}
      <Modal
        isOpen={Boolean(editMember)}
        onClose={() => setEditMember(null)}
        title={`Edit Roles: ${editMember?.full_name || ''}`}
        maxWidth="lg"
      >
        <form onSubmit={handleSaveMemberRoles} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {ALL_ORG_ROLES.filter((r) => !r.adminOnly || canAssignAdmin).map((role) => {
              const checked = editRoles.includes(role.code);
              return (
                <label
                  key={role.code}
                  className={`p-2.5 rounded-xl border flex items-center gap-2 cursor-pointer ${
                    checked ? 'bg-teal-50 border-teal-600' : 'bg-white border-slate-200'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      setEditRoles((prev) =>
                        checked ? prev.filter((c) => c !== role.code) : [...prev, role.code]
                      )
                    }
                  />
                  <span className="font-semibold">{role.label}</span>
                </label>
              );
            })}
          </div>

          {branches.length > 0 && (
            <div>
              <label className="block font-bold text-slate-700 mb-1.5">
                Branch Restrictions (unchecked = Org-wide)
              </label>
              <div className="flex flex-wrap gap-2">
                {branches.map((b) => {
                  const checked = editBranches.includes(b.id);
                  return (
                    <label
                      key={b.id}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 flex items-center gap-1.5 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setEditBranches((prev) =>
                            checked ? prev.filter((id) => id !== b.id) : [...prev, b.id]
                          )
                        }
                      />
                      <span>
                        {b.name} ({b.code})
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditMember(null)}
              className="px-4 py-2 font-semibold text-slate-700 bg-slate-100 rounded-xl"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 font-bold text-white bg-teal-700 rounded-xl"
            >
              Save Roles
            </button>
          </div>
        </form>
      </Modal>

      {/* Suspend Member Modal */}
      <Modal
        isOpen={Boolean(suspendTarget)}
        onClose={() => setSuspendTarget(null)}
        title={`Suspend Staff Member: ${suspendTarget?.full_name || ''}`}
        maxWidth="md"
      >
        <form onSubmit={handleSuspendMember} className="space-y-4 text-xs">
          <div>
            <label className="block font-bold text-slate-700 mb-1">Reason *</label>
            <textarea
              required
              rows={3}
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setSuspendTarget(null)}
              className="px-4 py-2 font-semibold text-slate-700 bg-slate-100 rounded-xl"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 font-bold text-white bg-rose-700 rounded-xl"
            >
              Suspend Member
            </button>
          </div>
        </form>
      </Modal>

      {/* Create Branch Modal */}
      <Modal
        isOpen={branchModalOpen}
        onClose={() => setBranchModalOpen(false)}
        title="Add Clinic Branch"
        maxWidth="md"
      >
        <form onSubmit={handleCreateBranch} className="space-y-3.5 text-xs">
          <div>
            <label className="block font-bold text-slate-700 mb-1">Branch Name *</label>
            <input
              type="text"
              required
              value={branchForm.name}
              onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })}
              placeholder="Westside Specialty Clinic"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-bold text-slate-700 mb-1">Code *</label>
              <input
                type="text"
                required
                value={branchForm.code}
                onChange={(e) =>
                  setBranchForm({ ...branchForm, code: e.target.value.toUpperCase() })
                }
                placeholder="WEST"
                className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Timezone *</label>
              <input
                type="text"
                required
                value={branchForm.timezone}
                onChange={(e) => setBranchForm({ ...branchForm, timezone: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
          </div>
          <div>
            <label className="block font-bold text-slate-700 mb-1">Address</label>
            <input
              type="text"
              value={branchForm.address}
              onChange={(e) => setBranchForm({ ...branchForm, address: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block font-bold text-slate-700 mb-1">Phone</label>
            <input
              type="tel"
              value={branchForm.phone}
              onChange={(e) => setBranchForm({ ...branchForm, phone: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setBranchModalOpen(false)}
              className="px-4 py-2 font-semibold text-slate-700 bg-slate-100 rounded-xl"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 font-bold text-white bg-teal-700 rounded-xl"
            >
              Save Branch
            </button>
          </div>
        </form>
      </Modal>

      {/* Doctor Governance Modal */}
      <Modal
        isOpen={Boolean(govDoctor)}
        onClose={() => setGovDoctor(null)}
        title={`Doctor Governance: ${govDoctor?.full_name || ''}`}
        subtitle="Only authorized clinic administrators may modify consultation fees and active clinical status (SEC-10)."
        maxWidth="md"
      >
        <form onSubmit={handleSaveDoctorGovernance} className="space-y-3.5 text-xs">
          <div>
            <label className="block font-bold text-slate-700 mb-1">Display Name</label>
            <input
              type="text"
              value={govForm.display_name}
              onChange={(e) => setGovForm({ ...govForm, display_name: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block font-bold text-slate-700 mb-1">
              Consultation Fee ($ USD)
            </label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={govForm.consultation_fee}
              onChange={(e) =>
                setGovForm({ ...govForm, consultation_fee: Number(e.target.value) || 0 })
              }
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            />
          </div>
          <label className="flex items-center gap-2 pt-1 cursor-pointer">
            <input
              type="checkbox"
              checked={govForm.is_active}
              onChange={(e) => setGovForm({ ...govForm, is_active: e.target.checked })}
            />
            <span className="font-bold text-slate-800">Doctor Active for Clinical Practice</span>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setGovDoctor(null)}
              className="px-4 py-2 font-semibold text-slate-700 bg-slate-100 rounded-xl"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 font-bold text-white bg-teal-700 rounded-xl"
            >
              Save Governance
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
