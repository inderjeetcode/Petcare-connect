import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { useDoctorWorkspace } from '../../hooks/useDoctorWorkspace';
import { doctorPortalService } from '../../services/doctorPortalService';
import { formatSupabaseError } from '../../services/authService';
import {
  DoctorMedicalRecord,
  DoctorPatientDirectoryItem,
  DoctorPrescription,
  DoctorVaccination,
} from '../../types/doctor';
import { PageHeader } from '../../components/common/PageHeader';
import { Modal } from '../../components/common/Modal';
import { StatusBadge } from '../../components/common/StatusBadge';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { EmptyState } from '../../components/common/EmptyState';
import {
  AlertTriangle,
  Calendar,
  Download,
  FilePlus,
  FileText,
  PawPrint,
  Phone,
  Scale,
  Search,
  ShieldCheck,
  Syringe,
  User,
} from 'lucide-react';

export const DoctorPatients: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useApp();
  const { workspace, doctorBasePath, doctorLoading } = useDoctorWorkspace();

  const [loading, setLoading] = useState(true);
  const [patients, setPatients] = useState<DoctorPatientDirectoryItem[]>([]);
  const [search, setSearch] = useState('');

  // Clinical History Modal State
  const [selectedPet, setSelectedPet] = useState<DoctorPatientDirectoryItem | null>(null);
  const [loadingChart, setLoadingChart] = useState(false);
  const [petRecords, setPetRecords] = useState<DoctorMedicalRecord[]>([]);
  const [petVaccines, setPetVaccines] = useState<DoctorVaccination[]>([]);
  const [petPrescriptions, setPetPrescriptions] = useState<DoctorPrescription[]>([]);
  const [openingAttachmentId, setOpeningAttachmentId] = useState<string | null>(null);

  const loadPatients = useCallback(async () => {
    if (!workspace) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const list = await doctorPortalService.getOrganizationPatients(
        workspace.organizationId
      );
      setPatients(list);
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to load organization patients.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [workspace, showToast]);

  useEffect(() => {
    if (!doctorLoading) {
      void loadPatients();
    }
  }, [doctorLoading, loadPatients]);

  const openClinicalChart = async (pet: DoctorPatientDirectoryItem) => {
    if (!workspace) return;
    setSelectedPet(pet);
    setLoadingChart(true);
    try {
      const [recs, vaxs, rxs] = await Promise.all([
        doctorPortalService.getMedicalRecords(workspace.organizationId, pet.id),
        doctorPortalService.getVaccinations(workspace.organizationId, pet.id),
        doctorPortalService.getPrescriptions(workspace.organizationId, pet.id),
      ]);
      setPetRecords(recs);
      setPetVaccines(vaxs);
      setPetPrescriptions(rxs);
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to load patient clinical chart.'), 'error');
    } finally {
      setLoadingChart(false);
    }
  };

  const handleDownloadAttachment = async (objectPath: string, attId: string) => {
    setOpeningAttachmentId(attId);
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
      showToast(formatSupabaseError(err, 'Unable to open clinical attachment.'), 'error');
    } finally {
      setOpeningAttachmentId(null);
    }
  };

  const filteredPets = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return patients;
    return patients.filter(
      (pet) =>
        pet.name.toLowerCase().includes(q) ||
        pet.species.toLowerCase().includes(q) ||
        pet.breed.toLowerCase().includes(q) ||
        pet.guardian_names.some((g) => g.toLowerCase().includes(q))
    );
  }, [patients, search]);

  if (doctorLoading || loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-10 flex justify-center">
        <LoadingSpinner label="Loading organization patient directory..." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organization Patients Directory"
        subtitle={`Review pet profiles, guardians, allergies, and full clinical histories within ${workspace?.organizationName || 'Organization'}.`}
      />

      <div className="p-3.5 rounded-xl bg-teal-50/70 border border-teal-200 text-xs text-teal-900 flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-teal-700 shrink-0" />
        <span>
          Continuity of care: Authorized doctors in{' '}
          <strong>{workspace?.organizationName}</strong> can inspect organization clinical history across all assigned branches while cross-organization data remains strictly isolated.
        </span>
      </div>

      <div className="bg-white p-4 rounded-xl border border-slate-200 flex items-center justify-between shadow-xs">
        <div className="relative w-full sm:w-96">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by pet name, species, breed, or guardian..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
          />
        </div>
        <span className="text-xs font-semibold text-slate-500 hidden sm:inline">
          {filteredPets.length} patient(s)
        </span>
      </div>

      {filteredPets.length === 0 ? (
        <EmptyState
          icon={PawPrint}
          title="No Matching Patients"
          description="No active pet patients matched your search in this organization."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredPets.map((pet) => (
            <div
              key={pet.id}
              className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs hover:border-slate-300 transition-all flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-teal-800 text-white flex items-center justify-center font-bold text-base shrink-0">
                    {pet.name[0]?.toUpperCase() || 'P'}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-base font-bold text-slate-900 truncate">
                      {pet.name}
                    </h3>
                    <p className="text-xs text-slate-500 truncate">
                      {pet.species} · {pet.breed}
                    </p>
                    <span className="inline-block mt-1 text-[10px] font-bold text-teal-700 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
                      {pet.consultation_count} Consultation(s)
                    </span>
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t border-slate-100 space-y-1.5 text-xs text-slate-600">
                  <div className="flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">
                      Guardian:{' '}
                      <strong>
                        {pet.guardian_names.length > 0
                          ? pet.guardian_names.join(', ')
                          : 'Clinic Client'}
                      </strong>
                    </span>
                  </div>
                  {pet.guardian_phones[0] && (
                    <div className="flex items-center gap-1.5">
                      <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span>{pet.guardian_phones[0]}</span>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-slate-100 text-xs">
                  <div className="flex items-center gap-1.5 text-slate-600">
                    <Scale className="w-3.5 h-3.5 text-slate-400" />
                    <span>
                      Weight: <strong>{pet.weight} kg</strong>
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-slate-600">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    <span>
                      DOB: <strong>{pet.date_of_birth || 'Unknown'}</strong>
                    </span>
                  </div>
                </div>

                {pet.allergies && (
                  <div className="mt-3 text-xs bg-amber-50 text-amber-800 border border-amber-200 rounded-lg p-2 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <span className="truncate">Allergies: {pet.allergies}</span>
                  </div>
                )}
              </div>

              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => void openClinicalChart(pet)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors flex items-center gap-1"
                >
                  <FileText className="w-3.5 h-3.5 text-teal-700" />
                  Clinical History
                </button>
                <button
                  type="button"
                  onClick={() =>
                    navigate(`${doctorBasePath}/prescriptions`, {
                      state: { petId: pet.id },
                    })
                  }
                  className="px-3.5 py-1.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors shadow-xs flex items-center gap-1"
                >
                  <FilePlus className="w-3.5 h-3.5" />
                  Prescribe
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Longitudinal Org Clinical Chart Modal */}
      <Modal
        isOpen={Boolean(selectedPet)}
        onClose={() => setSelectedPet(null)}
        title={`Patient Clinical Chart — ${selectedPet?.name || ''}`}
        subtitle={`${selectedPet?.species || ''} · ${selectedPet?.breed || ''} · ${workspace?.organizationName || ''}`}
        maxWidth="2xl"
      >
        {selectedPet && (
          <div className="space-y-5 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
              <div>
                <span className="text-slate-400 block">Guardians</span>
                <span className="font-bold text-slate-900">
                  {selectedPet.guardian_names.join(', ') || 'Registered Client'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block">Vitals</span>
                <span className="font-bold text-slate-900">
                  {selectedPet.gender} · {selectedPet.weight} kg
                </span>
              </div>
              <div>
                <span className="text-slate-400 block">Allergies / Notes</span>
                <span className="font-semibold text-amber-800">
                  {selectedPet.allergies || 'None reported'}
                </span>
              </div>
            </div>

            {selectedPet.medical_notes && (
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-slate-700">
                <strong className="text-slate-900 block mb-0.5">Baseline Notes</strong>
                {selectedPet.medical_notes}
              </div>
            )}

            {loadingChart ? (
              <LoadingSpinner label="Loading organization clinical records..." />
            ) : (
              <div className="space-y-5 max-h-[55vh] overflow-y-auto pr-1">
                {/* Medical Records */}
                <div>
                  <h4 className="font-bold text-slate-900 mb-2 flex items-center gap-1.5">
                    <FileText className="w-4 h-4 text-teal-700" />
                    Medical Records ({petRecords.length})
                  </h4>
                  {petRecords.length === 0 ? (
                    <p className="text-slate-500 bg-slate-50 p-3 rounded-lg border border-slate-100">
                      No medical records logged yet.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {petRecords.map((rec) => (
                        <div
                          key={rec.id}
                          className="p-3 rounded-lg border border-slate-200 bg-white space-y-1.5"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 rounded bg-teal-50 text-teal-800 border border-teal-200 font-bold uppercase text-[10px]">
                                {rec.record_type.replace('_', ' ')}
                              </span>
                              <span className="font-bold text-slate-900">
                                {rec.diagnosis}
                              </span>
                            </div>
                            <span className="text-[11px] text-slate-400">
                              {rec.doctor_name} ·{' '}
                              {new Date(rec.created_at).toLocaleDateString()}
                            </span>
                          </div>
                          <p className="text-slate-700 whitespace-pre-line">{rec.notes}</p>
                          {rec.attachments.length > 0 && (
                            <div className="flex flex-wrap gap-2 pt-1">
                              {rec.attachments.map((att) => (
                                <button
                                  key={att.id}
                                  type="button"
                                  disabled={openingAttachmentId === att.id}
                                  onClick={() =>
                                    void handleDownloadAttachment(att.object_path, att.id)
                                  }
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-[11px]"
                                >
                                  <Download className="w-3 h-3" />
                                  {att.original_filename}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Vaccinations */}
                <div>
                  <h4 className="font-bold text-slate-900 mb-2 flex items-center gap-1.5">
                    <Syringe className="w-4 h-4 text-teal-700" />
                    Vaccinations ({petVaccines.length})
                  </h4>
                  {petVaccines.length === 0 ? (
                    <p className="text-slate-500 bg-slate-50 p-3 rounded-lg border border-slate-100">
                      No vaccination entries recorded yet.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {petVaccines.map((vax) => (
                        <div
                          key={vax.id}
                          className="p-3 rounded-lg border border-slate-200 bg-white flex flex-wrap items-center justify-between gap-2"
                        >
                          <div>
                            <span className="font-bold text-slate-900">
                              {vax.vaccine_name}
                            </span>
                            {vax.batch_number && (
                              <span className="text-slate-500 ml-2">
                                Batch: {vax.batch_number}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-600">
                            Given: <strong>{vax.administered_date}</strong>
                            {vax.next_due_date && (
                              <span className="ml-2 text-teal-800">
                                · Next due: <strong>{vax.next_due_date}</strong>
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Prescriptions */}
                <div>
                  <h4 className="font-bold text-slate-900 mb-2 flex items-center gap-1.5">
                    <FilePlus className="w-4 h-4 text-teal-700" />
                    Prescriptions ({petPrescriptions.length})
                  </h4>
                  {petPrescriptions.length === 0 ? (
                    <p className="text-slate-500 bg-slate-50 p-3 rounded-lg border border-slate-100">
                      No prescriptions issued yet.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {petPrescriptions.map((rx) => (
                        <div
                          key={rx.id}
                          className="p-3 rounded-lg border border-slate-200 bg-white space-y-1"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-slate-900">
                              {rx.diagnosis}
                            </span>
                            <StatusBadge status={rx.status} />
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {rx.doctor_name} ·{' '}
                            {new Date(rx.created_at).toLocaleDateString()} ·{' '}
                            {rx.items.length} medication(s)
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="pt-3 border-t border-slate-100 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() =>
                  navigate(`${doctorBasePath}/medical-records`, {
                    state: { petId: selectedPet.id },
                  })
                }
                className="px-3.5 py-1.5 font-semibold text-teal-700 border border-teal-200 hover:bg-teal-50 rounded-lg"
              >
                Log Record / Vaccine
              </button>
              <button
                type="button"
                onClick={() =>
                  navigate(`${doctorBasePath}/prescriptions`, {
                    state: { petId: selectedPet.id },
                  })
                }
                className="px-3.5 py-1.5 font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg"
              >
                Issue Prescription
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
