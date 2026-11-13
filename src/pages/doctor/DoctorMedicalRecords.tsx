import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { useDoctorWorkspace } from '../../hooks/useDoctorWorkspace';
import { doctorPortalService } from '../../services/doctorPortalService';
import { formatSupabaseError } from '../../services/authService';
import {
  DoctorConsultation,
  DoctorMedicalRecord,
  DoctorPatientDirectoryItem,
  DoctorVaccination,
} from '../../types/doctor';
import { validateAttachmentFile } from '../../utils/clientPortalHelpers';
import {
  validateMedicalRecordInput,
  validateVaccinationInput,
} from '../../utils/doctorPortalHelpers';
import { PageHeader } from '../../components/common/PageHeader';
import { Modal } from '../../components/common/Modal';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { EmptyState } from '../../components/common/EmptyState';
import { Pagination } from '../../components/common/Pagination';
import {
  compareIsoDates,
  isWithinDateRange,
  paginateItems,
  sortItems,
} from '../../utils/listManagementHelpers';
import {
  Download,
  Edit3,
  FileCheck,
  FileText,
  Plus,
  Search,
  ShieldCheck,
  Syringe,
  Upload,
} from 'lucide-react';

export const DoctorMedicalRecords: React.FC = () => {
  const location = useLocation();
  const { showToast } = useApp();
  const { workspace, doctorLoading } = useDoctorWorkspace();

  const initialPetId = (location.state as { petId?: string } | null)?.petId || '';

  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'records' | 'vaccinations'>('records');
  const [records, setRecords] = useState<DoctorMedicalRecord[]>([]);
  const [vaccinations, setVaccinations] = useState<DoctorVaccination[]>([]);
  const [patients, setPatients] = useState<DoctorPatientDirectoryItem[]>([]);
  const [consultations, setConsultations] = useState<DoctorConsultation[]>([]);
  const [search, setSearch] = useState('');
  const [selectedPetFilter, setSelectedPetFilter] = useState(initialPetId);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [recordsPage, setRecordsPage] = useState(1);
  const [vaxPage, setVaxPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Add Medical Record Modal
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [savingRecord, setSavingRecord] = useState(false);
  const [recordFile, setRecordFile] = useState<File | null>(null);
  const [recordForm, setRecordForm] = useState({
    pet_id: initialPetId,
    consultation_id: '',
    record_type: 'clinical_note' as DoctorMedicalRecord['record_type'],
    diagnosis: '',
    notes: '',
  });

  // Amend Medical Record Modal
  const [amendingRecord, setAmendingRecord] = useState<DoctorMedicalRecord | null>(null);
  const [amendDiagnosis, setAmendDiagnosis] = useState('');
  const [amendNotes, setAmendNotes] = useState('');
  const [amendFile, setAmendFile] = useState<File | null>(null);
  const [savingAmendment, setSavingAmendment] = useState(false);

  // Record Vaccination Modal
  const [vaxModalOpen, setVaxModalOpen] = useState(false);
  const [savingVax, setSavingVax] = useState(false);
  const [vaxForm, setVaxForm] = useState({
    pet_id: initialPetId,
    vaccine_name: '',
    administered_date: new Date().toISOString().slice(0, 10),
    next_due_date: '',
    batch_number: '',
    notes: '',
  });

  const [openingAttId, setOpeningAttId] = useState<string | null>(null);

  const loadClinicalData = useCallback(async () => {
    if (!workspace) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [recs, vaxs, pats, cons] = await Promise.all([
        doctorPortalService.getMedicalRecords(workspace.organizationId),
        doctorPortalService.getVaccinations(workspace.organizationId),
        doctorPortalService.getOrganizationPatients(workspace.organizationId),
        doctorPortalService.getConsultations(workspace.organizationId),
      ]);
      setRecords(recs);
      setVaccinations(vaxs);
      setPatients(pats);
      setConsultations(cons);

      if (pats.length > 0) {
        const defaultPet = initialPetId || pats[0].id;
        setRecordForm((prev) => ({ ...prev, pet_id: prev.pet_id || defaultPet }));
        setVaxForm((prev) => ({ ...prev, pet_id: prev.pet_id || defaultPet }));
      }
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to load clinical records.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [workspace, initialPetId, showToast]);

  useEffect(() => {
    if (!doctorLoading) {
      void loadClinicalData();
    }
  }, [doctorLoading, loadClinicalData]);

  const petConsultations = useMemo(
    () => consultations.filter((c) => c.pet_id === recordForm.pet_id),
    [consultations, recordForm.pet_id]
  );

  useEffect(() => {
    setRecordsPage(1);
    setVaxPage(1);
  }, [selectedPetFilter, search, fromDate, toDate, sortOrder, pageSize]);

  const filteredRecords = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = records.filter((rec) => {
      if (selectedPetFilter && rec.pet_id !== selectedPetFilter) return false;
      if (!isWithinDateRange(rec.created_at, fromDate, toDate)) return false;
      if (!q) return true;
      return (
        (rec.pet_name || '').toLowerCase().includes(q) ||
        rec.diagnosis.toLowerCase().includes(q) ||
        rec.notes.toLowerCase().includes(q) ||
        (rec.doctor_name || '').toLowerCase().includes(q)
      );
    });
    return sortItems(list, (a, b) => compareIsoDates(a.created_at, b.created_at), sortOrder);
  }, [records, selectedPetFilter, search, fromDate, toDate, sortOrder]);

  const pagedRecords = useMemo(
    () => paginateItems(filteredRecords, recordsPage, pageSize),
    [filteredRecords, recordsPage, pageSize]
  );

  const filteredVaccinations = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = vaccinations.filter((v) => {
      if (selectedPetFilter && v.pet_id !== selectedPetFilter) return false;
      if (!isWithinDateRange(v.administered_date, fromDate, toDate)) return false;
      if (!q) return true;
      return (
        (v.pet_name || '').toLowerCase().includes(q) ||
        v.vaccine_name.toLowerCase().includes(q) ||
        (v.batch_number || '').toLowerCase().includes(q)
      );
    });
    return sortItems(
      list,
      (a, b) => compareIsoDates(a.administered_date, b.administered_date),
      sortOrder
    );
  }, [vaccinations, selectedPetFilter, search, fromDate, toDate, sortOrder]);

  const pagedVaccinations = useMemo(
    () => paginateItems(filteredVaccinations, vaxPage, pageSize),
    [filteredVaccinations, vaxPage, pageSize]
  );

  const handleSelectFile = (
    file: File | undefined,
    setter: React.Dispatch<React.SetStateAction<File | null>>
  ) => {
    if (!file) return;
    const err = validateAttachmentFile(file);
    if (err) {
      showToast(err, 'error');
      return;
    }
    setter(file);
  };

  const handleCreateRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspace) return;
    const err = validateMedicalRecordInput(recordForm);
    if (err) {
      showToast(err, 'error');
      return;
    }

    setSavingRecord(true);
    try {
      await doctorPortalService.addMedicalRecord({
        organization_id: workspace.organizationId,
        pet_id: recordForm.pet_id,
        consultation_id: recordForm.consultation_id || null,
        record_type: recordForm.record_type,
        diagnosis: recordForm.diagnosis,
        notes: recordForm.notes,
        file: recordFile,
      });
      showToast('Clinical medical record saved.', 'success');
      setAddModalOpen(false);
      setRecordFile(null);
      setRecordForm((prev) => ({
        ...prev,
        consultation_id: '',
        diagnosis: '',
        notes: '',
      }));
      await loadClinicalData();
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to add medical record.'), 'error');
    } finally {
      setSavingRecord(false);
    }
  };

  const handleSubmitAmendment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspace || !amendingRecord) return;
    setSavingAmendment(true);
    try {
      await doctorPortalService.amendMedicalRecord({
        organization_id: workspace.organizationId,
        original_record_id: amendingRecord.id,
        diagnosis: amendDiagnosis,
        notes: amendNotes,
        file: amendFile,
      });
      showToast('Append-only clinical addendum recorded.', 'success');
      setAmendingRecord(null);
      setAmendFile(null);
      await loadClinicalData();
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to record clinical addendum.'), 'error');
    } finally {
      setSavingAmendment(false);
    }
  };

  const handleRecordVaccination = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspace) return;
    const err = validateVaccinationInput(vaxForm);
    if (err) {
      showToast(err, 'error');
      return;
    }

    setSavingVax(true);
    try {
      await doctorPortalService.recordVaccination({
        organization_id: workspace.organizationId,
        pet_id: vaxForm.pet_id,
        vaccine_name: vaxForm.vaccine_name,
        administered_date: vaxForm.administered_date,
        next_due_date: vaxForm.next_due_date || null,
        batch_number: vaxForm.batch_number || null,
        notes: vaxForm.notes || null,
      });
      showToast('Vaccination recorded in patient immunization registry.', 'success');
      setVaxModalOpen(false);
      setVaxForm((prev) => ({
        ...prev,
        vaccine_name: '',
        next_due_date: '',
        batch_number: '',
        notes: '',
      }));
      await loadClinicalData();
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to record vaccination.'), 'error');
    } finally {
      setSavingVax(false);
    }
  };

  const handleOpenAttachment = async (objectPath: string, attId: string) => {
    setOpeningAttId(attId);
    try {
      const signedUrl = await doctorPortalService.createSignedAttachmentUrl(
        objectPath,
        300
      );
      const anchor = document.createElement('a');
      anchor.href = signedUrl;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.click();
    } catch (err) {
      showToast(formatSupabaseError(err, 'Unable to download clinical attachment.'), 'error');
    } finally {
      setOpeningAttId(null);
    }
  };

  if (doctorLoading || loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-10 flex justify-center">
        <LoadingSpinner label="Loading clinical records & immunization registry..." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clinical Medical Records & Vaccinations"
        subtitle={`Organization-wide clinical documentation, append-only addenda, private diagnostic uploads, and vaccinations for ${workspace?.organizationName || ''}.`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={patients.length === 0}
              onClick={() => setVaxModalOpen(true)}
              className="px-3.5 py-2 text-xs font-semibold text-teal-800 bg-teal-50 border border-teal-200 hover:bg-teal-100 disabled:opacity-50 rounded-lg flex items-center gap-1.5"
            >
              <Syringe className="w-4 h-4" />
              Record Vaccination
            </button>
            <button
              type="button"
              disabled={patients.length === 0}
              onClick={() => setAddModalOpen(true)}
              className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg flex items-center gap-1.5 shadow-xs"
            >
              <Plus className="w-4 h-4" />
              Add Medical Record
            </button>
          </div>
        }
      />

      <div className="p-3.5 rounded-xl bg-teal-50/70 border border-teal-200 text-xs text-teal-900 flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-teal-700 shrink-0" />
        <span>
          Immutable clinical ledger: Original entries cannot be overwritten or deleted; updates create a timestamped addendum linked to the original record.
        </span>
      </div>

      {/* Tabs + Filters */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setActiveTab('records')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg flex items-center gap-1.5 ${
                activeTab === 'records'
                  ? 'bg-teal-700 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              Medical Records ({filteredRecords.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('vaccinations')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg flex items-center gap-1.5 ${
                activeTab === 'vaccinations'
                  ? 'bg-teal-700 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Syringe className="w-3.5 h-3.5" />
              Vaccinations ({filteredVaccinations.length})
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedPetFilter}
              onChange={(e) => setSelectedPetFilter(e.target.value)}
              aria-label="Filter clinical records by patient"
              className="px-3 py-2 text-xs rounded-lg border border-slate-200 bg-white"
            >
              <option value="">All Organization Patients</option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.species})
                </option>
              ))}
            </select>

            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search diagnosis, vaccine, doctor..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
              />
            </div>
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
                aria-label="Clinical records start date"
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-700/20"
              />
            </label>
            <label className="inline-flex items-center gap-1.5 text-slate-600">
              <span className="font-semibold">To:</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                aria-label="Clinical records end date"
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-700/20"
              />
            </label>
            {(fromDate || toDate || selectedPetFilter || search) && (
              <button
                type="button"
                onClick={() => {
                  setFromDate('');
                  setToDate('');
                  setSelectedPetFilter('');
                  setSearch('');
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
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-800 font-medium"
            >
              <option value="desc">Newest First</option>
              <option value="asc">Oldest First</option>
            </select>
          </label>
        </div>
      </div>

      {activeTab === 'records' ? (
        filteredRecords.length === 0 ? (
          <EmptyState
            icon={FileCheck}
            title="No Medical Records Found"
            description="Add a clinical examination note, diagnostic report, surgical log, or discharge summary."
          />
        ) : (
          <div className="space-y-4">
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
                        Addendum to #{rec.amended_from_id.slice(0, 8)}
                      </span>
                    )}
                    <h3 className="text-sm font-bold text-slate-900">{rec.diagnosis}</h3>
                  </div>
                  <div className="text-xs text-slate-500 flex items-center gap-2">
                    <span>
                      Patient: <strong className="text-slate-900">{rec.pet_name}</strong>
                    </span>
                    <span>·</span>
                    <span>{rec.doctor_name}</span>
                    <span>·</span>
                    <span>{new Date(rec.created_at).toLocaleDateString()}</span>
                  </div>
                </div>

                <p className="text-xs text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-100 whitespace-pre-line leading-relaxed">
                  {rec.notes}
                </p>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {rec.attachments.map((att) => (
                      <button
                        key={att.id}
                        type="button"
                        disabled={openingAttId === att.id}
                        onClick={() => void handleOpenAttachment(att.object_path, att.id)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-teal-50 text-teal-800 border border-teal-200 hover:bg-teal-100 text-xs font-semibold"
                      >
                        <Download className="w-3.5 h-3.5" />
                        {openingAttId === att.id
                          ? 'Generating Link...'
                          : att.original_filename}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setAmendingRecord(rec);
                      setAmendDiagnosis(rec.diagnosis);
                      setAmendNotes('');
                    }}
                    className="px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 border border-slate-200 rounded-lg flex items-center gap-1"
                  >
                    <Edit3 className="w-3.5 h-3.5 text-teal-700" />
                    Add Addendum
                  </button>
                </div>
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
                itemLabel="medical records"
              />
            </div>
          </div>
        )
      ) : filteredVaccinations.length === 0 ? (
        <EmptyState
          icon={Syringe}
          title="No Vaccination Records Found"
          description="Record administered immunizations and booster schedules for organization pets."
        />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Patient</th>
                  <th className="py-3 px-4">Vaccine</th>
                  <th className="py-3 px-4">Administered</th>
                  <th className="py-3 px-4">Next Booster Due</th>
                  <th className="py-3 px-4">Batch #</th>
                  <th className="py-3 px-4">Clinician</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pagedVaccinations.items.map((vax) => (
                  <tr key={vax.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-bold text-slate-900">
                      {vax.pet_name}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-800">{vax.vaccine_name}</div>
                      {vax.notes && (
                        <div className="text-[11px] text-slate-500">{vax.notes}</div>
                      )}
                    </td>
                    <td className="py-3 px-4 tabular-nums">{vax.administered_date}</td>
                    <td className="py-3 px-4 font-semibold text-teal-800 tabular-nums">
                      {vax.next_due_date || 'Single Dose / N/A'}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-600">
                      {vax.batch_number || '—'}
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      {vax.administered_by || 'Clinic Doctor'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            currentPage={pagedVaccinations.currentPage}
            totalPages={pagedVaccinations.totalPages}
            totalItems={pagedVaccinations.totalItems}
            startIndex={pagedVaccinations.startIndex}
            endIndex={pagedVaccinations.endIndex}
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

      {/* Add Medical Record Modal */}
      <Modal
        isOpen={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        title="Log Veterinary Medical Record"
        subtitle="Document clinical examination notes, diagnostic reports, surgical logs, or discharge summaries."
      >
        <form onSubmit={handleCreateRecord} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">Patient *</label>
              <select
                required
                value={recordForm.pet_id}
                onChange={(e) =>
                  setRecordForm({
                    ...recordForm,
                    pet_id: e.target.value,
                    consultation_id: '',
                  })
                }
                className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white"
              >
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.species} · {p.breed})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Record Type *</label>
              <select
                value={recordForm.record_type}
                onChange={(e) =>
                  setRecordForm({
                    ...recordForm,
                    record_type: e.target.value as DoctorMedicalRecord['record_type'],
                  })
                }
                className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white"
              >
                <option value="clinical_note">Clinical Examination Note</option>
                <option value="lab_report">Diagnostic Lab Report</option>
                <option value="surgery">Surgical Procedure Log</option>
                <option value="discharge">Discharge Summary</option>
                <option value="vaccination">Vaccination Clinical Entry</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">
              Linked Consultation (Optional)
            </label>
            <select
              value={recordForm.consultation_id}
              onChange={(e) =>
                setRecordForm({ ...recordForm, consultation_id: e.target.value })
              }
              className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white"
            >
              <option value="">Standalone In-Clinic Entry</option>
              {petConsultations.map((c) => (
                <option key={c.id} value={c.id}>
                  {new Date(c.created_at).toLocaleDateString()} — {c.consultation_reason.slice(0, 60)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">
              Clinical Diagnosis / Finding *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Mild Acute Gastroenteritis"
              value={recordForm.diagnosis}
              onChange={(e) =>
                setRecordForm({ ...recordForm, diagnosis: e.target.value })
              }
              className="w-full px-3 py-2 rounded-lg border border-slate-200"
            />
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">
              Detailed Clinical Notes *
            </label>
            <textarea
              rows={4}
              required
              placeholder="Physical exam, diagnostics, procedures performed, treatment plan..."
              value={recordForm.notes}
              onChange={(e) => setRecordForm({ ...recordForm, notes: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-200"
            />
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">
              Private Lab PDF / Diagnostic Image (Optional, max 10 MB)
            </label>
            <label className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 cursor-pointer">
              <span className="truncate text-slate-600 flex items-center gap-1.5">
                <Upload className="w-3.5 h-3.5 text-teal-700" />
                {recordFile ? recordFile.name : 'Choose JPEG, PNG, WebP, or PDF'}
              </span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="hidden"
                onChange={(e) => handleSelectFile(e.target.files?.[0], setRecordFile)}
              />
            </label>
          </div>

          <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setAddModalOpen(false)}
              className="px-4 py-2 font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingRecord}
              className="px-5 py-2 font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg shadow-xs"
            >
              {savingRecord ? 'Saving...' : 'Save Medical Record'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Amend Record Modal */}
      <Modal
        isOpen={Boolean(amendingRecord)}
        onClose={() => setAmendingRecord(null)}
        title="Add Append-Only Clinical Addendum"
        subtitle={`Linked to original record for ${amendingRecord?.pet_name || ''}`}
      >
        <form onSubmit={handleSubmitAmendment} className="space-y-4 text-xs">
          <div>
            <label className="block font-bold text-slate-700 mb-1">
              Updated Diagnosis *
            </label>
            <input
              type="text"
              required
              value={amendDiagnosis}
              onChange={(e) => setAmendDiagnosis(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200"
            />
          </div>
          <div>
            <label className="block font-bold text-slate-700 mb-1">
              Addendum Notes *
            </label>
            <textarea
              rows={4}
              required
              placeholder="Document follow-up lab confirmation, correction, or addendum details..."
              value={amendNotes}
              onChange={(e) => setAmendNotes(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200"
            />
          </div>
          <div>
            <label className="block font-bold text-slate-700 mb-1">
              Attach Addendum File (Optional)
            </label>
            <label className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 cursor-pointer">
              <span className="truncate text-slate-600 flex items-center gap-1.5">
                <Upload className="w-3.5 h-3.5 text-teal-700" />
                {amendFile ? amendFile.name : 'Choose JPEG, PNG, WebP, or PDF'}
              </span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="hidden"
                onChange={(e) => handleSelectFile(e.target.files?.[0], setAmendFile)}
              />
            </label>
          </div>
          <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setAmendingRecord(null)}
              className="px-4 py-2 font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingAmendment}
              className="px-5 py-2 font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg"
            >
              {savingAmendment ? 'Saving...' : 'Save Addendum'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Record Vaccination Modal */}
      <Modal
        isOpen={vaxModalOpen}
        onClose={() => setVaxModalOpen(false)}
        title="Record Patient Vaccination"
        subtitle="Log administered vaccine, lot/batch number, and next booster due date."
      >
        <form onSubmit={handleRecordVaccination} className="space-y-4 text-xs">
          <div>
            <label className="block font-bold text-slate-700 mb-1">Patient *</label>
            <select
              required
              value={vaxForm.pet_id}
              onChange={(e) => setVaxForm({ ...vaxForm, pet_id: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white"
            >
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.species} · {p.breed})
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Vaccine Name *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Rabies (Nobivac 3-Year)"
                value={vaxForm.vaccine_name}
                onChange={(e) =>
                  setVaxForm({ ...vaxForm, vaccine_name: e.target.value })
                }
                className="w-full px-3 py-2 rounded-lg border border-slate-200"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Lot / Batch Number
              </label>
              <input
                type="text"
                placeholder="e.g. LOT-A9482"
                value={vaxForm.batch_number}
                onChange={(e) =>
                  setVaxForm({ ...vaxForm, batch_number: e.target.value })
                }
                className="w-full px-3 py-2 rounded-lg border border-slate-200"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Administered Date *
              </label>
              <input
                type="date"
                required
                value={vaxForm.administered_date}
                onChange={(e) =>
                  setVaxForm({ ...vaxForm, administered_date: e.target.value })
                }
                className="w-full px-3 py-2 rounded-lg border border-slate-200"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Next Booster Due Date
              </label>
              <input
                type="date"
                value={vaxForm.next_due_date}
                onChange={(e) =>
                  setVaxForm({ ...vaxForm, next_due_date: e.target.value })
                }
                className="w-full px-3 py-2 rounded-lg border border-slate-200"
              />
            </div>
          </div>
          <div>
            <label className="block font-bold text-slate-700 mb-1">Notes</label>
            <textarea
              rows={2}
              placeholder="Injection site, reaction monitoring notes..."
              value={vaxForm.notes}
              onChange={(e) => setVaxForm({ ...vaxForm, notes: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-200"
            />
          </div>
          <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setVaxModalOpen(false)}
              className="px-4 py-2 font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingVax}
              className="px-5 py-2 font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg"
            >
              {savingVax ? 'Recording...' : 'Save Vaccination'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
