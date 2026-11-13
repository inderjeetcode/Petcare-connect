import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useDoctorWorkspace } from '../../hooks/useDoctorWorkspace';
import { doctorPortalService } from '../../services/doctorPortalService';
import {
  DoctorAppointment,
  DoctorConsultation,
  DoctorPatientDirectoryItem,
  DoctorPrescription,
} from '../../types/doctor';
import { validatePrescriptionInput } from '../../utils/doctorPortalHelpers';
import { PageHeader } from '../../components/common/PageHeader';
import { Modal } from '../../components/common/Modal';
import { PrescriptionModal } from '../../components/common/PrescriptionModal';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { Pagination } from '../../components/common/Pagination';
import {
  compareIsoDates,
  isWithinDateRange,
  paginateItems,
  sortItems,
} from '../../utils/listManagementHelpers';
import {
  AlertCircle,
  Ban,
  Calendar,
  CheckCircle2,
  FileText,
  Pill,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';

interface RxLocationState {
  petId?: string;
  consultationId?: string;
  appointmentId?: string;
}

interface EmptyRxItem {
  medicine_name: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string;
}

const createEmptyItem = (): EmptyRxItem => ({
  medicine_name: '',
  dosage: '',
  frequency: '',
  duration: '',
  instructions: '',
});

export const DoctorPrescriptions: React.FC = () => {
  const location = useLocation();
  const { showToast } = useApp();
  const { hasPermission } = useAuth();
  const { workspace, doctorLoading } = useDoctorWorkspace();

  const navState = (location.state as RxLocationState | null) || null;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prescriptions, setPrescriptions] = useState<DoctorPrescription[]>([]);
  const [patients, setPatients] = useState<DoctorPatientDirectoryItem[]>([]);
  const [consultations, setConsultations] = useState<DoctorConsultation[]>([]);
  const [appointments, setAppointments] = useState<DoctorAppointment[]>([]);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'issued' | 'void'>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedRx, setSelectedRx] = useState<DoctorPrescription | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [appliedNavState, setAppliedNavState] = useState(false);

  const [petId, setPetId] = useState('');
  const [encounterKey, setEncounterKey] = useState(''); // "consultation:<id>" or "appointment:<id>"
  const [diagnosis, setDiagnosis] = useState('');
  const [instructions, setInstructions] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [items, setItems] = useState<EmptyRxItem[]>([createEmptyItem()]);

  const [voidTarget, setVoidTarget] = useState<DoctorPrescription | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);

  const canWriteMedical = workspace
    ? hasPermission(workspace.organizationId, 'medical_records.write')
    : false;
  const hasStaffManage = workspace
    ? hasPermission(workspace.organizationId, 'staff.manage')
    : false;

  const loadData = useCallback(async () => {
    if (!workspace) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [rxList, patList, consList, apptList] = await Promise.all([
        doctorPortalService.getPrescriptions(workspace.organizationId),
        doctorPortalService.getOrganizationPatients(workspace.organizationId),
        doctorPortalService.getConsultations(workspace.organizationId),
        doctorPortalService.getAppointments(workspace.organizationId),
      ]);
      setPrescriptions(rxList);
      setPatients(patList);
      setConsultations(consList);
      setAppointments(apptList);
    } catch (err: any) {
      setError(err.message || 'Unable to load clinic prescriptions.');
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Apply preselected pet/consultation/appointment from navigation state once data loads
  useEffect(() => {
    if (appliedNavState || loading || patients.length === 0) return;

    if (navState?.petId || navState?.consultationId || navState?.appointmentId) {
      let targetPetId = navState.petId || '';
      if (!targetPetId && navState.consultationId) {
        const c = consultations.find((item) => item.id === navState.consultationId);
        if (c) targetPetId = c.pet_id;
      }
      if (!targetPetId && navState.appointmentId) {
        const a = appointments.find((item) => item.id === navState.appointmentId);
        if (a) targetPetId = a.pet_id;
      }

      if (targetPetId) {
        setPetId(targetPetId);
      } else if (patients[0]) {
        setPetId(patients[0].id);
      }

      if (navState.consultationId) {
        setEncounterKey(`consultation:${navState.consultationId}`);
      } else if (navState.appointmentId) {
        setEncounterKey(`appointment:${navState.appointmentId}`);
      }

      if (canWriteMedical && workspace?.doctorProfileId) {
        setCreateOpen(true);
      }
      setAppliedNavState(true);
    } else if (!petId && patients[0]) {
      setPetId(patients[0].id);
    }
  }, [
    appliedNavState,
    loading,
    patients,
    consultations,
    appointments,
    navState,
    canWriteMedical,
    workspace?.doctorProfileId,
    petId,
  ]);

  const encounterOptions = useMemo(() => {
    if (!petId) return [];
    const options: Array<{ key: string; label: string }> = [];

    for (const c of consultations) {
      if (
        c.pet_id === petId &&
        c.consultation_status !== 'rejected' &&
        c.consultation_status !== 'pending'
      ) {
        options.push({
          key: `consultation:${c.id}`,
          label: `Consultation (${c.consultation_status}) · ${new Date(
            c.created_at
          ).toLocaleDateString()} · ${c.consultation_reason.slice(0, 48)}`,
        });
      }
    }

    for (const a of appointments) {
      if (
        a.pet_id === petId &&
        (a.status === 'confirmed' || a.status === 'checked_in' || a.status === 'completed')
      ) {
        const stamp = a.scheduled_start || a.requested_start;
        options.push({
          key: `appointment:${a.id}`,
          label: `Appointment (${a.status.replace('_', ' ')}) · ${new Date(
            stamp
          ).toLocaleDateString()} · ${a.reason.slice(0, 48)}`,
        });
      }
    }

    return options;
  }, [petId, consultations, appointments]);

  // Keep encounterKey valid when pet changes
  useEffect(() => {
    if (encounterOptions.length === 0) {
      setEncounterKey('');
      return;
    }
    if (!encounterOptions.some((o) => o.key === encounterKey)) {
      setEncounterKey(encounterOptions[0].key);
    }
  }, [encounterOptions, encounterKey]);

  const openCreateModal = () => {
    const initialPet = petId || patients[0]?.id || '';
    setPetId(initialPet);
    setDiagnosis('');
    setInstructions('');
    setFollowUpDate('');
    setItems([createEmptyItem()]);
    setCreateOpen(true);
  };

  const handleAddItem = () => {
    setItems((prev) => [...prev, createEmptyItem()]);
  };

  const handleRemoveItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleItemChange = (
    index: number,
    field: keyof EmptyRxItem,
    value: string
  ) => {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  };

  const handleIssuePrescription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspace) return;

    const consultationId = encounterKey.startsWith('consultation:')
      ? encounterKey.slice('consultation:'.length)
      : null;
    const appointmentId = encounterKey.startsWith('appointment:')
      ? encounterKey.slice('appointment:'.length)
      : null;

    const validationErr = validatePrescriptionInput({
      pet_id: petId,
      consultation_id: consultationId,
      appointment_id: appointmentId,
      diagnosis,
      items,
    });
    if (validationErr) {
      showToast(validationErr, 'error');
      return;
    }

    setSubmitting(true);
    try {
      await doctorPortalService.issuePrescription({
        organization_id: workspace.organizationId,
        pet_id: petId,
        consultation_id: consultationId,
        appointment_id: appointmentId,
        diagnosis,
        instructions,
        follow_up_date: followUpDate || null,
        items,
      });
      showToast('Prescription issued and recorded.', 'success');
      setCreateOpen(false);
      await loadData();
    } catch (err: any) {
      showToast(err.message || 'Unable to issue prescription.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVoidPrescription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!voidTarget) return;
    if (voidReason.trim().length < 3) {
      showToast('Please provide a clear reason for voiding (at least 3 characters).', 'error');
      return;
    }
    setVoiding(true);
    try {
      await doctorPortalService.voidPrescription(voidTarget.id, voidReason);
      showToast('Prescription marked as VOID in clinical ledger.', 'info');
      setVoidTarget(null);
      setVoidReason('');
      await loadData();
    } catch (err: any) {
      showToast(err.message || 'Unable to void prescription.', 'error');
    } finally {
      setVoiding(false);
    }
  };

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, fromDate, toDate, sortOrder, pageSize]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = prescriptions.filter((rx) => {
      const matchesStatus = statusFilter === 'all' || rx.status === statusFilter;
      const matchesDate = isWithinDateRange(rx.created_at, fromDate, toDate);
      const matchesQuery =
        !q ||
        rx.id.toLowerCase().includes(q) ||
        (rx.pet_name || '').toLowerCase().includes(q) ||
        (rx.client_name || '').toLowerCase().includes(q) ||
        rx.diagnosis.toLowerCase().includes(q) ||
        rx.items.some((i) => i.medicine_name.toLowerCase().includes(q));
      return matchesStatus && matchesDate && matchesQuery;
    });
    return sortItems(list, (a, b) => compareIsoDates(a.created_at, b.created_at), sortOrder);
  }, [prescriptions, statusFilter, search, fromDate, toDate, sortOrder]);

  const paged = useMemo(
    () => paginateItems(filtered, page, pageSize),
    [filtered, page, pageSize]
  );

  if (doctorLoading || loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12 flex items-center justify-center">
        <LoadingSpinner size="lg" label="Loading clinic prescriptions..." />
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-xs text-amber-800">
        Select an active doctor clinic workspace to manage prescriptions.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Prescription Management"
        subtitle={`Issue verified digital veterinary prescriptions and manage void records for ${workspace.organizationName}.`}
        action={
          canWriteMedical && workspace.doctorProfileId ? (
            <button
              type="button"
              onClick={openCreateModal}
              className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors flex items-center gap-1.5 shadow-xs"
            >
              <Plus className="w-4 h-4" />
              Issue New Prescription
            </button>
          ) : null
        }
      />

      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-xs text-rose-800 flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            {error}
          </span>
          <button
            type="button"
            onClick={() => void loadData()}
            className="px-3 py-1.5 bg-rose-700 text-white rounded-lg font-semibold inline-flex items-center gap-1"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Retry
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative w-full sm:w-96">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by patient, owner, diagnosis, or medicine..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
            />
          </div>

          <div className="flex items-center gap-1.5">
            {(['all', 'issued', 'void'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setStatusFilter(tab)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${
                  statusFilter === tab
                    ? 'bg-teal-700 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {tab}
              </button>
            ))}
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
                aria-label="Prescription start date"
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-700/20"
              />
            </label>
            <label className="inline-flex items-center gap-1.5 text-slate-600">
              <span className="font-semibold">To:</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                aria-label="Prescription end date"
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-700/20"
              />
            </label>
            {(fromDate || toDate || statusFilter !== 'all' || search) && (
              <button
                type="button"
                onClick={() => {
                  setFromDate('');
                  setToDate('');
                  setStatusFilter('all');
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
              aria-label="Sort prescriptions"
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-800 font-medium"
            >
              <option value="desc">Newest First</option>
              <option value="asc">Oldest First</option>
            </select>
          </label>
        </div>
      </div>

      {/* Prescriptions Grid */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-xs text-slate-500">
          No prescriptions match your current filter.
        </div>
      ) : (
        <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {paged.items.map((rx) => {
            const canVoid =
              rx.status === 'issued' &&
              canWriteMedical &&
              (rx.doctor_id === workspace.doctorProfileId || hasStaffManage);

            return (
              <div
                key={rx.id}
                className={`bg-white rounded-xl border p-5 shadow-xs flex flex-col justify-between transition-all ${
                  rx.status === 'void'
                    ? 'border-rose-200 bg-rose-50/20'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-[10px] font-mono text-slate-400 uppercase">
                        Rx #{rx.id.slice(0, 8)}
                      </span>
                      <h3 className="text-base font-bold text-slate-900 mt-0.5 truncate">
                        {rx.pet_name} ·{' '}
                        <span className="text-slate-700 font-semibold">{rx.diagnosis}</span>
                      </h3>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span
                        className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${
                          rx.status === 'void'
                            ? 'bg-rose-100 text-rose-800 border-rose-200'
                            : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        }`}
                      >
                        {rx.status}
                      </span>
                      <span className="text-xs font-semibold px-2 py-0.5 rounded bg-teal-50 text-teal-800 border border-teal-200">
                        {rx.items.length} Drug(s)
                      </span>
                    </div>
                  </div>

                  <div className="text-xs text-slate-500 mt-2 flex flex-wrap items-center gap-2">
                    <span>
                      Owner: <strong>{rx.client_name}</strong>
                    </span>
                    <span>·</span>
                    <span>
                      Prescribed by: <strong>{rx.doctor_name}</strong>
                    </span>
                    <span>·</span>
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                      {new Date(rx.created_at).toLocaleDateString()}
                    </span>
                  </div>

                  {rx.status === 'void' && rx.void_reason && (
                    <div className="mt-3 p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-[11px] text-rose-800">
                      <strong>Void reason:</strong> {rx.void_reason}
                    </div>
                  )}

                  <div className="mt-4 bg-slate-50 p-3 rounded-lg border border-slate-100 space-y-2">
                    {rx.items.map((item, idx) => (
                      <div
                        key={item.id || idx}
                        className="text-xs flex items-center justify-between gap-2"
                      >
                        <span className="font-semibold text-slate-800 truncate">
                          {item.medicine_name}
                        </span>
                        <span className="text-slate-500 shrink-0">
                          {item.dosage} ({item.duration})
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-500">
                    Follow-up:{' '}
                    {rx.follow_up_date
                      ? new Date(rx.follow_up_date).toLocaleDateString()
                      : 'As needed'}
                  </span>
                  <div className="flex items-center gap-2">
                    {canVoid && (
                      <button
                        type="button"
                        onClick={() => {
                          setVoidTarget(rx);
                          setVoidReason('');
                        }}
                        className="px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 border border-rose-200 rounded-lg transition-colors flex items-center gap-1"
                      >
                        <Ban className="w-3.5 h-3.5" />
                        Void Rx
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setSelectedRx(rx)}
                      className="px-3.5 py-1.5 text-xs font-semibold text-teal-700 hover:bg-teal-50 border border-teal-200 rounded-lg transition-colors flex items-center gap-1"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      View & Print
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
          <Pagination
            currentPage={paged.currentPage}
            totalPages={paged.totalPages}
            totalItems={paged.totalItems}
            startIndex={paged.startIndex}
            endIndex={paged.endIndex}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(next) => {
              setPageSize(next);
              setPage(1);
            }}
            itemLabel="prescriptions"
          />
        </div>
        </div>
      )}

      {/* Create Prescription Modal */}
      <Modal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Issue Digital Veterinary Prescription"
        subtitle="Prescriptions must be anchored to an authorized consultation or confirmed/completed visit in this organization."
        maxWidth="xl"
      >
        <form onSubmit={handleIssuePrescription} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Patient Pet *
              </label>
              <select
                required
                value={petId}
                onChange={(e) => setPetId(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
              >
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.species}
                    {p.breed ? ` · ${p.breed}` : ''})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Follow-up Review Date
              </label>
              <input
                type="date"
                value={followUpDate}
                onChange={(e) => setFollowUpDate(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Linked Clinical Encounter *
              </label>
              {encounterOptions.length === 0 ? (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
                  No active/completed consultation or confirmed/completed appointment found for this pet. Activate a consultation or confirm an appointment first.
                </div>
              ) : (
                <select
                  required
                  value={encounterKey}
                  onChange={(e) => setEncounterKey(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
                >
                  {encounterOptions.map((opt) => (
                    <option key={opt.key} value={opt.key}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Clinical Diagnosis *
              </label>
              <input
                type="text"
                required
                placeholder="Enter confirmed or working clinical diagnosis..."
                value={diagnosis}
                onChange={(e) => setDiagnosis(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
              />
            </div>
          </div>

          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Pill className="w-4 h-4 text-teal-700" />
                Prescribed Medications ({items.length})
              </span>
              <button
                type="button"
                onClick={handleAddItem}
                className="text-xs font-semibold text-teal-700 hover:text-teal-800 flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> Add Medication
              </button>
            </div>

            {items.map((item, idx) => (
              <div
                key={idx}
                className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-700">Medication #{idx + 1}</span>
                  {items.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveItem(idx)}
                      className="text-rose-600 hover:text-rose-700"
                      aria-label={`Remove medication ${idx + 1}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    required
                    placeholder="Medicine name & strength"
                    value={item.medicine_name}
                    onChange={(e) => handleItemChange(idx, 'medicine_name', e.target.value)}
                    className="px-2.5 py-1.5 bg-white rounded border border-slate-200"
                  />
                  <input
                    type="text"
                    required
                    placeholder="Dosage (e.g. 1 tablet / 5 ml)"
                    value={item.dosage}
                    onChange={(e) => handleItemChange(idx, 'dosage', e.target.value)}
                    className="px-2.5 py-1.5 bg-white rounded border border-slate-200"
                  />
                  <input
                    type="text"
                    required
                    placeholder="Frequency (e.g. Every 12 hours)"
                    value={item.frequency}
                    onChange={(e) => handleItemChange(idx, 'frequency', e.target.value)}
                    className="px-2.5 py-1.5 bg-white rounded border border-slate-200"
                  />
                  <input
                    type="text"
                    required
                    placeholder="Duration (e.g. 7 days)"
                    value={item.duration}
                    onChange={(e) => handleItemChange(idx, 'duration', e.target.value)}
                    className="px-2.5 py-1.5 bg-white rounded border border-slate-200"
                  />
                  <div className="sm:col-span-2">
                    <input
                      type="text"
                      placeholder="Administration notes (optional)"
                      value={item.instructions}
                      onChange={(e) => handleItemChange(idx, 'instructions', e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-white rounded border border-slate-200"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              General Clinical Instructions
            </label>
            <textarea
              rows={2}
              placeholder="Diet, rest, monitoring signs, and follow-up precautions..."
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
            />
          </div>

          <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || encounterOptions.length === 0}
              className="px-5 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg shadow-xs flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-4 h-4" />
              {submitting ? 'Issuing...' : 'Issue Prescription'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Void Prescription Modal */}
      <Modal
        isOpen={Boolean(voidTarget)}
        onClose={() => setVoidTarget(null)}
        title="Void Clinical Prescription"
        subtitle="Prescriptions are never deleted; voiding marks the record invalid for dispensing while preserving audit history."
        maxWidth="md"
      >
        <form onSubmit={handleVoidPrescription} className="space-y-4">
          <div className="text-xs text-slate-600 bg-rose-50 border border-rose-200 rounded-lg p-3">
            Voiding Rx <strong>#{voidTarget?.id.slice(0, 8)}</strong> for{' '}
            <strong>{voidTarget?.pet_name}</strong> ({voidTarget?.diagnosis}).
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Reason for Voiding *
            </label>
            <textarea
              rows={3}
              required
              placeholder="Specify reason (e.g. dosage adjustment issued under replacement Rx, incorrect frequency)..."
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-600/20 focus:border-rose-600"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setVoidTarget(null)}
              className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={voiding}
              className="px-4 py-2 text-xs font-semibold text-white bg-rose-700 hover:bg-rose-800 disabled:opacity-50 rounded-lg"
            >
              {voiding ? 'Voiding...' : 'Confirm Void Rx'}
            </button>
          </div>
        </form>
      </Modal>

      <PrescriptionModal
        prescription={selectedRx}
        isOpen={Boolean(selectedRx)}
        onClose={() => setSelectedRx(null)}
        organizationName={workspace.organizationName}
      />
    </div>
  );
};
