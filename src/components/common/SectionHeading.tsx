import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * Group header (prototype `.gh`) - the small uppercase label that opens every
 * grouped list in the redesign: a day in the agenda, a month in the birthday
 * list, the heading above the overdue block.
 *
 * `count` renders the outlined bubble on the right of the label; `tone="neg"`
 * turns the whole header red for the overdue group. `muted` dims it further -
 * the agenda renders a header for days with nothing on them, and those should
 * read as inactive rather than as a real section.
 */

/**
 * The pinning recipe, in one place because five surfaces use it and a header
 * that gets one detail wrong looks broken rather than slightly off:
 *
 *   - `--agenda-sticky-top` is the height of whatever chrome is pinned ABOVE
 *     the list (the calendar's week strip). Undefined everywhere else, hence
 *     the 0 fallback, which parks the header flush under `AppScreen`'s header.
 *   - OPAQUE background, never a backdrop-filter: iOS fails to repaint one on
 *     scroll. `--heading-sticky-bg` lets a surface that is not the page
 *     background (the desktop detail panel is `bg-card`) say so.
 *   - The horizontal bleed is what lets rounded rows pass cleanly UNDER the
 *     header instead of showing a sliver of themselves beside it.
 *
 * Two things every caller has to get right, both about the HANDOFF - the moment
 * one header is pushed out by the next:
 *
 *   1. Sections must TOUCH. A margin between them is a strip belonging to no
 *      section, where the outgoing header has left and the next has not arrived.
 *   2. The gap between sections must live INSIDE the section's content, not in
 *      the section's own padding. A sticky element is constrained by its
 *      containing block's CONTENT box, so `pb-4` on the section stops the header
 *      16px short of where the next section begins - the same uncovered strip,
 *      just harder to spot. Hence the `pb-*` on the rows wrapper below every
 *      header rather than on the `<section>` around it.
 */
const STICKY_HEADING =
  "sticky top-[var(--agenda-sticky-top,0px)] z-10 -mx-1.5 bg-[var(--heading-sticky-bg,var(--color-background))] px-1.5 pt-1 pb-2";

export function SectionHeading({
  count,
  tone = "default",
  muted = false,
  sticky = false,
  as: Tag = "h2",
  className,
  children,
}: {
  count?: ReactNode;
  tone?: "default" | "neg";
  muted?: boolean;
  /** Pin the header while its own section scrolls past. See {@link STICKY_HEADING}. */
  sticky?: boolean;
  as?: "h2" | "h3" | "div";
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag
      className={cn(
        "flex items-center gap-2 px-[3px] text-[11.5px] font-bold tracking-[0.08em] uppercase",
        tone === "neg" ? "text-neg" : muted ? "text-muted-foreground/60" : "text-muted-foreground",
        sticky && STICKY_HEADING,
        className,
      )}
    >
      <span className="min-w-0 truncate">{children}</span>
      {count != null ? (
        <span className="shrink-0 rounded-full border border-border bg-card px-2 py-px text-[10.5px] tracking-normal">
          {count}
        </span>
      ) : null}
    </Tag>
  );
}
