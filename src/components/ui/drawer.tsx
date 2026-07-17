"use client";

import { useEffect, useState } from "react";
import type { ComponentProps } from "react";
import { Drawer as DrawerPrimitive } from "vaul";

import { cn } from "@/lib/cn";

/** Vaul's close transition duration. Keep the page locked until it finishes. */
const DRAWER_EXIT_DURATION_MS = 500;

/**
 * Radix locks scroll from inside the overlay component. That lock can be
 * released out of order when one drawer closes while another opens, or when
 * SheetStack remounts a dismissed sub-view during Vaul's exit transition.
 *
 * Keep a second, app-owned lock tied to the Drawer root's open state. The
 * reference count handles overlapping drawers; delayed release bridges both
 * Vaul's exit animation and SheetStack's close -> remount -> reopen hop.
 */
let activeDrawerScrollLocks = 0;

function acquireDrawerScrollLock(): () => void {
  activeDrawerScrollLocks += 1;
  document.documentElement.classList.add("dialog-open");

  return () => {
    window.setTimeout(() => {
      activeDrawerScrollLocks = Math.max(0, activeDrawerScrollLocks - 1);
      if (activeDrawerScrollLocks === 0) {
        document.documentElement.classList.remove("dialog-open");
      }
    }, DRAWER_EXIT_DURATION_MS);
  };
}

function useDrawerScrollLock(open: boolean) {
  useEffect(() => {
    if (!open) return;
    return acquireDrawerScrollLock();
  }, [open]);
}

function Drawer({
  open,
  defaultOpen,
  onOpenChange,
  ...props
}: ComponentProps<typeof DrawerPrimitive.Root>) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(() => defaultOpen ?? false);
  const resolvedOpen = open ?? uncontrolledOpen;
  useDrawerScrollLock(resolvedOpen);

  const handleOpenChange = (next: boolean) => {
    if (open === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  return (
    <DrawerPrimitive.Root
      data-slot="drawer"
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={handleOpenChange}
      {...props}
    />
  );
}

function DrawerTrigger({ ...props }: ComponentProps<typeof DrawerPrimitive.Trigger>) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />;
}

function DrawerPortal({ ...props }: ComponentProps<typeof DrawerPrimitive.Portal>) {
  return <DrawerPrimitive.Portal data-slot="drawer-portal" {...props} />;
}

function DrawerClose({ ...props }: ComponentProps<typeof DrawerPrimitive.Close>) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />;
}

function DrawerOverlay({ className, ...props }: ComponentProps<typeof DrawerPrimitive.Overlay>) {
  return (
    <DrawerPrimitive.Overlay
      data-slot="drawer-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className,
      )}
      {...props}
    />
  );
}

function DrawerContent({
  className,
  children,
  ...props
}: ComponentProps<typeof DrawerPrimitive.Content>) {
  return (
    <DrawerPortal data-slot="drawer-portal">
      <DrawerOverlay />
      <DrawerPrimitive.Content
        data-slot="drawer-content"
        className={cn(
          "group/drawer-content fixed z-50 flex h-auto flex-col bg-background",
          "data-[vaul-drawer-direction=top]:inset-x-0 data-[vaul-drawer-direction=top]:top-0 data-[vaul-drawer-direction=top]:mb-24 data-[vaul-drawer-direction=top]:max-h-[80vh] data-[vaul-drawer-direction=top]:rounded-b-lg data-[vaul-drawer-direction=top]:border-b",
          "data-[vaul-drawer-direction=bottom]:inset-x-0 data-[vaul-drawer-direction=bottom]:bottom-0 data-[vaul-drawer-direction=bottom]:mt-24 data-[vaul-drawer-direction=bottom]:max-h-[80vh] data-[vaul-drawer-direction=bottom]:rounded-t-lg data-[vaul-drawer-direction=bottom]:border-t",
          "data-[vaul-drawer-direction=right]:inset-y-0 data-[vaul-drawer-direction=right]:right-0 data-[vaul-drawer-direction=right]:w-3/4 data-[vaul-drawer-direction=right]:border-l data-[vaul-drawer-direction=right]:sm:max-w-sm",
          "data-[vaul-drawer-direction=left]:inset-y-0 data-[vaul-drawer-direction=left]:left-0 data-[vaul-drawer-direction=left]:w-3/4 data-[vaul-drawer-direction=left]:border-r data-[vaul-drawer-direction=left]:sm:max-w-sm",
          className,
        )}
        {...props}
      >
        <div className="mx-auto mt-3 hidden h-1 w-10 shrink-0 rounded-full bg-gray-300 group-data-[vaul-drawer-direction=bottom]/drawer-content:block dark:bg-gray-600" />
        {children}
      </DrawerPrimitive.Content>
    </DrawerPortal>
  );
}

function DrawerHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-header"
      className={cn(
        "flex flex-col gap-0.5 p-4 group-data-[vaul-drawer-direction=bottom]/drawer-content:text-center group-data-[vaul-drawer-direction=top]/drawer-content:text-center md:gap-1.5 md:text-left",
        className,
      )}
      {...props}
    />
  );
}

function DrawerFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  );
}

function DrawerTitle({ className, ...props }: ComponentProps<typeof DrawerPrimitive.Title>) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn("font-semibold text-foreground", className)}
      {...props}
    />
  );
}

function DrawerDescription({
  className,
  ...props
}: ComponentProps<typeof DrawerPrimitive.Description>) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Drawer,
  DrawerPortal,
  DrawerOverlay,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
};
