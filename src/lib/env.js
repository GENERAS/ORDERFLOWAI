const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

/**
 * Frontend-safe environment configuration.
 * Only variables prefixed with VITE_ are exposed to the browser bundle.
 */
export const env = Object.freeze({
  appName: 'OrderFlow AI',
  supabaseUrl,
  supabaseAnonKey,
  isSupabaseConfigured: Boolean(supabaseUrl && supabaseAnonKey),
});

if (!env.isSupabaseConfigured && import.meta.env.DEV) {
  console.warn(
    '[OrderFlow AI] Supabase is not configured. Copy .env.example to .env.local and add your project URL and anon key.',
  );
}
