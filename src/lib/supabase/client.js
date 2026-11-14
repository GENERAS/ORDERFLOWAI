import { createClient } from '@supabase/supabase-js';
import { env } from '../env';

/**
 * Single shared browser Supabase client.
 * A single instance avoids duplicate auth listeners and token refresh loops.
 */
export const supabase = env.isSupabaseConfigured
  ? createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    })
  : null;

/**
 * Access the configured client from feature service modules.
 * Throws a clear, actionable error instead of failing deep inside a query.
 */
export function getSupabaseClient() {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env.local file, then restart the dev server.',
    );
  }
  return supabase;
}
