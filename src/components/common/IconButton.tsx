import type { ButtonHTMLAttributes, ComponentType, SVGProps } from "react";

import { cn } from "@/lib/cn";

/**
 * The redesign's square icon button (prototype `.iconbtn`) - the only chrome
 * control that sits in a screen header next to the title, and the trailing
 * control on rows like a week pager.
 *
 * It renders as a 40px card-coloured tile, but the tap target is grown to 44px
 * with a transparent pseudo-element: the visual weight stays light next to a
 * 23px title while the finger target still clears the iOS minimum. `aria-label`
 * is required - the button never carries a visible text label.
 */

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  "aria-label": string;
  /** Tints the glyph with the accent - marks a control that is currently ON. */
  active?: boolean;
  /** Smaller 34px tile for dense rows (month pager, sheet headers). */
  size?: "md" | "sm";
};

export function IconButton({
  icon: Icon,
  active = false,
  size = "md",
  className,
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        // The ::after box is the real touch target (>=44px) around a smaller tile.
        "relative flex shrink-0 items-center justify-center rounded-md border border-border bg-card shadow-card",
        "transition-[transform,background-color,color] active:scale-95",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        "after:absolute after:content-['']",
        size === "md" ? "size-10 after:-inset-0.5" : "size-[34px] after:-inset-[5px]",
        active ? "text-accent-deep" : "text-foreground",
        className,
      )}
      {...props}
    >
      <Icon className={size === "md" ? "size-[19px]" : "size-4"} aria-hidden="true" />
    </button>
  );
}
