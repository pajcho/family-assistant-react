import { supabase } from "@/lib/supabase";

/**
 * Returns the singleton Supabase client.
 *
 * Kept as a hook (rather than importing `supabase` everywhere) for parity with
 * the original Nuxt composable surface (`useSupabase()` in `composables/useSupabase.ts`)
 * — makes the port mechanical and lets us swap the client out under test if needed.
 */
export function useSupabase() {
  return supabase;
}
