import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useClientWorkspace } from '../../hooks/useClientWorkspace';
import { PageHeader } from '../../components/common/PageHeader';
import {
  Bell,
  Lock,
  Building2,
  KeyRound,
  ChevronRight,
  CheckCircle2,
} from 'lucide-react';

interface ClientAlertPrefs {
  chatExpiryAlerts: boolean;
  appointmentUpdates: boolean;
  prescriptionAlerts: boolean;
  vaccineReminders: boolean;
}

const DEFAULT_PREFS: ClientAlertPrefs = {
  chatExpiryAlerts: true,
  appointmentUpdates: true,
  prescriptionAlerts: true,
  vaccineReminders: true,
};

export const ClientSettings: React.FC = () => {
  const { showToast } = useApp();
  const { user, sendPasswordReset } = useAuth();
  const { workspace, clientBasePath } = useClientWorkspace();
  const navigate = useNavigate();

  const storageKey = workspace
    ? `pet_connect_client_prefs_${workspace.userId}_${workspace.organizationId}`
    : 'pet_connect_client_prefs';
  const [prefs, setPrefs] = useState<ClientAlertPrefs>(DEFAULT_PREFS);
  const [resetSent, setResetSent] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);

  useEffect(() => {
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

  const handleToggle = (key: keyof ClientAlertPrefs) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // ignore storage quota errors
      }
      return next;
    });
    showToast('Workspace preference saved.', 'info');
  };

  const handlePasswordReset = async () => {
    if (!user?.email) {
      showToast('No email address associated with this session.', 'error');
      return;
    }
    setResetBusy(true);
    try {
      await sendPasswordReset(user.email);
      setResetSent(true);
      showToast(`Password reset instructions sent to ${user.email}.`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Unable to send password reset email.', 'error');
    } finally {
      setResetBusy(false);
    }
  };

  if (!workspace) return null;

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader
        title="Settings & Privacy"
        subtitle={`Manage client portal preferences and account security for ${workspace.organizationName}.`}
      />

      {/* Active Clinic Workspace Card */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-50 border border-teal-200 text-teal-800 flex items-center justify-center shrink-0">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              Active Veterinary Organization
            </div>
            <div className="text-sm font-bold text-slate-900 mt-0.5">
              {workspace.organizationName}
            </div>
            <div className="text-xs text-slate-500">
              Your pets, appointments, medical records, and prescriptions remain strictly isolated to this clinic.
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate(`${clientBasePath}/organizations`)}
          className="px-3.5 py-2 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg flex items-center gap-1 shrink-0"
        >
          Manage Clinics <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 shadow-xs overflow-hidden">
        {/* Section 1: In-Portal Notification Preferences */}
        <div className="p-6 space-y-4">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Bell className="w-4 h-4 text-teal-700" />
            Portal Notification Preferences
          </h2>

          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <div>
                <strong className="text-slate-800 block">7-Day Chat Window Alerts</strong>
                <span className="text-slate-500">
                  Highlight upcoming chat expiration reminders in your portal feed
                </span>
              </div>
              <input
                type="checkbox"
                checked={prefs.chatExpiryAlerts}
                onChange={() => handleToggle('chatExpiryAlerts')}
                className="w-4 h-4 text-teal-700 rounded border-slate-300 focus:ring-teal-700"
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <strong className="text-slate-800 block">Appointment Status Alerts</strong>
                <span className="text-slate-500">
                  Show notifications when clinic staff confirm or update your appointment requests
                </span>
              </div>
              <input
                type="checkbox"
                checked={prefs.appointmentUpdates}
                onChange={() => handleToggle('appointmentUpdates')}
                className="w-4 h-4 text-teal-700 rounded border-slate-300 focus:ring-teal-700"
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <strong className="text-slate-800 block">Prescription Issuance Alerts</strong>
                <span className="text-slate-500">
                  Notify when a treating veterinarian issues or updates a prescription
                </span>
              </div>
              <input
                type="checkbox"
                checked={prefs.prescriptionAlerts}
                onChange={() => handleToggle('prescriptionAlerts')}
                className="w-4 h-4 text-teal-700 rounded border-slate-300 focus:ring-teal-700"
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <strong className="text-slate-800 block">Vaccination Due Reminders</strong>
                <span className="text-slate-500">
                  Surface upcoming booster due dates on your dashboard
                </span>
              </div>
              <input
                type="checkbox"
                checked={prefs.vaccineReminders}
                onChange={() => handleToggle('vaccineReminders')}
                className="w-4 h-4 text-teal-700 rounded border-slate-300 focus:ring-teal-700"
              />
            </div>
          </div>
        </div>

        {/* Section 2: Security & RLS */}
        <div className="p-6 space-y-4">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Lock className="w-4 h-4 text-teal-700" />
            Account Security & Tenant Privacy
          </h2>

          <div className="space-y-3 text-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 bg-slate-50 rounded-lg border border-slate-200/70">
              <div>
                <strong className="text-slate-800 block">Password & Authentication</strong>
                <span className="text-slate-500">
                  Signed in globally as {user?.email || 'Authenticated User'}
                </span>
              </div>
              {resetSent ? (
                <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                  <CheckCircle2 className="w-4 h-4" />
                  Reset email dispatched
                </span>
              ) : (
                <button
                  type="button"
                  disabled={resetBusy}
                  onClick={() => void handlePasswordReset()}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 flex items-center gap-1.5 shrink-0 disabled:opacity-50"
                >
                  <KeyRound className="w-3.5 h-3.5 text-teal-700" />
                  {resetBusy ? 'Sending...' : 'Send Password Reset Email'}
                </button>
              )}
            </div>

            <div className="p-3.5 bg-teal-50/70 rounded-lg border border-teal-200 text-teal-900">
              <strong className="block mb-0.5">
                Multi-Tenant PostgreSQL Row-Level Security (RLS)
              </strong>
              Your pet records, clinical attachments, prescriptions, and consultation chats are isolated by organization and verified participant identity at the database layer.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
