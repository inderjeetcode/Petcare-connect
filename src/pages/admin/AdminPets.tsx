import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../../components/common/PageHeader';
import { Modal } from '../../components/common/Modal';
import { Pagination } from '../../components/common/Pagination';
import { useAdminWorkspace } from '../../hooks/useAdminWorkspace';
import { useApp } from '../../context/AppContext';
import { onboardingService } from '../../services/onboardingService';
import { adminPortalService } from '../../services/adminPortalService';
import { formatSupabaseError } from '../../services/authService';
import { ClinicClientRecord } from '../../types/auth';
import { AdminPetDirectoryItem } from '../../types/admin';
import {
  compareIsoDates,
  compareStrings,
  paginateItems,
  sortItems,
} from '../../utils/listManagementHelpers';
import {
  Edit2,
  Eye,
  Loader2,
  PawPrint,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react';

export const AdminPets: React.FC = () => {
  const { workspace } = useAdminWorkspace();
  const { showToast } = useApp();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [pets, setPets] = useState<AdminPetDirectoryItem[]>([]);
  const [clients, setClients] = useState<ClinicClientRecord[]>([]);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [speciesFilter, setSpeciesFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'created_at' | 'name' | 'visits'>('created_at');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [selectedPet, setSelectedPet] = useState<AdminPetDirectoryItem | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingPet, setEditingPet] = useState<AdminPetDirectoryItem | null>(null);
  const [petForm, setPetForm] = useState({
    clinic_client_id: '',
    name: '',
    species: 'Dog',
    breed: '',
    gender: 'Male',
    weight: 10,
    date_of_birth: '',
    color: '',
    allergies: '',
    medical_notes: '',
  });

  const loadData = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    try {
      const [pList, cList] = await Promise.all([
        adminPortalService.getOrgPetsDirectory(workspace.organizationId, includeArchived),
        workspace.canReadClients
          ? onboardingService.getOrgClinicClients(workspace.organizationId).catch(() => [])
          : Promise.resolve([]),
      ]);
      setPets(pList);
      setClients(cList);
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to load pet directory.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [workspace, includeArchived, showToast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    setPage(1);
  }, [includeArchived, speciesFilter, search, sortBy, sortOrder]);

  const approvedClients = useMemo(
    () => clients.filter((c) => c.status === 'approved'),
    [clients]
  );
  const speciesOptions = useMemo(
    () => Array.from(new Set(pets.map((p) => p.species).filter(Boolean))).sort(),
    [pets]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = pets.filter((pet) => {
      if (speciesFilter !== 'all' && pet.species !== speciesFilter) return false;
      if (!q) return true;
      const guardianNames = pet.guardians.map((g) => g.client_name.toLowerCase()).join(' ');
      return (
        pet.name.toLowerCase().includes(q) ||
        pet.breed.toLowerCase().includes(q) ||
        pet.species.toLowerCase().includes(q) ||
        guardianNames.includes(q)
      );
    });
    return sortItems(
      list,
      (a, b) => {
        if (sortBy === 'name') return compareStrings(a.name, b.name);
        if (sortBy === 'visits') return (a.appointment_count || 0) - (b.appointment_count || 0);
        return compareIsoDates(a.created_at, b.created_at);
      },
      sortOrder
    );
  }, [pets, speciesFilter, search, sortBy, sortOrder]);

  const paginatedPets = useMemo(
    () => paginateItems(filtered, page, pageSize),
    [filtered, page, pageSize]
  );

  if (!workspace) return null;

  const openAddPet = () => {
    setEditingPet(null);
    setPetForm({
      clinic_client_id: approvedClients[0]?.id || '',
      name: '',
      species: 'Dog',
      breed: '',
      gender: 'Male',
      weight: 10,
      date_of_birth: '',
      color: '',
      allergies: '',
      medical_notes: '',
    });
    setFormOpen(true);
  };

  const openEditPet = (pet: AdminPetDirectoryItem) => {
    setEditingPet(pet);
    setPetForm({
      clinic_client_id: pet.guardians[0]?.clinic_client_id || '',
      name: pet.name,
      species: pet.species,
      breed: pet.breed,
      gender: pet.gender,
      weight: Number(pet.weight || 0),
      date_of_birth: pet.date_of_birth || '',
      color: pet.color || '',
      allergies: pet.allergies || '',
      medical_notes: pet.medical_notes || '',
    });
    setFormOpen(true);
  };

  const handleSavePet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!petForm.name.trim() || !petForm.breed.trim()) return;
    setSubmitting(true);
    try {
      if (editingPet) {
        await adminPortalService.updatePet(editingPet.id, {
          name: petForm.name.trim(),
          species: petForm.species.trim(),
          breed: petForm.breed.trim(),
          gender: petForm.gender,
          weight: Number(petForm.weight) || 0,
          color: petForm.color.trim(),
          allergies: petForm.allergies.trim(),
          medical_notes: petForm.medical_notes.trim(),
        });
        showToast(`Updated pet record for ${petForm.name.trim()}.`, 'success');
      } else {
        if (!petForm.clinic_client_id) {
          showToast('Select an approved clinic client guardian first.', 'warning');
          setSubmitting(false);
          return;
        }
        await adminPortalService.createPetForClient({
          organization_id: workspace.organizationId,
          clinic_client_id: petForm.clinic_client_id,
          name: petForm.name.trim(),
          species: petForm.species.trim(),
          breed: petForm.breed.trim(),
          gender: petForm.gender,
          weight: Number(petForm.weight) || 0,
          date_of_birth: petForm.date_of_birth || null,
          color: petForm.color.trim() || null,
          allergies: petForm.allergies.trim() || null,
          medical_notes: petForm.medical_notes.trim() || null,
        });
        showToast(`Registered ${petForm.name.trim()} under organization.`, 'success');
      }
      setFormOpen(false);
      await loadData();
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to save pet record.'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organization Pet Directory"
        subtitle="Tenant-isolated registry of registered pets, primary guardians, allergy flags, and visit counts."
        action={
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => void loadData()}
              disabled={loading}
              className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            {workspace.canWritePets && approvedClients.length > 0 && (
              <button
                type="button"
                onClick={openAddPet}
                className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Plus className="w-4 h-4" />
                Register Pet
              </button>
            )}
          </div>
        }
      />

      {/* Search & Filters */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="relative w-full lg:w-96">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by pet name, breed, species, or guardian..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={speciesFilter}
            onChange={(e) => setSpeciesFilter(e.target.value)}
            aria-label="Filter pets by species"
            className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
          >
            <option value="all">All Species ({pets.length})</option>
            {speciesOptions.map((sp) => (
              <option key={sp} value={sp}>
                {sp}
              </option>
            ))}
          </select>

          <select
            value={`${sortBy}:${sortOrder}`}
            onChange={(e) => {
              const [by, dir] = e.target.value.split(':') as ['created_at' | 'name' | 'visits', 'asc' | 'desc'];
              setSortBy(by);
              setSortOrder(dir);
            }}
            aria-label="Sort pets"
            className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
          >
            <option value="created_at:desc">Recently Registered</option>
            <option value="name:asc">Pet Name (A–Z)</option>
            <option value="name:desc">Pet Name (Z–A)</option>
            <option value="visits:desc">Most Visits</option>
          </select>

          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer px-1">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
            />
            Show archived
          </label>
        </div>
      </div>

      {/* Pet Directory Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-10 text-center">
            <Loader2 className="w-6 h-6 text-teal-700 animate-spin mx-auto mb-2" />
            <p className="text-xs text-slate-500">Loading organization pets...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <PawPrint className="w-8 h-8 text-slate-400 mx-auto" />
            <div className="text-sm font-bold text-slate-900">No Registered Pets Found</div>
            <p className="text-xs text-slate-500">
              Registered pets for approved clients in {workspace.organizationName} will appear here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
              <tr>
                <th className="py-3 px-4">Pet</th>
                <th className="py-3 px-4">Species & Breed</th>
                <th className="py-3 px-4">Guardian(s)</th>
                <th className="py-3 px-4">Weight</th>
                <th className="py-3 px-4">Allergies</th>
                <th className="py-3 px-4 text-right">Visits</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedPets.items.map((pet) => (
                <tr key={pet.id} className="hover:bg-slate-50/70">
                  <td className="py-3 px-4">
                    <div className="font-bold text-slate-900">{pet.name}</div>
                    <div className="text-[11px] text-slate-500">
                      {pet.gender}
                      {pet.archived_at ? ' · Archived' : ''}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-semibold text-slate-800">{pet.species}</div>
                    <div className="text-[11px] text-slate-500">{pet.breed}</div>
                  </td>
                  <td className="py-3 px-4 text-slate-700">
                    {pet.guardians.length > 0 ? (
                      <div>
                        <div className="font-medium">{pet.guardians[0].client_name}</div>
                        {pet.guardians.length > 1 && (
                          <div className="text-[11px] text-slate-400">
                            +{pet.guardians.length - 1} co-guardian
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-slate-400">Unlinked</span>
                    )}
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums text-slate-800">
                    {pet.weight} kg
                  </td>
                  <td className="py-3 px-4 text-slate-700">
                    {pet.allergies ? (
                      <span className="text-amber-800 font-medium">{pet.allergies}</span>
                    ) : (
                      <span className="text-slate-400">None noted</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700">
                    {pet.appointment_count}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="inline-flex items-center gap-1.5 justify-end">
                      <button
                        onClick={() => setSelectedPet(pet)}
                        className="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Details
                      </button>
                      {workspace.canWritePets && !pet.archived_at && (
                        <button
                          onClick={() => openEditPet(pet)}
                          className="px-2.5 py-1 text-xs font-semibold text-teal-700 bg-teal-50 border border-teal-200 hover:bg-teal-100 rounded-lg inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                          Edit
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination
            currentPage={paginatedPets.currentPage}
            totalPages={paginatedPets.totalPages}
            totalItems={paginatedPets.totalItems}
            startIndex={paginatedPets.startIndex}
            endIndex={paginatedPets.endIndex}
            pageSize={paginatedPets.pageSize}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
            itemLabel="pets"
          />
          </div>
        )}
      </div>

      {/* Pet Details Modal */}
      <Modal
        isOpen={Boolean(selectedPet)}
        onClose={() => setSelectedPet(null)}
        title={selectedPet ? `${selectedPet.name} (${selectedPet.species})` : 'Pet Profile'}
        subtitle={selectedPet ? `${selectedPet.breed} · ${selectedPet.gender}` : ''}
        maxWidth="lg"
      >
        {selectedPet && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
              <div>
                <div className="text-slate-500">Weight</div>
                <div className="font-mono font-bold text-slate-900 mt-0.5 tabular-nums">
                  {selectedPet.weight} kg
                </div>
              </div>
              <div>
                <div className="text-slate-500">Date of Birth</div>
                <div className="font-mono font-semibold text-slate-900 mt-0.5">
                  {selectedPet.date_of_birth || 'Not recorded'}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Color / Coat</div>
                <div className="font-semibold text-slate-900 mt-0.5">
                  {selectedPet.color || 'Not recorded'}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Visits / Consults</div>
                <div className="font-mono font-semibold text-slate-900 mt-0.5 tabular-nums">
                  {selectedPet.appointment_count} / {selectedPet.consultation_count}
                </div>
              </div>
            </div>

            <div>
              <div className="font-semibold text-slate-800 mb-1">Allergies & Intake Notes</div>
              <div className="p-3 rounded-lg border border-slate-200 text-slate-700 space-y-1">
                <div>
                  <strong>Allergies:</strong> {selectedPet.allergies || 'None recorded'}
                </div>
                <div>
                  <strong>Medical Notes:</strong> {selectedPet.medical_notes || 'None recorded'}
                </div>
              </div>
            </div>

            <div>
              <div className="font-semibold text-slate-800 mb-2">
                Authorized Guardians ({selectedPet.guardians.length})
              </div>
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
                {selectedPet.guardians.map((g) => (
                  <div key={g.id} className="p-3 flex items-center justify-between gap-2">
                    <div>
                      <div className="font-bold text-slate-900">
                        {g.client_name} {g.is_primary ? '(Primary)' : ''}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {g.relationship} · {g.client_email || g.client_phone || 'No contact'}
                      </div>
                    </div>
                    <span className="text-[11px] font-semibold text-slate-600 capitalize">
                      {g.client_status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Register / Edit Pet Modal */}
      <Modal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingPet ? `Edit Pet — ${editingPet.name}` : 'Register Pet for Clinic Client'}
        maxWidth="lg"
      >
        <form onSubmit={handleSavePet} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {!editingPet && (
              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">
                  Approved Clinic Client *
                </label>
                <select
                  required
                  value={petForm.clinic_client_id}
                  onChange={(e) =>
                    setPetForm({ ...petForm, clinic_client_id: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                >
                  {approvedClients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.full_name} {c.phone ? `(${c.phone})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Pet Name *</label>
              <input
                type="text"
                required
                value={petForm.name}
                onChange={(e) => setPetForm({ ...petForm, name: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Species *</label>
              <input
                type="text"
                required
                value={petForm.species}
                onChange={(e) => setPetForm({ ...petForm, species: e.target.value })}
                placeholder="Dog, Cat, Rabbit..."
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Breed *</label>
              <input
                type="text"
                required
                value={petForm.breed}
                onChange={(e) => setPetForm({ ...petForm, breed: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Gender *</label>
              <select
                value={petForm.gender}
                onChange={(e) => setPetForm({ ...petForm, gender: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
              >
                <option value="Male">Male</option>
                <option value="Female">Female</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Weight (kg) *</label>
              <input
                type="number"
                required
                step="0.1"
                min={0.1}
                value={petForm.weight}
                onChange={(e) =>
                  setPetForm({ ...petForm, weight: Number(e.target.value) || 0 })
                }
                className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg"
              />
            </div>

            {!editingPet && (
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Date of Birth</label>
                <input
                  type="date"
                  value={petForm.date_of_birth}
                  onChange={(e) => setPetForm({ ...petForm, date_of_birth: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
            )}

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Color</label>
              <input
                type="text"
                value={petForm.color}
                onChange={(e) => setPetForm({ ...petForm, color: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">Known Allergies</label>
              <input
                type="text"
                value={petForm.allergies}
                onChange={(e) => setPetForm({ ...petForm, allergies: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">Intake / Care Notes</label>
              <textarea
                rows={2}
                value={petForm.medical_notes}
                onChange={(e) => setPetForm({ ...petForm, medical_notes: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="px-4 py-2 font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg inline-flex items-center gap-1.5"
            >
              {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {editingPet ? 'Save Pet Changes' : 'Register Pet'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
