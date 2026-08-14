import { useQuery } from "@tanstack/react-query";

import type { AuditLogEntry } from "@/types/database";
import { supabase } from "@/lib/supabase";

/**
 * One entity's change history (plan 018).
 *
 * Fetched lazily - `enabled` is false until the history sub-view actually
 * opens, so the ordinary case of opening a detail sheet and closing it again
 * costs nothing. The authorship line at the bottom of the sheet is served by
 * columns that arrive with the row itself and needs none of this.
 *
 * RLS does the privacy work: `audit_log` hands back family-visible entries plus
 * the caller's own personal-list ones, so this query needs no scope argument
 * and cannot be widened by getting it wrong.
 *
 * Keyed under the `audit_log` root so `useFamilyChannel` can invalidate every
 * open history off ONE realtime message - the subject's own. The table has no
 * broadcast trigger of its own, deliberately: it would double realtime traffic
 * to refresh a panel that is almost never open.
 */

/** How far back a single entity's history reads. Matches the retention job. */
const HISTORY_LIMIT = 100;

async function fetchAuditLog(entityType: string, entityId: string): Promise<AuditLogEntry[]> {
  const { data, error } = await supabase
    .from("audit_log")
    .select("*")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  if (error) throw new Error(error.message);
  return (data as AuditLogEntry[]) ?? [];
}

export interface UseAuditLogResult {
  entries: AuditLogEntry[];
  isLoading: boolean;
}

export function useAuditLog(
  entityType: string,
  entityId: string | null | undefined,
  enabled = true,
): UseAuditLogResult {
  const query = useQuery({
    queryKey: ["audit_log", entityType, entityId],
    queryFn: () => fetchAuditLog(entityType, entityId as string),
    enabled: enabled && !!entityId,
  });

  return { entries: query.data ?? [], isLoading: query.isLoading };
}
