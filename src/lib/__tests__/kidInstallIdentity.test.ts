import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  applyKidInstallIdentityToDom,
  buildKidManifest,
  isKidInstallPath,
  kidInstallIdentity,
  type KidInstallIdentity,
} from "@/lib/kidInstallIdentity";

const PAGES_BASE = "/family-assistant-react/";

describe("isKidInstallPath", () => {
  it("covers the kid shell under the GitHub Pages base", () => {
    expect(isKidInstallPath("/family-assistant-react/kid", PAGES_BASE)).toBe(true);
    expect(isKidInstallPath("/family-assistant-react/kid/", PAGES_BASE)).toBe(true);
    expect(isKidInstallPath("/family-assistant-react/kid/login", PAGES_BASE)).toBe(true);
    // The QR link a child opens on a brand new device, and the reason this has
    // to work on a FIRST visit rather than after React mounts.
    expect(isKidInstallPath("/family-assistant-react/kid/link", PAGES_BASE)).toBe(true);
  });

  it("covers the same routes in dev, where the base is just /", () => {
    expect(isKidInstallPath("/kid", "/")).toBe(true);
    expect(isKidInstallPath("/kid/upcoming", "/")).toBe(true);
  });

  it("leaves the grown-up app alone", () => {
    expect(isKidInstallPath("/family-assistant-react/", PAGES_BASE)).toBe(false);
    expect(isKidInstallPath("/family-assistant-react/novac", PAGES_BASE)).toBe(false);
    // Same word, different app: the base path is part of the match.
    expect(isKidInstallPath("/kid", PAGES_BASE)).toBe(false);
  });

  it("excludes /kid/preview - that is a parent looking at a child's app", () => {
    expect(isKidInstallPath("/family-assistant-react/kid/preview", PAGES_BASE)).toBe(false);
    expect(isKidInstallPath("/kid/preview", "/")).toBe(false);
  });
});

describe("buildKidManifest", () => {
  it("carries the base path into id, start_url and scope", () => {
    expect(buildKidManifest(PAGES_BASE)).toMatchObject({
      id: "/family-assistant-react/kid",
      start_url: "/family-assistant-react/kid",
      scope: "/family-assistant-react/kid",
    });
    expect(buildKidManifest("/")).toMatchObject({ id: "/kid", start_url: "/kid", scope: "/kid" });
  });

  it("is a different app from the grown-up one, which is the whole point", () => {
    // The grown-up manifest's id is the base itself (see vite.config.ts). Two
    // different ids means iOS and Android treat the two installs as two apps
    // instead of the child's tile silently becoming a copy of the parent's.
    expect(buildKidManifest(PAGES_BASE).id).not.toBe(PAGES_BASE);
  });
});

/**
 * `vite.config.ts` ships `applyKidInstallIdentityToDom` to the browser as
 * `<script>(${applyKidInstallIdentityToDom.toString()})(true, {...})</script>`,
 * which only works while the function references nothing outside its own body.
 * Evaluating the stringified source in isolation is the one check that keeps
 * that contract honest: a stray module-scope constant would be a ReferenceError
 * here, exactly as it would be on a child's first paint.
 */
describe("the index.html bootstrap (stringified apply)", () => {
  const APP_MANIFEST = "/manifest.webmanifest";
  const APP_FAVICON = "/favicon.svg";
  const APP_ICON = "/apple-touch-icon-180x180.png";
  const APP_TITLE = "Porodicni";

  function bootstrapApply(): typeof applyKidInstallIdentityToDom {
    // oxlint-disable-next-line no-new-func
    return new Function(
      `return (${applyKidInstallIdentityToDom.toString()})`,
    )() as typeof applyKidInstallIdentityToDom;
  }

  const kid: KidInstallIdentity = kidInstallIdentity(PAGES_BASE);

  beforeEach(() => {
    document.head.innerHTML = `
      <link rel="icon" type="image/svg+xml" href="${APP_FAVICON}">
      <link rel="apple-touch-icon" href="${APP_ICON}">
      <meta name="apple-mobile-web-app-title" content="${APP_TITLE}">
      <link rel="manifest" href="${APP_MANIFEST}">
    `;
  });

  afterEach(() => {
    document.head.innerHTML = "";
  });

  it("applies the kid identity when evaluated on its own", () => {
    bootstrapApply()(true, kid);

    expect(document.head.querySelector('link[rel="manifest"]')?.getAttribute("href")).toBe(
      `${PAGES_BASE}kid.webmanifest`,
    );
    expect(document.head.querySelector('link[rel="icon"]')?.getAttribute("href")).toBe(
      `${PAGES_BASE}kid-favicon.svg`,
    );
    expect(document.head.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href")).toBe(
      `${PAGES_BASE}kid-apple-touch-icon-180x180.png`,
    );
    expect(
      document.head
        .querySelector('meta[name="apple-mobile-web-app-title"]')
        ?.getAttribute("content"),
    ).toBe("Moj dan");
  });

  it("is a no-op for the module version that runs after it - React must not re-record kid values", () => {
    // Hard load of /kid: the bootstrap swaps, then the hook mounts and swaps
    // again. The second pass must not learn the kid values as the originals.
    bootstrapApply()(true, kid);
    applyKidInstallIdentityToDom(true, kid);
    expect(document.head.querySelectorAll('link[rel="manifest"]')).toHaveLength(2);

    applyKidInstallIdentityToDom(false, kid);

    expect(document.head.querySelectorAll('link[rel="manifest"]')).toHaveLength(1);
    expect(document.head.querySelector('link[rel="manifest"]')?.getAttribute("href")).toBe(
      APP_MANIFEST,
    );
    expect(document.head.querySelector('link[rel="icon"]')?.getAttribute("href")).toBe(APP_FAVICON);
    expect(document.head.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href")).toBe(
      APP_ICON,
    );
  });

  it("still inserts the manifest link when the grown-up one is not parsed yet", () => {
    // The real bootstrap runs mid-parse: vite-plugin-pwa's link is appended at
    // the very end of <head> and does not exist yet, so there is nothing to
    // insert before - and the kid link still has to end up first in tree order.
    document.head.innerHTML = `<link rel="apple-touch-icon" href="${APP_ICON}">`;
    bootstrapApply()(true, kid);

    const parsedLater = document.createElement("link");
    parsedLater.setAttribute("rel", "manifest");
    parsedLater.setAttribute("href", APP_MANIFEST);
    document.head.appendChild(parsedLater);

    expect(document.head.querySelector('link[rel="manifest"]')?.getAttribute("href")).toBe(
      `${PAGES_BASE}kid.webmanifest`,
    );
  });
});
