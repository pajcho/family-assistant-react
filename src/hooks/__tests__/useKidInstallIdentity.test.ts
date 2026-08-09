import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useKidInstallIdentity } from "@/hooks/useKidInstallIdentity";

/**
 * The failure this guards against is silent and permanent: a parent leaves a
 * child's app and installs their own, and gets a kid-branded tile that no
 * amount of later code can fix, because neither iOS nor Android re-reads the
 * icon of an app that is already installed.
 *
 * The hook's own job is that RESTORE half - the apply half now also runs from
 * the `index.html` bootstrap, covered in `src/lib/__tests__/kidInstallIdentity`.
 *
 * No supabase in the import chain here, deliberately - the hook is pure DOM.
 */
describe("useKidInstallIdentity", () => {
  const APP_MANIFEST = "/manifest.webmanifest";
  const APP_FAVICON = "/favicon.svg";
  const APP_ICON = "/apple-touch-icon-180x180.png";
  const APP_TITLE = "Porodicni";

  function head() {
    return {
      manifest: document.head.querySelector('link[rel="manifest"]')?.getAttribute("href"),
      manifests: document.head.querySelectorAll('link[rel="manifest"]').length,
      favicon: document.head.querySelector('link[rel="icon"]')?.getAttribute("href"),
      icon: document.head.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href"),
      title: document.head
        .querySelector('meta[name="apple-mobile-web-app-title"]')
        ?.getAttribute("content"),
      startupImages: document.head.querySelectorAll('link[rel="apple-touch-startup-image"]').length,
    };
  }

  beforeEach(() => {
    document.head.innerHTML = `
      <link rel="icon" type="image/svg+xml" href="${APP_FAVICON}">
      <link rel="apple-touch-icon" href="${APP_ICON}">
      <meta name="apple-mobile-web-app-title" content="${APP_TITLE}">
      <link rel="apple-touch-startup-image" media="screen" href="/apple-splash-portrait-light-640x1136.png">
      <link rel="apple-touch-startup-image" media="screen" href="/apple-splash-landscape-light-1136x640.png">
      <link rel="manifest" href="${APP_MANIFEST}">
    `;
  });

  afterEach(() => {
    document.head.innerHTML = "";
  });

  it("wears the kid identity while mounted and gives it back on unmount", () => {
    const view = renderHook(() => useKidInstallIdentity(true));

    expect(head().manifest).toBe("/kid.webmanifest");
    expect(head().favicon).toBe("/kid-favicon.svg");
    expect(head().icon).toBe("/kid-apple-touch-icon-180x180.png");
    expect(head().title).toBe("Moj dan");

    view.unmount();

    expect(head()).toMatchObject({
      manifest: APP_MANIFEST,
      favicon: APP_FAVICON,
      icon: APP_ICON,
      title: APP_TITLE,
    });
  });

  it("adds the kid manifest in front of the grown-up one, and removes it again", () => {
    // The grown-up link is injected by vite-plugin-pwa at the end of <head> and
    // is never rewritten: the browser reads the FIRST manifest link, so putting
    // the kid one ahead of it is the whole swap - and taking it away is the
    // whole restore.
    const view = renderHook(() => useKidInstallIdentity(true));

    expect(head().manifests).toBe(2);
    const links = [...document.head.querySelectorAll('link[rel="manifest"]')];
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/kid.webmanifest",
      APP_MANIFEST,
    ]);

    view.unmount();

    expect(head().manifests).toBe(1);
    expect(head().manifest).toBe(APP_MANIFEST);
  });

  it("leaves the document alone when disabled - this is the preview route", () => {
    const view = renderHook(() => useKidInstallIdentity(false));

    expect(head()).toMatchObject({
      manifest: APP_MANIFEST,
      manifests: 1,
      favicon: APP_FAVICON,
      icon: APP_ICON,
      title: APP_TITLE,
      startupImages: 2,
    });

    view.unmount();
    expect(head().manifest).toBe(APP_MANIFEST);
  });

  it("takes the grown-up iOS splash screens out of play, and puts them back", () => {
    const view = renderHook(() => useKidInstallIdentity(true));
    expect(head().startupImages).toBe(0);

    view.unmount();
    expect(head().startupImages).toBe(2);
  });

  it("restores the grown-up values after being toggled off mid-session", () => {
    const view = renderHook(({ enabled }) => useKidInstallIdentity(enabled), {
      initialProps: { enabled: true },
    });
    expect(head().title).toBe("Moj dan");

    view.rerender({ enabled: false });

    expect(head()).toMatchObject({
      manifest: APP_MANIFEST,
      manifests: 1,
      favicon: APP_FAVICON,
      icon: APP_ICON,
      title: APP_TITLE,
      startupImages: 2,
    });
  });

  it("survives a double apply without learning kid values as the defaults", () => {
    // What React StrictMode does in development: mount, unmount, mount again.
    const first = renderHook(() => useKidInstallIdentity(true));
    const second = renderHook(() => useKidInstallIdentity(true));
    expect(head().title).toBe("Moj dan");
    expect(head().manifests).toBe(2);

    first.unmount();
    second.unmount();

    expect(head()).toMatchObject({
      manifest: APP_MANIFEST,
      manifests: 1,
      favicon: APP_FAVICON,
      icon: APP_ICON,
      title: APP_TITLE,
      startupImages: 2,
    });
  });
});
