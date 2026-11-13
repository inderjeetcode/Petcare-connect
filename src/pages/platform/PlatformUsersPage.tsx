import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { platformPortalService } from '../../services/platformPortalService';
import { formatSupabaseError } from '../../services/authService';
import { PlatformAuditLogRecord, PlatformUserRecord } from '../../types/platform';
import {
  validatePlatformAdminGrant,
  validatePlatformAdminRevoke,
  validatePlatformUserSuspension,
} from '../../utils/platformPortalHelpers';
import { PageHeader } from '../../components/common/PageHeader';
import { MetricCard } from '../../components/common/MetricCard';
import { Modal } from '../../components/common/Modal';
import { Pagination } from '../../components/common/Pagination';
import { PlatformPrivacyBanner } from '../../components/platform/PlatformPrivacyBanner';
import {
  CheckCircle2,
  History,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  UserCheck,
  UserX,
  Users,
} from 'lucide-react';

type UserFilter = 'all' | 'platform_admins' | 'active' | 'suspended';

export const PlatformUsersPage: React.FC = () => {
  const { showToast } = useApp();
  const { user: authUser, refreshContext } = useAuth();

  const [users, setUsers] = useState<PlatformUserRecord[]>([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [filter, setFilter] = useState<UserFilter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(true);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  // Grant Platform Owner modal
  const [grantTarget, setGrantTarget] = useState<PlatformUserRecord | null>(null);
  const [grantNotes, setGrantNotes] = useState('');

  // Revoke Platform Owner modal
  const [revokeTarget, setRevokeTarget] = useState<PlatformUserRecord | null>(null);
  const [revokeReason, setRevokeReason] = useState('');

  // Suspend User modal
  const [suspendTarget, setSuspendTarget] = useState<PlatformUserRecord | null>(null);
  const [suspendReason, setSuspendReason] = useState('');

  // Per-User Audit History modal
  const [historyUser, setHistoryUser] = useState<PlatformUserRecord | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLogs, setHistoryLogs] = useState<PlatformAuditLogRecord[]>([]);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await platformPortalService.listUsers({
        search: search.trim() || undefined,
        filter,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
      setUsers(res.users);
      setTotalUsers(res.total);
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to load platform users.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [filter, search, page, pageSize, showToast]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const activePlatformAdminCount = useMemo(
    () =>
      users.filter(
        (u) => u.is_platform_admin && u.platform_status === 'active'
      ).length,
    [users]
  );

  const suspendedCount = useMemo(
    () => users.filter((u) => u.platform_status === 'suspended').length,
    [users]
  );

  const handleGrantAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!grantTarget) return;
    const validationErr = validatePlatformAdminGrant(grantTarget);
    if (validationErr) {
      showToast(validationErr, 'warning');
      return;
    }

    setBusyUserId(grantTarget.id);
    try {
      await platformPortalService.grantPlatformAdmin(
        grantTarget.id,
        grantNotes.trim() || undefined
      );
      showToast(
        `Granted Platform Owner role to ${grantTarget.full_name} (${grantTarget.email}).`,
        'success'
      );
      setGrantTarget(null);
      setGrantNotes('');
      await Promise.all([loadUsers(), refreshContext()]);
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to grant Platform Owner role.'), 'error');
    } finally {
      setBusyUserId(null);
    }
  };

  const handleRevokeAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!revokeTarget) return;
    const validationErr = validatePlatformAdminRevoke({
      targetUser: revokeTarget,
      actorUserId: authUser?.id || '',
      activePlatformAdminCount,
      reason: revokeReason,
    });
    if (validationErr) {
      showToast(validationErr, 'warning');
      return;
    }

    setBusyUserId(revokeTarget.id);
    try {
      await platformPortalService.revokePlatformAdmin(
        revokeTarget.id,
        revokeReason.trim()
      );
      showToast(
        `Revoked Platform Owner role from ${revokeTarget.full_name}.`,
        'info'
      );
      setRevokeTarget(null);
      setRevokeReason('');
      await Promise.all([loadUsers(), refreshContext()]);
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to revoke Platform Owner role.'), 'error');
    } finally {
      setBusyUserId(null);
    }
  };

  const handleSuspendUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!suspendTarget) return;
    const validationErr = validatePlatformUserSuspension({
      targetUser: suspendTarget,
      actorUserId: authUser?.id || '',
      reason: suspendReason,
    });
    if (validationErr) {
      showToast(validationErr, 'warning');
      return;
    }

    setBusyUserId(suspendTarget.id);
    try {
      await platformPortalService.suspendUser(
        suspendTarget.id,
        suspendReason.trim()
      );
      showToast(`Suspended platform account ${suspendTarget.email}.`, 'warning');
      setSuspendTarget(null);
      setSuspendReason('');
      await loadUsers();
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to suspend user account.'), 'error');
    } finally {
      setBusyUserId(null);
    }
  };

  const handleReactivateUser = async (target: PlatformUserRecord) => {
    setBusyUserId(target.id);
    try {
      await platformPortalService.reactivateUser(target.id);
      showToast(`Reactivated account ${target.email}.`, 'success');
      await loadUsers();
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to reactivate user account.'), 'error');
    } finally {
      setBusyUserId(null);
    }
  };

  const openUserAuditHistory = async (target: PlatformUserRecord) => {
    setHistoryUser(target);
    setHistoryLoading(true);
    setHistoryLogs([]);
    try {
      const logs = await platformPortalService.listAuditLogs({ limit: 250 });
      const filtered = logs.filter(
        (l) =>
          l.actor_user_id === target.id ||
          l.entity_id === target.id ||
          (l.details || '').toLowerCase().includes(target.email.toLowerCase())
      );
      setHistoryLogs(filtered);
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to load user audit history.'), 'error');
      setHistoryUser(null);
    } finally {
      setHistoryLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Platform User & Role Administration"
        subtitle="Administer platform-level accounts, explicitly grant or revoke Platform Owner governance roles, and inspect user governance audit trails."
        action={
          <button
            type="button"
            onClick={loadUsers}
            disabled={loading}
            className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-xl inline-flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        }
      />

      <PlatformPrivacyBanner compact />

      {/* Explicit Role Boundary Notice */}
      <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-950 flex items-start gap-3">
        <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
        <div>
          <span className="font-bold">Zero Automatic Global Admin Escalation: </span>
          Platform Owner roles are never granted automatically on signup, invitation, or clinic onboarding. Every grant, revocation, or account suspension requires an explicit authorized action, protects against self-lockout or removing the last active Platform Owner, and records an immutable audit log.
        </div>
      </div>

      {/* Summary Metrics */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricCard
          label="Matching User Accounts"
          value={totalUsers}
          icon={Users}
          description="Global identity directory"
        />
        <MetricCard
          label="Active Platform Owners"
          value={activePlatformAdminCount}
          icon={ShieldCheck}
          description="Explicitly authorized governance holders"
        />
        <MetricCard
          label="Suspended Accounts"
          value={suspendedCount}
          icon={UserX}
          description="Platform-wide governance hold"
        />
      </section>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200">
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              { key: 'all', label: 'All Accounts' },
              { key: 'platform_admins', label: 'Platform Owners' },
              { key: 'active', label: 'Active' },
              { key: 'suspended', label: 'Suspended' },
            ] as const
          ).map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                setFilter(item.key);
                setPage(1);
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                filter === item.key
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search name or email..."
            aria-label="Search platform users"
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
          />
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
        {loading ? (
          <div className="py-12 flex items-center justify-center gap-2 text-xs text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin text-teal-700" />
            <span>Loading platform accounts...</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
              <tr>
                <th className="py-3 px-4">User Account</th>
                <th className="py-3 px-4">Platform Role</th>
                <th className="py-3 px-4">Tenant Associations</th>
                <th className="py-3 px-4">Account Status</th>
                <th className="py-3 px-4">Joined</th>
                <th className="py-3 px-4 text-right">Authorized Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-500">
                    No user accounts match the current filter.
                  </td>
                </tr>
              ) : (
                users.map((u) => {
                  const isSelf = u.id === authUser?.id;
                  const isBusy = busyUserId === u.id;
                  return (
                    <tr key={u.id} className="hover:bg-slate-50/50">
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900 flex items-center gap-1.5">
                          <span>{u.full_name}</span>
                          {isSelf && (
                            <span className="px-1.5 py-0.5 rounded bg-teal-50 text-teal-800 border border-teal-200 text-[10px] font-bold">
                              You
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono">{u.email}</div>
                        {u.platform_suspension_reason && u.platform_status === 'suspended' && (
                          <div className="text-[11px] text-rose-700 mt-0.5">
                            Suspension reason: {u.platform_suspension_reason}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {u.is_platform_admin ? (
                          <div>
                            <span className="px-2 py-0.5 rounded bg-slate-900 text-white text-[10px] font-bold uppercase inline-flex items-center gap-1">
                              <ShieldCheck className="w-3 h-3 text-teal-300" />
                              Platform Owner
                            </span>
                            {u.platform_admin_notes && (
                              <div className="text-[10px] text-slate-500 mt-1 max-w-[180px] truncate">
                                {u.platform_admin_notes}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-500">Standard Account</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-[11px] text-slate-600 tabular-nums">
                        <div>{u.active_staff_org_count} active staff orgs</div>
                        <div className="text-slate-500">
                          {u.approved_client_org_count} approved client orgs
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            u.platform_status === 'active'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {u.platform_status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-500 whitespace-nowrap">
                        {new Date(u.created_at).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap space-x-1.5">
                        <button
                          type="button"
                          onClick={() => openUserAuditHistory(u)}
                          className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1"
                        >
                          <History className="w-3.5 h-3.5" />
                          Audit
                        </button>

                        {!u.is_platform_admin && u.platform_status === 'active' && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => {
                              setGrantTarget(u);
                              setGrantNotes('');
                            }}
                            className="px-2.5 py-1.5 text-xs font-semibold text-teal-800 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg inline-flex items-center gap-1"
                          >
                            <ShieldCheck className="w-3.5 h-3.5" />
                            Grant Owner
                          </button>
                        )}

                        {u.is_platform_admin && !isSelf && (
                          <button
                            type="button"
                            disabled={isBusy || activePlatformAdminCount <= 1}
                            onClick={() => {
                              setRevokeTarget(u);
                              setRevokeReason('');
                            }}
                            className="px-2.5 py-1.5 text-xs font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg inline-flex items-center gap-1 disabled:opacity-50"
                          >
                            <ShieldOff className="w-3.5 h-3.5" />
                            Revoke Owner
                          </button>
                        )}

                        {!isSelf && u.platform_status === 'active' && !u.is_platform_admin && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => {
                              setSuspendTarget(u);
                              setSuspendReason('');
                            }}
                            className="px-2.5 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg inline-flex items-center gap-1"
                          >
                            <UserX className="w-3.5 h-3.5" />
                            Suspend
                          </button>
                        )}

                        {u.platform_status === 'suspended' && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleReactivateUser(u)}
                            className="px-2.5 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg inline-flex items-center gap-1"
                          >
                            <UserCheck className="w-3.5 h-3.5" />
                            Reactivate
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          </div>
        )}
        <Pagination
          currentPage={page}
          totalPages={Math.max(1, Math.ceil(totalUsers / pageSize))}
          totalItems={totalUsers}
          startIndex={totalUsers === 0 ? 0 : (page - 1) * pageSize + 1}
          endIndex={totalUsers === 0 ? 0 : (page - 1) * pageSize + users.length}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          pageSizeOptions={[10, 25, 50]}
          itemLabel="accounts"
        />
      </div>

      {/* Grant Platform Owner Modal */}
      <Modal
        isOpen={Boolean(grantTarget)}
        onClose={() => setGrantTarget(null)}
        title={`Grant Platform Owner Role: ${grantTarget?.full_name || ''}`}
        subtitle="Explicitly grants platform governance privileges. Does NOT grant unrestricted access to tenant medical records or chats."
        maxWidth="md"
      >
        <form onSubmit={handleGrantAdmin} className="space-y-4 text-xs">
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
            <div className="font-bold text-slate-900">{grantTarget?.full_name}</div>
            <div className="font-mono text-slate-500">{grantTarget?.email}</div>
          </div>
          <div>
            <label className="block font-bold text-slate-700 mb-1">
              Authorization Notes (Optional)
            </label>
            <textarea
              rows={3}
              value={grantNotes}
              onChange={(e) => setGrantNotes(e.target.value)}
              placeholder="Ticket or governance approval reference..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setGrantTarget(null)}
              className="px-4 py-2 font-semibold text-slate-700 bg-slate-100 rounded-xl"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={Boolean(busyUserId)}
              className="px-4 py-2 font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-xl inline-flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Confirm Role Grant
            </button>
          </div>
        </form>
      </Modal>

      {/* Revoke Platform Owner Modal */}
      <Modal
        isOpen={Boolean(revokeTarget)}
        onClose={() => setRevokeTarget(null)}
        title={`Revoke Platform Owner Role: ${revokeTarget?.full_name || ''}`}
        subtitle="Requires a mandatory audit reason. Self-revocation and removing the last active Platform Owner are blocked."
        maxWidth="md"
      >
        <form onSubmit={handleRevokeAdmin} className="space-y-4 text-xs">
          <div>
            <label className="block font-bold text-slate-700 mb-1">
              Revocation Reason *
            </label>
            <textarea
              required
              rows={3}
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
              placeholder="Role offboarding, rotation, or least-privilege review..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setRevokeTarget(null)}
              className="px-4 py-2 font-semibold text-slate-700 bg-slate-100 rounded-xl"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={Boolean(busyUserId)}
              className="px-4 py-2 font-bold text-white bg-amber-700 hover:bg-amber-800 rounded-xl"
            >
              Confirm Revocation
            </button>
          </div>
        </form>
      </Modal>

      {/* Suspend User Account Modal */}
      <Modal
        isOpen={Boolean(suspendTarget)}
        onClose={() => setSuspendTarget(null)}
        title={`Suspend Account: ${suspendTarget?.full_name || ''}`}
        subtitle="Suspends platform-wide access for this account while preserving audit history."
        maxWidth="md"
      >
        <form onSubmit={handleSuspendUser} className="space-y-4 text-xs">
          <div>
            <label className="block font-bold text-slate-700 mb-1">
              Suspension Reason *
            </label>
            <textarea
              required
              rows={3}
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              placeholder="Policy violation, compromised credentials, or compliance hold..."
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
              disabled={Boolean(busyUserId)}
              className="px-4 py-2 font-bold text-white bg-rose-700 hover:bg-rose-800 rounded-xl"
            >
              Suspend Account
            </button>
          </div>
        </form>
      </Modal>

      {/* User Audit History Modal */}
      <Modal
        isOpen={Boolean(historyUser)}
        onClose={() => setHistoryUser(null)}
        title={`Governance Audit History: ${historyUser?.full_name || ''}`}
        subtitle={historyUser?.email || ''}
        maxWidth="xl"
      >
        {historyLoading ? (
          <div className="py-10 flex items-center justify-center gap-2 text-xs text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin text-teal-700" />
            <span>Loading governance audit events...</span>
          </div>
        ) : historyLogs.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500">
            No platform governance audit events recorded for this user.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl max-h-96 overflow-y-auto text-xs">
            {historyLogs.map((log) => (
              <div key={log.id} className="p-3.5 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-bold text-slate-900">{log.action}</span>
                  <span className="text-[11px] text-slate-500">
                    {new Date(log.created_at).toLocaleString()}
                  </span>
                </div>
                <div className="text-slate-600">{log.details || log.entity_type}</div>
                <div className="text-[11px] text-slate-400">
                  Actor: {log.actor_email || log.actor_name} · Scope:{' '}
                  {log.organization_name || 'Platform Global'}
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
};
