import { AlertTriangle } from 'lucide-react';
import { env } from '../../lib/env';

/**
 * Non-blocking setup notice. The application shell stays usable without
 * Supabase credentials, but data-backed features will stay disabled.
 */
export function ConfigNotice() {
  if (env.isSupabaseConfigured) return null;

  return (
    <div
      className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
      role="status"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div>
        <p className="font-semibold">Supabase is not connected yet</p>
        <p className="mt-0.5 text-amber-800">
          Copy <code className="rounded bg-amber-100 px-1 py-0.5 text-xs">.env.example</code> to{' '}
          <code className="rounded bg-amber-100 px-1 py-0.5 text-xs">.env.local</code>, add your
          project URL and public key (anon or publishable), then restart the dev server.
        </p>
      </div>
    </div>
  );
}
