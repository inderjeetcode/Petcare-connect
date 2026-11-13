import React from 'react';
import { NavLink, useLocation, useParams } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import {
  buildSidebarNavigation,
  SidebarIconKey,
} from '../../utils/navigationHelpers';
import {
  LayoutDashboard,
  PawPrint,
  Stethoscope,
  CalendarCheck,
  MessageSquare,
  FileText,
  ClipboardList,
  Bell,
  User,
  Settings,
  Users,
  Clock,
  ShieldCheck,
  BarChart3,
  CreditCard,
  FileCheck,
  Building2,
  UserPlus,
  LayoutGrid,
  Ticket,
  X,
} from 'lucide-react';

interface SidebarProps {
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const ICON_MAP: Record<SidebarIconKey, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  pets: PawPrint,
  doctors: Stethoscope,
  appointments: CalendarCheck,
  consultations: ClipboardList,
  chat: MessageSquare,
  prescriptions: FileText,
  medical_records: FileCheck,
  payments: CreditCard,
  notifications: Bell,
  organizations: Building2,
  profile: User,
  settings: Settings,
  workspaces: LayoutGrid,
  branches: Building2,
  onboarding: UserPlus,
  clients: Users,
  reports: BarChart3,
  schedules: Clock,
  platform_apps: ShieldCheck,
  platform_users: Users,
  invite: Ticket,
};

export const Sidebar: React.FC<SidebarProps> = ({ mobileOpen, onCloseMobile }) => {
  const { consultations, notifications } = useApp();
  const { myContext, availableWorkspaces, activeWorkspace } = useAuth();
  const { orgSlug: routeOrgSlug } = useParams<{ orgSlug?: string }>();
  const location = useLocation();

  const pendingRequests = consultations.filter(
    (c) => c.consultation_status === 'pending'
  ).length;
  const activeChats = consultations.filter(
    (c) => c.consultation_status === 'active'
  ).length;
  const unreadNotifs = notifications.filter((n) => !n.is_read).length;

  const navModel = buildSidebarNavigation({
    pathname: location.pathname,
    routeOrgSlug,
    myContext,
    availableWorkspaces,
    activeWorkspace,
    counts: {
      pendingRequests,
      activeChats,
      unreadNotifs,
    },
  });

  const isPlatformRoute = navModel.portal === 'platform';

  return (
    <>
      {mobileOpen && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-40 md:hidden"
        />
      )}

      <aside
        className={`fixed top-16 bottom-0 left-0 z-40 w-64 bg-white border-r border-slate-200 flex flex-col justify-between transition-transform duration-200 md:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex-1 overflow-y-auto px-3.5 py-4">
          <div className="flex items-center justify-between pb-3 mb-2 border-b border-slate-100 md:hidden">
            <span className="text-xs font-bold uppercase tracking-wider text-teal-800 truncate">
              {navModel.title}
            </span>
            <button
              type="button"
              onClick={onCloseMobile}
              aria-label="Close navigation menu"
              className="p-1 rounded-md text-slate-400 hover:text-slate-600"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="px-3 pb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400 truncate">
            {navModel.title}
          </div>

          {navModel.items.length === 0 ? (
            <div className="mx-2 mt-2 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 leading-relaxed">
              No portal links are active until organization authorization is verified.
            </div>
          ) : (
            <nav className="space-y-1">
              {navModel.items.map((link) => {
                const Icon = ICON_MAP[link.iconKey] || LayoutDashboard;
                return (
                  <NavLink
                    key={link.to}
                    to={link.to}
                    onClick={onCloseMobile}
                    className={({ isActive }) =>
                      `flex items-center justify-between px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                        isActive
                          ? 'bg-teal-700 text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <div className="flex items-center gap-3 min-w-0">
                          <Icon
                            className={`w-4 h-4 shrink-0 ${
                              isActive ? 'text-white' : 'text-slate-500'
                            }`}
                          />
                          <span className="truncate">{link.label}</span>
                        </div>
                        {Boolean(link.badgeCount) && (
                          <span
                            className={`px-1.5 py-0.5 text-[11px] font-bold rounded-full ${
                              isActive
                                ? 'bg-teal-800 text-white'
                                : 'bg-teal-100 text-teal-800'
                            }`}
                          >
                            {link.badgeCount}
                          </span>
                        )}
                      </>
                    )}
                  </NavLink>
                );
              })}
            </nav>
          )}
        </div>

        <div className="p-3.5 m-3 rounded-xl bg-teal-50/70 border border-teal-200/80">
          <div className="flex items-center gap-2 text-xs font-bold text-teal-900">
            <ShieldCheck className="w-4 h-4 text-teal-700 shrink-0" />
            <span>
              {isPlatformRoute ? 'Clinical Privacy Isolated' : 'Tenant-Isolated Access'}
            </span>
          </div>
          <p className="text-[11px] text-teal-800/90 mt-1 leading-relaxed">
            {isPlatformRoute
              ? 'Platform Owner actions are strictly audited and isolated from private clinical records, prescriptions, and patient chats.'
              : 'Your workspace permissions and 7-day clinical chat sessions are scoped to the active veterinary organization.'}
          </p>
        </div>
      </aside>
    </>
  );
};
