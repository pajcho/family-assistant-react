import { useEffect } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { toast } from "sonner";

/**
 * Listens for service-worker updates from vite-plugin-pwa.
 *
 * When a new SW activates (because a fresh deploy went live), this surfaces
 * a persistent sonner toast with a "Osveži" action. We deliberately don't
 * silently reload — users may have unsaved input in a dialog. The toast
 * stays until they dismiss or refresh.
 *
 * Mount this hook ONCE inside the authenticated app shell.
 */
export function usePwaUpdate(): void {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      console.error("[pwa] SW registration failed", error);
    },
  });

  useEffect(() => {
    if (!needRefresh) return;
    const id = toast("Nova verzija dostupna", {
      description: "Osveži aplikaciju da preuzmeš najnovije izmene.",
      duration: Infinity,
      action: {
        label: "Osveži",
        onClick: () => {
          void updateServiceWorker(true);
        },
      },
      onDismiss: () => setNeedRefresh(false),
    });
    return () => {
      toast.dismiss(id);
    };
  }, [needRefresh, setNeedRefresh, updateServiceWorker]);
}
