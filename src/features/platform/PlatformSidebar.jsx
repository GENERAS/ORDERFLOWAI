import { Link, NavLink } from 'react-router-dom';
import { ArrowLeft, X } from 'lucide-react';
import { platformNavigationItems } from '../../config/platformNavigation';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useAuth } from '../auth/authContext';
import { cn } from '../../utils/cn';

export function PlatformSidebar({ open = false, onClose = () => {} }) {
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const isHidden = !isDesktop && !open;
  const { platform, memberships } = useAuth();
  const hasWorkspace = memberships.length > 0;

  const closeOnMobile = () => {
    if (!isDesktop) onClose();
  };

  return (
    <>
      <div
        className={cn(
          'fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm transition-opacity lg:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        aria-hidden="true"
        onClick={onClose}
      />
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-slate-200 bg-white transition-transform duration-200 lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-label="Platform navigation"
        aria-hidden={isHidden || undefined}
        inert={isHidden ? true : undefined}
      >
        <div className="flex h-16 items-center justify-between border-b border-slate-200 px-4">
          <NavLink
            to="/platform/overview"
            onClick={closeOnMobile}
            className="flex items-center gap-2.5 rounded-lg"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-xs font-bold text-white">
              OF
            </span>
            <span className="flex flex-col leading-tight">
              <span className="text-sm font-semibold tracking-tight text-slate-900">
                OrderFlow AI
              </span>
              <span className="text-[11px] font-medium text-slate-400">
                Platform Administration
              </span>
            </span>
          </NavLink>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden"
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <nav aria-label="Platform modules" className="flex-1 overflow-y-auto px-3 py-4">
          <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Platform
          </p>
          <ul className="space-y-1">
            {platformNavigationItems.map(({ label, to, icon: Icon }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  onClick={closeOnMobile}
                  className={({ isActive }) =>
                    cn(
                      'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon
                        aria-hidden="true"
                        className={cn(
                          'h-[18px] w-[18px] shrink-0',
                          isActive ? 'text-white' : 'text-slate-400',
                        )}
                      />
                      <span className="flex-1">{label}</span>
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="border-t border-slate-200 p-4">
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Access level
            </p>
            <p className="mt-1 text-xs font-semibold text-slate-700">
              {platform?.isSuperAdmin ? 'Super Admin' : 'Platform access'}
            </p>
            {platform?.supportBusinessIds?.length ? (
              <p className="mt-1 text-[11px] text-amber-700">
                Support access is active
              </p>
            ) : null}
            <Link
              to={hasWorkspace ? '/overview' : '/workspaces'}
              onClick={closeOnMobile}
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 hover:text-brand-800"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              {hasWorkspace ? 'Return to workspace' : 'Open workspaces'}
            </Link>
          </div>
        </div>
      </aside>
    </>
  );
}
