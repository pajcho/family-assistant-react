import { useEffect, useState } from "react";
import {
  ArrowUturnLeftIcon,
  BanknotesIcon,
  CalendarDaysIcon,
  CalendarIcon,
  PencilSquareIcon,
  TrashIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ResponsiveDialogContent, ResponsiveDialogFooter } from "@/components/ui/responsive-dialog";
import { SheetStackHeader, SheetStackViews, useSheetStack } from "@/components/common/SheetStack";
import { AuditTimeline } from "@/components/common/AuditTimeline";
import { DetailAuditLine } from "@/components/common/DetailAuditLine";
import {
  DetailActionList,
  DetailActionRow,
  DetailBadgeRow,
  DetailDeleteBody,
  DetailDeleteFooter,
  DetailHero,
  DetailInfoRow,
  DetailInfoRows,
  DetailInfoText,
  type DetailBadge,
} from "@/components/common/DetailSheet";
import {
  EventDateTimeFields,
  RescheduleSpanNote,
  type EventDateTimeValue,
  dateTimeValueToColumns,
  eventToDateTimeValue,
} from "@/components/events/EventDateTimeFields";
import { EventMoneySection } from "@/components/events/EventMoneySection";
import {
  LinkedMoneyChooser,
  LinkedMoneyFlow,
  type LinkedMoneyRequest,
} from "@/components/common/LinkedMoneyFlow";
import { LinkedMoneyViewer, type LinkedMoneyTarget } from "@/components/payments/LinkedMoneyViewer";
import { MemberBadges } from "@/components/common/MemberBadges";
import { useDeleteEvent, useUpdateEvent } from "@/hooks/useEvents";
import type { Event } from "@/types/database";
import {
  eventDurationLabel,
  formatEventDateRange,
  formatEventTimeRange,
  isEventEnded,
  isEventOngoing,
  isMultiDayEvent,
  shiftedEventEndDate,
} from "@/utils/event";

/**
 * THE event detail popup - the same component (and the same action set) on
 * the /events page and the Danas/Uskoro agenda. The shared detail-sheet
 * layout: detalji on top (hero, state badges, info rows), every action below
 * as a visible row - edit, reschedule, cancel (or the emphasized restore when
 * canceled), add payment or expense, delete - and the linked payments +
 * expenses at the bottom, each row opening its own detail.
 *
 * Reschedule, cancel-with-reason, the delete confirm and the money chooser
 * are sub-views on the sheet stack (see `useSheetStack`) - each opens as its
 * own sheet ON TOP of this one, "←" back header, dismissal returns one level
 * up. The money form and the linked money detail HIDE this sheet (not close)
 * and return here when done. Only the full edit form closes the sheet and
 * delegates to the page's form dialog via `onEdit`.
 */
export type EventDetailDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: Event | null;
  personIds?: string[];
  onEdit: (event: Event) => void;
};

type View = "detail" | "reschedule" | "cancel" | "delete" | "money" | "audit";

