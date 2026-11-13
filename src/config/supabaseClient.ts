/**
 * Supabase Client Configuration & Verification Engine
 * Strictly environment-driven: never falls back to hardcoded project URLs or keys.
 * Fails closed (isSupabaseConfigured = false, supabase = null) when env vars are missing or invalid.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

function sanitizeRootUrl(raw: string | undefined): string {
  if (!raw) return '';
  return raw.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
}

function isValidSupabaseUrl(url: string): boolean {
  if (!url || url.includes('your-project') || url.includes('<')) {
    return false;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') {
      return Boolean(parsed.hostname);
    }
    // Allow plain HTTP only for local Supabase CLI development hosts
    if (
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function isValidAnonKey(key: string): boolean {
  return Boolean(
    key &&
      !key.includes('your-anon-key') &&
      !key.includes('your-publishable-key') &&
      !key.includes('<')
  );
}

const env = (import.meta as { env?: Record<string, string | undefined> }).env;

export const SUPABASE_URL = sanitizeRootUrl(env?.VITE_SUPABASE_URL);

export const SUPABASE_ANON_KEY = (env?.VITE_SUPABASE_ANON_KEY || '').trim();

export const isSupabaseConfigured = Boolean(
  isValidSupabaseUrl(SUPABASE_URL) && isValidAnonKey(SUPABASE_ANON_KEY)
);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    })
  : null;

export interface ConnectionVerificationResult {
  status: 'connected' | 'disconnected' | 'error';
  isConfigured: boolean;
  message: string;
  url: string;
  projectId: string;
  checkedAt: string;
  latencyMs?: number;
}

/**
 * Performs a live network verification test against Supabase.
 * Strictly never claims "connected" unless an actual query completes successfully.
 */
export async function verifySupabaseConnection(): Promise<ConnectionVerificationResult> {
  const timestamp = new Date().toISOString();

  let projectId = 'Not Set';
  let hostLabel = 'configured endpoint';
  try {
    if (SUPABASE_URL) {
      const parsed = new URL(SUPABASE_URL);
      hostLabel = parsed.host;
      projectId =
        parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
          ? 'local-supabase'
          : parsed.hostname.split('.')[0] || 'Unknown';
    }
  } catch {
    projectId = 'Invalid URL';
  }

  // 1. Fail closed if env vars are missing or placeholder
  if (!isSupabaseConfigured || !supabase) {
    return {
      status: 'disconnected',
      isConfigured: false,
      message:
        'VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is not configured. Running in fail-closed local state without remote database access.',
      url: SUPABASE_URL || 'None',
      projectId,
      checkedAt: timestamp,
    };
  }

  // 2. Perform real network ping
  const startTime = performance.now();
  try {
    const { error } = await supabase
      .from('profiles')
      .select('count', { count: 'exact', head: true });

    const latency = Math.round(performance.now() - startTime);

    if (error) {
      return {
        status: 'error',
        isConfigured: true,
        message: `Database ping failed: ${error.message} (Code: ${error.code || 'UNKNOWN'})`,
        url: SUPABASE_URL,
        projectId,
        checkedAt: timestamp,
        latencyMs: latency,
      };
    }

    return {
      status: 'connected',
      isConfigured: true,
      message: `Successfully connected to PostgreSQL cluster at ${hostLabel} (${latency}ms latency).`,
      url: SUPABASE_URL,
      projectId,
      checkedAt: timestamp,
      latencyMs: latency,
    };
  } catch (err: any) {
    return {
      status: 'error',
      isConfigured: true,
      message: `Network failure connecting to ${SUPABASE_URL}: ${err.message || 'Connection refused'}`,
      url: SUPABASE_URL,
      projectId,
      checkedAt: timestamp,
    };
  }
}
