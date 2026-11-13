import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useDoctorWorkspace } from '../../hooks/useDoctorWorkspace';
import { PageHeader } from '../../components/common/PageHeader';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { Bell, Building2, KeyRound, Lock, ShieldCheck } from 'lucide-react';

interface DoctorWorkspacePrefs {
  appointmentReminders: boolean;
  chatAlerts: boolean;
  expiryWarnings: boolean;
}

const DEFAULT_PREFS: DoctorWorkspacePrefs = {
  appointmentReminders: true,
  chatAlerts: true,
  expiryWarnings: true,
};

export const DoctorSettingsPage: React.FC = () => {
  const { showToast } = useApp();
  const { sendPasswordReset } = useAuth();
  const { workspace, doctorLoading } = useDoctorWorkspace();

  const [prefs, setPrefs] = useState<DoctorWorkspacePrefs>(DEFAULT_PREFS);
  const [sendingReset, setSendingReset] = useState(false);

  const storageKey = workspace
    ? `petconnect:doctor_prefs:${workspace.userId}:${workspace.organizationId}`
    : '';

  useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(saved) });
      } else {
        setPrefs(DEFAULT_PREFS);
      }
    } catch {
      setPrefs(DEFAULT_PREFS);
    }
  }, [storageKey]);

  const togglePref = (key: keyof DoctorWorkspacePrefs) => {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Ignore storage quota errors
      }
    }
    showToast('Doctor workspace preference saved.', 'info');
  };

  const handlePasswordReset = async () => {
    if (!workspace?.profileEmail) return;
    setSendingReset(true);
    try {
      await sendPasswordReset(workspace.profileEmail);
      showToast(
        `Password reset email sent to ${workspace.profileEmail}.`,
        'success'
      );
    } catch (err: any) {
      showToast(err.message || 'Unable to trigger password reset email.', 'error');
    } finally {
      setSendingReset(false);
    }
  };

  if (doctorLoading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12 flex items-center justify-center">
        <LoadingSpinner size="lg" label="Loading workspace settings..." />
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-xs text-amber-800">
        Select an active doctor clinic workspace to manage settings.
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader
        title="Doctor Workspace Settings & Governance"
        subtitle={`Workspace preferences, account security, and clinical RLS scope for ${workspace.organizationName}.`}
      />

      {/* Active Workspace & Credential Summary */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-4">
        <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
          <Building2 className="w-4 h-4 text-teal-700" />
          Verified Clinical Scope
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
            <span className="text-slate-400 block">Organization</span>
            <strong className="text-slate-900">{workspace.organizationName}</strong>
          </div>
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
            <span className="text-slate-400 block">Assigned Branches</span>
            <strong className="text-slate-900">
              {workspace.assignedBranchIds.length} active branch(es)
            </strong>
          </div>
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
            <span className="text-slate-400 block">Registration / License Number</span>
            <strong className="text-slate-900 font-mono">
              {workspace.doctorRecord?.registration_number || 'Not recorded'}
            </strong>
          </div>
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
            <span className="text-slate-400 block">Active Roles</span>
            <strong className="text-slate-900 uppercase">
              {workspace.roles.join(', ')}
            </strong>
          </div>
        </div>
      </div>

      {/* Notification Preferences */}
      <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 shadow-xs overflow-hidden">
        <div className="p-6 space-y-4">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Bell className="w-4 h-4 text-teal-700" />
            Clinical Notification Preferences
          </h2>

          <div className="space-y-3 text-xs">
            <label className="flex items-center justify-between gap-4 cursor-pointer">
              <div>
                <strong className="text-slate-800 block">
                  Confirmed Appointment Alerts
                </strong>
                <span className="text-slate-500">
                  Highlight confirmed & checked-in visits scheduled for today on your dashboard
                </span>
              </div>
              <input
                type="checkbox"
                checked={prefs.appointmentReminders}
                onChange={() => togglePref('appointmentReminders')}
                className="w-4 h-4 text-teal-700 rounded border-slate-300 focus:ring-teal-700"
              />
            </label>

            <label className="flex items-center justify-between gap-4 cursor-pointer">
              <div>
                <strong className="text-slate-800 block">
                  Participant Chat Message Notifications
                </strong>
                <span className="text-slate-500">
                  Show unread alerts for active 7-day patient consultation threads
                </span>
              </div>
              <input
                type="checkbox"
                checked={prefs.chatAlerts}
                onChange={() => togglePref('chatAlerts')}
                className="w-4 h-4 text-teal-700 rounded border-slate-300 focus:ring-teal-700"
              />
            </label>

            <label className="flex items-center justify-between gap-4 cursor-pointer">
              <div>
                <strong className="text-slate-800 block">
                  7-Day Window Expiry Reminders
                </strong>
                <span className="text-slate-500">
                  Surface countdown reminders when consultation windows approach server-enforced read-only expiry
                </span>
              </div>
              <input
                type="checkbox"
                checked={prefs.expiryWarnings}
                onChange={() => togglePref('expiryWarnings')}
                className="w-4 h-4 text-teal-700 rounded border-slate-300 focus:ring-teal-700"
              />
            </label>
          </div>
        </div>

        {/* Account Security */}
        <div className="p-6 space-y-3">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-teal-700" />
            Account Password & Authentication
          </h2>
          <p className="text-xs text-slate-600">
            Signed in globally as <strong>{workspace.profileEmail}</strong>. You can trigger a secure Supabase password reset link without interrupting other organization memberships.
          </p>
          <button
            type="button"
            disabled={sendingReset || !workspace.profileEmail}
            onClick={() => void handlePasswordReset()}
            className="px-4 py-2 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg disabled:opacity-50"
          >
            {sendingReset ? 'Sending reset link...' : 'Send Password Reset Email'}
          </button>
        </div>

        {/* RLS & Tenant Security Policy Card */}
        <div className="p-6 space-y-3 bg-slate-50/70">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-teal-700" />
            Multi-Tenant RLS & Workflow Boundaries
          </h2>
          <ul className="text-xs text-slate-600 space-y-1.5 list-disc pl-4">
            <li>
              <strong>Organization-Wide Clinical History:</strong> Medical records, addenda, vaccinations, and prescriptions within <strong>{workspace.organizationName}</strong> are shared across authorized clinical staff of this organization only.
            </li>
            <li>
              <strong>Participant-Only Chat & Immutable 7-Day Window:</strong> Consultation chat rooms and attachments are restricted strictly to the treating doctor and pet owner; expiry timestamps are controlled by PostgreSQL RPCs and cannot be extended from client browsers.
            </li>
            <li>
              <strong>Appointment Confirmation & Branch Governance:</strong> Confirming/declining requested appointments and altering branch assignments are reserved for authorized Front Desk / Clinic Admin roles.
            </li>
          </ul>
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500 pt-1">
            <Lock className="w-3.5 h-3.5 text-teal-700" />
            Cross-organization isolation is enforced at the database layer.
          </div>
        </div>
      </div>
    </div>
  );
};
