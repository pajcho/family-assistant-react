import { useEffect, useMemo, useState } from "react";
import {
  BanknotesIcon,
  CakeIcon,
  ChevronRightIcon,
  EyeIcon,
  PencilSquareIcon,
  SparklesIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { format } from "date-fns";

import { ResponsiveDialogContent } from "@/components/ui/responsive-dialog";
import { SheetStackHeader, SheetStackViews, useSheetStack } from "@/components/common/SheetStack";
import { DetailAuditLine } from "@/components/common/DetailAuditLine";
import {
  DetailActionList,
  DetailActionRow,
  DetailBadgeRow,
  DetailDeleteBody,
  DetailDeleteFooter,
  DetailHero,
  DetailInfoRows,
  DetailInfoText,
} from "@/components/common/DetailSheet";
import { LinkedMoneyFlow, type LinkedMoneyRequest } from "@/components/common/LinkedMoneyFlow";
import { LinkedMoneyViewer, type LinkedMoneyTarget } from "@/components/payments/LinkedMoneyViewer";
import { LinkedPaymentsList } from "@/components/payments/LinkedPaymentsList";
import { EventDetailDialog } from "@/components/events/EventDetailDialog";
import { EventFormDialog } from "@/components/events/EventFormDialog";
import type { EventFormPayload } from "@/components/events/EventForm";
import { useDeleteBirthday } from "@/hooks/useBirthdays";
import {
  useBirthdayVisibility,
  useBirthdayVisibilityChildren,
} from "@/hooks/useBirthdayVisibility";
import { useBirthdayCelebrations, useCreateEvent, useUpdateEvent } from "@/hooks/useEvents";
import { useEventParticipants } from "@/hooks/useEventParticipants";
import { usePaymentsList } from "@/hooks/usePayments";
import type { Birthday, Event } from "@/types/database";
import { currentAge, daysUntilBirthday, nextBirthdayDate } from "@/utils/birthday";
import { formatDate } from "@/utils/date";
import { getDisplayName } from "@/utils/identity";

/**
 * THE birthday detail popup - the same component on the /birthdays page and
 * the Danas/Uskoro agenda. The shared detail-sheet layout: detalji on top
 * (hero, countdown + next-age badges, info rows incl. the celebration row),
 * every action below as a visible row - Izmeni, Organizuj proslavu (until one
 * exists), add a gift payment, delete - and the linked gift payments at
 * the bottom, each row opening its own detail.
 *
 * The celebration is fully self-contained here: "Organizuj proslavu" opens
 * the event form prefilled with the person's next birthday (the created event
 * carries `birthday_id`), and tapping an existing celebration opens the full
 * event detail popup whose "Izmeni" reopens the same form. All of these HIDE
 * this sheet (not close) and return here when done; only the birthday edit
 * form still delegates to the page via `onEdit`. Payments are the only money
 * entry that can link a birthday (expenses have no birthday column), so the
 * gift action skips the payment/expense chooser and goes straight to the
 * payment form.
 */
export type BirthdayDetailDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  birthday: Birthday | null;
  onEdit: (birthday: Birthday) => void;
};

type View = "detail" | "delete";

/** "Puni 9 godina / 21 godinu / 3 godine" - Serbian count agreement. */
function ageLabel(age: number): string {
  const mod10 = age % 10;
  const mod100 = age % 100;
  if (mod10 === 1 && mod100 !== 11) return `Puni ${age} godinu`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `Puni ${age} godine`;
  return `Puni ${age} godina`;
}

function daysLabel(days: number): string {
  if (days === 0) return "Danas 🎉";
  if (days === 1) return "Sutra";
  return `za ${days} dana`;
}

type CelebrationForm = { mode: "create" } | { mode: "edit"; event: Event };

