import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * Tiny status pill (prototype `.pill`) - the uppercase-ish badge that rides
 * inside a card title or its right-hand column ("kasni 3 dana", "Dan 1/3",
 * "Google", "za 5 dana").
 *
 * Tones map onto the money/type semantics layer, NOT onto the user's accent,
 * so a payment stays amber and a birthday stays green whichever accent colour
 * is picked. `accent` is the one tone that follows the accent - use it for
 * neutral-but-ours markers (span position, "Proslava").
 */

export type PillTone = "accent" | "pos" | "warn" | "neg" | "info" | "muted";

const TONE_CLASS: Record<PillTone, string> = {
  accent: "bg-accent-soft text-accent-deep",
  pos: "bg-pos-soft text-pos",
  warn: "bg-warn-soft text-warn",
  neg: "bg-neg-soft text-neg",
  info: "bg-info-soft text-info",
  muted: "bg-muted text-muted-foreground",
};

export function Pill({
  tone = "accent",
  className,
  children,
}: {
  tone?: PillTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-[3px]",
        "text-[10.5px] leading-none font-bold tracking-[0.02em] whitespace-nowrap",
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
