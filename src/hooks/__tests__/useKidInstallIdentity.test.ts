import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useKidInstallIdentity } from "@/hooks/useKidInstallIdentity";

/**
 * The failure this guards against is silent and permanent: a parent leaves a
 * child's app and installs their own, and gets a kid-branded tile that no
 * amount of later code can fix, because neither iOS nor Android re-reads the
 * icon of an app that is already installed.
 *
 * No supabase in the import chain here, deliberately - the hook is pure DOM.
 */
describe("useKidInstallIdentity", () => {
  const APP_MANIFEST = "/manifest.webmanifest";
  const APP_ICON = "/apple-touch-icon-180x180.png";
  const APP_TITLE = "Porodicni";

  function head() {
    return {
      manifest: document.head.querySelector('link[rel="manifest"]')?.getAttribute("href"),
      icon: document.head.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href"),
      title: document.head
        .querySelector('meta[name="apple-mobile-web-app-title"]')
        ?.getAttribute("content"),
      startupImages: document.head.querySelectorAll('link[rel="apple-touch-startup-image"]').length,
    };
  }

  beforeEach(() => {
    document.head.innerHTML = `
      <link rel="manifest" href="${APP_MANIFEST}">
      <link rel="apple-touch-icon" href="${APP_ICON}">
      <meta name="apple-mobile-web-app-title" content="${APP_TITLE}">
      <link rel="apple-touch-startup-image" media="screen" href="/apple-splash-portrait-light-640x1136.png">
      <link rel="apple-touch-startup-image" media="screen" href="/apple-splash-landscape-light-1136x640.png">
    `;
  });

  afterEach(() => {
    document.head.innerHTML = "";
  });

  it("wears the kid identity while mounted and gives it back on unmount", () => {
    const view = renderHook(() => useKidInstallIdentity(true));

    expect(head().manifest).toBe("/kid.webmanifest");
    expect(head().icon).toBe("/kid-apple-touch-icon-180x180.png");
    expect(head().title).toBe("Moj dan");

    view.unmount();

    expect(head()).toMatchObject({
      manifest: APP_MANIFEST,
      icon: APP_ICON,
      title: APP_TITLE,
    });
  });

  it("leaves the document alone when disabled - this is the preview route", () => {
    const view = renderHook(() => useKidInstallIdentity(false));

    expect(head()).toMatchObject({
      manifest: APP_MANIFEST,
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

    first.unmount();
    second.unmount();

    expect(head()).toMatchObject({
      manifest: APP_MANIFEST,
      icon: APP_ICON,
      title: APP_TITLE,
      startupImages: 2,
    });
  });
});
