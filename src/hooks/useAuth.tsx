import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

/**
 * Auth state shared via React Context.
 *
 * Mirrors the surface of the original Nuxt composable
 * (`composables/useAuth.ts`): `session`, `user`, `loading`, `signIn`, `signOut`.
 *
 * The `onAuthStateChange` listener is attached ONCE at module scope so that
 * React StrictMode's double-mount in dev does not register two subscriptions.
 */

export interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// --- Module-level guards ---------------------------------------------------
// These survive React StrictMode double-mount + Vite HMR so we only ever
// have one auth subscription and one in-flight getSession() call.

let listenerAttached = false;
let cachedSession: Session | null = null;
let initialFetch: Promise<Session | null> | null = null;

// Subscribers that want to react to auth changes (e.g. provider instances).
const subscribers = new Set<(session: Session | null) => void>();

function ensureListener(): void {
  if (listenerAttached) return;
  listenerAttached = true;
  supabase.auth.onAuthStateChange((_event, s) => {
    cachedSession = s;
    for (const subscriber of subscribers) subscriber(s);
  });
}

async function loadSession(): Promise<Session | null> {
  if (initialFetch) return initialFetch;
  initialFetch = supabase.auth
    .getSession()
    .then(({ data: { session } }) => {
      cachedSession = session;
      return session;
    })
    .catch(() => {
      cachedSession = null;
      return null;
    });
  return initialFetch;
}

// ---------------------------------------------------------------------------

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [session, setSession] = useState<Session | null>(cachedSession);
  const [loading, setLoading] = useState<boolean>(cachedSession === null && !initialFetch);

  useEffect(() => {
    let cancelled = false;
    ensureListener();
    subscribers.add(setSession);

    void loadSession().then((s) => {
      if (cancelled) return;
      setSession(s);
      setLoading(false);
    });

    return () => {
      cancelled = true;
      subscribers.delete(setSession);
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ? new Error(error.message) : null };
  }, []);

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } catch {
      // Clean up even when the network call fails so the UI doesn't stay
      // stuck on a stale session.
    }
    cachedSession = null;
    setSession(null);
  }, []);

  const value: AuthContextValue = {
    session,
    user: session?.user ?? null,
    loading,
    signIn,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an <AuthProvider>");
  }
  return ctx;
}
