import { Link, Outlet } from 'react-router-dom';
import { ShieldCheck, Sparkles, Store } from 'lucide-react';
import { ConfigNotice } from '../../components/layout/ConfigNotice';

const highlights = [
  {
    icon: Store,
    title: 'One workspace per business',
    description: 'Keep products, orders and customer conversations separated by workspace.',
  },
  {
    icon: ShieldCheck,
    title: 'Permissions enforced in the database',
    description: 'Row Level Security keeps every business record isolated.',
  },
  {
    icon: Sparkles,
    title: 'Built for practical automation',
    description: 'Turn real conversations into organised orders without inventing data.',
  },
];

export function AuthLayout() {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto grid min-h-screen max-w-7xl lg:grid-cols-[1.05fr_1fr]">
        <aside className="relative hidden overflow-hidden bg-slate-950 px-10 py-10 text-white lg:flex lg:flex-col lg:justify-between">
          <div
            className="pointer-events-none absolute -right-24 top-16 h-72 w-72 rounded-full bg-brand-500/20 blur-3xl"
            aria-hidden="true"
          />
          <div
            className="pointer-events-none absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-emerald-400/10 blur-3xl"
            aria-hidden="true"
          />

          <Link to="/" className="relative flex items-center gap-3 rounded-lg">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500 text-sm font-bold text-white">
              OF
            </span>
            <span className="flex flex-col leading-tight">
              <span className="text-sm font-semibold tracking-tight">OrderFlow AI</span>
              <span className="text-[11px] font-medium text-slate-400">
                Business workspace
              </span>
            </span>
          </Link>

          <div className="relative max-w-md">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-300">
              Order to fulfilment
            </p>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white">
              Run your business from one clear workspace.
            </h1>
            <p className="mt-4 text-sm leading-relaxed text-slate-300">
              Sign in to manage your catalogue, team and customer orders. Every workspace is
              isolated and protected by database-level access rules.
            </p>

            <ul className="mt-8 space-y-4">
              {highlights.map(({ icon: Icon, title, description }) => (
                <li key={title} className="flex gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-brand-200">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span>
                    <span className="block text-sm font-medium text-white">{title}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-slate-400">
                      {description}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <p className="relative text-xs text-slate-500">
            Secure sign-in powered by Supabase Auth.
          </p>
        </aside>

        <main className="flex flex-col px-4 py-6 sm:px-6 lg:px-10">
          <div className="flex items-center justify-between lg:hidden">
            <Link to="/" className="flex items-center gap-2.5 rounded-lg">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
                OF
              </span>
              <span className="text-sm font-semibold tracking-tight text-slate-900">
                OrderFlow AI
              </span>
            </Link>
          </div>

          <div className="flex flex-1 items-center justify-center py-8">
            <div className="w-full max-w-md">
              <ConfigNotice />
              <Outlet />
            </div>
          </div>

          <p className="text-center text-xs text-slate-400">
            By continuing you agree to keep your workspace credentials secure.
          </p>
        </main>
      </div>
    </div>
  );
}
