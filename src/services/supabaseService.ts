/**
 * Supabase Data Persistence Service
 * Real PostgreSQL database operations for PET CONNECT.
 * When Supabase is configured and connected, data reads and writes occur directly
 * through Supabase PostgreSQL tables and SECURITY DEFINER RPCs.
 */

import { supabase, isSupabaseConfigured } from '../config/supabaseClient';
import {
  Profile,
  Pet,
  DoctorProfile,
  DoctorAvailability,
  Consultation,
  ChatMessage,
  Prescription,
  PrescriptionItem,
  MedicalRecord,
  Vaccination,
  Notification,
  Review,
  AuditLog,
} from '../types';

export interface TableVerificationReport {
  tableName: string;
  exists: boolean;
  accessible: boolean;
  rowCount?: number;
  error?: string;
}

export const supabaseService = {
  /**
   * Introspect and verify all 16 tables against the live Supabase database
   */
  async verifyAllTables(): Promise<TableVerificationReport[]> {
    if (!isSupabaseConfigured || !supabase) {
      return [];
    }

    const tableNames = [
      'profiles',
      'user_roles',
      'pets',
      'doctor_profiles',
      'doctor_availability',
      'consultations',
      'consultation_payments',
      'chat_conversations',
      'chat_messages',
      'prescriptions',
      'prescription_items',
      'medical_records',
      'vaccinations',
      'notifications',
      'reviews',
      'audit_logs',
    ];

    const results: TableVerificationReport[] = [];

    for (const name of tableNames) {
      try {
        const { count, error } = await supabase
          .from(name)
          .select('*', { count: 'exact', head: true });

        if (error) {
          results.push({
            tableName: name,
            exists: error.code !== '42P01', // 42P01 is table does not exist
            accessible: false,
            error: error.message,
          });
        } else {
          results.push({
            tableName: name,
            exists: true,
            accessible: true,
            rowCount: count || 0,
          });
        }
      } catch (err: any) {
        results.push({
          tableName: name,
          exists: false,
          accessible: false,
          error: err?.message || 'Query failed',
        });
      }
    }

    return results;
  },

  // ---------------------------------------------------------------------------
  // 1. PROFILES
  // ---------------------------------------------------------------------------
  async getProfiles(): Promise<Profile[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    const { data, error } = await supabase.from('profiles').select('*');
    if (error) throw error;
    return (data || []) as Profile[];
  },

  async updateProfile(id: string, updates: Partial<Profile>): Promise<Profile> {
    if (!isSupabaseConfigured || !supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data as Profile;
  },

  // ---------------------------------------------------------------------------
  // 2. PETS
  // ---------------------------------------------------------------------------
  async getPets(ownerId?: string): Promise<Pet[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    let query = supabase.from('pets').select('*').order('created_at', { ascending: false });
    if (ownerId) {
      query = query.eq('owner_id', ownerId);
    }
    const { data, error } = await query;
    if (error) throw error;
    return (data || []) as Pet[];
  },

  async createPet(pet: Omit<Pet, 'id' | 'created_at' | 'updated_at'>): Promise<Pet> {
    if (!isSupabaseConfigured || !supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('pets')
      .insert(pet)
      .select()
      .single();
    if (error) throw error;
    return data as Pet;
  },

  async updatePet(id: string, updates: Partial<Pet>): Promise<Pet> {
    if (!isSupabaseConfigured || !supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('pets')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data as Pet;
  },

  async deletePet(id: string): Promise<void> {
    if (!isSupabaseConfigured || !supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.from('pets').delete().eq('id', id);
    if (error) throw error;
  },

  // ---------------------------------------------------------------------------
  // 3. DOCTORS & AVAILABILITY
  // ---------------------------------------------------------------------------
  async getDoctors(): Promise<DoctorProfile[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    // Join with profiles for full name and avatar
    const { data, error } = await supabase
      .from('doctor_profiles')
      .select(`
        *,
        profiles:user_id (
          full_name,
          email,
          phone,
          avatar_url
        )
      `)
      .eq('is_active', true);

    if (error) throw error;

    return (data || []).map((row: any) => ({
      ...row,
      full_name: row.profiles?.full_name || 'Veterinary Doctor',
      email: row.profiles?.email || '',
      phone: row.profiles?.phone || '',
      avatar_url: row.profiles?.avatar_url || '',
    })) as DoctorProfile[];
  },

  async getDoctorAvailability(doctorId: string): Promise<DoctorAvailability[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    const { data, error } = await supabase
      .from('doctor_availability')
      .select('*')
      .eq('doctor_id', doctorId)
      .eq('is_available', true);
    if (error) throw error;
    return (data || []) as DoctorAvailability[];
  },

  // ---------------------------------------------------------------------------
  // 4. CONSULTATIONS
  // ---------------------------------------------------------------------------
  async getConsultations(): Promise<Consultation[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    const { data, error } = await supabase
      .from('consultations')
      .select(`
        *,
        client:client_id (full_name),
        doctor:doctor_id (
          qualification,
          specialization,
          profiles:user_id (full_name)
        ),
        pet:pet_id (name, species, breed, avatar_url)
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return (data || []).map((row: any) => ({
      ...row,
      client_name: row.client?.full_name || 'Pet Owner',
      doctor_name: row.doctor?.profiles?.full_name || 'Dr. Veterinary',
      doctor_specialization: row.doctor?.specialization || 'General Practice',
      pet_name: row.pet?.name || 'Pet',
      pet_species: row.pet?.species || 'Animal',
      pet_breed: row.pet?.breed || '',
      pet_avatar: row.pet?.avatar_url,
    })) as Consultation[];
  },

  async createConsultation(consultation: {
    client_id: string;
    doctor_id: string;
    pet_id: string;
    consultation_reason: string;
    preferred_time?: string;
    attachment_url?: string;
  }): Promise<Consultation> {
    if (!isSupabaseConfigured || !supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('consultations')
      .insert({
        ...consultation,
        consultation_status: 'pending',
      })
      .select()
      .single();

    if (error) throw error;
    return data as Consultation;
  },

  /**
   * Activate Consultation using the hardened PostgreSQL SECURITY DEFINER procedure.
   * Atomically locks row, verifies caller authorization, sets exact 7-day expiry,
   * creates 1 chat_conversation, and logs audit record.
   * STRICT SECURITY POLICY: Direct table fallbacks are forbidden.
   */
  async activateConsultationRPC(consultationId: string): Promise<Consultation> {
    if (!isSupabaseConfigured || !supabase) throw new Error('Supabase is not configured.');

    const { data, error } = await supabase.rpc('activate_consultation', {
      p_consultation_id: consultationId,
    });

    if (error) {
      if (error.code === 'PGRST202') {
        throw new Error(
          'Database Stored Procedure "activate_consultation" is not registered in the Supabase schema cache. Run /supabase/migrations/002_activate_consultation_rpc.sql in the Supabase SQL Editor to enable production consultation activation.'
        );
      }
      throw new Error(`Database activation failed: ${error.message} (Code: ${error.code || 'UNKNOWN'})`);
    }

    if (!data) {
      throw new Error('Consultation activation procedure executed but returned no data.');
    }

    return data as Consultation;
  },

  /**
   * Introspect remote activate_consultation RPC deployment status
   */
  async checkRPCDeployment(): Promise<{
    deployed: boolean;
    anonBlocked: boolean;
    message: string;
    code?: string;
  }> {
    if (!isSupabaseConfigured || !supabase) {
      return { deployed: false, anonBlocked: false, message: 'Supabase is not configured' };
    }

    try {
      // Call with dummy UUID to test function existence and anon permission
      const { error } = await supabase.rpc('activate_consultation', {
        p_consultation_id: '00000000-0000-0000-0000-000000000000',
      });

      if (!error) {
        return {
          deployed: true,
          anonBlocked: false,
          message: 'RPC executed without error (unexpected for dummy UUID)',
        };
      }

      if (error.code === '42501') {
        return {
          deployed: true,
          anonBlocked: true,
          message: 'Verified: Procedure exists in remote PostgreSQL and anon access is strictly denied (42501)',
          code: error.code,
        };
      }

      if (error.code === 'PGRST202') {
        return {
          deployed: false,
          anonBlocked: false,
          message: 'Procedure not found in schema cache (PGRST202). Migration required.',
          code: error.code,
        };
      }

      if (error.code === '28000') {
        return {
          deployed: true,
          anonBlocked: true,
          message: 'Verified: Procedure enforces caller authentication check (28000)',
          code: error.code,
        };
      }

      return {
        deployed: true,
        anonBlocked: true,
        message: `Procedure returned: ${error.message} (Code: ${error.code})`,
        code: error.code,
      };
    } catch (err: any) {
      return {
        deployed: false,
        anonBlocked: false,
        message: err?.message || 'Failed to inspect RPC',
      };
    }
  },

  async updateConsultationStatus(
    id: string,
    status: Consultation['consultation_status'],
    reason?: string
  ): Promise<Consultation> {
    if (!isSupabaseConfigured || !supabase) throw new Error('Supabase not configured');
    const updatePayload: any = {
      consultation_status: status,
      updated_at: new Date().toISOString(),
    };
    if (status === 'completed') {
      updatePayload.completed_at = new Date().toISOString();
    }
    if (status === 'rejected' && reason) {
      updatePayload.rejection_reason = reason;
    }

    const { data, error } = await supabase
      .from('consultations')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data as Consultation;
  },

  // ---------------------------------------------------------------------------
  // 5. CHAT CONVERSATIONS & MESSAGES
  // ---------------------------------------------------------------------------
  async getChatConversation(consultationId: string) {
    if (!isSupabaseConfigured || !supabase) return null;
    const { data, error } = await supabase
      .from('chat_conversations')
      .select('*')
      .eq('consultation_id', consultationId)
      .maybeSingle();

    if (error) throw error;
    return data;
  },

  async getChatMessages(consultationId: string): Promise<ChatMessage[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    
    // First get conversation
    const conv = await this.getChatConversation(consultationId);
    if (!conv) return [];

    const { data, error } = await supabase
      .from('chat_messages')
      .select(`
        *,
        sender:sender_id (full_name)
      `)
      .eq('conversation_id', conv.id)
      .order('created_at', { ascending: true });

    if (error) throw error;

    return (data || []).map((msg: any) => ({
      ...msg,
      sender_name: msg.sender?.full_name || 'Participant',
    })) as ChatMessage[];
  },

  async sendChatMessage(params: {
    consultationId: string;
    senderId: string;
    senderRole: 'client' | 'doctor';
    content: string;
    attachmentUrl?: string;
  }): Promise<ChatMessage> {
    if (!isSupabaseConfigured || !supabase) throw new Error('Supabase not configured');

    const conv = await this.getChatConversation(params.consultationId);
    if (!conv) throw new Error('Chat conversation does not exist for this consultation');

    const { data, error } = await supabase
      .from('chat_messages')
      .insert({
        conversation_id: conv.id,
        sender_id: params.senderId,
        message_type: params.attachmentUrl ? 'image' : 'text',
        message_content: params.content,
        attachment_url: params.attachmentUrl,
      })
      .select()
      .single();

    if (error) throw error;
    return data as ChatMessage;
  },

  /**
   * Subscribe to real-time chat messages for a consultation
   */
  subscribeToChatMessages(
    consultationId: string,
    onMessage: (message: ChatMessage) => void
  ) {
    if (!isSupabaseConfigured || !supabase) {
      return { unsubscribe: () => {} };
    }

    const channel = supabase
      .channel(`chat-${consultationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
        },
        async (payload) => {
          // Verify conversation matches
          const conv = await this.getChatConversation(consultationId);
          if (conv && payload.new.conversation_id === conv.id) {
            onMessage(payload.new as ChatMessage);
          }
        }
      )
      .subscribe();

    return {
      unsubscribe: () => {
        if (supabase) {
          supabase.removeChannel(channel);
        }
      },
    };
  },

  // ---------------------------------------------------------------------------
  // 6. PRESCRIPTIONS & MEDICAL RECORDS
  // ---------------------------------------------------------------------------
  async getPrescriptions(): Promise<Prescription[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    const { data, error } = await supabase
      .from('prescriptions')
      .select(`
        *,
        items:prescription_items (*),
        doctor:doctor_id (profiles:user_id (full_name)),
        client:client_id (full_name),
        pet:pet_id (name)
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return (data || []).map((row: any) => ({
      ...row,
      doctor_name: row.doctor?.profiles?.full_name || 'Attending Doctor',
      client_name: row.client?.full_name || 'Pet Owner',
      pet_name: row.pet?.name || 'Pet',
      items: row.items || [],
    })) as Prescription[];
  },

  async createPrescription(
    prescription: Omit<Prescription, 'id' | 'created_at' | 'items'>,
    items: Omit<PrescriptionItem, 'id' | 'prescription_id'>[]
  ): Promise<Prescription> {
    if (!isSupabaseConfigured || !supabase) throw new Error('Supabase not configured');

    const { data: rx, error: rxError } = await supabase
      .from('prescriptions')
      .insert(prescription)
      .select()
      .single();

    if (rxError) throw rxError;

    if (items.length > 0) {
      const itemsToInsert = items.map((it) => ({
        ...it,
        prescription_id: rx.id,
      }));
      const { error: itemsError } = await supabase
        .from('prescription_items')
        .insert(itemsToInsert);
      if (itemsError) throw itemsError;
    }

    return { ...rx, items } as Prescription;
  },

  async getMedicalRecords(petId?: string): Promise<MedicalRecord[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    let query = supabase.from('medical_records').select('*').order('created_at', { ascending: false });
    if (petId) {
      query = query.eq('pet_id', petId);
    }
    const { data, error } = await query;
    if (error) throw error;
    return (data || []) as MedicalRecord[];
  },

  async createMedicalRecord(record: Omit<MedicalRecord, 'id' | 'created_at'>): Promise<MedicalRecord> {
    if (!isSupabaseConfigured || !supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('medical_records')
      .insert(record)
      .select()
      .single();
    if (error) throw error;
    return data as MedicalRecord;
  },

  async getVaccinations(petId?: string): Promise<Vaccination[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    let query = supabase.from('vaccinations').select('*').order('administered_date', { ascending: false });
    if (petId) {
      query = query.eq('pet_id', petId);
    }
    const { data, error } = await query;
    if (error) throw error;
    return (data || []) as Vaccination[];
  },

  async createVaccination(vax: Omit<Vaccination, 'id'>): Promise<Vaccination> {
    if (!isSupabaseConfigured || !supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('vaccinations')
      .insert(vax)
      .select()
      .single();
    if (error) throw error;
    return data as Vaccination;
  },

  // ---------------------------------------------------------------------------
  // 7. NOTIFICATIONS & AUDIT LOGS
  // ---------------------------------------------------------------------------
  async getNotifications(userId: string): Promise<Notification[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []) as Notification[];
  },

  async markNotificationRead(id: string): Promise<void> {
    if (!isSupabaseConfigured || !supabase) return;
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', id);
    if (error) throw error;
  },

  async getAuditLogs(): Promise<AuditLog[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    const { data, error } = await supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []) as AuditLog[];
  },
};
