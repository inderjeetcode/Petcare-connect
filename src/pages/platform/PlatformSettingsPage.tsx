import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { platformPortalService } from '../../services/platformPortalService';
import { formatSupabaseError } from '../../services/authService';
import { PlatformSettings } from '../../types/platform';
import { validatePlatformSettingsInput } from '../../utils/platformPortalHelpers';
import { PageHeader } from '../../components/common/PageHeader';
import { PlatformPrivacyBanner } from '../../components/platform/PlatformPrivacyBanner';
import { Check, Loader2, RefreshCw, Settings, ShieldAlert } from 'lucide-react';

export const PlatformSettingsPage: React.FC = () => {
  const { showToast } = useApp();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<PlatformSettings | null>(null);

  const [form, setForm] = useState({
    platform_name: 'Pet Connect',
    require_manual_org_approval: true,
    allow_self_service_org_applications: true,
    default_consultation_window_days: 7,
    max_support_access_minutes: 60,
    maintenance_mode: false,
    security_notice: '',
    allowed_countries_text: 'IN, US, GB, CA, AU',
  });

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const s = await platformPortalService.getSettings();
      setSettings(s);
      setForm({
        platform_name: s.platform_name || 'Pet Connect',
        require_manual_org_approval: Boolean(s.require_manual_org_approval),
        allow_self_service_org_applications: Boolean(
          s.allow_self_service_org_applications
        ),
        default_consultation_window_days: Number(
          s.default_consultation_window_days || 7
        ),
        max_support_access_minutes: Number(s.max_support_access_minutes || 60),
        maintenance_mode: Boolean(s.maintenance_mode),
        security_notice: s.security_notice || '',
        allowed_countries_text: (s.allowed_countries || []).join(', '),
      });
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to load platform settings.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationErr = validatePlatformSettingsInput({
      platform_name: form.platform_name,
      default_consultation_window_days: form.default_consultation_window_days,
      max_support_access_minutes: form.max_support_access_minutes,
    });
    if (validationErr) {
      showToast(validationErr, 'warning');
      return;
    }

    const allowedCountries = form.allowed_countries_text
      .split(',')
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);

    setSaving(true);
    try {
      const updated = await platformPortalService.updateSettings({
        platform_name: form.platform_name.trim(),
        require_manual_org_approval: form.require_manual_org_approval,
        allow_self_service_org_applications: form.allow_self_service_org_applications,
        default_consultation_window_days: form.default_consultation_window_days,
        max_support_access_minutes: form.max_support_access_minutes,
        maintenance_mode: form.maintenance_mode,
        security_notice: form.security_notice.trim() || null,
        allowed_countries: allowedCountries.length > 0 ? allowedCountries : ['IN', 'US'],
      });
      setSettings(updated);
      showToast('Platform settings saved and recorded in audit log.', 'success');
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to save platform settings.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <PageHeader
        title="Platform Governance Settings"
        subtitle="Configure global SaaS onboarding policies, time-limited support access caps, consultation window defaults, and security notices."
        action={
          <button
            type="button"
            onClick={loadSettings}
            disabled={loading}
            className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-xl inline-flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        }
      />

      <PlatformPrivacyBanner compact />

      {loading ? (
        <div className="py-12 flex items-center justify-center gap-2 text-xs text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin text-teal-700" />
          <span>Loading platform settings...</span>
        </div>
      ) : (
        <form
          onSubmit={handleSave}
          className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5 text-xs shadow-xs"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-teal-700" />
              <h2 className="text-sm font-bold text-slate-900">
                Global Governance Configuration
              </h2>
            </div>
            {settings?.updated_at && (
              <span className="text-[11px] text-slate-500">
                Last updated: {new Date(settings.updated_at).toLocaleString()}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Platform Display Name *
              </label>
              <input
                type="text"
                required
                value={form.platform_name}
                onChange={(e) => setForm({ ...form, platform_name: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Allowed Country Codes (comma-separated)
              </label>
              <input
                type="text"
                value={form.allowed_countries_text}
                onChange={(e) =>
                  setForm({ ...form, allowed_countries_text: e.target.value })
                }
                placeholder="IN, US, GB, CA, AU"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Default Consultation Chat Window (days, 1–30) *
              </label>
              <input
                type="number"
                required
                min={1}
                max={30}
                value={form.default_consultation_window_days}
                onChange={(e) =>
                  setForm({
                    ...form,
                    default_consultation_window_days: Number(e.target.value) || 7,
                  })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono tabular-nums"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Max Scoped Support Access Window (minutes, 15–480) *
              </label>
              <input
                type="number"
                required
                min={15}
                max={480}
                value={form.max_support_access_minutes}
                onChange={(e) =>
                  setForm({
                    ...form,
                    max_support_access_minutes: Number(e.target.value) || 60,
                  })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono tabular-nums"
              />
            </div>
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">
              Platform Security Notice
            </label>
            <textarea
              rows={3}
              value={form.security_notice}
              onChange={(e) => setForm({ ...form, security_notice: e.target.value })}
              placeholder="Optional governance banner or compliance notice..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            />
          </div>

          <div className="space-y-3 pt-2 border-t border-slate-100">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={form.require_manual_org_approval}
                onChange={(e) =>
                  setForm({ ...form, require_manual_org_approval: e.target.checked })
                }
                className="mt-0.5"
              />
              <div>
                <div className="font-bold text-slate-900">
                  Require Manual Platform Owner Organization Approval
                </div>
                <div className="text-[11px] text-slate-500">
                  New veterinary clinic registrations remain pending until explicitly reviewed and approved.
                </div>
              </div>
            </label>

            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={form.allow_self_service_org_applications}
                onChange={(e) =>
                  setForm({
                    ...form,
                    allow_self_service_org_applications: e.target.checked,
                  })
                }
                className="mt-0.5"
              />
              <div>
                <div className="font-bold text-slate-900">
                  Allow Clinic Registration Applications
                </div>
                <div className="text-[11px] text-slate-500">
                  Enables authenticated users to submit new veterinary organization applications from My Workspaces.
                </div>
              </div>
            </label>

            <label className="flex items-start gap-2.5 cursor-pointer p-3 rounded-xl bg-amber-50 border border-amber-200">
              <input
                type="checkbox"
                checked={form.maintenance_mode}
                onChange={(e) =>
                  setForm({ ...form, maintenance_mode: e.target.checked })
                }
                className="mt-0.5"
              />
              <div>
                <div className="font-bold text-amber-950 flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-700" />
                  Platform Maintenance Flag
                </div>
                <div className="text-[11px] text-amber-900">
                  Marks platform status as undergoing scheduled maintenance in governance telemetry.
                </div>
              </div>
            </label>
          </div>

          <div className="flex justify-end pt-3 border-t border-slate-100">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-xl inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              Save Platform Settings
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
