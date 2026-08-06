import { NAV_SECTIONS, type NavSection, type NavSectionKey } from "@/components/layout/navSections";
import { isApplePlatform } from "@/lib/platform";

/**
 * The app's keyboard map, in Linear's shape.
 *
 * Linear navigates with a "G then key" sequence and fires actions from bare
 * letters, deliberately avoiding modifiers - which is why their shortcuts are
 * IDENTICAL on macOS and Windows, with nothing to translate and no collisions
 * with either OS. We copy that: `G D` for Danas, `C` to add, `?` for this list,
 * and ⌘/Ctrl+K stays the one modifier shortcut because every app on both
 * platforms spells search that way.
 *
 * Letters follow the Serbian labels, so the sequence reads as the word you are
 * going to. Two labels collide on their first letter and both are resolved in
 * favour of the more frequent destination:
 *   - Danas and Događaji both want D. Danas keeps it (it is the home screen);
 *     Događaji takes O, its next spoken letter ("dOgađaji").
 *   - Porodica and Podešavanja both want P. Porodica keeps it; Podešavanja
 *     takes S, which is what Linear (and most apps) use for settings anyway.
 */

/** Second key of the `G` sequence, per destination. */
export const NAV_SHORTCUT_KEYS: Readonly<Record<NavSectionKey, string>> = {
  today: "D",
  calendar: "K",
  money: "N",
  lists: "L",
  activities: "A",
  events: "O",
  birthdays: "R",
  family: "P",
  settings: "S",
};

/** Reverse map for the key handler: pressed letter → destination. */
export const SECTION_BY_SHORTCUT: Readonly<Record<string, NavSection>> = Object.fromEntries(
  NAV_SECTIONS.map((section) => [NAV_SHORTCUT_KEYS[section.key].toLowerCase(), section]),
);

/** How long `G` waits for its second key before giving up. */
export const CHORD_TIMEOUT_MS = 1500;

/** Keys as the shortcuts list draws them, e.g. `["G", "D"]`. */
export function navShortcutKeys(key: NavSectionKey): [string, string] {
  return ["G", NAV_SHORTCUT_KEYS[key]];
}

/** One-line form for a `title` tooltip: "Danas (G D)". */
export function navShortcutLabel(section: NavSection): string {
  return `${section.label} (G ${NAV_SHORTCUT_KEYS[section.key]})`;
}

export type ShortcutRow = { keys: string[]; label: string };

/** The action half of the map - everything that is not a destination. */
export function actionShortcuts(): ShortcutRow[] {
  return [
    { keys: [isApplePlatform() ? "⌘" : "Ctrl", "K"], label: "Pretraga" },
    { keys: ["C"], label: "Dodaj (trošak, plaćanje, događaj…)" },
    { keys: ["?"], label: "Ova lista prečica" },
    { keys: ["Esc"], label: "Zatvori otvoreni prozor" },
  ];
}

/**
 * Whether a keystroke belongs to whatever the member is typing into. Bare
 * letters as shortcuts means every text field would otherwise eat the letter
 * AND jump the screen.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * True while a modal is up. Shortcuts stay out of the way then: the sheet owns
 * the keyboard (Escape, form fields, its own buttons) and jumping the screen
 * out from under an open form would lose whatever was typed.
 */
export function isModalOpen(): boolean {
  if (typeof document === "undefined") return false;
  return document.querySelector('[role="dialog"][data-state="open"]') != null;
}
