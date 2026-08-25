import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || '';
export const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || '';
// A valid, non-placeholder URL is required — otherwise treat the app as "not configured" (offline).
const validUrl = /^https:\/\/[^<>\s]+\.supabase\.(co|in)$/i.test(SUPABASE_URL.trim());
export const supabaseConfigured = !!(validUrl && SUPABASE_ANON_KEY && !SUPABASE_ANON_KEY.includes('<'));

/** One client for the whole app (anonymous auth session persisted in localStorage). */
function makeClient(): SupabaseClient | null {
  if (!supabaseConfigured) return null;
  try {
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' } });
  } catch (e) { console.warn('[supabase] init failed — running offline:', e); return null; }
}
export const supabase: SupabaseClient | null = makeClient();
