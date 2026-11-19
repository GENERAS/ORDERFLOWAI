import { Suspense, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { PageLoader } from '../../components/ui/PageLoader';
import { ConfigNotice } from '../../components/layout/ConfigNotice';
import { PlatformHeader } from './PlatformHeader';
import { PlatformSidebar } from './PlatformSidebar';

export function PlatformLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  useLockBodyScroll(sidebarOpen && !isDesktop);

  return (
    <div className="min-h-full bg-slate-50">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-brand-700 focus:shadow-lg"
      >
        Skip to main content
      </a>

      <PlatformSidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="lg:pl-64">
        <PlatformHeader onOpenSidebar={() => setSidebarOpen(true)} />
        <main
          id="main-content"
          className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8"
        >
          <ConfigNotice />
          <Suspense fallback={<PageLoader />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
