import React from 'react';
import { NavLink, useLocation, useParams } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
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

interface SidebarLinkItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
}

export const Sidebar: React.FC<SidebarProps> = ({ mobileOpen, onCloseMobile }) => {
  const { consultations, notifications } = useApp();
  const { activeWorkspace, isPlatformAdmin, hasPermission } = useAuth();
  const { orgSlug: routeOrgSlug } = useParams<{ orgSlug?: string }>();
  const location = useLocation();

  const pendingRequests = consultations.filter(
    (c) => c.consultation_status === 'pending'
  ).length;
  const activeChats = consultations.filter(
    (c) => c.consultation_status === 'active'
  ).length;
  const unreadNotifs = notifications.filter((n) => !n.is_read).length;

  const isPlatformRoute = location.pathname.startsWith('/platform');
  const isGlobalHubRoute =
    location.pathname === '/workspaces' || location.pathname === '/accept-invite';

  const effectiveSlug =
    routeOrgSlug || activeWorkspace?.organization_slug || '';
  const orgId = activeWorkspace?.organization_id || '';

  const buildLinks = (): { title: string; links: SidebarLinkItem[] } => {
    if (isPlatformRoute) {
      return {
        title: 'Platform Governance',
        links: [
          {
            to: '/platform/applications',
            label: 'Clinic Applications',
            icon: ShieldCheck,
          },
          {
            to: '/platform/organizations',
            label: 'Organizations',
            icon: Building2,
          },
          { to: '/workspaces', label: 'My Workspaces', icon: LayoutGrid },
        ],
      };
    }

    if (isGlobalHubRoute || !effectiveSlug) {
      const globalLinks: SidebarLinkItem[] = [
        { to: '/workspaces', label: 'My Workspaces', icon: LayoutGrid },
        { to: '/accept-invite', label: 'Accept Staff Invite', icon: Ticket },
      ];
      if (isPlatformAdmin) {
        globalLinks.push({
          to: '/platform/applications',
          label: 'Platform Console',
          icon: ShieldCheck,
        });
      }
      return {
        title: 'Pet Connect Hub',
        links: globalLinks,
      };
    }

    const prefix = `/${effectiveSlug}`;

    if (location.pathname.includes('/doctor/') || activeWorkspace?.portal === 'doctor') {
      return {
        title: `${activeWorkspace?.organization_name || 'Clinical'} — Doctor`,
        links: [
          { to: `${prefix}/doctor/dashboard`, label: 'Doctor Dashboard', icon: LayoutDashboard },
          { to: `${prefix}/doctor/requests`, label: 'Appointments', icon: CalendarCheck, badge: pendingRequests },
          { to: `${prefix}/doctor/consultations`, label: 'Consultations', icon: ClipboardList, badge: activeChats },
          { to: `${prefix}/doctor/chat`, label: 'Chat Sessions', icon: MessageSquare },
          { to: `${prefix}/doctor/patients`, label: 'Patients Directory', icon: PawPrint },
          { to: `${prefix}/doctor/prescriptions`, label: 'Prescriptions', icon: FileText },
          { to: `${prefix}/doctor/medical-records`, label: 'Medical & Vaccines', icon: FileCheck },
          { to: `${prefix}/doctor/availability`, label: 'Branches & Schedule', icon: Clock },
          { to: `${prefix}/doctor/profile`, label: 'Doctor Profile', icon: User },
          { to: `${prefix}/doctor/settings`, label: 'Settings', icon: Settings },
          { to: '/workspaces', label: 'Switch Workspace', icon: LayoutGrid },
        ],
      };
    }

    if (location.pathname.includes('/admin/') || activeWorkspace?.portal === 'admin') {
      const adminLinks: SidebarLinkItem[] = [
        { to: `${prefix}/admin/dashboard`, label: 'Admin Dashboard', icon: LayoutDashboard },
      ];

      if (
        !orgId ||
        hasPermission(orgId, 'clients.approve') ||
        hasPermission(orgId, 'staff.manage') ||
        hasPermission(orgId, 'branch.manage')
      ) {
        adminLinks.push({
          to: `${prefix}/admin/onboarding`,
          label: 'Onboarding & Access',
          icon: UserPlus,
        });
      }

      if (
        !orgId ||
        hasPermission(orgId, 'branch.manage') ||
        hasPermission(orgId, 'schedules.manage')
      ) {
        adminLinks.push({
          to: `${prefix}/admin/branches`,
          label: 'Branches',
          icon: Building2,
        });
      }

      if (!orgId || hasPermission(orgId, 'clients.read')) {
        adminLinks.push({ to: `${prefix}/admin/clients`, label: 'Client Management', icon: Users });
      }
      adminLinks.push({ to: `${prefix}/admin/doctors`, label: 'Doctor Management', icon: Stethoscope });
      if (!orgId || hasPermission(orgId, 'pets.read')) {
        adminLinks.push({ to: `${prefix}/admin/pets`, label: 'Pet Directory', icon: PawPrint });
      }
      if (!orgId || hasPermission(orgId, 'appointments.read') || hasPermission(orgId, 'consultations.manage')) {
        adminLinks.push({
          to: `${prefix}/admin/consultations`,
          label: 'Appointments & Cases',
          icon: CalendarCheck,
          badge: pendingRequests,
        });
      }
      if (!orgId || hasPermission(orgId, 'audit.read') || hasPermission(orgId, 'medical_records.read')) {
        adminLinks.push(
          { to: `${prefix}/admin/prescriptions`, label: 'Prescription Audit', icon: FileText },
          { to: `${prefix}/admin/medical-records`, label: 'Medical Records', icon: ClipboardList }
        );
      }
      if (!orgId || hasPermission(orgId, 'audit.read')) {
        adminLinks.push(
          { to: `${prefix}/admin/payments`, label: 'Payment Ledger', icon: CreditCard },
          { to: `${prefix}/admin/reports`, label: 'Analytics & Reports', icon: BarChart3 }
        );
      }
      if (!orgId || hasPermission(orgId, 'org.manage') || hasPermission(orgId, 'branch.manage') || hasPermission(orgId, 'staff.manage')) {
        adminLinks.push({ to: `${prefix}/admin/settings`, label: 'Services & Settings', icon: Settings });
      }

      adminLinks.push({ to: '/workspaces', label: 'Switch Workspace', icon: LayoutGrid });

      return {
        title: `${activeWorkspace?.organization_name || 'Clinic'} — Admin`,
        links: adminLinks,
      };
    }

    return {
      title: `${activeWorkspace?.organization_name || 'Pet Owner'} — Client`,
      links: [
        { to: `${prefix}/client/dashboard`, label: 'Dashboard', icon: LayoutDashboard },
        { to: `${prefix}/client/pets`, label: 'My Pets', icon: PawPrint },
        { to: `${prefix}/client/doctors`, label: 'Find a Doctor', icon: Stethoscope },
        { to: `${prefix}/client/consultations`, label: 'Appointments & Chats', icon: CalendarCheck, badge: activeChats },
        { to: `${prefix}/client/chat`, label: 'Consultation Chat', icon: MessageSquare },
        { to: `${prefix}/client/prescriptions`, label: 'Prescriptions', icon: FileText },
        { to: `${prefix}/client/medical-records`, label: 'Medical Records', icon: ClipboardList },
        { to: `${prefix}/client/payments`, label: 'Payments & Billing', icon: CreditCard },
        { to: `${prefix}/client/notifications`, label: 'Notifications', icon: Bell, badge: unreadNotifs },
        { to: `${prefix}/client/organizations`, label: 'Clinics & Access', icon: Building2 },
        { to: `${prefix}/client/profile`, label: 'Client Profile', icon: User },
        { to: `${prefix}/client/settings`, label: 'Settings', icon: Settings },
        { to: '/workspaces', label: 'Switch Workspace', icon: LayoutGrid },
      ],
    };
  };

  const { title, links: currentLinks } = buildLinks();

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
              {title}
            </span>
            <button
              onClick={onCloseMobile}
              className="p-1 rounded-md text-slate-400 hover:text-slate-600"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="px-3 pb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400 truncate">
            {title}
          </div>

          <nav className="space-y-1">
            {currentLinks.map((link) => {
              const Icon = link.icon;
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
                      {Boolean(link.badge) && (
                        <span
                          className={`px-1.5 py-0.5 text-[11px] font-bold rounded-full ${
                            isActive
                              ? 'bg-teal-800 text-white'
                              : 'bg-teal-100 text-teal-800'
                          }`}
                        >
                          {link.badge}
                        </span>
                      )}
                    </>
                  )}
                </NavLink>
              );
            })}
          </nav>
        </div>

        <div className="p-3.5 m-3 rounded-xl bg-teal-50/70 border border-teal-200/80">
          <div className="flex items-center gap-2 text-xs font-bold text-teal-900">
            <ShieldCheck className="w-4 h-4 text-teal-700 shrink-0" />
            <span>Tenant-Isolated Access</span>
          </div>
          <p className="text-[11px] text-teal-800/90 mt-1 leading-relaxed">
            Your workspace permissions and 7-day clinical chat sessions are scoped to the active veterinary organization.
          </p>
        </div>
      </aside>
    </>
  );
};
