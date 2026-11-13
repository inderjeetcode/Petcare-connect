import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ShieldAlert, ArrowLeft } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { resolvePortalLandingDecision } from '../../utils/workspaceAuth';

export const UnauthorizedPage: React.FC = () => {
  const location = useLocation();
  const state = (location.state || {}) as { reason?: string };
  const { authStatus, isContextReady, myContext } = useAuth();

  const returnTarget = (() => {
    if (authStatus === 'authenticated' && isContextReady && myContext) {
      const decision = resolvePortalLandingDecision(myContext, 'generic');
      if (decision.kind === 'redirect') {
        return { to: decision.path, label: 'Return to Authorized Portal' };
      }
      if (decision.kind === 'client_pending_status') {
        return { to: '/login/client', label: 'View Pet Owner Status' };
      }
    }
    return { to: '/', label: 'Back to Pet Connect Home' };
  })();

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 p-8 shadow-sm text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-700 border border-rose-200 mx-auto flex items-center justify-center">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h1 className="text-xl font-bold text-slate-900">Access Denied</h1>
        <p className="text-xs text-slate-600 leading-relaxed">
          {state.reason ||
            'You do not have permission to view this portal or organization resource.'}
        </p>
        <div className="pt-2 flex justify-center gap-3">
          <Link
            to={returnTarget.to}
            className="px-4 py-2 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-xl inline-flex items-center gap-1.5"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            {returnTarget.label}
          </Link>
        </div>
      </div>
    </div>
  );
};
