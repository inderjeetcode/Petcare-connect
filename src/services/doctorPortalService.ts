import { isSupabaseConfigured, supabase } from '../config/supabaseClient';
import { Branch, Organization } from '../types/auth';
import {
  AppointmentStatusHistoryEntry,
  ClientAttachment,
  ClientMedicalRecord,
  ClientPet,
  ClientPrescriptionItem,
} from '../types/client';
import {
  DoctorAppointment,
  DoctorAttachment,
  DoctorAvailableSlot,
  DoctorBranchAssignment,
  DoctorChatConversation,
  DoctorChatMessage,
  DoctorConsultation,
  DoctorMedicalRecord,
  DoctorNotification,
  DoctorPatientDirectoryItem,
  DoctorPrescription,
  DoctorScheduleException,
  DoctorSlotSummary,
  DoctorVaccination,
} from '../types/doctor';
import {
  assertTenantMatch,
  buildClinicalStoragePath,
  CLINICAL_FILES_BUCKET,
  validateAttachmentFile,
} from '../utils/clientPortalHelpers';
import {
  parsePgTstzRange,
  validateMedicalRecordInput,
  validatePrescriptionInput,
  validateVaccinationInput,
} from '../utils/doctorPortalHelpers';

function getClient() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error(
      'Supabase client is not configured. Please provide VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
    );
  }
  return supabase;
}

function createUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function fetchDoctorLookupMap(
  organizationId: string
): Promise<
  Map<
    string,
    {
      id: string;
      user_id: string;
      full_name: string;
      qualification: string;
      specialization: string;
      avatar_url: string | null;
    }
  >
> {
  const client = getClient();
  const { data, error } = await client
    .from('doctor_profiles')
    .select(
      'id, user_id, display_name, qualification, specialization, profile:profiles!doctor_profiles_user_id_fkey(full_name, avatar_url)'
    )
    .eq('organization_id', organizationId);

  if (error) throw error;

  const map = new Map<
    string,
    {
      id: string;
      user_id: string;
      full_name: string;
      qualification: string;
      specialization: string;
      avatar_url: string | null;
    }
  >();

  for (const row of (data || []) as any[]) {
    map.set(row.id, {
      id: row.id,
      user_id: row.user_id,
      full_name: row.display_name || row.profile?.full_name || 'Veterinary Doctor',
      qualification: row.qualification || '',
      specialization: row.specialization || '',
      avatar_url: row.profile?.avatar_url || null,
    });
  }
  return map;
}

async function fetchClinicClientMap(
  organizationId: string
): Promise<
  Map<
    string,
    {
      id: string;
      user_id: string | null;
      full_name: string;
      email: string | null;
      phone: string | null;
    }
  >
> {
  const client = getClient();
  const { data, error } = await client
    .from('clinic_clients')
    .select('id, user_id, full_name, email, phone')
    .eq('organization_id', organizationId);

  if (error) throw error;

  const map = new Map<
    string,
    {
      id: string;
      user_id: string | null;
      full_name: string;
      email: string | null;
      phone: string | null;
    }
  >();

  for (const row of (data || []) as any[]) {
    map.set(row.id, {
      id: row.id,
      user_id: row.user_id || null,
      full_name: row.full_name || 'Registered Client',
      email: row.email || null,
      phone: row.phone || null,
    });
  }
  return map;
}

