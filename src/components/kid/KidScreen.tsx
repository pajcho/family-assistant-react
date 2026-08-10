import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";

import { useKidThemeScope } from "@/components/kid/KidThemeScope";
import { KidThemeSheet } from "@/components/kid/KidThemeSheet";
import { useAuth } from "@/hooks/useAuth";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { findKidDevice, updateKidDeviceTheme } from "@/hooks/useKidLogin";
import {
  KID_TAB_PATHS,
  useKidActiveTab,
  useKidPreview,
  type KidTabPath,
} from "@/hooks/useKidPreview";
import { useKidSession } from "@/hooks/useKidSession";
import { useKidTheme } from "@/hooks/useKidTheme";
import { DEFAULT_KID_THEME, type KidTheme } from "@/types/kid";
import { resolveMemberAvatar } from "@/utils/memberAvatar";

/**
 * The frame every kid tab screen sits in: gradient header, scrolling body,
 * four-tab bar.
 *
 * Same structural trick as the grown-up app's `_app` layout, for the same iOS
 * reason: the frame is fixed at `100dvh` and never scrolls, the body scrolls
 * inside itself, and the header and the tab bar are plain flex siblings. No
 * `position: sticky`, no `position: fixed`, no backdrop-filter - all three of
 * which this project has already been bitten by on iOS.
 *
 * The parent-side preview (`/kid/preview`) renders this exact frame, with three
 * differences and no fourth: a banner strip on top, tabs that switch state
 * instead of route (the preview is one route), and a theme that lives in memory
 * because a grown-up may not write `kid_access`.
 */

interface KidTab {
  to: KidTabPath;
  emoji: string;
  label: string;
}

const KID_TABS: readonly KidTab[] = [
  { to: KID_TAB_PATHS[0], emoji: "☀️", label: "Danas" },
  { to: KID_TAB_PATHS[1], emoji: "🔭", label: "Uskoro" },
  { to: KID_TAB_PATHS[2], emoji: "🎒", label: "Raspored" },
  { to: KID_TAB_PATHS[3], emoji: "❤️", label: "Porodica" },
];

