import { Link, NavLink } from 'react-router-dom';
import { Building2, X } from 'lucide-react';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { navigationItems } from '../../config/navigation';
import { useAuth } from '../../features/auth/authContext';
import { cn } from '../../utils/cn';

const roleLabels = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Manager',
  staff: 'Staff',
};

export function Sidebar({ open = false, onClose = () => {} }) {
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const isHidden = !isDesktop && !open;
  const { memberships, activeBusiness, activeMembership } = useAuth();

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
        aria-label="Primary navigation"
        aria-hidden={isHidden || undefined}
        inert={isHidden ? true : undefined}
      >
        <div className="flex h-16 items-center justify-between border-b border-slate-200 px-4">
          <NavLink
            to="/overview"
            onClick={closeOnMobile}
            className="flex items-center gap-2.5 rounded-lg"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
              OF
            </span>
            <span className="flex flex-col leading-tight">
              <span className="text-sm font-semibold tracking-tight text-slate-900">
                OrderFlow AI
              </span>
              <span className="text-[11px] font-medium text-slate-400">Business workspace</span>
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

        <nav aria-label="Modules" className="flex-1 overflow-y-auto px-3 py-4">
          <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Workspace
          </p>
          <ul className="space-y-1">
            {navigationItems.map(({ label, to, icon: Icon }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  onClick={closeOnMobile}
                  className={({ isActive }) =>
                    cn(
                      'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-brand-50 text-brand-700'
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
                          isActive
                            ? 'text-brand-600'
                            : 'text-slate-400 group-hover:text-slate-600',
                        )}
                      />
                      <span>{label}</span>
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="border-t border-slate-200 p-4">
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="flex items-start gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-slate-500 ring-1 ring-slate-200">
                <Building2 className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Active workspace
                </p>
                <p className="truncate text-xs font-semibold text-slate-700">
                  {activeBusiness?.name ?? 'Workspace'}
                </p>
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {roleLabels[activeMembership?.role] ?? 'Member'}
              {activeBusiness?.currency ? ` · ${activeBusiness.currency}` : ''}
            </p>
            {memberships.length > 1 ? (
              <Link
                to="/workspaces"
                onClick={closeOnMobile}
                className="mt-2 inline-block text-xs font-semibold text-brand-700 hover:text-brand-800"
              >
                Switch workspace
              </Link>
            ) : null}
          </div>
        </div>
      </aside>
    </>
  );
}
