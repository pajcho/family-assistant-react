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
  /** The field row - becomes the popover anchor on desktop. */
  trigger: ReactNode;
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
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent
          align="start"
          collisionPadding={12}
          className={cn("w-[21rem] max-w-[calc(100vw-1.5rem)] p-3", contentClassName)}
          // The panel owns its own focus order; stealing focus onto the
          // popover root first makes the arrow-key grid feel a step behind.
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="mb-2 flex flex-col gap-0.5">
            <p className="text-sm font-semibold">{title}</p>
            {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
          </div>
          {children}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <>
      {trigger}
      <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
            {description ? (
              <ResponsiveDialogDescription>{description}</ResponsiveDialogDescription>
            ) : null}
          </ResponsiveDialogHeader>
          {children}
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}
