import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { WorkspaceOption } from '../../types/auth';
import {
  getInitials,
  resolveNotificationUrl,
} from '../../utils/listManagementHelpers';
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
  Mail,
  MailOpen,
  ArrowRight,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AuthModal } from './AuthModal';

interface HeaderProps {
  onToggleMobileMenu: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onToggleMobileMenu }) => {
  const {
    notifications,
    toggleNotificationRead,
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
  const location = useLocation();
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showWorkspaceMenu, setShowWorkspaceMenu] = useState(false);
  const [avatarLoadError, setAvatarLoadError] = useState(false);

  const headerMenusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (
        headerMenusRef.current &&
        !headerMenusRef.current.contains(event.target as Node)
      ) {
        setShowNotifications(false);
        setShowProfileMenu(false);
        setShowWorkspaceMenu(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowNotifications(false);
        setShowProfileMenu(false);
        setShowWorkspaceMenu(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const displayName =
    profile?.full_name || user?.user_metadata?.full_name || user?.email || 'Account';
  const displayEmail = profile?.email || user?.email || '';
  const initials = getInitials(displayName);
  const customAvatarUrl = !avatarLoadError ? profile?.avatar_url : '';

  const closeAllMenus = () => {
    setShowNotifications(false);
    setShowProfileMenu(false);
    setShowWorkspaceMenu(false);
  };

  const handleSelectWorkspace = (ws: WorkspaceOption) => {
    setActiveWorkspaceByKey(ws.key);
    closeAllMenus();
    navigate(ws.default_path);
  };

  const handleSignOut = async () => {
    closeAllMenus();
    try {
      await signOut();
      showToast('Signed out cleanly.', 'info');
      navigate('/login');
    } catch {
      navigate('/login');
    }
  };

  const notificationsCenterRoute = (() => {
    if (location.pathname.startsWith('/platform') || activeWorkspace?.portal === 'platform') {
      return '/platform/notifications';
    }
    const slug = activeWorkspace?.organization_slug;
    if (slug && (location.pathname.includes('/doctor/') || activeWorkspace?.portal === 'doctor')) {
      return `/${slug}/doctor/notifications`;
    }
    if (slug && (location.pathname.includes('/admin/') || activeWorkspace?.portal === 'admin')) {
      return `/${slug}/admin/notifications`;
    }
    if (slug && (location.pathname.includes('/client/') || activeWorkspace?.portal === 'client')) {
      return `/${slug}/client/notifications`;
    }
    return '/notifications';
  })();

  const profileRoute =
    activeWorkspace?.portal === 'doctor' && activeWorkspace.organization_slug
      ? `/${activeWorkspace.organization_slug}/doctor/profile`
      : activeWorkspace?.portal === 'client' && activeWorkspace.organization_slug
      ? `/${activeWorkspace.organization_slug}/client/profile`
      : activeWorkspace?.portal === 'admin' && activeWorkspace.organization_slug
      ? `/${activeWorkspace.organization_slug}/admin/settings`
      : activeWorkspace?.portal === 'platform' || location.pathname.startsWith('/platform')
      ? '/platform/settings'
      : '/workspaces';

  return (
    <>
      <header ref={headerMenusRef} className="sticky top-0 z-40 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          {/* Brand & Mobile Hamburger */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={onToggleMobileMenu}
              className="md:hidden p-2 rounded-lg text-slate-600 hover:bg-slate-100"
              aria-label="Toggle navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>

            <button
              type="button"
              onClick={() => {
                closeAllMenus();
                navigate(activeWorkspace ? activeWorkspace.default_path : '/workspaces');
              }}
              className="flex items-center gap-2.5 text-left group select-none min-w-0"
            >
              <div className="w-10 h-10 rounded-xl bg-teal-700 flex items-center justify-center text-white shadow-sm group-hover:bg-teal-800 transition-colors shrink-0">
                <HeartHandshake className="w-6 h-6" />
              </div>
              <div className="min-w-0">
                <div className="text-lg font-bold tracking-tight text-slate-900 leading-tight truncate">
                  PET CONNECT
                </div>
                <div className="text-[11px] font-medium text-teal-700 tracking-wide uppercase truncate">
                  Veterinary Platform
                </div>
              </div>
            </button>
          </div>

          {/* Authenticated Workspace Switcher */}
          <div className="hidden md:flex items-center gap-2 relative">
            {user && (
              <div className="relative">
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={showWorkspaceMenu}
                  onClick={() => {
                    setShowNotifications(false);
                    setShowProfileMenu(false);
                    setShowWorkspaceMenu((prev) => !prev);
                  }}
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
                          closeAllMenus();
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
                onClick={() => {
                  closeAllMenus();
                  navigate('/platform/dashboard');
                }}
                className="px-3 py-1.5 text-xs font-bold rounded-xl bg-slate-900 text-white hover:bg-slate-800 flex items-center gap-1.5 whitespace-nowrap"
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
                type="button"
                onClick={openAuthModal}
                className="px-3 py-1.5 text-xs font-semibold rounded-xl border bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:bg-slate-50 flex items-center gap-1.5"
              >
                <Lock className="w-3.5 h-3.5 text-slate-500" />
                <span>Sign In</span>
              </button>
            )}

            {/* Notifications Dropdown */}
            {user && (
              <div className="relative">
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={showNotifications}
                  onClick={() => {
                    setShowProfileMenu(false);
                    setShowWorkspaceMenu(false);
                    setShowNotifications((prev) => !prev);
                  }}
                  className="relative p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
                  aria-label="View notifications"
                >
                  <Bell className="w-5 h-5" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 bg-teal-700 text-white text-[10px] font-bold rounded-full flex items-center justify-center tabular-nums">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </button>

                {showNotifications && (
                  <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-xl shadow-xl border border-slate-200 py-2 z-50">
                    <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-slate-900">
                        Notifications{' '}
                        {unreadCount > 0 && (
                          <span className="text-xs font-mono text-teal-700 tabular-nums">
                            ({unreadCount} unread)
                          </span>
                        )}
                      </div>
                      {unreadCount > 0 && (
                        <button
                          type="button"
                          onClick={() => void markAllNotificationsRead()}
                          className="text-xs text-teal-700 hover:text-teal-800 font-semibold flex items-center gap-1"
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
                        notifications.slice(0, 12).map((n) => {
                          const resolved = resolveNotificationUrl(n.link_url, activeWorkspace);
                          return (
                            <div
                              key={n.id}
                              onClick={() => {
                                void markNotificationRead(n.id).catch(() => {});
                                if (resolved) {
                                  navigate(resolved);
                                }
                                setShowNotifications(false);
                              }}
                              className={`p-3.5 hover:bg-slate-50 cursor-pointer transition-colors ${
                                !n.is_read ? 'bg-teal-50/50' : ''
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  {!n.is_read && (
                                    <span className="w-2 h-2 rounded-full bg-teal-600 shrink-0" />
                                  )}
                                  <span className="text-xs font-semibold text-slate-800 truncate">
                                    {n.title}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  title={n.is_read ? 'Mark unread' : 'Mark read'}
                                  aria-label={n.is_read ? 'Mark notification unread' : 'Mark notification read'}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void toggleNotificationRead(n.id, !n.is_read).catch(() => {});
                                  }}
                                  className="p-1 rounded text-slate-400 hover:text-teal-700 hover:bg-white shrink-0"
                                >
                                  {n.is_read ? (
                                    <Mail className="w-3.5 h-3.5" />
                                  ) : (
                                    <MailOpen className="w-3.5 h-3.5 text-teal-700" />
                                  )}
                                </button>
                              </div>
                              <p className="text-xs text-slate-600 mt-1 line-clamp-2">
                                {n.message}
                              </p>
                              <div className="text-[10px] text-slate-400 mt-1 font-mono tabular-nums">
                                {new Date(n.created_at).toLocaleString()}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                    <div className="border-t border-slate-100 pt-1.5 px-3">
                      <button
                        type="button"
                        onClick={() => {
                          setShowNotifications(false);
                          navigate(notificationsCenterRoute);
                        }}
                        className="w-full py-1.5 px-2 text-xs font-bold text-teal-700 hover:bg-teal-50 rounded-lg flex items-center justify-between"
                      >
                        <span>Open Notification Center</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* User Profile Menu */}
            {user && (
              <div className="relative">
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={showProfileMenu}
                  onClick={() => {
                    setShowNotifications(false);
                    setShowWorkspaceMenu(false);
                    setShowProfileMenu((prev) => !prev);
                  }}
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
                  {customAvatarUrl ? (
                    <img
                      src={customAvatarUrl}
                      alt={displayName}
                      onError={() => setAvatarLoadError(true)}
                      className="w-8 h-8 rounded-lg object-cover border border-slate-300"
                    />
                  ) : (
                    <div
                      aria-hidden="true"
                      className="w-8 h-8 rounded-lg bg-teal-700 text-white font-bold text-xs flex items-center justify-center border border-teal-800 shrink-0"
                    >
                      {initials}
                    </div>
                  )}
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
                          Verified Session
                        </span>
                      </div>
                    </div>

                    <div className="py-1">
                      <button
                        type="button"
                        onClick={() => {
                          navigate('/workspaces');
                          closeAllMenus();
                        }}
                        className="w-full text-left px-3.5 py-1.5 text-xs text-slate-700 hover:bg-slate-100 font-medium"
                      >
                        My Workspaces & Clinics
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          navigate(notificationsCenterRoute);
                          closeAllMenus();
                        }}
                        className="w-full text-left px-3.5 py-1.5 text-xs text-slate-700 hover:bg-slate-100 font-medium flex items-center justify-between"
                      >
                        <span>Notifications</span>
                        {unreadCount > 0 && (
                          <span className="px-1.5 py-0.5 rounded-full bg-teal-100 text-teal-800 text-[10px] font-bold tabular-nums">
                            {unreadCount}
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          navigate(profileRoute);
                          closeAllMenus();
                        }}
                        className="w-full text-left px-3.5 py-1.5 text-xs text-slate-700 hover:bg-slate-100 font-medium"
                      >
                        Portal Settings & Profile
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleSignOut()}
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
