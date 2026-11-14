import { LogOut, UserRound } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../features/auth/authContext';
import { Button } from '../ui/Button';
import { ConfigNotice } from './ConfigNotice';

export function SetupShell({ children }) {
  const navigate = useNavigate();
  const { user, profile, signOut } = useAuth();
  const displayName = profile?.fullName || user?.email || 'Account';

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch {
      // The provider clears local state even when the network sign-out fails.
    }
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center gap-2.5 rounded-lg">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
              OF
            </span>
            <span className="flex flex-col leading-tight">
              <span className="text-sm font-semibold tracking-tight text-slate-900">
                OrderFlow AI
              </span>
              <span className="text-[11px] font-medium text-slate-400">
                Business workspace
              </span>
            </span>
          </Link>

          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 sm:flex">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                <UserRound className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="max-w-48 truncate text-xs font-medium text-slate-600">
                {displayName}
              </span>
            </div>
            <Button variant="secondary" size="sm" onClick={handleSignOut}>
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <ConfigNotice />
        {children}
      </main>
    </div>
  );
}
