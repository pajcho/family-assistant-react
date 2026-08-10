import { lazy } from "react";

/**
 * The receipt scanner as a lazy chunk, shared by every surface that can open
 * it (Novac, the global "+", the expense form's shortcut, an activity's linked
 * money). It carries the camera code and the zxing-wasm QR reader, so it must
 * stay out of the main bundle - but it also must not be four separate `lazy()`
 * calls, because each one is its own module-level promise and its own first-open
 * wait.
 *
 * {@link preloadReceiptScanDialog} starts that download early. The expense form
 * calls it when it opens: its scan-receipt row closes the form and opens the
 * scanner, and with nothing on screen in between (the Suspense fallback is
 * deliberately empty - a spinner over a closing dialog reads as a glitch), a
 * chunk that is still downloading looks exactly like the dialog just closing.
 * Warming it on form-open makes the hop instant in practice.
 */

const importScanDialog = () => import("@/components/budget/receipt/ReceiptScanDialog");

export const ReceiptScanDialog = lazy(importScanDialog);

/** Start fetching the chunk. Safe to call repeatedly - the import is cached. */
export function preloadReceiptScanDialog(): void {
  void importScanDialog();
}
