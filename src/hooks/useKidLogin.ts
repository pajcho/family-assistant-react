import { useCallback, useState } from "react";

import { supabase } from "@/lib/supabase";
import {
  KID_DEVICES_STORAGE_KEY,
  normalizeKidTheme,
  type KidAuthErrorBody,
  type KidAuthErrorCode,
  type KidAuthResponse,
  type KidDeviceEntry,
  type KidTheme,
} from "@/types/kid";

/**
 * The child's side of signing in: two factors, neither of which is typed by the
 * child from memory alone.
 *
 *   1. a DEVICE TOKEN planted once by a parent's QR link (`claim`), then kept
 *      in this device's localStorage and replayed on every later sign-in
 *      (`login`);
 *   2. a PIN, verified server-side with a lockout.
 *
 * There is no username field anywhere, and the "Ko si ti?" picker is built
 * purely from localStorage - a stranger opening the app on an unknown device
 * cannot learn that this family has children, how many, or their names.
 */

// ---------------------------------------------------------------------------
// Remembered devices (localStorage)
// ---------------------------------------------------------------------------

function isDeviceEntry(value: unknown): value is KidDeviceEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.profileId === "string" &&
    typeof entry.name === "string" &&
    typeof entry.deviceToken === "string"
  );
}

/** Every child this device has been linked to, oldest first. Never throws. */
export function readKidDevices(): KidDeviceEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KID_DEVICES_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isDeviceEntry).map((entry) => ({
      ...entry,
      theme: normalizeKidTheme(entry.theme),
      color: typeof entry.color === "string" ? entry.color : null,
    }));
  } catch {
    // Corrupt or unreadable storage (private mode, quota, hand-edited value):
    // behave exactly like a brand-new device rather than blocking the screen.
    return [];
  }
}

function writeKidDevices(entries: KidDeviceEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KID_DEVICES_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage full or blocked - the session still works, this device just
    // won't remember the child next time. Nothing useful to say to a kid here.
  }
}

/** This device's entry for one child, if it has ever been linked to them. */
export function findKidDevice(profileId: string | null): KidDeviceEntry | null {
  if (!profileId) return null;
  return readKidDevices().find((entry) => entry.profileId === profileId) ?? null;
}

/** Add or refresh one child's entry, keeping the rest of the list intact. */
export function saveKidDevice(entry: KidDeviceEntry): void {
  const rest = readKidDevices().filter((e) => e.profileId !== entry.profileId);
  writeKidDevices([...rest, entry]);
}

/** Forget one child on this device (used when the parent revokes the device). */
export function removeKidDevice(profileId: string): void {
  writeKidDevices(readKidDevices().filter((e) => e.profileId !== profileId));
}

/**
 * Keep the cached theme in step with the child's choice, so the NEXT sign-in
 * paints the login screen in their colours instead of the default.
 */
