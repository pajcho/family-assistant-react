/**
 * Kid mode - the INSTALL IDENTITY of the app: what a home-screen install
 * from `/kid/*` is called, what its icon is, and which web app manifest it
 * belongs to.
 *
 * The kid shell and the grown-up app are one deployment behind one `index.html`,
 * so out of the box a child installing from `/kid/*` would get the parent app's
 * blue grown-up tile - and, worse, the parent app's `start_url`, so
 * the installed tile would open the grown-up app.
 *
 * Three consumers share the code in this file, which is the reason it exists:
 *
 * 1. `vite.config.ts` builds `kid.webmanifest` from `buildKidManifest()` and
 *    INLINES `isKidInstallPath` + `applyKidInstallIdentityToDom` into the head
 *    of `index.html` as a synchronous bootstrap script. That timing is the
 *    whole point: Safari reads the manifest, the apple-touch-icon and the
 *    apple-mobile-web-app-title while the document loads, which is long before
 *    React mounts. Swapping them from a `useEffect` (what this used to do) is
 *    always too late for a first visit - a child scanning the QR code taps
 *    "Add to Home Screen" on a document that still advertises the parent app.
 * 2. `useKidInstallIdentity` re-applies the same swap for client-side entries
 *    into the kid shell, and - the reason it stays the source of truth - hands
 *    the document back to the grown-up app on the way out.
 * 3. The tests, which drive the DOM helper directly.
 *
 * IMPORTANT, and not a bug to chase: none of this affects an app that is ALREADY
 * on a home screen. Neither platform re-reads the name, icon or start URL of an
 * existing install. A family that installed before this shipped has to remove
 * the tile and add it again.
 */

/** Matches `name` / `short_name` in the generated `kid.webmanifest`. */
export const KID_APP_TITLE = "Moj dan";

/** Tile colour of `public/kid-icon.svg`. Also in `pwa-assets.kid.config.ts`. */
export const KID_TILE_COLOR = "#443591";

/** First path segment of the kid shell, under `BASE_URL`. */
export const KID_PATH = "kid";

/** Emitted by the build, not a file in `public/` - see `buildKidManifest`. */
export const KID_MANIFEST_FILE = "kid.webmanifest";
const KID_APPLE_ICON_FILE = "kid-apple-touch-icon-180x180.png";
const KID_FAVICON_FILE = "kid-favicon.svg";

/** Everything the DOM swap needs, already resolved against `BASE_URL`. */
export interface KidInstallIdentity {
  /** `<link rel="manifest">` - Android install identity + iOS start URL. */
  manifest: string;
  /** `<link rel="icon">` - the browser tab. */
  favicon: string;
  /** `<link rel="apple-touch-icon">` - the iOS home-screen tile. */
  appleIcon: string;
  /** `<meta name="apple-mobile-web-app-title">` - what iOS calls the tile. */
  title: string;
}

/** Resolve the kid identity against a base path (`/` in dev, `/repo/` on Pages). */
export function kidInstallIdentity(base: string): KidInstallIdentity {
  return {
    manifest: `${base}${KID_MANIFEST_FILE}`,
    favicon: `${base}${KID_FAVICON_FILE}`,
    appleIcon: `${base}${KID_APPLE_ICON_FILE}`,
    title: KID_APP_TITLE,
  };
}

/**
 * Is this pathname one a child could install the kid app from? Every `/kid/*`
 * route is, except `/kid/preview` - that is a grown-up looking at a child's app
 * from their own session, and what they would install is still their own app.
 *
 * Self-contained on purpose, with the two path segments spelled out rather than
 * read from the constants above: `vite.config.ts` stringifies this function into
 * the `index.html` bootstrap, where anything it closed over would be a
 * ReferenceError at first paint. See `applyKidInstallIdentityToDom`.
 */
export function isKidInstallPath(pathname: string, base: string): boolean {
  const root = `${base}kid`;
  const inShell = pathname === root || pathname.startsWith(`${root}/`);
  return inShell && !pathname.startsWith(`${root}/preview`);
}

/**
 * The kid web app manifest, as an object. Written to `kid.webmanifest` by the
 * build (see `vite.config.ts`) rather than kept in `public/` because `id` and
 * `start_url` have to know the base path, and the two differ between dev and
 * GitHub Pages.
 *
 * `id` is the app's identity to the browser: two manifests with two ids are two
 * installable apps, and a home-screen tile is bound to the id it was installed
 * with. It is deliberately spelled out here (and in the grown-up manifest)
 * rather than left to default, so a later `start_url` change cannot silently
 * rename the app and orphan every install.
 *
 * The value is EXACTLY what the default would resolve to today - `id` is parsed
 * against the ORIGIN of `start_url`, not against the manifest's own URL, so an
 * absolute path is the only spelling that is right in dev and on Pages both.
 */