export function KidScreen({
  title,
  subtitle,
  headerExtra,
  children,
}: {
  /** The big greeting line, one per tab. */
  title: string;
  subtitle: string;
  /** Optional row under the greeting, inside the gradient (the day pills). */
  headerExtra?: ReactNode;
  children: ReactNode;
}) {
  const { kidProfileId } = useKidSession();
  const preview = useKidPreview();
  const { byId } = useFamilyMembers();
  // Same locally cached fallback the layout uses, so the picker never highlights
  // the wrong swatch for a frame while the row is still in flight.
  const fallbackTheme = useMemo(
    () => findKidDevice(kidProfileId)?.theme ?? DEFAULT_KID_THEME,
    [kidProfileId],
  );
  // In preview the query behind this is disabled (`isKid` is false) and the
  // mutation is never called - the picked theme lives in `KidThemeScope`, the
  // same in-memory channel the login screen uses before a session exists.
  const { theme: storedTheme, setTheme: setStoredTheme } = useKidTheme(fallbackTheme);
  const { previewTheme, setPreviewTheme } = useKidThemeScope();
  const theme = preview ? (previewTheme ?? DEFAULT_KID_THEME) : storedTheme;

  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [themeOpen, setThemeOpen] = useState(false);

  // The child's own emoji, if a parent picked one. Read off the roster rather
  // than `useProfile`, which under a PREVIEW returns the grown-up doing the
  // previewing - `kidProfileId` is the one id that means the same thing in both
  // a real kid session and a preview. The roster query is shared with Porodica
  // and cached, so the other tabs pay a cache hit, not a round trip.
  const me = byId.get(kidProfileId ?? "");
  const avatar = kidProfileId ? resolveMemberAvatar(me, kidProfileId) : "🙂";

  function pickTheme(next: KidTheme) {
    if (preview) {
      setPreviewTheme(next);
      return;
    }
    setStoredTheme(next);
    // Cache it locally too, so the login screen already wears the child's
    // colours the next time this device is opened.
    if (kidProfileId) updateKidDeviceTheme(kidProfileId, next);
  }

  async function handleSignOut() {
    setThemeOpen(false);
    await signOut();
    // The device entry stays in localStorage on purpose - signing back in is
    // just the PIN, no second QR code from a parent.
    await navigate({ to: "/kid/login" });
  }

  return (
    <div className="kid-font flex h-[100dvh] w-full flex-col overflow-hidden bg-[var(--k-bg)] text-[var(--k-ink)]">
      {preview ? <KidPreviewBanner /> : null}

      <header
        style={{ backgroundImage: "var(--k-grad)" }}
        className={`relative z-10 flex-none rounded-b-[26px] px-[18px] pb-4 text-white shadow-[0_10px_22px_-14px_rgb(0_0_0/0.35)] ${
          // The banner is the topmost element in preview, so IT carries the
          // safe-area inset and the header goes back to a plain pad.
          preview ? "pt-5" : "pt-[calc(env(safe-area-inset-top)+1.25rem)]"
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-[24px] leading-tight font-bold">{title}</h1>
            <p className="mt-0.5 truncate text-[13.5px] font-medium opacity-95">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={() => setThemeOpen(true)}
            aria-label="Tema i odjava"
            className="kid-on-gradient grid size-[46px] flex-none place-items-center rounded-2xl border-2 border-white/55 bg-white/25 text-[24px] leading-none transition-transform duration-100 active:scale-[0.92]"
          >
            <span aria-hidden="true">{avatar}</span>
          </button>
        </div>
        {headerExtra}
      </header>

      <main className="kid-scroll kid-rise min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-6">
        {children}
      </main>

      <KidBottomNav />

      <KidThemeSheet
        open={themeOpen}
        onClose={() => setThemeOpen(false)}
        avatar={avatar}
        theme={theme}
        onPick={pickTheme}
        // No sign-out in preview: the only session there is the parent's, and
        // ending it is the last thing looking at a child's app should do.
        onSignOut={preview ? undefined : () => void handleSignOut()}
      />
    </div>
  );
}

/**
 * The preview's one piece of grown-up chrome: whose view this is, what it does
 * NOT show, and the way out.
 *
 * Sits above the header rather than over the bottom bar, so it can never cover
 * a tab and the safe-area padding stays where it belongs (top inset here,
 * bottom inset on the nav). Not dismissible - a parent must never be left
 * unsure whether they are looking at their own app or their child's.
 *
 * Its colours are FIXED, and that is the point: this strip is not part of the
 * child's app, so it must not be drawn from the child's palette. It first was,
 * via `--k-ink`, which is dark ink in the light themes but near-white in
 * Svemir - and the banner turned into white text on pale lavender. A literal
 * dark neutral reads on every theme background (Svemir's included, with the
 * hairline below it doing the separating), the same way `KidTag`'s tones and
 * the sign-out red are literals for their own "must not shift per theme" reason.
 */
const PREVIEW_BANNER_SURFACE = "#161b2c";

function KidPreviewBanner() {
  const preview = useKidPreview();
  if (!preview) return null;

  return (
    <div
      role="status"
      style={{ backgroundColor: PREVIEW_BANNER_SURFACE }}
      className="flex flex-none items-center gap-3 border-b border-white/15 px-4 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-2.5 text-white"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-white">
          👀 Ovako aplikaciju vidi {preview.previewName}
        </p>
        <p className="text-[11.5px] leading-snug font-normal text-white/75">
          Vidi se samo ono što je dodeljeno ovom detetu.
        </p>
      </div>
      <button
        type="button"
        onClick={preview.exit}
        className="flex-none rounded-full border border-white/60 bg-white/15 px-3 py-1.5 text-[12px] font-semibold whitespace-nowrap text-white transition-transform duration-100 active:scale-95"
      >
        Izađi iz pregleda
      </button>
    </div>
  );
}

function KidBottomNav() {
  const preview = useKidPreview();
  const activeTab = useKidActiveTab();

  return (
    <nav
      aria-label="Glavni meni"
      className="flex flex-none items-start gap-1 border-t-[1.5px] border-[var(--k-line)] bg-[var(--k-nav)] px-2.5 pt-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)]"
    >
      {KID_TABS.map((tab) => {
        const active = tab.to === activeTab;
        const className = `flex flex-1 flex-col items-center gap-1 rounded-2xl py-2 text-[10.5px] font-semibold transition-transform duration-100 active:scale-[0.92] ${
          active ? "bg-[var(--k-soft)] text-[var(--k-accent)]" : "text-[var(--k-sub)]"
        }`;
        const body = (
          <>
            <span aria-hidden="true" className="text-[21px] leading-none">
              {tab.emoji}
            </span>
            {tab.label}
          </>
        );

        // The preview's four tabs share one route, so there is nothing to link
        // to - and a real <Link> would navigate straight out of the preview.
        return preview ? (
          <button
            key={tab.to}
            type="button"
            aria-current={active ? "page" : undefined}
            onClick={() => preview.setTab(tab.to)}
            className={className}
          >
            {body}
          </button>
        ) : (
          <Link
            key={tab.to}
            to={tab.to}
            aria-current={active ? "page" : undefined}
            className={className}
          >
            {body}
          </Link>
        );
      })}
    </nav>
  );
}
