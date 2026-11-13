import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  UserRole,
  Profile,
  Pet,
  DoctorProfile,
  Consultation,
  ChatMessage,
  Prescription,
  MedicalRecord,
  Vaccination,
  Notification,
  AuditLog,
} from '../types';
import {
  INITIAL_PROFILES,
  INITIAL_PETS,
  INITIAL_DOCTORS,
  INITIAL_CONSULTATIONS,
  INITIAL_CHAT_MESSAGES,
  INITIAL_PRESCRIPTIONS,
  INITIAL_MEDICAL_RECORDS,
  INITIAL_VACCINATIONS,
  INITIAL_NOTIFICATIONS,
  INITIAL_AUDIT_LOGS,
} from '../services/mockData';
import { isSupabaseConfigured, supabase, verifySupabaseConnection } from '../config/supabaseClient';
import { supabaseService } from '../services/supabaseService';
import { clientPortalService } from '../services/clientPortalService';
import { doctorPortalService } from '../services/doctorPortalService';
import { adminPortalService } from '../services/adminPortalService';
import { platformPortalService } from '../services/platformPortalService';
import { onboardingService } from '../services/onboardingService';
import { useAuth } from './AuthContext';
import { deriveLegacyPortalRole } from '../utils/workspaceAuth';
import { deduplicateNotifications } from '../utils/listManagementHelpers';

export interface ToastItem {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
}

interface AppContextType {
  // Authentication & Role Context (derived strictly from AuthContext verified workspace)
  currentRole: UserRole;
  currentProfile: Profile;

  // Supabase Auth Integration (delegated to AuthContext)
  authUser: any | null;
  authProfile: Profile | null;
  isAuthModalOpen: boolean;
  openAuthModal: () => void;
  closeAuthModal: () => void;
  signInWithSupabase: (email: string, pass: string) => Promise<void>;
  signUpWithSupabase: (email: string, pass: string, name: string, phone?: string) => Promise<void>;
  signOutWithSupabase: () => Promise<void>;
  resetPasswordWithSupabase: (email: string) => Promise<void>;

  // Environment / Database State
  isDemoMode: boolean;
  isSupabaseOnline: boolean;
  isDataLoading: boolean;
  reloadFromDatabase: () => Promise<void>;

  // Pets
  pets: Pet[];
  addPet: (petData: Omit<Pet, 'id' | 'created_at' | 'updated_at'>) => Promise<Pet>;
  updatePet: (id: string, petData: Partial<Pet>) => Promise<void>;
  deletePet: (id: string) => Promise<void>;

  // Doctors
  doctors: DoctorProfile[];
  updateDoctorStatus: (id: string, isActive: boolean) => void;
  addDoctor: (doctorData: Omit<DoctorProfile, 'id' | 'created_at' | 'updated_at'>) => DoctorProfile;

  // Consultations & 7-Day Lifecycle
  consultations: Consultation[];
  bookConsultation: (data: {
    pet_id: string;
    doctor_id: string;
    consultation_reason: string;
    preferred_time?: string;
    attachment_url?: string;
  }) => Promise<Consultation>;
  approveConsultation: (id: string) => Promise<void>;
  rejectConsultation: (id: string, reason?: string) => Promise<void>;
  completeConsultation: (id: string) => Promise<void>;
  reassignConsultation: (id: string, newDoctorId: string) => void;
  isConsultationExpired: (consultation: Consultation) => boolean;
  getTimeRemaining: (consultation: Consultation) => {
    isExpired: boolean;
    days: number;
    hours: number;
    minutes: number;
    formatted: string;
  };

  // Chat Engine
  chatMessages: Record<string, ChatMessage[]>;
  sendChatMessage: (
    consultationId: string,
    content: string,
    attachment?: { url: string; name: string }
  ) => Promise<boolean>;

  // Prescriptions
  prescriptions: Prescription[];
  createPrescription: (data: Omit<Prescription, 'id' | 'created_at'>) => Promise<Prescription>;

  // Medical Records
  medicalRecords: MedicalRecord[];
  addMedicalRecord: (data: Omit<MedicalRecord, 'id' | 'created_at'>) => Promise<MedicalRecord>;

  // Vaccinations
  vaccinations: Vaccination[];
  addVaccination: (data: Omit<Vaccination, 'id'>) => Promise<Vaccination>;

  // Notifications
  notifications: Notification[];
  toggleNotificationRead: (id: string, isRead: boolean) => Promise<void>;
  markNotificationRead: (id: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;

  // Audit Logs
  auditLogs: AuditLog[];

  // Toast System
  toasts: ToastItem[];
  showToast: (message: string, type?: ToastItem['type']) => void;
  removeToast: (id: string) => void;

  // Reset demo state
  resetDemoData: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const STORAGE_KEY = 'pet_connect_app_state_v1';

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    user: authUser,
    profile: authProfile,
    activeWorkspace,
    signIn,
    signUp,
    signOut,
    sendPasswordReset,
  } = useAuth();

