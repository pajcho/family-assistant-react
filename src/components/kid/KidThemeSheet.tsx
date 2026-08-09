import { useId, useState } from "react";

import { KidSheet, KidSheetButton, KidSheetTitle } from "@/components/kid/KidSheet";
import { KID_THEME_OPTIONS, type KidTheme } from "@/types/kid";

/**
 * The child's one and only settings surface: pick a theme, or sign out.
 *
 * Reached by tapping the avatar in the header, which is the only control in the
 * header at all. Everything else a grown-up app would put here - profile,
 * notifications, account - does not exist in the kid shell on purpose: fewer
 * screens, fewer ways for something to go wrong.
 *
 * `onSignOut` is omitted in the parent-side preview: there is no child session
 * to end there, and the theme is only tried on, not saved.
 */
export function KidThemeSheet({
  open,
  onClose,
  avatar,
  theme,
  onPick,
  onSignOut,
}: {
  open: boolean;
  onClose: () => void;
  avatar: string;
  theme: KidTheme;
  onPick: (theme: KidTheme) => void;
  /** Omitted = preview: no session to end, and the theme is not persisted. */
  onSignOut?: () => void;
}) {
  const titleId = useId();
  // Two-step sign-out. Nothing is lost either way (this device still remembers
  // the child, so getting back in is just the PIN), but a stray tap on a big
  // red button should not end the session outright.
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);

  return (
    <KidSheet
      open={open}
      onClose={() => {
        setConfirmingSignOut(false);
        onClose();
      }}
      labelledBy={titleId}
    >
      <KidSheetTitle id={titleId} emoji={avatar} title="Izaberi temu" />

      {/* Two columns, so eight themes are four rows. The tiles are tighter than
          the rest of the shell (34px swatch, py-2) for one reason: the sheet is
          capped at 80% of the screen, and at the old size four rows plus the
          two buttons below spilled past that on a 667px-tall phone. A 54px row
          is still well over the 44px touch target. */}
      <div role="radiogroup" aria-label="Tema" className="mt-2.5 grid grid-cols-2 gap-2">
        {KID_THEME_OPTIONS.map((option) => {
          const active = option.key === theme;
          return (
            <button
              key={option.key}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onPick(option.key)}
              className={`flex items-center gap-2.5 rounded-[18px] border-2 px-2.5 py-2 text-left text-[13.5px] font-semibold transition-transform duration-100 active:scale-95 ${
                active
                  ? "border-[var(--k-accent)] bg-[var(--k-soft)]"
                  : "border-[var(--k-line)] bg-[var(--k-card)]"
              }`}
            >
              <span
                aria-hidden="true"
                style={{ backgroundImage: option.swatch }}
                className="grid size-[34px] flex-none place-items-center rounded-[12px] text-[16px] leading-none"
              >
                {option.emoji}
              </span>
              <span className="min-w-0 flex-1 text-[var(--k-ink)]">{option.label}</span>
            </button>
          );
        })}
      </div>

      <KidSheetButton
        onClick={() => {
          setConfirmingSignOut(false);
          onClose();
        }}
      >
        Zatvori
      </KidSheetButton>

      {onSignOut ? (
        <>
          <button
            type="button"
            onClick={() => {
              if (!confirmingSignOut) {
                setConfirmingSignOut(true);
                return;
              }
              onSignOut();
            }}
            // Danger reads off the theme, never a fixed rose: a saturated
            // #e11d48 is right on a white card but vibrates against Svemir's
            // dark purple, and the confirm state's near-white pink surface was
            // a hole punched in a dark sheet. Each theme carries its own trio.
            className={`mt-3 w-full rounded-2xl border-[1.5px] border-dashed px-4 py-3.5 text-[14px] font-semibold transition-transform duration-100 active:scale-[0.97] ${
              confirmingSignOut
                ? "border-[var(--k-danger)] bg-[var(--k-danger-soft)] text-[var(--k-danger-ink)]"
                : "border-[var(--k-line)] text-[var(--k-danger)]"
            }`}
          >
            {confirmingSignOut ? "Stvarno se odjavi? Tapni opet 👋" : "🚪 Odjavi se"}
          </button>
          <p className="mt-2 px-2 text-center text-[11.5px] leading-relaxed font-normal text-[var(--k-sub)]">
            Ovaj uređaj te pamti - kad se vratiš, treba ti samo tvoj PIN.
          </p>
        </>
      ) : (
        <p className="mt-2.5 px-2 text-center text-[11.5px] leading-relaxed font-normal text-[var(--k-sub)]">
          U pregledu tema se ne čuva - dete zadržava svoju.
        </p>
      )}
    </KidSheet>
  );
}
