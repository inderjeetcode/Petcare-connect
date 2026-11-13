import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useApp } from '../../context/AppContext';
import { useDoctorWorkspace } from '../../hooks/useDoctorWorkspace';
import { doctorPortalService } from '../../services/doctorPortalService';
import { onboardingService } from '../../services/onboardingService';
import { formatSupabaseError } from '../../services/authService';
import { Branch } from '../../types/auth';
import { DoctorBranchAssignment } from '../../types/doctor';
import { validateDoctorProfileUpdate } from '../../utils/doctorPortalHelpers';
import { PageHeader } from '../../components/common/PageHeader';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { Building2, Check, Loader2, Lock, MapPin, Stethoscope } from 'lucide-react';

export const DoctorProfilePage: React.FC = () => {
  const { profile, updateOwnProfile } = useAuth();
  const { showToast } = useApp();
  const { workspace, doctorLoading, reloadDoctorProfile } = useDoctorWorkspace();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [assignedBranches, setAssignedBranches] = useState<Branch[]>([]);
  const [assignments, setAssignments] = useState<DoctorBranchAssignment[]>([]);

  const [formData, setFormData] = useState({
    full_name: profile?.full_name || '',
    phone: profile?.phone || '',
    qualification: '',
    specialization: '',
    experience_years: 0,
    registration_number: '',
    bio: '',
  });

  const loadData = useCallback(async () => {
    if (!workspace) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const orgData = await doctorPortalService.getOrganizationAndBranches(
        workspace.organizationId,
        workspace.doctorProfileId
      );
      setAssignedBranches(orgData.assignedBranches);
      setAssignments(orgData.assignments.filter((a) => a.is_active));

      const doc = workspace.doctorRecord;
      setFormData({
        full_name: profile?.full_name || doc?.display_name || '',
        phone: profile?.phone || '',
        qualification: doc?.qualification || '',
        specialization: doc?.specialization || '',
        experience_years: doc?.experience_years ?? 0,
        registration_number: doc?.registration_number || '',
        bio: doc?.bio || '',
      });
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to load doctor profile details.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [workspace, profile?.full_name, profile?.phone, showToast]);

  useEffect(() => {
    if (!doctorLoading) {
      void loadData();
    }
  }, [doctorLoading, loadData]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspace) return;

    const validationError = validateDoctorProfileUpdate(formData);
    if (validationError) {
      showToast(validationError, 'error');
      return;
    }

    setSaving(true);
    try {
      await Promise.all([
        updateOwnProfile({
          full_name: formData.full_name.trim(),
          phone: formData.phone.trim(),
        }),
        onboardingService.updateDoctorSelfProfile({
          organization_id: workspace.organizationId,
          bio: formData.bio.trim(),
          qualification: formData.qualification.trim(),
          specialization: formData.specialization.trim(),
          experience_years: Number(formData.experience_years) || 0,
          registration_number: formData.registration_number.trim(),
        }),
      ]);
      await reloadDoctorProfile();
      showToast('Doctor credentials & contact profile updated.', 'success');
    } catch (err) {
      showToast(formatSupabaseError(err, 'Failed to save doctor profile.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  if (doctorLoading || loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-10 flex justify-center">
        <LoadingSpinner label="Loading clinical credentials..." />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader
        title="Doctor Professional Profile"
        subtitle={`Clinical credentials, licensing, and contact details for ${workspace?.organizationName || 'Organization'}.`}
      />

      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-6">
        {/* Governance Read-Only Summary */}
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-teal-100 text-teal-800 flex items-center justify-center">
              <Stethoscope className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-slate-900">
                {workspace?.doctorRecord?.display_name || formData.full_name}
              </div>
              <div className="text-[11px] text-slate-500">
                {workspace?.profileEmail} · {assignedBranches.length} assigned branch(es)
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="px-3 py-1 rounded-lg bg-white border border-slate-200 flex items-center gap-1.5">
              <Lock className="w-3 h-3 text-slate-400" />
              <span className="text-slate-500">Fee (Admin-governed):</span>
              <span className="font-bold text-slate-900">
                ${workspace?.doctorRecord?.consultation_fee ?? 0}
              </span>
            </div>
            <span
              className={`px-2.5 py-1 rounded-lg font-bold uppercase text-[10px] ${
                workspace?.doctorRecord?.is_active !== false
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-rose-100 text-rose-800'
              }`}
            >
              {workspace?.doctorRecord?.is_active !== false ? 'Active Practice' : 'Inactive'}
            </span>
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Full Legal & Professional Name *
              </label>
              <input
                type="text"
                required
                value={formData.full_name}
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Phone Number
              </label>
              <input
                type="tel"
                placeholder="+1 (555) 234-5678"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Clinical Specialization *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Small Animal Surgery & Internal Medicine"
                value={formData.specialization}
                onChange={(e) =>
                  setFormData({ ...formData, specialization: e.target.value })
                }
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Veterinary Registration / License #
              </label>
              <input
                type="text"
                placeholder="e.g. VET-REG-2026-881"
                value={formData.registration_number}
                onChange={(e) =>
                  setFormData({ ...formData, registration_number: e.target.value })
                }
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Qualifications & Board Certifications *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. BVSc & AH, MVSc (Surgery)"
                value={formData.qualification}
                onChange={(e) =>
                  setFormData({ ...formData, qualification: e.target.value })
                }
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Years of Veterinary Practice *
              </label>
              <input
                type="number"
                min={0}
                max={80}
                required
                value={formData.experience_years}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    experience_years: parseInt(e.target.value, 10) || 0,
                  })
                }
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Professional Bio & Clinical Philosophy
              </label>
              <textarea
                rows={3}
                value={formData.bio}
                onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
              />
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
              Save Doctor Profile
            </button>
          </div>
        </form>
      </div>

      {/* Read-Only Assigned Branches Section */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Building2 className="w-4 h-4 text-teal-700" />
              Assigned Branches within {workspace?.organizationName}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Branch assignments are controlled exclusively by Clinic Administration (`staff.manage`).
            </p>
          </div>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 text-[11px] font-semibold">
            <Lock className="w-3 h-3" /> Read-Only Governance
          </span>
        </div>

        {assignedBranches.length === 0 ? (
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 text-xs text-slate-500">
            No branch assignments currently active for your profile.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {assignedBranches.map((branch) => {
              const assignment = assignments.find((a) => a.branch_id === branch.id);
              return (
                <div
                  key={branch.id}
                  className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 text-xs space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900">{branch.name}</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-600">
                      {branch.code}
                    </span>
                  </div>
                  {branch.address && (
                    <div className="text-slate-600 flex items-start gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
                      <span>{branch.address}</span>
                    </div>
                  )}
                  <div className="text-[11px] text-slate-500 flex items-center justify-between pt-1">
                    <span>Timezone: {branch.timezone}</span>
                    <span>
                      Effective: {assignment?.effective_from || 'Active'}
                      {assignment?.effective_to ? ` → ${assignment.effective_to}` : ''}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
