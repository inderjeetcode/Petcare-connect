import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { isSupabaseConfigured } from '../config/supabaseClient';
import { authService, formatSupabaseError, SignUpResult } from '../services/authService';
import { Profile } from '../types';
import {
  AuthStatus,
  MyClinicClient,
  MyContextResponse,
  MyMembership,
  PortalKind,
  WorkspaceOption,
} from '../types/auth';
import {
  buildWorkspaceOptions,
  hasBranchAccess as checkBranchAccess,
  hasOrgPermission as checkOrgPermission,
} from '../utils/workspaceAuth';

const ACTIVE_WORKSPACE_KEY = 'pet_connect_active_workspace_v1';

interface AuthContextValue {
  isConfigured: boolean;
  authStatus: AuthStatus;
  isLoading: boolean;
  isContextLoading: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  myContext: MyContextResponse | null;
  isPlatformAdmin: boolean;
  memberships: MyMembership[];
  clinicClients: MyClinicClient[];
  availableWorkspaces: WorkspaceOption[];
  activeWorkspace: WorkspaceOption | null;
  authError: string | null;
  clearAuthError: () => void;
  setActiveWorkspaceByKey: (key: string) => void;
  syncWorkspaceFromRoute: (orgSlug: string | undefined, portal: PortalKind) => void;
  refreshContext: () => Promise<MyContextResponse | null>;
  refreshSession: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<MyContextResponse>;
  signUp: (
    email: string,
    password: string,
    fullName: string,
    phone?: string
  ) => Promise<SignUpResult>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  updatePassword: (newPassword: string) => Promise<void>;
  updateOwnProfile: (updates: {
    full_name?: string;
    phone?: string;
    avatar_url?: string;
  }) => Promise<Profile>;
  hasPermission: (organizationId: string, permission: string) => boolean;
  hasBranchAccess: (
    organizationId: string,
    branchId: string | null | undefined,
    permission?: string
  ) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function isSessionExpiredError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string; status?: number };
  if (e.code === '28000' || e.status === 401) return true;
  const msg = e.message || '';
  return /jwt expired|invalid jwt|session.*expired|refresh token/i.test(msg);
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [authStatus, setAuthStatus] = useState<AuthStatus>(
    isSupabaseConfigured ? 'loading' : 'unauthenticated'
  );
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [myContext, setMyContext] = useState<MyContextResponse | null>(null);
  const [isContextLoading, setIsContextLoading] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [selectedWorkspaceKey, setSelectedWorkspaceKey] = useState<string | null>(
    () => {
      try {
        return sessionStorage.getItem(ACTIVE_WORKSPACE_KEY);
      } catch {
        return null;
      }
    }
  );

  const recoveryModeRef = useRef<boolean>(false);

  const persistWorkspaceKey = useCallback((key: string | null) => {
    setSelectedWorkspaceKey(key);
    try {
      if (key) {
        sessionStorage.setItem(ACTIVE_WORKSPACE_KEY, key);
      } else {
        sessionStorage.removeItem(ACTIVE_WORKSPACE_KEY);
      }
    } catch {
      // Ignore storage access restrictions
    }
  }, []);

  const clearAuthenticatedState = useCallback(
    (nextStatus: 'unauthenticated' | 'session_expired') => {
      recoveryModeRef.current = false;
      setSession(null);
      setUser(null);
      setProfile(null);
      setMyContext(null);
      setAuthStatus(nextStatus);
      persistWorkspaceKey(null);
    },
    [persistWorkspaceKey]
  );

  const loadContextForSession = useCallback(
    async (activeSession: Session): Promise<MyContextResponse | null> => {
      setIsContextLoading(true);
      setAuthError(null);
      try {
        const [ctx, prof] = await Promise.all([
          authService.fetchMyContext(),
          authService.fetchProfile(activeSession.user.id).catch(() => null),
        ]);

        setMyContext(ctx);
        if (prof) {
          setProfile(prof);
        } else {
          setProfile({
            id: ctx.profile.id || activeSession.user.id,
            full_name:
              ctx.profile.full_name ||
              activeSession.user.user_metadata?.full_name ||
              activeSession.user.email ||
              'User',
            email: ctx.profile.email || activeSession.user.email || '',
            phone: ctx.profile.phone || '',
            avatar_url: ctx.profile.avatar_url || '',
            created_at: activeSession.user.created_at || new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        }
        return ctx;
      } catch (err) {
        if (isSessionExpiredError(err)) {
          setAuthError('Your session has expired. Please sign in again.');
          clearAuthenticatedState('session_expired');
          return null;
        }
        setAuthError(formatSupabaseError(err, 'Unable to load organization workspace context.'));
        return null;
      } finally {
        setIsContextLoading(false);
      }
    },
    [clearAuthenticatedState]
  );

  // Initialize session and subscribe to auth state changes
  useEffect(() => {
    if (!isSupabaseConfigured) {
      setAuthStatus('unauthenticated');
      return;
    }

    let isMounted = true;

    const initialize = async () => {
      try {
        const existingSession = await authService.getSession();
        if (!isMounted) return;

        if (!existingSession?.user) {
          clearAuthenticatedState('unauthenticated');
          return;
        }

        // Proactively refresh if token is expired or within 60 seconds of expiry
        let activeSession = existingSession;
        const expiresAtMs = (existingSession.expires_at || 0) * 1000;
        if (expiresAtMs > 0 && expiresAtMs - Date.now() < 60_000) {
          try {
            const refreshed = await authService.refreshSession();
            if (!refreshed?.user) {
              clearAuthenticatedState('session_expired');
              return;
            }
            activeSession = refreshed;
          } catch {
            clearAuthenticatedState('session_expired');
            return;
          }
        }

        if (!isMounted) return;
        setSession(activeSession);
        setUser(activeSession.user);

        // Detect recovery hash or recovery path
        const isRecoveryUrl =
          window.location.pathname === '/reset-password' &&
          (window.location.hash.includes('type=recovery') ||
            window.location.search.includes('type=recovery'));

        if (isRecoveryUrl || recoveryModeRef.current) {
          recoveryModeRef.current = true;
          setAuthStatus('recovery');
        } else {
          setAuthStatus('authenticated');
        }

        await loadContextForSession(activeSession);
      } catch (err) {
        if (!isMounted) return;
        if (isSessionExpiredError(err)) {
          clearAuthenticatedState('session_expired');
        } else {
          setAuthError(formatSupabaseError(err, 'Failed to restore session.'));
          clearAuthenticatedState('unauthenticated');
        }
      }
    };

    initialize();

    const {
      data: { subscription },
    } = authService.onAuthStateChange((event, nextSession) => {
      if (!isMounted) return;

      if (event === 'PASSWORD_RECOVERY') {
        recoveryModeRef.current = true;
        if (nextSession?.user) {
          setSession(nextSession);
          setUser(nextSession.user);
        }
        setAuthStatus('recovery');
        return;
      }

      if (event === 'SIGNED_OUT' || !nextSession?.user) {
        // Distinguish natural signout vs unexpected expiry
        clearAuthenticatedState('unauthenticated');
        return;
      }

      setSession(nextSession);
      setUser(nextSession.user);
      if (!recoveryModeRef.current) {
        setAuthStatus('authenticated');
      }

      // Defer async Supabase RPC hydration outside onAuthStateChange callback to avoid client lock deadlocks
      if (
        event === 'SIGNED_IN' ||
        event === 'TOKEN_REFRESHED' ||
        event === 'USER_UPDATED'
      ) {
        setTimeout(() => {
          if (isMounted) {
            void loadContextForSession(nextSession);
          }
        }, 0);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [clearAuthenticatedState, loadContextForSession]);

  const availableWorkspaces = useMemo(
    () => buildWorkspaceOptions(myContext),
    [myContext]
  );

  // Active workspace must ALWAYS validate against database-derived availableWorkspaces
  const activeWorkspace = useMemo(() => {
    if (availableWorkspaces.length === 0) return null;
    if (selectedWorkspaceKey) {
      const matched = availableWorkspaces.find((w) => w.key === selectedWorkspaceKey);
      if (matched) return matched;
    }
    return availableWorkspaces[0];
  }, [availableWorkspaces, selectedWorkspaceKey]);

  const setActiveWorkspaceByKey = useCallback(
    (key: string) => {
      const valid = availableWorkspaces.find((w) => w.key === key);
      if (valid) {
        persistWorkspaceKey(valid.key);
      }
    },
    [availableWorkspaces, persistWorkspaceKey]
  );

  const syncWorkspaceFromRoute = useCallback(
    (orgSlug: string | undefined, portal: PortalKind) => {
      const match = availableWorkspaces.find((w) => {
        if (portal === 'platform') return w.portal === 'platform';
        return (
          w.portal === portal &&
          w.organization_slug?.toLowerCase() === (orgSlug || '').toLowerCase()
        );
      });
      if (match && match.key !== selectedWorkspaceKey) {
        persistWorkspaceKey(match.key);
      }
    },
    [availableWorkspaces, selectedWorkspaceKey, persistWorkspaceKey]
  );

  const refreshContext = useCallback(async () => {
    if (!session?.user) return null;
    return loadContextForSession(session);
  }, [session, loadContextForSession]);

  const refreshSession = useCallback(async () => {
    const refreshed = await authService.refreshSession();
    if (!refreshed?.user) {
      clearAuthenticatedState('session_expired');
      return;
    }
    setSession(refreshed);
    setUser(refreshed.user);
    setAuthStatus(recoveryModeRef.current ? 'recovery' : 'authenticated');
    await loadContextForSession(refreshed);
  }, [clearAuthenticatedState, loadContextForSession]);

  const signIn = useCallback(
    async (email: string, password: string): Promise<MyContextResponse> => {
      setAuthError(null);
      recoveryModeRef.current = false;
      const { user: signedInUser, session: newSession } =
        await authService.signInWithPassword(email, password);
      setSession(newSession);
      setUser(signedInUser);
      setAuthStatus('authenticated');
      const ctx = await loadContextForSession(newSession);
      if (!ctx) {
        throw new Error('Signed in, but failed to load your organization context.');
      }
      return ctx;
    },
    [loadContextForSession]
  );

  const signUp = useCallback(
    async (
      email: string,
      password: string,
      fullName: string,
      phone?: string
    ): Promise<SignUpResult> => {
      setAuthError(null);
      recoveryModeRef.current = false;
      const result = await authService.signUp(email, password, fullName, phone);
      if (result.session) {
        setSession(result.session);
        setUser(result.user);
        setAuthStatus('authenticated');
        await loadContextForSession(result.session);
      }
      return result;
    },
    [loadContextForSession]
  );

  const signOut = useCallback(async () => {
    setAuthError(null);
    try {
      await authService.signOut();
    } finally {
      clearAuthenticatedState('unauthenticated');
    }
  }, [clearAuthenticatedState]);

  const sendPasswordReset = useCallback(async (email: string) => {
    setAuthError(null);
    await authService.sendPasswordResetEmail(email);
  }, []);

  const updatePassword = useCallback(
    async (newPassword: string) => {
      setAuthError(null);
      const updatedUser = await authService.updatePassword(newPassword);
      recoveryModeRef.current = false;
      setUser(updatedUser);
      const currentSession = await authService.getSession();
      if (currentSession) {
        setSession(currentSession);
        setAuthStatus('authenticated');
        await loadContextForSession(currentSession);
      } else {
        clearAuthenticatedState('unauthenticated');
      }
    },
    [clearAuthenticatedState, loadContextForSession]
  );

  const updateOwnProfile = useCallback(
    async (updates: {
      full_name?: string;
      phone?: string;
      avatar_url?: string;
    }) => {
      if (!user) {
        throw new Error('You must be signed in to update your profile.');
      }
      const updated = await authService.updateOwnProfile(user.id, updates);
      setProfile(updated);
      if (session) {
        await loadContextForSession(session);
      }
      return updated;
    },
    [user, session, loadContextForSession]
  );

  const memberships = useMemo(
    () => myContext?.memberships || [],
    [myContext]
  );
  const clinicClients = useMemo(
    () => myContext?.clinic_clients || [],
    [myContext]
  );

  const hasPermission = useCallback(
    (organizationId: string, permission: string) => {
      const membership = memberships.find(
        (m) => m.organization_id === organizationId
      );
      return checkOrgPermission(membership, permission);
    },
    [memberships]
  );

  const hasBranchAccess = useCallback(
    (
      organizationId: string,
      branchId: string | null | undefined,
      permission?: string
    ) => {
      const membership = memberships.find(
        (m) => m.organization_id === organizationId
      );
      return checkBranchAccess(membership, branchId, permission);
    },
    [memberships]
  );

  const value: AuthContextValue = {
    isConfigured: isSupabaseConfigured,
    authStatus,
    isLoading: authStatus === 'loading',
    isContextLoading,
    session,
    user,
    profile,
    myContext,
    isPlatformAdmin: Boolean(myContext?.is_platform_admin),
    memberships,
    clinicClients,
    availableWorkspaces,
    activeWorkspace,
    authError,
    clearAuthError: () => setAuthError(null),
    setActiveWorkspaceByKey,
    syncWorkspaceFromRoute,
    refreshContext,
    refreshSession,
    signIn,
    signUp,
    signOut,
    sendPasswordReset,
    updatePassword,
    updateOwnProfile,
    hasPermission,
    hasBranchAccess,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
