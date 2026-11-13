import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useAdminWorkspace } from '../../hooks/useAdminWorkspace';
import { adminPortalService } from '../../services/adminPortalService';
import { formatSupabaseError } from '../../services/authService';
import { ClientMedicalRecord } from '../../types/client';
import { PageHeader } from '../../components/common/PageHeader';
import { Pagination } from '../../components/common/Pagination';
import {
  compareIsoDates,
  isWithinDateRange,
  paginateItems,
  sortItems,
} from '../../utils/listManagementHelpers';
import {
  ClipboardList,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react';

export const AdminMedicalRecords: React.FC = () => {
  const { workspace } = useAdminWorkspace();
  const { showToast } = useApp();

  const orgId = workspace?.organizationId || '';
  const hasMedicalRead = Boolean(workspace?.canReadMedicalRecords);

  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<ClientMedicalRecord[]>([]);
  const [search, setSearch] = useState('');
  const [recordTypeFilter, setRecordTypeFilter] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const loadRecords = useCallback(async () => {
    if (!orgId || !hasMedicalRead) {
      setRecords([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const overview = await adminPortalService.getClinicalAuditIfAuthorized(
        orgId,
        hasMedicalRead
      );
      setRecords(overview.medicalRecords);
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to load clinical records.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [orgId, hasMedicalRead, showToast]);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  useEffect(() => {
    setPage(1);
  }, [search, recordTypeFilter, fromDate, toDate, sortOrder]);

  const recordTypes = useMemo(
    () => Array.from(new Set(records.map((r) => r.record_type))).sort(),
    [records]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = records.filter((rec) => {
      if (recordTypeFilter !== 'all' && rec.record_type !== recordTypeFilter) return false;
      if (!isWithinDateRange(rec.created_at, fromDate, toDate)) return false;
      if (!q) return true;
      return (
        (rec.pet_name || '').toLowerCase().includes(q) ||
        rec.diagnosis.toLowerCase().includes(q) ||
        (rec.doctor_name || '').toLowerCase().includes(q) ||
        rec.record_type.toLowerCase().includes(q)
      );
    });
    return sortItems(list, (a, b) => compareIsoDates(a.created_at, b.created_at), sortOrder);
  }, [records, search, recordTypeFilter, fromDate, toDate, sortOrder]);

  const paginatedRecords = useMemo(
    () => paginateItems(filtered, page, pageSize),
    [filtered, page, pageSize]
  );

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader
        title={`${workspace?.organizationName || 'Clinic'} — Medical Records Supervision`}
        subtitle="Clinical quality review gated strictly by medical_records.read permissions and PostgreSQL RLS."
        action={
          hasMedicalRead ? (
            <button
              type="button"
              onClick={loadRecords}
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
            In accordance with multi-tenant veterinary privacy rules, raw patient medical records and SOAP notes require the <code className="font-mono bg-slate-100 px-1 py-0.5 rounded">medical_records.read</code> clinical permission (held by attending veterinary doctors). Non-clinical administrators govern appointments, branches, and audit metadata without accessing confidential clinical notes.
          </p>
        </div>
      ) : (
        <>
          <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 text-xs text-teal-900 flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
            <span>
              Authorized dual-role clinical access active (<code className="font-mono">medical_records.read</code>). Private chat message transcripts remain strictly isolated per consultation privacy policy.
            </span>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="relative w-full lg:w-96">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search by patient, diagnosis, record type, or doctor..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-300"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={recordTypeFilter}
                onChange={(e) => setRecordTypeFilter(e.target.value)}
                aria-label="Filter by record type"
                className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
              >
                <option value="all">All Record Types</option>
                {recordTypes.map((rt) => (
                  <option key={rt} value={rt}>
                    {rt.replace('_', ' ')}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                aria-label="From date"
                className="px-2.5 py-2 text-xs border border-slate-300 rounded-lg bg-white"
              />
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                aria-label="To date"
                className="px-2.5 py-2 text-xs border border-slate-300 rounded-lg bg-white"
              />
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as 'desc' | 'asc')}
                aria-label="Sort medical records"
                className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
              >
                <option value="desc">Newest First</option>
                <option value="asc">Oldest First</option>
              </select>
              {(search || recordTypeFilter !== 'all' || fromDate || toDate) && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch('');
                    setRecordTypeFilter('all');
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

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            {loading ? (
              <div className="py-12 flex items-center justify-center gap-2 text-xs text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin text-teal-700" />
                <span>Loading authorized clinical records...</span>
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-500 space-y-2">
                <ClipboardList className="w-7 h-7 text-slate-300 mx-auto" />
                <div>No medical records match the current filters.</div>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                      <tr>
                        <th className="py-3 px-4">Patient</th>
                        <th className="py-3 px-4">Type</th>
                        <th className="py-3 px-4">Diagnosis / Procedure</th>
                        <th className="py-3 px-4">Attending Doctor</th>
                        <th className="py-3 px-4">Logged At</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {paginatedRecords.items.map((rec) => (
                        <tr key={rec.id} className="hover:bg-slate-50/50">
                          <td className="py-3 px-4 font-bold text-slate-900">{rec.pet_name}</td>
                          <td className="py-3 px-4">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-100 text-slate-700">
                              {rec.record_type.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-slate-800">{rec.diagnosis}</td>
                          <td className="py-3 px-4 text-teal-800 font-medium">
                            {rec.doctor_name || 'Veterinary Staff'}
                          </td>
                          <td className="py-3 px-4 font-mono text-[11px] text-slate-500 tabular-nums">
                            {new Date(rec.created_at).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  currentPage={paginatedRecords.currentPage}
                  totalPages={paginatedRecords.totalPages}
                  totalItems={paginatedRecords.totalItems}
                  startIndex={paginatedRecords.startIndex}
                  endIndex={paginatedRecords.endIndex}
                  pageSize={paginatedRecords.pageSize}
                  onPageChange={setPage}
                  onPageSizeChange={(size) => {
                    setPageSize(size);
                    setPage(1);
                  }}
                  itemLabel="medical records"
                />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
};

