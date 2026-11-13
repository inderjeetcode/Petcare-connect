import { Branch, Organization } from './auth';

export type AppointmentStatus =
  | 'requested'
  | 'confirmed'
  | 'checked_in'
  | 'completed'
  | 'declined'
  | 'cancelled'
  | 'no_show';

export interface ClientPet {
  id: string;
  organization_id: string;
  owner_id: string;
  name: string;
  species: string;
  breed: string;
  date_of_birth: string | null;
  gender: string;
  weight: number;
  color: string | null;
  avatar_url: string | null;
  allergies: string | null;
  medical_notes: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClientAttachment {
  id: string;
  organization_id: string;
  entity_type: 'pet' | 'medical_record' | 'consultation' | 'chat_message' | 'application';
  entity_id: string;
  bucket_id: string;
  object_path: string;
  mime_type: string;
  byte_size: number;
  original_filename: string;
  uploaded_by: string;
  created_at: string;
}

export interface DoctorScheduleSummary {
  id: string;
  branch_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  slot_minutes: number;
  is_active: boolean;
}

export interface ClientDoctor {
  id: string;
  organization_id: string;
  user_id: string;
  full_name: string;
  qualification: string;
  specialization: string;
  experience_years: number;
  consultation_fee: number;
  bio: string;
  registration_number: string | null;
  avatar_url: string | null;
  is_active: boolean;
  branch_ids: string[];
  schedules: DoctorScheduleSummary[];
  rating: number | null;
  total_reviews: number;
}

export interface AvailableSlot {
  slot_start: string;
  slot_end: string;
}

export interface AppointmentStatusHistoryEntry {
  id: string;
  appointment_id: string;
  from_status: string | null;
  to_status: string;
  reason: string | null;
  changed_at: string;
}

export interface ClientAppointment {
  id: string;
  organization_id: string;
  branch_id: string;
  clinic_client_id: string;
  pet_id: string;
  doctor_profile_id: string;
  requested_start: string;
  requested_end: string;
  scheduled_range: string | null;
  status: AppointmentStatus;
  reason: string;
  decline_reason: string | null;
  cancellation_reason: string | null;
  confirmed_at: string | null;
  checked_in_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  pet_name?: string;
  pet_species?: string;
  doctor_name?: string;
  doctor_specialization?: string;
  branch_name?: string;
  branch_timezone?: string;
  history?: AppointmentStatusHistoryEntry[];
}

export interface ClientConsultation {
  id: string;
  organization_id: string;
  branch_id: string | null;
  clinic_client_id: string | null;
  appointment_id: string | null;
  client_id: string;
  doctor_id: string;
  pet_id: string;
  consultation_reason: string;
  consultation_status: 'pending' | 'active' | 'completed' | 'expired' | 'rejected';
  activated_at: string | null;
  expires_at: string | null;
  completed_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
  pet_name?: string;
  pet_species?: string;
  pet_breed?: string;
  doctor_name?: string;
  doctor_user_id?: string;
  doctor_specialization?: string;
  branch_name?: string;
  conversation_id?: string | null;
}

export interface ClientChatConversation {
  id: string;
  organization_id: string;
  consultation_id: string;
  client_id: string;
  doctor_id: string;
  created_at: string;
}

export interface ClientChatMessage {
  id: string;
  organization_id: string;
  conversation_id: string;
  sender_id: string;
  sender_name: string;
  sender_role: 'client' | 'doctor';
  message_type: 'text' | 'image' | 'file';
  message_content: string;
  attachment_url?: string | null;
  read_at: string | null;
  created_at: string;
  attachments: ClientAttachment[];
}

export interface ClientPrescriptionItem {
  id: string;
  prescription_id: string;
  medicine_name: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string | null;
}

export interface ClientPrescription {
  id: string;
  organization_id: string;
  branch_id: string | null;
  consultation_id: string | null;
  appointment_id: string | null;
  pet_id: string;
  doctor_id: string;
  client_id: string;
  diagnosis: string;
  instructions: string | null;
  follow_up_date: string | null;
  status: 'issued' | 'void';
  void_reason: string | null;
  voided_at: string | null;
  created_at: string;
  items: ClientPrescriptionItem[];
  pet_name?: string;
  pet_species?: string;
  doctor_name?: string;
  doctor_qualification?: string;
  client_name?: string;
}

export interface ClientMedicalRecord {
  id: string;
  organization_id: string;
  pet_id: string;
  consultation_id: string | null;
  doctor_id: string | null;
  amended_from_id: string | null;
  record_type: 'clinical_note' | 'lab_report' | 'vaccination' | 'surgery' | 'discharge';
  diagnosis: string;
  notes: string;
  created_at: string;
  pet_name?: string;
  doctor_name?: string;
  attachments: ClientAttachment[];
}

export interface ClientVaccination {
  id: string;
  organization_id: string;
  pet_id: string;
  doctor_profile_id: string | null;
  vaccine_name: string;
  administered_date: string;
  next_due_date: string | null;
  batch_number: string | null;
  administered_by: string | null;
  notes: string | null;
  pet_name?: string;
}

export interface ClientReview {
  id: string;
  organization_id: string;
  consultation_id: string;
  client_id: string;
  doctor_id: string;
  rating: number;
  review_text: string | null;
  created_at: string;
  doctor_name?: string;
  pet_name?: string;
}

export interface ClientNotification {
  id: string;
  organization_id: string | null;
  user_id: string;
  title: string;
  message: string;
  notification_type: string;
  is_read: boolean;
  link_url: string | null;
  created_at: string;
}

export interface ClientPaymentRecord {
  id: string;
  organization_id: string;
  consultation_id: string;
  amount: number;
  payment_status: 'pending' | 'completed' | 'failed' | 'refunded';
  gateway: string;
  transaction_id: string | null;
  paid_at: string | null;
  created_at: string;
  pet_name?: string;
  doctor_name?: string;
}

export interface ClientOrganizationOverview {
  organization: Organization;
  branches: Branch[];
}
