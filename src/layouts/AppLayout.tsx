import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Header } from '../components/common/Header';
import { Sidebar } from '../components/common/Sidebar';
import { ToastContainer } from '../components/common/ToastContainer';

export const AppLayout: React.FC = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col text-slate-900">
      <Header onToggleMobileMenu={() => setMobileMenuOpen(!mobileMenuOpen)} />

      <div className="flex-1 flex">
        <Sidebar
          mobileOpen={mobileMenuOpen}
          onCloseMobile={() => setMobileMenuOpen(false)}
        />

        <main className="flex-1 md:ml-64 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          <Outlet />
        </main>
      </div>

      <ToastContainer />
    </div>
  );
};
