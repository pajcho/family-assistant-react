import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase env: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set.",
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

/**
 * A throwaway client that never touches the persisted session.
 *
 * Used to verify a password (`signInWithPassword`) before a sensitive change:
 * doing that on the main `supabase` client would swap the live session for a
 * fresh one and fire SIGNED_IN across the app. This one writes nothing to
 * storage, never refreshes, and is discarded after the call — the extra GoTrue
 * session it opens is left to expire on its own (signing it out would default
 * to global scope and kill the user's real session).
 */
export function createSessionlessClient() {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