export function EventDetailDialog({
  open,
  onOpenChange,
  event,
  personIds = [],
  onEdit,
}: EventDetailDialogProps) {
  const stack = useSheetStack<View>(open, onOpenChange, "detail");
  const { push, pop, reset } = stack;
  const updateEvent = useUpdateEvent();
  const deleteEvent = useDeleteEvent();

  const [dtValue, setDtValue] = useState<EventDateTimeValue>(() => eventToDateTimeValue(event));
  const [rescheduleReason, setRescheduleReason] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  // Money-add keeps this sheet mounted but HIDDEN while the pre-linked form is
  // open; closing the form (saved or dismissed) brings the detail back with
  // the fresh entry in the money boxes below.
  const [moneyRequest, setMoneyRequest] = useState<LinkedMoneyRequest | null>(null);
  // Ditto for viewing a linked payment/expense row.
  const [moneyTarget, setMoneyTarget] = useState<LinkedMoneyTarget | null>(null);

  // Back to the root view whenever the subject event changes underneath.
  useEffect(() => {
    reset();
  }, [event, reset]);

  const saving = updateEvent.isPending || deleteEvent.isPending;
  const isCanceled = !!event?.canceled_at;
  const isEnded = !!event && !isCanceled && isEventEnded(event);

  // The full edit form lives in the page's own dialog - close and hand off.
  const handleEdit = () => {
    if (!event) return;
    onOpenChange(false);
    onEdit(event);
  };

  // Seed a clean slate each time a sub-view is entered (not just per-event),
  // so a back-and-forth within one open doesn't carry stale unsaved input.
  const openReschedule = () => {
    setDtValue(eventToDateTimeValue(event));
    setRescheduleReason("");
    push("reschedule");
  };

  const openCancel = () => {
    setCancelReason("");
    push("cancel");
  };

  const handleRescheduleSave = async () => {
    if (!event || !dtValue.date) return;
    const columns = dateTimeValueToColumns(dtValue);
    try {
      await updateEvent.mutateAsync({
        id: event.id,
        payload: {
          ...columns,
          // A multi-day span moves as a whole - the new end keeps the length.
          end_date: shiftedEventEndDate(event, columns.date),
          reschedule_reason: rescheduleReason.trim() || null,
        },
      });
      onOpenChange(false);
    } catch {
      // Error toast surfaced by the hook.
    }
  };

  const handleCancelConfirm = async () => {
    if (!event) return;
    try {
      await updateEvent.mutateAsync({
        id: event.id,
        payload: {
          canceled_at: new Date().toISOString(),
          cancel_reason: cancelReason.trim() || null,
        },
      });
      onOpenChange(false);
    } catch {
      // Error toast surfaced by the hook.
    }
  };

  // Restoring a canceled event clears both the timestamp and the reason.
  const handleRestore = async () => {
    if (!event) return;
    try {
      await updateEvent.mutateAsync({
        id: event.id,
        payload: { canceled_at: null, cancel_reason: null },
      });
      onOpenChange(false);
    } catch {
      // Error toast surfaced by the hook.
    }
  };

  const handleDelete = async () => {
    if (!event) return;
    try {
      await deleteEvent.mutateAsync(event.id);
      onOpenChange(false);
    } catch {
      // Error toast surfaced by the hook.
    }
  };

  const statusBadges: DetailBadge[] = [];
  if (event) {
    if (isCanceled) {
      statusBadges.push({
        label: "Otkazano",
        tone: "neg",
      });
    } else if (isEnded) {
      statusBadges.push({
        label: "Završeno",
        tone: "neutral",
      });
    } else if (isEventOngoing(event, format(new Date(), "yyyy-MM-dd"))) {
      statusBadges.push({
        label: "U toku",
        tone: "pos",
      });
    }
    statusBadges.push({
      label: formatEventDateRange(event),
      tone: "neutral",
    });
    if (isMultiDayEvent(event)) {
      statusBadges.push({
        label: eventDurationLabel(event),
        tone: "info",
      });
    }
  }

  const titleFor = (view: View) =>
    view === "reschedule"
      ? "Pomeri događaj"
      : view === "cancel"
        ? "Otkaži događaj"
        : view === "delete"
          ? "Obriši događaj"
          : view === "money"
            ? "Dodaj uz događaj"
            : view === "audit"
              ? "Istorija izmena"
              : "Detalji događaja";

  return (
    <>
      <SheetStackViews
        stack={stack}
        hidden={!!moneyRequest || !!moneyTarget}
        render={(view, level) => (
          <ResponsiveDialogContent>
            <SheetStackHeader
              title={titleFor(view)}
              srOnly={level === 0}
              onBack={level === 0 ? undefined : pop}
            />
            {event ? (
              <div className="space-y-4">
                {/* Root only: a stacked sub-view sits ON TOP of this sheet,
                    which already names the subject right above it - repeating
                    the hero printed the same title twice on one screen. */}
                {level === 0 ? (
                  <DetailHero
                    icon={CalendarIcon}
                    tone="info"
                    title={event.name}
                    titleClassName={isCanceled ? "text-muted-foreground line-through" : undefined}
                    subtitle={formatEventTimeRange(event)}
                  />
                ) : null}

                {view === "audit" ? (
                  <AuditTimeline entityType="events" entityId={event.id} />
                ) : view === "money" ? (
                  <LinkedMoneyChooser
                    onPick={(kind) => {
                      // Hide (don't close) the sheet under the pre-linked form -
                      // it returns to the root view once the form is done.
                      reset();
                      setMoneyRequest({ kind, link: { kind: "event", id: event.id } });
                    }}
                  />
                ) : view === "reschedule" ? (
                  <div className="space-y-4">
                    <EventDateTimeFields
                      value={dtValue}
                      onChange={setDtValue}
                      idPrefix="event-detail-reschedule"
                    />
                    <RescheduleSpanNote event={event} newDate={dtValue.date} />
                    <div className="space-y-2">
                      <Label htmlFor="event-detail-reschedule-reason">Razlog (opciono)</Label>
                      <Textarea
                        id="event-detail-reschedule-reason"
                        value={rescheduleReason}
                        onChange={(e) => setRescheduleReason(e.target.value)}
                        placeholder="npr. termin pomeren zbog vremena"
                        rows={2}
                      />
                    </div>
                  </div>
                ) : view === "cancel" ? (
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Otkazati „{event.name}"? Neće se prikazivati na kontrolnoj tabli, ali ostaje u
                      kalendaru. Možeš ga kasnije vratiti.
                    </p>
                    <div className="space-y-2">
                      <Label htmlFor="event-detail-cancel-reason">Razlog (opciono)</Label>
                      <Textarea
                        id="event-detail-cancel-reason"
                        value={cancelReason}
                        onChange={(e) => setCancelReason(e.target.value)}
                        placeholder="npr. otkazano zbog kiše"
                        rows={3}
                      />
                    </div>
                  </div>
                ) : view === "delete" ? (
                  <DetailDeleteBody name={event.name} />
                ) : (
                  <>
                    <DetailBadgeRow badges={statusBadges} />

                    {personIds.length > 0 ||
                    event.description ||
                    event.notes ||
                    (isCanceled && event.cancel_reason) ||
                    event.reschedule_reason ? (
                      <DetailInfoRows>
                        {personIds.length > 0 ? (
                          <DetailInfoRow label="Za">
                            <MemberBadges personIds={personIds} />
                          </DetailInfoRow>
                        ) : null}
                        {event.description ? (
                          <DetailInfoText label="Opis" value={event.description} />
                        ) : null}
                        {event.notes ? (
                          <DetailInfoText
                            label="Napomena"
                            value={event.notes}
                            valueClassName="text-amber-700 dark:text-amber-400"
                          />
                        ) : null}
                        {isCanceled && event.cancel_reason ? (
                          <DetailInfoText label="Razlog otkazivanja" value={event.cancel_reason} />
                        ) : null}
                        {event.reschedule_reason ? (
                          <DetailInfoText
                            label="Razlog pomeranja"
                            value={event.reschedule_reason}
                          />
                        ) : null}
                      </DetailInfoRows>
                    ) : null}

                    <DetailActionList>
                      {/* The state-fixing primary opens the list (same slot as
                        the payment sheet's "Označi kao plaćeno"). */}
                      {isCanceled ? (
                        <DetailActionRow
                          icon={ArrowUturnLeftIcon}
                          label="Vrati događaj"
                          description="Poništava otkazivanje"
                          onClick={() => {
                            void handleRestore();
                          }}
                          disabled={saving}
                          tone="primary"
                        />
                      ) : null}
                      <DetailActionRow
                        icon={PencilSquareIcon}
                        label="Izmeni događaj"
                        description="Naziv, datum, vreme, učesnici, opis…"
                        onClick={handleEdit}
                        disabled={saving}
                      />
                      {!isCanceled ? (
                        <>
                          <DetailActionRow
                            icon={CalendarDaysIcon}
                            label="Pomeri događaj"
                            description="Novi datum ili vreme, uz razlog"
                            onClick={openReschedule}
                            disabled={saving}
                          />
                          <DetailActionRow
                            icon={XCircleIcon}
                            label="Otkaži događaj"
                            description="Skida se sa rasporeda, ostaje u kalendaru"
                            onClick={openCancel}
                            disabled={saving}
                          />
                        </>
                      ) : null}
                      <DetailActionRow
                        icon={BanknotesIcon}
                        label="Dodaj plaćanje ili trošak"
                        description="Plaćanje, trošak ili skeniran račun uz događaj"
                        onClick={() => push("money")}
                        disabled={saving}
                      />
                      <DetailActionRow
                        icon={TrashIcon}
                        label="Obriši događaj"
                        description="Trajno uklanja događaj"
                        onClick={() => push("delete")}
                        disabled={saving}
                        tone="destructive"
                      />
                    </DetailActionList>

                    {/* Linked payments + expenses (render nothing without any);
                      a row opens that entry's detail over this sheet. */}
                    <EventMoneySection eventId={event.id} onSelect={setMoneyTarget} />

                    <DetailAuditLine row={event} onOpenHistory={() => push("audit")} />
                  </>
                )}
              </div>
            ) : null}

            {view === "money" ? (
              <ResponsiveDialogFooter>
                <Button
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={pop}
                  disabled={saving}
                >
                  Nazad
                </Button>
              </ResponsiveDialogFooter>
            ) : view === "reschedule" ? (
              <ResponsiveDialogFooter>
                <Button variant="outline" onClick={pop} disabled={saving}>
                  Nazad
                </Button>
                <Button
                  onClick={() => {
                    void handleRescheduleSave();
                  }}
                  disabled={saving || !dtValue.date}
                >
                  Sačuvaj
                </Button>
              </ResponsiveDialogFooter>
            ) : view === "cancel" ? (
              <ResponsiveDialogFooter>
                <Button variant="outline" onClick={pop} disabled={saving}>
                  Nazad
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    void handleCancelConfirm();
                  }}
                  disabled={saving}
                >
                  Otkaži događaj
                </Button>
              </ResponsiveDialogFooter>
            ) : view === "delete" ? (
              <DetailDeleteFooter
                deleting={saving}
                onBack={pop}
                onConfirm={() => {
                  void handleDelete();
                }}
              />
            ) : null}
          </ResponsiveDialogContent>
        )}
      />

      <LinkedMoneyFlow request={moneyRequest} onClose={() => setMoneyRequest(null)} />
      <LinkedMoneyViewer target={moneyTarget} onClose={() => setMoneyTarget(null)} />
    </>
  );
}
