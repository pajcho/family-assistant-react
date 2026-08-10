import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { resumeRefresh } from "@/lib/resumeRefresh";

/**
 * Refetch-on-resume for the installed PWA. iOS keeps the JS context alive for
 * days - after an overnight suspend every query is stale and any realtime
 * events fired meanwhile are lost (the socket was dead). On
 * `visibilitychange` → visible we hand off to the shared {@link resumeRefresh},
 * so whatever screen the user resumes on repaints fresh.
 *
 * The refresh itself is throttled and honours each query's `staleTime` - see
 * `lib/resumeRefresh` for why, and note that the realtime rejoin path calls
 * the very same function.
 *
 * Realtime channels need no manual handling here: realtime-js (phoenix)
 * reconnects the socket itself - `reconnectTimer` fires on close and on
 * heartbeat timeout - and every channel rejoins as soon as the socket
 * reopens. The gap this hook covers is the DATA missed while disconnected,
 * which a rejoin alone would never replay.
 */
export function useVisibilityRefetch(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      resumeRefresh(queryClient);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [queryClient]);
}
