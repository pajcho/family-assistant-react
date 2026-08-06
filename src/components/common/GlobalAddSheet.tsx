import { Suspense, useState } from "react";
import type { ComponentType, SVGProps } from "react";
import {
  BanknotesIcon,
  CakeIcon,
  CalendarIcon,
  ClipboardDocumentListIcon,
  QrCodeIcon,
  ShoppingCartIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline";

import { ActivityAddDialog } from "@/components/activities/ActivityAddDialog";
import { BirthdayQuickAddFlow } from "@/components/birthdays/BirthdayQuickAddFlow";
import { ExpenseQuickAddFlow } from "@/components/budget/ExpenseQuickAddFlow";
import { EventQuickAddFlow } from "@/components/events/EventQuickAddFlow";
import { ListQuickAddFlow } from "@/components/lists/ListQuickAddFlow";
import { PaymentQuickAddFlow } from "@/components/payments/PaymentQuickAddFlow";
import { SheetStackHeader } from "@/components/common/SheetStack";
import { ResponsiveDialog, ResponsiveDialogContent } from "@/components/ui/responsive-dialog";
import { cn } from "@/lib/cn";

/**
 * The global "+" - one entry point for everything you can add, from any
 * screen (redizajn 2.0 puts it in the middle of the bottom bar and retires the
 * per-page FAB below `lg`).
 *
 * Receipt scanning leads: it is the fastest way into the app's most frequent
 * entry (a shop expense) and the only one that fills the form for you. It gets
 * the full width of the sheet and nothing else - it used to be an accent-filled
 * hero, which shouted at a menu where every row is a thing you asked for. The
 * seven tiles all follow the Meni grid's visual language now.
 *
 * Every flow here is self-contained (owns its mutation, reports its own
 * errors) and none of them navigate: you add from wherever you are and land
 * back on the same screen. Editing is never routed through here - that always
 * happens on the entity's own detail sheet.
 */

// Lazy chunk: the scanner pulls in the camera code + the QR decoder, so it
// must stay out of the main bundle even though the "+" is always on screen.
import { ReceiptScanDialog } from "@/components/budget/receipt/lazyReceiptScanDialog";

type AddKind = "expense" | "payment" | "event" | "activity" | "birthday" | "list";

/**
 * One tile - shared by the scan row (full width) and the six type tiles.
 * The explicit focus ring matters here: the sheet autofocuses its first tile
 * on every open, and the browser's default outline is amber - the app's
 * warning colour - so an ordinary open looked like something went wrong.
 */
const TILE_CLASS =
  "flex items-center gap-2.5 rounded-lg border border-border bg-card p-3 text-left text-[13.5px] font-semibold transition-transform active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
const TILE_ICON_CLASS =
  "flex size-9 flex-none items-center justify-center rounded-md bg-accent-soft text-accent-deep";

const TILES: readonly {
  kind: AddKind;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}[] = [
  { kind: "expense", label: "Trošak", icon: ShoppingCartIcon },
  { kind: "payment", label: "Plaćanje", icon: BanknotesIcon },
  { kind: "event", label: "Događaj", icon: CalendarIcon },
  { kind: "activity", label: "Aktivnost", icon: SparklesIcon },
  { kind: "birthday", label: "Rođendan", icon: CakeIcon },
  { kind: "list", label: "Lista", icon: ClipboardDocumentListIcon },
];

export function GlobalAddSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // One flow at a time - the sheet closes as it hands over, so there is never
  // a sheet stacked behind a form.
  const [active, setActive] = useState<AddKind | "scan" | null>(null);

  const start = (kind: AddKind | "scan") => {
    onOpenChange(false);
    setActive(kind);
  };

  const closeActive = (nextOpen: boolean) => {
    if (!nextOpen) setActive(null);
  };

  return (
    <>
      <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
        <ResponsiveDialogContent className="sm:max-w-md">
          <SheetStackHeader title="Dodaj" />

          {/* Same tile as the six below - the full width is the only emphasis
              it needs. The second line stays because scanning is the one entry
              whose payoff is not obvious from its label. */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => start("scan")}
              className={cn(TILE_CLASS, "col-span-2")}
            >
              <span className={TILE_ICON_CLASS}>
                <QrCodeIcon className="size-[17px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block">Skeniraj račun</span>
                <span className="block text-xs font-normal text-muted-foreground">
                  QR sa fiskalnog računa - stavke stižu same
                </span>
              </span>
            </button>
            {TILES.map((tile) => (
              <button
                key={tile.kind}
                type="button"
                onClick={() => start(tile.kind)}
                className={TILE_CLASS}
              >
                <span className={TILE_ICON_CLASS}>
                  <tile.icon className="size-[17px]" />
                </span>
                {tile.label}
              </button>
            ))}
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Mounted only while running, so six forms' worth of state and queries
          never sit behind the bar. */}
      {active === "scan" ? (
        <Suspense fallback={null}>
          <ReceiptScanDialog open onOpenChange={closeActive} />
        </Suspense>
      ) : null}
      {active === "expense" ? <ExpenseQuickAddFlow open onOpenChange={closeActive} /> : null}
      {active === "payment" ? <PaymentQuickAddFlow open onOpenChange={closeActive} /> : null}
      {active === "event" ? <EventQuickAddFlow open onOpenChange={closeActive} /> : null}
      {active === "activity" ? <ActivityAddDialog open onOpenChange={closeActive} /> : null}
      {active === "birthday" ? <BirthdayQuickAddFlow open onOpenChange={closeActive} /> : null}
      {active === "list" ? <ListQuickAddFlow open onOpenChange={closeActive} /> : null}
    </>
  );
}
