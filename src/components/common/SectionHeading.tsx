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

export function SectionHeading({
  count,
  tone = "default",
  muted = false,
  as: Tag = "h2",
  className,
  children,
}: {
  count?: ReactNode;
  tone?: "default" | "neg";
  muted?: boolean;
  as?: "h2" | "h3" | "div";
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag
      className={cn(
        "flex items-center gap-2 px-[3px] text-[11.5px] font-bold tracking-[0.08em] uppercase",
        tone === "neg" ? "text-neg" : muted ? "text-muted-foreground/60" : "text-muted-foreground",
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
