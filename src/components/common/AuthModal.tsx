import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useApp } from '../../context/AppContext';
import { AuthFormCard } from '../auth/AuthFormCard';
import {
  Lock,
  CheckCircle2,
  X,
  LogOut,
  ArrowRight,
} from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
  const { user, profile, availableWorkspaces, activeWorkspace, signOut } = useAuth();
  const { showToast } = useApp();
  const navigate = useNavigate();

  if (!isOpen) return null;

  const handleSignOut = async () => {
    try {
      await signOut();
      showToast('Signed out of Pet Connect.', 'info');
      onClose();
      navigate('/login');
    } catch (err: any) {
      showToast(err?.message || 'Failed to sign out', 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden flex flex-col">
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-teal-700 text-white flex items-center justify-center shadow-xs">
              <Lock className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                {user ? 'Authenticated Session' : 'Sign In to Pet Connect'}
              </h2>
              <p className="text-[11px] text-slate-500">
                Global Supabase Auth & Multi-Clinic Access
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {user ? (
          <div className="p-6 space-y-4">
            <div className="p-4 rounded-xl bg-teal-50 border border-teal-200 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-teal-900 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-teal-600" />
                  Active Supabase Session
                </span>
                {activeWorkspace && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-teal-200 text-teal-900">
                    {activeWorkspace.portal}
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-700">
                <div className="font-semibold text-slate-900">
                  {profile?.full_name || user.email}
                </div>
                <div className="text-slate-500 font-mono text-[11px]">{user.email}</div>
                <div className="text-[11px] text-slate-500 mt-1">
                  Workspaces available: <span className="font-bold">{availableWorkspaces.length}</span>
                </div>
              </div>
            </div>

            <div className="text-xs text-slate-500 bg-slate-50 p-3 rounded-lg border border-slate-200">
              <span className="font-semibold text-slate-700">Security Notice: </span>
              All organization memberships, roles, and clinical permissions are enforced by PostgreSQL Row Level Security tied to your authenticated session.
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  navigate('/workspaces');
                }}
                className="flex-1 py-2.5 px-4 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-xl transition-colors flex items-center justify-center gap-1.5"
              >
                Workspaces
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleSignOut}
                className="py-2.5 px-4 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-xl transition-colors flex items-center justify-center gap-1.5"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
            </div>
          </div>
        ) : (
          <div className="p-6">
            <AuthFormCard
              onSuccess={() => {
                showToast('Signed in successfully.', 'success');
                onClose();
                navigate('/workspaces');
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
};
