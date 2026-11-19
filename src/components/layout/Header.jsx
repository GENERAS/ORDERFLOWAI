import { useEffect, useRef, useState } from 'react';
import {
  Bell,
  Building2,
  Check,
  ChevronDown,
  CreditCard,
  Loader2,
  LogOut,
  Menu,
  MessageCircleMore,
  Package,
  Search,
  Settings,
  ShoppingCart,
  Store,
  Users,
} from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { findNavigationItem } from '../../config/navigation';
import { useAuth } from '../../features/auth/authContext';
import {
  listWorkspaceNotifications,
  markWorkspaceNotificationRead,
  searchWorkspace,
} from '../../services/workspaceSearchService';
import { cn } from '../../utils/cn';
import { Badge } from '../ui/Badge';
import { EmptyState } from '../ui/EmptyState';

const roleLabels = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Manager',
  staff: 'Staff',
};

const resultMeta = {
  product: { icon: Package, label: 'Product', variant: 'brand' },
  customer: { icon: Users, label: 'Customer', variant: 'neutral' },
  order: { icon: ShoppingCart, label: 'Order', variant: 'success' },
};

const notificationMeta = {
  storefront_order: { icon: Store, className: 'bg-amber-50 text-amber-600' },
  payment: { icon: CreditCard, className: 'bg-red-50 text-red-600' },
  conversation: {
    icon: MessageCircleMore,
    className: 'bg-brand-50 text-brand-600',
  },
  cancelled_order: { icon: ShoppingCart, className: 'bg-slate-100 text-slate-500' },
};

function getResultMeta(resultType) {
  return resultMeta[resultType] ?? {
    icon: Search,
    label: 'Result',
    variant: 'neutral',
  };
}

function getNotificationMeta(resultType) {
  return notificationMeta[resultType] ?? {
    icon: Bell,
    className: 'bg-slate-100 text-slate-500',
  };
}

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

function formatRelativeTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;

  return date.toLocaleDateString();
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

  const businessId = activeBusiness?.id ?? null;
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuError, setMenuError] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState('');

  const accountButtonRef = useRef(null);
  const accountMenuRef = useRef(null);
  const searchRef = useRef(null);
  const notificationRef = useRef(null);
  const searchRequestRef = useRef(0);

  const currentItem = findNavigationItem(pathname);
  const title = currentItem?.label ?? 'Dashboard';
  const displayName = profile?.fullName || user?.email || 'Account';
  const initials = getInitials(displayName);
  const normalizedSearchQuery = searchQuery.trim();
  const showSearchLoading = normalizedSearchQuery.length >= 2 && searchLoading;
  const unreadCount = notifications[0]?.unreadCount ?? 0;

  useEffect(() => {
    const query = searchQuery.trim();
    if (!searchOpen || !businessId || query.length < 2) return undefined;

    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;

    const timer = setTimeout(() => {
      setSearchLoading(true);
      setSearchError('');
      searchWorkspace({ businessId, query, limit: 8 })
        .then((results) => {
          if (requestId === searchRequestRef.current) setSearchResults(results);
        })
        .catch((error) => {
          if (requestId === searchRequestRef.current) {
            setSearchResults([]);
            setSearchError(error.message);
          }
        })
        .finally(() => {
          if (requestId === searchRequestRef.current) setSearchLoading(false);
        });
    }, 250);

    return () => clearTimeout(timer);
  }, [businessId, searchOpen, searchQuery]);

  useEffect(() => {
    if (!businessId) return undefined;

    let cancelled = false;
    void Promise.resolve().then(async () => {
      setNotificationsLoading(true);
      setNotificationsError('');
      try {
        const rows = await listWorkspaceNotifications({ businessId, limit: 20 });
        if (!cancelled) setNotifications(rows);
      } catch (error) {
        if (!cancelled) {
          setNotifications([]);
          setNotificationsError(error.message);
        }
      } finally {
        if (!cancelled) setNotificationsLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [businessId, notificationsOpen]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      const target = event.target;

      if (
        menuOpen &&
        !accountMenuRef.current?.contains(target) &&
        !accountButtonRef.current?.contains(target)
      ) {
        setMenuOpen(false);
      }
      if (searchOpen && !searchRef.current?.contains(target)) {
        setSearchOpen(false);
      }
      if (notificationsOpen && !notificationRef.current?.contains(target)) {
        setNotificationsOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      setSearchOpen(false);
      setNotificationsOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen, searchOpen, notificationsOpen]);

  const handleSelectBusiness = (workspaceId) => {
    selectBusiness(workspaceId);
    setMenuOpen(false);
    setSearchOpen(false);
    setNotificationsOpen(false);
    setSearchQuery('');
    setSearchResults([]);
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

  const handleSearchSubmit = (event) => {
    event.preventDefault();
    const firstResult = searchResults[0];
    if (!firstResult) return;
    navigate(firstResult.href);
    setSearchOpen(false);
    setSearchQuery('');
  };

  const handleResultSelect = () => {
    setSearchOpen(false);
    setSearchQuery('');
  };

  const handleNotificationOpen = (notification) => {
    setNotificationsOpen(false);

    if (!notification.isRead && businessId) {
      markWorkspaceNotificationRead({
        businessId,
        notificationKey: notification.notificationKey,
      })
        .then(() => {
          setNotifications((current) => {
            const nextUnreadCount = Math.max(
              0,
              (current[0]?.unreadCount ?? 1) - 1,
            );
            return current.map((item) =>
              item.notificationKey === notification.notificationKey
                ? {
                    ...item,
                    isRead: true,
                    readAt: new Date().toISOString(),
                    unreadCount: nextUnreadCount,
                  }
                : { ...item, unreadCount: nextUnreadCount },
            );
          });
        })
        .catch((error) => {
          setNotificationsError(error.message);
        });
    }

    navigate(notification.href);
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

        <div ref={searchRef} className="relative hidden md:block">
          <form className="relative" role="search" onSubmit={handleSearchSubmit}>
            <label htmlFor="global-search" className="sr-only">
              Search products, orders and customers
            </label>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              id="global-search"
              type="search"
              value={searchQuery}
              autoComplete="off"
              placeholder="Search products, orders, customers…"
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setSearchResults([]);
                setSearchError('');
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              aria-controls="workspace-search-results"
              aria-expanded={searchOpen}
              className="h-9 w-56 rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 lg:w-72"
            />
          </form>

          {searchOpen ? (
            <div
              id="workspace-search-results"
              role="dialog"
              aria-label="Workspace search results"
              className="absolute right-0 top-full z-50 mt-2 w-96 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-200/70"
            >
              {showSearchLoading ? (
                <div className="flex items-center gap-2 px-4 py-6 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Searching this workspace…
                </div>
              ) : normalizedSearchQuery.length >= 2 && searchError ? (
                <div className="px-4 py-4 text-sm text-red-600">{searchError}</div>
              ) : !businessId ? (
                <div className="px-4 py-4 text-sm text-slate-500">
                  Select a workspace to search.
                </div>
              ) : normalizedSearchQuery.length < 2 ? (
                <div className="px-4 py-4 text-sm text-slate-500">
                  Type at least 2 characters to search.
                </div>
              ) : searchResults.length === 0 ? (
                <EmptyState
                  icon={Search}
                  title="No results found"
                  description="Try a product name, SKU, order number, customer name, phone or email."
                  className="border-0 px-4 py-6"
                />
              ) : (
                <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
                  {searchResults.map((result) => {
                    const meta = getResultMeta(result.resultType);
                    const ResultIcon = meta.icon;
                    return (
                      <li key={`${result.resultType}-${result.id}`}>
                        <Link
                          to={result.href}
                          onClick={handleResultSelect}
                          className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-slate-50"
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                            <ResultIcon className="h-4 w-4" aria-hidden="true" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-slate-900">
                              {result.title}
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-slate-500">
                              {result.subtitle}
                            </span>
                          </span>
                          <Badge variant={meta.variant} className="shrink-0">
                            {meta.label}
                          </Badge>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : null}
        </div>

        <div ref={notificationRef} className="relative">
          <button
            type="button"
            onClick={() => {
              setNotificationsOpen((current) => !current);
              setSearchOpen(false);
              setMenuOpen(false);
            }}
            className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100"
            aria-label={
              unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'
            }
            aria-haspopup="dialog"
            aria-expanded={notificationsOpen}
          >
            <Bell className="h-5 w-5" aria-hidden="true" />
            {unreadCount > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            ) : null}
          </button>

          {notificationsOpen ? (
            <div
              role="dialog"
              aria-label="Notifications"
              className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-200/70"
            >
              <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
                <p className="text-sm font-semibold text-slate-900">Notifications</p>
                {unreadCount > 0 ? (
                  <Badge variant="danger">{unreadCount} unread</Badge>
                ) : null}
              </div>

              {businessId && notificationsLoading ? (
                <div className="flex items-center gap-2 px-4 py-6 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Loading notifications…
                </div>
              ) : businessId && notificationsError ? (
                <div className="px-4 py-4 text-sm text-red-600">
                  {notificationsError}
                </div>
              ) : !businessId ? (
                <div className="px-4 py-4 text-sm text-slate-500">
                  Select a workspace to see notifications.
                </div>
              ) : notifications.length === 0 ? (
                <EmptyState
                  icon={Bell}
                  title="All caught up"
                  description="New storefront orders, payment issues, unread messages and cancellations will appear here."
                  className="border-0 px-4 py-8"
                />
              ) : (
                <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
                  {notifications.map((notification) => {
                    const meta = getNotificationMeta(notification.resultType);
                    const NotificationIcon = meta.icon;
                    return (
                      <button
                        key={notification.notificationKey}
                        type="button"
                        onClick={() => handleNotificationOpen(notification)}
                        className={cn(
                          'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50',
                          !notification.isRead && 'bg-brand-50/40',
                        )}
                      >
                        <span
                          className={cn(
                            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                            meta.className,
                          )}
                        >
                          <NotificationIcon className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-slate-900">
                              {notification.title}
                            </span>
                            {!notification.isRead ? (
                              <span
                                className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500"
                                aria-hidden="true"
                              />
                            ) : null}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-slate-500">
                            {notification.subtitle}
                          </span>
                          <span className="mt-1 block text-[11px] text-slate-400">
                            {formatRelativeTime(notification.occurredAt)}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}
        </div>

        <div className="relative">
          <button
            ref={accountButtonRef}
            type="button"
            onClick={() => {
              setMenuOpen((current) => !current);
              setMenuError('');
              setSearchOpen(false);
              setNotificationsOpen(false);
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
              ref={accountMenuRef}
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
