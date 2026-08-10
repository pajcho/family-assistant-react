import type { ComponentProps, ComponentType, ReactNode, SVGProps } from "react";

import { cn } from "@/lib/cn";

/**
 * Small chrome pieces shared by the three Novac views (Pregled / Troškovi /
 * Plaćanja), lifted straight out of the redesign prototype so the hub reads as
 * one screen instead of two pages glued together.
 *
 * Everything here is presentational and token-only: the money semantics
 * (pos / warn / neg / info) never follow the user's accent, while chrome
 * (headers, chips, the selected segment) always does.
 */

/** Soft-tint colorways. Money meaning is fixed; `accent` is chrome. */
export type MoneyTone = "accent" | "pos" | "warn" | "neg" | "info" | "muted";

const TONE_TILE: Record<MoneyTone, string> = {
  accent: "bg-accent-soft text-accent-deep",
  pos: "bg-pos-soft text-pos",
  warn: "bg-warn-soft text-warn",
  neg: "bg-neg-soft text-neg",
  info: "bg-info-soft text-info",
  muted: "bg-muted text-muted-foreground",
};

/** Status pill ("kasni 3 dana", "deo računa", "Administrator"). */
export function StatusPill({
  tone = "accent",
  className,
  children,
}: {
  tone?: MoneyTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-[3px] text-[10.5px] leading-tight font-bold tracking-[0.02em] whitespace-nowrap",
        TONE_TILE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Uppercase group heading with an optional count bubble and a right-aligned
 * action ("Po kategorijama ... Uredi ›"). `tone="neg"` is the Prekoračeno
 * group, the one heading that carries colour.
 *
 * The `mt-8` is the section rhythm for the whole Novac hub - it must NOT be a
 * `first:` variant, because every caller wraps the header in its own
 * `<section>`, which would make `:first-child` match every single time and
 * flatten the gap everywhere. A header that opens a screen passes `mt-1`.
 */
export function GroupHeader({
  title,
  count,
  action,
  tone = "muted",
  className,
}: {
  title: ReactNode;
  count?: number;
  action?: ReactNode;
  tone?: "muted" | "neg";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-[3px] mt-8 mb-2 flex items-center gap-2 text-[11.5px] font-bold tracking-[0.08em] uppercase",
        tone === "neg" ? "text-neg" : "text-muted-foreground",
        className,
      )}
    >
      <span>{title}</span>
      {count != null ? (
        <span className="rounded-full border border-border bg-card px-2 py-px text-[10.5px] tabular-nums">
          {count}
        </span>
      ) : null}
      {action ? <span className="ml-auto">{action}</span> : null}
    </div>
  );
}

/** The quiet "Uredi ›" / "Prikaži sve" link that sits inside a GroupHeader. */
export function GroupHeaderAction({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 rounded-sm text-[12.5px] font-semibold tracking-normal text-accent-deep normal-case focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {children}
    </button>
  );
}

/** Panel card ("hero-b"): the surface every Pregled module sits on. */
export function MoneyCard({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("rounded-2xl border border-border bg-card p-4 shadow-card", className)}>
      {children}
    </div>
  );
}

/**
 * Header icon button ("iconbtn"): the tile reads as 38px, but the button
 * itself is a full 44px touch target with the tile centred inside it.
 *
 * Leftover props are spread onto the `<button>`, so this can also be handed to
 * a Radix `asChild` trigger (the header's "Dodaj" menu). `active` is only for
 * real toggles - leave it off and no `aria-pressed` is emitted, which is what a
 * menu trigger wants (it carries aria-expanded instead).
 */
export function HeaderIconButton({
  icon: Icon,
  label,
  active,
  className,
  ...props
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  active?: boolean;
} & Omit<ComponentProps<"button">, "aria-label" | "children">) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "grid size-11 shrink-0 place-items-center rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          "grid size-[38px] place-items-center rounded-md border shadow-card transition-colors",
          active
            ? "border-accent bg-accent-soft text-accent-deep"
            : "border-border bg-card text-foreground",
        )}
      >
        <Icon className="size-[19px]" />
      </span>
    </button>
  );
}

/**
 * The stacked progress bar under the cycle amounts and inside the category
 * rows. `segments` are rendered in order; widths are percentages of the track.
 */
export function ProgressTrack({
  segments,
  className,
}: {
  segments: ReadonlyArray<{ key: string; pct: number; className?: string; color?: string }>;
  className?: string;
}) {
  return (
    <div className={cn("flex h-2.5 overflow-hidden rounded-full bg-muted", className)}>
      {segments.map((segment) => (
        <span
          key={segment.key}
          className={cn("block h-full rounded-full transition-[width]", segment.className)}
          style={{
            width: `${Math.max(0, Math.min(100, segment.pct))}%`,
            backgroundColor: segment.color,
          }}
        />
      ))}
    </div>
  );
}
