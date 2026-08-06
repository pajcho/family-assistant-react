import {
  ArrowUturnLeftIcon,
  BanknotesIcon,
  ClockIcon,
  PencilSquareIcon,
} from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { ResponsiveDialogContent, ResponsiveDialogFooter } from "@/components/ui/responsive-dialog";
import { SheetStackHeader, SheetStackViews, useSheetStack } from "@/components/common/SheetStack";
import {
  DetailActionList,
  DetailActionRow,
  DetailBadgeRow,
  DetailHero,
  DetailInfoRow,
  DetailInfoRows,
  DetailInfoText,
  type DetailBadge,
} from "@/components/common/DetailSheet";
import { MemberBadges } from "@/components/common/MemberBadges";
import { PaymentHistoryList, PaymentUndoConfirm } from "@/components/payments/PaymentHistoryPanel";
import type { HistoryRowItem, UpcomingRowItem } from "@/components/payments/paymentRowTypes";
import type { Payment } from "@/types/database";
import { formatDate } from "@/utils/date";
import { Amount } from "@/components/common/Amount";
import { recurrenceLabel } from "@/utils/payment";

/**
 * Read-only detail popup for the two occurrence rows that aren't the series'
 * live one: paid/skipped HISTORY entries and projected UPCOMING repetitions.
 * Neither maps onto a mutable `Payment` occurrence, so this shows the frozen
 * snapshot plus - in the shared detail-sheet layout - the few actions that
 * apply as rows: "Izmeni" on the underlying series, the history drill-in, and
 * "Poništi" on the last history entry. The live occurrence gets the full
 * `PaymentDetailDialog` instead.
 *
 * History and the undo confirm are sub-views on the sheet stack - each opens
 * over this sheet; dismissing them returns one level up.
 */
export type PaymentOccurrenceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: HistoryRowItem | UpcomingRowItem | null;
  personIds?: string[];
  /** Underlying series row - used for "Izmeni" / "Istorija". Null if deleted. */
  payment: Payment | null;
  onEdit: (payment: Payment) => void;
};

type View =
  | { kind: "detail" }
  | { kind: "history" }
  // The undo confirm pops back to wherever it was requested from; a successful
  // undo from the detail root closes the whole sheet (the occurrence is gone).
  | { kind: "undo"; from: "detail" | "history" };

