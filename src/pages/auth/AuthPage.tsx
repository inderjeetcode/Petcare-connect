import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { AuthFormCard, AuthFormMode } from '../../components/auth/AuthFormCard';
import { buildWorkspaceOptions } from '../../utils/workspaceAuth';
import { MyContextResponse } from '../../types/auth';
import { HeartHandshake, ShieldCheck } from 'lucide-react';

interface AuthPageProps {
  mode: AuthFormMode;
}

export const AuthPage: React.FC<AuthPageProps> = ({ mode }) => {
  const { authStatus, availableWorkspaces } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state || {}) as { from?: string; expired?: boolean };

  const resolveLandingPath = (ctx?: MyContextResponse) => {
    if (state.from && state.from !== '/login' && state.from !== '/signup') {
      return state.from;
    }
    const workspaces = ctx ? buildWorkspaceOptions(ctx) : availableWorkspaces;
    if (workspaces.length === 1) {
      return workspaces[0].default_path;
    }
    return '/workspaces';
  };

  useEffect(() => {
    if (authStatus === 'authenticated') {
      navigate(resolveLandingPath(), { replace: true });
    } else if (authStatus === 'recovery') {
      navigate('/reset-password', { replace: true });
    }
  }, [authStatus]);

  const title =
    mode === 'signup'
      ? 'Create Global Pet Connect Account'
      : mode === 'forgot'
      ? 'Recover Your Password'
      : 'Sign In to Pet Connect';

  const subtitle =
    mode === 'signup'
      ? 'Register once with a single identity. Join a veterinary clinic or register your own organization after signing in.'
      : mode === 'forgot'
      ? 'Enter your registered email address to receive a secure password reset link.'
      : 'Access your approved pet owner portals, veterinary workspaces, or clinic administration.';

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-4 sm:p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center text-center">
          <div className="w-12 h-12 rounded-2xl bg-teal-700 text-white flex items-center justify-center shadow-sm mb-3">
            <HeartHandshake className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {title}
          </h1>
          <p className="text-xs text-slate-600 mt-1.5 max-w-sm leading-relaxed">
            {subtitle}
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <AuthFormCard
            initialMode={mode}
            expiredSessionNotice={Boolean(state.expired)}
            onModeChange={(next) => {
              if (next === 'login') navigate('/login', { replace: true, state });
              else if (next === 'signup') navigate('/signup', { replace: true, state });
              else if (next === 'forgot') navigate('/forgot-password', { replace: true, state });
            }}
            onSuccess={(ctx) => {
              navigate(resolveLandingPath(ctx), { replace: true });
            }}
          />
        </div>

        <div className="flex items-center justify-center gap-2 text-[11px] text-slate-500">
          <ShieldCheck className="w-3.5 h-3.5 text-teal-700" />
          <span>Protected by Supabase Auth & multi-tenant Row Level Security</span>
        </div>
      </div>
    </div>
  );
};
