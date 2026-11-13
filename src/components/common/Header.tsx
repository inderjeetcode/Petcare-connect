import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { WorkspaceOption } from '../../types/auth';
import {
  HeartHandshake,
  Bell,
  Menu,
  Check,
  ChevronDown,
  Lock,
  Building2,
  ShieldCheck,
  LogOut,
  LayoutGrid,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AuthModal } from './AuthModal';

interface HeaderProps {
  onToggleMobileMenu: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onToggleMobileMenu }) => {
  const {
    notifications,
    markNotificationRead,
    markAllNotificationsRead,
    isAuthModalOpen,
    openAuthModal,
    closeAuthModal,
    showToast,
  } = useApp();

  const {
    user,
    profile,
    availableWorkspaces,
    activeWorkspace,
    setActiveWorkspaceByKey,
    isPlatformAdmin,
    signOut,
  } = useAuth();

  const navigate = useNavigate();
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showWorkspaceMenu, setShowWorkspaceMenu] = useState(false);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const displayName =
    profile?.full_name || user?.user_metadata?.full_name || user?.email || 'Account';
  const displayEmail = profile?.email || user?.email || '';
  const avatarUrl =
    profile?.avatar_url ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=0f766e&color=ffffff`;

  const handleSelectWorkspace = (ws: WorkspaceOption) => {
    setActiveWorkspaceByKey(ws.key);
    setShowWorkspaceMenu(false);
    navigate(ws.default_path);
  };

  const handleSignOut = async () => {
    setShowProfileMenu(false);
    try {
      await signOut();
      showToast('Signed out cleanly.', 'info');
      navigate('/login');
    } catch {
      navigate('/login');
    }
  };

  const profileRoute =
    activeWorkspace?.portal === 'doctor' && activeWorkspace.organization_slug
      ? `/${activeWorkspace.organization_slug}/doctor/profile`
      : activeWorkspace?.portal === 'client' && activeWorkspace.organization_slug
      ? `/${activeWorkspace.organization_slug}/client/profile`
      : '/workspaces';

  return (
    <>
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          {/* Brand & Mobile Hamburger */}
          <div className="flex items-center gap-3">
            <button
              onClick={onToggleMobileMenu}
              className="md:hidden p-2 rounded-lg text-slate-600 hover:bg-slate-100"
              aria-label="Toggle navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>

            <div
              onClick={() => navigate(activeWorkspace ? activeWorkspace.default_path : '/workspaces')}
              className="flex items-center gap-2.5 cursor-pointer group select-none"
            >
              <div className="w-10 h-10 rounded-xl bg-teal-700 flex items-center justify-center text-white shadow-sm group-hover:bg-teal-800 transition-colors">
                <HeartHandshake className="w-6 h-6" />
              </div>
              <div>
                <div className="text-lg font-bold tracking-tight text-slate-900 leading-tight">
                  PET CONNECT
                </div>
                <div className="text-[11px] font-medium text-teal-700 tracking-wide uppercase">
                  Veterinary Platform
                </div>
              </div>
            </div>
          </div>

          {/* Authenticated Workspace Switcher (Strict Database-Derived Options Only) */}
          <div className="hidden md:flex items-center gap-2 relative">
            {user && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowWorkspaceMenu((prev) => !prev)}
                  className="px-3.5 py-1.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-800 flex items-center gap-2 transition-colors"
                >
                  <Building2 className="w-4 h-4 text-teal-700" />
                  <span className="max-w-[240px] truncate">
                    {activeWorkspace ? activeWorkspace.label : 'Select Clinic Workspace'}
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                </button>

                {showWorkspaceMenu && (
                  <div className="absolute left-0 mt-2 w-80 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-50">
                    <div className="px-3.5 py-2 border-b border-slate-100 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Authorized Workspaces ({availableWorkspaces.length})
                    </div>
                    <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
                      {availableWorkspaces.length === 0 ? (
                        <div className="px-3.5 py-3 text-xs text-slate-500">
                          No active clinic portals yet. Visit My Workspaces to join or register a clinic.
                        </div>
                      ) : (
                        availableWorkspaces.map((ws) => {
                          const isSelected = activeWorkspace?.key === ws.key;
                          return (
                            <button
                              key={ws.key}
                              type="button"
                              onClick={() => handleSelectWorkspace(ws)}
                              className={`w-full text-left px-3.5 py-2.5 hover:bg-slate-50 flex items-center justify-between gap-2 ${
                                isSelected ? 'bg-teal-50/70' : ''
                              }`}
                            >
                              <div className="min-w-0">
                                <div className="text-xs font-bold text-slate-900 truncate">
                                  {ws.label}
                                </div>
                                <div className="text-[11px] text-slate-500 truncate">
                                  {ws.sublabel}
                                </div>
                              </div>
                              {isSelected && <Check className="w-4 h-4 text-teal-700 shrink-0" />}
                            </button>
                          );
                        })
                      )}
                    </div>
                    <div className="border-t border-slate-100 pt-1 px-2">
                      <button
                        type="button"
                        onClick={() => {
                          setShowWorkspaceMenu(false);
                          navigate('/workspaces');
                        }}
                        className="w-full text-left px-2.5 py-2 text-xs font-bold text-teal-700 hover:bg-teal-50 rounded-lg flex items-center gap-1.5"
                      >
                        <LayoutGrid className="w-3.5 h-3.5" />
                        All Workspaces & Clinic Onboarding
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {isPlatformAdmin && (
              <button
                type="button"
                onClick={() => navigate('/platform/applications')}
                className="px-3 py-1.5 text-xs font-bold rounded-xl bg-slate-900 text-white hover:bg-slate-800 flex items-center gap-1.5"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-teal-300" />
                Platform Console
              </button>
            )}
          </div>

          {/* Right Actions: Session, Notifications, Profile */}
          <div className="flex items-center gap-2">
            {!user && (
              <button
                onClick={openAuthModal}
                className="px-3 py-1.5 text-xs font-semibold rounded-xl border bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:bg-slate-50 flex items-center gap-1.5"
              >
                <Lock className="w-3.5 h-3.5 text-slate-500" />
                <span>Sign In</span>
              </button>
            )}

            {/* Notifications Dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowNotifications(!showNotifications)}
                className="relative p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
                aria-label="View notifications"
              >
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 w-4 h-4 bg-teal-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                    {unreadCount}
                  </span>
                )}
              </button>

              {showNotifications && (
                <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-xl shadow-xl border border-slate-200 py-2 z-50 animate-in fade-in-50">
                  <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between">
                    <div className="text-sm font-semibold text-slate-900">Notifications</div>
                    {unreadCount > 0 && (
                      <button
                        onClick={markAllNotificationsRead}
                        className="text-xs text-teal-700 hover:text-teal-800 font-medium flex items-center gap-1"
                      >
                        <Check className="w-3.5 h-3.5" /> Mark all read
                      </button>
                    )}
                  </div>
                  <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                    {notifications.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-500">
                        No notifications yet
                      </div>
                    ) : (
                      notifications.map((n) => (
                        <div
                          key={n.id}
                          onClick={() => {
                            markNotificationRead(n.id);
                            if (n.link_url) {
                              let resolved = n.link_url;
                              if (
                                n.link_url.startsWith('/client/') &&
                                activeWorkspace?.organization_slug
                              ) {
                                resolved = `/${activeWorkspace.organization_slug}/client/${n.link_url.slice(
                                  '/client/'.length
                                )}`;
                              } else if (
                                n.link_url.startsWith('/doctor/') &&
                                activeWorkspace?.organization_slug
                              ) {
                                resolved = `/${activeWorkspace.organization_slug}/doctor/${n.link_url.slice(
                                  '/doctor/'.length
                                )}`;
                              }
                              navigate(resolved);
                            }
                            setShowNotifications(false);
                          }}
                          className={`p-3.5 hover:bg-slate-50 cursor-pointer transition-colors ${
                            !n.is_read ? 'bg-teal-50/50' : ''
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-xs font-semibold text-slate-800">
                              {n.title}
                            </span>
                            {!n.is_read && (
                              <span className="w-2 h-2 rounded-full bg-teal-600 shrink-0 mt-1" />
                            )}
                          </div>
                          <p className="text-xs text-slate-600 mt-1 line-clamp-2">
                            {n.message}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* User Profile Menu */}
            {user && (
              <div className="relative">
                <button
                  onClick={() => setShowProfileMenu(!showProfileMenu)}
                  className="flex items-center gap-2 p-1.5 pl-2.5 rounded-xl border border-slate-200 hover:border-slate-300 transition-all bg-slate-50"
                >
                  <div className="text-left hidden md:block">
                    <div className="text-xs font-bold text-slate-900 leading-tight max-w-[140px] truncate">
                      {displayName}
                    </div>
                    <div className="text-[10px] uppercase tracking-wider font-semibold text-teal-700">
                      {activeWorkspace
                        ? activeWorkspace.portal === 'platform'
                          ? 'Platform Owner'
                          : activeWorkspace.portal
                        : 'Global Account'}
                    </div>
                  </div>
                  <img
                    src={avatarUrl}
                    alt={displayName}
                    className="w-8 h-8 rounded-lg object-cover border border-slate-300"
                  />
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                </button>

                {showProfileMenu && (
                  <div className="absolute right-0 mt-2 w-60 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-50">
                    <div className="px-3.5 py-2 border-b border-slate-100">
                      <div className="text-xs font-bold text-slate-900 truncate">{displayName}</div>
                      <div className="text-xs text-slate-500 truncate">{displayEmail}</div>
                      <div className="mt-1.5 flex items-center justify-between">
                        <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-teal-100 text-teal-800 uppercase">
                          {activeWorkspace?.portal || 'Authenticated'}
                        </span>
                        <span className="text-[10px] text-emerald-700 font-medium">
                          Supabase Verified
                        </span>
                      </div>
                    </div>

                    <div className="py-1">
                      <button
                        onClick={() => {
                          navigate('/workspaces');
                          setShowProfileMenu(false);
                        }}
                        className="w-full text-left px-3.5 py-1.5 text-xs text-slate-700 hover:bg-slate-100 font-medium"
                      >
                        My Workspaces & Clinics
                      </button>
                      <button
                        onClick={() => {
                          navigate(profileRoute);
                          setShowProfileMenu(false);
                        }}
                        className="w-full text-left px-3.5 py-1.5 text-xs text-slate-700 hover:bg-slate-100 font-medium"
                      >
                        Profile Settings
                      </button>
                      <button
                        onClick={handleSignOut}
                        className="w-full text-left px-3.5 py-1.5 text-xs text-rose-700 hover:bg-rose-50 font-medium flex items-center gap-1.5"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        Sign Out
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      <AuthModal isOpen={isAuthModalOpen} onClose={closeAuthModal} />
    </>
  );
};
