import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useClientWorkspace } from '../../hooks/useClientWorkspace';
import { useApp } from '../../context/AppContext';
import { clientPortalService } from '../../services/clientPortalService';
import { formatSupabaseError } from '../../services/authService';
import { ClientPet } from '../../types/client';
import {
  ALLOWED_PET_GENDERS,
  ALLOWED_PET_SPECIES,
  validatePetForm,
} from '../../utils/clientPortalHelpers';
import { PageHeader } from '../../components/common/PageHeader';
import { Modal } from '../../components/common/Modal';
import { EmptyState } from '../../components/common/EmptyState';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import {
  AlertTriangle,
  Archive,
  Calendar,
  ChevronRight,
  Edit2,
  Filter,
  Loader2,
  PawPrint,
  Plus,
  Scale,
  Search,
  Shield,
} from 'lucide-react';

export const MyPets: React.FC = () => {
  const { workspace, clientBasePath } = useClientWorkspace();
  const { showToast } = useApp();
  const navigate = useNavigate();

  const [pets, setPets] = useState<ClientPet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [speciesFilter, setSpeciesFilter] = useState('All');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingPet, setEditingPet] = useState<ClientPet | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [archiveTarget, setArchiveTarget] = useState<ClientPet | null>(null);
  const [archiveReason, setArchiveReason] = useState('');
  const [archiving, setArchiving] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    species: 'Dog',
    breed: '',
    date_of_birth: '',
    gender: 'Neutered Male',
    weight: 10,
    color: '',
    allergies: '',
    medical_notes: '',
  });

  const loadPets = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    setError(null);
    try {
      const list = await clientPortalService.getPets(workspace.organizationId);
      setPets(list);
    } catch (err) {
      setError(formatSupabaseError(err, 'Failed to load registered pets.'));
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => {
    void loadPets();
  }, [loadPets]);

  const openAddModal = () => {
    setEditingPet(null);
    setFormError(null);
    setFormData({
      name: '',
      species: 'Dog',
      breed: '',
      date_of_birth: '',
      gender: 'Neutered Male',
      weight: 10,
      color: '',
      allergies: '',
      medical_notes: '',
    });
    setModalOpen(true);
  };

  const openEditModal = (pet: ClientPet, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingPet(pet);
    setFormError(null);
    setFormData({
      name: pet.name,
      species: pet.species,
      breed: pet.breed,
      date_of_birth: pet.date_of_birth || '',
      gender: pet.gender,
      weight: Number(pet.weight),
      color: pet.color || '',
      allergies: pet.allergies || '',
      medical_notes: pet.medical_notes || '',
    });
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspace) return;
    setFormError(null);

    const validationError = validatePetForm(formData);
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setSubmitting(true);
    try {
      if (editingPet) {
        await clientPortalService.updatePet(workspace.organizationId, editingPet.id, {
          name: formData.name,
          species: formData.species,
          breed: formData.breed,
          gender: formData.gender,
          weight: Number(formData.weight),
          date_of_birth: formData.date_of_birth || null,
          color: formData.color || null,
          allergies: formData.allergies || null,
          medical_notes: formData.medical_notes || null,
        });
        showToast(`Updated ${formData.name}'s profile.`, 'success');
      } else {
        await clientPortalService.createPet({
          organization_id: workspace.organizationId,
          clinic_client_id: workspace.clinicClientId,
          name: formData.name,
          species: formData.species,
          breed: formData.breed,
          gender: formData.gender,
          weight: Number(formData.weight),
          date_of_birth: formData.date_of_birth || null,
          color: formData.color || null,
          allergies: formData.allergies || null,
          medical_notes: formData.medical_notes || null,
        });
        showToast(`Registered ${formData.name} under ${workspace.organizationName}.`, 'success');
      }
      setModalOpen(false);
      await loadPets();
    } catch (err) {
      setFormError(formatSupabaseError(err, 'Failed to save pet record.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmArchive = async () => {
    if (!archiveTarget) return;
    setArchiving(true);
    try {
      await clientPortalService.archivePet(
        archiveTarget.id,
        archiveReason.trim() || 'Archived by pet owner'
      );
      showToast(`${archiveTarget.name} archived. Historical clinical records are preserved.`, 'info');
      setArchiveTarget(null);
      setArchiveReason('');
      await loadPets();
    } catch (err) {
      showToast(
        formatSupabaseError(
          err,
          'Cannot archive pet (verify no open appointments or active consultations exist).'
        ),
        'error'
      );
    } finally {
      setArchiving(false);
    }
  };

  const filteredPets = pets.filter((pet) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      pet.name.toLowerCase().includes(q) ||
      pet.breed.toLowerCase().includes(q) ||
      pet.species.toLowerCase().includes(q);
    const matchesSpecies =
      speciesFilter === 'All' || pet.species === speciesFilter;
    return matchesSearch && matchesSpecies;
  });

  if (!workspace || loading) {
    return (
      <div className="py-12">
        <LoadingSpinner size="lg" message="Loading organization pet profiles..." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Pets"
        subtitle={`Organization-specific pet profiles in ${workspace.organizationName}. Historical medical records remain preserved even if a pet is archived.`}
        action={
          <button
            type="button"
            onClick={openAddModal}
            className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors flex items-center gap-1.5 shadow-xs"
          >
            <Plus className="w-4 h-4" />
            Register Pet
          </button>
        }
      />

      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-xs text-rose-800 flex items-center justify-between gap-2">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void loadPets()}
            className="px-3 py-1 bg-white border border-rose-200 rounded font-semibold"
          >
            Retry
          </button>
        </div>
      )}

      {/* Search & Filter Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search pets by name, breed, or species..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
          />
        </div>

        <div className="flex items-center gap-1 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
          <Filter className="w-3.5 h-3.5 text-slate-400 mr-1 hidden sm:inline" />
          {['All', ...ALLOWED_PET_SPECIES].map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSpeciesFilter(cat)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                speciesFilter === cat
                  ? 'bg-teal-700 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Pet Cards Grid */}
      {filteredPets.length === 0 ? (
        <EmptyState
          icon={PawPrint}
          title="No pets found"
          description={
            pets.length === 0
              ? `Register your first pet under ${workspace.organizationName} to request appointments and manage health records.`
              : 'Try adjusting your search criteria or species filter.'
          }
          action={{
            label: 'Register Pet',
            onClick: openAddModal,
          }}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredPets.map((pet) => (
            <div
              key={pet.id}
              onClick={() => navigate(`${clientBasePath}/pets/${pet.id}`)}
              className="bg-white rounded-xl border border-slate-200 hover:border-teal-700/50 hover:shadow-md transition-all cursor-pointer overflow-hidden flex flex-col justify-between group"
            >
              <div>
                <div className="relative h-40 bg-gradient-to-br from-teal-800 to-slate-800 overflow-hidden flex items-center justify-center">
                  {pet.avatar_url ? (
                    <img
                      src={pet.avatar_url}
                      alt={pet.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="text-center text-white/90">
                      <PawPrint className="w-10 h-10 mx-auto mb-1 opacity-80" />
                      <span className="text-xs font-semibold tracking-wide">
                        {pet.species} · {pet.breed}
                      </span>
                    </div>
                  )}

                  <div className="absolute top-3 right-3 flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={(e) => openEditModal(pet, e)}
                      title="Edit Pet"
                      className="p-1.5 bg-white/90 backdrop-blur-xs rounded-lg text-slate-700 hover:text-teal-700 shadow-xs transition-colors"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setArchiveTarget(pet);
                        setArchiveReason('');
                      }}
                      title="Archive Pet"
                      className="p-1.5 bg-white/90 backdrop-blur-xs rounded-lg text-slate-700 hover:text-rose-600 shadow-xs transition-colors"
                    >
                      <Archive className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="absolute bottom-2.5 left-3 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-black/60 text-white backdrop-blur-xs">
                    {pet.species}
                  </div>
                </div>

                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-base font-bold text-slate-900 truncate">
                        {pet.name}
                      </h3>
                      <p className="text-xs text-slate-500 truncate">{pet.breed}</p>
                    </div>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700 shrink-0">
                      {pet.gender}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-slate-100">
                    <div className="flex items-center gap-1.5 text-slate-600">
                      <Scale className="w-3.5 h-3.5 text-slate-400" />
                      <span>{pet.weight} kg</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-slate-600">
                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                      <span>{pet.date_of_birth || 'DOB not set'}</span>
                    </div>
                  </div>

                  {pet.allergies && (
                    <div className="flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 p-2 rounded-lg border border-amber-200/60">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span className="line-clamp-1">{pet.allergies}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs font-semibold text-teal-700 group-hover:text-teal-800">
                <span className="flex items-center gap-1">
                  <Shield className="w-3.5 h-3.5" /> Profile, Docs & History
                </span>
                <ChevronRight className="w-4 h-4 text-teal-600 group-hover:translate-x-1 transition-transform" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit Pet Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingPet ? `Edit ${editingPet.name}'s Profile` : 'Register New Pet'}
        subtitle={`Scoped to ${workspace.organizationName}`}
        maxWidth="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Pet Name *
              </label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g. Barnaby"
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Species *
              </label>
              <select
                value={formData.species}
                onChange={(e) => setFormData({ ...formData, species: e.target.value })}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
              >
                {ALLOWED_PET_SPECIES.map((sp) => (
                  <option key={sp} value={sp}>
                    {sp}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Breed *
              </label>
              <input
                type="text"
                required
                value={formData.breed}
                onChange={(e) => setFormData({ ...formData, breed: e.target.value })}
                placeholder="e.g. Golden Retriever"
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Date of Birth
              </label>
              <input
                type="date"
                value={formData.date_of_birth}
                onChange={(e) =>
                  setFormData({ ...formData, date_of_birth: e.target.value })
                }
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Gender *
              </label>
              <select
                value={formData.gender}
                onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
              >
                {ALLOWED_PET_GENDERS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Weight (kg) *
              </label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                required
                value={formData.weight}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    weight: parseFloat(e.target.value) || 0,
                  })
                }
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Color & Markings
              </label>
              <input
                type="text"
                value={formData.color}
                onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                placeholder="e.g. Honey golden with white chest blaze"
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Known Drug or Food Allergies
              </label>
              <input
                type="text"
                value={formData.allergies}
                onChange={(e) =>
                  setFormData({ ...formData, allergies: e.target.value })
                }
                placeholder="e.g. Beef protein, Penicillin sensitivity"
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Background & Chronic Notes
              </label>
              <textarea
                rows={3}
                value={formData.medical_notes}
                onChange={(e) =>
                  setFormData({ ...formData, medical_notes: e.target.value })
                }
                placeholder="Dietary restrictions, previous injuries, or chronic care context..."
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
              />
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg inline-flex items-center gap-1.5 shadow-xs"
            >
              {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {editingPet ? 'Save Changes' : 'Register Pet'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Archive Pet Confirmation Modal */}
      <Modal
        isOpen={Boolean(archiveTarget)}
        onClose={() => setArchiveTarget(null)}
        title={`Archive ${archiveTarget?.name || 'Pet'}?`}
        subtitle="Soft-archives pet profile while preserving immutable clinical records."
        maxWidth="md"
      >
        <div className="space-y-4 text-xs">
          <p className="text-slate-600 leading-relaxed">
            Archiving removes <strong>{archiveTarget?.name}</strong> from active booking lists. Pets with open appointments or active consultations cannot be archived until concluded.
          </p>
          <div>
            <label className="block font-bold text-slate-700 mb-1">
              Reason (Optional)
            </label>
            <input
              type="text"
              value={archiveReason}
              onChange={(e) => setArchiveReason(e.target.value)}
              placeholder="e.g. Rehomed or duplicate entry"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
            />
          </div>
          <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setArchiveTarget(null)}
              className="px-4 py-2 font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={archiving}
              onClick={handleConfirmArchive}
              className="px-4 py-2 font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 rounded-lg inline-flex items-center gap-1.5"
            >
              {archiving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Confirm Archive
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
