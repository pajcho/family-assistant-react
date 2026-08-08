import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/lib/supabase";
import { useProfile } from "@/hooks/useProfile";
import { readFunctionsError } from "@/utils/functionsError";
import type { KidAccess, KidDevice } from "@/types/database";
import type { KidAccessRequest, KidInviteResponse } from "@/types/kid";

/**
 * Parent-side management of the kid mode (see `src/types/kid.ts` for the whole
 * model).
 *
 * Reads go straight through PostgREST: `kid_access` and `kid_devices` both
 * carry an admin-only SELECT policy, so a non-admin simply gets an empty list
 * rather than an error. Every WRITE goes through the `kid-access` Edge
 * Function instead - provisioning a child means touching the auth admin API
 * (a synthetic user with no password), hashing a PIN and minting invite
 * tokens, none of which a browser holding the anon key may do. The function
 * re-checks that the caller is an admin in the target's family, exactly like
 * `manage-family-login`.
 *
 * Sibling of `useFamilyLogin.ts`; the `invoke` + `readFunctionsError`
 * unwrapping idiom is deliberately identical.
 */

/**
 * Columns a client is allowed to see. `pin_hash`, `login_email` and the
 * failed-attempt counters are service-role territory - the SELECT policy
 * exposes the row, so keep them out of the query (and out of the cache).
 */
const KID_ACCESS_COLUMNS =
  "profile_id, family_id, auth_user_id, is_enabled, theme, locked_until, last_login_at, created_at, updated_at";

/** `token_hash` is deliberately absent for the same reason. */
const KID_DEVICE_COLUMNS = "id, profile_id, family_id, label, created_at, last_seen_at";

/** Every `kid-access` action answers with this shape (`invite` adds a token). */
type FnResult = { ok?: boolean; error?: string } & Partial<KidInviteResponse>;

async function invokeKidAccess(body: KidAccessRequest): Promise<FnResult> {
  const { data, error } = await supabase.functions.invoke<FnResult>("kid-access", { body });
  // `error` is the supabase-js wrapper for non-2xx; unwrap the real server
  // message. `data.error` covers a 2xx response that still reports a problem.
  const message = error
    ? ((await readFunctionsError(error)) ?? error.message)
    : (data?.error ?? null);
  if (message) throw new Error(message);
  return data ?? {};
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

async function fetchKidAccess(familyId: string): Promise<KidAccess[]> {
  const { data, error } = await supabase
    .from("kid_access")
    .select(KID_ACCESS_COLUMNS)
    .eq("family_id", familyId);
  if (error) throw new Error(error.message);
  return (data as unknown as KidAccess[]) ?? [];
}

export interface UseKidAccessListResult {
  rows: KidAccess[];
  /** Lookup by the CHILD's profile id (not the synthetic auth user id). */
  byProfileId: Map<string, KidAccess>;
  /** Children whose login is currently usable - what the roster pill reads. */
  enabledIds: Set<string>;
  isLoading: boolean;
  isError: boolean;
}

/**
 * Every kid-access row in the caller's family. One query serves both the
 * roster ("Dete" pills) and the per-member section, so opening the Porodica
 * tab costs a single extra request no matter how many children there are.
 */
export function useKidAccessList(): UseKidAccessListResult {
  const { familyId } = useProfile();

  const query = useQuery({
    queryKey: ["kid-access", familyId],
    queryFn: () => fetchKidAccess(familyId as string),
    enabled: !!familyId,
    staleTime: 5 * 60_000,
  });

  const rows = useMemo(() => query.data ?? [], [query.data]);

  const byProfileId = useMemo(() => {
    const map = new Map<string, KidAccess>();
    for (const row of rows) map.set(row.profile_id, row);
    return map;
  }, [rows]);

  const enabledIds = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) if (row.is_enabled) set.add(row.profile_id);
    return set;
  }, [rows]);

  return {
    rows,
    byProfileId,
    enabledIds,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}

async function fetchKidDevices(profileId: string): Promise<KidDevice[]> {
  const { data, error } = await supabase
    .from("kid_devices")
    .select(KID_DEVICE_COLUMNS)
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as unknown as KidDevice[]) ?? [];
}

export interface UseKidDevicesResult {
  devices: KidDevice[];
  isLoading: boolean;
  isError: boolean;
}