  // Live DB mode whenever Supabase env vars are configured; never bypass auth with local demo mode
  const isDemoMode = !isSupabaseConfigured;
  const [isSupabaseOnline, setIsSupabaseOnline] = useState<boolean>(false);
  const [isDataLoading, setIsDataLoading] = useState<boolean>(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  const currentRole: UserRole = React.useMemo(
    () => deriveLegacyPortalRole(activeWorkspace),
    [activeWorkspace]
  );
  const [profiles, setProfiles] = useState<Profile[]>(() =>
    isDemoMode ? INITIAL_PROFILES : []
  );

  // Business Data Entities (never load mock data when Supabase is configured)
  const [pets, setPets] = useState<Pet[]>(() => {
    if (!isDemoMode) return [];
    const saved = localStorage.getItem(`${STORAGE_KEY}_pets`);
    return saved ? JSON.parse(saved) : INITIAL_PETS;
  });
  const [doctors, setDoctors] = useState<DoctorProfile[]>(() => {
    if (!isDemoMode) return [];
    const saved = localStorage.getItem(`${STORAGE_KEY}_doctors`);
    return saved ? JSON.parse(saved) : INITIAL_DOCTORS;
  });
  const [consultations, setConsultations] = useState<Consultation[]>(() => {
    if (!isDemoMode) return [];
    const saved = localStorage.getItem(`${STORAGE_KEY}_consultations`);
    return saved ? JSON.parse(saved) : INITIAL_CONSULTATIONS;
  });
  const [chatMessages, setChatMessages] = useState<Record<string, ChatMessage[]>>(() => {
    if (!isDemoMode) return {};
    const saved = localStorage.getItem(`${STORAGE_KEY}_chat`);
    return saved ? JSON.parse(saved) : INITIAL_CHAT_MESSAGES;
  });
  const [prescriptions, setPrescriptions] = useState<Prescription[]>(() => {
    if (!isDemoMode) return [];
    const saved = localStorage.getItem(`${STORAGE_KEY}_rx`);
    return saved ? JSON.parse(saved) : INITIAL_PRESCRIPTIONS;
  });
  const [medicalRecords, setMedicalRecords] = useState<MedicalRecord[]>(() => {
    if (!isDemoMode) return [];
    const saved = localStorage.getItem(`${STORAGE_KEY}_meds`);
    return saved ? JSON.parse(saved) : INITIAL_MEDICAL_RECORDS;
  });
  const [vaccinations, setVaccinations] = useState<Vaccination[]>(() => {
    if (!isDemoMode) return [];
    const saved = localStorage.getItem(`${STORAGE_KEY}_vax`);
    return saved ? JSON.parse(saved) : INITIAL_VACCINATIONS;
  });
  const [notifications, setNotifications] = useState<Notification[]>(() => {
    if (!isDemoMode) return [];
    const saved = localStorage.getItem(`${STORAGE_KEY}_notifs`);
    return saved ? JSON.parse(saved) : INITIAL_NOTIFICATIONS;
  });
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>(() => {
    if (!isDemoMode) return [];
    const saved = localStorage.getItem(`${STORAGE_KEY}_audit`);
    return saved ? JSON.parse(saved) : INITIAL_AUDIT_LOGS;
  });

  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback((message: string, type: ToastItem['type'] = 'info') => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Check Supabase connectivity when configured
  useEffect(() => {
    const checkConnectivity = async () => {
      if (!isSupabaseConfigured) {
        setIsSupabaseOnline(false);
        return;
      }
      const res = await verifySupabaseConnection();
      setIsSupabaseOnline(res.status === 'connected');
    };
    checkConnectivity();
  }, []);

  // Fetch real data from Supabase when connected and authenticated
  const reloadFromDatabase = useCallback(async () => {
    if (!isSupabaseConfigured || isDemoMode || !authUser) return;
    setIsDataLoading(true);
    try {
      if (activeWorkspace?.portal === 'client' && activeWorkspace.organization_id) {
        const [dbNotifs, dbCons] = await Promise.all([
          clientPortalService.getNotifications(
            activeWorkspace.organization_id,
            authUser.id
          ),
          clientPortalService.getConsultations(activeWorkspace.organization_id),
        ]);
        setNotifications(dbNotifs as unknown as Notification[]);
        setConsultations(dbCons as unknown as Consultation[]);
        return;
      }

      if (activeWorkspace?.portal === 'doctor' && activeWorkspace.organization_id) {
        const docProfile = await onboardingService
          .getMyDoctorProfile(activeWorkspace.organization_id, authUser.id)
          .catch(() => null);
        const [dbNotifs, dbCons] = await Promise.all([
          doctorPortalService.getNotifications(
            activeWorkspace.organization_id,
            authUser.id
          ),
          docProfile?.id
            ? doctorPortalService.getConsultations(
                activeWorkspace.organization_id,
                docProfile.id
              )
            : Promise.resolve([]),
        ]);
        setNotifications(dbNotifs as unknown as Notification[]);
        setConsultations(dbCons as unknown as Consultation[]);
        return;
      }

      if (activeWorkspace?.portal === 'admin' && activeWorkspace.organization_id) {
        const [dbNotifs, dbCons] = await Promise.all([
          adminPortalService
            .getNotifications(activeWorkspace.organization_id, authUser.id)
            .catch(() => []),
          adminPortalService
            .getConsultations(activeWorkspace.organization_id)
            .catch(() => []),
        ]);
        setNotifications(dbNotifs as unknown as Notification[]);
        setConsultations(dbCons as unknown as Consultation[]);
        setChatMessages({});
        return;
      }

      if (activeWorkspace?.portal === 'platform') {
        // Strict Platform Owner isolation: never query clinical, pet, prescription, or chat tables.
        const dbNotifs = await platformPortalService
          .getNotifications(authUser.id)
          .catch(() => [] as Notification[]);
        setNotifications(deduplicateNotifications(dbNotifs as Notification[]));
        setPets([]);
        setDoctors([]);
        setConsultations([]);
        setPrescriptions([]);
        setMedicalRecords([]);
        setVaccinations([]);
        setAuditLogs([]);
        setChatMessages({});
        return;
      }

      // Global hub (/workspaces or unassigned workspace): load ONLY the authenticated user's notifications.
      const dbNotifs = supabase
        ? await supabase
            .from('notifications')
            .select('*')
            .eq('user_id', authUser.id)
            .order('created_at', { ascending: false })
            .limit(150)
            .then(({ data }) => (data || []) as Notification[], () => [] as Notification[])
        : [];
      setNotifications(deduplicateNotifications(dbNotifs));
      setProfiles([]);
      setPets([]);
      setDoctors([]);
      setConsultations([]);
      setPrescriptions([]);
      setMedicalRecords([]);
      setVaccinations([]);
      setAuditLogs([]);
      setChatMessages({});
    } catch (err: any) {
      showToast(`Database sync: ${err.message}`, 'warning');
    } finally {
      setIsDataLoading(false);
    }
  }, [isDemoMode, authUser, activeWorkspace, showToast]);

  useEffect(() => {
    if (!isDemoMode && authUser) {
      void reloadFromDatabase();
    } else if (!isDemoMode && !authUser) {
      setNotifications([]);
      setConsultations([]);
      setPets([]);
      setDoctors([]);
      setPrescriptions([]);
      setMedicalRecords([]);
      setVaccinations([]);
      setAuditLogs([]);
      setChatMessages({});
    }
  }, [isDemoMode, authUser, reloadFromDatabase]);

  // Real-time Supabase notifications listener with automatic cleanup & deduplication
  useEffect(() => {
    if (isDemoMode || !isSupabaseConfigured || !supabase || !authUser?.id) {
      return;
    }

    const activeOrgId = activeWorkspace?.organization_id || null;
    const isPortalScoped =
      activeWorkspace?.portal === 'client' ||
      activeWorkspace?.portal === 'doctor' ||
      activeWorkspace?.portal === 'admin';

    const channel = supabase
      .channel(`user-notifications-${authUser.id}-${activeOrgId || 'global'}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${authUser.id}`,
        },
        (payload: any) => {
          if (payload.eventType === 'INSERT' && payload.new) {
            const incoming = payload.new as Notification;
            if (
              isPortalScoped &&
              activeOrgId &&
              incoming.organization_id &&
              incoming.organization_id !== activeOrgId
            ) {
              return;
            }
            setNotifications((prev) => deduplicateNotifications([incoming, ...prev]).slice(0, 150));
          } else if (payload.eventType === 'UPDATE' && payload.new) {
            const updated = payload.new as Notification;
            setNotifications((prev) =>
              prev.map((n) => (n.id === updated.id ? { ...n, ...updated } : n))
            );
          } else if (payload.eventType === 'DELETE' && payload.old?.id) {
            setNotifications((prev) => prev.filter((n) => n.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      if (supabase) {
        void supabase.removeChannel(channel);
      }
    };
  }, [isDemoMode, authUser?.id, activeWorkspace?.organization_id, activeWorkspace?.portal]);

  // Current active profile
  const currentProfile: Profile = React.useMemo(() => {
    if (authProfile) return authProfile;
    if (isDemoMode) {
      if (currentRole === 'doctor') {
        return profiles.find((p) => p.id === 'user-doc-1') || profiles[1] || profiles[0];
      }
      if (currentRole === 'admin') {
        return profiles.find((p) => p.id === 'user-admin-1') || profiles[5] || profiles[0];
      }
      return profiles.find((p) => p.id === 'user-client-1') || profiles[0];
    }
    return {
      id: authUser?.id || '',
      email: authUser?.email || '',
      full_name: authUser?.user_metadata?.full_name || authUser?.email || 'Authenticated User',
      phone: '',
      avatar_url: '',
      created_at: authUser?.created_at || new Date().toISOString(),
      updated_at: authUser?.updated_at || new Date().toISOString(),
    };
  }, [authProfile, authUser, isDemoMode, currentRole, profiles]);

  const logAudit = (action: string, entityType: string, entityId: string, details?: string) => {
    const newLog: AuditLog = {
      id: `log-${Date.now()}`,
      user_id: currentProfile.id,
      user_name: currentProfile.full_name,
      user_role: currentRole,
      action,
      entity_type: entityType,
      entity_id: entityId,
      created_at: new Date().toISOString(),
      details,
    };
    setAuditLogs((prev) => [newLog, ...prev]);
  };

  // ---------------------------------------------------------------------------
  // AUTH METHODS (Delegated to AuthContext)
  // ---------------------------------------------------------------------------
  const signInWithSupabase = async (email: string, pass: string) => {
    await signIn(email, pass);
  };

  const signUpWithSupabase = async (email: string, pass: string, name: string, phone?: string) => {
    await signUp(email, pass, name, phone);
  };

  const signOutWithSupabase = async () => {
    await signOut();
  };

  const resetPasswordWithSupabase = async (email: string) => {
    await sendPasswordReset(email);
  };

  // ---------------------------------------------------------------------------
  // PETS
  // ---------------------------------------------------------------------------
  const addPet = async (petData: Omit<Pet, 'id' | 'created_at' | 'updated_at'>) => {
    if (!isDemoMode && isSupabaseConfigured) {
      try {
        const created = await supabaseService.createPet(petData);
        setPets((prev) => [created, ...prev]);
        showToast(`Added pet "${created.name}" to database`, 'success');
        logAudit('CREATE_PET', 'pet', created.id, `Created pet record for ${created.name}`);
        return created;
      } catch (e: any) {
        showToast(`Failed to add pet: ${e.message}`, 'error');
        throw e;
      }
    }

    const newPet: Pet = {
      ...petData,
      id: `pet-${Date.now()}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setPets((prev) => [newPet, ...prev]);
    showToast(`Added pet "${newPet.name}" successfully`, 'success');
    logAudit('CREATE_PET', 'pet', newPet.id, `Created pet record for ${newPet.name}`);
    return newPet;
  };

  const updatePet = async (id: string, petData: Partial<Pet>) => {
    if (!isDemoMode && isSupabaseConfigured) {
      try {
        const updated = await supabaseService.updatePet(id, petData);
        setPets((prev) => prev.map((p) => (p.id === id ? updated : p)));
        showToast('Pet profile updated in database', 'success');
        logAudit('UPDATE_PET', 'pet', id, 'Updated pet profile');
        return;
      } catch (e: any) {
        showToast(`Failed to update pet: ${e.message}`, 'error');
        throw e;
      }
    }

    setPets((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...petData, updated_at: new Date().toISOString() } : p))
    );
    showToast('Pet profile updated', 'success');
    logAudit('UPDATE_PET', 'pet', id, 'Updated pet profile');
  };

  const deletePet = async (id: string) => {
    const pet = pets.find((p) => p.id === id);
    if (!isDemoMode && isSupabaseConfigured) {
      try {
        await supabaseService.deletePet(id);
        setPets((prev) => prev.filter((p) => p.id !== id));
        showToast(`Removed ${pet?.name || 'pet'} from database`, 'info');
        logAudit('DELETE_PET', 'pet', id, `Removed pet ${pet?.name}`);
        return;
      } catch (e: any) {
        showToast(`Failed to delete pet: ${e.message}`, 'error');
        throw e;
      }
    }

    setPets((prev) => prev.filter((p) => p.id !== id));
    showToast(`Removed ${pet?.name || 'pet'}`, 'info');
    logAudit('DELETE_PET', 'pet', id, `Removed pet ${pet?.name}`);
  };

  // ---------------------------------------------------------------------------
  // DOCTORS
  // ---------------------------------------------------------------------------
  const updateDoctorStatus = (id: string, isActive: boolean) => {
    setDoctors((prev) =>
      prev.map((d) => (d.id === id ? { ...d, is_active: isActive, updated_at: new Date().toISOString() } : d))
    );
    showToast(`Doctor status set to ${isActive ? 'Active' : 'Inactive'}`, 'info');
    logAudit('UPDATE_DOCTOR_STATUS', 'doctor_profile', id, `Status changed to ${isActive}`);
  };

  const addDoctor = (doctorData: Omit<DoctorProfile, 'id' | 'created_at' | 'updated_at'>) => {
    const newDoc: DoctorProfile = {
      ...doctorData,
      id: `doc-${Date.now()}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      rating: 5.0,
      total_reviews: 0,
    };
    setDoctors((prev) => [...prev, newDoc]);
    showToast(`Doctor ${newDoc.full_name} registered`, 'success');
    logAudit('CREATE_DOCTOR', 'doctor_profile', newDoc.id, `Created doctor profile ${newDoc.full_name}`);
    return newDoc;
  };

  // ---------------------------------------------------------------------------
  // CONSULTATIONS & 7-DAY EXPIRY RULE
  // ---------------------------------------------------------------------------
  const isConsultationExpired = (consultation: Consultation): boolean => {
    if (consultation.consultation_status === 'expired') return true;
    if (consultation.consultation_status === 'completed') return true;
    if (consultation.consultation_status !== 'active') return true;
    if (!consultation.activated_at || !consultation.expires_at) return true;
    const expiresMs = new Date(consultation.expires_at).getTime();
    return Date.now() >= expiresMs;
  };

  const getTimeRemaining = (consultation: Consultation) => {
    if (!consultation.expires_at || consultation.consultation_status !== 'active') {
      return { isExpired: true, days: 0, hours: 0, minutes: 0, formatted: 'Inactive' };
    }
    const expiresMs = new Date(consultation.expires_at).getTime();
    const diff = expiresMs - Date.now();
    if (diff <= 0) {
      return { isExpired: true, days: 0, hours: 0, minutes: 0, formatted: 'Expired' };
    }
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const formatted = `${days}d ${hours}h ${minutes}m left`;
    return { isExpired: false, days, hours, minutes, formatted };
  };

  const bookConsultation = async (data: {
    pet_id: string;
    doctor_id: string;
    consultation_reason: string;
    preferred_time?: string;
    attachment_url?: string;
  }) => {
    const pet = pets.find((p) => p.id === data.pet_id);
    const doctor = doctors.find((d) => d.id === data.doctor_id);

    if (!isDemoMode && isSupabaseConfigured) {
      try {
        const created = await supabaseService.createConsultation({
          client_id: currentProfile.id,
          doctor_id: data.doctor_id,
          pet_id: data.pet_id,
          consultation_reason: data.consultation_reason,
          preferred_time: data.preferred_time,
          attachment_url: data.attachment_url,
        });
        setConsultations((prev) => [created, ...prev]);
        showToast('Consultation request submitted! Awaiting doctor approval.', 'success');
        logAudit('SUBMIT_CONSULTATION', 'consultation', created.id, `Client requested triage for ${pet?.name}`);
        return created;
      } catch (err: any) {
        showToast(`Failed to book consultation: ${err.message}`, 'error');
        throw err;
      }
    }

    const newCons: Consultation = {
      id: `cons-${Date.now()}`,
      client_id: currentProfile.id,
      doctor_id: data.doctor_id,
      pet_id: data.pet_id,
      consultation_reason: data.consultation_reason,
      consultation_status: 'pending',
      activated_at: null,
      expires_at: null,
      completed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      client_name: currentProfile.full_name,
      doctor_name: doctor?.full_name || 'Veterinary Doctor',
      doctor_specialization: doctor?.specialization,
      pet_name: pet?.name || 'Pet',
      pet_species: pet?.species || 'Animal',
      pet_breed: pet?.breed || '',
      preferred_time: data.preferred_time,
      attachment_url: data.attachment_url,
    };

    setConsultations((prev) => [newCons, ...prev]);

    const notif: Notification = {
      id: `notif-${Date.now()}`,
      user_id: doctor?.user_id || 'user-doc-1',
      title: 'New Consultation Request',
      message: `${currentProfile.full_name} requested a consultation for ${pet?.name || 'their pet'}.`,
      notification_type: 'consultation',
      is_read: false,
      created_at: new Date().toISOString(),
      link_url: `/doctor/consultations`,
    };
    setNotifications((prev) => [notif, ...prev]);

    showToast('Consultation request submitted! Awaiting doctor approval.', 'success');
    logAudit('SUBMIT_CONSULTATION', 'consultation', newCons.id, `Client requested triage for ${pet?.name}`);
    return newCons;
  };

  // Exact 7-day activation rule: activates consultation and starts 7-day chat access window
  const approveConsultation = async (id: string) => {
    // Role Authorization Check: Only assigned doctor or admin can activate
    if (currentRole !== 'doctor' && currentRole !== 'admin') {
      showToast('Unauthorized: Clients cannot activate consultations. Only assigned doctors or administrators can approve.', 'error');
      return;
    }

    const consultation = consultations.find((c) => c.id === id);
    if (!consultation) {
      showToast('Consultation not found', 'error');
      return;
    }

    if (consultation.consultation_status !== 'pending') {
      showToast(`Invalid state: Consultation is already ${consultation.consultation_status}. Only pending requests can be activated.`, 'warning');
      return;
    }

    if (currentRole === 'doctor') {
      const activeDoc = doctors.find((d) => d.user_id === currentProfile.id || d.id === currentProfile.id);
      if (activeDoc && consultation.doctor_id !== activeDoc.id && consultation.doctor_id !== currentProfile.id) {
        showToast('Unauthorized: You are not the assigned doctor for this consultation.', 'error');
        return;
      }
    }

    if (!isDemoMode && isSupabaseConfigured) {
      try {
        const activated = await supabaseService.activateConsultationRPC(id);
        setConsultations((prev) => prev.map((c) => (c.id === id ? { ...c, ...activated } : c)));
        showToast('Consultation activated via PostgreSQL procedure! 7-day chat window initiated.', 'success');
        return;
      } catch (err: any) {
        showToast(`Activation failed: ${err.message}`, 'error');
        throw err;
      }
    }

    const activatedDate = new Date();
    const expiresDate = new Date(activatedDate.getTime() + (7 * 24 * 60 * 60 * 1000));

    setConsultations((prev) =>
      prev.map((c) => {
        if (c.id === id) {
          return {
            ...c,
            consultation_status: 'active',
            activated_at: activatedDate.toISOString(),
            expires_at: expiresDate.toISOString(),
            updated_at: activatedDate.toISOString(),
          };
        }
        return c;
      })
    );

    // Initial welcome clinical chat message
    if (!chatMessages[id]) {
      const welcomeMsg: ChatMessage = {
        id: `msg-${Date.now()}`,
        conversation_id: `conv-${id}`,
        sender_id: currentProfile.id,
        sender_name: currentProfile.full_name,
        sender_role: 'doctor',
        message_type: 'text',
        message_content: `Hello! I have reviewed your consultation request for ${consultation.pet_name}. 7-day consultation chat access is now active. Please share any details or questions.`,
        created_at: activatedDate.toISOString(),
      };
      setChatMessages((prev) => ({
        ...prev,
        [id]: [welcomeMsg],
      }));
    }

    showToast('Consultation approved! 7-day chat access activated.', 'success');
    logAudit('APPROVE_CONSULTATION', 'consultation', id, 'Consultation activated with 7-day chat window');
  };

  const rejectConsultation = async (id: string, reason?: string) => {
    if (!isDemoMode && isSupabaseConfigured) {
      try {
        const rejected = await supabaseService.updateConsultationStatus(id, 'rejected', reason);
        setConsultations((prev) => prev.map((c) => (c.id === id ? { ...c, ...rejected } : c)));
        showToast('Consultation request declined in database', 'info');
        return;
      } catch (e: any) {
        showToast(`Failed to reject: ${e.message}`, 'error');
        throw e;
      }
    }

    setConsultations((prev) =>
      prev.map((c) =>
        c.id === id
          ? {
              ...c,
              consultation_status: 'rejected',
              rejection_reason: reason || 'Scheduling conflict or referral required',
              updated_at: new Date().toISOString(),
            }
          : c
      )
    );
    showToast('Consultation request declined', 'info');
    logAudit('REJECT_CONSULTATION', 'consultation', id, `Declined: ${reason || 'Unspecified'}`);
  };

  const completeConsultation = async (id: string) => {
    if (!isDemoMode && isSupabaseConfigured) {
      try {
        const completed = await supabaseService.updateConsultationStatus(id, 'completed');
        setConsultations((prev) => prev.map((c) => (c.id === id ? { ...c, ...completed } : c)));
        showToast('Consultation marked as completed in database', 'success');
        return;
      } catch (e: any) {
        showToast(`Failed to complete: ${e.message}`, 'error');
        throw e;
      }
    }

    setConsultations((prev) =>
      prev.map((c) =>
        c.id === id
          ? {
              ...c,
              consultation_status: 'completed',
              completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }
          : c
      )
    );
    showToast('Consultation marked as completed', 'success');
    logAudit('COMPLETE_CONSULTATION', 'consultation', id, 'Consultation marked completed');
  };

  const reassignConsultation = (id: string, newDoctorId: string) => {
    const doctor = doctors.find((d) => d.id === newDoctorId);
    setConsultations((prev) =>
      prev.map((c) =>
        c.id === id
          ? {
              ...c,
              doctor_id: newDoctorId,
              doctor_name: doctor?.full_name,
              doctor_specialization: doctor?.specialization,
              updated_at: new Date().toISOString(),
            }
          : c
      )
    );
    showToast(`Consultation reassigned to ${doctor?.full_name || 'new doctor'}`, 'success');
    logAudit('REASSIGN_CONSULTATION', 'consultation', id, `Reassigned to ${doctor?.full_name}`);
  };

  // ---------------------------------------------------------------------------
  // CHAT ENGINE
  // ---------------------------------------------------------------------------
  const sendChatMessage = async (
    consultationId: string,
    content: string,
    attachment?: { url: string; name: string }
  ): Promise<boolean> => {
    const consultation = consultations.find((c) => c.id === consultationId);
    if (!consultation) {
      showToast('Consultation not found', 'error');
      return false;
    }

    if (isConsultationExpired(consultation)) {
      showToast('This 7-day consultation has expired. Chat is locked to read-only mode.', 'warning');
      return false;
    }

    if (!isDemoMode && isSupabaseConfigured) {
      try {
        const msg = await supabaseService.sendChatMessage({
          consultationId,
          senderId: currentProfile.id,
          senderRole: currentRole === 'doctor' ? 'doctor' : 'client',
          content,
          attachmentUrl: attachment?.url,
        });

        setChatMessages((prev) => ({
          ...prev,
          [consultationId]: [...(prev[consultationId] || []), msg],
        }));
        return true;
      } catch (err: any) {
        showToast(`Chat error: ${err.message}`, 'error');
        return false;
      }
    }

    const newMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      conversation_id: `conv-${consultationId}`,
      sender_id: currentProfile.id,
      sender_name: currentProfile.full_name,
      sender_role: currentRole,
      message_type: attachment ? 'image' : 'text',
      message_content: content,
      attachment_url: attachment?.url,
      attachment_name: attachment?.name,
      created_at: new Date().toISOString(),
    };

    setChatMessages((prev) => ({
      ...prev,
      [consultationId]: [...(prev[consultationId] || []), newMsg],
    }));

    return true;
  };

  // ---------------------------------------------------------------------------
  // PRESCRIPTIONS
  // ---------------------------------------------------------------------------
  const createPrescription = async (data: Omit<Prescription, 'id' | 'created_at'>) => {
    if (!isDemoMode && isSupabaseConfigured) {
      try {
        const { items, ...rest } = data;
        const created = await supabaseService.createPrescription(rest, items || []);
        setPrescriptions((prev) => [created, ...prev]);
        showToast('Prescription saved to database successfully', 'success');
        return created;
      } catch (e: any) {
        showToast(`Failed to save prescription: ${e.message}`, 'error');
        throw e;
      }
    }

    const newPrescription: Prescription = {
      ...data,
      id: `rx-${Date.now()}`,
      created_at: new Date().toISOString(),
    };
    setPrescriptions((prev) => [newPrescription, ...prev]);
    showToast('Prescription issued successfully', 'success');
    logAudit('CREATE_PRESCRIPTION', 'prescription', newPrescription.id, `Rx for ${data.diagnosis}`);
    return newPrescription;
  };

  // ---------------------------------------------------------------------------
  // MEDICAL RECORDS & VACCINATIONS
  // ---------------------------------------------------------------------------
  const addMedicalRecord = async (data: Omit<MedicalRecord, 'id' | 'created_at'>) => {
    if (!isDemoMode && isSupabaseConfigured) {
      try {
        const created = await supabaseService.createMedicalRecord(data);
        setMedicalRecords((prev) => [created, ...prev]);
        showToast('Medical record recorded in database', 'success');
        return created;
      } catch (e: any) {
        showToast(`Failed to add record: ${e.message}`, 'error');
        throw e;
      }
    }

    const newRecord: MedicalRecord = {
      ...data,
      id: `med-${Date.now()}`,
      created_at: new Date().toISOString(),
    };
    setMedicalRecords((prev) => [newRecord, ...prev]);
    showToast('Medical record added', 'success');
    logAudit('CREATE_MEDICAL_RECORD', 'medical_record', newRecord.id, `Diagnosis: ${data.diagnosis}`);
    return newRecord;
  };

  const addVaccination = async (data: Omit<Vaccination, 'id'>) => {
    if (!isDemoMode && isSupabaseConfigured) {
      try {
        const created = await supabaseService.createVaccination(data);
        setVaccinations((prev) => [created, ...prev]);
        showToast('Vaccination recorded in database', 'success');
        return created;
      } catch (e: any) {
        showToast(`Failed to add vaccination: ${e.message}`, 'error');
        throw e;
      }
    }

    const newVax: Vaccination = {
      ...data,
      id: `vax-${Date.now()}`,
    };
    setVaccinations((prev) => [newVax, ...prev]);
    showToast(`Vaccination recorded: ${data.vaccine_name}`, 'success');
    logAudit('CREATE_VACCINATION', 'vaccination', newVax.id, `Vaccine: ${data.vaccine_name}`);
    return newVax;
  };

  // ---------------------------------------------------------------------------
  // NOTIFICATIONS
  // ---------------------------------------------------------------------------
  const toggleNotificationRead = useCallback(
    async (id: string, isRead: boolean) => {
      const previous = notifications;
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: isRead } : n))
      );

      if (!isDemoMode && isSupabaseConfigured && authUser && supabase) {
        try {
          const { error } = await supabase
            .from('notifications')
            .update({ is_read: isRead })
            .eq('id', id)
            .eq('user_id', authUser.id);
          if (error) throw error;
        } catch (err: any) {
          setNotifications(previous);
          showToast(
            err?.message || 'Unable to update notification status. Please retry.',
            'error'
          );
          throw err;
        }
      }
    },
    [notifications, isDemoMode, authUser, showToast]
  );

