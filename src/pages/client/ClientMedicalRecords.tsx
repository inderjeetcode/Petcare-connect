import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useClientWorkspace } from '../../hooks/useClientWorkspace';
import { clientPortalService } from '../../services/clientPortalService';
import {
  ClientAttachment,
  ClientMedicalRecord,
  ClientPet,
  ClientVaccination,
} from '../../types/client';
import { PageHeader } from '../../components/common/PageHeader';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { Modal } from '../../components/common/Modal';
import { Pagination } from '../../components/common/Pagination';
import {
  compareIsoDates,
  isWithinDateRange,
  paginateItems,
  sortItems,
} from '../../utils/listManagementHelpers';
import {
  ClipboardList,
  Search,
  Calendar,
  Download,
  AlertCircle,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';

export const ClientMedicalRecords: React.FC = () => {
  const { showToast } = useApp();
  const { workspace } = useClientWorkspace();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [records, setRecords] = useState<ClientMedicalRecord[]>([]);
  const [vaccinations, setVaccinations] = useState<ClientVaccination[]>([]);
  const [pets, setPets] = useState<ClientPet[]>([]);

  const [selectedPetId, setSelectedPetId] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<'records' | 'vaccinations'>('records');
  const [searchQuery, setSearchQuery] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [recordsPage, setRecordsPage] = useState(1);
  const [vaxPage, setVaxPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [openingId, setOpeningId] = useState<string | null>(null);
  const [previewDoc, setPreviewDoc] = useState<{
    attachment: ClientAttachment;
    signedUrl: string;
  } | null>(null);

  const loadData = useCallback(async () => {
    if (!workspace) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [recs, vaxes, petList] = await Promise.all([
        clientPortalService.getMedicalRecords(workspace.organizationId),
        clientPortalService.getVaccinations(workspace.organizationId),
        clientPortalService.getPets(workspace.organizationId),
      ]);
      setRecords(recs);
      setVaccinations(vaxes);
      setPets(petList);
    } catch (err: any) {
      setError(err.message || 'Unable to load clinical records.');
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    setRecordsPage(1);
    setVaxPage(1);
  }, [selectedPetId, searchQuery, fromDate, toDate, sortOrder, pageSize]);

  const filteredRecords = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = records.filter((rec) => {
      const matchesPet = selectedPetId === 'all' || rec.pet_id === selectedPetId;
      const matchesDate = isWithinDateRange(rec.created_at, fromDate, toDate);
      const matchesSearch =
        !q ||
        rec.diagnosis.toLowerCase().includes(q) ||
        rec.notes.toLowerCase().includes(q) ||
        (rec.pet_name || '').toLowerCase().includes(q);
      return matchesPet && matchesDate && matchesSearch;
    });
    return sortItems(
      filtered,
      (a, b) => compareIsoDates(a.created_at, b.created_at),
      sortOrder
    );
  }, [records, selectedPetId, searchQuery, fromDate, toDate, sortOrder]);

  const pagedRecords = useMemo(
    () => paginateItems(filteredRecords, recordsPage, pageSize),
    [filteredRecords, recordsPage, pageSize]
  );

  const filteredVaccines = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = vaccinations.filter((vax) => {
      const matchesPet = selectedPetId === 'all' || vax.pet_id === selectedPetId;
      const matchesDate = isWithinDateRange(vax.administered_date, fromDate, toDate);
      const matchesSearch =
        !q ||
        vax.vaccine_name.toLowerCase().includes(q) ||
        (vax.notes || '').toLowerCase().includes(q) ||
        (vax.pet_name || '').toLowerCase().includes(q);
      return matchesPet && matchesDate && matchesSearch;
    });
    return sortItems(
      filtered,
      (a, b) => compareIsoDates(a.administered_date, b.administered_date),
      sortOrder
    );
  }, [vaccinations, selectedPetId, searchQuery, fromDate, toDate, sortOrder]);

  const pagedVaccines = useMemo(
    () => paginateItems(filteredVaccines, vaxPage, pageSize),
    [filteredVaccines, vaxPage, pageSize]
  );

  const handleOpenAttachment = async (att: ClientAttachment) => {
    setOpeningId(att.id);
    try {
      const signedUrl = await clientPortalService.createSignedAttachmentUrl(
        att.object_path,
        300
      );
      setPreviewDoc({ attachment: att, signedUrl });
    } catch (err: any) {
      showToast(err.message || 'Unable to generate secure download link.', 'error');
    } finally {
      setOpeningId(null);
    }
  };

  if (!workspace || loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12 flex items-center justify-center">
        <LoadingSpinner size="lg" label="Loading medical records & immunizations..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-xl p-6 text-xs text-rose-800 space-y-3">
        <div className="flex items-center gap-2 font-bold">
          <AlertCircle className="w-4 h-4 text-rose-600" />
          Unable to load medical records
        </div>
        <p>{error}</p>
        <button
          type="button"
          onClick={() => void loadData()}
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
        title="Pet Medical Records & Immunizations"
        subtitle={`Read-only longitudinal veterinary records for your pets in ${workspace.organizationName}.`}
      />

      {/* Immutability Notice */}
      <div className="bg-teal-50 border border-teal-200 rounded-xl p-3.5 text-xs text-teal-900 flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-teal-700 shrink-0" />
        <span>
          Clinical records are append-only and read-only for pet owners. Any clinic corrections appear as linked amended entries to preserve complete medical history.
        </span>
      </div>

      {/* Filters & Tabs */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-1">
            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search diagnosis, vaccine, notes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
              />
            </div>

            <select
              value={selectedPetId}
              onChange={(e) => setSelectedPetId(e.target.value)}
              aria-label="Filter by pet"
              className="px-3 py-2 text-xs rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
            >
              <option value="all">All Pets ({pets.length})</option>
              {pets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.species})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setActiveTab('records')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                activeTab === 'records'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Clinical Records ({filteredRecords.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('vaccinations')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                activeTab === 'vaccinations'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Vaccination Ledger ({filteredVaccines.length})
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-1.5 text-slate-600">
              <span className="font-semibold">From:</span>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                aria-label="Records start date"
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-700/20"
              />
            </label>
            <label className="inline-flex items-center gap-1.5 text-slate-600">
              <span className="font-semibold">To:</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                aria-label="Records end date"
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-700/20"
              />
            </label>
            {(fromDate || toDate || selectedPetId !== 'all' || searchQuery) && (
              <button
                type="button"
                onClick={() => {
                  setFromDate('');
                  setToDate('');
                  setSelectedPetId('all');
                  setSearchQuery('');
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
              aria-label="Sort clinical records"
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-teal-700/20"
            >
              <option value="desc">Newest First</option>
              <option value="asc">Oldest First</option>
            </select>
          </label>
        </div>
      </div>

      {/* Records Tab */}
      {activeTab === 'records' && (
        <div className="space-y-4">
          {filteredRecords.length === 0 ? (
            <div className="p-12 text-center bg-white rounded-xl border border-slate-200">
              <ClipboardList className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-xs text-slate-500">
                No clinical medical records logged for this selection yet.
              </p>
            </div>
          ) : (
            <>
            {pagedRecords.items.map((rec) => (
              <div
                key={rec.id}
                className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded text-xs font-bold uppercase tracking-wider bg-teal-50 text-teal-800 border border-teal-200">
                      {rec.record_type.replace('_', ' ')}
                    </span>
                    {rec.amended_from_id && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-50 text-amber-800 border border-amber-200">
                        Amended Record
                      </span>
                    )}
                    <h3 className="text-sm font-bold text-slate-900">{rec.diagnosis}</h3>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-slate-400">
                    <span>
                      Patient: <strong className="text-slate-700">{rec.pet_name}</strong>
                    </span>
                    <span>·</span>
                    <span>{rec.doctor_name}</span>
                    <span>·</span>
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" />
                      {new Date(rec.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                <p className="text-xs text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-100 leading-relaxed whitespace-pre-line">
                  {rec.notes}
                </p>

                {rec.attachments.length > 0 && (
                  <div className="pt-1 flex flex-wrap gap-2">
                    {rec.attachments.map((att) => (
                      <button
                        key={att.id}
                        type="button"
                        disabled={openingId === att.id}
                        onClick={() => void handleOpenAttachment(att)}
                        className="px-3 py-1.5 text-xs font-semibold text-teal-700 hover:bg-teal-50 border border-teal-200 rounded-lg transition-colors flex items-center gap-1.5"
                      >
                        <Download className="w-3.5 h-3.5" />
                        {openingId === att.id ? 'Generating URL...' : att.original_filename}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
              <Pagination
                currentPage={pagedRecords.currentPage}
                totalPages={pagedRecords.totalPages}
                totalItems={pagedRecords.totalItems}
                startIndex={pagedRecords.startIndex}
                endIndex={pagedRecords.endIndex}
                pageSize={pageSize}
                onPageChange={setRecordsPage}
                onPageSizeChange={(next) => {
                  setPageSize(next);
                  setRecordsPage(1);
                }}
                itemLabel="clinical records"
              />
            </div>
            </>
          )}
        </div>
      )}

      {/* Vaccinations Tab */}
      {activeTab === 'vaccinations' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
          {filteredVaccines.length === 0 ? (
            <div className="p-12 text-center text-xs text-slate-500">
              No vaccination records logged for this selection yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4">Pet</th>
                    <th className="py-3 px-4">Immunization Name</th>
                    <th className="py-3 px-4">Administered Date</th>
                    <th className="py-3 px-4">Next Due Date</th>
                    <th className="py-3 px-4">Batch #</th>
                    <th className="py-3 px-4">Administered By</th>
                    <th className="py-3 px-4">Clinical Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pagedVaccines.items.map((v) => (
                    <tr key={v.id} className="hover:bg-slate-50/50">
                      <td className="py-3 px-4 font-bold text-slate-900">{v.pet_name}</td>
                      <td className="py-3 px-4 font-bold text-teal-900">{v.vaccine_name}</td>
                      <td className="py-3 px-4 text-slate-600 tabular-nums">{v.administered_date}</td>
                      <td className="py-3 px-4 font-bold text-emerald-700 tabular-nums">
                        {v.next_due_date || '—'}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-500">
                        {v.batch_number || '—'}
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        {v.administered_by || 'Clinic Veterinarian'}
                      </td>
                      <td className="py-3 px-4 text-slate-500">{v.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination
                currentPage={pagedVaccines.currentPage}
                totalPages={pagedVaccines.totalPages}
                totalItems={pagedVaccines.totalItems}
                startIndex={pagedVaccines.startIndex}
                endIndex={pagedVaccines.endIndex}
                pageSize={pageSize}
                onPageChange={setVaxPage}
                onPageSizeChange={(next) => {
                  setPageSize(next);
                  setVaxPage(1);
                }}
                itemLabel="vaccinations"
              />
            </div>
          )}
        </div>
      )}

      {/* Signed URL Attachment Preview Modal */}
      <Modal
        isOpen={Boolean(previewDoc)}
        onClose={() => setPreviewDoc(null)}
        title={previewDoc?.attachment.original_filename || 'Diagnostic Document'}
        subtitle="Time-limited signed download URL (expires in 5 minutes)"
        maxWidth="2xl"
      >
        {previewDoc && (
          <div className="space-y-4">
            {previewDoc.attachment.mime_type.startsWith('image/') ? (
              <img
                src={previewDoc.signedUrl}
                alt={previewDoc.attachment.original_filename}
                className="max-h-[60vh] w-full object-contain rounded-lg border border-slate-200 bg-slate-50"
              />
            ) : (
              <iframe
                src={previewDoc.signedUrl}
                title={previewDoc.attachment.original_filename}
                className="w-full h-[60vh] rounded-lg border border-slate-200 bg-slate-50"
              />
            )}
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setPreviewDoc(null)}
                className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg"
              >
                Close
              </button>
              <a
                href={previewDoc.signedUrl}
                download={previewDoc.attachment.original_filename}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3.5 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg inline-flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                Download Original
              </a>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
