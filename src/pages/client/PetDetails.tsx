import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { useClientWorkspace } from '../../hooks/useClientWorkspace';
import { clientPortalService } from '../../services/clientPortalService';
import {
  ClientAttachment,
  ClientConsultation,
  ClientMedicalRecord,
  ClientPet,
  ClientPrescription,
  ClientVaccination,
} from '../../types/client';
import { validateAttachmentFile } from '../../utils/clientPortalHelpers';
import { PageHeader } from '../../components/common/PageHeader';
import { StatusBadge } from '../../components/common/StatusBadge';
import { PrescriptionModal } from '../../components/common/PrescriptionModal';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { Modal } from '../../components/common/Modal';
import {
  PawPrint,
  ArrowLeft,
  Calendar,
  Scale,
  AlertTriangle,
  FileText,
  ShieldCheck,
  Stethoscope,
  Upload,
  Download,
  Eye,
  Paperclip,
  RefreshCw,
} from 'lucide-react';

type PetTab =
  | 'overview'
  | 'documents'
  | 'consultations'
  | 'prescriptions'
  | 'records'
  | 'vaccines';

export const PetDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast } = useApp();
  const { workspace, clientBasePath } = useClientWorkspace();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [activeTab, setActiveTab] = useState<PetTab>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pet, setPet] = useState<ClientPet | null>(null);
  const [petAttachments, setPetAttachments] = useState<ClientAttachment[]>([]);
  const [consultations, setConsultations] = useState<ClientConsultation[]>([]);
  const [prescriptions, setPrescriptions] = useState<ClientPrescription[]>([]);
  const [records, setRecords] = useState<ClientMedicalRecord[]>([]);
  const [vaccinations, setVaccinations] = useState<ClientVaccination[]>([]);

  const [selectedRx, setSelectedRx] = useState<ClientPrescription | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<{
    attachment: ClientAttachment;
    signedUrl: string;
  } | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const loadPetData = useCallback(async () => {
    if (!workspace || !id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const petRecord = await clientPortalService.getPetById(workspace.organizationId, id);
      if (!petRecord) {
        setPet(null);
        setLoading(false);
        return;
      }

      const [atts, allCons, petRx, petRecs, petVax] = await Promise.all([
        clientPortalService.getAttachmentsForEntities(workspace.organizationId, 'pet', [id]),
        clientPortalService.getConsultations(workspace.organizationId),
        clientPortalService.getPrescriptions(
          workspace.organizationId,
          id,
          workspace.profileName
        ),
        clientPortalService.getMedicalRecords(workspace.organizationId, id),
        clientPortalService.getVaccinations(workspace.organizationId, id),
      ]);

      setPet(petRecord);
      setPetAttachments(atts);
      setConsultations(allCons.filter((c) => c.pet_id === id));
      setPrescriptions(petRx);
      setRecords(petRecs);
      setVaccinations(petVax);
    } catch (err: any) {
      setError(err.message || 'Failed to load pet clinical profile.');
    } finally {
      setLoading(false);
    }
  }, [workspace, id]);

  useEffect(() => {
    void loadPetData();
  }, [loadPetData]);

  const handleUploadPetFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file || !pet || !workspace) return;

    const fileErr = validateAttachmentFile(file);
    if (fileErr) {
      showToast(fileErr, 'error');
      return;
    }

    setIsUploading(true);
    try {
      const created = await clientPortalService.uploadClinicalAttachment({
        organization_id: workspace.organizationId,
        entity_type: 'pet',
        entity_id: pet.id,
        file,
      });
      setPetAttachments((prev) => [created, ...prev]);
      showToast(`Uploaded "${created.original_filename}" securely.`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Document upload failed.', 'error');
    } finally {
      setIsUploading(false);
    }
  };

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

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12 flex items-center justify-center">
        <LoadingSpinner size="lg" label="Loading pet profile and clinical history..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-xl p-6 text-xs text-rose-800 space-y-3">
        <div className="flex items-center gap-2 font-bold">
          <AlertTriangle className="w-4 h-4 text-rose-600" />
          Unable to load pet details
        </div>
        <p>{error}</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadPetData()}
            className="px-3 py-1.5 bg-rose-700 text-white rounded-lg font-semibold flex items-center gap-1"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Retry
          </button>
          <button
            type="button"
            onClick={() => navigate(`${clientBasePath}/pets`)}
            className="px-3 py-1.5 bg-white border border-rose-200 text-rose-800 rounded-lg font-semibold"
          >
            Return to My Pets
          </button>
        </div>
      </div>
    );
  }

  if (!pet || !workspace) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12 text-center space-y-3">
        <PawPrint className="w-8 h-8 text-slate-300 mx-auto" />
        <p className="text-sm font-bold text-slate-900">Pet record not found</p>
        <p className="text-xs text-slate-500">
          This pet may belong to another clinic organization or has been archived.
        </p>
        <button
          type="button"
          onClick={() => navigate(`${clientBasePath}/pets`)}
          className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg"
        >
          Return to My Pets
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={pet.name}
        subtitle={`${pet.species} · ${pet.breed} · ${pet.gender} (${workspace.organizationName})`}
        breadcrumbs={[
          { label: 'Client', href: `${clientBasePath}/dashboard` },
          { label: 'My Pets', href: `${clientBasePath}/pets` },
          { label: pet.name },
        ]}
        action={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate(`${clientBasePath}/pets`)}
              className="px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-1.5"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
            <button
              type="button"
              onClick={() => navigate(`${clientBasePath}/doctors`)}
              className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors flex items-center gap-1.5 shadow-xs"
            >
              <Stethoscope className="w-4 h-4" />
              Book Appointment
            </button>
          </div>
        }
      />

      {/* Top Pet Profile Card */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs flex flex-col md:flex-row items-start md:items-center gap-6">
        {pet.avatar_url ? (
          <img
            src={pet.avatar_url}
            alt={pet.name}
            className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl object-cover border-2 border-teal-700/20 shadow-sm shrink-0"
          />
        ) : (
          <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl bg-teal-50 border border-teal-200 flex items-center justify-center shrink-0">
            <PawPrint className="w-10 h-10 text-teal-700" />
          </div>
        )}

        <div className="flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-bold text-slate-900">{pet.name}</h2>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-teal-50 text-teal-800 border border-teal-200">
              {pet.species}
            </span>
            <span className="px-2.5 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700">
              {pet.gender}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs pt-1">
            <div>
              <span className="text-slate-400 block font-medium">Breed:</span>
              <span className="font-semibold text-slate-800">{pet.breed}</span>
            </div>
            <div>
              <span className="text-slate-400 block font-medium">Current Weight:</span>
              <span className="font-semibold text-slate-800 flex items-center gap-1">
                <Scale className="w-3.5 h-3.5 text-slate-400" />
                {pet.weight} kg
              </span>
            </div>
            <div>
              <span className="text-slate-400 block font-medium">Date of Birth:</span>
              <span className="font-semibold text-slate-800 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                {pet.date_of_birth || 'Not provided'}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block font-medium">Coat / Color:</span>
              <span className="font-semibold text-slate-800">{pet.color || 'Not provided'}</span>
            </div>
          </div>

          {pet.allergies && (
            <div className="mt-2 text-xs bg-amber-50 text-amber-800 border border-amber-200 rounded-lg p-2.5 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                <strong>Allergies / Drug Sensitivities:</strong> {pet.allergies}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200 overflow-x-auto pb-px">
        {[
          { key: 'overview', label: 'Overview & Notes' },
          { key: 'documents', label: `Documents (${petAttachments.length})` },
          { key: 'consultations', label: `Consultations (${consultations.length})` },
          { key: 'prescriptions', label: `Prescriptions (${prescriptions.length})` },
          { key: 'records', label: `Medical Records (${records.length})` },
          { key: 'vaccines', label: `Vaccinations (${vaccinations.length})` },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key as PetTab)}
            className={`px-4 py-2 text-xs font-semibold whitespace-nowrap transition-all border-b-2 ${
              activeTab === tab.key
                ? 'border-teal-700 text-teal-800'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Panels */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <FileText className="w-4 h-4 text-teal-700" />
              Medical Background Notes
            </h3>
            <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-line bg-slate-50 p-4 rounded-lg border border-slate-100">
              {pet.medical_notes || 'No general clinical notes documented.'}
            </p>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-teal-700" />
              Recent Vaccinations
            </h3>
            <div className="space-y-2">
              {vaccinations.length === 0 ? (
                <p className="text-xs text-slate-500">No vaccination records logged yet.</p>
              ) : (
                vaccinations.map((v) => (
                  <div
                    key={v.id}
                    className="p-3 bg-slate-50 rounded-lg border border-slate-100 flex items-center justify-between text-xs"
                  >
                    <div>
                      <div className="font-bold text-slate-900">{v.vaccine_name}</div>
                      <div className="text-slate-500 text-[11px]">
                        Administered: {v.administered_date}
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-[11px] font-bold text-emerald-700">
                        {v.next_due_date ? `Due: ${v.next_due_date}` : 'Completed'}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'documents' && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Pet Clinical Documents & Previous Records
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Stored in private tenant-isolated storage. Supported formats: JPEG, PNG, WebP, or PDF (max 10 MB).
              </p>
            </div>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
                onChange={handleUploadPetFile}
                className="hidden"
                id="pet-doc-upload"
              />
              <label
                htmlFor="pet-doc-upload"
                className={`px-3.5 py-2 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                  isUploading
                    ? 'bg-slate-200 text-slate-500 pointer-events-none'
                    : 'bg-teal-700 hover:bg-teal-800 text-white shadow-xs'
                }`}
              >
                <Upload className="w-3.5 h-3.5" />
                {isUploading ? 'Uploading...' : 'Upload Document'}
              </label>
            </div>
          </div>

          {petAttachments.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              <Paperclip className="w-7 h-7 text-slate-300 mx-auto mb-2" />
              No documents uploaded for {pet.name} yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {petAttachments.map((att) => (
                <div
                  key={att.id}
                  className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-900 truncate">
                      {att.original_filename}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {att.mime_type} · {formatBytes(att.byte_size)} · Uploaded{' '}
                      {new Date(att.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={openingId === att.id}
                    onClick={() => void handleOpenAttachment(att)}
                    className="px-3 py-1.5 text-xs font-semibold text-teal-700 hover:bg-teal-50 border border-teal-200 rounded-lg transition-colors flex items-center gap-1.5 shrink-0 disabled:opacity-50"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    {openingId === att.id ? 'Generating URL...' : 'View / Download'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'consultations' && (
        <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 shadow-xs">
          {consultations.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No consultations logged for {pet.name} yet.
            </div>
          ) : (
            consultations.map((c) => (
              <div
                key={c.id}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={c.consultation_status} />
                    <span className="text-xs font-bold text-slate-900">{c.doctor_name}</span>
                    {c.branch_name && (
                      <span className="text-[11px] text-slate-500">· {c.branch_name}</span>
                    )}
                    <span className="text-xs text-slate-400">·</span>
                    <span className="text-xs text-slate-500">
                      {new Date(c.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-xs text-slate-700 mt-1">{c.consultation_reason}</p>
                </div>
                <button
                  type="button"
                  onClick={() => navigate(`${clientBasePath}/chat/${c.id}`)}
                  className="px-3 py-1.5 text-xs font-semibold text-teal-700 hover:bg-teal-50 border border-teal-200 rounded-lg transition-colors shrink-0"
                >
                  Open Chat Thread
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === 'prescriptions' && (
        <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 shadow-xs">
          {prescriptions.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No prescriptions issued for {pet.name}.
            </div>
          ) : (
            prescriptions.map((rx) => (
              <div
                key={rx.id}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900">{rx.diagnosis}</span>
                    <StatusBadge status={rx.status} />
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Prescribed by {rx.doctor_name} · {rx.items.length} medicines ·{' '}
                    {new Date(rx.created_at).toLocaleDateString()}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedRx(rx)}
                  className="px-3 py-1.5 text-xs font-semibold text-teal-700 hover:bg-teal-50 border border-teal-200 rounded-lg transition-colors shrink-0 flex items-center gap-1"
                >
                  <FileText className="w-3.5 h-3.5" />
                  View Rx
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === 'records' && (
        <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 shadow-xs">
          {records.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No medical records logged for {pet.name}.
            </div>
          ) : (
            records.map((rec) => (
              <div key={rec.id} className="p-4 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700">
                      {rec.record_type.replace('_', ' ')}
                    </span>
                    {rec.amended_from_id && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-50 text-amber-800 border border-amber-200">
                        Amended Entry
                      </span>
                    )}
                    <span className="text-xs font-bold text-slate-900">{rec.diagnosis}</span>
                  </div>
                  <span className="text-[11px] text-slate-400">
                    {rec.doctor_name} · {new Date(rec.created_at).toLocaleDateString()}
                  </span>
                </div>
                <p className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded border border-slate-100 whitespace-pre-line">
                  {rec.notes}
                </p>
                {rec.attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {rec.attachments.map((att) => (
                      <button
                        key={att.id}
                        type="button"
                        disabled={openingId === att.id}
                        onClick={() => void handleOpenAttachment(att)}
                        className="px-2.5 py-1 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg inline-flex items-center gap-1.5"
                      >
                        <Download className="w-3.5 h-3.5" />
                        {att.original_filename}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === 'vaccines' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
          {vaccinations.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No immunization records logged for {pet.name}.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4">Vaccine Name</th>
                    <th className="py-3 px-4">Date Administered</th>
                    <th className="py-3 px-4">Next Due Date</th>
                    <th className="py-3 px-4">Batch #</th>
                    <th className="py-3 px-4">Administered By</th>
                    <th className="py-3 px-4">Clinical Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {vaccinations.map((v) => (
                    <tr key={v.id} className="hover:bg-slate-50/50">
                      <td className="py-3 px-4 font-bold text-slate-900">{v.vaccine_name}</td>
                      <td className="py-3 px-4 text-slate-600">{v.administered_date}</td>
                      <td className="py-3 px-4 font-semibold text-emerald-700">
                        {v.next_due_date || '—'}
                      </td>
                      <td className="py-3 px-4 text-slate-500 font-mono">
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
            </div>
          )}
        </div>
      )}

      {/* Prescription View Modal */}
      <PrescriptionModal
        prescription={selectedRx}
        isOpen={Boolean(selectedRx)}
        onClose={() => setSelectedRx(null)}
        organizationName={workspace.organizationName}
      />

      {/* Secure Attachment Preview / Download Modal */}
      <Modal
        isOpen={Boolean(previewDoc)}
        onClose={() => setPreviewDoc(null)}
        title={previewDoc?.attachment.original_filename || 'Clinical Document'}
        subtitle="Time-limited signed access URL (expires in 5 minutes)"
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

            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <span className="text-[11px] text-slate-500">
                {previewDoc.attachment.mime_type} ·{' '}
                {formatBytes(previewDoc.attachment.byte_size)}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPreviewDoc(null)}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
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
          </div>
        )}
      </Modal>
    </div>
  );
};
