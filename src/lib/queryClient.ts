import { QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { createErrorToastGate } from "@/lib/errorToastGate";

// One toast per burst: an outage fails every mounted query at once, and the
// user needs one signal, not one per query.
const shouldToast = createErrorToastGate(15_000);

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: () => {
      if (shouldToast()) toast.error("Ne mogu da učitam podatke. Proveri internet vezu.");
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});
