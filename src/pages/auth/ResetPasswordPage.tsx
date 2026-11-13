import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { formatSupabaseError } from '../../services/authService';
import {
  KeyRound,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Loader2,
  HeartHandshake,
} from 'lucide-react';

export const ResetPasswordPage: React.FC = () => {
  const { authStatus, session, updatePassword } = useAuth();
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [completed, setCompleted] = useState(false);

  const hasValidSession = Boolean(session?.user) && (authStatus === 'recovery' || authStatus === 'authenticated');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    if (password.length < 8) {
      setErrorMessage('New password must be at least 8 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage('Password confirmation does not match.');
      return;
    }

    setLoading(true);
    try {
      await updatePassword(password);
      setCompleted(true);
      setTimeout(() => {
        navigate('/workspaces', { replace: true });
      }, 1200);
    } catch (err) {
      setErrorMessage(formatSupabaseError(err, 'Failed to update password.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center text-center">
          <div className="w-12 h-12 rounded-2xl bg-teal-700 text-white flex items-center justify-center shadow-sm mb-3">
            <HeartHandshake className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Set New Password</h1>
          <p className="text-xs text-slate-600 mt-1">
            Update the password for your Pet Connect global account.
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
          {authStatus === 'loading' ? (
            <div className="py-8 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-teal-700" />
              <span>Validating recovery token...</span>
            </div>
          ) : !hasValidSession ? (
            <div className="space-y-4">
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  No active password recovery session was detected. Recovery links expire after one use or timeout. Please request a fresh password reset link.
                </div>
              </div>
              <div className="flex gap-2">
                <Link
                  to="/forgot-password"
                  className="flex-1 py-2.5 text-center text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-xl"
                >
                  Request New Reset Link
                </Link>
                <Link
                  to="/login"
                  className="py-2.5 px-4 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl"
                >
                  Sign In
                </Link>
              </div>
            </div>
          ) : completed ? (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold">Password Updated</div>
                <p className="mt-0.5">Redirecting to your workspaces...</p>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {errorMessage && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <div>{errorMessage}</div>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  New Password *
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimum 8 characters"
                    className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Confirm New Password *
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter new password"
                    className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-xl flex items-center justify-center gap-1.5"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                Update Password
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
