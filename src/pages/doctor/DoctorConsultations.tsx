import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { useDoctorWorkspace } from '../../hooks/useDoctorWorkspace';
import { doctorPortalService } from '../../services/doctorPortalService';
import { formatSupabaseError } from '../../services/authService';
import { DoctorConsultation } from '../../types/doctor';
import { getDoctorChatWindowStatus } from '../../utils/doctorPortalHelpers';
import { PageHeader } from '../../components/common/PageHeader';
import { StatusBadge } from '../../components/common/StatusBadge';
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
  Calendar,
  CheckCircle2,
  ClipboardList,
  Clock,
  FilePlus,
  FileText,
  Lock,
  MessageSquare,
  PlayCircle,
  RefreshCw,
  Search,
  XCircle,
} from 'lucide-react';

export const DoctorConsultations: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useApp();
  const { workspace, doctorBasePath, doctorLoading } = useDoctorWorkspace();

  const [loading, setLoading] = useState(true);
  const [consultations, setConsultations] = useState<DoctorConsultation[]>([]);
  const [filter, setFilter] = useState<
    'all' | 'active' | 'pending' | 'completed' | 'expired' | 'rejected'
  >('all');
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [busyId, setBusyId] = useState<string | null>(null);

  // Notes & Follow-Up Modal
  const [notesModalCons, setNotesModalCons] = useState<DoctorConsultation | null>(null);
  const [clinicalNotesInput, setClinicalNotesInput] = useState('');
  const [followUpInput, setFollowUpInput] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  // Reject Modal
  const [rejectingConsId, setRejectingConsId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState(
    'Requires in-person physical examination at clinic branch'
  );

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const loadConsultations = useCallback(async () => {
    if (!workspace) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const list = await doctorPortalService.getConsultations(
        workspace.organizationId,
        workspace.doctorProfileId
      );
      setConsultations(list);
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to load consultations.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [workspace, showToast]);

  useEffect(() => {
    if (!doctorLoading) {
      void loadConsultations();
    }
  }, [doctorLoading, loadConsultations]);

  useEffect(() => {
    setPage(1);
  }, [filter, search, branchFilter, fromDate, toDate, sortOrder, pageSize]);

  const branchOptions = useMemo(() => {
    const map = new Map<string, string>();
    consultations.forEach((c) => {
      if (c.branch_id && c.branch_name) map.set(c.branch_id, c.branch_name);
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [consultations]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = consultations.filter((c) => {
      const matchesTab = filter === 'all' || c.consultation_status === filter;
      if (!matchesTab) return false;
      if (branchFilter !== 'all' && c.branch_id !== branchFilter) return false;
      if (!isWithinDateRange(c.activated_at || c.created_at, fromDate, toDate)) return false;
      if (!q) return true;
      return (
        (c.pet_name || '').toLowerCase().includes(q) ||
        (c.client_name || '').toLowerCase().includes(q) ||
        c.consultation_reason.toLowerCase().includes(q) ||
        (c.clinical_notes || '').toLowerCase().includes(q)
      );
    });
    return sortItems(
      list,
      (a, b) => compareIsoDates(a.activated_at || a.created_at, b.activated_at || b.created_at),
      sortOrder
    );
  }, [consultations, filter, search, branchFilter, fromDate, toDate, sortOrder]);

  const paged = useMemo(
    () => paginateItems(filtered, page, pageSize),
    [filtered, page, pageSize]
  );

  const handleActivate = async (consId: string) => {
    setBusyId(consId);
    try {
      await doctorPortalService.activateConsultation(consId);
      showToast('Consultation activated and 7-day chat window started.', 'success');
      await loadConsultations();
    } catch (err) {
      showToast(formatSupabaseError(err, 'Unable to activate consultation.'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleComplete = async (consId: string) => {
    setBusyId(consId);
    try {
      await doctorPortalService.completeConsultation(consId);
      showToast('Consultation marked completed.', 'success');
      await loadConsultations();
    } catch (err) {
      showToast(formatSupabaseError(err, 'Unable to complete consultation.'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmReject = async () => {
    if (!rejectingConsId) return;
    setBusyId(rejectingConsId);
    try {
      await doctorPortalService.rejectConsultation(rejectingConsId, rejectReason);
      showToast('Pending consultation declined.', 'info');
      setRejectingConsId(null);
      await loadConsultations();
    } catch (err) {
      showToast(formatSupabaseError(err, 'Unable to decline consultation.'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const openNotesModal = (c: DoctorConsultation) => {
    setNotesModalCons(c);
    setClinicalNotesInput(c.clinical_notes || '');
    setFollowUpInput(c.follow_up_date || '');
  };

  const handleSaveNotes = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!notesModalCons) return;
    setSavingNotes(true);
    try {
      await doctorPortalService.updateConsultationClinicalSummary({
        consultation_id: notesModalCons.id,
        clinical_notes: clinicalNotesInput,
        follow_up_date: followUpInput || null,
      });
      showToast('Consultation notes & follow-up schedule saved.', 'success');
      setNotesModalCons(null);
      await loadConsultations();
    } catch (err) {
      showToast(formatSupabaseError(err, 'Unable to save consultation notes.'), 'error');
    } finally {
      setSavingNotes(false);
    }
  };

  if (doctorLoading || loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-10 flex justify-center">
        <LoadingSpinner label="Loading clinical consultations..." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clinical Consultations"
        subtitle="Manage consultation episodes, 7-day chat windows, clinical summaries, and follow-up dates."
        action={
          <button
            type="button"
            onClick={() => void loadConsultations()}
            className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        }
      />

      <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-1">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search patient, owner, or clinical notes..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
              />
            </div>
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              aria-label="Filter consultations by branch"
              className="px-3 py-2 text-xs rounded-lg border border-slate-200 bg-slate-50 text-slate-800 font-medium"
            >
              <option value="all">All Branches</option>
              {branchOptions.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
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
              {
                key: 'rejected',
                label: `Declined (${consultations.filter((c) => c.consultation_status === 'rejected').length})`,
              },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFilter(tab.key as any)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                  filter === tab.key
                    ? 'bg-teal-700 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {tab.label}
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
                aria-label="Consultation start date"
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-700/20"
              />
            </label>
            <label className="inline-flex items-center gap-1.5 text-slate-600">
              <span className="font-semibold">To:</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                aria-label="Consultation end date"
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-700/20"
              />
            </label>
            {(fromDate || toDate || branchFilter !== 'all' || search) && (
              <button
                type="button"
                onClick={() => {
                  setFromDate('');
                  setToDate('');
                  setBranchFilter('all');
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
              aria-label="Sort consultations"
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-800 font-medium"
            >
              <option value="desc">Newest First</option>
              <option value="asc">Oldest First</option>
            </select>
          </label>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No Consultations Found"
          description="Start a consultation from a confirmed appointment in the Appointments view."
        />
      ) : (
        <div className="space-y-4">
          {paged.items.map((c) => {
            const win = getDoctorChatWindowStatus(c, nowMs);
            return (
              <div
                key={c.id}
                className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={c.consultation_status} />
                    {c.branch_name && (
                      <span className="text-xs font-semibold text-teal-800 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
                        {c.branch_name}
                      </span>
                    )}
                    <span className="text-xs text-slate-500">
                      Created: {new Date(c.created_at).toLocaleDateString()}
                    </span>

                    {c.consultation_status === 'active' && (
                      <span className="text-xs font-mono font-bold text-teal-800 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded flex items-center gap-1">
                        <Clock className="w-3 h-3 text-teal-700" />
                        {win.formatted}
                      </span>
                    )}
                    {(c.consultation_status === 'expired' ||
                      (c.consultation_status === 'active' && win.isExpired)) && (
                      <span className="text-xs text-slate-600 bg-slate-100 px-2 py-0.5 rounded font-medium flex items-center gap-1">
                        <Lock className="w-3 h-3" /> Read-Only Chat Archive
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] font-mono text-slate-400">
                    Case #{c.id.slice(0, 8)}
                  </span>
                </div>

                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900">
                      {c.pet_name}
                    </h3>
                    {(c.pet_species || c.pet_breed) && (
                      <span className="text-xs text-slate-500">
                        ({[c.pet_species, c.pet_breed].filter(Boolean).join(' · ')})
                      </span>
                    )}
                    <span className="text-slate-300">·</span>
                    <span className="text-xs font-semibold text-slate-600">
                      Owner: {c.client_name}
                    </span>
                  </div>

                  <p className="text-xs text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-100">
                    <strong className="text-slate-900">Presenting Reason: </strong>
                    {c.consultation_reason}
                  </p>

                  {(c.clinical_notes || c.follow_up_date) && (
                    <div className="text-xs bg-teal-50/50 p-3 rounded-lg border border-teal-100 space-y-1">
                      {c.clinical_notes && (
                        <div>
                          <strong className="text-teal-900">Consultation Notes: </strong>
                          <span className="text-slate-800 whitespace-pre-line">
                            {c.clinical_notes}
                          </span>
                        </div>
                      )}
                      {c.follow_up_date && (
                        <div className="text-teal-800 font-semibold flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5" />
                          Follow-Up Recommended:{' '}
                          {new Date(`${c.follow_up_date}T00:00:00`).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-100">
                  {c.consultation_status === 'pending' && (
                    <>
                      <button
                        type="button"
                        disabled={busyId === c.id}
                        onClick={() => setRejectingConsId(c.id)}
                        className="px-3 py-1.5 text-xs font-semibold text-rose-700 border border-rose-200 hover:bg-rose-50 rounded-lg flex items-center gap-1"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        Decline Case
                      </button>
                      <button
                        type="button"
                        disabled={busyId === c.id}
                        onClick={() => void handleActivate(c.id)}
                        className="px-3.5 py-1.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg flex items-center gap-1"
                      >
                        <PlayCircle className="w-3.5 h-3.5" />
                        Activate 7-Day Window
                      </button>
                    </>
                  )}

                  {(c.consultation_status === 'active' ||
                    c.consultation_status === 'completed' ||
                    c.consultation_status === 'expired') && (
                    <>
                      <button
                        type="button"
                        onClick={() => openNotesModal(c)}
                        className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg flex items-center gap-1"
                      >
                        <FileText className="w-3.5 h-3.5 text-teal-700" />
                        Notes & Follow-Up
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          navigate(`${doctorBasePath}/prescriptions`, {
                            state: { petId: c.pet_id, consultationId: c.id },
                          })
                        }
                        className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg flex items-center gap-1"
                      >
                        <FilePlus className="w-3.5 h-3.5 text-teal-700" />
                        Issue Rx
                      </button>
                    </>
                  )}

                  {c.consultation_status === 'active' && (
                    <button
                      type="button"
                      disabled={busyId === c.id}
                      onClick={() => void handleComplete(c.id)}
                      className="px-3 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg flex items-center gap-1"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Complete Case
                    </button>
                  )}

                  {c.conversation_id && (
                    <button
                      type="button"
                      onClick={() => navigate(`${doctorBasePath}/chat/${c.id}`)}
                      className="px-3.5 py-1.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg flex items-center gap-1.5"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      {win.canSendMessages ? 'Live Chat' : 'View History'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
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
              itemLabel="consultations"
            />
          </div>
        </div>
      )}

      {/* Notes & Follow-Up Modal */}
      <Modal
        isOpen={Boolean(notesModalCons)}
        onClose={() => setNotesModalCons(null)}
        title={`Consultation Clinical Summary — ${notesModalCons?.pet_name || ''}`}
        subtitle="Record consultation findings and follow-up date without altering 7-day chat expiry boundaries."
      >
        <form onSubmit={handleSaveNotes} className="space-y-4 text-xs">
          <div>
            <label className="block font-bold text-slate-700 mb-1">
              Consultation Clinical Notes
            </label>
            <textarea
              rows={5}
              placeholder="Assessment, differential diagnosis, owner guidance, red flags discussed..."
              value={clinicalNotesInput}
              onChange={(e) => setClinicalNotesInput(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
            />
          </div>
          <div>
            <label className="block font-bold text-slate-700 mb-1">
              Recommended Follow-Up Date
            </label>
            <input
              type="date"
              value={followUpInput}
              onChange={(e) => setFollowUpInput(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
            />
          </div>
          <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setNotesModalCons(null)}
              className="px-4 py-2 font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingNotes}
              className="px-4 py-2 font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg"
            >
              {savingNotes ? 'Saving...' : 'Save Summary'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Reject Consultation Modal */}
      <Modal
        isOpen={Boolean(rejectingConsId)}
        onClose={() => setRejectingConsId(null)}
        title="Decline Pending Consultation"
        subtitle="Provide a clinical rationale for declining this pending consultation case."
      >
        <div className="space-y-4 text-xs">
          <div>
            <label className="block font-bold text-slate-700 mb-1">Reason</label>
            <textarea
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
            />
          </div>
          <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setRejectingConsId(null)}
              className="px-4 py-2 font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!rejectReason.trim() || Boolean(busyId)}
              onClick={() => void handleConfirmReject()}
              className="px-4 py-2 font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 rounded-lg"
            >
              Confirm Decline
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
