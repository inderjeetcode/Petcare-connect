import {
  Branch,
  ClinicClientRecord,
  DoctorGovernanceRecord,
  Organization,
  OrganizationMemberView,
  StaffInvitationRecord,
} from './auth';
import {
  ClientMedicalRecord,
  ClientPet,
  ClientPrescription,
} from './client';
import {
  DoctorAppointment,
  DoctorConsultation,
  DoctorScheduleException,
  DoctorSlotSummary,
} from './doctor';

export type ClinicServiceCategory =
  | 'consultation'
  | 'vaccination'
  | 'diagnostics'
  | 'surgery'
  | 'dental'
  | 'preventive'
  | 'emergency'
  | 'follow_up';

export interface ClinicServiceItem {
  id: string;
  organization_id: string;
  branch_id: string | null;
  branch_name?: string | null;
  name: string;
  code: string;
  category: ClinicServiceCategory;
  description: string | null;
  duration_minutes: number;
  price: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AdminPetGuardianLink {
  id: string;
  pet_id: string;
  clinic_client_id: string;
  client_name: string;
  client_email: string | null;
  client_phone: string | null;
  client_status: string;
  relationship: string;
  is_primary: boolean;
}

export interface AdminPetDirectoryItem extends ClientPet {
  guardians: AdminPetGuardianLink[];
  appointment_count: number;
  consultation_count: number;
}

export interface AdminAuditLogItem {
  id: string;
  organization_id: string | null;
  actor_user_id: string | null;
  actor_name: string;
  actor_email: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: string | null;
  before_json: Record<string, unknown> | null;
  after_json: Record<string, unknown> | null;
  created_at: string;
}

export interface AdminPaymentLedgerItem {
  id: string;
  organization_id: string;
  consultation_id: string;
  amount: number;
  payment_status: 'pending' | 'paid' | 'failed' | 'refunded';
  gateway: string | null;
  transaction_id: string | null;
  paid_at: string | null;
  created_at: string;
  pet_name?: string | null;
  client_name?: string | null;
  doctor_name?: string | null;
}

export interface AdminDoctorAvailabilityView {
  schedules: DoctorSlotSummary[];
  exceptions: DoctorScheduleException[];
}

export interface AdminOperationalOverview {
  organization: Organization | null;
  branches: Branch[];
  members: OrganizationMemberView[];
  invitations: StaffInvitationRecord[];
  doctors: DoctorGovernanceRecord[];
  clients: ClinicClientRecord[];
  pets: AdminPetDirectoryItem[];
  appointments: DoctorAppointment[];
  consultations: DoctorConsultation[];
  services: ClinicServiceItem[];
  auditLogs: AdminAuditLogItem[];
  payments: AdminPaymentLedgerItem[];
}

export interface AdminClinicalAuditOverview {
  medicalRecords: ClientMedicalRecord[];
  prescriptions: ClientPrescription[];
}
