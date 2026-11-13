import { isSupabaseConfigured, supabase } from '../config/supabaseClient';
import {
  Branch,
  BranchOperationalSettings,
  ClinicClientRecord,
  DoctorGovernanceRecord,
  Organization,
  OrganizationMemberView,
  OrganizationOperationalSettings,
  StaffInvitationRecord,
} from '../types/auth';
import {
  AdminAuditLogItem,
  AdminClinicalAuditOverview,
  AdminDoctorAvailabilityView,
  AdminOperationalOverview,
  AdminPaymentLedgerItem,
  AdminPetDirectoryItem,
  AdminPetGuardianLink,
  ClinicServiceCategory,
  ClinicServiceItem,
} from '../types/admin';
import { PlatformSupportGrant } from '../types/platform';
import {
  ClientMedicalRecord,
  ClientPet,
  ClientPrescription,
} from '../types/client';
import {
  DoctorAppointment,
  DoctorAvailableSlot,
  DoctorConsultation,
  DoctorNotification,
  DoctorScheduleException,
  DoctorSlotSummary,
} from '../types/doctor';
import { onboardingService } from './onboardingService';
import { parsePgTstzRange } from '../utils/doctorPortalHelpers';

function getClient() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error(
      'Supabase client is not configured. Please provide VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
    );
  }
  return supabase;
}