  const markNotificationRead = useCallback(
    async (id: string) => {
      const target = notifications.find((n) => n.id === id);
      if (target?.is_read) return;
      await toggleNotificationRead(id, true);
    },
    [notifications, toggleNotificationRead]
  );

  const markAllNotificationsRead = useCallback(async () => {
    const unreadIds = notifications.filter((n) => !n.is_read).map((n) => n.id);
    if (unreadIds.length === 0) return;

    const previous = notifications;
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));

    if (!isDemoMode && isSupabaseConfigured && authUser && supabase) {
      try {
        if (activeWorkspace?.portal === 'client' && activeWorkspace.organization_id) {
          await clientPortalService.markAllNotificationsRead(
            activeWorkspace.organization_id,
            authUser.id
          );
        } else if (activeWorkspace?.portal === 'doctor' && activeWorkspace.organization_id) {
          await doctorPortalService.markAllNotificationsRead(
            activeWorkspace.organization_id,
            authUser.id
          );
        } else if (activeWorkspace?.portal === 'admin' && activeWorkspace.organization_id) {
          await adminPortalService.markAllNotificationsRead(
            activeWorkspace.organization_id,
            authUser.id
          );
        } else {
          await platformPortalService.markAllNotificationsRead(authUser.id);
        }
      } catch (err: any) {
        setNotifications(previous);
        showToast(
          err?.message || 'Failed to mark all notifications as read.',
          'error'
        );
        return;
      }
    }
    showToast('All notifications marked as read.', 'info');
  }, [notifications, isDemoMode, authUser, activeWorkspace, showToast]);

  // ---------------------------------------------------------------------------
  // RESET DEMO DATA
  // ---------------------------------------------------------------------------
  const resetDemoData = () => {
    setPets(INITIAL_PETS);
    setDoctors(INITIAL_DOCTORS);
    setConsultations(INITIAL_CONSULTATIONS);
    setChatMessages(INITIAL_CHAT_MESSAGES);
    setPrescriptions(INITIAL_PRESCRIPTIONS);
    setMedicalRecords(INITIAL_MEDICAL_RECORDS);
    setVaccinations(INITIAL_VACCINATIONS);
    setNotifications(INITIAL_NOTIFICATIONS);
    setAuditLogs(INITIAL_AUDIT_LOGS);

    localStorage.removeItem(`${STORAGE_KEY}_pets`);
    localStorage.removeItem(`${STORAGE_KEY}_doctors`);
    localStorage.removeItem(`${STORAGE_KEY}_consultations`);
    localStorage.removeItem(`${STORAGE_KEY}_chat`);
    localStorage.removeItem(`${STORAGE_KEY}_rx`);
    localStorage.removeItem(`${STORAGE_KEY}_meds`);
    localStorage.removeItem(`${STORAGE_KEY}_vax`);
    localStorage.removeItem(`${STORAGE_KEY}_notifs`);
    localStorage.removeItem(`${STORAGE_KEY}_audit`);

    showToast('Demonstration data restored to pristine state', 'info');
  };

  return (
    <AppContext.Provider
      value={{
        currentRole,
        currentProfile,
        authUser,
        authProfile,
        isAuthModalOpen,
        openAuthModal: () => setIsAuthModalOpen(true),
        closeAuthModal: () => setIsAuthModalOpen(false),
        signInWithSupabase,
        signUpWithSupabase,
        signOutWithSupabase,
        resetPasswordWithSupabase,
        isDemoMode,
        isSupabaseOnline,
        isDataLoading,
        reloadFromDatabase,
        pets,
        addPet,
        updatePet,
        deletePet,
        doctors,
        updateDoctorStatus,
        addDoctor,
        consultations,
        bookConsultation,
        approveConsultation,
        rejectConsultation,
        completeConsultation,
        reassignConsultation,
        isConsultationExpired,
        getTimeRemaining,
        chatMessages,
        sendChatMessage,
        prescriptions,
        createPrescription,
        medicalRecords,
        addMedicalRecord,
        vaccinations,
        addVaccination,
        notifications,
        toggleNotificationRead,
        markNotificationRead,
        markAllNotificationsRead,
        auditLogs,
        toasts,
        showToast,
        removeToast,
        resetDemoData,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
