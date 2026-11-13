import React, { useEffect } from 'react';
import { Navigate, Outlet, useLocation, useParams, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { PortalKind } from '../../types/auth';
import { checkWorkspacePortalAccess } from '../../utils/workspaceAuth';
import {
  ShieldAlert,
  Clock,
  Lock,
  ArrowRight,
  Building2,
  Loader2,
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
export const RequireAuth: React.FC<{ children?: React.ReactNode }> = ({
  children,
}) => {
  const { authStatus, isContextLoading, myContext } = useAuth();
  const location = useLocation();

  if (authStatus === 'loading' || (authStatus === 'authenticated' && isContextLoading && !myContext)) {
    return <FullscreenLoading />;
  }

  if (authStatus === 'recovery') {
    return <Navigate to="/reset-password" replace />;
  }

  if (authStatus === 'unauthenticated' || authStatus === 'session_expired') {
    return (
      <Navigate
        to="/login"
        replace
        state={{
          from: `${location.pathname}${location.search}`,
          expired: authStatus === 'session_expired',
        }}
      />
    );
  }

  return children ? <>{children}</> : <Outlet />;
};

export const RequirePlatformAdmin: React.FC<{ children?: React.ReactNode }> = ({
  children,
}) => {
  const { isPlatformAdmin, isContextLoading, myContext, syncWorkspaceFromRoute } =
    useAuth();

  useEffect(() => {
    if (isPlatformAdmin) {
      syncWorkspaceFromRoute(undefined, 'platform');
    }
  }, [isPlatformAdmin, syncWorkspaceFromRoute]);

  if (isContextLoading && !myContext) {
    return <FullscreenLoading message="Verifying Platform Owner privileges..." />;
  }

  if (!isPlatformAdmin) {
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
  const { myContext, isContextLoading, syncWorkspaceFromRoute } = useAuth();

  const result = checkWorkspacePortalAccess(myContext, orgSlug, portal);

  useEffect(() => {
    if (result.allowed) {
      syncWorkspaceFromRoute(orgSlug, portal);
    }
  }, [result.allowed, orgSlug, portal, syncWorkspaceFromRoute]);

  if (isContextLoading && !myContext) {
    return <FullscreenLoading message="Loading organization permissions..." />;
  }

  if (!result.allowed) {
    const isPending =
      result.reason === 'org_pending' || result.reason === 'client_requested';

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
            to="/workspaces"
            className="px-4 py-2 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-xl transition-colors inline-flex items-center gap-1.5"
          >
            Go to My Workspaces
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    );
  }

  if (
    requiredPermissions &&
    requiredPermissions.length > 0 &&
    result.membership &&
    !requiredPermissions.some((p) => result.membership!.permissions.includes(p))
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
 * Redirects legacy unscoped portal paths (e.g., /client/dashboard) to the user's
 * active verified workspace or to /workspaces when no workspace matches.
 */
export const LegacyPortalRedirect: React.FC<{
  portal: Exclude<PortalKind, 'platform'>;
  subpath?: string;
}> = ({ portal, subpath = 'dashboard' }) => {
  const { availableWorkspaces, activeWorkspace } = useAuth();

  if (activeWorkspace && activeWorkspace.portal === portal && activeWorkspace.organization_slug) {
    return (
      <Navigate
        to={`/${activeWorkspace.organization_slug}/${portal}/${subpath}`}
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
        to={`/${firstMatch.organization_slug}/${portal}/${subpath}`}
        replace
      />
    );
  }

  return <Navigate to="/workspaces" replace />;
};
