/**
 * Supabase Authentication & Global Identity Service
 * Manages global auth sessions, recovery, password updates, own-profile updates,
 * and authoritative database context hydration via public.get_my_context().
 */

import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../config/supabaseClient';
import { Profile } from '../types';
import { MyContextResponse } from '../types/auth';

export interface SignUpResult {
  user: User;
  session: Session | null;
  needsEmailConfirmation: boolean;
}

export function formatSupabaseError(err: unknown, fallback = 'Operation failed.'): string {
  if (!err || typeof err !== 'object') {
    return typeof err === 'string' && err.trim() ? err : fallback;
  }

  const record = err as { code?: string; message?: string; details?: string };
  const code = record.code || '';
  const msg = (record.message || '').trim();

  if (code === '28000' || /jwt expired|refresh token|session.*expired|not authenticated/i.test(msg)) {
    return 'Your session has expired or is unauthenticated. Please sign in again.';
  }
  if (code === '42501') {
    return msg || 'Access denied by organization security policy.';
  }
  if (code === '23505') {
    if (/slug/i.test(msg)) {
      return 'That clinic URL slug is already taken. Please choose another slug.';
    }
    return msg || 'A duplicate record already exists.';
  }
  if (code === '22023') {
    return msg || 'Invalid input or disallowed state transition.';
  }
  if (code === 'P0002') {
    return msg || 'The requested record could not be found.';
  }
  if (/email not confirmed/i.test(msg)) {
    return 'Email not confirmed: Please check your inbox and click the verification link before signing in.';
  }
  if (/invalid login credentials/i.test(msg)) {
    return 'Invalid email address or password.';
  }
  if (/user already registered/i.test(msg)) {
    return 'An account with this email address already exists. Please sign in instead.';
  }

  return msg || fallback;
}

function assertConfigured() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error(
      'Supabase authentication is unavailable: configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment.'
    );
  }
  return supabase;
}

export const authService = {
  onAuthStateChange(
    callback: (event: AuthChangeEvent, session: Session | null) => void
  ) {
    if (!isSupabaseConfigured || !supabase) {
      return { data: { subscription: { unsubscribe: () => {} } } };
    }
    return supabase.auth.onAuthStateChange(callback);
  },

  async getSession(): Promise<Session | null> {
    if (!isSupabaseConfigured || !supabase) return null;
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session;
  },

  async refreshSession(): Promise<Session | null> {
    const client = assertConfigured();
    const { data, error } = await client.auth.refreshSession();
    if (error) throw error;
    return data.session;
  },

  async getUser(): Promise<User | null> {
    if (!isSupabaseConfigured || !supabase) return null;
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    return data.user;
  },

  async signInWithPassword(
    email: string,
    password: string
  ): Promise<{ user: User; session: Session }> {
    const client = assertConfigured();
    const { data, error } = await client.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (error) throw error;
    if (!data.user || !data.session) {
      throw new Error('Authentication succeeded without an active session.');
    }

    return { user: data.user, session: data.session };
  },

  async signUp(
    email: string,
    password: string,
    fullName: string,
    phone?: string
  ): Promise<SignUpResult> {
    const client = assertConfigured();
    const { data, error } = await client.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/login`,
        data: {
          full_name: fullName.trim(),
          phone: (phone || '').trim(),
        },
      },
    });

    if (error) throw error;
    if (!data.user) throw new Error('Account registration failed.');

    return {
      user: data.user,
      session: data.session,
      needsEmailConfirmation: !data.session,
    };
  },

  async sendPasswordResetEmail(email: string): Promise<void> {
    const client = assertConfigured();
    const { error } = await client.auth.resetPasswordForEmail(
      email.trim().toLowerCase(),
      {
        redirectTo: `${window.location.origin}/reset-password`,
      }
    );
    if (error) throw error;
  },

  async updatePassword(newPassword: string): Promise<User> {
    const client = assertConfigured();
    const { data, error } = await client.auth.updateUser({
      password: newPassword,
    });
    if (error) throw error;
    if (!data.user) throw new Error('Password updated but user session missing.');
    return data.user;
  },

  async signOut(): Promise<void> {
    if (!isSupabaseConfigured || !supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) {
      // Clear local session state even if network signout fails (e.g. expired token)
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
      throw error;
    }
  },

  /**
   * Authoritative multi-tenant context loader from public.get_my_context().
   */
  async fetchMyContext(): Promise<MyContextResponse> {
    const client = assertConfigured();
    const { data, error } = await client.rpc('get_my_context');
    if (error) throw error;
    if (!data || typeof data !== 'object') {
      throw new Error('Failed to load authenticated workspace context.');
    }

    const raw = data as Partial<MyContextResponse>;
    return {
      user_id: String(raw.user_id || ''),
      profile: {
        id: String(raw.profile?.id || raw.user_id || ''),
        full_name: String(raw.profile?.full_name || ''),
        email: String(raw.profile?.email || ''),
        phone: raw.profile?.phone ?? null,
        avatar_url: raw.profile?.avatar_url ?? null,
      },
      is_platform_admin: Boolean(raw.is_platform_admin),
      memberships: Array.isArray(raw.memberships) ? raw.memberships : [],
      clinic_clients: Array.isArray(raw.clinic_clients) ? raw.clinic_clients : [],
    };
  },

  async fetchProfile(userId: string): Promise<Profile | null> {
    if (!isSupabaseConfigured || !supabase) return null;
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) throw error;
    return (data as Profile) || null;
  },

  /**
   * Updates mutable global profile fields for auth.uid().
   * Email is omitted because tg_profiles_guard_identity enforces email immutability.
   */
  async updateOwnProfile(
    userId: string,
    updates: { full_name?: string; phone?: string; avatar_url?: string }
  ): Promise<Profile> {
    const client = assertConfigured();
    const payload: Record<string, string | null> = {};
    if (typeof updates.full_name === 'string') {
      payload.full_name = updates.full_name.trim();
    }
    if (typeof updates.phone === 'string') {
      payload.phone = updates.phone.trim();
    }
    if (typeof updates.avatar_url === 'string') {
      payload.avatar_url = updates.avatar_url.trim();
    }

    const { data, error } = await client
      .from('profiles')
      .update(payload)
      .eq('id', userId)
      .select('*')
      .single();

    if (error) throw error;
    return data as Profile;
  },
};
