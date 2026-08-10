import { useEffect, useState } from "react";

/**
 * The value, but only once it has stopped changing for `delayMs`.
 *
 * For search boxes: keep the INPUT fully controlled by the raw state so typing
 * stays instant, and feed the debounced copy to whatever fires a request. The
 * Novac search used to hand every keystroke straight to `useExpenseSearch`, so
 * "namirnice" was ten queries.
 *
 * The timer is cleared whenever `value` changes and on unmount, so a keystroke
 * that lands mid-window resets the window instead of stacking a second timer.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
