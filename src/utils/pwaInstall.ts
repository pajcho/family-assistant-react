/**
 * "Is this a browser tab or the installed app?" - one place, because three very
 * different features ask it and getting different answers would show.
 *
 * On iOS the question is not cosmetic. A home-screen web app runs in its OWN
 * storage container: it shares no localStorage, no cookies and no IndexedDB
 * with Safari, and Safari can never hand it a URL either (the Camera app opens
 * a scanned link in the browser, always). Anything a child linked in Safari is
 * therefore simply not there after they install the app - which is why the kid
 * shell has to be able to link a device from INSIDE the installed app, and why
 * `/kid/veza` tells an iOS visitor to install first.
 */

/** iPhone / iPad / iPod, and not one of the in-app webviews. */
export function isIosBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isIos = /iPhone|iPad|iPod/.test(ua);
  // In-app browsers (Instagram, FB, X) have no Share sheet with "Add to Home
  // Screen", so telling anyone in one to install is telling them to do
  // something they cannot do.
  const isInAppBrowser = /FBAN|FBAV|Instagram|Line\/|Twitter/i.test(ua);
  return isIos && !isInAppBrowser;
}

/** Running from a home-screen tile / installed app rather than a browser tab. */
export function isStandalonePwa(): boolean {
  if (typeof window === "undefined") return false;
  // iOS uses the non-standard `navigator.standalone`; everyone else uses the
  // `display-mode: standalone` media query.
  const navStandalone = (navigator as Navigator & { standalone?: boolean }).standalone;
  if (navStandalone) return true;
  return window.matchMedia("(display-mode: standalone)").matches;
}

/**
 * True when this is an iOS browser tab that COULD be installed - the one case
 * where "Dodaj na početni ekran" is both possible and not yet done. iOS never
 * fires `beforeinstallprompt`, so an explanation is all any prompt can be.
 */
export function canInstallOnIos(): boolean {
  return isIosBrowser() && !isStandalonePwa();
}