export const adminPortalService = {
  // ---------------------------------------------------------------------------
  // ORGANIZATION & OPERATIONAL OVERVIEW
  // ---------------------------------------------------------------------------

  async getOrganization(organizationId: string): Promise<Organization | null> {
    const client = getClient();
    const { data, error } = await client
      .from('organizations')
      .select('*')
      .eq('id', organizationId)
      .maybeSingle();
    if (error) throw error;
    return (data as Organization) || null;
  },

  async updateOrganizationSettings(params: {
    organization_id: string;
    display_name: string;
    legal_name: string;
    timezone: string;
    country: string;
    contact_email?: string | null;
    phone?: string | null;
    operational_settings?: OrganizationOperationalSettings;
  }): Promise<Organization> {
    const client = getClient();
    const { data, error } = await client.rpc('update_organization_settings', {
      p_organization_id: params.organization_id,
      p_display_name: params.display_name.trim(),
      p_legal_name: params.legal_name.trim(),
      p_timezone: params.timezone.trim(),
      p_country: params.country.trim(),
      p_contact_email: params.contact_email ?? null,
      p_phone: params.phone ?? null,
      p_operational_settings: params.operational_settings ?? null,
    });
    if (error) throw error;
    return data as Organization;
  },

  async upsertBranch(params: {
    organization_id: string;
    branch_id?: string | null;
    name: string;
    code: string;
    timezone: string;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    phone?: string | null;
    is_active?: boolean;
    settings?: BranchOperationalSettings | null;
  }): Promise<string> {
    const client = getClient();
    const { data, error } = await client.rpc('admin_upsert_branch', {
      p_organization_id: params.organization_id,
      p_branch_id: params.branch_id ?? null,
      p_name: params.name.trim(),
      p_code: params.code.trim().toUpperCase(),
      p_timezone: params.timezone.trim() || 'UTC',
      p_address: params.address ?? null,
      p_city: params.city ?? null,
      p_state: params.state ?? null,
      p_country: params.country ?? null,
      p_phone: params.phone ?? null,
      p_is_active: params.is_active ?? true,
      p_settings: params.settings ?? null,
    });
    if (error) throw error;
    return String(data);
  },

  // ---------------------------------------------------------------------------
  // CLINIC SERVICES CATALOGUE
  // ---------------------------------------------------------------------------

  async getClinicServices(organizationId: string): Promise<ClinicServiceItem[]> {
    const client = getClient();
    const [svcRes, branchRes] = await Promise.all([
      client
        .from('clinic_services')
        .select('*')
        .eq('organization_id', organizationId)
        .order('category', { ascending: true })
        .order('name', { ascending: true }),
      client
        .from('branches')
        .select('id, name')
        .eq('organization_id', organizationId),
    ]);

    if (svcRes.error) {
      // Graceful fallback if Phase 6 table migration has not been applied yet on target DB
      if (svcRes.error.code === '42P01') return [];
      throw svcRes.error;
    }

    const branchMap = new Map<string, string>(
      ((branchRes.data || []) as any[]).map((b) => [b.id, b.name])
    );

    return ((svcRes.data || []) as any[]).map((row) => ({
      id: row.id,
      organization_id: row.organization_id,
      branch_id: row.branch_id || null,
      branch_name: row.branch_id ? branchMap.get(row.branch_id) || 'Branch' : 'All Branches',
      name: row.name,
      code: row.code,
      category: row.category as ClinicServiceCategory,
      description: row.description || null,
      duration_minutes: Number(row.duration_minutes || 30),
      price: Number(row.price || 0),
      is_active: Boolean(row.is_active),
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  },

  async upsertClinicService(params: {
    organization_id: string;
    service_id?: string | null;
    branch_id?: string | null;
    name: string;
    code: string;
    category: ClinicServiceCategory;
    description?: string | null;
    duration_minutes: number;
    price: number;
    is_active: boolean;
  }): Promise<ClinicServiceItem> {
    const client = getClient();
    const { data, error } = await client.rpc('upsert_clinic_service', {
      p_organization_id: params.organization_id,
      p_service_id: params.service_id ?? null,
      p_branch_id: params.branch_id || null,
      p_name: params.name.trim(),
      p_code: params.code.trim().toUpperCase(),
      p_category: params.category,
      p_description: params.description ?? null,
      p_duration_minutes: params.duration_minutes,
      p_price: params.price,
      p_is_active: params.is_active,
    });
    if (error) throw error;
    return data as ClinicServiceItem;
  },

  // ---------------------------------------------------------------------------
  // STAFF, DOCTOR GOVERNANCE & CLIENT LIFECYCLE
  // ---------------------------------------------------------------------------

  async reactivateMember(membershipId: string): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('reactivate_member', {
      p_membership_id: membershipId,
    });
    if (error) throw error;
  },

  async revokeInvitation(invitationId: string): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('revoke_staff_invitation', {
      p_invitation_id: invitationId,
    });
    if (error) throw error;
  },

  async suspendClinicClient(clinicClientId: string, reason: string): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('suspend_clinic_client', {
      p_clinic_client_id: clinicClientId,
      p_reason: reason.trim(),
    });
    if (error) throw error;
  },

  async reactivateClinicClient(clinicClientId: string): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('reactivate_clinic_client', {
      p_clinic_client_id: clinicClientId,
    });
    if (error) throw error;
  },

  async updateDoctorProfileAndGovernance(params: {
    doctor_profile_id: string;
    display_name?: string | null;
    qualification?: string | null;
    specialization?: string | null;
    experience_years?: number | null;
    registration_number?: string | null;
    bio?: string | null;
    consultation_fee?: number | null;
    is_active?: boolean | null;
  }): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('admin_update_doctor_profile_and_governance', {
      p_doctor_profile_id: params.doctor_profile_id,
      p_display_name: params.display_name ?? null,
      p_qualification: params.qualification ?? null,
      p_specialization: params.specialization ?? null,
      p_experience_years: params.experience_years ?? null,
      p_registration_number: params.registration_number ?? null,
      p_bio: params.bio ?? null,
      p_consultation_fee: params.consultation_fee ?? null,
      p_is_active: params.is_active ?? null,
    });
    if (error) throw error;
  },

  async getDoctorAvailability(
    organizationId: string,
    doctorProfileId: string
  ): Promise<AdminDoctorAvailabilityView> {
    const client = getClient();
    const [schedRes, excRes] = await Promise.all([
      client
        .from('doctor_schedules')
        .select('id, branch_id, weekday, start_time, end_time, slot_minutes, is_active')
        .eq('organization_id', organizationId)
        .eq('doctor_profile_id', doctorProfileId)
        .eq('is_active', true)
        .order('weekday', { ascending: true })
        .order('start_time', { ascending: true }),
      client
        .from('doctor_schedule_exceptions')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('doctor_profile_id', doctorProfileId)
        .order('start_at', { ascending: true }),
    ]);

    if (schedRes.error) throw schedRes.error;
    if (excRes.error) throw excRes.error;

    return {
      schedules: (schedRes.data || []) as DoctorSlotSummary[],
      exceptions: (excRes.data || []) as DoctorScheduleException[],
    };
  },

  // ---------------------------------------------------------------------------
  // APPOINTMENTS, CONSULTATIONS, PETS & AUDIT DATA (STRICT ORG SCOPE, NO CHAT)
  // ---------------------------------------------------------------------------

  async getAppointments(
    organizationId: string,
    branchFilterIds?: string[]
  ): Promise<DoctorAppointment[]> {
    const client = getClient();
    let query = client
      .from('appointments')
      .select('*')
      .eq('organization_id', organizationId)
      .order('requested_start', { ascending: false })
      .limit(500);

    if (branchFilterIds && branchFilterIds.length > 0) {
      query = query.in('branch_id', branchFilterIds);
    }

    const [apptRes, branches, doctors, clients, petsRes, consRes, svcRes] = await Promise.all([
      query,
      onboardingService.getOrgBranches(organizationId),
      onboardingService.getOrgDoctors(organizationId),
      onboardingService.getOrgClinicClients(organizationId),
      client
        .from('pets')
        .select('id, name, species, breed')
        .eq('organization_id', organizationId),
      client
        .from('consultations')
        .select('id, appointment_id, consultation_status')
        .eq('organization_id', organizationId)
        .not('appointment_id', 'is', null),
      client
        .from('clinic_services')
        .select('id, name, duration_minutes')
        .eq('organization_id', organizationId),
    ]);

    if (apptRes.error) throw apptRes.error;
    if (petsRes.error) throw petsRes.error;
    if (consRes.error) throw consRes.error;
    if (svcRes.error && svcRes.error.code !== '42P01') throw svcRes.error;

    const branchMap = new Map(branches.map((b) => [b.id, b]));
    const docMap = new Map(doctors.map((d) => [d.id, d]));
    const clientMap = new Map(clients.map((c) => [c.id, c]));
    const petMap = new Map(((petsRes.data || []) as any[]).map((p) => [p.id, p]));
    const svcMap = new Map(((svcRes.data || []) as any[]).map((s) => [s.id, s]));
    const consByAppt = new Map<string, { id: string; consultation_status: string }>();
    for (const c of (consRes.data || []) as any[]) {
      if (c.appointment_id && c.consultation_status !== 'rejected') {
        consByAppt.set(c.appointment_id, c);
      }
    }

    return ((apptRes.data || []) as any[]).map((row) => {
      const parsed = parsePgTstzRange(row.scheduled_range);
      const branch = branchMap.get(row.branch_id);
      const doc = docMap.get(row.doctor_profile_id);
      const cc = clientMap.get(row.clinic_client_id);
      const pet = petMap.get(row.pet_id);
      const svc = row.service_id ? svcMap.get(row.service_id) : undefined;
      const linkedCons = consByAppt.get(row.id);

      return {
        id: row.id,
        organization_id: row.organization_id,
        branch_id: row.branch_id,
        clinic_client_id: row.clinic_client_id,
        pet_id: row.pet_id,
        doctor_profile_id: row.doctor_profile_id,
        service_id: row.service_id || null,
        service_name: svc?.name || null,
        service_duration_minutes: svc?.duration_minutes ? Number(svc.duration_minutes) : null,
        requested_start: row.requested_start,
        requested_end: row.requested_end,
        scheduled_range: row.scheduled_range || null,
        scheduled_start: parsed.start,
        scheduled_end: parsed.end,
        status: row.status,
        reason: row.reason,
        decline_reason: row.decline_reason || null,
        cancellation_reason: row.cancellation_reason || null,
        confirmed_by: row.confirmed_by || null,
        confirmed_at: row.confirmed_at || null,
        checked_in_at: row.checked_in_at || null,
        completed_at: row.completed_at || null,
        created_at: row.created_at,
        updated_at: row.updated_at,
        branch_name: branch?.name || 'Clinic Branch',
        branch_timezone: branch?.timezone || 'UTC',
        pet_name: pet?.name || 'Pet Patient',
        pet_species: pet?.species || '',
        pet_breed: pet?.breed || '',
        client_name: cc?.full_name || 'Registered Client',
        client_email: cc?.email || null,
        client_phone: cc?.phone || null,
        doctor_name: doc?.full_name || 'Veterinary Doctor',
        doctor_specialization: doc?.specialization || '',
        consultation_id: linkedCons?.id || null,
        consultation_status: linkedCons?.consultation_status || null,
      } as DoctorAppointment;
    });
  },

  async getConsultations(organizationId: string): Promise<DoctorConsultation[]> {
    const client = getClient();
    const [consRes, branches, doctors, clients, petsRes] = await Promise.all([
      client
        .from('consultations')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(500),
      onboardingService.getOrgBranches(organizationId),
      onboardingService.getOrgDoctors(organizationId),
      onboardingService.getOrgClinicClients(organizationId),
      client
        .from('pets')
        .select('id, name, species, breed')
        .eq('organization_id', organizationId),
    ]);

    if (consRes.error) throw consRes.error;
    if (petsRes.error) throw petsRes.error;

    const branchMap = new Map(branches.map((b) => [b.id, b]));
    const docMap = new Map(doctors.map((d) => [d.id, d]));
    const clientById = new Map(clients.map((c) => [c.id, c]));
    const clientByUser = new Map(
      clients.filter((c) => Boolean(c.user_id)).map((c) => [c.user_id as string, c])
    );
    const petMap = new Map(((petsRes.data || []) as any[]).map((p) => [p.id, p]));

    // Explicitly do NOT query chat_conversations or chat_messages (privacy rule D-16)
    return ((consRes.data || []) as any[]).map((row) => {
      const branch = row.branch_id ? branchMap.get(row.branch_id) : undefined;
      const doc = docMap.get(row.doctor_id);
      const cc =
        (row.clinic_client_id ? clientById.get(row.clinic_client_id) : undefined) ||
        (row.client_id ? clientByUser.get(row.client_id) : undefined);
      const pet = petMap.get(row.pet_id);

      return {
        id: row.id,
        organization_id: row.organization_id,
        branch_id: row.branch_id || null,
        clinic_client_id: row.clinic_client_id || null,
        appointment_id: row.appointment_id || null,
        client_id: row.client_id,
        doctor_id: row.doctor_id,
        pet_id: row.pet_id,
        consultation_reason: row.consultation_reason,
        consultation_status: row.consultation_status,
        clinical_notes: row.clinical_notes || null,
        follow_up_date: row.follow_up_date || null,
        activated_at: row.activated_at || null,
        expires_at: row.expires_at || null,
        completed_at: row.completed_at || null,
        rejection_reason: row.rejection_reason || null,
        created_at: row.created_at,
        updated_at: row.updated_at,
        pet_name: pet?.name || 'Pet Patient',
        pet_species: pet?.species || '',
        pet_breed: pet?.breed || '',
        client_name: cc?.full_name || 'Registered Client',
        client_email: cc?.email || null,
        client_phone: cc?.phone || null,
        doctor_name: doc?.full_name || 'Veterinary Doctor',
        doctor_specialization: doc?.specialization || '',
        branch_name: branch?.name || (row.branch_id ? 'Clinic Branch' : 'Unmapped Historical Record'),
        conversation_id: null,
      } as DoctorConsultation;
    });
  },

  async getAvailableSlots(
    organizationId: string,
    branchId: string,
    doctorProfileId: string,
    date: string,
    serviceId?: string | null
  ): Promise<DoctorAvailableSlot[]> {
    const client = getClient();
    const { data, error } = await client.rpc('get_available_slots', {
      p_organization_id: organizationId,
      p_branch_id: branchId,
      p_doctor_profile_id: doctorProfileId,
      p_date: date,
      p_service_id: serviceId ?? null,
    });
    if (error) throw error;
    return (data || []) as DoctorAvailableSlot[];
  },

  async confirmAppointment(params: {
    appointment_id: string;
    confirmed_start?: string | null;
    confirmed_end?: string | null;
    doctor_profile_id?: string | null;
    service_id?: string | null;
  }): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('confirm_appointment', {
      p_appointment_id: params.appointment_id,
      p_confirmed_start: params.confirmed_start ?? null,
      p_confirmed_end: params.confirmed_end ?? null,
      p_doctor_profile_id: params.doctor_profile_id ?? null,
      p_service_id: params.service_id ?? null,
    });
    if (error) throw error;
  },

  async expireDueConsultations(
    organizationId: string,
    consultationId?: string
  ): Promise<number> {
    const client = getClient();
    const { data, error } = await client.rpc('expire_due_consultations', {
      p_organization_id: organizationId,
      p_consultation_id: consultationId ?? null,
    });
    if (error) {
      if (error.code === '42883') return 0;
      throw error;
    }
    return Number(data || 0);
  },

  async declineAppointment(appointmentId: string, reason: string): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('decline_appointment', {
      p_appointment_id: appointmentId,
      p_reason: reason.trim(),
    });
    if (error) throw error;
  },

  async cancelAppointment(appointmentId: string, reason?: string): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('cancel_appointment', {
      p_appointment_id: appointmentId,
      p_reason: reason?.trim() || null,
    });
    if (error) throw error;
  },

  async rescheduleAppointment(
    appointmentId: string,
    newStart: string,
    newEnd: string
  ): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('reschedule_appointment', {
      p_appointment_id: appointmentId,
      p_new_start: newStart,
      p_new_end: newEnd,
    });
    if (error) throw error;
  },

  async checkInAppointment(appointmentId: string): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('check_in_appointment', {
      p_appointment_id: appointmentId,
    });
    if (error) throw error;
  },

  async completeAppointment(appointmentId: string): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('complete_appointment', {
      p_appointment_id: appointmentId,
    });
    if (error) throw error;
  },

  async markNoShow(appointmentId: string): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('mark_no_show', {
      p_appointment_id: appointmentId,
    });
    if (error) throw error;
  },

  async createConsultationFromAppointment(params: {
    appointment_id: string;
    reason?: string | null;
    activate_immediately?: boolean;
  }): Promise<string> {
    const client = getClient();
    const { data, error } = await client.rpc('create_consultation_from_appointment', {
      p_appointment_id: params.appointment_id,
      p_reason: params.reason ?? null,
      p_activate_immediately: params.activate_immediately ?? true,
    });
    if (error) throw error;
    return (data as any)?.id || '';
  },

  async activateConsultation(consultationId: string): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('activate_consultation', {
      p_consultation_id: consultationId,
    });
    if (error) throw error;
  },

  async completeConsultation(consultationId: string): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('complete_consultation', {
      p_consultation_id: consultationId,
    });
    if (error) throw error;
  },

  async rejectConsultation(consultationId: string, reason: string): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('reject_consultation', {
      p_consultation_id: consultationId,
      p_reason: reason.trim(),
    });
    if (error) throw error;
  },

  async reassignConsultation(
    consultationId: string,
    newDoctorProfileId: string,
    reason: string
  ): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('reassign_consultation', {
      p_consultation_id: consultationId,
      p_new_doctor_profile_id: newDoctorProfileId,
      p_reason: reason.trim() || 'Administrative doctor reassignment',
    });
    if (error) throw error;
  },

  // ---------------------------------------------------------------------------
  // PET DIRECTORY (STRICT ORG SCOPE)
  // ---------------------------------------------------------------------------

  async getOrgPetsDirectory(
    organizationId: string,
    includeArchived = false
  ): Promise<AdminPetDirectoryItem[]> {
    const client = getClient();
    let petsQuery = client
      .from('pets')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });

    if (!includeArchived) {
      petsQuery = petsQuery.is('archived_at', null);
    }

    const [petsRes, guardiansRes, clients, apptsRes, consRes] = await Promise.all([
      petsQuery,
      client
        .from('pet_guardians')
        .select('*')
        .eq('organization_id', organizationId),
      onboardingService.getOrgClinicClients(organizationId),
      client
        .from('appointments')
        .select('id, pet_id')
        .eq('organization_id', organizationId),
      client
        .from('consultations')
        .select('id, pet_id')
        .eq('organization_id', organizationId),
    ]);

    if (petsRes.error) throw petsRes.error;
    if (guardiansRes.error) throw guardiansRes.error;

    const clientMap = new Map(clients.map((c) => [c.id, c]));
    const apptCountByPet = new Map<string, number>();
    for (const a of (apptsRes.data || []) as any[]) {
      apptCountByPet.set(a.pet_id, (apptCountByPet.get(a.pet_id) || 0) + 1);
    }
    const consCountByPet = new Map<string, number>();
    for (const c of (consRes.data || []) as any[]) {
      consCountByPet.set(c.pet_id, (consCountByPet.get(c.pet_id) || 0) + 1);
    }

    const guardiansByPet = new Map<string, AdminPetGuardianLink[]>();
    for (const g of (guardiansRes.data || []) as any[]) {
      const cc = clientMap.get(g.clinic_client_id);
      const list = guardiansByPet.get(g.pet_id) || [];
      list.push({
        id: g.id,
        pet_id: g.pet_id,
        clinic_client_id: g.clinic_client_id,
        client_name: cc?.full_name || 'Registered Client',
        client_email: cc?.email || null,
        client_phone: cc?.phone || null,
        client_status: cc?.status || 'approved',
        relationship: g.relationship || 'owner',
        is_primary: Boolean(g.is_primary),
      });
      guardiansByPet.set(g.pet_id, list);
    }

    return ((petsRes.data || []) as ClientPet[]).map((pet) => ({
      ...pet,
      guardians: guardiansByPet.get(pet.id) || [],
      appointment_count: apptCountByPet.get(pet.id) || 0,
      consultation_count: consCountByPet.get(pet.id) || 0,
    }));
  },

  async createPetForClient(params: {
    organization_id: string;
    clinic_client_id: string;
    name: string;
    species: string;
    breed: string;
    gender: string;
    weight: number;
    date_of_birth?: string | null;
    color?: string | null;
    allergies?: string | null;
    medical_notes?: string | null;
  }): Promise<string> {
    const client = getClient();
    const { data, error } = await client.rpc('create_pet', {
      p_organization_id: params.organization_id,
      p_clinic_client_id: params.clinic_client_id,
      p_name: params.name.trim(),
      p_species: params.species.trim(),
      p_breed: params.breed.trim(),
      p_gender: params.gender.trim(),
      p_weight: params.weight,
      p_dob: params.date_of_birth || null,
      p_color: params.color?.trim() || null,
      p_allergies: params.allergies?.trim() || null,
      p_medical_notes: params.medical_notes?.trim() || null,
    });
    if (error) throw error;
    return String(data);
  },

  async updatePet(
    petId: string,
    updates: {
      name?: string;
      species?: string;
      breed?: string;
      gender?: string;
      weight?: number;
      color?: string;
      allergies?: string;
      medical_notes?: string;
    }
  ): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('update_pet', {
      p_pet_id: petId,
      p_updates: updates,
    });
    if (error) throw error;
  },

  async archivePet(petId: string, reason?: string): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('archive_pet', {
      p_pet_id: petId,
      p_reason: reason?.trim() || null,
    });
    if (error) throw error;
  },

  // ---------------------------------------------------------------------------
  // AUDIT LOGS, PAYMENTS & CLINICAL PERMISSION-BOUND AUDIT
  // ---------------------------------------------------------------------------

  async getOrgAuditLogs(
    organizationId: string,
    limit = 150
  ): Promise<AdminAuditLogItem[]> {
    const client = getClient();
    const [logsRes, members] = await Promise.all([
      client
        .from('audit_logs')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(limit),
      onboardingService.getOrgMembers(organizationId).catch(() => []),
    ]);

    if (logsRes.error) throw logsRes.error;
    const rows = (logsRes.data || []) as any[];
    const actorIds = Array.from(
      new Set(
        rows
          .map((r) => r.actor_user_id || r.user_id)
          .filter((id): id is string => Boolean(id))
      )
    );

    const memberMap = new Map(members.map((m) => [m.user_id, m]));
    const missingIds = actorIds.filter((id) => !memberMap.has(id));
    const profileMap = new Map<string, { full_name: string; email: string }>();

    if (missingIds.length > 0) {
      const { data: profData } = await client
        .from('profiles')
        .select('id, full_name, email')
        .in('id', missingIds);
      for (const p of (profData || []) as any[]) {
        profileMap.set(p.id, { full_name: p.full_name, email: p.email });
      }
    }

    return rows.map((row) => {
      const actorId = row.actor_user_id || row.user_id || null;
      const member = actorId ? memberMap.get(actorId) : undefined;
      const prof = actorId ? profileMap.get(actorId) : undefined;
      return {
        id: row.id,
        organization_id: row.organization_id,
        actor_user_id: actorId,
        actor_name: member?.full_name || prof?.full_name || 'Authorized Actor',
        actor_email: member?.email || prof?.email || '',
        action: row.action,
        entity_type: row.entity_type,
        entity_id: row.entity_id || null,
        details: row.details || null,
        before_json: row.before_json || null,
        after_json: row.after_json || null,
        created_at: row.created_at,
      };
    });
  },

  async getOrgPayments(organizationId: string): Promise<AdminPaymentLedgerItem[]> {
    const client = getClient();
    const [payRes, consultations] = await Promise.all([
      client
        .from('consultation_payments')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(500),
      adminPortalService.getConsultations(organizationId).catch(() => []),
    ]);

    if (payRes.error) throw payRes.error;
    const consMap = new Map(consultations.map((c) => [c.id, c]));

    return ((payRes.data || []) as any[]).map((row) => {
      const cons = consMap.get(row.consultation_id);
      return {
        id: row.id,
        organization_id: row.organization_id,
        consultation_id: row.consultation_id,
        amount: Number(row.amount || 0),
        payment_status: row.payment_status,
        gateway: row.gateway || null,
        transaction_id: row.transaction_id || null,
        paid_at: row.paid_at || null,
        created_at: row.created_at,
        pet_name: cons?.pet_name || null,
        client_name: cons?.client_name || null,
        doctor_name: cons?.doctor_name || null,
      };
    });
  },

  async getClinicalAuditIfAuthorized(
    organizationId: string,
    hasMedicalReadPermission: boolean
  ): Promise<AdminClinicalAuditOverview> {
    if (!hasMedicalReadPermission) {
      return { medicalRecords: [], prescriptions: [] };
    }
    const client = getClient();
    const [recRes, rxRes, rxItemsRes, petsRes, docs] = await Promise.all([
      client
        .from('medical_records')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(500),
      client
        .from('prescriptions')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(500),
      client
        .from('prescription_items')
        .select('*')
        .eq('organization_id', organizationId),
      client
        .from('pets')
        .select('id, name, species')
        .eq('organization_id', organizationId),
      onboardingService.getOrgDoctors(organizationId),
    ]);

    if (recRes.error) throw recRes.error;
    if (rxRes.error) throw rxRes.error;
    if (rxItemsRes.error) throw rxItemsRes.error;

    const petMap = new Map(((petsRes.data || []) as any[]).map((p) => [p.id, p]));
    const docMap = new Map(docs.map((d) => [d.id, d]));
    const itemsByRx = new Map<string, any[]>();
    for (const item of (rxItemsRes.data || []) as any[]) {
      const list = itemsByRx.get(item.prescription_id) || [];
      list.push(item);
      itemsByRx.set(item.prescription_id, list);
    }

    const medicalRecords: ClientMedicalRecord[] = ((recRes.data || []) as any[]).map(
      (r) => ({
        ...r,
        pet_name: petMap.get(r.pet_id)?.name || 'Pet Patient',
        doctor_name: docMap.get(r.doctor_id)?.full_name || 'Veterinary Doctor',
      })
    );

    const prescriptions: ClientPrescription[] = ((rxRes.data || []) as any[]).map(
      (rx) => ({
        ...rx,
        pet_name: petMap.get(rx.pet_id)?.name || 'Pet Patient',
        pet_species: petMap.get(rx.pet_id)?.species || '',
        doctor_name: docMap.get(rx.doctor_id)?.full_name || 'Veterinary Doctor',
        doctor_qualification: docMap.get(rx.doctor_id)?.qualification || '',
        items: itemsByRx.get(rx.id) || [],
      })
    );

    return { medicalRecords, prescriptions };
  },

  async getNotifications(
    organizationId: string,
    userId: string
  ): Promise<DoctorNotification[]> {
    const client = getClient();
    const { data, error } = await client
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .or(`organization_id.eq.${organizationId},organization_id.is.null`)
      .order('created_at', { ascending: false })
      .limit(150);
    if (error) throw error;
    return (data || []) as DoctorNotification[];
  },

  async setNotificationReadStatus(
    notificationId: string,
    userId: string,
    isRead: boolean
  ): Promise<void> {
    const client = getClient();
    const { error } = await client
      .from('notifications')
      .update({ is_read: isRead })
      .eq('id', notificationId)
      .eq('user_id', userId);
    if (error) throw error;
  },

  async markAllNotificationsRead(
    organizationId: string,
    userId: string
  ): Promise<void> {
    const client = getClient();
    const { error } = await client
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false)
      .or(`organization_id.eq.${organizationId},organization_id.is.null`);
    if (error) throw error;
  },

  async getOperationalOverview(params: {
    organizationId: string;
    canManageStaff: boolean;
    canReadClients: boolean;
    canReadPets: boolean;
    canReadAppointments: boolean;
    canReadAudit: boolean;
    membershipBranchIds?: string[];
  }): Promise<AdminOperationalOverview> {
    const { organizationId } = params;

    const [
      organization,
      branches,
      members,
      invitations,
      doctors,
      clients,
      pets,
      appointments,
      consultations,
      services,
      auditLogs,
      payments,
    ] = await Promise.all([
      adminPortalService.getOrganization(organizationId),
      onboardingService.getOrgBranches(organizationId),
      onboardingService.getOrgMembers(organizationId),
      params.canManageStaff
        ? onboardingService.getOrgInvitations(organizationId).catch(() => [])
        : Promise.resolve([]),
      onboardingService.getOrgDoctors(organizationId),
      params.canReadClients
        ? onboardingService.getOrgClinicClients(organizationId).catch(() => [])
        : Promise.resolve([]),
      params.canReadPets
        ? adminPortalService.getOrgPetsDirectory(organizationId, false).catch(() => [])
        : Promise.resolve([]),
      params.canReadAppointments
        ? adminPortalService
            .getAppointments(organizationId, params.membershipBranchIds)
            .catch(() => [])
        : Promise.resolve([]),
      adminPortalService.getConsultations(organizationId).catch(() => []),
      adminPortalService.getClinicServices(organizationId).catch(() => []),
      params.canReadAudit
        ? adminPortalService.getOrgAuditLogs(organizationId, 100).catch(() => [])
        : Promise.resolve([]),
      params.canReadAudit
        ? adminPortalService.getOrgPayments(organizationId).catch(() => [])
        : Promise.resolve([]),
    ]);

    return {
      organization,
      branches,
      members,
      invitations,
      doctors,
      clients,
      pets,
      appointments,
      consultations,
      services,
      auditLogs,
      payments,
    };
  },

  // ---------------------------------------------------------------------------
  // EXPLICIT PLATFORM SUPPORT ACCESS APPROVALS (ORG OWNER ONLY)
  // ---------------------------------------------------------------------------

  async listSupportGrants(organizationId: string): Promise<PlatformSupportGrant[]> {
    const client = getClient();
    const { data, error } = await client.rpc('platform_list_support_grants', {
      p_organization_id: organizationId,
    });
    if (error) {
      if (error.code === '42883') return [];
      throw error;
    }
    return (Array.isArray(data) ? data : []) as PlatformSupportGrant[];
  },

  async approveSupportGrant(grantId: string): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('approve_platform_support_access', {
      p_grant_id: grantId,
    });
    if (error) throw error;
  },

  async rejectSupportGrant(grantId: string, reason: string): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('reject_platform_support_access', {
      p_grant_id: grantId,
      p_reason: reason.trim(),
    });
    if (error) throw error;
  },

  async revokeSupportGrant(grantId: string, reason?: string): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('revoke_platform_support_access', {
      p_grant_id: grantId,
      p_reason: reason?.trim() || null,
    });
    if (error) throw error;
  },
};