export function buildKidManifest(base: string): Record<string, unknown> {
  const startUrl = `${base}${KID_PATH}`;
  return {
    id: startUrl,
    name: KID_APP_TITLE,
    short_name: KID_APP_TITLE,
    description: "Tvoj kutak porodičnog kalendara",
    theme_color: KID_TILE_COLOR,
    background_color: KID_TILE_COLOR,
    display: "standalone",
    orientation: "portrait",
    lang: "sr",
    start_url: startUrl,
    scope: startUrl,
    // Relative to the manifest's own URL, which is `${base}kid.webmanifest`.
    icons: [
      { src: "kid-192x192.png", sizes: "192x192", type: "image/png" },
      { src: "kid-512x512.png", sizes: "512x512", type: "image/png" },
      {
        src: "kid-maskable-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

/**
 * Put the kid app's install identity on the document, or hand it back (`false`).
 *
 * SELF-CONTAINED BY CONTRACT: no imports, no module-scope references, every
 * constant declared inside. `vite.config.ts` ships this function to the browser
 * as `<script>(${applyKidInstallIdentityToDom.toString()})(true, {...})</script>`,
 * so a reference to anything outside the function body would be a ReferenceError
 * on the child's first paint. A test evaluates the stringified source in
 * isolation precisely to keep that contract honest.
 *
 * The manifest is ADDED rather than swapped: the grown-up `<link rel="manifest">`
 * is injected by vite-plugin-pwa at the very end of `<head>`, so at bootstrap
 * time (mid-parse) it does not exist yet and there is nothing to rewrite. A link
 * inserted here is earlier in tree order, and the first manifest link in tree
 * order is the document's manifest. Leaving the kid shell removes it again, and
 * the grown-up link - never touched - is the document's manifest once more.
 */
export function applyKidInstallIdentityToDom(enabled: boolean, kid: KidInstallIdentity): void {
  if (typeof document === "undefined") return;
  const head = document.head;

  // Where a swapped element parks the grown-up value until it is restored.
  // On the element rather than in a variable, so the swap is idempotent: the
  // bootstrap and the hook both run it, and the second one must not learn a kid
  // value as the default.
  const restoreAttr = "data-app-value";
  // Marks the link this function owns, so it can be found and removed again.
  const kidManifestAttr = "data-kid-manifest";
  // `rel` parked on the iOS splash links while the kid identity is on.
  const disabledStartupRel = "kid-disabled-apple-touch-startup-image";

  const swap = (element: Element | null, attribute: string, next: string): void => {
    if (!element) return;
    if (!element.hasAttribute(restoreAttr)) {
      element.setAttribute(restoreAttr, element.getAttribute(attribute) ?? "");
    }
    element.setAttribute(attribute, next);
  };

  const restore = (element: Element | null, attribute: string): void => {
    const previous = element?.getAttribute(restoreAttr);
    if (!element || previous === null || previous === undefined) return;
    element.setAttribute(attribute, previous);
    element.removeAttribute(restoreAttr);
  };

  if (enabled) {
    if (!head.querySelector(`link[${kidManifestAttr}]`)) {
      const link = document.createElement("link");
      link.setAttribute("rel", "manifest");
      link.setAttribute("href", kid.manifest);
      link.setAttribute(kidManifestAttr, "");
      const grownUp = head.querySelector('link[rel="manifest"]');
      if (grownUp) head.insertBefore(link, grownUp);
      else head.appendChild(link);
    }

    swap(head.querySelector('link[rel="icon"]'), "href", kid.favicon);
    swap(head.querySelector('link[rel="apple-touch-icon"]'), "href", kid.appleIcon);
    swap(head.querySelector('meta[name="apple-mobile-web-app-title"]'), "content", kid.title);

    // The `apple-touch-startup-image` set in index.html is the grown-up app's
    // blue splash, and iOS would happily use it for the kid app too. There is
    // no kid equivalent on purpose (that set is ~30MB), so take the links out
    // of play and let iOS fall back to the manifest `background_color`, which
    // is the icon's own violet - the launch then reads as one solid screen.
    for (const link of head.querySelectorAll('link[rel="apple-touch-startup-image"]')) {
      swap(link, "rel", disabledStartupRel);
    }
    return;
  }

  head.querySelector(`link[${kidManifestAttr}]`)?.remove();
  restore(head.querySelector('link[rel="icon"]'), "href");
  restore(head.querySelector('link[rel="apple-touch-icon"]'), "href");
  restore(head.querySelector('meta[name="apple-mobile-web-app-title"]'), "content");
  for (const link of head.querySelectorAll(`link[rel="${disabledStartupRel}"]`)) {
    restore(link, "rel");
  }
}
