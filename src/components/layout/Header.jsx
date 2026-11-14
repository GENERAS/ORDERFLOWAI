import { useEffect, useRef, useState } from 'react';
import {
  Bell,
  Building2,
  Check,
  ChevronDown,
  LogOut,
  Menu,
  Search,
  Settings,
} from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { findNavigationItem } from '../../config/navigation';
import { useAuth } from '../../features/auth/authContext';
import { cn } from '../../utils/cn';

const roleLabels = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Manager',
  staff: 'Staff',
};

function getInitials(value) {
  const parts = String(value ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return 'U';
  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

export function Header({ onOpenSidebar }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const {
    user,
    profile,
    memberships,
    activeBusiness,
    activeMembership,
    activeBusinessId,
    selectBusiness,
    signOut,
  } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuError, setMenuError] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const menuRef = useRef(null);
  const buttonRef = useRef(null);

  const currentItem = findNavigationItem(pathname);
  const title = currentItem?.label ?? 'Dashboard';
  const displayName = profile?.fullName || user?.email || 'Account';
  const initials = getInitials(displayName);

  useEffect(() => {
    if (!menuOpen) return undefined;

    const handlePointerDown = (event) => {
      if (
        menuRef.current?.contains(event.target) ||
        buttonRef.current?.contains(event.target)
      ) {
        return;
      }
      setMenuOpen(false);
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  const handleSelectBusiness = (businessId) => {
    selectBusiness(businessId);
    setMenuOpen(false);
    navigate('/overview');
  };

  const handleSignOut = async () => {
    setMenuError('');
    setSigningOut(true);
    try {
      await signOut();
      navigate('/login', { replace: true });
    } catch (error) {
      setMenuError(error.message);
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/80 backdrop-blur">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={onOpenSidebar}
          className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-medium uppercase tracking-wider text-slate-400">
            {activeBusiness?.name ?? 'Workspace'}
          </p>
          <h1 className="truncate text-base font-semibold text-slate-900">{title}</h1>
        </div>

        <form
          className="hidden md:block"
          role="search"
          onSubmit={(event) => event.preventDefault()}
        >
          <label htmlFor="global-search" className="sr-only">
            Search products, orders and customers
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              id="global-search"
              type="search"
              placeholder="Search products, orders, customers…"
              className="h-9 w-56 rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 lg:w-72"
            />
          </div>
        </form>

        <button
          type="button"
          className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" aria-hidden="true" />
        </button>

        <div className="relative">
          <button
            ref={buttonRef}
            type="button"
            onClick={() => {
              setMenuOpen((current) => !current);
              setMenuError('');
            }}
            className="flex items-center gap-2 rounded-lg p-1.5 pr-2 hover:bg-slate-100"
            aria-label="Open account menu"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">
              {initials}
            </span>
            <span className="hidden text-left sm:block">
              <span className="block max-w-32 truncate text-xs font-semibold text-slate-800">
                {displayName}
              </span>
              <span className="block text-[11px] text-slate-400">
                {roleLabels[activeMembership?.role] ?? 'Workspace member'}
              </span>
            </span>
            <ChevronDown
              className={cn(
                'hidden h-4 w-4 text-slate-400 transition-transform sm:block',
                menuOpen && 'rotate-180',
              )}
              aria-hidden="true"
            />
          </button>

          {menuOpen ? (
            <div
              ref={menuRef}
              role="menu"
              aria-label="Account and workspace menu"
              className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-200/70"
            >
              <div className="border-b border-slate-200 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Signed in as
                </p>
                <p className="mt-1 truncate text-sm font-medium text-slate-900">
                  {user?.email ?? displayName}
                </p>
              </div>

              <div className="border-b border-slate-200 px-2 py-2">
                <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Workspace
                </p>
                <div className="space-y-1">
                  {memberships.map((membership) => {
                    const isActive = membership.business.id === activeBusinessId;
                    return (
                      <button
                        key={membership.id}
                        type="button"
                        role="menuitem"
                        onClick={() => handleSelectBusiness(membership.business.id)}
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                          isActive
                            ? 'bg-brand-50 text-brand-800'
                            : 'text-slate-700 hover:bg-slate-100',
                        )}
                      >
                        <span
                          className={cn(
                            'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                            isActive
                              ? 'bg-brand-100 text-brand-700'
                              : 'bg-slate-100 text-slate-500',
                          )}
                        >
                          <Building2 className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">
                            {membership.business.name}
                          </span>
                          <span className="block truncate text-xs text-slate-400">
                            {roleLabels[membership.role] ?? membership.role}
                          </span>
                        </span>
                        {isActive ? (
                          <Check className="h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
                <Link
                  to="/workspaces"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                  className="mt-1 flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold text-brand-700 hover:bg-brand-50"
                >
                  Manage workspaces
                </Link>
              </div>

              <div className="p-2">
                <Link
                  to="/settings"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-slate-700 hover:bg-slate-100"
                >
                  <Settings className="h-4 w-4 text-slate-400" aria-hidden="true" />
                  Workspace settings
                </Link>
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleSignOut}
                  disabled={signingOut}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <LogOut className="h-4 w-4 text-red-500" aria-hidden="true" />
                  {signingOut ? 'Signing out…' : 'Sign out'}
                </button>
                {menuError ? (
                  <p className="px-2.5 pt-1 text-xs text-red-600">{menuError}</p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
