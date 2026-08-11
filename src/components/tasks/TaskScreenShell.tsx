import type { ReactNode } from "react";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";

import { IconButton } from "@/components/common/IconButton";
import { AppScreen } from "@/components/layout/AppScreen";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";

/**
 * The frame a single list (real or smart) renders in, in both of its contexts.
 *
 * Below `lg` the list IS the screen, so it gets `AppScreen`'s fixed header + its
 * own scrolling body. At `lg` it renders inside the right panel of the
 * master-detail split, which already scrolls, so it stays plain flow and the
 * sidebar is the way back - no back button.
 */
export function TaskScreenShell({
  isWide,
  header,
  children,
}: {
  isWide: boolean;
  header: ReactNode;
  children: ReactNode;
}) {
  const keyboardInset = useKeyboardInset();

  if (isWide) {
    return (
      <div className="animate-fade-in">
        <div className="mb-3">{header}</div>
        {children}
      </div>
    );
  }
  return (
    <AppScreen
      header={header}
      // The composer is the last child and pins itself to the bottom with
      // `mt-auto`, which needs a column that is at least as tall as the
      // scrollport - otherwise a short list leaves it floating mid-screen. And
      // `pb-0` so the pinned bar sits flush against the bottom bar instead of
      // hovering above a strip of page padding. Both are below-lg only: at lg
      // this branch is not taken at all.
      bodyClassName="pb-0"
      contentClassName="mx-auto flex min-h-full w-full max-w-3xl flex-col"
      // The keyboard covers the bottom of the scrollport on iOS without the
      // layout viewport ever shrinking (see useKeyboardInset). The composer lifts
      // itself clear of it with `bottom: inset`; this reserves the same strip at
      // the end of the scroll area, so the last task can be scrolled out from
      // under the bar rather than being stuck beneath it for good.
      bodyStyle={keyboardInset ? { paddingBottom: keyboardInset } : undefined}
    >
      {children}
    </AppScreen>
  );
}

/**
 * The header row a list screen shares: the back arrow (phones only), a serif
 * title - these screens are documents you opened, not a nav destination - the
 * sub-line of counts, and whatever actions the screen owns.
 */
export function TaskScreenHeader({
  title,
  subtitle,
  showBack,
  onBack,
  backAriaLabel = "Nazad na zadatke",
  actions,
  toolbar,
}: {
  title: string;
  subtitle?: ReactNode;
  showBack: boolean;
  onBack: () => void;
  backAriaLabel?: string;
  actions?: ReactNode;
  /** Filter / grouping row under the title block. */
  toolbar?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {showBack ? (
          <IconButton icon={ArrowLeftIcon} aria-label={backAriaLabel} onClick={onBack} />
        ) : null}
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-serif text-[25px] leading-[1.1] font-semibold tracking-[-0.015em]">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-0.5 truncate text-[12.5px] font-normal text-muted-foreground">
              {subtitle}
            </p>
          ) : null}
        </div>
        {actions}
      </div>
      {toolbar}
    </div>
  );
}
