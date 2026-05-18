import { useEffect, useState } from "react";
import { ArrowUpOnSquareIcon, PlusIcon, XMarkIcon } from "@heroicons/react/24/outline";

/**
 * Small banner that nudges iOS Safari visitors to install the PWA via
 * Share → Add to Home Screen.
 *
 * iOS doesn't fire `beforeinstallprompt`, so there's no API for triggering
 * the install flow — Apple requires users to do it manually through the
 * Share sheet. This banner just educates them on how.
 *
 * Shown only when:
 *   • UA is iPhone / iPad / iPod
 *   • App is not already running standalone (already installed)
 *   • User hasn't dismissed it before (localStorage flag)
 */

const DISMISS_KEY = "pwa-install-hint-dismissed";

function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isIos = /iPhone|iPad|iPod/.test(ua);
  // Exclude in-app webviews (Instagram, FB) where Add to Home Screen isn't
  // available — they don't expose the standalone Safari Share sheet.
  const isInAppBrowser = /FBAN|FBAV|Instagram|Line\/|Twitter/i.test(ua);
  return isIos && !isInAppBrowser;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // iOS uses the non-standard `navigator.standalone`; everyone else uses
  // the `display-mode: standalone` media query.
  const navStandalone = (navigator as Navigator & { standalone?: boolean }).standalone;
  if (navStandalone) return true;
  return window.matchMedia("(display-mode: standalone)").matches;
}

export function IosInstallHint() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isIosSafari()) return;
    if (isStandalone()) return;
    if (window.localStorage.getItem(DISMISS_KEY) === "1") return;
    setVisible(true);
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    window.localStorage.setItem(DISMISS_KEY, "1");
    setVisible(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Dodaj na početni ekran"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md rounded-xl border border-gray-200 bg-white/95 p-4 shadow-lg backdrop-blur dark:border-gray-700 dark:bg-gray-800/95"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)" }}
    >
      <button
        type="button"
        aria-label="Zatvori"
        onClick={dismiss}
        className="absolute right-2 top-2 inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"
      >
        <XMarkIcon className="h-5 w-5" />
      </button>
      <p className="pr-8 text-sm font-medium text-gray-900 dark:text-gray-100">
        Instaliraj aplikaciju
      </p>
      <p className="mt-1 pr-2 text-xs leading-relaxed text-gray-600 dark:text-gray-400">
        Dodaj Porodični Asistent na početni ekran za bržu prečicu i puni ekran. U Safariju otvori
        meni{" "}
        <ArrowUpOnSquareIcon className="inline h-4 w-4 -translate-y-0.5 text-blue-600 dark:text-blue-400" />{" "}
        <span className="font-medium">Share</span>, pa izaberi{" "}
        <PlusIcon className="inline h-4 w-4 -translate-y-0.5 rounded-sm border border-blue-600 p-px text-blue-600 dark:border-blue-400 dark:text-blue-400" />{" "}
        <span className="font-medium">Add to Home Screen</span>.
      </p>
    </div>
  );
}
