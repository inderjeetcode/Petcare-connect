import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { resolvePortalLandingDecision } from '../../utils/workspaceAuth';
import {
  ArrowRight,
  Building2,
  CalendarCheck,
  FileText,
  HeartHandshake,
  Lock,
  MessageSquare,
  PawPrint,
  ShieldCheck,
  Stethoscope,
  Ticket,
} from 'lucide-react';

export const LandingPage: React.FC = () => {
  const { authStatus, isContextReady, myContext } = useAuth();
  const isAuthenticated =
    authStatus === 'authenticated' && isContextReady && Boolean(myContext);
  const continuePath = (() => {
    if (!isAuthenticated || !myContext) return '/login/client';
    const decision = resolvePortalLandingDecision(myContext, 'generic');
    if (decision.kind === 'redirect') return decision.path;
    return '/login/client';
  })();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Top Bar: 3-zone contract */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-xs border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
          <Link
            to="/"
            className="flex items-center gap-2.5 text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            <span className="w-9 h-9 rounded-xl bg-teal-700 text-white flex items-center justify-center shrink-0">
              <HeartHandshake className="w-5 h-5" />
            </span>
            <span>Pet Connect</span>
          </Link>

          <nav
            aria-label="Primary navigation"
            className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600"
          >
            <a
              href="#pet-owners"
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Pet Owners
            </a>
            <a
              href="#clinics"
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Clinics &amp; Staff
            </a>
            <a
              href="#capabilities"
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Clinical Workflows
            </a>
            <Link
              to="/accept-invite"
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Staff Invite
            </Link>
          </nav>

          <div className="flex items-center shrink-0">
            {isAuthenticated ? (
              <Link
                to={continuePath}
                className="px-4 py-2 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-xl transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-1.5"
              >
                Open Portal
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            ) : (
              <Link
                to="/login/client"
                className="px-4 py-2 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-xl transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-1.5"
              >
                Pet Owner Sign In
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero & Direct Entry Portals */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-16 lg:pt-20 lg:pb-24">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-stretch">
            <div className="lg:col-span-7 flex flex-col justify-center space-y-6">
              <div className="text-xs font-semibold uppercase tracking-wider text-teal-800">
                Multi-Clinic Veterinary Healthcare
              </div>

              <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-slate-900 leading-[1.1] max-w-2xl text-balance">
                Connected care for pet owners and veterinary teams.
              </h1>

              <p className="text-base text-slate-600 leading-relaxed max-w-xl">
                Pet Connect separates every veterinary hospital&apos;s clinical records, appointments, prescriptions, and 7-day consultation chats inside role-verified organization workspaces.
              </p>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <Link
                  to="/login/client"
                  className="px-5 py-3 text-sm font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-xl transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-2"
                >
                  <PawPrint className="w-4 h-4" />
                  Pet Owner Login &amp; Registration
                </Link>
                <Link
                  to="/login/clinic"
                  className="px-5 py-3 text-sm font-bold text-slate-800 bg-white border border-slate-300 hover:bg-slate-100 rounded-xl transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-2"
                >
                  <Stethoscope className="w-4 h-4 text-teal-700" />
                  Clinic &amp; Staff Login
                </Link>
              </div>

              <div className="pt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500">
                <span>Role-scoped PostgreSQL RLS</span>
                <span aria-hidden="true">·</span>
                <span>Clinic-approved patient access</span>
                <span aria-hidden="true">·</span>
                <span>Branch-aware veterinary scheduling</span>
              </div>
            </div>

            {/* Structured Entry Pathways */}
            <div className="lg:col-span-5 flex flex-col justify-between gap-4">
              <div
                id="pet-owners"
                className="bg-white rounded-2xl border border-slate-200 p-6 flex-1 flex flex-col justify-between gap-5"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-teal-800">
                      01 · Pet Owners
                    </span>
                    <PawPrint className="w-4 h-4 text-teal-700 shrink-0" />
                  </div>
                  <h2 className="text-lg font-bold text-slate-900">
                    Pet Owner Portal
                  </h2>
                  <p className="text-sm text-slate-600 leading-relaxed">
                    Sign in or create an account to request clinic access, manage pet profiles, schedule branch appointments, review prescriptions, and message your veterinarian.
                  </p>
                </div>
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
                  <span className="text-xs text-slate-500">
                    New owners can register online
                  </span>
                  <Link
                    to="/login/client"
                    className="text-xs font-bold text-teal-700 hover:text-teal-800 inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                  >
                    Enter Client Login
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>

              <div
                id="clinics"
                className="bg-white rounded-2xl border border-slate-200 p-6 flex-1 flex flex-col justify-between gap-5"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-600">
                      02 · Veterinary Hospitals
                    </span>
                    <Building2 className="w-4 h-4 text-teal-700 shrink-0" />
                  </div>
                  <h2 className="text-lg font-bold text-slate-900">
                    Clinic &amp; Staff Portal
                  </h2>
                  <p className="text-sm text-slate-600 leading-relaxed">
                    Authorized sign-in for Clinic Administrators, Veterinarians, Branch Managers, and Front Desk teams with verified clinic membership.
                  </p>
                </div>
                <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
                  <Link
                    to="/accept-invite"
                    className="text-xs font-medium text-slate-600 hover:text-slate-900 inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                  >
                    <Ticket className="w-3.5 h-3.5 text-teal-700" />
                    Accept Staff Invite
                  </Link>
                  <Link
                    to="/login/clinic"
                    className="text-xs font-bold text-teal-700 hover:text-teal-800 inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                  >
                    Enter Clinic Login
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Capabilities Strip */}
        <section
          id="capabilities"
          className="border-t border-slate-200 bg-white py-14 lg:py-16"
        >
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
            <div className="max-w-2xl space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-teal-800">
                Clinical Operations
              </div>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">
                Built around real clinic workflows and tenant isolation
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="p-5 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2">
                <CalendarCheck className="w-5 h-5 text-teal-700" />
                <h3 className="text-sm font-bold text-slate-900">
                  Branch Appointment Scheduling
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Conflict-free doctor slot booking across clinic branches with front-desk check-in and status tracking.
                </p>
              </div>

              <div className="p-5 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2">
                <MessageSquare className="w-5 h-5 text-teal-700" />
                <h3 className="text-sm font-bold text-slate-900">
                  7-Day Consultation Windows
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Structured veterinary chat sessions tied to active consultations with automatic 7-day lifecycle boundaries.
                </p>
              </div>

              <div className="p-5 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2">
                <FileText className="w-5 h-5 text-teal-700" />
                <h3 className="text-sm font-bold text-slate-900">
                  Medical Records &amp; Rx
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Digital prescriptions, clinical notes, vaccinations, and private clinic file attachments scoped to each hospital.
                </p>
              </div>

              <div className="p-5 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2">
                <ShieldCheck className="w-5 h-5 text-teal-700" />
                <h3 className="text-sm font-bold text-slate-900">
                  Database-Verified Access
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Every clinic portal, branch view, and clinical action is enforced by PostgreSQL Row Level Security.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-slate-50 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-2 font-semibold text-slate-700">
            <Lock className="w-3.5 h-3.5 text-teal-700" />
            <span>Pet Connect Veterinary Healthcare Platform</span>
          </div>
          <div className="flex items-center gap-5">
            <Link to="/login/client" className="hover:text-slate-900">
              Pet Owner Login
            </Link>
            <Link to="/login/clinic" className="hover:text-slate-900">
              Clinic Staff Login
            </Link>
            <Link to="/accept-invite" className="hover:text-slate-900">
              Staff Invitation
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
};
