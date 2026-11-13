import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useClientWorkspace } from '../../hooks/useClientWorkspace';
import { clientPortalService } from '../../services/clientPortalService';
import { ClientPrescription } from '../../types/client';
import { PageHeader } from '../../components/common/PageHeader';
import { PrescriptionModal } from '../../components/common/PrescriptionModal';
import { StatusBadge } from '../../components/common/StatusBadge';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import {
  FileText,
  Search,
  Calendar,
  Pill,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';

export const ClientPrescriptions: React.FC = () => {
  const { workspace } = useClientWorkspace();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prescriptions, setPrescriptions] = useState<ClientPrescription[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'issued' | 'void'>('all');
  const [selectedRx, setSelectedRx] = useState<ClientPrescription | null>(null);

  const loadPrescriptions = useCallback(async () => {
    if (!workspace) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await clientPortalService.getPrescriptions(
        workspace.organizationId,
        undefined,
        workspace.profileName
      );
      setPrescriptions(list);
    } catch (err: any) {
      setError(err.message || 'Unable to load prescriptions.');
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => {
    void loadPrescriptions();
  }, [loadPrescriptions]);

  const filteredRx = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return prescriptions.filter((rx) => {
      const matchesStatus = statusFilter === 'all' || rx.status === statusFilter;
      const matchesSearch =
        !q ||
        (rx.pet_name || '').toLowerCase().includes(q) ||
        rx.diagnosis.toLowerCase().includes(q) ||
        (rx.doctor_name || '').toLowerCase().includes(q) ||
        rx.items.some((i) => i.medicine_name.toLowerCase().includes(q));
      return matchesStatus && matchesSearch;
    });
  }, [prescriptions, statusFilter, searchQuery]);

  if (!workspace || loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12 flex items-center justify-center">
        <LoadingSpinner size="lg" label="Loading digital prescriptions..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-xl p-6 text-xs text-rose-800 space-y-3">
        <div className="flex items-center gap-2 font-bold">
          <AlertCircle className="w-4 h-4 text-rose-600" />
          Unable to load prescriptions
        </div>
        <p>{error}</p>
        <button
          type="button"
          onClick={() => void loadPrescriptions()}
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
        title="Digital Prescriptions"
        subtitle={`Verified veterinary prescriptions issued within ${workspace.organizationName}.`}
      />

      {/* Search & Filter */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
        <div className="relative w-full sm:w-96">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by pet, diagnosis, doctor, or medication..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
          />
        </div>

        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
          {[
            { key: 'all', label: `All (${prescriptions.length})` },
            {
              key: 'issued',
              label: `Active (${prescriptions.filter((p) => p.status === 'issued').length})`,
            },
            {
              key: 'void',
              label: `Voided (${prescriptions.filter((p) => p.status === 'void').length})`,
            },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setStatusFilter(tab.key as any)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                statusFilter === tab.key
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Prescriptions Grid */}
      {filteredRx.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center space-y-2">
          <FileText className="w-8 h-8 text-slate-300 mx-auto" />
          <h3 className="text-sm font-bold text-slate-800">No prescriptions found</h3>
          <p className="text-xs text-slate-500">
            Prescriptions issued by your clinic veterinarians will appear here automatically.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filteredRx.map((rx) => (
            <div
              key={rx.id}
              className={`bg-white rounded-xl border p-5 shadow-xs transition-all flex flex-col justify-between ${
                rx.status === 'void'
                  ? 'border-rose-200 bg-rose-50/20'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={rx.status} />
                      <span className="text-[10px] font-mono text-slate-400">
                        #{rx.id.slice(0, 8)}
                      </span>
                    </div>
                    <h3 className="text-base font-bold text-slate-900 mt-1">
                      {rx.pet_name} ·{' '}
                      <span className="text-slate-600 font-semibold">{rx.diagnosis}</span>
                    </h3>
                  </div>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-teal-50 text-teal-800 border border-teal-200 shrink-0">
                    {rx.items.length} Medicine(s)
                  </span>
                </div>

                {rx.status === 'void' && rx.void_reason && (
                  <div className="mt-2 p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800">
                    <strong>Void Reason:</strong> {rx.void_reason}
                  </div>
                )}

                <div className="text-xs text-slate-500 mt-2 flex items-center gap-2">
                  <span>
                    Doctor: <strong className="text-slate-800">{rx.doctor_name}</strong>
                  </span>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    {new Date(rx.created_at).toLocaleDateString()}
                  </span>
                </div>

                <div className="mt-4 space-y-2 bg-slate-50 p-3 rounded-lg border border-slate-100">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                    <Pill className="w-3.5 h-3.5 text-teal-700" /> Prescribed Medications:
                  </span>
                  {rx.items.map((item) => (
                    <div
                      key={item.id}
                      className="text-xs flex items-start justify-between gap-2 pt-1 border-t border-slate-200/50"
                    >
                      <div>
                        <strong className="text-slate-900">{item.medicine_name}</strong>
                        {item.instructions && (
                          <div className="text-[11px] text-slate-500">{item.instructions}</div>
                        )}
                      </div>
                      <span className="text-slate-700 font-medium shrink-0 bg-white px-2 py-0.5 rounded border border-slate-200">
                        {item.dosage} ({item.duration})
                      </span>
                    </div>
                  ))}
                </div>

                {rx.instructions && (
                  <p className="text-xs text-slate-600 mt-3 italic line-clamp-2">
                    "{rx.instructions}"
                  </p>
                )}
              </div>

              <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs text-slate-500">
                  Follow-up:{' '}
                  {rx.follow_up_date
                    ? new Date(rx.follow_up_date).toLocaleDateString()
                    : 'As needed'}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedRx(rx)}
                  className="px-3.5 py-1.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors flex items-center gap-1.5 shadow-xs"
                >
                  <FileText className="w-3.5 h-3.5" />
                  View & Print PDF
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <PrescriptionModal
        prescription={selectedRx}
        isOpen={Boolean(selectedRx)}
        onClose={() => setSelectedRx(null)}
        organizationName={workspace.organizationName}
      />
    </div>
  );
};