export const doctorPortalService = {
  // ---------------------------------------------------------------------------
  // ORGANIZATION & ASSIGNED BRANCHES (READ-ONLY FOR DOCTORS)
  // ---------------------------------------------------------------------------

  async getOrganizationAndBranches(
    organizationId: string,
    doctorProfileId: string | null
  ): Promise<{
    organization: Organization;
    allBranches: Branch[];
    assignedBranches: Branch[];
    assignments: DoctorBranchAssignment[];
  }> {
    const client = getClient();
    const [orgRes, branchRes, assignRes] = await Promise.all([
      client.from('organizations').select('*').eq('id', organizationId).single(),
      client
        .from('branches')
        .select('*')
        .eq('organization_id', organizationId)
        .order('name', { ascending: true }),
      doctorProfileId
        ? client
            .from('doctor_branch_assignments')
            .select('*')
            .eq('organization_id', organizationId)
            .eq('doctor_profile_id', doctorProfileId)
            .order('created_at', { ascending: true })
        : Promise.resolve({ data: [], error: null } as any),
    ]);

    if (orgRes.error) throw orgRes.error;
    if (branchRes.error) throw branchRes.error;
    if (assignRes.error) throw assignRes.error;

    const allBranches = (branchRes.data || []) as Branch[];
    const branchMap = new Map(allBranches.map((b) => [b.id, b]));
    const assignments: DoctorBranchAssignment[] = ((assignRes.data || []) as any[]).map(
      (a) => ({
        id: a.id,
        organization_id: a.organization_id,
        doctor_profile_id: a.doctor_profile_id,
        branch_id: a.branch_id,
        is_active: Boolean(a.is_active),
        effective_from: a.effective_from,
        effective_to: a.effective_to || null,
        branch: branchMap.get(a.branch_id) || null,
      })
    );

    const activeBranchIds = new Set(
      assignments.filter((a) => a.is_active).map((a) => a.branch_id)
    );
    const assignedBranches = allBranches.filter((b) => activeBranchIds.has(b.id));

    return {
      organization: orgRes.data as Organization,
      allBranches,
      assignedBranches,
      assignments,
    };
  },

  // ---------------------------------------------------------------------------
  // SCHEDULES, BREAKS, EXCEPTIONS & AVAILABLE SLOTS
  // ---------------------------------------------------------------------------

  async getDoctorSchedules(
    organizationId: string,
    doctorProfileId: string
  ): Promise<DoctorSlotSummary[]> {
    const client = getClient();
    const { data, error } = await client
      .from('doctor_schedules')
      .select('id, branch_id, weekday, start_time, end_time, slot_minutes, is_active')
      .eq('organization_id', organizationId)
      .eq('doctor_profile_id', doctorProfileId)
      .eq('is_active', true)
      .order('weekday', { ascending: true })
      .order('start_time', { ascending: true });

    if (error) throw error;
    return (data || []) as DoctorSlotSummary[];
  },

  async saveDoctorDaySchedule(params: {
    organization_id: string;
    branch_id: string;
    doctor_profile_id: string;
    weekday: number;
    is_available: boolean;
    start_time: string;
    end_time: string;
    break_start?: string | null;
    break_end?: string | null;
    slot_minutes: number;
  }): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('save_doctor_branch_day_schedule', {
      p_organization_id: params.organization_id,
      p_branch_id: params.branch_id,
      p_doctor_profile_id: params.doctor_profile_id,
      p_weekday: params.weekday,
      p_is_available: params.is_available,
      p_start_time: params.start_time,
      p_end_time: params.end_time,
      p_break_start: params.break_start || null,
      p_break_end: params.break_end || null,
      p_slot_minutes: params.slot_minutes,
    });
    if (error) throw error;
  },

  async getScheduleExceptions(
    organizationId: string,
    doctorProfileId: string
  ): Promise<DoctorScheduleException[]> {
    const client = getClient();
    const [excRes, branchRes] = await Promise.all([
      client
        .from('doctor_schedule_exceptions')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('doctor_profile_id', doctorProfileId)
        .order('start_at', { ascending: true }),
      client
        .from('branches')
        .select('id, name')
        .eq('organization_id', organizationId),
    ]);

    if (excRes.error) throw excRes.error;
    const branchMap = new Map(
      ((branchRes.data || []) as any[]).map((b) => [b.id, b.name])
    );

    return ((excRes.data || []) as any[]).map((e) => ({
      id: e.id,
      organization_id: e.organization_id,
      branch_id: e.branch_id || null,
      doctor_profile_id: e.doctor_profile_id,
      start_at: e.start_at,
      end_at: e.end_at,
      exception_type: e.exception_type,
      reason: e.reason || null,
      created_by: e.created_by || null,
      created_at: e.created_at,
      branch_name: e.branch_id ? branchMap.get(e.branch_id) || 'Branch' : 'All Assigned Branches',
    }));
  },

  async addScheduleException(params: {
    organization_id: string;
    doctor_profile_id: string;
    branch_id: string | null;
    start_at: string;
    end_at: string;
    exception_type: DoctorScheduleException['exception_type'];
    reason: string;
  }): Promise<string> {
    const client = getClient();
    const { data, error } = await client.rpc('add_schedule_exception', {
      p_organization_id: params.organization_id,
      p_doctor_profile_id: params.doctor_profile_id,
      p_branch_id: params.branch_id,
      p_start_at: params.start_at,
      p_end_at: params.end_at,
      p_exception_type: params.exception_type,
      p_reason: params.reason.trim(),
    });
    if (error) throw error;
    return String(data);
  },

  async removeScheduleException(exceptionId: string): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('remove_schedule_exception', {
      p_exception_id: exceptionId,
    });
    if (error) throw error;
  },

  async getAvailableSlots(params: {
    organization_id: string;
    branch_id: string;
    doctor_profile_id: string;
    date: string;
  }): Promise<DoctorAvailableSlot[]> {
    const client = getClient();
    const { data, error } = await client.rpc('get_available_slots', {
      p_organization_id: params.organization_id,
      p_branch_id: params.branch_id,
      p_doctor_profile_id: params.doctor_profile_id,
      p_date: params.date,
    });
    if (error) throw error;
    return (data || []) as DoctorAvailableSlot[];
  },

  // ---------------------------------------------------------------------------
  // APPOINTMENTS (VIEW + COMPLETE ONLY — CONFIRMATION IS ADMIN/FRONT-DESK ONLY)
  // ---------------------------------------------------------------------------

  async getAppointments(
    organizationId: string,
    doctorProfileId?: string | null
  ): Promise<DoctorAppointment[]> {
    const client = getClient();

    let apptQuery = client
      .from('appointments')
      .select('*')
      .eq('organization_id', organizationId)
      .order('requested_start', { ascending: false });

    if (doctorProfileId) {
      apptQuery = apptQuery.eq('doctor_profile_id', doctorProfileId);
    }

    const [apptRes, branchRes, petRes, clientMap, docMap, consRes] = await Promise.all([
      apptQuery,
      client.from('branches').select('id, name, timezone').eq('organization_id', organizationId),
      client
        .from('pets')
        .select('id, name, species, breed')
        .eq('organization_id', organizationId),
      fetchClinicClientMap(organizationId),
      fetchDoctorLookupMap(organizationId),
      client
        .from('consultations')
        .select('id, appointment_id, consultation_status')
        .eq('organization_id', organizationId)
        .neq('consultation_status', 'rejected'),
    ]);

    if (apptRes.error) throw apptRes.error;
    if (branchRes.error) throw branchRes.error;
    if (petRes.error) throw petRes.error;

    const appts = (apptRes.data || []) as any[];
    if (appts.length === 0) return [];

    const apptIds = appts.map((a) => a.id);
    const { data: histData } = await client
      .from('appointment_status_history')
      .select('id, appointment_id, from_status, to_status, reason, changed_at')
      .eq('organization_id', organizationId)
      .in('appointment_id', apptIds)
      .order('changed_at', { ascending: true });

    const historyMap = new Map<string, AppointmentStatusHistoryEntry[]>();
    for (const h of (histData || []) as AppointmentStatusHistoryEntry[]) {
      const list = historyMap.get(h.appointment_id) || [];
      list.push(h);
      historyMap.set(h.appointment_id, list);
    }

    const branchMap = new Map(((branchRes.data || []) as any[]).map((b) => [b.id, b]));
    const petMap = new Map(((petRes.data || []) as any[]).map((p) => [p.id, p]));
    const consByAppt = new Map<string, { id: string; status: any }>();
    for (const c of (consRes.data || []) as any[]) {
      if (c.appointment_id) {
        consByAppt.set(c.appointment_id, {
          id: c.id,
          status: c.consultation_status,
        });
      }
    }

    return appts.map((a) => {
      const branch = branchMap.get(a.branch_id);
      const pet = petMap.get(a.pet_id);
      const cli = clientMap.get(a.clinic_client_id);
      const doc = docMap.get(a.doctor_profile_id);
      const linkedCons = consByAppt.get(a.id);
      const parsedRange = parsePgTstzRange(a.scheduled_range);

      return {
        id: a.id,
        organization_id: a.organization_id,
        branch_id: a.branch_id,
        clinic_client_id: a.clinic_client_id,
        pet_id: a.pet_id,
        doctor_profile_id: a.doctor_profile_id,
        requested_start: a.requested_start,
        requested_end: a.requested_end,
        scheduled_range: a.scheduled_range,
        scheduled_start: parsedRange.start,
        scheduled_end: parsedRange.end,
        status: a.status,
        reason: a.reason,
        decline_reason: a.decline_reason || null,
        cancellation_reason: a.cancellation_reason || null,
        confirmed_at: a.confirmed_at || null,
        checked_in_at: a.checked_in_at || null,
        completed_at: a.completed_at || null,
        created_at: a.created_at,
        updated_at: a.updated_at,
        pet_name: pet?.name || 'Pet',
        pet_species: pet?.species || '',
        pet_breed: pet?.breed || '',
        client_name: cli?.full_name || 'Registered Client',
        client_phone: cli?.phone || null,
        client_email: cli?.email || null,
        doctor_name: doc?.full_name || 'Veterinary Doctor',
        branch_name: branch?.name || 'Clinic Branch',
        branch_timezone: branch?.timezone || 'UTC',
        consultation_id: linkedCons?.id || null,
        consultation_status: linkedCons?.status || null,
        history: historyMap.get(a.id) || [],
      };
    });
  },

  async completeAppointment(appointmentId: string): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('complete_appointment', {
      p_appointment_id: appointmentId,
    });
    if (error) throw error;
  },

  // ---------------------------------------------------------------------------
  // CONSULTATIONS & CLINICAL NOTES
  // ---------------------------------------------------------------------------

  async getConsultations(
    organizationId: string,
    doctorProfileId?: string | null
  ): Promise<DoctorConsultation[]> {
    const client = getClient();

    let consQuery = client
      .from('consultations')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });

    if (doctorProfileId) {
      consQuery = consQuery.eq('doctor_id', doctorProfileId);
    }

    const [consRes, branchRes, petRes, clientMap, docMap, convRes, apptRes] =
      await Promise.all([
        consQuery,
        client.from('branches').select('id, name').eq('organization_id', organizationId),
        client
          .from('pets')
          .select('id, name, species, breed')
          .eq('organization_id', organizationId),
        fetchClinicClientMap(organizationId),
        fetchDoctorLookupMap(organizationId),
        // D-16: RLS strictly returns conversations where auth.uid() is the treating doctor or client
        client
          .from('chat_conversations')
          .select('id, consultation_id')
          .eq('organization_id', organizationId),
        client
          .from('appointments')
          .select('id, status')
          .eq('organization_id', organizationId),
      ]);

    if (consRes.error) throw consRes.error;

    const branchMap = new Map(
      ((branchRes.data || []) as any[]).map((b) => [b.id, b.name])
    );
    const petMap = new Map(((petRes.data || []) as any[]).map((p) => [p.id, p]));
    const convMap = new Map(
      ((convRes.data || []) as any[]).map((c) => [c.consultation_id, c.id])
    );
    const apptStatusMap = new Map(
      ((apptRes.data || []) as any[]).map((a) => [a.id, a.status])
    );

    const clientByUserId = new Map<string, string>();
    for (const c of clientMap.values()) {
      if (c.user_id) clientByUserId.set(c.user_id, c.full_name);
    }

    return ((consRes.data || []) as any[]).map((c) => {
      const pet = petMap.get(c.pet_id);
      const doc = docMap.get(c.doctor_id);
      const cc = c.clinic_client_id ? clientMap.get(c.clinic_client_id) : null;
      return {
        id: c.id,
        organization_id: c.organization_id,
        branch_id: c.branch_id || null,
        clinic_client_id: c.clinic_client_id || null,
        appointment_id: c.appointment_id || null,
        client_id: c.client_id,
        doctor_id: c.doctor_id,
        pet_id: c.pet_id,
        consultation_reason: c.consultation_reason,
        consultation_status: c.consultation_status,
        clinical_notes: c.clinical_notes || null,
        follow_up_date: c.follow_up_date || null,
        activated_at: c.activated_at || null,
        expires_at: c.expires_at || null,
        completed_at: c.completed_at || null,
        rejection_reason: c.rejection_reason || null,
        created_at: c.created_at,
        updated_at: c.updated_at,
        pet_name: pet?.name || 'Pet',
        pet_species: pet?.species || '',
        pet_breed: pet?.breed || '',
        client_name:
          cc?.full_name || clientByUserId.get(c.client_id) || 'Registered Client',
        doctor_name: doc?.full_name || 'Veterinary Doctor',
        doctor_user_id: doc?.user_id || null,
        doctor_qualification: doc?.qualification || '',
        doctor_specialization: doc?.specialization || '',
        branch_name: c.branch_id ? branchMap.get(c.branch_id) || 'Clinic Branch' : undefined,
        conversation_id: convMap.get(c.id) || null,
        appointment_status: c.appointment_id
          ? apptStatusMap.get(c.appointment_id) || null
          : null,
      };
    });
  },

  async createConsultationFromAppointment(params: {
    appointment_id: string;
    reason?: string;
    activate_immediately?: boolean;
  }): Promise<string> {
    const client = getClient();
    const { data, error } = await client.rpc('create_consultation_from_appointment', {
      p_appointment_id: params.appointment_id,
      p_reason: params.reason?.trim() || null,
      p_activate_immediately: params.activate_immediately ?? true,
    });
    if (error) throw error;
    return String((data as any)?.id || '');
  },

  async activateConsultation(consultationId: string): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('activate_consultation', {
      p_consultation_id: consultationId,
    });
    if (error) throw error;
  },

  async rejectConsultation(consultationId: string, reason: string): Promise<void> {
    if (!reason.trim()) {
      throw new Error('Decline reason is required.');
    }
    const client = getClient();
    const { error } = await client.rpc('reject_consultation', {
      p_consultation_id: consultationId,
      p_reason: reason.trim(),
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

  async updateConsultationClinicalSummary(params: {
    consultation_id: string;
    clinical_notes: string;
    follow_up_date: string | null;
  }): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('update_consultation_clinical_summary', {
      p_consultation_id: params.consultation_id,
      p_clinical_notes: params.clinical_notes.trim() || null,
      p_follow_up_date: params.follow_up_date || null,
    });
    if (error) throw error;
  },

  // ---------------------------------------------------------------------------
  // CONSULTATION CHAT (PARTICIPANT-ONLY & READ-ONLY ON EXPIRY)
  // ---------------------------------------------------------------------------

  async getConversationByConsultation(
    organizationId: string,
    consultationId: string
  ): Promise<DoctorChatConversation | null> {
    const client = getClient();
    const { data, error } = await client
      .from('chat_conversations')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('consultation_id', consultationId)
      .maybeSingle();

    if (error) throw error;
    return (data as DoctorChatConversation | null) || null;
  },

  async getConversationMessages(
    organizationId: string,
    conversationId: string,
    consultation: Pick<DoctorConsultation, 'doctor_user_id' | 'doctor_name' | 'client_name'>
  ): Promise<DoctorChatMessage[]> {
    const client = getClient();
    const { data: msgs, error } = await client
      .from('chat_messages')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    const msgList = (msgs || []) as any[];
    if (msgList.length === 0) return [];

    const msgIds = msgList.map((m) => m.id);
    const { data: msgAtts } = await client
      .from('message_attachments')
      .select('message_id, attachment_id')
      .eq('organization_id', organizationId)
      .in('message_id', msgIds);

    const attIds = Array.from(
      new Set(((msgAtts || []) as any[]).map((ma) => ma.attachment_id))
    );

    const attMap = new Map<string, DoctorAttachment>();
    if (attIds.length > 0) {
      const { data: attData } = await client
        .from('attachments')
        .select('*')
        .eq('organization_id', organizationId)
        .in('id', attIds);

      for (const a of (attData || []) as DoctorAttachment[]) {
        attMap.set(a.id, a);
      }
    }

    const byMessage = new Map<string, DoctorAttachment[]>();
    for (const ma of (msgAtts || []) as any[]) {
      const att = attMap.get(ma.attachment_id);
      if (!att) continue;
      const existing = byMessage.get(ma.message_id) || [];
      existing.push(att);
      byMessage.set(ma.message_id, existing);
    }

    return msgList.map((m) => {
      const isDoc =
        consultation.doctor_user_id && m.sender_id === consultation.doctor_user_id;
      return {
        id: m.id,
        organization_id: m.organization_id,
        conversation_id: m.conversation_id,
        sender_id: m.sender_id,
        sender_name: isDoc
          ? consultation.doctor_name || 'Veterinary Doctor'
          : consultation.client_name || 'Pet Owner',
        sender_role: isDoc ? 'doctor' : 'client',
        message_type: m.message_type,
        message_content: m.message_content,
        read_at: m.read_at || null,
        created_at: m.created_at,
        attachments: byMessage.get(m.id) || [],
      };
    });
  },

  async sendChatMessage(params: {
    organization_id: string;
    consultation_id: string;
    conversation_id: string;
    content: string;
    file?: File | null;
  }): Promise<void> {
    const trimmed = params.content.trim();
    if (!trimmed && !params.file) {
      throw new Error('Please enter a message or select a file attachment.');
    }

    let attachmentIds: string[] = [];
    let messageType: 'text' | 'image' | 'file' = 'text';

    if (params.file) {
      const attachment = await this.uploadClinicalAttachment({
        organization_id: params.organization_id,
        entity_type: 'chat_message',
        entity_id: params.consultation_id,
        file: params.file,
      });
      attachmentIds = [attachment.id];
      messageType = params.file.type.startsWith('image/') ? 'image' : 'file';
    }

    const client = getClient();
    const { error } = await client.rpc('send_chat_message', {
      p_conversation_id: params.conversation_id,
      p_message_type: messageType,
      p_content: trimmed || `Shared attachment: ${params.file?.name || 'Clinical file'}`,
      p_attachment_ids: attachmentIds,
    });
    if (error) throw error;
  },

  async markConversationRead(conversationId: string): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('mark_messages_read', {
      p_conversation_id: conversationId,
    });
    if (error) throw error;
  },

  subscribeToConversationMessages(
    conversationId: string,
    onUpdate: () => void
  ): () => void {
    const client = getClient();
    const channel = client
      .channel(`doctor-chat-${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chat_messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          onUpdate();
        }
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  },

  // ---------------------------------------------------------------------------
  // ORGANIZATION PATIENTS & CLINICAL HISTORY (D-17 ORG-WIDE CLINICAL READ)
  // ---------------------------------------------------------------------------

  async getOrganizationPatients(
    organizationId: string
  ): Promise<DoctorPatientDirectoryItem[]> {
    const client = getClient();
    const [petRes, guardRes, clientMap, consRes] = await Promise.all([
      client
        .from('pets')
        .select('*')
        .eq('organization_id', organizationId)
        .is('archived_at', null)
        .order('created_at', { ascending: false }),
      client
        .from('pet_guardians')
        .select('pet_id, clinic_client_id, is_primary')
        .eq('organization_id', organizationId),
      fetchClinicClientMap(organizationId),
      client
        .from('consultations')
        .select('pet_id, created_at')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false }),
    ]);

    if (petRes.error) throw petRes.error;
    if (guardRes.error) throw guardRes.error;

    const guardsByPet = new Map<string, string[]>();
    for (const g of (guardRes.data || []) as any[]) {
      const list = guardsByPet.get(g.pet_id) || [];
      if (g.is_primary) {
        list.unshift(g.clinic_client_id);
      } else {
        list.push(g.clinic_client_id);
      }
      guardsByPet.set(g.pet_id, list);
    }

    const consCountMap = new Map<string, { count: number; last: string | null }>();
    for (const c of (consRes.data || []) as any[]) {
      const existing = consCountMap.get(c.pet_id);
      if (!existing) {
        consCountMap.set(c.pet_id, { count: 1, last: c.created_at });
      } else {
        existing.count += 1;
      }
    }

    return ((petRes.data || []) as ClientPet[]).map((pet) => {
      const ccIds = guardsByPet.get(pet.id) || [];
      const names: string[] = [];
      const phones: string[] = [];
      const emails: string[] = [];

      for (const ccId of ccIds) {
        const cli = clientMap.get(ccId);
        if (cli) {
          names.push(cli.full_name);
          if (cli.phone) phones.push(cli.phone);
          if (cli.email) emails.push(cli.email);
        }
      }

      if (names.length === 0) {
        for (const cli of clientMap.values()) {
          if (cli.user_id && cli.user_id === pet.owner_id) {
            names.push(cli.full_name);
            if (cli.phone) phones.push(cli.phone);
            if (cli.email) emails.push(cli.email);
            break;
          }
        }
      }

      const stats = consCountMap.get(pet.id);
      return {
        ...pet,
        guardian_names: names,
        guardian_phones: phones,
        guardian_emails: emails,
        consultation_count: stats?.count || 0,
        last_visit_at: stats?.last || null,
      };
    });
  },

  async getMedicalRecords(
    organizationId: string,
    petId?: string
  ): Promise<DoctorMedicalRecord[]> {
    const client = getClient();
    let query = client
      .from('medical_records')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });

    if (petId) {
      query = query.eq('pet_id', petId);
    }

    const [recRes, petRes, docMap] = await Promise.all([
      query,
      client
        .from('pets')
        .select('id, name, organization_id')
        .eq('organization_id', organizationId),
      fetchDoctorLookupMap(organizationId),
    ]);

    if (recRes.error) throw recRes.error;
    const records = (recRes.data || []) as any[];
    const recIds = records.map((r) => r.id);
    const attachments = await this.getAttachmentsForEntities(
      organizationId,
      'medical_record',
      recIds
    );

    const petMap = new Map(((petRes.data || []) as any[]).map((p) => [p.id, p.name]));
    const attByRecord = new Map<string, ClientAttachment[]>();
    for (const a of attachments) {
      assertTenantMatch(a.organization_id, organizationId, 'Medical attachment');
      const list = attByRecord.get(a.entity_id) || [];
      list.push(a);
      attByRecord.set(a.entity_id, list);
    }

    return records.map((r) => ({
      id: r.id,
      organization_id: r.organization_id,
      pet_id: r.pet_id,
      consultation_id: r.consultation_id,
      doctor_id: r.doctor_id,
      created_by: r.created_by || null,
      amended_from_id: r.amended_from_id || null,
      record_type: r.record_type,
      diagnosis: r.diagnosis,
      notes: r.notes,
      created_at: r.created_at,
      pet_name: petMap.get(r.pet_id) || 'Pet',
      doctor_name: r.doctor_id
        ? docMap.get(r.doctor_id)?.full_name || 'Clinic Veterinarian'
        : 'Clinic Veterinarian',
      attachments: attByRecord.get(r.id) || [],
    }));
  },

  async addMedicalRecord(params: {
    organization_id: string;
    pet_id: string;
    consultation_id: string | null;
    record_type: ClientMedicalRecord['record_type'];
    diagnosis: string;
    notes: string;
    file?: File | null;
  }): Promise<string> {
    const err = validateMedicalRecordInput(params);
    if (err) throw new Error(err);

    const client = getClient();
    const { data, error } = await client.rpc('add_medical_record', {
      p_organization_id: params.organization_id,
      p_pet_id: params.pet_id,
      p_consultation_id: params.consultation_id || null,
      p_record_type: params.record_type,
      p_diagnosis: params.diagnosis.trim(),
      p_notes: params.notes.trim(),
    });
    if (error) throw error;

    const recId = String(data);
    if (params.file) {
      await this.uploadClinicalAttachment({
        organization_id: params.organization_id,
        entity_type: 'medical_record',
        entity_id: recId,
        file: params.file,
      });
    }
    return recId;
  },

  async amendMedicalRecord(params: {
    organization_id: string;
    original_record_id: string;
    diagnosis: string;
    notes: string;
    file?: File | null;
  }): Promise<string> {
    if (!params.diagnosis.trim() || params.diagnosis.trim().length < 3) {
      throw new Error('Amendment diagnosis must be at least 3 characters.');
    }
    if (!params.notes.trim() || params.notes.trim().length < 5) {
      throw new Error('Amendment clinical notes must be at least 5 characters.');
    }

    const client = getClient();
    const { data, error } = await client.rpc('amend_medical_record', {
      p_original_record_id: params.original_record_id,
      p_diagnosis: params.diagnosis.trim(),
      p_notes: params.notes.trim(),
    });
    if (error) throw error;

    const amendedId = String(data);
    if (params.file) {
      await this.uploadClinicalAttachment({
        organization_id: params.organization_id,
        entity_type: 'medical_record',
        entity_id: amendedId,
        file: params.file,
      });
    }
    return amendedId;
  },

  async getVaccinations(
    organizationId: string,
    petId?: string
  ): Promise<DoctorVaccination[]> {
    const client = getClient();
    let query = client
      .from('vaccinations')
      .select('*')
      .eq('organization_id', organizationId)
      .order('administered_date', { ascending: false });

    if (petId) {
      query = query.eq('pet_id', petId);
    }

    const [vaxRes, petRes] = await Promise.all([
      query,
      client.from('pets').select('id, name').eq('organization_id', organizationId),
    ]);

    if (vaxRes.error) throw vaxRes.error;
    const petMap = new Map(((petRes.data || []) as any[]).map((p) => [p.id, p.name]));

    return ((vaxRes.data || []) as any[]).map((v) => ({
      id: v.id,
      organization_id: v.organization_id,
      pet_id: v.pet_id,
      doctor_profile_id: v.doctor_profile_id || null,
      vaccine_name: v.vaccine_name,
      administered_date: v.administered_date,
      next_due_date: v.next_due_date || null,
      batch_number: v.batch_number || null,
      administered_by: v.administered_by || null,
      notes: v.notes || null,
      created_at: v.created_at || null,
      pet_name: petMap.get(v.pet_id) || 'Pet',
    }));
  },

  async recordVaccination(params: {
    organization_id: string;
    pet_id: string;
    vaccine_name: string;
    administered_date: string;
    next_due_date?: string | null;
    batch_number?: string | null;
    notes?: string | null;
  }): Promise<string> {
    const err = validateVaccinationInput(params);
    if (err) throw new Error(err);

    const client = getClient();
    const { data, error } = await client.rpc('record_vaccination', {
      p_organization_id: params.organization_id,
      p_pet_id: params.pet_id,
      p_vaccine_name: params.vaccine_name.trim(),
      p_administered_date: params.administered_date,
      p_next_due_date: params.next_due_date?.trim() || null,
      p_batch_number: params.batch_number?.trim() || null,
      p_notes: params.notes?.trim() || null,
    });
    if (error) throw error;
    return String(data);
  },

  async getPrescriptions(
    organizationId: string,
    petId?: string
  ): Promise<DoctorPrescription[]> {
    const client = getClient();
    let query = client
      .from('prescriptions')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });

    if (petId) {
      query = query.eq('pet_id', petId);
    }

    const [rxRes, petRes, docMap, clientMap] = await Promise.all([
      query,
      client
        .from('pets')
        .select('id, name, species, breed')
        .eq('organization_id', organizationId),
      fetchDoctorLookupMap(organizationId),
      fetchClinicClientMap(organizationId),
    ]);

    if (rxRes.error) throw rxRes.error;
    const rxList = (rxRes.data || []) as any[];
    if (rxList.length === 0) return [];

    const rxIds = rxList.map((r) => r.id);
    const { data: itemsData, error: itemsErr } = await client
      .from('prescription_items')
      .select('*')
      .eq('organization_id', organizationId)
      .in('prescription_id', rxIds);

    if (itemsErr) throw itemsErr;

    const itemsMap = new Map<string, ClientPrescriptionItem[]>();
    for (const item of (itemsData || []) as ClientPrescriptionItem[]) {
      const list = itemsMap.get(item.prescription_id) || [];
      list.push(item);
      itemsMap.set(item.prescription_id, list);
    }

    const petMap = new Map(((petRes.data || []) as any[]).map((p) => [p.id, p]));
    const clientByUser = new Map<string, string>();
    for (const cli of clientMap.values()) {
      if (cli.user_id) clientByUser.set(cli.user_id, cli.full_name);
    }

    return rxList.map((rx) => {
      const pet = petMap.get(rx.pet_id);
      const doc = docMap.get(rx.doctor_id);
      return {
        id: rx.id,
        organization_id: rx.organization_id,
        branch_id: rx.branch_id || null,
        consultation_id: rx.consultation_id || null,
        appointment_id: rx.appointment_id || null,
        pet_id: rx.pet_id,
        doctor_id: rx.doctor_id,
        client_id: rx.client_id,
        diagnosis: rx.diagnosis,
        instructions: rx.instructions || null,
        follow_up_date: rx.follow_up_date || null,
        status: rx.status === 'void' ? 'void' : 'issued',
        void_reason: rx.void_reason || null,
        voided_at: rx.voided_at || null,
        voided_by: rx.voided_by || null,
        created_at: rx.created_at,
        items: itemsMap.get(rx.id) || [],
        pet_name: pet?.name || 'Pet',
        pet_species: pet
          ? `${pet.species}${pet.breed ? ` · ${pet.breed}` : ''}`
          : undefined,
        doctor_name: doc?.full_name || 'Veterinary Practitioner',
        doctor_qualification: doc?.qualification || '',
        client_name: clientByUser.get(rx.client_id) || 'Registered Owner',
      };
    });
  },

  async issuePrescription(params: {
    organization_id: string;
    pet_id: string;
    consultation_id: string | null;
    appointment_id: string | null;
    diagnosis: string;
    instructions: string;
    follow_up_date: string | null;
    items: Array<{
      medicine_name: string;
      dosage: string;
      frequency: string;
      duration: string;
      instructions: string;
    }>;
  }): Promise<string> {
    const err = validatePrescriptionInput(params);
    if (err) throw new Error(err);

    const client = getClient();
    const { data, error } = await client.rpc('issue_prescription', {
      p_organization_id: params.organization_id,
      p_pet_id: params.pet_id,
      p_consultation_id: params.consultation_id || null,
      p_appointment_id: params.appointment_id || null,
      p_diagnosis: params.diagnosis.trim(),
      p_instructions: params.instructions.trim() || null,
      p_follow_up_date: params.follow_up_date || null,
      p_items: params.items.map((item) => ({
        medicine_name: item.medicine_name.trim(),
        dosage: item.dosage.trim(),
        frequency: item.frequency.trim(),
        duration: item.duration.trim(),
        instructions: item.instructions.trim() || null,
      })),
    });

    if (error) throw error;
    return String(data);
  },

  async voidPrescription(prescriptionId: string, reason: string): Promise<void> {
    if (!reason.trim() || reason.trim().length < 3) {
      throw new Error('Void reason (at least 3 characters) is required.');
    }
    const client = getClient();
    const { error } = await client.rpc('void_prescription', {
      p_prescription_id: prescriptionId,
      p_reason: reason.trim(),
    });
    if (error) throw error;
  },

  // ---------------------------------------------------------------------------
  // PRIVATE ATTACHMENTS & NOTIFICATIONS
  // ---------------------------------------------------------------------------

  async uploadClinicalAttachment(params: {
    organization_id: string;
    entity_type: 'pet' | 'medical_record' | 'consultation' | 'chat_message';
    entity_id: string;
    file: File;
  }): Promise<DoctorAttachment> {
    const fileError = validateAttachmentFile(params.file);
    if (fileError) throw new Error(fileError);

    const client = getClient();
    const objectPath = buildClinicalStoragePath(
      params.organization_id,
      params.entity_type,
      params.entity_id,
      params.file.name,
      createUuid()
    );

    const { error: uploadError } = await client.storage
      .from(CLINICAL_FILES_BUCKET)
      .upload(objectPath, params.file, {
        contentType: params.file.type,
        upsert: false,
      });

    if (uploadError) throw uploadError;

    const { data: attId, error: rpcError } = await client.rpc(
      'register_attachment',
      {
        p_organization_id: params.organization_id,
        p_entity_type: params.entity_type,
        p_entity_id: params.entity_id,
        p_object_path: objectPath,
        p_mime_type: params.file.type,
        p_byte_size: params.file.size,
        p_original_filename: params.file.name,
      }
    );

    if (rpcError) {
      await client.storage.from(CLINICAL_FILES_BUCKET).remove([objectPath]).catch(() => {});
      throw rpcError;
    }

    const { data: record, error: fetchError } = await client
      .from('attachments')
      .select('*')
      .eq('organization_id', params.organization_id)
      .eq('id', String(attId))
      .single();

    if (fetchError) throw fetchError;
    return record as DoctorAttachment;
  },

  async getAttachmentsForEntities(
    organizationId: string,
    entityType: DoctorAttachment['entity_type'],
    entityIds: string[]
  ): Promise<DoctorAttachment[]> {
    if (entityIds.length === 0) return [];
    const client = getClient();
    const { data, error } = await client
      .from('attachments')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('entity_type', entityType)
      .in('entity_id', entityIds)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []) as DoctorAttachment[];
  },

  async createSignedAttachmentUrl(
    objectPath: string,
    expiresInSeconds = 300
  ): Promise<string> {
    const client = getClient();
    const { data, error } = await client.storage
      .from(CLINICAL_FILES_BUCKET)
      .createSignedUrl(objectPath, expiresInSeconds);

    if (error) throw error;
    if (!data?.signedUrl) {
      throw new Error('Unable to generate secure signed URL.');
    }
    return data.signedUrl;
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
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []) as DoctorNotification[];
  },

  async markNotificationRead(notificationId: string, userId: string): Promise<void> {
    const client = getClient();
    const { error } = await client
      .from('notifications')
      .update({ is_read: true })
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
};
