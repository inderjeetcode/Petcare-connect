import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { onboardingService } from '../../services/onboardingService';
import { formatSupabaseError } from '../../services/authService';
import {
  MailCheck,
  AlertCircle,
  CheckCircle2,
  KeyRound,
  ArrowRight,
  Loader2,
  HeartHandshake,
} from 'lucide-react';

export const AcceptInvitePage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const initialToken = searchParams.get('token') || '';
  const { authStatus, user, refreshContext } = useAuth();
  const navigate = useNavigate();

  const [token, setToken] = useState(initialToken);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [acceptedOrgId, setAcceptedOrgId] = useState<string | null>(null);

  const handleAccept = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    if (!token.trim()) {
      setErrorMessage('Please paste the invitation token provided by your clinic administrator.');
      return;
    }

    setLoading(true);
    try {
      const orgId = await onboardingService.acceptInvitation(token.trim());
      setAcceptedOrgId(orgId);
      const updatedCtx = await refreshContext();
      const matchedMembership = updatedCtx?.memberships.find(
        (m) => m.organization_id === orgId
      );
      if (matchedMembership) {
        const targetPortal = matchedMembership.roles.includes('doctor')
          ? 'doctor'
          : 'admin';
        setTimeout(() => {
          navigate(`/${matchedMembership.organization_slug}/${targetPortal}/dashboard`, {
            replace: true,
          });
        }, 900);
      }
    } catch (err) {
      setErrorMessage(formatSupabaseError(err, 'Unable to accept staff invitation.'));
    } finally {
      setLoading(false);
    }
  };

  const currentPathWithQuery = `/accept-invite${initialToken ? `?token=${encodeURIComponent(initialToken)}` : ''}`;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center text-center">
          <div className="w-12 h-12 rounded-2xl bg-teal-700 text-white flex items-center justify-center shadow-sm mb-3">
            <HeartHandshake className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Accept Clinic Staff Invitation</h1>
          <p className="text-xs text-slate-600 mt-1">
            Bind an organization doctor or staff role to your authenticated Pet Connect identity.
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
          {authStatus !== 'authenticated' ? (
            <div className="space-y-4">
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 space-y-1">
                <div className="font-bold text-slate-900">Sign in required</div>
                <p>
                  Sign in or create an account using the exact email address your clinic administrator invited.
                </p>
              </div>
              <div className="flex gap-2">
                <Link
                  to="/login"
                  state={{ from: currentPathWithQuery }}
                  className="flex-1 py-2.5 text-center text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-xl"
                >
                  Sign In to Accept
                </Link>
                <Link
                  to="/signup"
                  state={{ from: currentPathWithQuery }}
                  className="flex-1 py-2.5 text-center text-xs font-bold text-teal-800 bg-teal-50 border border-teal-200 hover:bg-teal-100 rounded-xl"
                >
                  Create Account
                </Link>
              </div>
            </div>
          ) : acceptedOrgId ? (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 space-y-2">
              <div className="flex items-center gap-2 font-bold">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                Invitation Accepted
              </div>
              <p>Your staff membership has been activated. Redirecting to your clinic workspace...</p>
              <Link
                to="/workspaces"
                className="inline-flex items-center gap-1 font-bold text-teal-800 underline"
              >
                Open My Workspaces
              </Link>
            </div>
          ) : (
            <form onSubmit={handleAccept} className="space-y-4">
              <div className="p-3 bg-teal-50 border border-teal-200 rounded-xl text-xs text-teal-900 flex items-center gap-2">
                <MailCheck className="w-4 h-4 text-teal-700 shrink-0" />
                <div>
                  Signed in as <span className="font-mono font-bold">{user?.email}</span>
                </div>
              </div>

              {errorMessage && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <div>{errorMessage}</div>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Invitation Token *
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    required
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="Paste single-use invitation token"
                    className="w-full pl-9 pr-3 py-2 text-xs font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Your account email must match the invited email enforced by database policy.
                </p>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-xl flex items-center justify-center gap-1.5"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                Accept Staff Invitation
              </button>

              <div className="pt-2 border-t border-slate-100 text-center">
                <Link to="/workspaces" className="text-xs font-medium text-slate-500 hover:text-slate-800">
                  Back to My Workspaces
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
