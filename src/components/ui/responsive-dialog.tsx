import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";
import { useIsKeyboardOpen } from "@/hooks/useIsKeyboardOpen";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";

/**
 * Tailwind's `sm:` breakpoint. ResponsiveDialog flips from Drawer → Dialog at and above this width.
 */
const DESKTOP_MEDIA_QUERY = "(min-width: 640px)";

/**
 * SSR-safe(-ish) media query hook. Defaults to `false` (mobile / Drawer) until the matchMedia
 * subscription confirms desktop - matches the plan's "default behavior must be Drawer until the
 * media query confirms desktop" note.
 */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mql = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const update = () => {
      setIsDesktop(mql.matches);
    };
    update();
    mql.addEventListener("change", update);
    return () => {
      mql.removeEventListener("change", update);
    };
  }, []);

  return isDesktop;
}

type ResponsiveDialogContextValue = {
  isDesktop: boolean;
};

const ResponsiveDialogContext = createContext<ResponsiveDialogContextValue | null>(null);

function useResponsiveDialogContext(component: string): ResponsiveDialogContextValue {
  const ctx = useContext(ResponsiveDialogContext);
  if (!ctx) {
    throw new Error(`<${component}> must be used inside <ResponsiveDialog>`);
  }
  return ctx;
}

type RootProps = ComponentProps<typeof Dialog> & ComponentProps<typeof Drawer>;

function ResponsiveDialog({ children, ...props }: RootProps) {
  const isDesktop = useIsDesktop();
  const ctxValue = useMemo<ResponsiveDialogContextValue>(() => ({ isDesktop }), [isDesktop]);

  // Vaul's default `repositionInputs={true}` translates the entire drawer
  // upward by the on-screen keyboard's height when an input is focused.
  // The math overshoots on tall drawers in iOS Safari - the focused
  // field ends up above the viewport while later fields remain visible.
  // Disabling it hands the job back to Safari's native scroll-into-view
  // (which only scrolls the inner overflow-y:auto container, no transform
  // on the drawer itself). Chromium isn't affected: it doesn't apply the
  // translation either way, and the inner scroll handles the keyboard
  // case the same way.
  return (
    <ResponsiveDialogContext.Provider value={ctxValue}>
      {isDesktop ? (
        <Dialog {...props}>{children}</Dialog>
      ) : (
        <Drawer repositionInputs={false} {...props}>
          {children}
        </Drawer>
      )}
    </ResponsiveDialogContext.Provider>
  );
}

function ResponsiveDialogTrigger(
  props: ComponentProps<typeof DialogTrigger> & ComponentProps<typeof DrawerTrigger>,
) {
  const { isDesktop } = useResponsiveDialogContext("ResponsiveDialogTrigger");
  const Trigger = isDesktop ? DialogTrigger : DrawerTrigger;
  return <Trigger {...props} />;
}

function ResponsiveDialogClose(
  props: ComponentProps<typeof DialogClose> & ComponentProps<typeof DrawerClose>,
) {
  const { isDesktop } = useResponsiveDialogContext("ResponsiveDialogClose");
  const Close = isDesktop ? DialogClose : DrawerClose;
  return <Close {...props} />;
}

type ContentProps = ComponentProps<typeof DialogContent> &
  ComponentProps<typeof DrawerContent> & {
    /**
     * Forwarded to the underlying Dialog's close button on desktop. Drawer always relies on
     * swipe-down / overlay-click / Escape, so this prop is desktop-only.
     */
    showCloseButton?: boolean;
    /**
     * Action bar pinned OUTSIDE the scroll area on mobile - content scrolls
     * behind it, the bar stays at the sheet bottom in thumb reach (the
     * "Brzi unos" footer). On desktop it simply renders after the content.
     * Buttons inside submit via the `form` attribute when they belong to a
     * form living in the scrollable part.
     */
    stickyFooter?: React.ReactNode;
  };

