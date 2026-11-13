import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { formatSupabaseError } from '../../services/authService';
import { MyContextResponse } from '../../types/auth';
import {
  Lock,
  Mail,
  User,
  Phone,
  ArrowRight,
  ShieldAlert,
  CheckCircle2,
  AlertCircle,
  KeyRound,
  Loader2,
} from 'lucide-react';

export type AuthFormMode = 'login' | 'signup' | 'forgot';

interface AuthFormCardProps {
  initialMode?: AuthFormMode;
  expiredSessionNotice?: boolean;
  onSuccess?: (context?: MyContextResponse) => void;
  onModeChange?: (mode: AuthFormMode) => void;
}

export const AuthFormCard: React.FC<AuthFormCardProps> = ({
  initialMode = 'login',
  expiredSessionNotice = false,
  onSuccess,
  onModeChange,
}) => {
  const { isConfigured, signIn, signUp, sendPasswordReset, authError, clearAuthError } =
    useAuth();

  const [mode, setMode] = useState<AuthFormMode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    setMode(initialMode);
    setErrorMessage('');
    setSuccessMessage('');
  }, [initialMode]);

  const switchMode = (next: AuthFormMode) => {
    setMode(next);
    setErrorMessage('');
    setSuccessMessage('');
    clearAuthError();
    onModeChange?.(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');
    clearAuthError();

    if (!isConfigured) {
      setErrorMessage(
        'Supabase credentials are not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to authenticate.'
      );
      return;
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }

    setLoading(true);
    try {
      if (mode === 'forgot') {
        await sendPasswordReset(trimmedEmail);
        setSuccessMessage(
          `Password recovery link sent to ${trimmedEmail}. Check your inbox and open the link to set a new password.`
        );
        return;
      }

      if (mode === 'signup') {
        if (!fullName.trim()) {
          throw new Error('Full name is required.');
        }
        if (password.length < 8) {
          throw new Error('Password must be at least 8 characters long.');
        }
        if (password !== confirmPassword) {
          throw new Error('Password confirmation does not match.');
        }

        const result = await signUp(trimmedEmail, password, fullName, phone);
        if (result.needsEmailConfirmation) {
          setSuccessMessage(
            `Account created for ${trimmedEmail}. Please verify your email address via the confirmation link before signing in.`
          );
          return;
        }

        setSuccessMessage('Account created and signed in.');
        onSuccess?.();
        return;
      }

      // Sign in
      if (!password) {
        throw new Error('Please enter your password.');
      }
      const ctx = await signIn(trimmedEmail, password);
      onSuccess?.(ctx);
    } catch (err) {
      setErrorMessage(formatSupabaseError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {!isConfigured && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-start gap-2.5">
          <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <div className="font-bold">Supabase Auth Configuration Required</div>
            <div className="text-[11px] text-amber-800 mt-0.5 leading-relaxed">
              Provide <code className="font-mono bg-amber-100 px-1 rounded">VITE_SUPABASE_URL</code> and{' '}
              <code className="font-mono bg-amber-100 px-1 rounded">VITE_SUPABASE_ANON_KEY</code> in{' '}
              <code className="font-mono bg-amber-100 px-1 rounded">.env.local</code>. Authentication fails closed without live credentials.
            </div>
          </div>
        </div>
      )}

      {expiredSessionNotice && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>Your previous session expired. Sign in again to continue.</div>
        </div>
      )}

      {(errorMessage || authError) && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div>{errorMessage || authError}</div>
        </div>
      )}

      {successMessage && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <div>{successMessage}</div>
        </div>
      )}

      {/* Global Identity Note */}
      <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-[11px] text-slate-600 flex items-start gap-2">
        <Lock className="w-3.5 h-3.5 text-teal-700 shrink-0 mt-0.5" />
        <span>
          One global Pet Connect account gives you access to all veterinary clinics where you are an approved pet owner, doctor, or staff member.
        </span>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3.5">
        {mode === 'signup' && (
          <>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Full Name *
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Alex Morgan"
                  className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Phone Number (Optional)
              </label>
              <div className="relative">
                <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 (555) 019-2834"
                  className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>
            </div>
          </>
        )}

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">
            Email Address *
          </label>
          <div className="relative">
            <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>
        </div>

        {mode !== 'forgot' && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-bold text-slate-700">
                Password *
              </label>
              {mode === 'login' && (
                <button
                  type="button"
                  onClick={() => switchMode('forgot')}
                  className="text-[11px] text-teal-700 hover:text-teal-800 font-medium"
                >
                  Forgot password?
                </button>
              )}
            </div>
            <div className="relative">
              <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="password"
                required
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'signup' ? 'Minimum 8 characters' : '••••••••••••'}
                className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
          </div>
        )}

        {mode === 'signup' && (
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Confirm Password *
            </label>
            <div className="relative">
              <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="password"
                required
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter password"
                className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 px-4 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-xl transition-all shadow-xs flex items-center justify-center gap-1.5"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <ArrowRight className="w-4 h-4" />
          )}
          {mode === 'forgot'
            ? 'Send Password Reset Link'
            : mode === 'signup'
            ? 'Create Global Account'
            : 'Sign In'}
        </button>
      </form>

      <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
        {mode === 'forgot' ? (
          <button
            type="button"
            onClick={() => switchMode('login')}
            className="text-teal-700 hover:underline font-medium"
          >
            Back to Sign In
          </button>
        ) : mode === 'signup' ? (
          <button
            type="button"
            onClick={() => switchMode('login')}
            className="text-teal-700 hover:underline font-medium"
          >
            Already have an account? Sign In
          </button>
        ) : (
          <button
            type="button"
            onClick={() => switchMode('signup')}
            className="text-teal-700 hover:underline font-medium"
          >
            New to Pet Connect? Create global account
          </button>
        )}
      </div>
    </div>
  );
};
