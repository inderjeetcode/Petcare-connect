import React, { useCallback, useEffect, useState } from 'react';
import { useClientWorkspace } from '../../hooks/useClientWorkspace';
import { clientPortalService } from '../../services/clientPortalService';
import { ClientPaymentRecord } from '../../types/client';
import { PageHeader } from '../../components/common/PageHeader';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { StatusBadge } from '../../components/common/StatusBadge';
import {
  CreditCard,
  ShieldCheck,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';

export const ClientPayments: React.FC = () => {
  const { workspace } = useClientWorkspace();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payments, setPayments] = useState<ClientPaymentRecord[]>([]);

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
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
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
                {payments.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/50">
                    <td className="py-3 px-4 text-slate-600">
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
                    <td className="py-3 px-4 font-bold text-slate-900">
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
        </div>
      )}
    </div>
  );
};
