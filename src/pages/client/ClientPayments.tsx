import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useClientWorkspace } from '../../hooks/useClientWorkspace';
import { clientPortalService } from '../../services/clientPortalService';
import { ClientPaymentRecord } from '../../types/client';
import { PageHeader } from '../../components/common/PageHeader';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { StatusBadge } from '../../components/common/StatusBadge';
import { Pagination } from '../../components/common/Pagination';
import {
  compareIsoDates,
  isWithinDateRange,
  paginateItems,
  sortItems,
} from '../../utils/listManagementHelpers';
import {
  CreditCard,
  ShieldCheck,
  AlertCircle,
  RefreshCw,
  Search,
} from 'lucide-react';

export const ClientPayments: React.FC = () => {
  const { workspace } = useClientWorkspace();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payments, setPayments] = useState<ClientPaymentRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const loadPayments = useCallback(async () => {
    if (!workspace) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await clientPortalService.getPayments(workspace.organizationId);
      setPayments(list);
    } catch (err: any) {
      setError(err.message || 'Unable to load payment records.');
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => {
    void loadPayments();
  }, [loadPayments]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, statusFilter, fromDate, toDate, sortOrder, pageSize]);

  const filteredPayments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = payments.filter((p) => {
      const matchesStatus = statusFilter === 'all' || p.payment_status === statusFilter;
      const matchesDate = isWithinDateRange(p.paid_at || p.created_at, fromDate, toDate);
      const matchesSearch =
        !q ||
        (p.pet_name || '').toLowerCase().includes(q) ||
        (p.doctor_name || '').toLowerCase().includes(q) ||
        (p.transaction_id || '').toLowerCase().includes(q) ||
        p.gateway.toLowerCase().includes(q);
      return matchesStatus && matchesDate && matchesSearch;
    });
    return sortItems(
      filtered,
      (a, b) => compareIsoDates(a.paid_at || a.created_at, b.paid_at || b.created_at),
      sortOrder
    );
  }, [payments, searchQuery, statusFilter, fromDate, toDate, sortOrder]);

  const pagedPayments = useMemo(
    () => paginateItems(filteredPayments, page, pageSize),
    [filteredPayments, page, pageSize]
  );

  if (!workspace || loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12 flex items-center justify-center">
        <LoadingSpinner size="lg" label="Loading payment ledger..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-xl p-6 text-xs text-rose-800 space-y-3">
        <div className="flex items-center gap-2 font-bold">
          <AlertCircle className="w-4 h-4 text-rose-600" />
          Unable to load payment history
        </div>
        <p>{error}</p>
        <button
          type="button"
          onClick={() => void loadPayments()}
          className="px-3 py-1.5 bg-rose-700 text-white rounded-lg font-semibold inline-flex items-center gap-1"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payment History & Billing"
        subtitle={`Consultation payment receipts recorded for ${workspace.organizationName}.`}
      />

      <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 text-teal-900 shadow-xs flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-teal-700 shrink-0 mt-0.5" />
        <div className="text-xs text-teal-800 leading-relaxed">
          Consultation fees are settled directly with your veterinary clinic desk unless online invoicing is enabled by your clinic organization. Recorded receipts appear below automatically.
        </div>
      </div>

      {payments.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center shadow-xs space-y-2">
          <div className="w-12 h-12 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center mx-auto">
            <CreditCard className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-slate-900">No payment receipts yet</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
            No consultation invoices or receipts have been recorded under {workspace.organizationName}.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="relative w-full sm:w-80">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search pet, doctor, gateway, transaction ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Filter payment status"
                className="px-3 py-2 text-xs rounded-lg border border-slate-200 bg-slate-50 text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-teal-700/20"
              >
                <option value="all">All Statuses ({payments.length})</option>
                <option value="paid">Paid</option>
                <option value="pending">Pending</option>
                <option value="failed">Failed</option>
                <option value="refunded">Refunded</option>
              </select>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-1.5 text-slate-600">
                  <span className="font-semibold">From:</span>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    aria-label="Payment start date"
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-700/20"
                  />
                </label>
                <label className="inline-flex items-center gap-1.5 text-slate-600">
                  <span className="font-semibold">To:</span>
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    aria-label="Payment end date"
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-700/20"
                  />
                </label>
                {(fromDate || toDate || searchQuery || statusFilter !== 'all') && (
                  <button
                    type="button"
                    onClick={() => {
                      setFromDate('');
                      setToDate('');
                      setSearchQuery('');
                      setStatusFilter('all');
                    }}
                    className="px-2.5 py-1.5 font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-lg border border-teal-200"
                  >
                    Clear Filters
                  </button>
                )}
              </div>
              <label className="inline-flex items-center gap-1.5 text-slate-600">
                <span className="font-semibold">Sort:</span>
                <select
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value as 'asc' | 'desc')}
                  aria-label="Sort payments"
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-teal-700/20"
                >
                  <option value="desc">Newest First</option>
                  <option value="asc">Oldest First</option>
                </select>
              </label>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
            {filteredPayments.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                No payment receipts match the active filters.
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200">
                      <tr>
                        <th className="py-3 px-4">Date</th>
                        <th className="py-3 px-4">Patient & Doctor</th>
                        <th className="py-3 px-4">Gateway</th>
                        <th className="py-3 px-4">Transaction ID</th>
                        <th className="py-3 px-4">Amount</th>
                        <th className="py-3 px-4">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {pagedPayments.items.map((p) => (
                        <tr key={p.id} className="hover:bg-slate-50/50">
                          <td className="py-3 px-4 text-slate-600 tabular-nums">
                            {new Date(p.paid_at || p.created_at).toLocaleDateString()}
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-bold text-slate-900">
                              {p.pet_name || 'Consultation'}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {p.doctor_name || 'Clinic Veterinarian'}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-slate-600 capitalize">{p.gateway}</td>
                          <td className="py-3 px-4 font-mono text-slate-500">
                            {p.transaction_id || '—'}
                          </td>
                          <td className="py-3 px-4 font-bold text-slate-900 tabular-nums">
                            ${p.amount.toFixed(2)}
                          </td>
                          <td className="py-3 px-4">
                            <StatusBadge status={p.payment_status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  currentPage={pagedPayments.currentPage}
                  totalPages={pagedPayments.totalPages}
                  totalItems={pagedPayments.totalItems}
                  startIndex={pagedPayments.startIndex}
                  endIndex={pagedPayments.endIndex}
                  pageSize={pageSize}
                  onPageChange={setPage}
                  onPageSizeChange={(next) => {
                    setPageSize(next);
                    setPage(1);
                  }}
                  itemLabel="payments"
                />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
