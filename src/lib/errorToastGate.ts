/** Rate-gate for the global fetch-failure toast: one per WINDOW_MS burst. */
export function createErrorToastGate(windowMs: number, now: () => number = () => Date.now()) {
  let lastAt = -Infinity;
  return function shouldToast(): boolean {
    const t = now();
    if (t - lastAt < windowMs) return false;
    lastAt = t;
    return true;
  };
}
