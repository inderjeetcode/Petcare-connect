export * from './auth';

export type UserRole = 'client' | 'doctor' | 'admin';

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  avatar_url: string;
  created_at: string;
  updated_at: string;
}

export interface UserRoleRecord {
  id: string;
  user_id: string;
  role: UserRole;
  created_at: string;
}

export interface Pet {
  id: string;
  owner_id: string;
  name: string;
  species: 'Dog' | 'Cat' | 'Bird' | 'Rabbit' | 'Other';
  breed: string;
  date_of_birth: string;
  gender: 'Male' | 'Female' | 'Neutered Male' | 'Spayed Female';
  weight: number; // in kg
  color: string;
  avatar_url: string;
  allergies: string;
  medical_notes: string;
  created_at: string;
  updated_at: string;
}

export interface DoctorProfile {
  id: string;
  user_id: string;
  qualification: string;
  specialization: string;
  experience_years: number;
  consultation_fee: number;
  bio: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // joined from profile for convenience
  full_name?: string;
  email?: string;
  phone?: string;
  avatar_url?: string;
  rating?: number;
  total_reviews?: number;
}

export interface DoctorAvailability {
  id: string;
  doctor_id: string;
  day_of_week: string; // e.g. "Monday", "Tuesday", etc.
  start_time: string; // "09:00"
  end_time: string;   // "17:00"
  is_available: boolean;
}

export type ConsultationStatus = 'pending' | 'active' | 'completed' | 'expired' | 'rejected';

export interface Consultation {
  id: string;
  client_id: string;
  doctor_id: string;
  pet_id: string;
  consultation_reason: string;
  consultation_status: ConsultationStatus;
  activated_at: string | null;
  expires_at: string | null;
  completed_at: string | null;
  rejection_reason?: string | null;
  created_at: string;
  updated_at: string;
  
  // Enriched clinical details
  client_name?: string;
  doctor_name?: string;
  doctor_specialization?: string;
  pet_name?: string;
  pet_species?: string;
  pet_breed?: string;
  pet_avatar?: string;
  preferred_time?: string;
  attachment_url?: string;
}

export interface ConsultationPayment {
  id: string;
  consultation_id: string;
  amount: number;
  payment_status: 'pending' | 'completed' | 'failed' | 'refunded';
  gateway: 'razorpay' | 'stripe' | 'manual';
  transaction_id: string | null;
  paid_at: string | null;
  created_at: string;
}

export interface ChatConversation {
  id: string;
  consultation_id: string;
  client_id: string;
  doctor_id: string;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_name: string;
  sender_role: UserRole;
  message_type: 'text' | 'image' | 'file';
  message_content: string;
  attachment_url?: string | null;
  attachment_name?: string | null;
  read_at?: string | null;
  created_at: string;
}

export interface PrescriptionItem {
  id: string;
  prescription_id: string;
  medicine_name: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string;
}

export interface Prescription {
  id: string;
  consultation_id: string;
  pet_id: string;
  doctor_id: string;
  client_id: string;
  diagnosis: string;
  instructions: string;
  follow_up_date: string | null;
  created_at: string;
  
  // Enriched fields
  items: PrescriptionItem[];
  pet_name?: string;
  pet_species?: string;
  client_name?: string;
  doctor_name?: string;
  doctor_qualification?: string;
}

export interface MedicalRecord {
  id: string;
  pet_id: string;
  consultation_id: string | null;
  doctor_id: string | null;
  record_type: 'clinical_note' | 'lab_report' | 'vaccination' | 'surgery' | 'discharge';
  diagnosis: string;
  notes: string;
  attachment_url: string | null;
  attachment_name?: string | null;
  created_at: string;
  
  // Enriched fields
  doctor_name?: string;
  pet_name?: string;
}

export interface Vaccination {
  id: string;
  pet_id: string;
  vaccine_name: string;
  administered_date: string;
  next_due_date: string;
  notes: string;
  administered_by?: string;
}

export interface Notification {
  id: string;
  organization_id?: string | null;
  user_id: string;
  title: string;
  message: string;
  notification_type: string;
  is_read: boolean;
  created_at: string;
  link_url?: string | null;
}

export interface Review {
  id: string;
  consultation_id: string;
  client_id: string;
  doctor_id: string;
  rating: number;
  review_text: string;
  created_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string;
  user_name?: string;
  user_role?: string;
  action: string;
  entity_type: string;
  entity_id: string;
  created_at: string;
  details?: string;
}
