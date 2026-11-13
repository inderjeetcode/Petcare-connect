import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useAdminWorkspace } from '../../hooks/useAdminWorkspace';
import { adminPortalService } from '../../services/adminPortalService';
import { formatSupabaseError } from '../../services/authService';
import { ClientPrescription } from '../../types/client';
import { PageHeader } from '../../components/common/PageHeader';
import { PrescriptionModal } from '../../components/common/PrescriptionModal';
import {
  FileText,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react';

export const AdminPrescriptions: React.FC = () => {
  const { workspace } = useAdminWorkspace();
  const { showToast } = useApp();

  const orgId = workspace?.organizationId || '';
  const hasMedicalRead = Boolean(workspace?.canReadMedicalRecords);

  const [loading, setLoading] = useState(true);
  const [prescriptions, setPrescriptions] = useState<ClientPrescription[]>([]);
  const [search, setSearch] = useState('');
  const [selectedRx, setSelectedRx] = useState<ClientPrescription | null>(null);

  const loadPrescriptions = useCallback(async () => {
    if (!orgId || !hasMedicalRead) {
      setPrescriptions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const overview = await adminPortalService.getClinicalAuditIfAuthorized(
        orgId,
        hasMedicalRead
      );
      setPrescriptions(overview.prescriptions);
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to load prescriptions.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [orgId, hasMedicalRead, showToast]);

  useEffect(() => {
    loadPrescriptions();
  }, [loadPrescriptions]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return prescriptions;
    return prescriptions.filter(
      (rx) =>
        (rx.pet_name || '').toLowerCase().includes(q) ||
        (rx.doctor_name || '').toLowerCase().includes(q) ||
        rx.diagnosis.toLowerCase().includes(q)
    );
  }, [prescriptions, search]);

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader
        title={`${workspace?.organizationName || 'Clinic'} — Prescription Audit`}
        subtitle="Clinical posology oversight gated strictly by medical_records.read permissions and PostgreSQL RLS."
        action={
          hasMedicalRead ? (
            <button
              type="button"
              onClick={loadPrescriptions}
              disabled={loading}
              className="px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          ) : undefined
        }
      />

      {!hasMedicalRead ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center space-y-3">
          <div className="w-11 h-11 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center mx-auto">
            <Lock className="w-5 h-5" />
          </div>
          <h2 className="text-sm font-bold text-slate-900">
            Clinical Privacy Boundary Enforced
          </h2>
          <p className="text-xs text-slate-600 max-w-xl mx-auto leading-relaxed">
            Prescription details and medication dosages are protected by PostgreSQL Row Level Security and require the <code className="font-mono bg-slate-100 px-1 py-0.5 rounded">medical_records.read</code> permission held by veterinary doctors. Dual-role doctor-administrators can audit organization prescriptions here.
          </p>
        </div>
      ) : (
        <>
          <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 text-xs text-teal-900 flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
            <span>
              Authorized dual-role clinical access active (<code className="font-mono">medical_records.read</code>).
            </span>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 flex items-center justify-between">
            <div className="relative w-full sm:w-96">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Audit by doctor, patient, or diagnosis..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-300"
              />
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
            {loading ? (
              <div className="py-12 flex items-center justify-center gap-2 text-xs text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin text-teal-700" />
                <span>Loading organization prescriptions...</span>
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-500 space-y-2">
                <FileText className="w-7 h-7 text-slate-300 mx-auto" />
                <div>No prescriptions match the current search.</div>
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4">Patient</th>
                    <th className="py-3 px-4">Prescribing Doctor</th>
                    <th className="py-3 px-4">Clinical Diagnosis</th>
                    <th className="py-3 px-4">Medications</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Issue Date</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((rx) => (
                    <tr key={rx.id} className="hover:bg-slate-50/50">
                      <td className="py-3 px-4 font-semibold text-slate-900">{rx.pet_name}</td>
                      <td className="py-3 px-4 font-medium text-teal-900">{rx.doctor_name}</td>
                      <td className="py-3 px-4 text-slate-700">{rx.diagnosis}</td>
                      <td className="py-3 px-4 font-mono font-bold text-slate-800">
                        {rx.items.length} item(s)
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            rx.status === 'void'
                              ? 'bg-rose-50 text-rose-700 border border-rose-200'
                              : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          }`}
                        >
                          {rx.status || 'issued'}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-500">
                        {new Date(rx.created_at).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => setSelectedRx(rx)}
                          className="px-3 py-1 text-xs font-semibold text-teal-700 hover:bg-teal-50 border border-teal-200 rounded-lg whitespace-nowrap"
                        >
                          Inspect Rx
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      <PrescriptionModal
        prescription={selectedRx}
        isOpen={Boolean(selectedRx)}
        onClose={() => setSelectedRx(null)}
        organizationName={workspace?.organizationName}
      />
    </div>
  );
};
