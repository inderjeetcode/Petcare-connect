import { isSupabaseConfigured, supabase } from '../config/supabaseClient';
import { Branch, Organization } from '../types/auth';
import {
  AppointmentStatusHistoryEntry,
  AvailableSlot,
  ClientAppointment,
  ClientAttachment,
  ClientChatConversation,
  ClientChatMessage,
  ClientConsultation,
  ClientDoctor,
  ClientMedicalRecord,
  ClientNotification,
  ClientOrganizationOverview,
  ClientPaymentRecord,
  ClientPet,
  ClientPrescription,
  ClientPrescriptionItem,
  ClientReview,
  ClientVaccination,
  DoctorScheduleSummary,
} from '../types/client';
import {
  assertTenantMatch,
  buildClinicalStoragePath,
  CLINICAL_FILES_BUCKET,
  validateAppointmentRequest,
  validateAttachmentFile,
  validatePetForm,
  validateReviewInput,
} from '../utils/clientPortalHelpers';

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

export const clientPortalService = {
  // ---------------------------------------------------------------------------
  // ORGANIZATION & BRANCH OVERVIEW
  // ---------------------------------------------------------------------------

  async getOrganizationOverview(
    organizationId: string
  ): Promise<ClientOrganizationOverview> {
    const client = getClient();
    const [orgRes, branchRes] = await Promise.all([
      client
        .from('organizations')
        .select('*')
        .eq('id', organizationId)
        .single(),
      client
        .from('branches')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .order('name', { ascending: true }),
    ]);

    if (orgRes.error) throw orgRes.error;
    if (branchRes.error) throw branchRes.error;

    return {
      organization: orgRes.data as Organization,
      branches: (branchRes.data || []) as Branch[],
    };
  },

  // ---------------------------------------------------------------------------
  // PET MANAGEMENT (RPC-BACKED & TENANT-ISOLATED)
  // ---------------------------------------------------------------------------

  async getPets(organizationId: string): Promise<ClientPet[]> {
    const client = getClient();
    const { data, error } = await client
      .from('pets')
      .select('*')
      .eq('organization_id', organizationId)
      .is('archived_at', null)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []) as ClientPet[];
  },

  async getPetById(organizationId: string, petId: string): Promise<ClientPet | null> {
    const client = getClient();
    const { data, error } = await client
      .from('pets')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('id', petId)
      .is('archived_at', null)
      .maybeSingle();

    if (error) throw error;
    if (data) {
      assertTenantMatch(data.organization_id, organizationId, 'Pet record');
    }
    return (data as ClientPet | null) || null;
  },

  async createPet(params: {
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
    const validationErr = validatePetForm(params);
    if (validationErr) throw new Error(validationErr);

    const client = getClient();
    const { data, error } = await client.rpc('create_pet', {
      p_organization_id: params.organization_id,
      p_clinic_client_id: params.clinic_client_id,
      p_name: params.name.trim(),
      p_species: params.species.trim(),
      p_breed: params.breed.trim(),
      p_gender: params.gender.trim(),
      p_weight: Number(params.weight),
      p_dob: params.date_of_birth?.trim() || null,
      p_color: params.color?.trim() || null,
      p_allergies: params.allergies?.trim() || null,
      p_medical_notes: params.medical_notes?.trim() || null,
    });

    if (error) throw error;
    return String(data);
  },

  async updatePet(
    organizationId: string,
    petId: string,
    updates: {
      name: string;
      species: string;
      breed: string;
      gender: string;
      weight: number;
      date_of_birth?: string | null;
      color?: string | null;
      allergies?: string | null;
      medical_notes?: string | null;
    }
  ): Promise<void> {
    const validationErr = validatePetForm(updates);
    if (validationErr) throw new Error(validationErr);

    const existing = await this.getPetById(organizationId, petId);
    if (!existing) {
      throw new Error('Pet record not found in active organization.');
    }

    const client = getClient();
    const { error } = await client.rpc('update_pet', {
      p_pet_id: petId,
      p_updates: {
        name: updates.name.trim(),
        species: updates.species.trim(),
        breed: updates.breed.trim(),
        gender: updates.gender.trim(),
        weight: Number(updates.weight),
        date_of_birth: updates.date_of_birth?.trim() || '',
        color: updates.color?.trim() || '',
        allergies: updates.allergies?.trim() || '',
        medical_notes: updates.medical_notes?.trim() || '',
      },
    });

    if (error) throw error;
  },

  async archivePet(petId: string, reason?: string): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('archive_pet', {
      p_pet_id: petId,
      p_reason: reason?.trim() || 'Archived by pet owner',
    });
    if (error) throw error;
  },

  // ---------------------------------------------------------------------------
  // PRIVATE CLINICAL ATTACHMENTS (STORAGE BUCKET + REGISTER_ATTACHMENT RPC)
  // ---------------------------------------------------------------------------

  async uploadClinicalAttachment(params: {
    organization_id: string;
    entity_type: 'pet' | 'consultation' | 'chat_message';
    entity_id: string;
    file: File;
  }): Promise<ClientAttachment> {
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
    return record as ClientAttachment;
  },

  async getAttachmentsForEntities(
    organizationId: string,
    entityType: ClientAttachment['entity_type'],
    entityIds: string[]
  ): Promise<ClientAttachment[]> {
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
    return (data || []) as ClientAttachment[];
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
      throw new Error('Unable to generate secure signed download URL.');
    }
    return data.signedUrl;
  },

  // ---------------------------------------------------------------------------
  // DOCTORS, BRANCHES, SCHEDULES & AVAILABLE SLOTS
  // ---------------------------------------------------------------------------

  async getDoctorsAndBranches(organizationId: string): Promise<{
    branches: Branch[];
    doctors: ClientDoctor[];
  }> {
    const client = getClient();
    const [branchRes, docRes, assignRes, schedRes, revRes] = await Promise.all([
      client
        .from('branches')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .order('name', { ascending: true }),
      client
        .from('doctor_profiles')
        .select(
          'id, organization_id, user_id, display_name, qualification, specialization, experience_years, consultation_fee, bio, registration_number, is_active, profile:profiles!doctor_profiles_user_id_fkey(full_name, avatar_url)'
        )
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .order('created_at', { ascending: true }),
      client
        .from('doctor_branch_assignments')
        .select('doctor_profile_id, branch_id, is_active')
        .eq('organization_id', organizationId)
        .eq('is_active', true),
      client
        .from('doctor_schedules')
        .select('id, branch_id, doctor_profile_id, weekday, start_time, end_time, slot_minutes, is_active')
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .order('weekday', { ascending: true })
        .order('start_time', { ascending: true }),
      client
        .from('reviews')
        .select('doctor_id, rating')
        .eq('organization_id', organizationId),
    ]);

    if (branchRes.error) throw branchRes.error;
    if (docRes.error) throw docRes.error;
    if (assignRes.error) throw assignRes.error;
    if (schedRes.error) throw schedRes.error;
    if (revRes.error) throw revRes.error;

    const branchMap = new Map<string, string[]>();
    for (const a of (assignRes.data || []) as any[]) {
      const list = branchMap.get(a.doctor_profile_id) || [];
      list.push(a.branch_id);
      branchMap.set(a.doctor_profile_id, list);
    }

    const schedMap = new Map<string, DoctorScheduleSummary[]>();
    for (const s of (schedRes.data || []) as any[]) {
      const list = schedMap.get(s.doctor_profile_id) || [];
      list.push({
        id: s.id,
        branch_id: s.branch_id,
        weekday: s.weekday,
        start_time: s.start_time,
        end_time: s.end_time,
        slot_minutes: s.slot_minutes,
        is_active: s.is_active,
      });
      schedMap.set(s.doctor_profile_id, list);
    }

    const ratingBuckets = new Map<string, { sum: number; count: number }>();
    for (const r of (revRes.data || []) as any[]) {
      const cur = ratingBuckets.get(r.doctor_id) || { sum: 0, count: 0 };
      cur.sum += Number(r.rating);
      cur.count += 1;
      ratingBuckets.set(r.doctor_id, cur);
    }

    const doctors: ClientDoctor[] = ((docRes.data || []) as any[]).map((d) => {
      const stats = ratingBuckets.get(d.id);
      return {
        id: d.id,
        organization_id: d.organization_id,
        user_id: d.user_id,
        full_name: d.display_name || d.profile?.full_name || 'Veterinary Doctor',
        qualification: d.qualification || '',
        specialization: d.specialization || '',
        experience_years: Number(d.experience_years || 0),
        consultation_fee: Number(d.consultation_fee || 0),
        bio: d.bio || '',
        registration_number: d.registration_number || null,
        avatar_url: d.profile?.avatar_url || null,
        is_active: Boolean(d.is_active),
        branch_ids: branchMap.get(d.id) || [],
        schedules: schedMap.get(d.id) || [],
        rating: stats ? Number((stats.sum / stats.count).toFixed(1)) : null,
        total_reviews: stats ? stats.count : 0,
      };
    });

    return {
      branches: (branchRes.data || []) as Branch[],
      doctors,
    };
  },

  async getAvailableSlots(params: {
    organization_id: string;
    branch_id: string;
    doctor_profile_id: string;
    date: string; // YYYY-MM-DD
  }): Promise<AvailableSlot[]> {
    const client = getClient();
    const { data, error } = await client.rpc('get_available_slots', {
      p_organization_id: params.organization_id,
      p_branch_id: params.branch_id,
      p_doctor_profile_id: params.doctor_profile_id,
      p_date: params.date,
    });

    if (error) throw error;
    return (data || []) as AvailableSlot[];
  },

  // ---------------------------------------------------------------------------
  // APPOINTMENTS (REQUESTS, HISTORY & CLIENT CANCELLATION)
  // ---------------------------------------------------------------------------

  async getAppointments(organizationId: string): Promise<ClientAppointment[]> {
    const client = getClient();
    const [apptRes, petList, docMap, branchRes, histRes] = await Promise.all([
      client
        .from('appointments')
        .select('*')
        .eq('organization_id', organizationId)
        .order('requested_start', { ascending: false }),
      this.getPets(organizationId),
      fetchDoctorLookupMap(organizationId),
      client
        .from('branches')
        .select('id, name, timezone')
        .eq('organization_id', organizationId),
      client
        .from('appointment_status_history')
        .select('id, appointment_id, from_status, to_status, reason, changed_at')
        .eq('organization_id', organizationId)
        .order('changed_at', { ascending: true }),
    ]);

    if (apptRes.error) throw apptRes.error;
    if (branchRes.error) throw branchRes.error;
    if (histRes.error) throw histRes.error;

    const petMap = new Map(petList.map((p) => [p.id, p]));
    const branchMap = new Map(
      ((branchRes.data || []) as any[]).map((b) => [b.id, b])
    );
    const histMap = new Map<string, AppointmentStatusHistoryEntry[]>();
    for (const h of (histRes.data || []) as AppointmentStatusHistoryEntry[]) {
      const list = histMap.get(h.appointment_id) || [];
      list.push(h);
      histMap.set(h.appointment_id, list);
    }

    return ((apptRes.data || []) as any[]).map((a) => {
      const pet = petMap.get(a.pet_id);
      const doc = docMap.get(a.doctor_profile_id);
      const branch = branchMap.get(a.branch_id);
      return {
        ...a,
        pet_name: pet?.name || 'Pet',
        pet_species: pet?.species || '',
        doctor_name: doc?.full_name || 'Clinic Veterinarian',
        doctor_specialization: doc?.specialization || '',
        branch_name: branch?.name || 'Clinic Branch',
        branch_timezone: branch?.timezone || undefined,
        history: histMap.get(a.id) || [],
      } as ClientAppointment;
    });
  },

  async requestAppointment(params: {
    organization_id: string;
    branch_id: string;
    pet_id: string;
    doctor_profile_id: string;
    requested_start: string;
    requested_end: string;
    reason: string;
  }): Promise<string> {
    const err = validateAppointmentRequest(params);
    if (err) throw new Error(err);

    const client = getClient();
    const { data, error } = await client.rpc('request_appointment', {
      p_organization_id: params.organization_id,
      p_branch_id: params.branch_id,
      p_pet_id: params.pet_id,
      p_doctor_profile_id: params.doctor_profile_id,
      p_requested_start: params.requested_start,
      p_requested_end: params.requested_end,
      p_reason: params.reason.trim(),
    });

    if (error) throw error;
    return String(data);
  },

  async cancelAppointment(appointmentId: string, reason?: string): Promise<void> {
    const client = getClient();
    const { error } = await client.rpc('cancel_appointment', {
      p_appointment_id: appointmentId,
      p_reason: reason?.trim() || 'Cancelled by pet owner',
    });
    if (error) throw error;
  },

  // ---------------------------------------------------------------------------
  // CONSULTATIONS & 7-DAY CHAT
  // ---------------------------------------------------------------------------

  async getConsultations(organizationId: string): Promise<ClientConsultation[]> {
    const client = getClient();
    const [consRes, petList, docMap, branchRes, convRes] = await Promise.all([
      client
        .from('consultations')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false }),
      this.getPets(organizationId),
      fetchDoctorLookupMap(organizationId),
      client
        .from('branches')
        .select('id, name')
        .eq('organization_id', organizationId),
      client
        .from('chat_conversations')
        .select('id, consultation_id')
        .eq('organization_id', organizationId),
    ]);

    if (consRes.error) throw consRes.error;
    if (branchRes.error) throw branchRes.error;
    if (convRes.error) throw convRes.error;

    const petMap = new Map(petList.map((p) => [p.id, p]));
    const branchMap = new Map(
      ((branchRes.data || []) as any[]).map((b) => [b.id, b.name])
    );
    const convMap = new Map(
      ((convRes.data || []) as any[]).map((cv) => [cv.consultation_id, cv.id])
    );

    return ((consRes.data || []) as any[]).map((c) => {
      const pet = petMap.get(c.pet_id);
      const doc = docMap.get(c.doctor_id);
      return {
        ...c,
        pet_name: pet?.name || 'Pet',
        pet_species: pet?.species || '',
        pet_breed: pet?.breed || '',
        doctor_name: doc?.full_name || 'Clinic Veterinarian',
        doctor_user_id: doc?.user_id,
        doctor_specialization: doc?.specialization || '',
        branch_name: c.branch_id ? branchMap.get(c.branch_id) || undefined : undefined,
        conversation_id: convMap.get(c.id) || null,
      } as ClientConsultation;
    });
  },

  async getConversationByConsultation(
    organizationId: string,
    consultationId: string
  ): Promise<ClientChatConversation | null> {
    const client = getClient();
    const { data, error } = await client
      .from('chat_conversations')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('consultation_id', consultationId)
      .maybeSingle();

    if (error) throw error;
    return (data as ClientChatConversation | null) || null;
  },

  async getConversationMessages(
    organizationId: string,
    conversationId: string,
    consultation: ClientConsultation
  ): Promise<ClientChatMessage[]> {
    const client = getClient();
    const { data: msgRows, error: msgErr } = await client
      .from('chat_messages')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    if (msgErr) throw msgErr;
    const messages = (msgRows || []) as any[];
    if (messages.length === 0) return [];

    const msgIds = messages.map((m) => m.id);
    const { data: links, error: linkErr } = await client
      .from('message_attachments')
      .select('message_id, attachment_id')
      .eq('organization_id', organizationId)
      .in('message_id', msgIds);

    if (linkErr) throw linkErr;

    const attIds = Array.from(
      new Set(((links || []) as any[]).map((l) => l.attachment_id))
    );

    const attMap = new Map<string, ClientAttachment>();
    if (attIds.length > 0) {
      const { data: atts, error: attErr } = await client
        .from('attachments')
        .select('*')
        .eq('organization_id', organizationId)
        .in('id', attIds);
      if (attErr) throw attErr;
      for (const a of (atts || []) as ClientAttachment[]) {
        attMap.set(a.id, a);
      }
    }

    const msgAttsMap = new Map<string, ClientAttachment[]>();
    for (const l of (links || []) as any[]) {
      const att = attMap.get(l.attachment_id);
      if (att) {
        const list = msgAttsMap.get(l.message_id) || [];
        list.push(att);
        msgAttsMap.set(l.message_id, list);
      }
    }

    return messages.map((m) => {
      const isDoctor =
        consultation.doctor_user_id && m.sender_id === consultation.doctor_user_id;
      return {
        id: m.id,
        organization_id: m.organization_id,
        conversation_id: m.conversation_id,
        sender_id: m.sender_id,
        sender_role: isDoctor ? 'doctor' : 'client',
        sender_name: isDoctor
          ? consultation.doctor_name || 'Veterinary Doctor'
          : 'You (Pet Owner)',
        message_type: m.message_type,
        message_content: m.message_content,
        attachment_url: m.attachment_url,
        read_at: m.read_at,
        created_at: m.created_at,
        attachments: msgAttsMap.get(m.id) || [],
      };
    });
  },

  async sendChatMessage(params: {
    organization_id: string;
    consultation_id: string;
    conversation_id: string;
    content: string;
    file?: File | null;
  }): Promise<string> {
    const trimmed = params.content.trim();
    if (!trimmed && !params.file) {
      throw new Error('Please enter a message or attach a file.');
    }

    const attachmentIds: string[] = [];
    let messageType: 'text' | 'image' | 'file' = 'text';

    if (params.file) {
      const uploaded = await this.uploadClinicalAttachment({
        organization_id: params.organization_id,
        entity_type: 'chat_message',
        entity_id: params.consultation_id,
        file: params.file,
      });
      attachmentIds.push(uploaded.id);
      messageType = params.file.type.startsWith('image/') ? 'image' : 'file';
    }

    const finalContent =
      trimmed || (params.file ? `Attached file: ${params.file.name}` : '');

    const client = getClient();
    const { data, error } = await client.rpc('send_chat_message', {
      p_conversation_id: params.conversation_id,
      p_message_type: messageType,
      p_content: finalContent,
      p_attachment_ids: attachmentIds,
    });

    if (error) throw error;
    return String((data as any)?.id || '');
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
      .channel(`client-chat-${conversationId}`)
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
  // MEDICAL RECORDS, VACCINATIONS & PRESCRIPTIONS (IMMUTABLE READ-ONLY)
  // ---------------------------------------------------------------------------

  async getMedicalRecords(
    organizationId: string,
    petId?: string
  ): Promise<ClientMedicalRecord[]> {
    const client = getClient();
    let query = client
      .from('medical_records')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });

    if (petId) {
      query = query.eq('pet_id', petId);
    }

    const [recRes, petList, docMap] = await Promise.all([
      query,
      this.getPets(organizationId),
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

    const petMap = new Map(petList.map((p) => [p.id, p]));
    const attByRecord = new Map<string, ClientAttachment[]>();
    for (const a of attachments) {
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
      amended_from_id: r.amended_from_id || null,
      record_type: r.record_type,
      diagnosis: r.diagnosis,
      notes: r.notes,
      created_at: r.created_at,
      pet_name: petMap.get(r.pet_id)?.name || 'Pet',
      doctor_name: r.doctor_id
        ? docMap.get(r.doctor_id)?.full_name || 'Clinic Veterinarian'
        : 'Clinic Veterinarian',
      attachments: attByRecord.get(r.id) || [],
    }));
  },

  async getVaccinations(
    organizationId: string,
    petId?: string
  ): Promise<ClientVaccination[]> {
    const client = getClient();
    let query = client
      .from('vaccinations')
      .select('*')
      .eq('organization_id', organizationId)
      .order('administered_date', { ascending: false });

    if (petId) {
      query = query.eq('pet_id', petId);
    }

    const [vaxRes, petList] = await Promise.all([query, this.getPets(organizationId)]);
    if (vaxRes.error) throw vaxRes.error;

    const petMap = new Map(petList.map((p) => [p.id, p]));
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
      pet_name: petMap.get(v.pet_id)?.name || 'Pet',
    }));
  },

  async getPrescriptions(
    organizationId: string,
    petId?: string,
    clientName?: string
  ): Promise<ClientPrescription[]> {
    const client = getClient();
    let query = client
      .from('prescriptions')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });

    if (petId) {
      query = query.eq('pet_id', petId);
    }

    const [rxRes, petList, docMap] = await Promise.all([
      query,
      this.getPets(organizationId),
      fetchDoctorLookupMap(organizationId),
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

    const petMap = new Map(petList.map((p) => [p.id, p]));

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
        created_at: rx.created_at,
        items: itemsMap.get(rx.id) || [],
        pet_name: pet?.name || 'Pet',
        pet_species: pet ? `${pet.species}${pet.breed ? ` · ${pet.breed}` : ''}` : undefined,
        doctor_name: doc?.full_name || 'Veterinary Practitioner',
        doctor_qualification: doc?.qualification || '',
        client_name: clientName || undefined,
      };
    });
  },

  // ---------------------------------------------------------------------------
  // REVIEWS & CONSULTATION FEEDBACK
  // ---------------------------------------------------------------------------

  async getMyReviews(
    organizationId: string,
    userId: string
  ): Promise<ClientReview[]> {
    const client = getClient();
    const [revRes, docMap, consList] = await Promise.all([
      client
        .from('reviews')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('client_id', userId)
        .order('created_at', { ascending: false }),
      fetchDoctorLookupMap(organizationId),
      this.getConsultations(organizationId),
    ]);

    if (revRes.error) throw revRes.error;
    const consMap = new Map(consList.map((c) => [c.id, c]));

    return ((revRes.data || []) as any[]).map((r) => {
      const cons = consMap.get(r.consultation_id);
      const doc = docMap.get(r.doctor_id);
      return {
        id: r.id,
        organization_id: r.organization_id,
        consultation_id: r.consultation_id,
        client_id: r.client_id,
        doctor_id: r.doctor_id,
        rating: Number(r.rating),
        review_text: r.review_text || null,
        created_at: r.created_at,
        doctor_name: doc?.full_name || cons?.doctor_name || 'Veterinary Doctor',
        pet_name: cons?.pet_name || undefined,
      };
    });
  },

  async submitReview(
    consultationId: string,
    rating: number,
    reviewText: string
  ): Promise<string> {
    const err = validateReviewInput(rating, reviewText);
    if (err) throw new Error(err);

    const client = getClient();
    const { data, error } = await client.rpc('submit_review', {
      p_consultation_id: consultationId,
      p_rating: rating,
      p_review_text: reviewText.trim(),
    });
    if (error) throw error;
    return String(data);
  },

  // ---------------------------------------------------------------------------
  // NOTIFICATIONS & PAYMENTS
  // ---------------------------------------------------------------------------

  async getNotifications(
    organizationId: string,
    userId: string
  ): Promise<ClientNotification[]> {
    const client = getClient();
    const { data, error } = await client
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .or(`organization_id.eq.${organizationId},organization_id.is.null`)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []) as ClientNotification[];
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

  async getPayments(organizationId: string): Promise<ClientPaymentRecord[]> {
    const client = getClient();
    const [payRes, consList] = await Promise.all([
      client
        .from('consultation_payments')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false }),
      this.getConsultations(organizationId),
    ]);

    if (payRes.error) throw payRes.error;
    const consMap = new Map(consList.map((c) => [c.id, c]));

    return ((payRes.data || []) as any[]).map((p) => {
      const cons = consMap.get(p.consultation_id);
      return {
        id: p.id,
        organization_id: p.organization_id,
        consultation_id: p.consultation_id,
        amount: Number(p.amount || 0),
        payment_status: p.payment_status,
        gateway: p.gateway,
        transaction_id: p.transaction_id || null,
        paid_at: p.paid_at || null,
        created_at: p.created_at,
        pet_name: cons?.pet_name,
        doctor_name: cons?.doctor_name,
      };
    });
  },
};
