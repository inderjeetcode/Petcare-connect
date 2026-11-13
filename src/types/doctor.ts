import { Branch, DoctorGovernanceRecord, Organization } from './auth';
import {
  AppointmentStatus,
  AppointmentStatusHistoryEntry,
  AvailableSlot,
  ClientAttachment,
  ClientChatConversation,
  ClientChatMessage,
  ClientMedicalRecord,
  ClientNotification,
  ClientPet,
  ClientPrescription,
  ClientVaccination,
  DoctorScheduleSummary,
} from './client';

export type DoctorAttachment = ClientAttachment;
export type DoctorChatConversation = ClientChatConversation;
export type DoctorChatMessage = ClientChatMessage;
export type DoctorNotification = ClientNotification;
export type DoctorAvailableSlot = AvailableSlot;
export type DoctorSlotSummary = DoctorScheduleSummary;

export interface DoctorBranchAssignment {
  id: string;
  organization_id: string;
  doctor_profile_id: string;
  branch_id: string;
  is_active: boolean;
  effective_from: string;
  effective_to: string | null;
  branch?: Branch | null;
}

export interface DoctorScheduleException {
  id: string;
  organization_id: string;
  branch_id: string | null;
  doctor_profile_id: string;
  start_at: string;
  end_at: string;
  exception_type: 'leave' | 'holiday' | 'clinic_closure' | 'extra_availability';
  reason: string | null;
  created_by: string | null;
  created_at: string;
  branch_name?: string;
}

export interface DoctorDayScheduleForm {
  weekday: number; // 1..7 ISO weekday
  is_available: boolean;
  start_time: string; // HH:MM
  end_time: string; // HH:MM
  has_break: boolean;
  break_start: string; // HH:MM
  break_end: string; // HH:MM
  slot_minutes: number;
}

export interface DoctorAppointment {
  id: string;
  organization_id: string;
  branch_id: string;
  clinic_client_id: string;
  pet_id: string;
  doctor_profile_id: string;
  service_id?: string | null;
  service_name?: string | null;
  service_duration_minutes?: number | null;
  requested_start: string;
  requested_end: string;
  scheduled_range: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
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
  pet_breed?: string;
  client_name?: string;
  client_phone?: string | null;
  client_email?: string | null;
  doctor_name?: string;
  branch_name?: string;
  branch_timezone?: string;
  consultation_id?: string | null;
  consultation_status?: 'pending' | 'active' | 'completed' | 'expired' | 'rejected' | null;
  history?: AppointmentStatusHistoryEntry[];
}

export interface DoctorConsultation {
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
  clinical_notes: string | null;
  follow_up_date: string | null;
  activated_at: string | null;
  expires_at: string | null;
  completed_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
  pet_name?: string;
  pet_species?: string;
  pet_breed?: string;
  client_name?: string;
  doctor_name?: string;
  doctor_user_id?: string | null;
  doctor_qualification?: string;
  doctor_specialization?: string;
  branch_name?: string;
  conversation_id?: string | null;
  appointment_status?: AppointmentStatus | null;
}

export interface DoctorPatientDirectoryItem extends ClientPet {
  guardian_names: string[];
  guardian_phones: string[];
  guardian_emails: string[];
  consultation_count: number;
  last_visit_at: string | null;
}

export interface DoctorPrescription extends ClientPrescription {
  appointment_id: string | null;
  voided_by: string | null;
}

export interface DoctorMedicalRecord extends ClientMedicalRecord {
  created_by: string | null;
}

export interface DoctorVaccination extends ClientVaccination {
  created_at: string | null;
}

export interface DoctorWorkspaceOverview {
  organization: Organization;
  doctor: DoctorGovernanceRecord;
  branches: Branch[];
  assignments: DoctorBranchAssignment[];
}