function ResponsiveDialogContent({
  className,
  children,
  showCloseButton,
  stickyFooter,
  ...props
}: ContentProps) {
  const { isDesktop } = useResponsiveDialogContext("ResponsiveDialogContent");
  const keyboardOpen = useIsKeyboardOpen();

  if (isDesktop) {
    return (
      <DialogContent
        className={cn(
          // Standard 90vh cap. Keyboard handling isn't really an issue
          // on desktop, so we don't bother with the visual-vh dance.
          "max-h-[90vh] overflow-y-auto",
          className,
        )}
        showCloseButton={showCloseButton}
        {...props}
      >
        {children}
        {stickyFooter}
      </DialogContent>
    );
  }

  return (
    <DrawerContent
      className={cn(
        // A sheet is exactly as tall as its content, capped at 90vh. No
        // minimum: dead space under a short sheet is the thing people
        // notice first, and it is never what the content asked for.
        //
        // The ONE exception is the iOS keyboard. A short fixed-bottom
        // drawer is positioned against the visualViewport bottom there, so
        // the page shows through in the band between the sheet and the
        // keyboard. The 60vh floor covers that band - and it only has to
        // exist while the keyboard does, which is what the hook tells us
        // (it flips on `focusin`, so the floor is in place before the
        // keyboard finishes animating up). Every sheet gets this for free;
        // none of them has to opt out of a floor it never needed.
        // The keyboard-aware scroll of focused inputs is Vaul's job
        // (repositionInputs, on by default).
        "data-[vaul-drawer-direction=bottom]:max-h-[90vh]",
        keyboardOpen && "data-[vaul-drawer-direction=bottom]:min-h-[60vh]",
        className,
      )}
      {...props}
    >
      {/* 24px side padding mirrors Nuxt's px-6 dialog content. pt-2 lifts
          the header off the drag handle. `grow` + `min-h-0` make this the
          scroll area that fills the drawer, so a stickyFooter below it pins
          to the sheet bottom whatever the content height.

          Bottom padding depends on what ends the sheet. With a stickyFooter
          the bar itself carries the gap to the screen edge (pb-6 of its own),
          so the scroll area only needs to clear it. WITHOUT one - the picker
          sub-views, which commit on tap and have no Sačuvaj/Odustani bar -
          the last row IS the bottom of the sheet, and since a sheet is only
          as tall as its content that row lands right on the screen edge (the
          home indicator, even). pb-11 gives it room to breathe. */}
      <div
        className={cn(
          "flex max-h-[inherit] min-h-0 grow flex-col overflow-y-auto px-6 pt-2",
          stickyFooter ? "pb-4" : "pb-11",
        )}
      >
        {children}
      </div>
      {stickyFooter ? (
        <div className="shrink-0 border-t border-border bg-background px-6 pt-3 pb-6">
          {stickyFooter}
        </div>
      ) : null}
    </DrawerContent>
  );
}

function ResponsiveDialogHeader({
  className,
  ...props
}: ComponentProps<typeof DialogHeader> & ComponentProps<typeof DrawerHeader>) {
  const { isDesktop } = useResponsiveDialogContext("ResponsiveDialogHeader");
  const Header = isDesktop ? DialogHeader : DrawerHeader;
  // Mirror Nuxt's DialogHeader: bottom border separator with comfortable
  // gap to the body. The wrapper already handles horizontal padding, so
  // p-0 here resets shadcn's default p-4.
  const drawerClassName = isDesktop ? undefined : "p-0 pb-4 mb-4 border-b border-border";
  return <Header className={cn(drawerClassName, className)} {...props} />;
}

function ResponsiveDialogTitle({
  className,
  ...props
}: ComponentProps<typeof DialogTitle> & ComponentProps<typeof DrawerTitle>) {
  const { isDesktop } = useResponsiveDialogContext("ResponsiveDialogTitle");
  const Title = isDesktop ? DialogTitle : DrawerTitle;
  // Drawer's default title is base-size + centered; bump to text-lg and
  // left-align to match Nuxt and Dialog desktop.
  const drawerClassName = isDesktop ? undefined : "text-left text-lg leading-none";
  return <Title className={cn(drawerClassName, className)} {...props} />;
}

function ResponsiveDialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogDescription> & ComponentProps<typeof DrawerDescription>) {
  const { isDesktop } = useResponsiveDialogContext("ResponsiveDialogDescription");
  const Description = isDesktop ? DialogDescription : DrawerDescription;
  // Vaul's drawer-header centers descendants on bottom-direction drawers
  // (mobile). We already override the title's text-align; without the
  // matching override here the description still pulls toward the centre,
  // which clashes with the rest of the app's left-aligned typography.
  const drawerClassName = isDesktop ? undefined : "text-left";
  return <Description className={cn(drawerClassName, className)} {...props} />;
}

function ResponsiveDialogFooter({
  className,
  ...props
}: ComponentProps<typeof DialogFooter> & ComponentProps<typeof DrawerFooter>) {
  const { isDesktop } = useResponsiveDialogContext("ResponsiveDialogFooter");
  const Footer = isDesktop ? DialogFooter : DrawerFooter;
  // Drawer footer pads itself; we're already inside a padded container, so reset and right-align.
  const drawerClassName = isDesktop
    ? undefined
    : "mt-4 p-0 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end";
  return <Footer className={cn(drawerClassName, className)} {...props} />;
}

export {
  ResponsiveDialog,
  ResponsiveDialogTrigger,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  useIsDesktop,
};
