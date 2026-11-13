import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { AuthFormCard, AuthFormMode } from '../../components/auth/AuthFormCard';
import { resolvePortalLandingDecision } from '../../utils/workspaceAuth';
import { AuthPortalEntry, MyClinicClient, MyContextResponse } from '../../types/auth';
import {
  HeartHandshake,
  ShieldCheck,
  ArrowLeft,
  Ticket,
  Lock,
  Stethoscope,
  PawPrint,
  Loader2,
  AlertTriangle,
  RefreshCw,
  LogOut,
  Clock,
  XCircle,
  ShieldAlert,
  Building2,
} from 'lucide-react';

export type { AuthPortalEntry };

interface AuthPageProps {
  mode: AuthFormMode;
  portal?: AuthPortalEntry;
}

const CLIENT_STATUS_BADGE: Record<
  MyClinicClient['client_status'],
  { label: string; className: string }
> = {
  requested: {
    label: 'Pending Clinic Approval',
    className: 'bg-amber-50 text-amber-800 border-amber-200',
  },
  approved: {
    label: 'Approved',
    className: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  },
  rejected: {
    label: 'Declined',
    className: 'bg-rose-50 text-rose-800 border-rose-200',
  },
  suspended: {
    label: 'Suspended',
    className: 'bg-slate-100 text-slate-700 border-slate-300',
  },
};

