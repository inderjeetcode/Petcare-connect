import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useAdminWorkspace } from '../../hooks/useAdminWorkspace';
import { adminPortalService } from '../../services/adminPortalService';
import { formatSupabaseError } from '../../services/authService';
import { AdminPaymentLedgerItem } from '../../types/admin';
import { PageHeader } from '../../components/common/PageHeader';
import { Pagination } from '../../components/common/Pagination';
import {
  compareIsoDates,
  isWithinDateRange,
  paginateItems,
  sortItems,
} from '../../utils/listManagementHelpers';
import {
  CreditCard,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react';

export const AdminPayments: React.FC = () => {
  const { workspace } = useAdminWorkspace();
  const { showToast } = useApp();

  const orgId = workspace?.organizationId || '';
  const canReadAudit = Boolean(workspace?.canReadAudit);

  const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState<AdminPaymentLedgerItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const loadPayments = useCallback(async () => {
    if (!orgId || !canReadAudit) {
      setPayments([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const list = await adminPortalService.getOrgPayments(orgId);
      setPayments(list);
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to load payment ledger.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [orgId, canReadAudit, showToast]);

  useEffect(() => {
    void loadPayments();
  }, [loadPayments]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, searchQuery, fromDate, toDate, sortOrder]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = payments.filter((p) => {
      if (statusFilter !== 'all' && p.payment_status !== statusFilter) return false;
      if (!isWithinDateRange(p.paid_at || p.created_at, fromDate, toDate)) return false;
      if (!q) return true;
      return (
        (p.pet_name || '').toLowerCase().includes(q) ||
        (p.client_name || '').toLowerCase().includes(q) ||
        (p.doctor_name || '').toLowerCase().includes(q) ||
        (p.transaction_id || '').toLowerCase().includes(q) ||
        (p.gateway || '').toLowerCase().includes(q)
      );
    });
    return sortItems(
      list,
      (a, b) => compareIsoDates(a.paid_at || a.created_at, b.paid_at || b.created_at),
      sortOrder
    );
  }, [payments, statusFilter, searchQuery, fromDate, toDate, sortOrder]);

  const paginatedPayments = useMemo(
    () => paginateItems(filtered, page, pageSize),
    [filtered, page, pageSize]
  );

  const totals = useMemo(() => {
    const paid = payments
      .filter((p) => p.payment_status === 'paid')
      .reduce((acc, p) => acc + p.amount, 0);
    const pending = payments
      .filter((p) => p.payment_status === 'pending')
      .reduce((acc, p) => acc + p.amount, 0);
    return { paid, pending };
  }, [payments]);

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader
        title={`${workspace?.organizationName || 'Clinic'} — Payment & Billing Ledger`}
        subtitle="Tenant-isolated consultation_payments ledger and payment gateway webhook readiness."
        action={
          canReadAudit ? (
            <button
              type="button"
              onClick={loadPayments}
              disabled={loading}
              className="px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          ) : undefined
        }
      />

      {!canReadAudit ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center space-y-2">
          <Lock className="w-6 h-6 text-slate-400 mx-auto" />
          <h2 className="text-sm font-bold text-slate-900">Restricted Financial Ledger</h2>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Viewing tenant payment records requires the <code className="font-mono">audit.read</code> permission.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white p-5 rounded-xl border border-slate-200">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Recorded Paid Total
              </span>
              <div className="mt-2 text-2xl font-bold text-emerald-700 font-mono tabular-nums">
                ${totals.paid.toFixed(2)}
              </div>
              <span className="text-xs text-slate-500 mt-1 block">
                Settled consultation transactions
              </span>
            </div>
            <div className="bg-white p-5 rounded-xl border border-slate-200">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Pending Settlement
              </span>
              <div className="mt-2 text-2xl font-bold text-amber-700 font-mono tabular-nums">
                ${totals.pending.toFixed(2)}
              </div>
              <span className="text-xs text-slate-500 mt-1 block">
                Awaiting clinic or gateway confirmation
              </span>
            </div>
            <div className="bg-white p-5 rounded-xl border border-slate-200">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Total Ledger Entries
              </span>
              <div className="mt-2 text-2xl font-bold text-slate-900 font-mono tabular-nums">
                {payments.length}
              </div>
              <span className="text-xs text-slate-500 mt-1 block">
                Scoped strictly to {workspace?.organizationName}
              </span>
            </div>
          </div>

          <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 text-teal-900 flex items-start gap-3 text-xs">
            <ShieldCheck className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
            <div>
              <strong className="font-bold block">Direct PostgreSQL Ledger (No Synthetic Charges)</strong>
              <span>
                Entries below reflect genuine <code className="font-mono">consultation_payments</code> rows belonging to your organization. External payment gateway webhooks will append verified gateway transactions here once activated.
              </span>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <h2 className="text-sm font-bold text-slate-900">
                Transactions ({filtered.length})
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Pet, client, doctor, gateway..."
                    className="pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  aria-label="From date"
                  className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                />
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  aria-label="To date"
                  className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  aria-label="Filter by payment status"
                  className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="all">All Statuses</option>
                  <option value="paid">Paid</option>
                  <option value="pending">Pending</option>
                  <option value="failed">Failed</option>
                  <option value="refunded">Refunded</option>
                </select>
                <select
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value as 'desc' | 'asc')}
                  aria-label="Sort payments"
                  className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="desc">Newest First</option>
                  <option value="asc">Oldest First</option>
                </select>
                {(searchQuery || statusFilter !== 'all' || fromDate || toDate) && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setStatusFilter('all');
                      setFromDate('');
                      setToDate('');
                    }}
                    className="px-2.5 py-1.5 text-xs font-semibold text-teal-800 bg-teal-50 hover:bg-teal-100 rounded-lg"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {loading ? (
              <div className="py-12 flex items-center justify-center gap-2 text-xs text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin text-teal-700" />
                <span>Loading organization ledger...</span>
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-500 space-y-2">
                <CreditCard className="w-7 h-7 text-slate-300 mx-auto" />
                <div className="font-semibold text-slate-700">
                  No payment transactions match current filters
                </div>
                <p className="max-w-md mx-auto">
                  Recorded consultation payments belonging to {workspace?.organizationName} appear here automatically.
                </p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                      <tr>
                        <th className="py-3 px-4">Date</th>
                        <th className="py-3 px-4">Patient & Client</th>
                        <th className="py-3 px-4">Attending Doctor</th>
                        <th className="py-3 px-4">Gateway / Ref</th>
                        <th className="py-3 px-4">Amount</th>
                        <th className="py-3 px-4">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {paginatedPayments.items.map((item) => (
                        <tr key={item.id} className="hover:bg-slate-50/50">
                          <td className="py-3 px-4 font-mono text-[11px] text-slate-500 whitespace-nowrap tabular-nums">
                            {new Date(item.paid_at || item.created_at).toLocaleString()}
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-bold text-slate-900">
                              {item.pet_name || 'Patient Case'}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {item.client_name || item.consultation_id}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-slate-700">
                            {item.doctor_name || 'Assigned Doctor'}
                          </td>
                          <td className="py-3 px-4 font-mono text-slate-600">
                            {item.gateway || 'Clinic Direct'} · {item.transaction_id || '—'}
                          </td>
                          <td className="py-3 px-4 font-mono font-bold tabular-nums text-slate-900">
                            ${item.amount.toFixed(2)}
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                item.payment_status === 'paid'
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  : item.payment_status === 'pending'
                                  ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                  : 'bg-rose-50 text-rose-700 border border-rose-200'
                              }`}
                            >
                              {item.payment_status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  currentPage={paginatedPayments.currentPage}
                  totalPages={paginatedPayments.totalPages}
                  totalItems={paginatedPayments.totalItems}
                  startIndex={paginatedPayments.startIndex}
                  endIndex={paginatedPayments.endIndex}
                  pageSize={paginatedPayments.pageSize}
                  onPageChange={setPage}
                  onPageSizeChange={(size) => {
                    setPageSize(size);
                    setPage(1);
                  }}
                  itemLabel="transactions"
                />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
};
