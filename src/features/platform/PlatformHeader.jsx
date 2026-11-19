import { Menu, ShieldCheck } from 'lucide-react';
import { useAuth } from '../auth/authContext';

export function PlatformHeader({ onOpenSidebar }) {
  const { platform, profile, user } = useAuth();

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6 lg:px-8">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenSidebar}
          className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
          aria-label="Open platform navigation"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
        <div>
          <p className="text-sm font-semibold text-slate-900">Platform Administration</p>
          <p className="text-xs text-slate-500">OrderFlow AI operations console</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="hidden items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white sm:inline-flex">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          {platform?.isSuperAdmin ? 'Super Admin' : 'Platform access'}
        </span>
        <div className="text-right">
          <p className="text-xs font-medium text-slate-700">
            {profile?.fullName ?? user?.email?.split('@')[0] ?? 'Administrator'}
          </p>
          <p className="text-[11px] text-slate-400">{user?.email ?? ''}</p>
        </div>
      </div>
    </header>
  );
}
