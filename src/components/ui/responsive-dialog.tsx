import * as React from "react";

import { cn } from "@/lib/cn";
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
 * subscription confirms desktop — matches the plan's "default behavior must be Drawer until the
 * media query confirms desktop" note.
 */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = React.useState<boolean>(false);

  React.useEffect(() => {
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

const ResponsiveDialogContext = React.createContext<ResponsiveDialogContextValue | null>(null);

function useResponsiveDialogContext(component: string): ResponsiveDialogContextValue {
  const ctx = React.useContext(ResponsiveDialogContext);
  if (!ctx) {
    throw new Error(`<${component}> must be used inside <ResponsiveDialog>`);
  }
  return ctx;
}

type RootProps = React.ComponentProps<typeof Dialog> & React.ComponentProps<typeof Drawer>;

function ResponsiveDialog({ children, ...props }: RootProps) {
  const isDesktop = useIsDesktop();
  const ctxValue = React.useMemo<ResponsiveDialogContextValue>(() => ({ isDesktop }), [isDesktop]);
  const Root = isDesktop ? Dialog : Drawer;

  return (
    <ResponsiveDialogContext.Provider value={ctxValue}>
      <Root {...props}>{children}</Root>
    </ResponsiveDialogContext.Provider>
  );
}

function ResponsiveDialogTrigger(
  props: React.ComponentProps<typeof DialogTrigger> & React.ComponentProps<typeof DrawerTrigger>,
) {
  const { isDesktop } = useResponsiveDialogContext("ResponsiveDialogTrigger");
  const Trigger = isDesktop ? DialogTrigger : DrawerTrigger;
  return <Trigger {...props} />;
}

function ResponsiveDialogClose(
  props: React.ComponentProps<typeof DialogClose> & React.ComponentProps<typeof DrawerClose>,
) {
  const { isDesktop } = useResponsiveDialogContext("ResponsiveDialogClose");
  const Close = isDesktop ? DialogClose : DrawerClose;
  return <Close {...props} />;
}

type ContentProps = React.ComponentProps<typeof DialogContent> &
  React.ComponentProps<typeof DrawerContent> & {
    /**
     * Forwarded to the underlying Dialog's close button on desktop. Drawer always relies on
     * swipe-down / overlay-click / Escape, so this prop is desktop-only.
     */
    showCloseButton?: boolean;
  };

function ResponsiveDialogContent({ className, children, showCloseButton, ...props }: ContentProps) {
  const { isDesktop } = useResponsiveDialogContext("ResponsiveDialogContent");

  if (isDesktop) {
    return (
      <DialogContent
        className={cn(
          // Make the body scroll inside the dialog if content is taller than the viewport.
          "max-h-[90vh] overflow-y-auto",
          className,
        )}
        showCloseButton={showCloseButton}
        {...props}
      >
        {children}
      </DialogContent>
    );
  }

  return (
    <DrawerContent
      className={cn(
        // Override shadcn's default 80vh with the plan-mandated 90vh, and let the body scroll.
        "data-[vaul-drawer-direction=bottom]:max-h-[90vh]",
        className,
      )}
      {...props}
    >
      {/* 24px side padding mirrors Nuxt's px-6 dialog content. pt-2 lifts
          the header off the drag handle, pb-6 gives the footer room above
          the safe-area. */}
      <div className="flex max-h-[inherit] flex-col overflow-y-auto px-6 pt-2 pb-6">{children}</div>
    </DrawerContent>
  );
}

function ResponsiveDialogHeader({
  className,
  ...props
}: React.ComponentProps<typeof DialogHeader> & React.ComponentProps<typeof DrawerHeader>) {
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
}: React.ComponentProps<typeof DialogTitle> & React.ComponentProps<typeof DrawerTitle>) {
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
}: React.ComponentProps<typeof DialogDescription> &
  React.ComponentProps<typeof DrawerDescription>) {
  const { isDesktop } = useResponsiveDialogContext("ResponsiveDialogDescription");
  const Description = isDesktop ? DialogDescription : DrawerDescription;
  return <Description className={className} {...props} />;
}

function ResponsiveDialogFooter({
  className,
  ...props
}: React.ComponentProps<typeof DialogFooter> & React.ComponentProps<typeof DrawerFooter>) {
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
