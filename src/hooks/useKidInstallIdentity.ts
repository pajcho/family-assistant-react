import { useEffect } from "react";

import { applyKidInstallIdentityToDom, kidInstallIdentity } from "@/lib/kidInstallIdentity";

/**
 * Kid mode - the HOME-SCREEN identity (icon + name) of the installed app,
 * for as long as the kid shell is on screen.
 *
 * The swap itself lives in `@/lib/kidInstallIdentity`, because the same code
 * also runs as a synchronous bootstrap in the head of `index.html` - a hard load
 * of `/kid/*` (a child scanning the QR link, then installing straight away) has
 * the kid manifest, icon and title on the document before the first paint, long
 * before React exists. Read that file for why each platform needs which tag.
 *
 * What is left here is the half only React can do: RESTORING the grown-up app's
 * identity on the way out of the kid shell. Without it, a parent who leaves a
 * child's preview and installs their own app would end up with a kid-branded
 * parent tile - and neither platform ever re-reads the icon of an app that is
 * already installed, so that mistake would be permanent.
 *
 * Mounted once, by the `kid` layout route, and deliberately NOT enabled on
 * `/kid/preview` - the same exception the bootstrap makes (`isKidInstallPath`).
 */
export function useKidInstallIdentity(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const identity = kidInstallIdentity(import.meta.env.BASE_URL);
    applyKidInstallIdentityToDom(true, identity);
    return () => applyKidInstallIdentityToDom(false, identity);
  }, [enabled]);
}
