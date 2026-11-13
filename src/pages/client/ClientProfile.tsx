import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useApp } from '../../context/AppContext';
import { formatSupabaseError } from '../../services/authService';
import { validateClientProfile } from '../../utils/clientPortalHelpers';
import { PageHeader } from '../../components/common/PageHeader';
import { AlertTriangle, Check, CheckCircle2, Loader2, Lock, Shield } from 'lucide-react';

export const ClientProfile: React.FC = () => {
  const { profile, user, activeWorkspace, updateOwnProfile } = useAuth();
  const { showToast } = useApp();

  const [fullName, setFullName] = useState(profile?.full_name || '');
  const [phone, setPhone] = useState(profile?.phone || '');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || '');
      setPhone(profile.phone || '');
    }
  }, [profile]);

  const email = profile?.email || user?.email || '';
  const avatarUrl =
    profile?.avatar_url ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName || email || 'User')}&background=0f766e&color=ffffff`;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSavedSuccess(false);

    const validationError = validateClientProfile({
      full_name: fullName,
      phone,
    });
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setSaving(true);
    try {
      await updateOwnProfile({
        full_name: fullName.trim(),
        phone: phone.trim(),
      });
      setSavedSuccess(true);
      showToast('Profile details updated successfully.', 'success');
    } catch (err) {
      const msg = formatSupabaseError(err, 'Failed to update profile.');
      setFormError(msg);
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader
        title="Pet Owner Profile"
        subtitle={`Global identity & contact details used across ${activeWorkspace?.organization_name || 'your veterinary clinics'}.`}
      />

      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
        <div className="flex items-center gap-4 pb-6 border-b border-slate-100">
          <img
            src={avatarUrl}
            alt={fullName || email}
            className="w-18 h-18 rounded-2xl object-cover border-2 border-teal-700/20"
          />
          <div>
            <h2 className="text-lg font-bold text-slate-900">{fullName || email}</h2>
            <p className="text-xs text-slate-500">
              Approved Client · {activeWorkspace?.organization_name || 'Pet Connect'}
            </p>
            <div className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
              <Shield className="w-3 h-3" /> Authenticated Global Identity
            </div>
          </div>
        </div>

        <form onSubmit={handleSave} className="mt-6 space-y-4">
          {formError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          {savedSuccess && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Your profile and contact information have been saved.</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Full Name *
              </label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value);
                  setSavedSuccess(false);
                }}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1">
                Email Address
                <Lock className="w-3 h-3 text-slate-400" />
              </label>
              <input
                type="email"
                disabled
                value={email}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 bg-slate-100 text-slate-500 cursor-not-allowed"
              />
              <p className="text-[10px] text-slate-400 mt-1">
                Global identity email is immutable under database security policy.
              </p>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Primary Phone Number
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setSavedSuccess(false);
                }}
                placeholder="+1 (555) 000-0000"
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
              />
              <p className="text-[10px] text-slate-400 mt-1">
                Clinics use this contact number for urgent triage and appointment reminders.
              </p>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg transition-colors flex items-center gap-1.5 shadow-xs"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              Save Profile Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
