import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useDoctorWorkspace } from '../../hooks/useDoctorWorkspace';
import { doctorPortalService } from '../../services/doctorPortalService';
import { formatSupabaseError } from '../../services/authService';
import { Branch } from '../../types/auth';
import {
  DoctorAppointment,
  DoctorAvailableSlot,
  DoctorBranchAssignment,
  DoctorDayScheduleForm,
  DoctorScheduleException,
  DoctorSlotSummary,
} from '../../types/doctor';
import { formatTimeRangeInZone } from '../../utils/clientPortalHelpers';
import {
  buildWeeklyScheduleForm,
  ISO_WEEKDAYS,
  SCHEDULE_SLOT_DURATIONS,
  validateDayScheduleForm,
  validateScheduleExceptionInput,
} from '../../utils/doctorPortalHelpers';
import { PageHeader } from '../../components/common/PageHeader';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { EmptyState } from '../../components/common/EmptyState';
import {
  AlertTriangle,
  Building2,
  Calendar,
  CalendarOff,
  Check,
  Clock,
  Loader2,
  Lock,
  Plus,
  Trash2,
} from 'lucide-react';

export const DoctorAvailabilityPage: React.FC = () => {
  const { showToast } = useApp();
  const { workspace, doctorLoading } = useDoctorWorkspace();

  const [loading, setLoading] = useState(true);
  const [assignedBranches, setAssignedBranches] = useState<Branch[]>([]);
  const [assignments, setAssignments] = useState<DoctorBranchAssignment[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');
  const [rawSchedules, setRawSchedules] = useState<DoctorSlotSummary[]>([]);
  const [weeklyForm, setWeeklyForm] = useState<DoctorDayScheduleForm[]>([]);
  const [appointments, setAppointments] = useState<DoctorAppointment[]>([]);
  const [exceptions, setExceptions] = useState<DoctorScheduleException[]>([]);

  const [savingDay, setSavingDay] = useState<number | null>(null);
  const [savingAll, setSavingAll] = useState(false);

  // Slot Preview State
  const [previewDate, setPreviewDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [previewSlots, setPreviewSlots] = useState<DoctorAvailableSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  // Schedule Exception Form
  const [excForm, setExcForm] = useState({
    branch_id: '' as string,
    exception_type: 'leave' as DoctorScheduleException['exception_type'],
    start_local: '',
    end_local: '',
    reason: '',
  });
  const [savingException, setSavingException] = useState(false);

  const selectedBranch = useMemo(
    () => assignedBranches.find((b) => b.id === selectedBranchId) || null,
    [assignedBranches, selectedBranchId]
  );

  const loadAvailability = useCallback(async () => {
    if (!workspace || !workspace.doctorProfileId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [orgData, scheds, appts, excs] = await Promise.all([
        doctorPortalService.getOrganizationAndBranches(
          workspace.organizationId,
          workspace.doctorProfileId
        ),
        doctorPortalService.getDoctorSchedules(
          workspace.organizationId,
          workspace.doctorProfileId
        ),
        doctorPortalService.getAppointments(
          workspace.organizationId,
          workspace.doctorProfileId
        ),
        doctorPortalService.getScheduleExceptions(
          workspace.organizationId,
          workspace.doctorProfileId
        ),
      ]);

      setAssignedBranches(orgData.assignedBranches);
      setAssignments(orgData.assignments.filter((a) => a.is_active));
      setRawSchedules(scheds);
      setAppointments(appts);
      setExceptions(excs);

      const defaultBranchId =
        selectedBranchId && orgData.assignedBranches.some((b) => b.id === selectedBranchId)
          ? selectedBranchId
          : orgData.assignedBranches[0]?.id || '';
      setSelectedBranchId(defaultBranchId);
      setExcForm((prev) => ({
        ...prev,
        branch_id: prev.branch_id || defaultBranchId,
      }));
      if (defaultBranchId) {
        setWeeklyForm(buildWeeklyScheduleForm(scheds, defaultBranchId));
      }
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to load doctor availability.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [workspace, selectedBranchId, showToast]);

  useEffect(() => {
    if (!doctorLoading) {
      void loadAvailability();
    }
  }, [doctorLoading, loadAvailability]);

  useEffect(() => {
    if (selectedBranchId) {
      setWeeklyForm(buildWeeklyScheduleForm(rawSchedules, selectedBranchId));
    }
  }, [selectedBranchId, rawSchedules]);

  const loadSlotPreview = useCallback(async () => {
    if (!workspace?.doctorProfileId || !selectedBranchId || !previewDate) {
      setPreviewSlots([]);
      return;
    }
    setLoadingSlots(true);
    try {
      const slots = await doctorPortalService.getAvailableSlots({
        organization_id: workspace.organizationId,
        branch_id: selectedBranchId,
        doctor_profile_id: workspace.doctorProfileId,
        date: previewDate,
      });
      setPreviewSlots(slots);
    } catch {
      setPreviewSlots([]);
    } finally {
      setLoadingSlots(false);
    }
  }, [workspace, selectedBranchId, previewDate]);

  useEffect(() => {
    void loadSlotPreview();
  }, [loadSlotPreview]);

  const updateDay = (weekday: number, patch: Partial<DoctorDayScheduleForm>) => {
    setWeeklyForm((prev) =>
      prev.map((day) => (day.weekday === weekday ? { ...day, ...patch } : day))
    );
  };

  const saveSingleDay = async (day: DoctorDayScheduleForm) => {
    if (!workspace?.doctorProfileId || !selectedBranch) return;

    const validationError = validateDayScheduleForm(day, {
      branchId: selectedBranch.id,
      branchTimezone: selectedBranch.timezone,
      doctorProfileId: workspace.doctorProfileId,
      appointments,
    });
    if (validationError) {
      showToast(validationError, 'error');
      return;
    }

    setSavingDay(day.weekday);
    try {
      await doctorPortalService.saveDoctorDaySchedule({
        organization_id: workspace.organizationId,
        branch_id: selectedBranch.id,
        doctor_profile_id: workspace.doctorProfileId,
        weekday: day.weekday,
        is_available: day.is_available,
        start_time: day.start_time,
        end_time: day.end_time,
        break_start: day.has_break ? day.break_start : null,
        break_end: day.has_break ? day.break_end : null,
        slot_minutes: day.slot_minutes,
      });
      const updated = await doctorPortalService.getDoctorSchedules(
        workspace.organizationId,
        workspace.doctorProfileId
      );
      setRawSchedules(updated);
      await loadSlotPreview();
      const label = ISO_WEEKDAYS.find((w) => w.weekday === day.weekday)?.label || 'Day';
      showToast(`${label} availability saved for ${selectedBranch.name}.`, 'success');
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to save weekday schedule.'), 'error');
    } finally {
      setSavingDay(null);
    }
  };

  const handleSaveAllDays = async () => {
    if (!workspace?.doctorProfileId || !selectedBranch) return;
    for (const day of weeklyForm) {
      const validationError = validateDayScheduleForm(day, {
        branchId: selectedBranch.id,
        branchTimezone: selectedBranch.timezone,
        doctorProfileId: workspace.doctorProfileId,
        appointments,
      });
      if (validationError) {
        const dayLabel = ISO_WEEKDAYS.find((w) => w.weekday === day.weekday)?.label || 'Day';
        showToast(`${dayLabel}: ${validationError}`, 'error');
        return;
      }
    }

    setSavingAll(true);
    try {
      for (const day of weeklyForm) {
        await doctorPortalService.saveDoctorDaySchedule({
          organization_id: workspace.organizationId,
          branch_id: selectedBranch.id,
          doctor_profile_id: workspace.doctorProfileId,
          weekday: day.weekday,
          is_available: day.is_available,
          start_time: day.start_time,
          end_time: day.end_time,
          break_start: day.has_break ? day.break_start : null,
          break_end: day.has_break ? day.break_end : null,
          slot_minutes: day.slot_minutes,
        });
      }
      const updated = await doctorPortalService.getDoctorSchedules(
        workspace.organizationId,
        workspace.doctorProfileId
      );
      setRawSchedules(updated);
      await loadSlotPreview();
      showToast(`Weekly schedule saved for ${selectedBranch.name}.`, 'success');
    } catch (err) {
      showToast(formatSupabaseError(err, 'Unable to save weekly schedule.'), 'error');
    } finally {
      setSavingAll(false);
    }
  };

  const handleAddException = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspace?.doctorProfileId) return;

    const startIso = excForm.start_local ? new Date(excForm.start_local).toISOString() : '';
    const endIso = excForm.end_local ? new Date(excForm.end_local).toISOString() : '';

    const errMsg = validateScheduleExceptionInput(
      {
        doctorProfileId: workspace.doctorProfileId,
        branchId: excForm.branch_id || null,
        startAt: startIso,
        endAt: endIso,
        exceptionType: excForm.exception_type,
        reason: excForm.reason,
      },
      appointments
    );
    if (errMsg) {
      showToast(errMsg, 'error');
      return;
    }

    setSavingException(true);
    try {
      await doctorPortalService.addScheduleException({
        organization_id: workspace.organizationId,
        doctor_profile_id: workspace.doctorProfileId,
        branch_id: excForm.branch_id || null,
        start_at: startIso,
        end_at: endIso,
        exception_type: excForm.exception_type,
        reason: excForm.reason,
      });
      const excs = await doctorPortalService.getScheduleExceptions(
        workspace.organizationId,
        workspace.doctorProfileId
      );
      setExceptions(excs);
      await loadSlotPreview();
      setExcForm((prev) => ({
        ...prev,
        start_local: '',
        end_local: '',
        reason: '',
      }));
      showToast('Schedule exception recorded.', 'success');
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to add schedule exception.'), 'error');
    } finally {
      setSavingException(false);
    }
  };

  const handleRemoveException = async (id: string) => {
    if (!workspace?.doctorProfileId) return;
    try {
      await doctorPortalService.removeScheduleException(id);
      setExceptions((prev) => prev.filter((e) => e.id !== id));
      await loadSlotPreview();
      showToast('Schedule exception removed.', 'info');
    } catch (err) {
      showToast(formatSupabaseError(err, 'Unable to remove schedule exception.'), 'error');
    }
  };

  if (doctorLoading || loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-10 flex justify-center">
        <LoadingSpinner label="Loading branches and clinical schedule..." />
      </div>
    );
  }

  if (!workspace?.doctorProfileId || assignedBranches.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Assigned Branches & Availability"
          subtitle="Manage working days, shift hours, breaks, and blocked leave windows across assigned branches."
        />
        <EmptyState
          icon={Building2}
          title="No Assigned Clinic Branches"
          description="Branch assignments are managed by your Clinic Administrator. Once assigned to one or more branches, you can configure your working hours here."
        />
      </div>
    );
  }

  const confirmedCount = appointments.filter(
    (a) =>
      a.branch_id === selectedBranchId &&
      (a.status === 'confirmed' || a.status === 'checked_in')
  ).length;

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader
        title="Assigned Branches & Availability"
        subtitle="Configure working days, shift hours, breaks, and slot durations per assigned branch. Conflicts with confirmed appointments are blocked automatically."
        action={
          selectedBranch && (
            <button
              type="button"
              disabled={savingAll}
              onClick={() => void handleSaveAllDays()}
              className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg transition-colors flex items-center gap-1.5 shadow-xs"
            >
              {savingAll ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              Save All Weekdays
            </button>
          )
        }
      />

      {/* Read-Only Assigned Branches Selector */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Building2 className="w-4 h-4 text-teal-700" />
              Assigned Branches ({assignedBranches.length})
            </h2>
            <p className="text-xs text-slate-500">
              Select a branch to configure its weekly schedule. Branch assignment changes require Clinic Admin authorization.
            </p>
          </div>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 text-[11px] font-semibold">
            <Lock className="w-3 h-3" /> Branch Assignment Read-Only
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {assignedBranches.map((branch) => {
            const isSelected = branch.id === selectedBranchId;
            const assign = assignments.find((a) => a.branch_id === branch.id);
            const activeWindows = rawSchedules.filter((s) => s.branch_id === branch.id).length;

            return (
              <button
                key={branch.id}
                type="button"
                onClick={() => setSelectedBranchId(branch.id)}
                className={`text-left p-3.5 rounded-xl border transition-all ${
                  isSelected
                    ? 'border-teal-700 bg-teal-50/70 ring-2 ring-teal-700/15'
                    : 'border-slate-200 bg-slate-50/60 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-900 truncate">
                    {branch.name}
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600">
                    {branch.code}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 mt-1 flex items-center justify-between">
                  <span>TZ: {branch.timezone}</span>
                  <span>{activeWindows} active shift window(s)</span>
                </div>
                {assign?.effective_from && (
                  <div className="text-[10px] text-slate-400 mt-1">
                    Assigned since {assign.effective_from}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Confirmed Appointment Guard Notice */}
      {selectedBranch && confirmedCount > 0 && (
        <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <span>
            You currently have <strong>{confirmedCount}</strong> confirmed/checked-in appointment(s) at{' '}
            <strong>{selectedBranch.name}</strong>. Both client validation and database RPC constraints prevent removing hours or adding breaks/leave that overlap confirmed bookings.
          </span>
        </div>
      )}

      {/* Weekly Working Days, Shift Hours & Break Editor */}
      {selectedBranch && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
          <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Weekly Working Hours & Breaks — {selectedBranch.name}
              </h3>
              <p className="text-[11px] text-slate-500">
                Timezone: {selectedBranch.timezone}
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Day</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3">Working Hours</th>
                  <th className="py-3 px-3">Break Window</th>
                  <th className="py-3 px-3">Slot</th>
                  <th className="py-3 px-4 text-right">Save</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {weeklyForm.map((day) => {
                  const dayMeta = ISO_WEEKDAYS.find((w) => w.weekday === day.weekday);
                  const conflictErr = validateDayScheduleForm(day, {
                    branchId: selectedBranch.id,
                    branchTimezone: selectedBranch.timezone,
                    doctorProfileId: workspace.doctorProfileId!,
                    appointments,
                  });

                  return (
                    <tr
                      key={day.weekday}
                      className={day.is_available ? 'bg-white' : 'bg-slate-50/70 text-slate-500'}
                    >
                      <td className="py-3.5 px-4 font-bold text-slate-900 whitespace-nowrap">
                        <div>{dayMeta?.label}</div>
                        {conflictErr && (
                          <div className="text-[10px] font-medium text-rose-600 mt-0.5 max-w-[200px] whitespace-normal">
                            {conflictErr}
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-3">
                        <button
                          type="button"
                          onClick={() =>
                            updateDay(day.weekday, { is_available: !day.is_available })
                          }
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors ${
                            day.is_available
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                              : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                          }`}
                        >
                          {day.is_available ? 'Working' : 'Day Off'}
                        </button>
                      </td>
                      <td className="py-3.5 px-3">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="time"
                            disabled={!day.is_available}
                            value={day.start_time}
                            onChange={(e) =>
                              updateDay(day.weekday, { start_time: e.target.value })
                            }
                            className="px-2 py-1 rounded border border-slate-200 font-mono disabled:bg-slate-100 disabled:text-slate-400"
                          />
                          <span className="text-slate-400">–</span>
                          <input
                            type="time"
                            disabled={!day.is_available}
                            value={day.end_time}
                            onChange={(e) =>
                              updateDay(day.weekday, { end_time: e.target.value })
                            }
                            className="px-2 py-1 rounded border border-slate-200 font-mono disabled:bg-slate-100 disabled:text-slate-400"
                          />
                        </div>
                      </td>
                      <td className="py-3.5 px-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="inline-flex items-center gap-1 text-[11px] cursor-pointer">
                            <input
                              type="checkbox"
                              disabled={!day.is_available}
                              checked={day.has_break}
                              onChange={(e) =>
                                updateDay(day.weekday, { has_break: e.target.checked })
                              }
                              className="rounded border-slate-300 text-teal-700 focus:ring-teal-700"
                            />
                            <span>Break</span>
                          </label>
                          {day.has_break && day.is_available && (
                            <div className="flex items-center gap-1">
                              <input
                                type="time"
                                value={day.break_start}
                                onChange={(e) =>
                                  updateDay(day.weekday, { break_start: e.target.value })
                                }
                                className="px-2 py-1 rounded border border-slate-200 font-mono"
                              />
                              <span className="text-slate-400">–</span>
                              <input
                                type="time"
                                value={day.break_end}
                                onChange={(e) =>
                                  updateDay(day.weekday, { break_end: e.target.value })
                                }
                                className="px-2 py-1 rounded border border-slate-200 font-mono"
                              />
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-3">
                        <select
                          disabled={!day.is_available}
                          value={day.slot_minutes}
                          onChange={(e) =>
                            updateDay(day.weekday, {
                              slot_minutes: Number(e.target.value) || 30,
                            })
                          }
                          className="px-2 py-1 rounded border border-slate-200 bg-white disabled:bg-slate-100"
                        >
                          {SCHEDULE_SLOT_DURATIONS.map((mins) => (
                            <option key={mins} value={mins}>
                              {mins} min
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <button
                          type="button"
                          disabled={savingDay === day.weekday || Boolean(conflictErr)}
                          onClick={() => void saveSingleDay(day)}
                          className="px-3 py-1 text-xs font-semibold text-teal-700 border border-teal-200 hover:bg-teal-50 disabled:opacity-40 rounded-lg"
                        >
                          {savingDay === day.weekday ? 'Saving...' : 'Save Day'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Slot Preview & Blocked Exceptions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Live Generated Availability Slots Preview */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-teal-700" />
                Live Availability Slots Preview
              </h3>
              <p className="text-[11px] text-slate-500">
                Server-computed bookable slots excluding breaks, leave, and confirmed appointments.
              </p>
            </div>
            <input
              type="date"
              value={previewDate}
              onChange={(e) => setPreviewDate(e.target.value)}
              className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200"
            />
          </div>

          {loadingSlots ? (
            <LoadingSpinner label="Calculating slots..." />
          ) : previewSlots.length === 0 ? (
            <div className="p-6 text-center rounded-xl bg-slate-50 border border-slate-100 text-xs text-slate-500">
              No open slots generated for {previewDate} at {selectedBranch?.name}.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {previewSlots.map((slot) => (
                <span
                  key={slot.slot_start}
                  className="px-2.5 py-1.5 rounded-lg bg-teal-50 border border-teal-200 text-teal-900 text-xs font-mono font-semibold"
                >
                  {formatTimeRangeInZone(
                    slot.slot_start,
                    slot.slot_end,
                    selectedBranch?.timezone
                  )}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Schedule Exceptions (Leave / Holiday / Closure) */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <CalendarOff className="w-4 h-4 text-teal-700" />
              Leave & Blocked Schedule Exceptions
            </h3>
            <p className="text-[11px] text-slate-500">
              Block specific dates/times for leave, surgical blocks, or holidays (validated against confirmed appointments).
            </p>
          </div>

          <form onSubmit={handleAddException} className="space-y-3 text-xs bg-slate-50 p-3.5 rounded-xl border border-slate-200">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Scope</label>
                <select
                  value={excForm.branch_id}
                  onChange={(e) => setExcForm({ ...excForm, branch_id: e.target.value })}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white"
                >
                  <option value="">All Assigned Branches</option>
                  {assignedBranches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Exception Type</label>
                <select
                  value={excForm.exception_type}
                  onChange={(e) =>
                    setExcForm({
                      ...excForm,
                      exception_type: e.target.value as DoctorScheduleException['exception_type'],
                    })
                  }
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white"
                >
                  <option value="leave">Doctor Leave</option>
                  <option value="holiday">Public Holiday</option>
                  <option value="clinic_closure">Branch Closure / Surgery Block</option>
                  <option value="extra_availability">Extra Availability Note</option>
                </select>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Start Date & Time *</label>
                <input
                  type="datetime-local"
                  required
                  value={excForm.start_local}
                  onChange={(e) => setExcForm({ ...excForm, start_local: e.target.value })}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">End Date & Time *</label>
                <input
                  type="datetime-local"
                  required
                  value={excForm.end_local}
                  onChange={(e) => setExcForm({ ...excForm, end_local: e.target.value })}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white"
                />
              </div>
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Reason *</label>
              <input
                type="text"
                required
                placeholder="e.g. Continuing medical education conference"
                value={excForm.reason}
                onChange={(e) => setExcForm({ ...excForm, reason: e.target.value })}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white"
              />
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingException}
                className="px-3.5 py-1.5 font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                {savingException ? 'Saving...' : 'Add Exception'}
              </button>
            </div>
          </form>

          {exceptions.length === 0 ? (
            <div className="text-xs text-slate-500 text-center py-4">
              No blocked exceptions recorded.
            </div>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {exceptions.map((exc) => (
                <div
                  key={exc.id}
                  className="p-3 rounded-lg border border-slate-200 bg-white flex items-start justify-between gap-2 text-xs"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-bold uppercase text-[10px]">
                        {exc.exception_type.replace('_', ' ')}
                      </span>
                      <span className="font-semibold text-slate-800">{exc.branch_name}</span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(exc.start_at).toLocaleString()} →{' '}
                      {new Date(exc.end_at).toLocaleString()}
                    </div>
                    {exc.reason && (
                      <div className="text-slate-700 mt-1">{exc.reason}</div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleRemoveException(exc.id)}
                    className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg"
                    title="Remove exception"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