export function PaymentOccurrenceDialog({
  open,
  onOpenChange,
  item,
  personIds = [],
  payment,
  onEdit,
}: PaymentOccurrenceDialogProps) {
  const stack = useSheetStack<View>(open, onOpenChange, { kind: "detail" });
  const { push, pop } = stack;

  const isUpcoming = item?.type === "upcoming";
  const subtitle = !item
    ? ""
    : isUpcoming
      ? `${recurrenceLabel(item.recurrence_period, item.recurrence_interval)} · nadolazeća rata`
      : item.status === "canceled"
        ? "Preskočena rata"
        : "Plaćena rata";

  const handleEdit = () => {
    if (!payment) return;
    onOpenChange(false);
    onEdit(payment);
  };

  const statusBadges: DetailBadge[] = [];
  if (item) {
    if (isUpcoming) {
      statusBadges.push({
        label: "Nadolazeće",
        tone: "neutral",
      });
    } else if (item.status === "canceled") {
      statusBadges.push({
        label: "Preskočeno",
        tone: "neutral",
      });
    } else {
      statusBadges.push({
        label: `Plaćeno${item.paid_date ? ` ${formatDate(item.paid_date)}` : ""}`,
        tone: "pos",
      });
    }
    statusBadges.push({
      label: `${isUpcoming ? "Dospeva" : "Dospelo"} ${formatDate(item.due_date)}`,
      tone: "neutral",
    });
  }

  const canUndo = item?.type === "history" && item.isLast;

  const titleFor = (view: View) =>
    view.kind === "history"
      ? "Istorija plaćanja"
      : view.kind === "undo"
        ? "Poništi plaćanje"
        : "Detalji plaćanja";

  return (
    <SheetStackViews
      stack={stack}
      render={(view, level) => (
        <ResponsiveDialogContent>
          <SheetStackHeader
            title={titleFor(view)}
            srOnly={level === 0}
            onBack={level === 0 ? undefined : pop}
          />
          {item ? (
            <div className="space-y-4">
              {/* Root only: a stacked sub-view sits ON TOP of this sheet, which
                    already names the subject right above it - repeating the hero
                    printed the same title twice on one screen. */}
              {level === 0 ? (
                <DetailHero
                  icon={BanknotesIcon}
                  tone="warn"
                  title={item.name}
                  subtitle={subtitle}
                />
              ) : null}

              {view.kind === "history" ? (
                <PaymentHistoryList
                  payment={payment}
                  onRequestUndo={() => push({ kind: "undo", from: "history" })}
                />
              ) : view.kind === "undo" ? (
                <PaymentUndoConfirm
                  paymentId={payment?.id ?? (item.type === "history" ? item.payment_id : null)}
                  paymentName={item.name}
                  onBack={pop}
                  onDone={() => {
                    if (view.from === "history") pop();
                    else onOpenChange(false);
                  }}
                />
              ) : (
                <>
                  <div>
                    <div className="text-3xl font-semibold tracking-tight tabular-nums text-foreground">
                      <Amount value={item.amount} />
                    </div>
                    <div className="mt-2">
                      <DetailBadgeRow badges={statusBadges} />
                    </div>
                  </div>

                  {personIds.length > 0 ||
                  (item.type === "history" && item.note) ||
                  (isUpcoming && item.description) ||
                  (isUpcoming &&
                    item.recurrence_period === "limited" &&
                    item.remaining_occurrences != null) ? (
                    <DetailInfoRows>
                      {personIds.length > 0 ? (
                        <DetailInfoRow label="Za">
                          <MemberBadges personIds={personIds} />
                        </DetailInfoRow>
                      ) : null}
                      {item.type === "history" && item.note ? (
                        <DetailInfoText label="Napomena" value={item.note} />
                      ) : null}
                      {isUpcoming && item.description ? (
                        <DetailInfoText label="Opis" value={item.description} />
                      ) : null}
                      {isUpcoming &&
                      item.recurrence_period === "limited" &&
                      item.remaining_occurrences != null ? (
                        <DetailInfoText
                          label="Preostalo"
                          value={`${item.remaining_occurrences} rata`}
                        />
                      ) : null}
                    </DetailInfoRows>
                  ) : null}

                  {payment || canUndo ? (
                    <DetailActionList>
                      {payment ? (
                        <DetailActionRow
                          icon={PencilSquareIcon}
                          label="Izmeni plaćanje"
                          description="Menja celu seriju plaćanja"
                          onClick={handleEdit}
                        />
                      ) : null}
                      {payment ? (
                        <DetailActionRow
                          icon={ClockIcon}
                          label="Istorija plaćanja"
                          description="Uplaćene i preskočene rate"
                          onClick={() => push({ kind: "history" })}
                          chevron
                        />
                      ) : null}
                      {canUndo ? (
                        <DetailActionRow
                          icon={ArrowUturnLeftIcon}
                          label="Poništi plaćanje"
                          description="Vraća poslednju uplatu kao neplaćenu"
                          onClick={() => push({ kind: "undo", from: "detail" })}
                          tone="primary"
                        />
                      ) : null}
                    </DetailActionList>
                  ) : null}

                  {isUpcoming ? (
                    <p className="text-xs text-muted-foreground">
                      Nadolazeća rata - označavanje plaćenim, pomeranje i preskakanje postaju
                      dostupni kada rata dođe na red.
                    </p>
                  ) : null}
                </>
              )}
            </div>
          ) : null}

          {view.kind === "history" ? (
            <ResponsiveDialogFooter>
              <Button variant="outline" className="w-full sm:w-auto" onClick={pop}>
                Nazad
              </Button>
            </ResponsiveDialogFooter>
          ) : null}
        </ResponsiveDialogContent>
      )}
    />
  );
}
