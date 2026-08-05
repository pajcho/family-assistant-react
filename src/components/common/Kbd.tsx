import { cn } from "@/lib/cn";

/**
 * A key cap. Shared so the sidebar's ⌘K hint and the shortcuts list draw the
 * same thing.
 *
 * `font-sans` on purpose: <kbd> defaults to the mono stack, where ⌘ comes from
 * a fallback face and renders visibly larger than the letter next to it. The UI
 * font draws both at the same size.
 *
 * The plate is lighter than its own border, so the border is what draws the
 * shape - a filled cap heavier than its outline reads as a button.
 */
export function Kbd({ keys, className }: { keys: readonly string[]; className?: string }) {
  return (
    <kbd
      className={cn(
        "flex h-7 shrink-0 items-center gap-0.5 rounded-sm border border-border bg-background px-2",
        "font-sans text-[11px] leading-none font-semibold text-muted-foreground",
        className,
      )}
    >
      {keys.map((key) => (
        <span key={key}>{key}</span>
      ))}
    </kbd>
  );
}
