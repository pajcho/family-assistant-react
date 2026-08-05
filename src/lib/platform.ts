/**
 * Which modifier the search shortcut is spelled with on this machine.
 *
 * The handler itself accepts both (`metaKey || ctrlKey`), so this is purely
 * what the UI writes: a Windows/Linux user reading "⌘K" has nothing to press.
 * Ctrl - not the Windows key - is the pairing here: Win+K is taken by the OS
 * (Cast), and Ctrl+K is what every other app on the platform uses for search.
 *
 * `userAgentData.platform` is the modern signal; `navigator.platform` is the
 * fallback that still covers Safari and Firefox.
 */

export function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return true;
  const uaPlatform = (navigator as Navigator & { userAgentData?: { platform?: string } })
    .userAgentData?.platform;
  const platform = uaPlatform || navigator.platform || "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** Modifier label for the ⌘K / Ctrl+K hint, e.g. `["⌘", "K"]`. */
export function searchShortcutKeys(): [string, string] {
  return [isApplePlatform() ? "⌘" : "Ctrl", "K"];
}

/** One-line form for tooltips: "Pretraga (⌘K)" / "Pretraga (Ctrl+K)". */
export function searchShortcutLabel(): string {
  const [modifier, key] = searchShortcutKeys();
  return modifier === "⌘" ? `${modifier}${key}` : `${modifier}+${key}`;
}
