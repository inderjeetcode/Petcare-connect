import React, { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation, useParams, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { PortalKind } from '../../types/auth';
import {
  checkWorkspacePortalAccess,
  hasAnyRequiredPermission,
  resolveUnauthenticatedLoginPath,
} from '../../utils/workspaceAuth';
import {
  ShieldAlert,
  Clock,
  Lock,
  ArrowRight,
  Building2,
  Loader2,
  AlertTriangle,
  RefreshCw,
  LogOut,
} from 'lucide-react';

const FullscreenLoading: React.FC<{ message?: string }> = ({
  message = 'Verifying session and workspace permissions...',
}) => (
  <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
    <Loader2 className="w-8 h-8 text-teal-700 animate-spin mb-3" />
    <p className="text-sm font-semibold text-slate-800">{message}</p>
    <p className="text-xs text-slate-500 mt-1">
      Validating authenticated credentials against Pet Connect security policy
    </p>
  </div>
);

/**
 * Frontend route guard (UX only; PostgreSQL RLS & SECURITY DEFINER RPCs enforce actual security).
 */
export const RequireAuth: React.FC<{
  children?: React.ReactNode;
  loginPath?: string;
}> = ({ children, loginPath }) => {
  const {
    authStatus,
    contextStatus,
    isContextLoading,
    myContext,
    authError,
    refreshContext,
    signOut,
  } = useAuth();
  const location = useLocation();
  const [retrying, setRetrying] = useState(false);

  if (
    authStatus === 'loading' ||
    (authStatus === 'authenticated' &&
      !myContext &&
      (isContextLoading || contextStatus === 'idle' || contextStatus === 'loading'))
  ) {
    return <FullscreenLoading />;
  }

  if (authStatus === 'recovery') {
    return <Navigate to="/reset-password" replace />;
  }

  if (authStatus === 'unauthenticated' || authStatus === 'session_expired') {
    const targetLoginPath =
      loginPath || resolveUnauthenticatedLoginPath(location.pathname);
    return (
      <Navigate
        to={targetLoginPath}
        replace
        state={{
          from: `${location.pathname}${location.search}`,
          expired: authStatus === 'session_expired',
        }}
      />
    );
  }

  if (contextStatus === 'error' || !myContext) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-2xl border border-rose-200 p-8 shadow-xs text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl mx-auto bg-rose-50 text-rose-700 border border-rose-200 flex items-center justify-center">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h1 className="text-lg font-bold text-slate-900">Account Verification Failed</h1>
          <p className="text-xs text-slate-600 leading-relaxed">
            {authError ||
              'Could not verify your organization memberships and roles from the database. Access is blocked until verification succeeds.'}
          </p>
          <div className="flex items-center justify-center gap-2.5 pt-1">
            <button
              type="button"
              disabled={retrying}
              onClick={async () => {
                setRetrying(true);
                try {
                  await refreshContext();
                } finally {
                  setRetrying(false);
                }
              }}
              className="px-4 py-2 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-xl inline-flex items-center gap-1.5"
            >
              {retrying ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              Retry Verification
            </button>
            <button
              type="button"
              onClick={() => {
                void signOut();
              }}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl inline-flex items-center gap-1.5"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (myContext.profile?.platform_status === 'suspended') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-2xl border border-rose-200 p-8 shadow-xs text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl mx-auto bg-rose-50 text-rose-700 border border-rose-200 flex items-center justify-center">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h1 className="text-lg font-bold text-slate-900">Account Suspended</h1>
          <p className="text-xs text-slate-600 leading-relaxed">
            Your Pet Connect platform account has been placed on administrative hold. Contact Platform Governance support if you believe this is in error.
          </p>
          <button
            type="button"
            onClick={() => {
              void signOut();
            }}
            className="px-4 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  return children ? <>{children}</> : <Outlet />;
};

export const RequirePlatformAdmin: React.FC<{ children?: React.ReactNode }> = ({
  children,
}) => {
  const {
    isPlatformAdmin,
    contextStatus,
    isContextLoading,
    myContext,
    syncWorkspaceFromRoute,
  } = useAuth();

  useEffect(() => {
    if (isPlatformAdmin) {
      syncWorkspaceFromRoute(undefined, 'platform');
    }
  }, [isPlatformAdmin, syncWorkspaceFromRoute]);

  if (
    !myContext &&
    (isContextLoading || contextStatus === 'idle' || contextStatus === 'loading')
  ) {
    return <FullscreenLoading message="Verifying Platform Owner privileges..." />;
  }

  if (!myContext || contextStatus === 'error' || !isPlatformAdmin) {
    return (
      <Navigate
        to="/unauthorized"
        replace
        state={{
          reason:
            'This area is restricted to authorized Platform Owners.',
        }}
      />
    );
  }

  return children ? <>{children}</> : <Outlet />;
};

interface RequireWorkspaceAccessProps {
  portal: Exclude<PortalKind, 'platform'>;
  requiredPermissions?: string[];
  children?: React.ReactNode;
}

export const RequireWorkspaceAccess: React.FC<RequireWorkspaceAccessProps> = ({
  portal,
  requiredPermissions,
  children,
}) => {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const {
    myContext,
    contextStatus,
    isContextLoading,
    availableWorkspaces,
    syncWorkspaceFromRoute,
  } = useAuth();

  const result = checkWorkspacePortalAccess(myContext, orgSlug, portal);

  useEffect(() => {
    if (result.allowed) {
      syncWorkspaceFromRoute(orgSlug, portal);
    }
  }, [result.allowed, orgSlug, portal, syncWorkspaceFromRoute]);

  if (
    !myContext &&
    (isContextLoading || contextStatus === 'idle' || contextStatus === 'loading')
  ) {
    return <FullscreenLoading message="Loading organization permissions..." />;
  }

  if (!result.allowed) {
    const isPending =
      result.reason === 'org_pending' || result.reason === 'client_requested';
    const hasWorkspaces = availableWorkspaces.length > 0;
    const backPath =
      result.reason === 'client_requested' && !hasWorkspaces
        ? '/login/client'
        : '/workspaces';
    const backLabel =
      result.reason === 'client_requested' && !hasWorkspaces
        ? 'View Pet Owner Status'
        : 'Go to My Workspaces';

    return (
      <div className="max-w-xl mx-auto mt-12 bg-white rounded-2xl border border-slate-200 p-8 shadow-xs text-center space-y-4">
        <div
          className={`w-12 h-12 rounded-2xl mx-auto flex items-center justify-center ${
            isPending
              ? 'bg-amber-50 text-amber-700 border border-amber-200'
              : 'bg-rose-50 text-rose-700 border border-rose-200'
          }`}
        >
          {isPending ? (
            <Clock className="w-6 h-6" />
          ) : result.reason === 'org_suspended' ? (
            <Building2 className="w-6 h-6" />
          ) : (
            <ShieldAlert className="w-6 h-6" />
          )}
        </div>

        <h1 className="text-lg font-bold text-slate-900">
          {isPending
            ? 'Pending Approval'
            : result.reason === 'org_suspended'
            ? 'Organization Suspended'
            : 'Workspace Access Restricted'}
        </h1>

        <p className="text-sm text-slate-600 leading-relaxed">{result.message}</p>

        <div className="pt-2 flex items-center justify-center gap-3">
          <Link
            to={backPath}
            className="px-4 py-2 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-xl transition-colors inline-flex items-center gap-1.5"
          >
            {backLabel}
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    );
  }

  if (
    requiredPermissions &&
    requiredPermissions.length > 0 &&
    !hasAnyRequiredPermission(result.membership?.permissions, requiredPermissions)
  ) {
    return (
      <div className="max-w-xl mx-auto mt-12 bg-white rounded-2xl border border-slate-200 p-8 shadow-xs text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl mx-auto bg-rose-50 text-rose-700 border border-rose-200 flex items-center justify-center">
          <Lock className="w-6 h-6" />
        </div>
        <h1 className="text-lg font-bold text-slate-900">Insufficient Role Permission</h1>
        <p className="text-sm text-slate-600">
          Your role in {result.organizationName} does not include permission to access this administrative screen.
        </p>
        <Link
          to={`/${result.organizationSlug}/${portal}/dashboard`}
          className="px-4 py-2 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-xl inline-flex items-center gap-1.5"
        >
          Back to Dashboard
        </Link>
      </div>
    );
  }

  return children ? <>{children}</> : <Outlet />;
};

/**
 * Redirects legacy unscoped portal paths (e.g., /client/pets, /doctor/consultations)
 * to the user's verified workspace preserving the subpath, once context hydration completes.
 */
export const LegacyPortalRedirect: React.FC<{
  portal: Exclude<PortalKind, 'platform'>;
  subpath?: string;
}> = ({ portal, subpath = 'dashboard' }) => {
  const {
    myContext,
    contextStatus,
    isContextLoading,
    availableWorkspaces,
    activeWorkspace,
    clinicClients,
    isPlatformAdmin,
  } = useAuth();
  const params = useParams<{ '*'?: string }>();
  const location = useLocation();

  if (
    !myContext &&
    (isContextLoading || contextStatus === 'idle' || contextStatus === 'loading')
  ) {
    return <FullscreenLoading message="Resolving verified portal workspace..." />;
  }

  if (contextStatus === 'error' || !myContext) {
    return null;
  }

  const rawWildcard = (params['*'] || '').replace(/^\/+/, '');
  const resolvedSubpath = rawWildcard || subpath || 'dashboard';
  const targetSuffix = location.search
    ? `${resolvedSubpath}${location.search}`
    : resolvedSubpath;

  if (activeWorkspace && activeWorkspace.portal === portal && activeWorkspace.organization_slug) {
    return (
      <Navigate
        to={`/${activeWorkspace.organization_slug}/${portal}/${targetSuffix}`}
        replace
      />
    );
  }

  const firstMatch = availableWorkspaces.find(
    (w) => w.portal === portal && w.organization_slug
  );
  if (firstMatch && firstMatch.organization_slug) {
    return (
      <Navigate
        to={`/${firstMatch.organization_slug}/${portal}/${targetSuffix}`}
        replace
      />
    );
  }

  if (
    portal === 'client' &&
    availableWorkspaces.length === 0 &&
    !isPlatformAdmin &&
    clinicClients.length > 0
  ) {
    return <Navigate to="/login/client" replace />;
  }

  if (availableWorkspaces.length > 0) {
    return <Navigate to="/workspaces" replace />;
  }

  return (
    <Navigate
      to="/unauthorized"
      replace
      state={{
        reason: `No active ${portal} workspace access was found for your account.`,
      }}
    />
  );
};
