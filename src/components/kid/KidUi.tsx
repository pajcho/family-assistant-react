import type { ReactNode } from "react";

/**
 * The kid shell's atoms - one big rounded card, one glyph tile, one chip.
 *
 * Every colour here comes from a `--k-*` variable and NOTHING references the
 * main app's tokens (`bg-card`, `text-foreground`, `bg-accent`), which is what
 * keeps a parent's light/dark mode and accent choice out of a child's screen.
 *
 * Weights stay inside the house scale (normal / medium / semibold / bold,
 * nothing heavier): the prototype reached for 800-900 throughout, and the
 * rounded font plus the generous sizes carry that chunkiness on their own.
 */

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

/** The glyph tile that opens every card - 46px, tinted, one big emoji. */
export function KidTile({ emoji, className = "" }: { emoji: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`grid size-[46px] flex-none place-items-center rounded-[15px] bg-[var(--k-soft)] text-[23px] leading-none ${className}`}
    >
      {emoji}
    </span>
  );
}

export function KidCardMain({ children }: { children: ReactNode }) {
  return <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">{children}</span>;
}

/**
 * `struck` is how a cancelled row reads at a glance. The muted colour is the
 * theme's own `--k-sub`, never an opacity: `--k-sub` is contrast-checked against
 * every surface in `kid.css`, while fading a card would quietly take the dark
 * theme's text below legible.
 */
export function KidCardTitle({
  children,
  struck = false,
}: {
  children: ReactNode;
  struck?: boolean;
}) {
  return (
    <span
      className={`text-[15.5px] leading-tight font-semibold ${
        struck ? "text-[var(--k-sub)] line-through decoration-2" : "text-[var(--k-ink)]"
      }`}
    >
      {children}
    </span>
  );
}

export function KidCardMeta({ children }: { children: ReactNode }) {
  return <span className="truncate text-[12.5px] font-normal text-[var(--k-sub)]">{children}</span>;
}

/** The one extra line a card may carry - "pomereno sa 18:00", in the accent. */
export function KidCardNote({ children }: { children: ReactNode }) {
  return (
    <span className="truncate text-[12px] font-medium text-[var(--k-accent)]">{children}</span>
  );
}

export function KidCardSide({ children }: { children: ReactNode }) {
  return <span className="flex flex-none flex-col items-end gap-1">{children}</span>;
}

