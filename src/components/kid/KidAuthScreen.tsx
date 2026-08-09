import type { ReactNode } from "react";

/**
 * The gradient screen behind both pre-session routes (`/kid/login` and
 * `/kid/veza`).
 *
 * It is the whole page rather than a header, because before a child is signed
 * in there is nothing else to show - and because a full-bleed gradient with
 * four bobbing decorations is what makes the app feel like theirs from the very
 * first frame. The gradient is the app's own violet rather than a theme, which
 * is `.kid-auth-screen` in `kid.css` and the reasoning is there.
 */
export function KidAuthScreen({
  emoji,
  title,
  subtitle,
  children,
  footer,
}: {
  /**
   * A one-off mark for a state that is not the app itself - a dead link, an
   * error. Leave it out and the screen shows the app's own mark, the house
   * from the home-screen icon.
   */
  emoji?: string;
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="kid-auth-screen kid-font kid-scroll relative flex h-[100dvh] w-full flex-col items-center overflow-y-auto px-6 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-[calc(env(safe-area-inset-bottom)+1.25rem)] text-white">
      <KidDecorations />

      <div className="relative flex w-full max-w-[340px] flex-1 flex-col items-center">
        {/* The mark shrinks on a short screen so the keypad and its button
            still land above the fold on a 667px-tall phone. Both marks are
            capped at the same heights for that reason - the drawing is wider
            than it is tall, so it is sized by height and left to find its own
            width. */}
        {emoji ? (
          <span
            aria-hidden="true"
            className="grid size-[68px] flex-none place-items-center rounded-[24px] border-[2.5px] border-white/50 bg-white/25 text-[36px] leading-none sm:size-[86px] sm:rounded-[28px] sm:text-[44px]"
          >
            {emoji}
          </span>
        ) : (
          /* Generated from `public/kid-icon.svg` by `pnpm assets:kid`, which is
             what keeps this the same drawing as the installed tile. No frame
             around it: the page is already the tile colour, so a tile here
             would be an invisible square with visible empty margins. */
          <img
            src={`${import.meta.env.BASE_URL}kid-mark.svg`}
            alt=""
            aria-hidden="true"
            className="h-[64px] w-auto flex-none sm:h-[80px]"
          />
        )}
        <h1 className="mt-2.5 text-center text-[27px] leading-tight font-bold sm:text-[31px]">
          {title}
        </h1>
        <p className="mt-1 text-center text-[13px] font-medium opacity-95">{subtitle}</p>

        {children}

        {footer ? (
          <div className="mt-auto w-full pt-4 text-center text-[12px] leading-relaxed font-normal opacity-95">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Four floating bits of confetti. Purely decorative, and still under reduced motion. */
function KidDecorations() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <span className="kid-bob absolute top-[18%] left-5 text-[30px] opacity-30">🎈</span>
      <span
        className="kid-bob absolute top-[28%] right-7 text-[30px] opacity-30"
        style={{ animationDelay: "1.2s" }}
      >
        ⭐
      </span>
      <span
        className="kid-bob absolute bottom-[22%] left-7 text-[30px] opacity-30"
        style={{ animationDelay: "0.6s" }}
      >
        ⚽
      </span>
      <span
        className="kid-bob absolute right-6 bottom-[12%] text-[30px] opacity-30"
        style={{ animationDelay: "1.8s" }}
      >
        🎨
      </span>
    </div>
  );
}

/**
 * The error / status line under the keypad. Announced politely, so a wrong PIN
 * reaches a screen reader without stealing focus from the pad.
 */
export function KidAuthMessage({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="mt-4 w-full max-w-[300px] rounded-2xl bg-white/20 px-4 py-3 text-center text-[13px] leading-relaxed font-medium text-white"
    >
      {children}
    </p>
  );
}
