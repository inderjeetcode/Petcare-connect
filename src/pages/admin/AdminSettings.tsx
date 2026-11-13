import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useAdminWorkspace } from '../../hooks/useAdminWorkspace';
import { adminPortalService } from '../../services/adminPortalService';
import { onboardingService } from '../../services/onboardingService';
import { formatSupabaseError } from '../../services/authService';
import {
  SERVICE_CATEGORIES,
  validateClinicServiceInput,
} from '../../utils/adminPortalHelpers';
import {
  Branch,
  Organization,
} from '../../types/auth';
import {
  ClinicServiceCategory,
  ClinicServiceItem,
} from '../../types/admin';
import { PageHeader } from '../../components/common/PageHeader';
import { Modal } from '../../components/common/Modal';
import {
  Building2,
  Check,
  Edit3,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Settings,
  Stethoscope,
} from 'lucide-react';

type SettingsTab = 'services' | 'organization' | 'branches';

export const AdminSettings: React.FC = () => {
  const { workspace } = useAdminWorkspace();
  const { showToast } = useApp();

  const orgId = workspace?.organizationId || '';
  const [tab, setTab] = useState<SettingsTab>('services');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [organization, setOrganization] = useState<Organization | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [services, setServices] = useState<ClinicServiceItem[]>([]);

  // Service filter & modal
  const [serviceFilterCategory, setServiceFilterCategory] = useState<string>('all');
  const [serviceModalOpen, setServiceModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<ClinicServiceItem | null>(null);
  const [serviceForm, setServiceForm] = useState<{
    name: string;
    code: string;
    category: ClinicServiceCategory;
    branch_id: string;
    description: string;
    duration_minutes: number;
    price: number;
    is_active: boolean;
  }>({
    name: '',
    code: '',
    category: 'consultation',
    branch_id: '',
    description: '',
    duration_minutes: 30,
    price: 45,
    is_active: true,
  });

  // Organization settings form
  const [orgForm, setOrgForm] = useState({
    display_name: '',
    legal_name: '',
    timezone: 'UTC',
    country: 'US',
    contact_email: '',
    phone: '',
    default_slot_minutes: 30,
    advance_booking_days: 30,
    cancellation_notice_hours: 12,
    allow_walk_in_appointments: true,
    require_triage_reason: true,
  });

  // Branch operational settings modal
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [branchOpsForm, setBranchOpsForm] = useState({
    operating_hours: '09:00 - 18:00 Mon-Sat',
    walk_in_enabled: true,
    check_in_grace_minutes: 15,
    reception_note: '',
  });

  const loadData = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [org, branchList, serviceList] = await Promise.all([
        adminPortalService.getOrganization(orgId),
        onboardingService.getOrgBranches(orgId),
        adminPortalService.getClinicServices(orgId),
      ]);
      setOrganization(org);
      setBranches(branchList);
      setServices(serviceList);

      if (org) {
        const ops = org.operational_settings || {};
        setOrgForm({
          display_name: org.display_name || '',
          legal_name: org.legal_name || '',
          timezone: org.timezone || 'UTC',
          country: org.country || 'US',
          contact_email: org.contact_email || '',
          phone: org.phone || '',
          default_slot_minutes: Number(ops.default_slot_minutes ?? 30),
          advance_booking_days: Number(ops.advance_booking_days ?? 30),
          cancellation_notice_hours: Number(ops.cancellation_notice_hours ?? 12),
          allow_walk_in_appointments: ops.allow_walk_in_appointments ?? true,
          require_triage_reason: ops.require_triage_reason ?? true,
        });
      }
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to load services and settings.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [orgId, showToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredServices = useMemo(() => {
    return services.filter((s) =>
      serviceFilterCategory === 'all' ? true : s.category === serviceFilterCategory
    );
  }, [services, serviceFilterCategory]);

  const openCreateService = () => {
    setEditingService(null);
    setServiceForm({
      name: '',
      code: '',
      category: 'consultation',
      branch_id: '',
      description: '',
      duration_minutes: 30,
      price: 45,
      is_active: true,
    });
    setServiceModalOpen(true);
  };

  const openEditService = (svc: ClinicServiceItem) => {
    setEditingService(svc);
    setServiceForm({
      name: svc.name,
      code: svc.code,
      category: svc.category,
      branch_id: svc.branch_id || '',
      description: svc.description || '',
      duration_minutes: svc.duration_minutes,
      price: svc.price,
      is_active: svc.is_active,
    });
    setServiceModalOpen(true);
  };

  const handleSaveService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId) return;
    const validationError = validateClinicServiceInput({
      name: serviceForm.name,
      code: serviceForm.code,
      duration_minutes: serviceForm.duration_minutes,
      price: serviceForm.price,
    });
    if (validationError) {
      showToast(validationError, 'warning');
      return;
    }

    setSaving(true);
    try {
      await adminPortalService.upsertClinicService({
        organization_id: orgId,
        service_id: editingService?.id ?? null,
        branch_id: serviceForm.branch_id || null,
        name: serviceForm.name,
        code: serviceForm.code,
        category: serviceForm.category,
        description: serviceForm.description.trim() || null,
        duration_minutes: serviceForm.duration_minutes,
        price: serviceForm.price,
        is_active: serviceForm.is_active,
      });
      showToast(
        editingService
          ? `Updated clinic service ${serviceForm.name}.`
          : `Added clinic service ${serviceForm.name}.`,
        'success'
      );
      setServiceModalOpen(false);
      await loadData();
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to save service.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleServiceActive = async (svc: ClinicServiceItem) => {
    if (!orgId) return;
    setSaving(true);
    try {
      await adminPortalService.upsertClinicService({
        organization_id: orgId,
        service_id: svc.id,
        branch_id: svc.branch_id,
        name: svc.name,
        code: svc.code,
        category: svc.category,
        description: svc.description,
        duration_minutes: svc.duration_minutes,
        price: svc.price,
        is_active: !svc.is_active,
      });
      showToast(
        `${svc.name} ${svc.is_active ? 'deactivated' : 'activated'}.`,
        'success'
      );
      await loadData();
    } catch (err) {
      showToast(formatSupabaseError(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveOrgSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !workspace?.canManageOrg) return;
    setSaving(true);
    try {
      await adminPortalService.updateOrganizationSettings({
        organization_id: orgId,
        display_name: orgForm.display_name,
        legal_name: orgForm.legal_name,
        timezone: orgForm.timezone,
        country: orgForm.country,
        contact_email: orgForm.contact_email.trim() || null,
        phone: orgForm.phone.trim() || null,
        operational_settings: {
          default_slot_minutes: orgForm.default_slot_minutes,
          advance_booking_days: orgForm.advance_booking_days,
          cancellation_notice_hours: orgForm.cancellation_notice_hours,
          allow_walk_in_appointments: orgForm.allow_walk_in_appointments,
          require_triage_reason: orgForm.require_triage_reason,
        },
      });
      showToast('Organization settings saved.', 'success');
      await loadData();
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to update organization settings.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const openBranchOpsModal = (branch: Branch) => {
    const s = branch.settings || {};
    setEditingBranch(branch);
    setBranchOpsForm({
      operating_hours: s.operating_hours || '09:00 - 18:00 Mon-Sat',
      walk_in_enabled: s.walk_in_enabled ?? true,
      check_in_grace_minutes: Number(s.check_in_grace_minutes ?? 15),
      reception_note: s.reception_note || '',
    });
  };

  const handleSaveBranchOps = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBranch || !orgId) return;
    setSaving(true);
    try {
      await adminPortalService.upsertBranch({
        organization_id: orgId,
        branch_id: editingBranch.id,
        name: editingBranch.name,
        code: editingBranch.code,
        timezone: editingBranch.timezone,
        address: editingBranch.address,
        city: editingBranch.city,
        state: editingBranch.state,
        country: editingBranch.country,
        phone: editingBranch.phone,
        is_active: editingBranch.is_active,
        settings: {
          operating_hours: branchOpsForm.operating_hours.trim(),
          walk_in_enabled: branchOpsForm.walk_in_enabled,
          check_in_grace_minutes: branchOpsForm.check_in_grace_minutes,
          reception_note: branchOpsForm.reception_note.trim(),
        },
      });
      showToast(`Updated operational settings for ${editingBranch.name}.`, 'success');
      setEditingBranch(null);
      await loadData();
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to update branch settings.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader
        title={`${workspace?.organizationName || 'Clinic'} — Services & Settings`}
        subtitle="Manage veterinary clinic service offerings, organization profile defaults, and branch operational policies."
        action={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadData}
              disabled={loading}
              className="px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            {tab === 'services' && (workspace?.canManageOrg || workspace?.canManageBranches) && (
              <button
                type="button"
                onClick={openCreateService}
                className="px-3.5 py-2 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Service
              </button>
            )}
          </div>
        }
      />

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-2">
        <button
          type="button"
          onClick={() => setTab('services')}
          className={`px-4 py-2 text-xs font-bold rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap ${
            tab === 'services' ? 'bg-teal-700 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Stethoscope className="w-4 h-4" />
          Clinic Services ({services.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('organization')}
          className={`px-4 py-2 text-xs font-bold rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap ${
            tab === 'organization' ? 'bg-teal-700 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Settings className="w-4 h-4" />
          Organization Settings
        </button>
        <button
          type="button"
          onClick={() => setTab('branches')}
          className={`px-4 py-2 text-xs font-bold rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap ${
            tab === 'branches' ? 'bg-teal-700 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Building2 className="w-4 h-4" />
          Branch Operational Rules ({branches.length})
        </button>
      </div>

      {loading ? (
        <div className="py-16 flex items-center justify-center gap-2 text-xs text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin text-teal-700" />
          <span>Loading configuration...</span>
        </div>
      ) : tab === 'services' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200">
            <div className="text-xs text-slate-600">
              Published services appear during appointment booking across the organization or scoped branch.
            </div>
            <select
              value={serviceFilterCategory}
              onChange={(e) => setServiceFilterCategory(e.target.value)}
              className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-700"
            >
              <option value="all">All Categories ({services.length})</option>
              {SERVICE_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                <tr>
                  <th className="py-3 px-4">Service</th>
                  <th className="py-3 px-4">Code</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Scope</th>
                  <th className="py-3 px-4">Duration</th>
                  <th className="py-3 px-4">Fee</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredServices.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-slate-500">
                      No clinic services configured yet. Add consultation, vaccination, or diagnostic services above.
                    </td>
                  </tr>
                ) : (
                  filteredServices.map((svc) => (
                    <tr key={svc.id} className="hover:bg-slate-50/50">
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900">{svc.name}</div>
                        {svc.description && (
                          <div className="text-[11px] text-slate-500 max-w-xs truncate">
                            {svc.description}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono font-semibold text-slate-700">
                        {svc.code}
                      </td>
                      <td className="py-3 px-4 capitalize text-slate-700">
                        {svc.category.replace('_', ' ')}
                      </td>
                      <td className="py-3 px-4 text-slate-600">{svc.branch_name || 'All Branches'}</td>
                      <td className="py-3 px-4 font-mono tabular-nums text-slate-700">
                        {svc.duration_minutes}m
                      </td>
                      <td className="py-3 px-4 font-mono font-bold tabular-nums text-slate-900">
                        ${svc.price.toFixed(2)}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            svc.is_active
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-slate-100 text-slate-600 border border-slate-200'
                          }`}
                        >
                          {svc.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right space-x-1.5 whitespace-nowrap">
                        {(workspace?.canManageOrg || workspace?.canManageBranches) && (
                          <>
                            <button
                              type="button"
                              onClick={() => openEditService(svc)}
                              className="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1"
                            >
                              <Edit3 className="w-3 h-3" />
                              Edit
                            </button>
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => handleToggleServiceActive(svc)}
                              className="px-2.5 py-1 text-xs font-semibold text-teal-800 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg"
                            >
                              {svc.is_active ? 'Deactivate' : 'Activate'}
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : tab === 'organization' ? (
        <form
          onSubmit={handleSaveOrgSettings}
          className="bg-white rounded-xl border border-slate-200 p-6 space-y-5 text-xs"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Organization Profile & Clinical Scheduling Policy
              </h2>
              <p className="text-slate-500 mt-0.5">
                Tenant Slug: <span className="font-mono font-semibold">{organization?.slug}</span> · Status:{' '}
                <span className="uppercase font-semibold">{organization?.status}</span>
              </p>
            </div>
            {!workspace?.canManageOrg && (
              <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 font-semibold inline-flex items-center gap-1">
                <Lock className="w-3.5 h-3.5" />
                Read-Only (Requires org.manage)
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block font-bold text-slate-700 mb-1">Display Name *</label>
              <input
                type="text"
                required
                disabled={!workspace?.canManageOrg}
                value={orgForm.display_name}
                onChange={(e) => setOrgForm({ ...orgForm, display_name: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Legal Name *</label>
              <input
                type="text"
                required
                disabled={!workspace?.canManageOrg}
                value={orgForm.legal_name}
                onChange={(e) => setOrgForm({ ...orgForm, legal_name: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Contact Email</label>
              <input
                type="email"
                disabled={!workspace?.canManageOrg}
                value={orgForm.contact_email}
                onChange={(e) => setOrgForm({ ...orgForm, contact_email: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Primary Phone</label>
              <input
                type="tel"
                disabled={!workspace?.canManageOrg}
                value={orgForm.phone}
                onChange={(e) => setOrgForm({ ...orgForm, phone: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Default Timezone *</label>
              <input
                type="text"
                required
                disabled={!workspace?.canManageOrg}
                value={orgForm.timezone}
                onChange={(e) => setOrgForm({ ...orgForm, timezone: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Country Code *</label>
              <input
                type="text"
                required
                disabled={!workspace?.canManageOrg}
                value={orgForm.country}
                onChange={(e) => setOrgForm({ ...orgForm, country: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono disabled:bg-slate-50"
              />
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Default Slot Duration (mins)
              </label>
              <input
                type="number"
                min={10}
                max={240}
                disabled={!workspace?.canManageOrg}
                value={orgForm.default_slot_minutes}
                onChange={(e) =>
                  setOrgForm({ ...orgForm, default_slot_minutes: Number(e.target.value) || 30 })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono tabular-nums disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Advance Booking Window (days)
              </label>
              <input
                type="number"
                min={1}
                max={365}
                disabled={!workspace?.canManageOrg}
                value={orgForm.advance_booking_days}
                onChange={(e) =>
                  setOrgForm({ ...orgForm, advance_booking_days: Number(e.target.value) || 30 })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono tabular-nums disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Cancellation Notice (hours)
              </label>
              <input
                type="number"
                min={0}
                max={168}
                disabled={!workspace?.canManageOrg}
                value={orgForm.cancellation_notice_hours}
                onChange={(e) =>
                  setOrgForm({
                    ...orgForm,
                    cancellation_notice_hours: Number(e.target.value) || 0,
                  })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono tabular-nums disabled:bg-slate-50"
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 pt-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                disabled={!workspace?.canManageOrg}
                checked={orgForm.allow_walk_in_appointments}
                onChange={(e) =>
                  setOrgForm({ ...orgForm, allow_walk_in_appointments: e.target.checked })
                }
              />
              <span className="font-semibold text-slate-800">
                Allow walk-in client registration & reception check-in
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                disabled={!workspace?.canManageOrg}
                checked={orgForm.require_triage_reason}
                onChange={(e) =>
                  setOrgForm({ ...orgForm, require_triage_reason: e.target.checked })
                }
              />
              <span className="font-semibold text-slate-800">
                Require clinical reason when requesting appointments
              </span>
            </label>
          </div>

          {workspace?.canManageOrg && (
            <div className="flex justify-end pt-3 border-t border-slate-100">
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-lg inline-flex items-center gap-1.5 disabled:opacity-60 whitespace-nowrap"
              >
                <Check className="w-4 h-4" />
                Save Organization Settings
              </button>
            </div>
          )}
        </form>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          {branches.map((branch) => {
            const s = branch.settings || {};
            return (
              <div
                key={branch.id}
                className="bg-white rounded-xl border border-slate-200 p-5 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-900">{branch.name}</span>
                      <span className="font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-bold text-[10px]">
                        {branch.code}
                      </span>
                    </div>
                    <div className="text-slate-500 mt-0.5">
                      {branch.timezone} · {branch.is_active ? 'Active' : 'Suspended'}
                    </div>
                  </div>
                  {workspace?.canManageBranches && (
                    <button
                      type="button"
                      onClick={() => openBranchOpsModal(branch)}
                      className="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg whitespace-nowrap shrink-0"
                    >
                      Configure Rules
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 bg-slate-50 p-3 rounded-lg border border-slate-100">
                  <div>
                    <span className="text-slate-400 block">Operating Hours</span>
                    <span className="font-semibold text-slate-800">
                      {s.operating_hours || 'Default Clinic Hours'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Walk-Ins</span>
                    <span className="font-semibold text-slate-800">
                      {s.walk_in_enabled === false ? 'Disabled' : 'Enabled'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Check-In Grace</span>
                    <span className="font-mono font-semibold text-slate-800">
                      {s.check_in_grace_minutes ?? 15} mins
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Reception Note</span>
                    <span className="text-slate-700 truncate block">
                      {s.reception_note || 'None set'}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Service Create / Edit Modal */}
      <Modal
        isOpen={serviceModalOpen}
        onClose={() => setServiceModalOpen(false)}
        title={editingService ? `Edit Service: ${editingService.name}` : 'Add Clinic Service'}
        maxWidth="lg"
      >
        <form onSubmit={handleSaveService} className="space-y-3.5 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">Service Name *</label>
              <input
                type="text"
                required
                value={serviceForm.name}
                onChange={(e) => setServiceForm({ ...serviceForm, name: e.target.value })}
                placeholder="Comprehensive Wellness Exam"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Service Code *</label>
              <input
                type="text"
                required
                value={serviceForm.code}
                onChange={(e) =>
                  setServiceForm({ ...serviceForm, code: e.target.value.toUpperCase() })
                }
                placeholder="WELLNESS_EXAM"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">Category *</label>
              <select
                value={serviceForm.category}
                onChange={(e) =>
                  setServiceForm({
                    ...serviceForm,
                    category: e.target.value as ClinicServiceCategory,
                  })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
              >
                {SERVICE_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Branch Scope</label>
              <select
                value={serviceForm.branch_id}
                onChange={(e) => setServiceForm({ ...serviceForm, branch_id: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
              >
                <option value="">All Organization Branches</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.code})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">Duration (minutes) *</label>
              <input
                type="number"
                required
                min={5}
                max={480}
                value={serviceForm.duration_minutes}
                onChange={(e) =>
                  setServiceForm({
                    ...serviceForm,
                    duration_minutes: Number(e.target.value) || 30,
                  })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Standard Fee ($ USD) *</label>
              <input
                type="number"
                required
                min={0}
                step="0.01"
                value={serviceForm.price}
                onChange={(e) =>
                  setServiceForm({ ...serviceForm, price: Number(e.target.value) || 0 })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">Clinical Description</label>
            <textarea
              rows={2}
              value={serviceForm.description}
              onChange={(e) => setServiceForm({ ...serviceForm, description: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={serviceForm.is_active}
              onChange={(e) => setServiceForm({ ...serviceForm, is_active: e.target.checked })}
            />
            <span className="font-bold text-slate-800">Active in Clinic Catalogue</span>
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setServiceModalOpen(false)}
              className="px-4 py-2 font-semibold text-slate-700 bg-slate-100 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-lg"
            >
              {editingService ? 'Update Service' : 'Create Service'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Branch Operational Settings Modal */}
      <Modal
        isOpen={Boolean(editingBranch)}
        onClose={() => setEditingBranch(null)}
        title={`Branch Rules: ${editingBranch?.name || ''}`}
        maxWidth="md"
      >
        <form onSubmit={handleSaveBranchOps} className="space-y-3.5 text-xs">
          <div>
            <label className="block font-bold text-slate-700 mb-1">Operating Hours</label>
            <input
              type="text"
              value={branchOpsForm.operating_hours}
              onChange={(e) =>
                setBranchOpsForm({ ...branchOpsForm, operating_hours: e.target.value })
              }
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block font-bold text-slate-700 mb-1">
              Check-In Grace Period (minutes)
            </label>
            <input
              type="number"
              min={0}
              max={120}
              value={branchOpsForm.check_in_grace_minutes}
              onChange={(e) =>
                setBranchOpsForm({
                  ...branchOpsForm,
                  check_in_grace_minutes: Number(e.target.value) || 0,
                })
              }
              className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
            />
          </div>
          <div>
            <label className="block font-bold text-slate-700 mb-1">Front Desk Note</label>
            <textarea
              rows={2}
              value={branchOpsForm.reception_note}
              onChange={(e) =>
                setBranchOpsForm({ ...branchOpsForm, reception_note: e.target.value })
              }
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={branchOpsForm.walk_in_enabled}
              onChange={(e) =>
                setBranchOpsForm({ ...branchOpsForm, walk_in_enabled: e.target.checked })
              }
            />
            <span className="font-bold text-slate-800">Walk-in visits enabled at this branch</span>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setEditingBranch(null)}
              className="px-4 py-2 font-semibold text-slate-700 bg-slate-100 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 font-bold text-white bg-teal-700 rounded-lg"
            >
              Save Branch Rules
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
