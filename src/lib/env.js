const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();
const metaAppId = (import.meta.env.VITE_META_APP_ID ?? '').trim();
const metaConfigId = (import.meta.env.VITE_META_CONFIG_ID ?? '').trim();
const metaGraphApiVersion =
  (import.meta.env.VITE_META_GRAPH_API_VERSION ?? '').trim() || 'v25.0';
const metaEmbeddedSignupVersion =
  (import.meta.env.VITE_META_EMBEDDED_SIGNUP_VERSION ?? '').trim() || 'v4';

/**
 * Frontend-safe environment configuration.
 * Only variables prefixed with VITE_ are exposed to the browser bundle.
 */
export const env = Object.freeze({
  appName: 'OrderFlow AI',
  supabaseUrl,
  supabaseAnonKey,
  isSupabaseConfigured: Boolean(supabaseUrl && supabaseAnonKey),
  metaAppId,
  metaConfigId,
  metaGraphApiVersion,
  metaEmbeddedSignupVersion,
});

if (!env.isSupabaseConfigured && import.meta.env.DEV) {
  console.warn(
    '[OrderFlow AI] Supabase is not configured. Copy .env.example to .env.local and add your project URL and anon key.',
  );
}