export function KidCardTime({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return (
    <span
      className={`text-[15.5px] font-semibold ${muted ? "text-[var(--k-sub)]" : "text-[var(--k-ink)]"}`}
    >
      {children}
    </span>
  );
}

/** Shape and spacing shared by every card, whatever ends up hosting the taps. */
const CARD_SHAPE = "mb-2.5 flex w-full items-center gap-3 rounded-[20px] border-[1.5px] text-left";
const CARD_BASE = `${CARD_SHAPE} px-3.5 py-3`;

/**
 * The card's surface, chosen in ONE place rather than layered as overrides: two
 * competing `bg-*` utilities would leave the winner to stylesheet order.
 */
function cardSurface({ muted, highlighted }: { muted?: boolean; highlighted?: boolean }): string {
  if (muted) return "border-[var(--k-line)] bg-[var(--k-bg)]";
  if (highlighted) {
    return "border-[var(--k-accent)] bg-[var(--k-soft)] shadow-[var(--k-shadow)]";
  }
  return "border-[var(--k-line)] bg-[var(--k-card)] shadow-[var(--k-shadow)]";
}

/**
 * A card. `onClick` makes it a real <button> with a press response; without one
 * it is a plain <div>, because a kid tapping something that does nothing is a
 * small betrayal.
 */
export function KidCard({
  children,
  onClick,
  ariaLabel,
  gradientBorder = false,
  highlighted = false,
  muted = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  ariaLabel?: string;
  /** Paints the border with the theme gradient - the school-today card. */
  gradientBorder?: boolean;
  /** The current class in the ladder: accent border on a tinted surface. */
  highlighted?: boolean;
  /**
   * Cancelled: the card sinks into the page - background colour, no shadow -
   * so it reads as "off" without any text losing contrast.
   */
  muted?: boolean;
}) {
  const className = [
    CARD_BASE,
    cardSurface({ muted, highlighted }),
    gradientBorder ? "kid-gradient-border border-2" : "",
    onClick ? "transition-transform duration-100 active:scale-[0.975]" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (!onClick) {
    return <div className={className}>{children}</div>;
  }
  return (
    <button type="button" onClick={onClick} aria-label={ariaLabel} className={className}>
      {children}
    </button>
  );
}

/**
 * The tick circle on a chore card - 34px of paint inside a 46px tap target,
 * because a child's thumb lands wider than an adult's and the whole point of the
 * card is that this is hittable on the first go.
 *
 * `onToggle` is optional: a chore a child cannot resolve yet (tomorrow's, or
 * anything in the parent preview) renders the same circle as a plain <span>. A
 * disabled button that swallows the tap would be a dead end, so the tap falls
 * through to the card behind it and opens the details instead.
 */
export function KidCheckCircle({
  done,
  onToggle,
  ariaLabel,
}: {
  done: boolean;
  onToggle?: () => void;
  ariaLabel?: string;
}) {
  const face = (
    <span
      aria-hidden="true"
      className={`grid size-[34px] place-items-center rounded-full border-2 text-[19px] leading-none ${
        done
          ? "border-[var(--k-accent)] bg-[var(--k-accent)] text-[var(--k-accent-ink)]"
          : // An empty ring on the card's own surface, so it reads the same
            // whichever card it lands on. `--k-sub` rather than the hairline
            // `--k-line`: a child has to SEE that there is something to press.
            "border-[var(--k-sub)]"
      }`}
    >
      {done ? "✓" : null}
    </span>
  );

  if (!onToggle) return <span className="flex-none p-1.5">{face}</span>;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={done}
      aria-label={ariaLabel}
      className="flex-none rounded-full p-1.5 transition-transform duration-100 active:scale-[0.85]"
    >
      {face}
    </button>
  );
}

/**
 * A card with TWO controls: the tick circle and the body that opens the details.
 *
 * They are SIBLINGS, never nested. A button inside a button is invalid markup
 * and the inner one swallows the outer's taps - the same reason `ListItemRow`
 * keeps its checkbox label beside the row body in the grown-up app. The body
 * carries the padding so it fills the card's full height and reaches its right
 * edge: everything except the circle opens the sheet, wherever the thumb lands.
 */
export function KidCheckableCard({
  circle,
  children,
  onOpen,
  ariaLabel,
}: {
  circle: ReactNode;
  children: ReactNode;
  onOpen: () => void;
  ariaLabel?: string;
}) {
  return (
    <div className={`${CARD_SHAPE} ${cardSurface({})} pl-3.5`}>
      {circle}
      <button
        type="button"
        onClick={onOpen}
        aria-label={ariaLabel}
        className="flex min-w-0 flex-1 items-center gap-3 py-3 pr-3.5 text-left transition-transform duration-100 active:scale-[0.985]"
      >
        {children}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chips + headings
// ---------------------------------------------------------------------------

export type KidTagTone = "activity" | "task" | "done" | "event" | "birthday" | "span" | "canceled";

/**
 * The little type chips. Fixed literal colours on purpose: they must read the
 * same in every theme, so an aktivnost is green whether the child picked
 * Okean or Svemir. Every tone passes contrast on both the light card and the
 * dark (Svemir) one, because the chip brings its own light background - which is
 * also why "otkazano" stays legible on a muted card in the dark theme.
 *
 * `task` and `done` are the two states of one chip on the same card, so they are
 * picked as a pair: amber for "still to do", green for "finished". The green is
 * the same one an aktivnost wears, and deliberately so - green already means
 * "this is fine" in this shell, and a child should not have to learn a second
 * word for it.
 */
const TAG_TONE_GREEN = "bg-[#ddf5e4] text-[#136c3b]";

const TAG_TONES: Record<KidTagTone, string> = {
  activity: TAG_TONE_GREEN,
  task: "bg-[#ffe9c9] text-[#8a5200]",
  done: TAG_TONE_GREEN,
  event: "bg-[#dfebff] text-[#204ead]",
  birthday: "bg-[#ffe1ee] text-[#ad2565]",
  span: "bg-[#ebe3ff] text-[#5c35bd]",
  canceled: "bg-[#ffe1e1] text-[#a12b2b]",
};

export function KidTag({ tone, children }: { tone: KidTagTone; children: ReactNode }) {
  return (
    <span
      className={`rounded-full px-2.5 py-[3px] text-[10.5px] font-semibold whitespace-nowrap ${TAG_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/** A day / section heading, with an optional countdown chip beside it. */
export function KidGroupHeading({ title, chip }: { title: string; chip?: string | null }) {
  return (
    <h2 className="mx-1 mt-4 mb-2 flex items-center gap-2 text-[12px] font-bold tracking-[0.07em] text-[var(--k-sub)] uppercase first:mt-0.5">
      <span>{title}</span>
      {chip ? (
        <span className="rounded-full bg-[var(--k-soft)] px-2.5 py-0.5 text-[10.5px] font-medium tracking-normal text-[var(--k-accent)] normal-case">
          {chip}
        </span>
      ) : null}
    </h2>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

/** The friendly full stop at the end of a finished list. */
export function KidDone({ children }: { children: ReactNode }) {
  return (
    <p className="px-2 pt-4 pb-1.5 text-center text-[13.5px] font-medium text-[var(--k-sub)]">
      {children}
    </p>
  );
}

/**
 * A real empty state - a big glyph, a warm line, and (when it helps) one line
 * telling the child where the thing actually comes from.
 */
export function KidEmptyState({
  emoji,
  title,
  hint,
}: {
  emoji: string;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span aria-hidden="true" className="text-[56px] leading-none">
        {emoji}
      </span>
      <p className="mt-4 text-[17px] font-semibold text-[var(--k-ink)]">{title}</p>
      {hint ? (
        <p className="mt-1.5 max-w-[26ch] text-[13px] leading-relaxed font-normal text-[var(--k-sub)]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Loading placeholders shaped like the cards they replace, so the screen keeps
 * its rhythm instead of flashing empty and then jumping.
 */
export function KidCardSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div aria-hidden="true" className="animate-pulse">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="mb-2.5 flex items-center gap-3 rounded-[20px] border-[1.5px] border-[var(--k-line)] bg-[var(--k-card)] px-3.5 py-3"
        >
          <span className="size-[46px] flex-none rounded-[15px] bg-[var(--k-soft)]" />
          <span className="flex flex-1 flex-col gap-2">
            <span className="h-3.5 w-1/2 rounded-full bg-[var(--k-soft)]" />
            <span className="h-2.5 w-3/4 rounded-full bg-[var(--k-soft)]" />
          </span>
        </div>
      ))}
    </div>
  );
}