export function updateKidDeviceTheme(profileId: string, theme: KidTheme): void {
  const entries = readKidDevices();
  const index = entries.findIndex((e) => e.profileId === profileId);
  if (index < 0) return;
  entries[index] = { ...entries[index], theme };
  writeKidDevices(entries);
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * supabase-js flattens every non-2xx Edge Function response into a generic
 * `FunctionsHttpError`; the real body hangs off `error.context`. Same unwrapping
 * idiom as `utils/functionsError.ts`, but the kid endpoint's body carries a
 * machine-readable `code` (plus `attemptsLeft` / `retryAfterSeconds`) that the
 * screens need, so we read the whole object instead of just the message.
 */
export async function readKidAuthError(error: unknown): Promise<KidAuthErrorBody | null> {
  const ctx = (error as { context?: Response | unknown }).context;
  if (!ctx || typeof (ctx as Response).json !== "function") return null;
  try {
    const body = (await (ctx as Response).json()) as Partial<KidAuthErrorBody>;
    if (typeof body?.code !== "string") return null;
    return {
      error: typeof body.error === "string" ? body.error : fallbackMessage(body.code),
      code: body.code,
      attemptsLeft: typeof body.attemptsLeft === "number" ? body.attemptsLeft : undefined,
      retryAfterSeconds:
        typeof body.retryAfterSeconds === "number" ? body.retryAfterSeconds : undefined,
    };
  } catch {
    return null;
  }
}

/** Child-facing Serbian for each code, used when the server sent none. */
function fallbackMessage(code: KidAuthErrorCode): string {
  switch (code) {
    case "invalid_pin":
      return "Pogrešan PIN. Probaj ponovo.";
    case "locked":
      return "Previše pokušaja. Sačekaj malo pa probaj opet.";
    case "invite_invalid":
      return "Ovaj link ne radi. Zatraži novi od roditelja.";
    case "invite_expired":
      return "Link je istekao. Zatraži novi od roditelja.";
    case "invite_used":
      return "Ovaj link je već iskorišćen. Zatraži novi od roditelja.";
    case "device_unknown":
      return "Ovaj uređaj više nije povezan. Zatraži novi QR kod od roditelja.";
    case "access_disabled":
      return "Tvoj pristup je trenutno isključen. Pitaj mamu ili tatu.";
  }
}

const GENERIC_ERROR = "Nešto nije u redu. Probaj ponovo za koji trenutak.";

// ---------------------------------------------------------------------------
// Turning what `kid-auth` returns into a live Supabase session
// ---------------------------------------------------------------------------

/**
 * The ONE place that knows how a `kid-auth` response becomes a session.
 *
 * Primary path: the function mints a single-use magic-link `token_hash`
 * (`auth.admin.generateLink`) which `verifyOtp` exchanges for a session - no
 * password is ever stored or transmitted. If that path ever has to change, the
 * function can instead return a ready `{ access_token, refresh_token }` pair;
 * this handles both shapes, so the swap costs nothing above this line.
 */
type KidSessionPayload = KidAuthResponse & {
  access_token?: string;
  refresh_token?: string;
};

async function redeemKidSession(payload: KidSessionPayload): Promise<void> {
  if (payload.access_token && payload.refresh_token) {
    const { error } = await supabase.auth.setSession({
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
    });
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await supabase.auth.verifyOtp({
    token_hash: payload.sessionToken,
    type: "magiclink",
  });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

export interface KidLoginState {
  /** Serbian, child-facing. Null while there is nothing to say. */
  message: string | null;
  code: KidAuthErrorCode | null;
  attemptsLeft: number | null;
  /** Seconds remaining on a lockout, counted down by the screen. */
  retryAfterSeconds: number | null;
  isPending: boolean;
}

const IDLE: KidLoginState = {
  message: null,
  code: null,
  attemptsLeft: null,
  retryAfterSeconds: null,
  isPending: false,
};

export interface UseKidLoginResult extends KidLoginState {
  /** Sign in with a device this browser already remembers. */
  signIn: (args: { entry: KidDeviceEntry; pin: string }) => Promise<boolean>;
  /** Redeem a parent's one-time invite token and remember this device. */
  claim: (args: { token: string; pin: string }) => Promise<KidDeviceEntry | null>;
  reset: () => void;
}

export function useKidLogin(): UseKidLoginResult {
  const [state, setState] = useState<KidLoginState>(IDLE);

  const fail = useCallback(async (error: unknown): Promise<void> => {
    const body = await readKidAuthError(error);
    setState({
      message: body?.error ?? GENERIC_ERROR,
      code: body?.code ?? null,
      attemptsLeft: body?.attemptsLeft ?? null,
      retryAfterSeconds: body?.retryAfterSeconds ?? null,
      isPending: false,
    });
  }, []);

  const signIn = useCallback(
    async ({ entry, pin }: { entry: KidDeviceEntry; pin: string }): Promise<boolean> => {
      setState({ ...IDLE, isPending: true });
      try {
        const { data, error } = await supabase.functions.invoke<KidSessionPayload>("kid-auth", {
          body: { action: "login", deviceToken: entry.deviceToken, pin },
        });
        if (error) throw error;
        if (!data) throw new Error(GENERIC_ERROR);
        await redeemKidSession(data);
        // Refresh the cached label/colour/theme - a parent may have renamed the
        // child or the child may have changed theme on another device.
        saveKidDevice({
          ...entry,
          name: data.profile.name || entry.name,
          theme: normalizeKidTheme(data.profile.theme),
          color: data.profile.color ?? entry.color,
          emoji: data.profile.emoji ?? null,
        });
        setState(IDLE);
        return true;
      } catch (error) {
        await fail(error);
        return false;
      }
    },
    [fail],
  );

  const claim = useCallback(
    async ({ token, pin }: { token: string; pin: string }): Promise<KidDeviceEntry | null> => {
      setState({ ...IDLE, isPending: true });
      try {
        const { data, error } = await supabase.functions.invoke<KidSessionPayload>("kid-auth", {
          body: { action: "claim", token, pin },
        });
        if (error) throw error;
        if (!data?.deviceToken) throw new Error(GENERIC_ERROR);
        const entry: KidDeviceEntry = {
          profileId: data.profile.id,
          name: data.profile.name,
          deviceToken: data.deviceToken,
          theme: normalizeKidTheme(data.profile.theme),
          color: data.profile.color,
          emoji: data.profile.emoji ?? null,
        };
        // Persist BEFORE redeeming: if the page reloads mid-redemption the
        // child can still sign in with just their PIN instead of needing a
        // second QR code (the invite is already spent by now).
        saveKidDevice(entry);
        await redeemKidSession(data);
        setState(IDLE);
        return entry;
      } catch (error) {
        await fail(error);
        return null;
      }
    },
    [fail],
  );

  const reset = useCallback(() => setState(IDLE), []);

  return { ...state, signIn, claim, reset };
}
