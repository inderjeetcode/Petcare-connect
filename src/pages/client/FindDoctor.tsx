import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { useClientWorkspace } from '../../hooks/useClientWorkspace';
import { clientPortalService } from '../../services/clientPortalService';
import { Branch } from '../../types/auth';
import { AvailableSlot, ClientDoctor, ClientPet } from '../../types/client';
import {
  formatTimeRangeInZone,
  validateAppointmentRequest,
  weekdayLabel,
} from '../../utils/clientPortalHelpers';
import { PageHeader } from '../../components/common/PageHeader';
import { Modal } from '../../components/common/Modal';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import {
  Search,
  Star,
  Award,
  Clock,
  DollarSign,
  Calendar,
  CheckCircle2,
  Info,
  MapPin,
  Stethoscope,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';

function todayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export const FindDoctor: React.FC = () => {
  const { showToast } = useApp();
  const navigate = useNavigate();
  const { workspace, clientBasePath } = useClientWorkspace();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [doctors, setDoctors] = useState<ClientDoctor[]>([]);
  const [pets, setPets] = useState<ClientPet[]>([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBranchId, setSelectedBranchId] = useState<string>('all');
  const [selectedSpecialty, setSelectedSpecialty] = useState<string>('All');

  // Booking modal state
  const [bookingDoctor, setBookingDoctor] = useState<ClientDoctor | null>(null);
  const [bookingBranchId, setBookingBranchId] = useState('');
  const [bookingDate, setBookingDate] = useState(todayIsoDate());
  const [bookingPetId, setBookingPetId] = useState('');
  const [bookingReason, setBookingReason] = useState('');
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadDirectory = useCallback(async () => {
    if (!workspace) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [dir, petList] = await Promise.all([
        clientPortalService.getDoctorsAndBranches(workspace.organizationId),
        clientPortalService.getPets(workspace.organizationId),
      ]);
      setBranches(dir.branches);
      setDoctors(dir.doctors);
      setPets(petList);
    } catch (err: any) {
      setError(err.message || 'Unable to load clinic veterinary specialists.');
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => {
    void loadDirectory();
  }, [loadDirectory]);

  const specialties = useMemo(() => {
    const unique = Array.from(
      new Set(doctors.map((d) => d.specialization).filter(Boolean))
    );
    return ['All', ...unique];
  }, [doctors]);

  const branchNameMap = useMemo(
    () => new Map(branches.map((b) => [b.id, b])),
    [branches]
  );

  const filteredDoctors = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return doctors.filter((doc) => {
      const matchesSearch =
        !q ||
        doc.full_name.toLowerCase().includes(q) ||
        doc.specialization.toLowerCase().includes(q) ||
        doc.qualification.toLowerCase().includes(q);
      const matchesBranch =
        selectedBranchId === 'all' || doc.branch_ids.includes(selectedBranchId);
      const matchesSpecialty =
        selectedSpecialty === 'All' || doc.specialization === selectedSpecialty;
      return doc.is_active && matchesSearch && matchesBranch && matchesSpecialty;
    });
  }, [doctors, searchQuery, selectedBranchId, selectedSpecialty]);

  const fetchSlotsForSelection = useCallback(
    async (docId: string, branchId: string, date: string) => {
      if (!workspace || !docId || !branchId || !date) {
        setSlots([]);
        return;
      }
      setSlotsLoading(true);
      setSlotsError(null);
      setSelectedSlot(null);
      try {
        const res = await clientPortalService.getAvailableSlots({
          organization_id: workspace.organizationId,
          branch_id: branchId,
          doctor_profile_id: docId,
          date,
        });
        setSlots(res);
      } catch (err: any) {
        setSlots([]);
        setSlotsError(err.message || 'Unable to load open slots for that date.');
      } finally {
        setSlotsLoading(false);
      }
    },
    [workspace]
  );

  const handleOpenBooking = (doctor: ClientDoctor) => {
    const defaultBranch =
      (selectedBranchId !== 'all' && doctor.branch_ids.includes(selectedBranchId)
        ? selectedBranchId
        : doctor.branch_ids[0]) ||
      branches[0]?.id ||
      '';
    const initialDate = todayIsoDate();

    setBookingDoctor(doctor);
    setBookingBranchId(defaultBranch);
    setBookingDate(initialDate);
    setBookingPetId(pets[0]?.id || '');
    setBookingReason('');
    setSelectedSlot(null);
    void fetchSlotsForSelection(doctor.id, defaultBranch, initialDate);
  };

  const handleBranchOrDateChange = (nextBranch: string, nextDate: string) => {
    setBookingBranchId(nextBranch);
    setBookingDate(nextDate);
    if (bookingDoctor) {
      void fetchSlotsForSelection(bookingDoctor.id, nextBranch, nextDate);
    }
  };

  const handleBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bookingDoctor || !workspace) return;

    const validationError = validateAppointmentRequest({
      organization_id: workspace.organizationId,
      branch_id: bookingBranchId,
      pet_id: bookingPetId,
      doctor_profile_id: bookingDoctor.id,
      requested_start: selectedSlot?.slot_start || '',
      requested_end: selectedSlot?.slot_end || '',
      reason: bookingReason,
    });

    if (validationError) {
      showToast(validationError, 'error');
      return;
    }

    if (!selectedSlot) return;

    setSubmitting(true);
    try {
      await clientPortalService.requestAppointment({
        organization_id: workspace.organizationId,
        branch_id: bookingBranchId,
        pet_id: bookingPetId,
        doctor_profile_id: bookingDoctor.id,
        requested_start: selectedSlot.slot_start,
        requested_end: selectedSlot.slot_end,
        reason: bookingReason,
      });
      setBookingDoctor(null);
      showToast(
        'Appointment request submitted! Clinic staff will review and confirm your slot.',
        'success'
      );
      navigate(`${clientBasePath}/consultations`);
    } catch (err: any) {
      showToast(err.message || 'Unable to submit appointment request.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (!workspace || loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12 flex items-center justify-center">
        <LoadingSpinner size="lg" label="Loading veterinary doctors & branch availability..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-xl p-6 text-xs text-rose-800 space-y-3">
        <div className="flex items-center gap-2 font-bold">
          <AlertCircle className="w-4 h-4 text-rose-600" />
          Unable to load clinic directory
        </div>
        <p>{error}</p>
        <button
          type="button"
          onClick={() => void loadDirectory()}
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
        title="Doctors & Appointment Booking"
        subtitle={`Browse active veterinary specialists and branches in ${workspace.organizationName}.`}
      />

      {/* Search & Filters */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3 shadow-xs">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-1">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search doctor, specialty, qualification..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
            />
          </div>

          <select
            value={selectedBranchId}
            onChange={(e) => setSelectedBranchId(e.target.value)}
            className="px-3 py-2 text-xs rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
          >
            <option value="all">All Clinic Branches ({branches.length})</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} {b.city ? `(${b.city})` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1 overflow-x-auto pb-1 lg:pb-0">
          {specialties.map((spec) => (
            <button
              key={spec}
              type="button"
              onClick={() => setSelectedSpecialty(spec)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap transition-all ${
                selectedSpecialty === spec
                  ? 'bg-teal-700 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {spec}
            </button>
          ))}
        </div>
      </div>

      {/* Doctor Cards */}
      {filteredDoctors.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center space-y-2">
          <Stethoscope className="w-8 h-8 text-slate-300 mx-auto" />
          <h3 className="text-sm font-bold text-slate-900">
            No veterinary specialists match your filter
          </h3>
          <p className="text-xs text-slate-500">
            Try clearing the branch or specialty filter to view all active clinic doctors.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filteredDoctors.map((doc) => {
            const assignedBranches = doc.branch_ids
              .map((bid) => branchNameMap.get(bid))
              .filter(Boolean) as Branch[];
            const uniqueWeekdays = Array.from(
              new Set(doc.schedules.map((s) => s.weekday))
            ).sort((a, b) => a - b);

            return (
              <div
                key={doc.id}
                className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs hover:border-slate-300 transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start gap-4">
                    {doc.avatar_url ? (
                      <img
                        src={doc.avatar_url}
                        alt={doc.full_name}
                        className="w-16 h-16 rounded-xl object-cover border border-slate-200 shrink-0"
                      />
                    ) : (
                      <div className="w-16 h-16 rounded-xl bg-teal-50 border border-teal-200 text-teal-800 flex items-center justify-center font-bold text-base shrink-0">
                        {doc.full_name.slice(0, 2).toUpperCase()}
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-base font-bold text-slate-900 truncate">
                          {doc.full_name}
                        </h3>
                        <div className="flex items-center gap-1 text-xs font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded shrink-0">
                          <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500" />
                          <span>{doc.rating !== null ? doc.rating.toFixed(1) : 'New'}</span>
                          {doc.total_reviews > 0 && (
                            <span className="text-slate-400 font-normal">
                              ({doc.total_reviews})
                            </span>
                          )}
                        </div>
                      </div>

                      <p className="text-xs font-semibold text-teal-800 mt-0.5">
                        {doc.specialization || 'General Veterinary Practice'}
                      </p>
                      <p className="text-[11px] text-slate-500">{doc.qualification}</p>
                    </div>
                  </div>

                  {doc.bio && (
                    <p className="text-xs text-slate-600 mt-3 leading-relaxed line-clamp-2">
                      {doc.bio}
                    </p>
                  )}

                  {/* Branch badges */}
                  {assignedBranches.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {assignedBranches.map((b) => (
                        <span
                          key={b.id}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-slate-100 text-slate-700 font-medium"
                        >
                          <MapPin className="w-3 h-3 text-teal-700" />
                          {b.name}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-slate-100 text-xs">
                    <div className="flex items-center gap-1.5 text-slate-600">
                      <Award className="w-3.5 h-3.5 text-slate-400" />
                      <span>{doc.experience_years} Years Experience</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-slate-600">
                      <DollarSign className="w-3.5 h-3.5 text-slate-400" />
                      <span>
                        Fee:{' '}
                        <strong className="text-slate-900">
                          ${doc.consultation_fee}
                        </strong>
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-500 flex items-center gap-1.5 truncate">
                    <Clock className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span className="truncate">
                      {uniqueWeekdays.length > 0
                        ? `Clinic Days: ${uniqueWeekdays.map(weekdayLabel).join(', ')}`
                        : 'Check calendar for open slots'}
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={doc.branch_ids.length === 0}
                    onClick={() => handleOpenBooking(doc)}
                    className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:bg-slate-300 rounded-lg transition-colors shadow-xs shrink-0"
                  >
                    Request Appointment
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Appointment Request Modal */}
      <Modal
        isOpen={Boolean(bookingDoctor)}
        onClose={() => setBookingDoctor(null)}
        title="Request Appointment Slot"
        subtitle={
          bookingDoctor
            ? `${bookingDoctor.full_name} · ${bookingDoctor.specialization}`
            : ''
        }
        maxWidth="lg"
      >
        {bookingDoctor && (
          <form onSubmit={handleBookingSubmit} className="space-y-4">
            <div className="bg-teal-50 border border-teal-200 rounded-lg p-3 text-xs text-teal-900 flex items-start gap-2">
              <Info className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
              <div>
                <strong>Pending Request Policy:</strong> Submitting an appointment request does{' '}
                <strong>not</strong> reserve the slot immediately. Your clinic's front desk / admin team confirms availability, which prevents double-booking.
              </div>
            </div>

            {pets.length === 0 ? (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-xs text-amber-900 space-y-2">
                <p className="font-bold">Register a pet first</p>
                <p>
                  You must register at least one pet under {workspace.organizationName} before requesting an appointment.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setBookingDoctor(null);
                    navigate(`${clientBasePath}/pets`);
                  }}
                  className="px-3 py-1.5 bg-teal-700 text-white rounded-lg font-semibold"
                >
                  Go to My Pets
                </button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Select Pet *
                    </label>
                    <select
                      required
                      value={bookingPetId}
                      onChange={(e) => setBookingPetId(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
                    >
                      {pets.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.species} · {p.breed})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Clinic Branch *
                    </label>
                    <select
                      required
                      value={bookingBranchId}
                      onChange={(e) =>
                        handleBranchOrDateChange(e.target.value, bookingDate)
                      }
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
                    >
                      {bookingDoctor.branch_ids.map((bid) => {
                        const b = branchNameMap.get(bid);
                        return (
                          <option key={bid} value={bid}>
                            {b ? `${b.name}${b.city ? ` (${b.city})` : ''}` : bid}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Appointment Date *
                  </label>
                  <div className="relative">
                    <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="date"
                      required
                      min={todayIsoDate()}
                      value={bookingDate}
                      onChange={(e) =>
                        handleBranchOrDateChange(bookingBranchId, e.target.value)
                      }
                      className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
                    />
                  </div>
                </div>

                {/* Real Available Slots from get_available_slots RPC */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    Available Time Slots *{' '}
                    {branchNameMap.get(bookingBranchId)?.timezone && (
                      <span className="text-[11px] font-normal text-slate-400">
                        ({branchNameMap.get(bookingBranchId)?.timezone})
                      </span>
                    )}
                  </label>

                  {slotsLoading ? (
                    <div className="p-4 border border-slate-200 rounded-lg bg-slate-50 flex justify-center">
                      <LoadingSpinner size="sm" label="Checking doctor schedule..." />
                    </div>
                  ) : slotsError ? (
                    <div className="p-3 border border-rose-200 bg-rose-50 rounded-lg text-xs text-rose-800">
                      {slotsError}
                    </div>
                  ) : slots.length === 0 ? (
                    <div className="p-3 border border-slate-200 bg-slate-50 rounded-lg text-xs text-slate-500">
                      No open slots available on this date for the selected branch. Try another date or branch.
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-44 overflow-y-auto p-1">
                      {slots.map((slot) => {
                        const isSelected =
                          selectedSlot?.slot_start === slot.slot_start;
                        const label = formatTimeRangeInZone(
                          slot.slot_start,
                          slot.slot_end,
                          branchNameMap.get(bookingBranchId)?.timezone
                        );
                        return (
                          <button
                            key={slot.slot_start}
                            type="button"
                            onClick={() => setSelectedSlot(slot)}
                            className={`px-2.5 py-2 text-xs font-semibold rounded-lg border transition-all ${
                              isSelected
                                ? 'bg-teal-700 text-white border-teal-700 shadow-xs'
                                : 'bg-white text-slate-700 border-slate-200 hover:border-teal-600'
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Clinical Reason & Symptoms *
                  </label>
                  <textarea
                    required
                    rows={3}
                    placeholder="Describe symptoms, onset, appetite/behavior changes, or requested wellness service..."
                    value={bookingReason}
                    onChange={(e) => setBookingReason(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
                  />
                </div>

                <div className="bg-slate-50 rounded-lg p-3 border border-slate-200 text-xs flex justify-between">
                  <span className="text-slate-600">Standard Consultation Fee:</span>
                  <span className="font-bold text-slate-900">
                    ${bookingDoctor.consultation_fee}
                  </span>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setBookingDoctor(null)}
                    className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting || !selectedSlot}
                    className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg flex items-center gap-1.5 shadow-xs"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    {submitting ? 'Submitting...' : 'Submit Appointment Request'}
                  </button>
                </div>
              </>
            )}
          </form>
        )}
      </Modal>
    </div>
  );
};