export function BirthdayDetailDialog({
  open,
  onOpenChange,
  birthday,
  onEdit,
}: BirthdayDetailDialogProps) {
  const stack = useSheetStack<View>(open, onOpenChange, "detail");
  const { push, pop, reset } = stack;
  const deleteMutation = useDeleteBirthday();
  const saving = deleteMutation.isPending;
  const paymentsQuery = usePaymentsList();
  const { data: celebrationByBirthday } = useBirthdayCelebrations();
  const { byEvent } = useEventParticipants();
  const createEvent = useCreateEvent();
  const updateEvent = useUpdateEvent();

  // The sub-flows that HIDE this sheet and bring it back on close: the gift
  // payment form, a linked payment's detail, the celebration's detail popup
  // and the celebration form (organize / edit).
  const [moneyRequest, setMoneyRequest] = useState<LinkedMoneyRequest | null>(null);
  const [moneyTarget, setMoneyTarget] = useState<LinkedMoneyTarget | null>(null);
  const [viewedCelebration, setViewedCelebration] = useState<Event | null>(null);
  const [celebrationForm, setCelebrationForm] = useState<CelebrationForm | null>(null);
  const [celebrationError, setCelebrationError] = useState<string | null>(null);

  const celebration = birthday ? (celebrationByBirthday?.get(birthday.id) ?? null) : null;

  // Kid mode: one read-only line naming the children who see this birthday.
  // Families that never turned kid mode on get no line at all - the concept
  // does not exist for them.
  const { byBirthday: visibilityByBirthday } = useBirthdayVisibility();
  const { children: kidChildren, hasKidMode } = useBirthdayVisibilityChildren();
  const visibleToLabel = useMemo(() => {
    if (!hasKidMode || !birthday) return null;
    const seenBy = new Set(
      (visibilityByBirthday.get(birthday.id) ?? []).map((entry) => entry.personId),
    );
    const names = kidChildren
      .filter((child) => seenBy.has(child.id))
      .map(
        (child) =>
          getDisplayName({
            firstName: child.first_name,
            lastName: child.last_name,
            email: null,
          }) || "Bez imena",
      );
    return names.length > 0 ? names.join(", ") : "Niko";
  }, [hasKidMode, birthday, visibilityByBirthday, kidChildren]);

  // Poklon tracking - payments linked to this birthday.
  const linkedPayments = useMemo(
    () => (birthday ? (paymentsQuery.data ?? []).filter((p) => p.birthday_id === birthday.id) : []),
    [paymentsQuery.data, birthday],
  );

  // Back to the root view whenever the subject birthday changes underneath.
  useEffect(() => {
    reset();
  }, [birthday, reset]);

  // The birthday edit form lives in the page's own dialog - close and hand off.
  const handleEdit = () => {
    if (!birthday) return;
    onOpenChange(false);
    onEdit(birthday);
  };

  const handleDelete = async () => {
    if (!birthday) return;
    try {
      await deleteMutation.mutateAsync(birthday.id);
      onOpenChange(false);
    } catch {
      // Mutation hook already toasts; stay here so the user can retry.
    }
  };

  const handleCelebrationSubmit = async (payload: EventFormPayload) => {
    if (!birthday || !celebrationForm) return;
    setCelebrationError(null);
    try {
      if (celebrationForm.mode === "edit") {
        await updateEvent.mutateAsync({ id: celebrationForm.event.id, payload });
      } else {
        await createEvent.mutateAsync({ ...payload, birthday_id: birthday.id });
      }
      setCelebrationForm(null);
    } catch (err) {
      const fallback =
        celebrationForm.mode === "edit"
          ? "Greška pri izmeni proslave"
          : "Greška pri kreiranju proslave";
      setCelebrationError(err instanceof Error && err.message ? err.message : fallback);
    }
  };

  const days = birthday ? daysUntilBirthday(birthday.birth_date) : 0;
  const nextAge = birthday ? currentAge(birthday.birth_date) + 1 : 0;

  const titleFor = (view: View) => (view === "delete" ? "Obriši rođendan" : "Detalji rođendana");
  const hidden = !!moneyRequest || !!moneyTarget || !!viewedCelebration || !!celebrationForm;

  return (
    <>
      <SheetStackViews
        stack={stack}
        hidden={hidden}
        render={(view, level) => (
          <ResponsiveDialogContent>
            <SheetStackHeader
              title={titleFor(view)}
              srOnly={level === 0}
              onBack={level === 0 ? undefined : pop}
            />
            {birthday ? (
              <div className="space-y-4">
                {/* Root only: a stacked sub-view sits ON TOP of this sheet,
                    which already names the subject right above it - repeating
                    the hero printed the same title twice on one screen. */}
                {level === 0 ? (
                  <DetailHero
                    icon={CakeIcon}
                    tone="accent"
                    title={birthday.name}
                    subtitle={`Rođendan · ${formatDate(birthday.birth_date)}`}
                  />
                ) : null}

                {view === "delete" ? (
                  <DetailDeleteBody name={birthday.name} />
                ) : (
                  <>
                    <DetailBadgeRow
                      badges={[
                        {
                          label: daysLabel(days),
                          tone: days <= 1 ? "accent" : "neutral",
                        },
                        {
                          label: ageLabel(nextAge),
                          tone: "neutral",
                        },
                      ]}
                    />

                    {birthday.description || celebration || visibleToLabel ? (
                      <DetailInfoRows>
                        {birthday.description ? (
                          <DetailInfoText label="Opis" value={birthday.description} />
                        ) : null}
                        {visibleToLabel ? (
                          <DetailInfoText
                            label="Vidljivo deci"
                            icon={EyeIcon}
                            value={visibleToLabel}
                          />
                        ) : null}
                        {celebration ? (
                          <button
                            type="button"
                            onClick={() => setViewedCelebration(celebration)}
                            // px-3.5 matches DetailInfoRow - without it the
                            // icon and the chevron sit flush against the card.
                            className="flex w-full items-center gap-2 px-3.5 py-2.5 text-sm font-medium text-foreground transition-colors hover:text-pink-600 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none dark:hover:text-pink-400"
                          >
                            <SparklesIcon className="size-4 text-pink-500 dark:text-pink-400" />
                            <span className="min-w-0 flex-1 truncate text-left">
                              {celebration.name} · {formatDate(celebration.date)}
                            </span>
                            <ChevronRightIcon className="ml-auto size-4 shrink-0 text-muted-foreground" />
                          </button>
                        ) : null}
                      </DetailInfoRows>
                    ) : null}

                    <DetailActionList>
                      <DetailActionRow
                        icon={PencilSquareIcon}
                        label="Izmeni rođendan"
                        description="Ime, datum rođenja, opis"
                        onClick={handleEdit}
                        disabled={saving}
                      />
                      {!celebration ? (
                        <DetailActionRow
                          icon={SparklesIcon}
                          label="Organizuj proslavu"
                          description="Zakaži proslavu kao događaj"
                          onClick={() => {
                            setCelebrationError(null);
                            setCelebrationForm({ mode: "create" });
                          }}
                          disabled={saving}
                        />
                      ) : null}
                      <DetailActionRow
                        icon={BanknotesIcon}
                        label="Dodaj plaćanje za poklon"
                        description="Prati poklon kao plaćanje uz rođendan"
                        onClick={() =>
                          setMoneyRequest({
                            kind: "payment",
                            link: { kind: "birthday", id: birthday.id },
                          })
                        }
                        disabled={saving}
                      />
                      <DetailActionRow
                        icon={TrashIcon}
                        label="Obriši rođendan"
                        description="Trajno uklanja rođendan"
                        onClick={() => push("delete")}
                        disabled={saving}
                        tone="destructive"
                      />
                    </DetailActionList>

                    {/* Poklon tracking: payments linked to this birthday (renders
                      nothing without any); a row opens that payment's detail. */}
                    <LinkedPaymentsList
                      payments={linkedPayments}
                      onSelect={(payment) => setMoneyTarget({ kind: "payment", payment })}
                    />

                    <DetailAuditLine row={birthday} />
                  </>
                )}
              </div>
            ) : null}

            {view === "delete" ? (
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

      {/* The celebration's own detail popup - "Izmeni" inside it reopens the
          celebration form below instead of a page-level dialog. */}
      <EventDetailDialog
        open={!!viewedCelebration}
        onOpenChange={(next) => {
          if (!next) setViewedCelebration(null);
        }}
        event={viewedCelebration}
        personIds={viewedCelebration ? (byEvent.get(viewedCelebration.id) ?? []) : []}
        onEdit={(event) => {
          setViewedCelebration(null);
          setCelebrationError(null);
          setCelebrationForm({ mode: "edit", event });
        }}
      />

      <EventFormDialog
        open={!!celebrationForm}
        onOpenChange={(next) => {
          if (!next) {
            setCelebrationForm(null);
            setCelebrationError(null);
          }
        }}
        event={celebrationForm?.mode === "edit" ? celebrationForm.event : null}
        initialPersonIds={
          celebrationForm?.mode === "edit" ? (byEvent.get(celebrationForm.event.id) ?? []) : []
        }
        defaults={
          celebrationForm?.mode === "create" && birthday
            ? {
                name: `Proslava - ${birthday.name}`,
                date: format(nextBirthdayDate(birthday.birth_date), "yyyy-MM-dd"),
              }
            : undefined
        }
        title={celebrationForm?.mode === "edit" ? "Izmeni proslavu" : "Organizuj proslavu"}
        error={celebrationError}
        saving={createEvent.isPending || updateEvent.isPending}
        onSubmit={(payload) => {
          void handleCelebrationSubmit(payload);
        }}
      />
    </>
  );
}
