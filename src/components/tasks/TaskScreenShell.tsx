import type { ReactNode } from "react";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";

import { IconButton } from "@/components/common/IconButton";
import { AppScreen } from "@/components/layout/AppScreen";

/**
 * The frame a single list (real or smart) renders in, in both of its contexts.
 *
 * Below `lg` the list IS the screen, so it gets `AppScreen`'s fixed header + its
 * own scrolling body. At `lg` it renders inside the right panel of the
 * master-detail split, which already scrolls, so it stays plain flow and the
 * sidebar is the way back - no back button.
 *
 * The composer is an ordinary child at the end of the list on both, and the
 * shell does nothing special for it: no pinned slot, no overlay layer, no room
 * reserved for a keyboard. A field in the flow is the browser's job to reveal.
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
  if (isWide) {
    return (
      <div className="animate-fade-in">
        <div className="mb-3">{header}</div>
        {children}
      </div>
    );
  }
  return <AppScreen header={header}>{children}</AppScreen>;
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
