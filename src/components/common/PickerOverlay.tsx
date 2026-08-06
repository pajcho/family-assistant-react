import type { ReactNode } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  useIsDesktop,
} from "@/components/ui/responsive-dialog";
import { cn } from "@/lib/cn";

/**
 * The shell every field picker (date, time) opens into:
 *   - mobile: a bottom sheet, so the grid sits in thumb reach;
 *   - desktop (>=sm): the SAME panel as a popover anchored to the field.
 *
 * Both mechanisms are the ones the app already nests successfully inside form
 * sheets (Radix Popover / the shared ResponsiveDialog), so a picker opened
 * from inside a drawer keeps working the way the rest of the app does.
 */
export type PickerOverlayProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  /**
   * The field row, as a render prop. `onOpen` is the click handler the row
   * must wire up on mobile; on DESKTOP it is `undefined` because Radix's
   * PopoverTrigger owns the click (adding our own would fight its toggle and
   * the popover could never be closed from the field).
   */
  trigger: (args: { onOpen?: () => void }) => ReactNode;
  children: ReactNode;
  /** Popover width on desktop. */
  contentClassName?: string;
};

export function PickerOverlay({
  open,
  onOpenChange,
  title,
  description,
  trigger,
  children,
  contentClassName,
}: PickerOverlayProps) {
  const isDesktop = useIsDesktop();

  if (isDesktop) {
    return (
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>{trigger({})}</PopoverTrigger>
        <PopoverContent
          align="start"
          collisionPadding={12}
          className={cn(
            "flex w-[21rem] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden p-3",
            // Radix reports how much room is left on the chosen side but does
            // NOT clamp the panel to it - without this a tall panel (the birth
            // year grid) simply runs off the top of the window.
            "max-h-[var(--radix-popover-content-available-height)]",
            contentClassName,
          )}
          // The panel owns its own focus order; stealing focus onto the
          // popover root first makes the arrow-key grid feel a step behind.
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="mb-2 flex flex-none flex-col gap-0.5">
            <p className="text-sm font-normal">{title}</p>
            {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
          </div>
          {/* The panel is the scroll area, so a picker never needs an inner
              one (nested scrollbars on a date grid are miserable to use). */}
          <div className="-mx-1 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1">
            {children}
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <>
      {trigger({ onOpen: () => onOpenChange(true) })}
      <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
            {/* Always rendered: Radix wires `aria-describedby` from it, and a
                dialog without one warns in the console. */}
            <ResponsiveDialogDescription className={description ? undefined : "sr-only"}>
              {description ?? title}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          {children}
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}