/**
 * Devices linked for ONE child, newest first. Pass `null` to stay idle - the
 * admin UI only asks once a child actually has kid access.
 */
export function useKidDevices(profileId: string | null): UseKidDevicesResult {
  const query = useQuery({
    queryKey: ["kid-devices", profileId],
    queryFn: () => fetchKidDevices(profileId as string),
    enabled: !!profileId,
    staleTime: 60_000,
  });

  return {
    devices: useMemo(() => query.data ?? [], [query.data]),
    isLoading: query.isLoading,
    isError: query.isError,
  };
}

// ---------------------------------------------------------------------------
// Mutations - all through the `kid-access` Edge Function
// ---------------------------------------------------------------------------

export type KidPinInput = {
  profileId: string;
  pin: string;
};

/**
 * Provision the child: a synthetic auth user with no password, plus the
 * `kid_access` row holding the PIN hash. The member's own `profiles` row is
 * untouched (unlike `create` in `manage-family-login`, which re-keys it), so
 * nothing else in the app has to react.
 */
export function useEnableKidAccess() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: KidPinInput): Promise<void> => {
      await invokeKidAccess({ action: "enable", profileId: input.profileId, pin: input.pin });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["kid-access", familyId] });
      void queryClient.invalidateQueries({ queryKey: ["family-members", familyId] });
    },
    onError: (e: Error) => {
      toast.error(e.message || "Greška pri uključivanju dečijeg pristupa");
    },
  });
}

/**
 * Delete the synthetic auth user (which cascades the `kid_access` row), the
 * child's devices and any unused invites. Idempotent server-side, so a double
 * tap can't fail.
 */
export function useDisableKidAccess() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (profileId: string): Promise<void> => {
      await invokeKidAccess({ action: "disable", profileId });
    },
    onSuccess: (_data, profileId) => {
      void queryClient.invalidateQueries({ queryKey: ["kid-access", familyId] });
      void queryClient.invalidateQueries({ queryKey: ["family-members", familyId] });
      void queryClient.invalidateQueries({ queryKey: ["kid-devices", profileId] });
    },
    onError: (e: Error) => {
      toast.error(e.message || "Greška pri isključivanju dečijeg pristupa");
    },
  });
}

/** Re-hash the PIN and clear the lockout counters. Devices stay linked. */
export function useSetKidPin() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: KidPinInput): Promise<void> => {
      await invokeKidAccess({ action: "set-pin", profileId: input.profileId, pin: input.pin });
    },
    onSuccess: () => {
      // `locked_until` may have just been cleared - refetch so the status row
      // stops claiming the child is locked out.
      void queryClient.invalidateQueries({ queryKey: ["kid-access", familyId] });
    },
    onError: (e: Error) => {
      toast.error(e.message || "Greška pri promeni PIN-a");
    },
  });
}

/**
 * Mint a one-time device-link token. The RAW token exists only in this
 * response (the server keeps a hash), so it is shown once, as a QR code, and
 * never cached anywhere.
 */
export function useCreateKidInvite() {
  return useMutation({
    mutationFn: async (profileId: string): Promise<KidInviteResponse> => {
      const result = await invokeKidAccess({ action: "invite", profileId });
      if (!result.token || !result.expiresAt) {
        throw new Error("Server nije vratio link za povezivanje.");
      }
      return { token: result.token, expiresAt: result.expiresAt };
    },
    onError: (e: Error) => {
      toast.error(e.message || "Greška pri pravljenju linka za povezivanje");
    },
  });
}

export type RevokeKidDeviceInput = {
  deviceId: string;
  /** Only used to bounce that child's device list - the server keys on the id. */
  profileId: string;
};

/**
 * Unlink one device. The function also ends the child's sessions server-side,
 * which - because all their devices share one synthetic auth user - signs them
 * out EVERYWHERE; the other linked devices get back in with just the PIN. It
 * fails loudly rather than half-way: if the sign-out does not go through, the
 * device stays linked and the parent can simply press again.
 */
export function useRevokeKidDevice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: RevokeKidDeviceInput): Promise<void> => {
      await invokeKidAccess({ action: "revoke-device", deviceId: input.deviceId });
    },
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({ queryKey: ["kid-devices", input.profileId] });
    },
    onError: (e: Error) => {
      toast.error(e.message || "Greška pri uklanjanju uređaja");
    },
  });
}