export const AuthPage: React.FC<AuthPageProps> = ({
  mode,
  portal = 'generic',
}) => {
  const {
    authStatus,
    contextStatus,
    isContextReady,
    isContextLoading,
    myContext,
    authError,
    refreshContext,
    signOut,
  } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state || {}) as { from?: string; expired?: boolean };
  const [localMode, setLocalMode] = useState<AuthFormMode>(mode);
  const [retryingContext, setRetryingContext] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    setLocalMode(mode);
  }, [mode, portal]);

  const activeMode: AuthFormMode = portal === 'generic' ? mode : localMode;

  const allowSignup = portal === 'generic' || portal === 'client';

  useEffect(() => {
    if (authStatus === 'recovery') {
      navigate('/reset-password', { replace: true });
      return;
    }

    if (isContextReady && myContext) {
      const decision = resolvePortalLandingDecision(myContext, portal, state.from);
      if (decision.kind === 'redirect') {
        navigate(decision.path, { replace: true });
      }
    }
  }, [authStatus, isContextReady, myContext, portal, state.from, navigate]);

  const handleRetryContext = async () => {
    setRetryingContext(true);
    try {
      await refreshContext();
    } finally {
      setRetryingContext(false);
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  };

  const handleLoginSuccess = (ctx?: MyContextResponse) => {
    if (!ctx) return;
    const decision = resolvePortalLandingDecision(ctx, portal, state.from);
    if (decision.kind === 'redirect') {
      navigate(decision.path, { replace: true });
    }
  };

  const { title, subtitle, infoNote, Icon } = (() => {
    if (portal === 'client') {
      return {
        title:
          activeMode === 'signup'
            ? 'Create Pet Owner Account'
            : activeMode === 'forgot'
            ? 'Recover Pet Owner Password'
            : 'Pet Owner Sign In',
        subtitle:
          activeMode === 'signup'
            ? 'Register your pet owner account to request access to a veterinary clinic and manage pet care.'
            : activeMode === 'forgot'
            ? 'Enter your registered email address to receive a password reset link.'
            : 'Access your approved pet owner clinic portal, appointments, prescriptions, and medical records.',
        infoNote:
          'Sign in with your Pet Connect account. Access to each veterinary clinic is verified after clinic approval.',
        Icon: PawPrint,
      };
    }

    if (portal === 'clinic') {
      return {
        title:
          activeMode === 'forgot'
            ? 'Recover Clinic Staff Password'
            : 'Clinic & Staff Sign In',
        subtitle:
          activeMode === 'forgot'
            ? 'Enter your clinic staff email address to receive a secure password reset link.'
            : 'Authorized sign-in for Clinic Administrators, Doctors, Branch Managers, and Front Desk staff.',
        infoNote:
          'Staff portal access is strictly restricted to active organization memberships verified by database policy.',
        Icon: Stethoscope,
      };
    }

    if (portal === 'platform') {
      return {
        title:
          activeMode === 'forgot'
            ? 'Recover Governance Credentials'
            : 'Platform Governance Sign In',
        subtitle:
          activeMode === 'forgot'
            ? 'Enter your authorized governance email address to receive a reset link.'
            : 'Restricted entry for authorized Pet Connect Platform Owners. All governance operations are audited.',
        infoNote:
          'This endpoint is restricted to verified Platform Owners. Unauthorized accounts cannot access platform governance.',
        Icon: Lock,
      };
    }

    return {
      title:
        activeMode === 'signup'
          ? 'Create Global Pet Connect Account'
          : activeMode === 'forgot'
          ? 'Recover Your Password'
          : 'Sign In to Pet Connect',
      subtitle:
        activeMode === 'signup'
          ? 'Register once with a single identity. Join a veterinary clinic or register your own organization after signing in.'
          : activeMode === 'forgot'
          ? 'Enter your registered email address to receive a secure password reset link.'
          : 'Access your approved pet owner portals, veterinary workspaces, or clinic administration.',
      infoNote:
        'One global Pet Connect account gives you access to all veterinary clinics where you are an approved pet owner, doctor, or staff member.',
      Icon: HeartHandshake,
    };
  })();

  const isWaitingForContext =
    authStatus === 'loading' ||
    (authStatus === 'authenticated' &&
      contextStatus !== 'error' &&
      (!isContextReady || isContextLoading || !myContext));

  if (isWaitingForContext) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-6 text-center">
        <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-sm p-8 space-y-3">
          <Loader2 className="w-8 h-8 text-teal-700 animate-spin mx-auto" />
          <h1 className="text-base font-bold text-slate-900">
            Verifying Account &amp; Portal Permissions
          </h1>
          <p className="text-xs text-slate-500 leading-relaxed">
            Hydrating your verified clinic memberships and portal access from the database...
          </p>
        </div>
      </div>
    );
  }

  if (authStatus === 'authenticated' && (contextStatus === 'error' || !myContext)) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-4 sm:p-6">
        <div className="w-full max-w-md bg-white rounded-2xl border border-rose-200 shadow-sm p-6 space-y-4 text-center">
          <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-700 border border-rose-200 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-lg font-bold text-slate-900">
              Unable to Verify Account Context
            </h1>
            <p className="text-xs text-slate-600 leading-relaxed">
              {authError ||
                'Your session is active, but Pet Connect could not verify your clinic roles or approvals from the database. Portal access is blocked until verification succeeds.'}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2.5 pt-2">
            <button
              type="button"
              disabled={retryingContext}
              onClick={() => {
                void handleRetryContext();
              }}
              className="flex-1 py-2.5 px-4 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-xl inline-flex items-center justify-center gap-1.5"
            >
              {retryingContext ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              Retry Verification
            </button>
            <button
              type="button"
              disabled={signingOut}
              onClick={() => {
                void handleSignOut();
              }}
              className="flex-1 py-2.5 px-4 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-xl inline-flex items-center justify-center gap-1.5"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </div>
          <Link
            to="/"
            className="text-[11px] text-slate-500 hover:text-slate-800 font-medium inline-flex items-center gap-1"
          >
            <ArrowLeft className="w-3 h-3" />
            Back to Pet Connect Home
          </Link>
        </div>
      </div>
    );
  }

  if (isContextReady && myContext) {
    const decision = resolvePortalLandingDecision(myContext, portal, state.from);

    if (decision.kind === 'client_pending_status') {
      const requestedClinics = decision.clinicClients.filter(
        (c) => c.client_status === 'requested'
      );
      return (
        <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-4 sm:p-6">
          <div className="w-full max-w-lg space-y-5">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-2xl bg-amber-50 text-amber-700 border border-amber-200 flex items-center justify-center shrink-0">
                  <Clock className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h1 className="text-lg font-bold text-slate-900">
                    {requestedClinics.length > 0
                      ? 'Pet Owner Clinic Approval Pending'
                      : 'Pet Owner Clinic Access Status'}
                  </h1>
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                    Signed in as{' '}
                    <span className="font-semibold text-slate-800">
                      {myContext.profile.email || myContext.profile.full_name}
                    </span>
                    . Your Pet Owner portal unlocks once a veterinary clinic approves your join request.
                  </p>
                </div>
              </div>

              {decision.clinicClients.length > 0 ? (
                <div className="space-y-2.5">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Your Clinic Join Requests
                  </h2>
                  {decision.clinicClients.map((cc) => {
                    const badge = CLIENT_STATUS_BADGE[cc.client_status];
                    return (
                      <div
                        key={cc.clinic_client_id}
                        className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between gap-3"
                      >
                        <div className="flex items-start gap-2.5 min-w-0">
                          <Building2 className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <div className="text-sm font-bold text-slate-900 truncate">
                              {cc.organization_name}
                            </div>
                            <div className="text-[11px] text-slate-500 mt-0.5">
                              Requested{' '}
                              {new Date(cc.requested_at).toLocaleDateString()}
                            </div>
                          </div>
                        </div>
                        <span
                          className={`px-2.5 py-1 rounded-md border text-[11px] font-semibold shrink-0 ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-600 leading-relaxed">
                  No approved or pending veterinary clinic memberships are linked to your account yet. Contact your veterinary clinic to approve or link your Pet Owner profile.
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
                <button
                  type="button"
                  disabled={retryingContext}
                  onClick={() => {
                    void handleRetryContext();
                  }}
                  className="flex-1 py-2.5 px-4 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-xl inline-flex items-center justify-center gap-1.5"
                >
                  {retryingContext ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  Refresh Approval Status
                </button>
                <button
                  type="button"
                  disabled={signingOut}
                  onClick={() => {
                    void handleSignOut();
                  }}
                  className="py-2.5 px-4 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-xl inline-flex items-center justify-center gap-1.5"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sign Out
                </button>
              </div>
            </div>

            <div className="flex items-center justify-center">
              <Link
                to="/"
                className="text-xs text-slate-600 hover:text-slate-900 font-medium inline-flex items-center gap-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back to Pet Connect Home
              </Link>
            </div>
          </div>
        </div>
      );
    }

    if (decision.kind === 'denied') {
      const isPlatformDenied = decision.reason === 'platform_forbidden';
      const isPlatformLoginRequired = decision.reason === 'platform_login_required';
      return (
        <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-4 sm:p-6">
          <div className="w-full max-w-md bg-white rounded-2xl border border-rose-200 shadow-sm p-6 space-y-4 text-center">
            <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-700 border border-rose-200 flex items-center justify-center mx-auto">
              {isPlatformDenied || isPlatformLoginRequired ? (
                <ShieldAlert className="w-6 h-6" />
              ) : (
                <XCircle className="w-6 h-6" />
              )}
            </div>
            <div className="space-y-1.5">
              <h1 className="text-lg font-bold text-slate-900">
                {isPlatformDenied
                  ? 'Platform Governance Access Denied'
                  : isPlatformLoginRequired
                  ? 'Dedicated Platform Sign-In Required'
                  : 'Clinic Staff Membership Required'}
              </h1>
              <p className="text-xs text-slate-600 leading-relaxed">
                {decision.message}
              </p>
              <p className="text-[11px] text-slate-500">
                Signed in as{' '}
                <span className="font-mono">{myContext.profile.email}</span>
              </p>
            </div>

            <div className="flex flex-col gap-2 pt-2">
              {!isPlatformDenied && !isPlatformLoginRequired && (
                <>
                  <Link
                    to="/login/client"
                    className="w-full py-2.5 px-4 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-xl inline-flex items-center justify-center gap-1.5"
                  >
                    <PawPrint className="w-3.5 h-3.5" />
                    Go to Pet Owner Portal Status
                  </Link>
                  <Link
                    to="/accept-invite"
                    className="w-full py-2.5 px-4 text-xs font-semibold text-teal-800 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-xl inline-flex items-center justify-center gap-1.5"
                  >
                    <Ticket className="w-3.5 h-3.5" />
                    Accept Staff Invitation
                  </Link>
                </>
              )}
              <button
                type="button"
                disabled={signingOut}
                onClick={() => {
                  void handleSignOut();
                }}
                className="w-full py-2.5 px-4 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-xl inline-flex items-center justify-center gap-1.5"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
            </div>

            <Link
              to="/"
              className="text-[11px] text-slate-500 hover:text-slate-800 font-medium inline-flex items-center gap-1"
            >
              <ArrowLeft className="w-3 h-3" />
              Back to Pet Connect Home
            </Link>
          </div>
        </div>
      );
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-4 sm:p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center text-center">
          <div className="w-12 h-12 rounded-2xl bg-teal-700 text-white flex items-center justify-center shadow-sm mb-3">
            <Icon className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {title}
          </h1>
          <p className="text-xs text-slate-600 mt-1.5 max-w-sm leading-relaxed">
            {subtitle}
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
          <AuthFormCard
            initialMode={activeMode}
            allowSignup={allowSignup}
            infoNote={infoNote}
            expiredSessionNotice={Boolean(state.expired)}
            onModeChange={(next) => {
              if (portal === 'generic') {
                if (next === 'login') navigate('/login', { replace: true, state });
                else if (next === 'signup') navigate('/signup', { replace: true, state });
                else if (next === 'forgot') navigate('/forgot-password', { replace: true, state });
              } else {
                setLocalMode(!allowSignup && next === 'signup' ? 'login' : next);
              }
            }}
            onSuccess={handleLoginSuccess}
          />

          {portal === 'clinic' && (
            <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
              <span>Have a staff invite token?</span>
              <Link
                to="/accept-invite"
                className="text-teal-700 hover:underline font-semibold inline-flex items-center gap-1"
              >
                <Ticket className="w-3.5 h-3.5" />
                Accept Invitation
              </Link>
            </div>
          )}
        </div>

        <div className="flex flex-col items-center gap-2 text-[11px] text-slate-500">
          <div className="flex items-center justify-center gap-2">
            <ShieldCheck className="w-3.5 h-3.5 text-teal-700" />
            <span>Protected by Supabase Auth &amp; multi-tenant Row Level Security</span>
          </div>
          <Link
            to="/"
            className="text-slate-600 hover:text-slate-900 font-medium inline-flex items-center gap-1"
          >
            <ArrowLeft className="w-3 h-3" />
            Back to Pet Connect Home
          </Link>
        </div>
      </div>
    </div>
  );
};

