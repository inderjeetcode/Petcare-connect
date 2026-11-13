import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { useClientWorkspace } from '../../hooks/useClientWorkspace';
import { clientPortalService } from '../../services/clientPortalService';
import {
  ClientAppointment,
  ClientConsultation,
  ClientReview,
} from '../../types/client';
import {
  computeChatWindowStatus,
  formatDateTimeInZone,
  validateReviewInput,
} from '../../utils/clientPortalHelpers';
import { PageHeader } from '../../components/common/PageHeader';
import { StatusBadge } from '../../components/common/StatusBadge';
import { Modal } from '../../components/common/Modal';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import {
  CalendarCheck,
  Clock,
  MessageSquare,
  Search,
  Stethoscope,
  Star,
  XCircle,
  AlertCircle,
  RefreshCw,
  MapPin,
  History,
} from 'lucide-react';

type PrimarySection = 'appointments' | 'consultations' | 'reviews';

export const MyConsultations: React.FC = () => {
  const { showToast } = useApp();
  const navigate = useNavigate();
  const { workspace, clientBasePath } = useClientWorkspace();

  const [section, setSection] = useState<PrimarySection>('appointments');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [appointments, setAppointments] = useState<ClientAppointment[]>([]);
  const [consultations, setConsultations] = useState<ClientConsultation[]>([]);
  const [reviews, setReviews] = useState<ClientReview[]>([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [apptFilter, setApptFilter] = useState<string>('all');
  const [consFilter, setConsFilter] = useState<string>('all');

  // Modals
  const [selectedConsultation, setSelectedConsultation] =
    useState<ClientConsultation | null>(null);
  const [cancellingAppt, setCancellingAppt] = useState<ClientAppointment | null>(
    null
  );
  const [cancelReason, setCancelReason] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);

  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);

  // Review modal state
  const [reviewTarget, setReviewTarget] = useState<ClientConsultation | null>(null);
  const [rating, setRating] = useState(5);
  const [reviewText, setReviewText] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);

  // Live countdown ticker every 60 seconds
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const loadData = useCallback(async () => {
    if (!workspace) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [appts, cons, revs] = await Promise.all([
        clientPortalService.getAppointments(workspace.organizationId),
        clientPortalService.getConsultations(workspace.organizationId),
        clientPortalService.getMyReviews(workspace.organizationId, workspace.userId),
      ]);
      setAppointments(appts);
      setConsultations(cons);
      setReviews(revs);
    } catch (err: any) {
      setError(err.message || 'Unable to load appointments and consultations.');
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const reviewedConsultationIds = useMemo(
    () => new Set(reviews.map((r) => r.consultation_id)),
    [reviews]
  );

  const filteredAppointments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return appointments.filter((a) => {
      const matchesFilter = apptFilter === 'all' || a.status === apptFilter;
      const matchesSearch =
        !q ||
        (a.pet_name || '').toLowerCase().includes(q) ||
        (a.doctor_name || '').toLowerCase().includes(q) ||
        (a.branch_name || '').toLowerCase().includes(q) ||
        a.reason.toLowerCase().includes(q);
      return matchesFilter && matchesSearch;
    });
  }, [appointments, apptFilter, searchQuery]);

  const filteredConsultations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return consultations.filter((c) => {
      const matchesFilter =
        consFilter === 'all' || c.consultation_status === consFilter;
      const matchesSearch =
        !q ||
        (c.doctor_name || '').toLowerCase().includes(q) ||
        (c.pet_name || '').toLowerCase().includes(q) ||
        c.consultation_reason.toLowerCase().includes(q);
      return matchesFilter && matchesSearch;
    });
  }, [consultations, consFilter, searchQuery]);

  const handleConfirmCancelAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancellingAppt) return;
    setCancelBusy(true);
    try {
      await clientPortalService.cancelAppointment(
        cancellingAppt.id,
        cancelReason || 'Cancelled by pet owner'
      );
      showToast('Appointment cancelled cleanly.', 'info');
      setCancellingAppt(null);
      setCancelReason('');
      await loadData();
    } catch (err: any) {
      showToast(err.message || 'Failed to cancel appointment.', 'error');
    } finally {
      setCancelBusy(false);
    }
  };

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewTarget) return;
    const validationErr = validateReviewInput(rating, reviewText);
    if (validationErr) {
      showToast(validationErr, 'error');
      return;
    }

    setReviewBusy(true);
    try {
      await clientPortalService.submitReview(reviewTarget.id, rating, reviewText);
      showToast('Thank you! Your veterinary consultation review was submitted.', 'success');
      setReviewTarget(null);
      setReviewText('');
      setRating(5);
      await loadData();
    } catch (err: any) {
      showToast(err.message || 'Unable to submit review.', 'error');
    } finally {
      setReviewBusy(false);
    }
  };

  if (!workspace || loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12 flex items-center justify-center">
        <LoadingSpinner size="lg" label="Loading appointments, consultations, and reviews..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-xl p-6 text-xs text-rose-800 space-y-3">
        <div className="flex items-center gap-2 font-bold">
          <AlertCircle className="w-4 h-4 text-rose-600" />
          Unable to load appointments & consultations
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
        title="Appointments & Consultations"
        subtitle={`Manage appointment requests, active 7-day chat consultations, and veterinary feedback in ${workspace.organizationName}.`}
        action={
          <button
            type="button"
            onClick={() => navigate(`${clientBasePath}/doctors`)}
            className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors flex items-center gap-1.5 shadow-xs"
          >
            <Stethoscope className="w-4 h-4" />
            Request Appointment
          </button>
        }
      />

      {/* Top Section Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
          <button
            type="button"
            onClick={() => setSection('appointments')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              section === 'appointments'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Appointments ({appointments.length})
          </button>
          <button
            type="button"
            onClick={() => setSection('consultations')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              section === 'consultations'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Clinical Consultations ({consultations.length})
          </button>
          <button
            type="button"
            onClick={() => setSection('reviews')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              section === 'reviews'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            My Reviews ({reviews.length})
          </button>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search pet, doctor, branch..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
          />
        </div>
      </div>

      {/* SECTION 1: APPOINTMENTS */}
      {section === 'appointments' && (
        <div className="space-y-4">
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {[
              { key: 'all', label: `All (${appointments.length})` },
              {
                key: 'requested',
                label: `Pending (${appointments.filter((a) => a.status === 'requested').length})`,
              },
              {
                key: 'confirmed',
                label: `Confirmed (${appointments.filter((a) => a.status === 'confirmed').length})`,
              },
              {
                key: 'declined',
                label: `Declined (${appointments.filter((a) => a.status === 'declined').length})`,
              },
              {
                key: 'cancelled',
                label: `Cancelled (${appointments.filter((a) => a.status === 'cancelled').length})`,
              },
              {
                key: 'completed',
                label: `Completed (${appointments.filter((a) => a.status === 'completed').length})`,
              },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setApptFilter(tab.key)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap transition-all ${
                  apptFilter === tab.key
                    ? 'bg-teal-700 text-white'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {filteredAppointments.length === 0 ? (
            <div className="p-12 text-center bg-white rounded-xl border border-slate-200">
              <CalendarCheck className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <h3 className="text-sm font-bold text-slate-800">No appointments found</h3>
              <p className="text-xs text-slate-500 mt-1">
                Book an appointment with a veterinarian in your active clinic.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredAppointments.map((a) => {
                const canCancel = a.status === 'requested' || a.status === 'confirmed';
                const showHist = expandedHistoryId === a.id;
                return (
                  <div
                    key={a.id}
                    className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-3"
                  >
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="space-y-1.5 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge status={a.status} />
                          <span className="text-xs font-semibold text-teal-800 flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" />
                            {formatDateTimeInZone(a.requested_start, a.branch_timezone)}
                          </span>
                          <span className="text-xs text-slate-500 flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5 text-slate-400" />
                            {a.branch_name}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-bold text-slate-900">
                            {a.pet_name} {a.pet_species ? `(${a.pet_species})` : ''}
                          </h3>
                          <span className="text-xs text-slate-400">·</span>
                          <span className="text-xs font-semibold text-slate-700">
                            {a.doctor_name}
                          </span>
                        </div>

                        <p className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                          <strong>Reason:</strong> {a.reason}
                        </p>

                        {a.decline_reason && (
                          <p className="text-xs text-rose-700 bg-rose-50 p-2.5 rounded-lg border border-rose-200">
                            <strong>Decline Note:</strong> {a.decline_reason}
                          </p>
                        )}
                        {a.cancellation_reason && (
                          <p className="text-xs text-slate-600 bg-slate-100 p-2.5 rounded-lg border border-slate-200">
                            <strong>Cancellation Note:</strong> {a.cancellation_reason}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {a.history && a.history.length > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedHistoryId(showHist ? null : a.id)
                            }
                            className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg flex items-center gap-1"
                          >
                            <History className="w-3.5 h-3.5" />
                            {showHist ? 'Hide Log' : 'Status Log'}
                          </button>
                        )}
                        {canCancel && (
                          <button
                            type="button"
                            onClick={() => {
                              setCancellingAppt(a);
                              setCancelReason('');
                            }}
                            className="px-3 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg flex items-center gap-1"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            Cancel
                          </button>
                        )}
                      </div>
                    </div>

                    {showHist && a.history && (
                      <div className="pt-3 border-t border-slate-100 space-y-1.5">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                          Audit Timeline
                        </div>
                        {a.history.map((h) => (
                          <div
                            key={h.id}
                            className="text-xs text-slate-600 flex flex-wrap items-center gap-2"
                          >
                            <span className="font-mono text-[11px] text-slate-400">
                              {new Date(h.changed_at).toLocaleString()}
                            </span>
                            <span className="font-semibold text-slate-800">
                              {h.from_status ? `${h.from_status} → ` : ''}
                              {h.to_status}
                            </span>
                            {h.reason && (
                              <span className="text-slate-500">({h.reason})</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SECTION 2: CONSULTATIONS */}
      {section === 'consultations' && (
        <div className="space-y-4">
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {[
              { key: 'all', label: `All (${consultations.length})` },
              {
                key: 'active',
                label: `Active (${consultations.filter((c) => c.consultation_status === 'active').length})`,
              },
              {
                key: 'pending',
                label: `Pending (${consultations.filter((c) => c.consultation_status === 'pending').length})`,
              },
              {
                key: 'completed',
                label: `Completed (${consultations.filter((c) => c.consultation_status === 'completed').length})`,
              },
              {
                key: 'expired',
                label: `Expired (${consultations.filter((c) => c.consultation_status === 'expired').length})`,
              },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setConsFilter(tab.key)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap transition-all ${
                  consFilter === tab.key
                    ? 'bg-teal-700 text-white'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {filteredConsultations.length === 0 ? (
            <div className="p-12 text-center bg-white rounded-xl border border-slate-200">
              <MessageSquare className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <h3 className="text-sm font-bold text-slate-800">No consultations found</h3>
              <p className="text-xs text-slate-500 mt-1">
                Confirmed clinical consultations appear here with their 7-day chat access timeline.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredConsultations.map((c) => {
                const timer = computeChatWindowStatus(c, nowMs);
                const canReview =
                  (c.consultation_status === 'completed' ||
                    c.consultation_status === 'expired') &&
                  !reviewedConsultationIds.has(c.id);
                const alreadyReviewed = reviewedConsultationIds.has(c.id);

                return (
                  <div
                    key={c.id}
                    className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4"
                  >
                    <div className="space-y-2 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={c.consultation_status} />
                        <span className="text-xs text-slate-500">
                          {new Date(c.created_at).toLocaleDateString()}
                        </span>
                        {timer.isActive && (
                          <span className="text-xs font-mono font-bold text-teal-800 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded flex items-center gap-1">
                            <Clock className="w-3 h-3 text-teal-700" />
                            {timer.formatted}
                          </span>
                        )}
                        {timer.isExpired && c.consultation_status === 'expired' && (
                          <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded font-medium">
                            Read-only (7-day window passed)
                          </span>
                        )}
                        {alreadyReviewed && (
                          <span className="text-xs text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded font-semibold flex items-center gap-1">
                            <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                            Reviewed
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-bold text-slate-900">
                          {c.pet_name} {c.pet_species ? `(${c.pet_species})` : ''}
                        </h3>
                        <span className="text-xs text-slate-400">·</span>
                        <span className="text-xs font-semibold text-teal-800">
                          Doctor: {c.doctor_name}
                        </span>
                      </div>

                      <p className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                        <strong>Reason:</strong> {c.consultation_reason}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setSelectedConsultation(c)}
                        className="px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 border border-slate-200 rounded-lg"
                      >
                        Details
                      </button>

                      {canReview && (
                        <button
                          type="button"
                          onClick={() => {
                            setReviewTarget(c);
                            setRating(5);
                            setReviewText('');
                          }}
                          className="px-3 py-1.5 text-xs font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg flex items-center gap-1"
                        >
                          <Star className="w-3.5 h-3.5" />
                          Leave Review
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() =>
                          navigate(`${clientBasePath}/chat/${c.id}`)
                        }
                        className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg flex items-center gap-1.5 ${
                          timer.canSendMessages
                            ? 'bg-teal-700 text-white hover:bg-teal-800 shadow-xs'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        {timer.canSendMessages ? 'Live Chat' : 'Chat History'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SECTION 3: REVIEWS */}
      {section === 'reviews' && (
        <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 shadow-xs">
          {reviews.length === 0 ? (
            <div className="p-12 text-center space-y-2">
              <Star className="w-8 h-8 text-slate-300 mx-auto" />
              <h3 className="text-sm font-bold text-slate-800">No reviews submitted yet</h3>
              <p className="text-xs text-slate-500">
                Once a consultation is completed or finishes its 7-day window, you can rate your veterinary experience from the Clinical Consultations tab.
              </p>
            </div>
          ) : (
            reviews.map((rev) => (
              <div key={rev.id} className="p-5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-0.5">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Star
                          key={star}
                          className={`w-4 h-4 ${
                            star <= rev.rating
                              ? 'fill-amber-500 text-amber-500'
                              : 'text-slate-200'
                          }`}
                        />
                      ))}
                    </div>
                    <span className="text-xs font-bold text-slate-900">
                      {rev.doctor_name}
                    </span>
                    {rev.pet_name && (
                      <span className="text-xs text-slate-500">· Patient: {rev.pet_name}</span>
                    )}
                  </div>
                  <span className="text-[11px] text-slate-400">
                    {new Date(rev.created_at).toLocaleDateString()}
                  </span>
                </div>
                {rev.review_text && (
                  <p className="text-xs text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-100">
                    {rev.review_text}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Cancel Appointment Modal */}
      <Modal
        isOpen={Boolean(cancellingAppt)}
        onClose={() => setCancellingAppt(null)}
        title="Cancel Appointment Request"
        subtitle={
          cancellingAppt
            ? `${cancellingAppt.pet_name} with ${cancellingAppt.doctor_name}`
            : ''
        }
        maxWidth="md"
      >
        {cancellingAppt && (
          <form onSubmit={handleConfirmCancelAppointment} className="space-y-4">
            <p className="text-xs text-slate-600 leading-relaxed">
              Cancelling this appointment will release any confirmed time slot and log the cancellation in clinic history.
            </p>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Cancellation Reason (Optional)
              </label>
              <textarea
                rows={2}
                placeholder="e.g., Rescheduling for next week..."
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setCancellingAppt(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                Keep Appointment
              </button>
              <button
                type="submit"
                disabled={cancelBusy}
                className="px-4 py-2 text-xs font-semibold text-white bg-rose-700 hover:bg-rose-800 disabled:opacity-50 rounded-lg"
              >
                {cancelBusy ? 'Cancelling...' : 'Confirm Cancellation'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Consultation Details Modal */}
      <Modal
        isOpen={Boolean(selectedConsultation)}
        onClose={() => setSelectedConsultation(null)}
        title="Consultation Details & 7-Day Timeline"
        subtitle={`Reference ID: ${selectedConsultation?.id}`}
        maxWidth="lg"
      >
        {selectedConsultation && (
          <div className="space-y-4 text-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <StatusBadge status={selectedConsultation.consultation_status} />
              <span className="text-slate-500">
                Created: {new Date(selectedConsultation.created_at).toLocaleString()}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3 rounded-lg border border-slate-100">
              <div>
                <span className="text-slate-400 block font-medium">Assigned Doctor:</span>
                <span className="font-bold text-slate-900">
                  {selectedConsultation.doctor_name}
                </span>
                <span className="text-slate-500 block text-[11px]">
                  {selectedConsultation.doctor_specialization}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block font-medium">Patient:</span>
                <span className="font-bold text-slate-900">
                  {selectedConsultation.pet_name}
                </span>
                <span className="text-slate-500 block text-[11px]">
                  {selectedConsultation.pet_species}
                  {selectedConsultation.pet_breed
                    ? ` · ${selectedConsultation.pet_breed}`
                    : ''}
                </span>
              </div>
            </div>

            <div className="bg-teal-50 border border-teal-200 rounded-lg p-3.5 space-y-2">
              <span className="font-bold text-teal-900 uppercase tracking-wide block">
                7-Day Chat Access Schedule
              </span>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <span className="text-teal-700 block">Activated At:</span>
                  <span className="font-semibold text-slate-900">
                    {selectedConsultation.activated_at
                      ? new Date(selectedConsultation.activated_at).toLocaleString()
                      : 'Pending Clinic Approval'}
                  </span>
                </div>
                <div>
                  <span className="text-teal-700 block">Expires At:</span>
                  <span className="font-semibold text-slate-900">
                    {selectedConsultation.expires_at
                      ? new Date(selectedConsultation.expires_at).toLocaleString()
                      : 'Calculated upon activation'}
                  </span>
                </div>
              </div>
              {selectedConsultation.consultation_status === 'active' && (
                <div className="text-teal-800 font-semibold pt-1">
                  Remaining: {computeChatWindowStatus(selectedConsultation, nowMs).formatted}
                </div>
              )}
            </div>

            <div>
              <span className="font-bold text-slate-700 uppercase tracking-wide block mb-1">
                Clinical Reason:
              </span>
              <p className="bg-slate-50 p-3 rounded border border-slate-100 text-slate-800 leading-relaxed">
                {selectedConsultation.consultation_reason}
              </p>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setSelectedConsultation(null)}
                className="px-4 py-2 font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  const cid = selectedConsultation.id;
                  setSelectedConsultation(null);
                  navigate(`${clientBasePath}/chat/${cid}`);
                }}
                className="px-4 py-2 font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg"
              >
                Open Chat Thread
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Submit Review Modal */}
      <Modal
        isOpen={Boolean(reviewTarget)}
        onClose={() => setReviewTarget(null)}
        title="Submit Consultation Review"
        subtitle={
          reviewTarget
            ? `Care provided by ${reviewTarget.doctor_name} for ${reviewTarget.pet_name}`
            : ''
        }
        maxWidth="md"
      >
        {reviewTarget && (
          <form onSubmit={handleSubmitReview} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-2">
                Rating (1 to 5 Stars) *
              </label>
              <div className="flex items-center gap-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRating(star)}
                    className="p-1.5 rounded-lg hover:bg-amber-50 transition-colors"
                    aria-label={`Rate ${star} stars`}
                  >
                    <Star
                      className={`w-6 h-6 ${
                        star <= rating
                          ? 'fill-amber-500 text-amber-500'
                          : 'text-slate-300'
                      }`}
                    />
                  </button>
                ))}
                <span className="text-xs font-bold text-slate-700 ml-2">
                  {rating} / 5
                </span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Consultation Feedback *
              </label>
              <textarea
                required
                rows={3}
                placeholder="Share your experience with the veterinarian's guidance and clarity..."
                value={reviewText}
                onChange={(e) => setReviewText(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
              />
            </div>

            <div className="pt-2 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setReviewTarget(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={reviewBusy}
                className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg"
              >
                {reviewBusy ? 'Submitting...' : 'Submit Review'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
};
