import { lazy } from "react";

/**
 * The kid device-link scanner as a lazy chunk. It carries the camera loop and
 * the zxing-wasm QR reader (iOS has no BarcodeDetector, so an iPhone always
 * takes that path), neither of which belongs in the first load of a shell whose
 * whole point is opening fast on a child's old phone.
 *
 * {@link preloadKidQrScanner} warms it from the login screen, where the button
 * that opens the scanner is already on screen.
 */

const importScanner = () => import("@/components/kid/KidQrScanner");

export const KidQrScanner = lazy(() =>
  importScanner().then((mod) => ({ default: mod.KidQrScanner })),
);

/** Start fetching the chunk. Safe to call repeatedly - the import is cached. */
export function preloadKidQrScanner(): void {
  void importScanner();
}
