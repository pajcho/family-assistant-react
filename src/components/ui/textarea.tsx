import * as React from "react";

import { cn } from "@/lib/cn";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        // Mirrors the Input primitive (border, radius, focus ring, dark variant)
        // but switches to multi-line: min-height for a few rows by default and
        // `field-sizing-content` so the box grows with the content on browsers
        // that support it. `text-base md:text-sm` keeps iOS Safari from
        // auto-zooming when the textarea is focused.
        "flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground field-sizing-content disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
