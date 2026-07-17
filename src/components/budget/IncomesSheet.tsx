import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  BanknotesIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  PlusIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";

import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { SheetStackHeader, useSheetStack } from "@/components/common/SheetStack";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Income, IncomeEntry, Profile } from "@/types/database";
import { useCreateIncome, useDeleteIncome, useIncomes, useUpdateIncome } from "@/hooks/useIncomes";
import {
  useAddOneTimeIncome,
  useConfirmIncome,
  useDeleteIncomeEntry,
  useIncomeEntries,
  useUpdateIncomeEntry,
} from "@/hooks/useIncomeEntries";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { useToday } from "@/hooks/useToday";
import { fallbackColorForProfile } from "@/utils/activity";
import { getDisplayName } from "@/utils/identity";
import { Amount } from "@/components/common/Amount";
import { monthLabel } from "@/utils/budget";

export type IncomesSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The budget month being viewed ("YYYY-MM") — confirmations land here. */
  month: string;
};

const SELECT_CHROME =
  "h-9 w-full min-w-0 cursor-pointer appearance-none rounded-md border border-input bg-transparent px-3 text-base shadow-xs outline-none md:text-sm dark:bg-input/30 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** Last day of a "YYYY-MM" month (JS Date month is 0-based; day 0 → prev month). */
function clampDayInMonth(month: string, day: number): string {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  const d = Math.min(Math.max(1, day), last);
  return `${month}-${String(d).padStart(2, "0")}`;
}

/**
 * The sheet's current screen. Like the activities "Opcije" sheet, the forms
 * don't open a nested overlay — they're sub-views on the sheet stack, swapping
 * the body in place with a "← Nazad" header (dismissing a form also returns to
 * the list). On mobile this gives each form the full drawer height (easy to
 * scroll), instead of an inline form cramped at the bottom of the list.
 */
type View =
  | { kind: "list" }
  | { kind: "sources" }
  | { kind: "confirm"; source: Income } // confirm a pending recurring source
  | { kind: "entry"; entry: IncomeEntry } // edit an existing receipt
  | { kind: "one-time" } // add a one-off (bonus etc.)
  | { kind: "source"; income: Income | null } // add / edit a recurring source
  | { kind: "delete-entry"; entry: IncomeEntry }
  | { kind: "delete-source"; income: Income };

function memberOptions(members: ReadonlyArray<Profile>) {
  return members.map((m) => (
    <option key={m.id} value={m.id}>
      {getDisplayName({ firstName: m.first_name, lastName: m.last_name, email: null }) ||
        "Bez imena"}
    </option>
  ));
}

/**
 * "Prihodi" — the family's income for ONE month plus the recurring source
 * templates.
 *
 * List screen: this month's actual income. Active recurring sources not yet
 * confirmed show a "Potvrdi" row; confirmed receipts and one-offs list below
 * with edit/delete. This is the frozen history the budget cycle sums — editing
 * a source never rewrites it. Recurring source templates live in their own
 * stack view so monthly confirmation and long-term setup never compete in the
 * same scroll.
 *
 * Every add/edit/confirm opens as a full-screen sub-view with a back arrow (see
 * {@link View}) rather than an inline form.
 */
export function IncomesSheet({ open, onOpenChange, month }: IncomesSheetProps) {
  const { incomes } = useIncomes();
  const { entries, total: confirmedTotal } = useIncomeEntries(month);
  const { members, byId } = useFamilyMembers();
  const today = useToday();

  const deleteIncome = useDeleteIncome();
  const deleteEntry = useDeleteIncomeEntry();

  const { view, atRoot, push, pop, dialogOpen, dialogKey, handleOpenChange } = useSheetStack<View>(
    open,
    onOpenChange,
    { kind: "list" },
  );
  const [showConfirmed, setShowConfirmed] = useState(false);

  // Keep the high-frequency pending work in focus on every new open.
  useEffect(() => {
    if (!open) setShowConfirmed(false);
  }, [open]);

  const back = pop;

  // Active sources with no confirmation for this month → "za potvrdu".
  const pendingSources = useMemo(() => {
    const confirmedIds = new Set(entries.filter((e) => e.income_id).map((e) => e.income_id));
    return incomes.filter((i) => i.active && !confirmedIds.has(i.id));
  }, [incomes, entries]);
  const activeSources = incomes.filter((income) => income.active);
  const expectedTotal = activeSources.reduce((sum, income) => sum + income.amount, 0);
  const confirmedRowsVisible = showConfirmed;

  const defaultReceivedOn = (day: number): string =>
    month === today.str.slice(0, 7) ? today.str : clampDayInMonth(month, day);

  const personChip = (personId: string | null) => {
    const person = personId ? byId.get(personId) : null;
    if (!person) return null;
    const color = person.color ?? fallbackColorForProfile(person.id);
    const name = getDisplayName({
      firstName: person.first_name,
      lastName: person.last_name,
      email: null,
    });
    return (
      <span className="inline-flex min-w-0 items-center gap-1">
        <span
          className="inline-block size-2 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        />
        <span className="truncate">{name}</span>
      </span>
    );
  };

  const title =
    view.kind === "list"
      ? `Prihodi — ${monthLabel(month)}`
      : view.kind === "sources"
        ? "Redovni prihodi"
        : view.kind === "confirm"
          ? "Potvrdi prihod"
          : view.kind === "entry"
            ? "Izmeni prihod"
            : view.kind === "one-time"
              ? "Jednokratni prihod"
              : view.kind === "delete-entry"
                ? "Obriši prihod"
                : view.kind === "delete-source"
                  ? "Obriši redovni prihod"
                  : view.income
                    ? "Izmeni redovni prihod"
                    : "Novi redovni prihod";

  const handleDeleteEntry = async (entry: IncomeEntry) => {
    try {
      await deleteEntry.mutateAsync(entry.id);
      pop();
    } catch {
      /* hook toasts */
    }
  };

  const handleDeleteSource = async (income: Income) => {
    try {
      await deleteIncome.mutateAsync(income.id);
      pop();
    } catch {
      /* hook toasts */
    }
  };

  return (
    <ResponsiveDialog key={dialogKey} open={dialogOpen} onOpenChange={handleOpenChange}>
      <ResponsiveDialogContent>
        <SheetStackHeader
          title={title}
          onBack={atRoot ? undefined : back}
          backAriaLabel={
            view.kind === "source" || view.kind === "delete-source"
              ? "Nazad na redovne prihode"
              : "Nazad na prihode"
          }
          description={
            view.kind === "list" ? (
              <span className="flex flex-wrap items-center gap-x-1.5">
                <span>
                  <Amount value={confirmedTotal} /> potvrđeno
                </span>
                {pendingSources.length > 0 ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{pendingSources.length} za potvrdu</span>
                  </>
                ) : null}
              </span>
            ) : view.kind === "sources" ? (
              <span className="flex flex-wrap items-center gap-x-1.5">
                <span>Aktivno: {activeSources.length}</span>
                {activeSources.length > 0 ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>
                      <Amount value={expectedTotal} /> očekivano mesečno
                    </span>
                  </>
                ) : null}
              </span>
            ) : undefined
          }
        />

        {/* ---------------------------------------------------------------- */}
        {/* LIST screen                                                       */}
        {/* ---------------------------------------------------------------- */}
        {view.kind === "list" ? (
          <div className="flex flex-col gap-5">
            {pendingSources.length > 0 ? (
              <section className="flex flex-col gap-2.5">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-semibold tracking-wide text-foreground uppercase">
                    Za potvrdu
                  </h3>
                  <Badge variant="secondary">{pendingSources.length}</Badge>
                </div>
                <ul className="flex flex-col gap-2">
                  {pendingSources.map((source) => (
                    <li
                      key={source.id}
                      className="flex items-center gap-3 rounded-xl border bg-card p-3 shadow-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-card-foreground">
                          {source.name}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                          {personChip(source.person_id)}
                          <span className="whitespace-nowrap">
                            očekivano <Amount value={source.amount} />
                          </span>
                        </div>
                      </div>
                      <Button size="sm" onClick={() => push({ kind: "confirm", source })}>
                        Potvrdi
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {entries.length > 0 ? (
              <section className="flex flex-col gap-2.5">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  aria-expanded={confirmedRowsVisible}
                  onClick={() => setShowConfirmed((visible) => !visible)}
                >
                  <span className="text-xs font-semibold tracking-wide text-foreground uppercase">
                    Potvrđeno
                  </span>
                  <Badge variant="outline">{entries.length}</Badge>
                  <span className="ml-auto text-sm font-semibold text-foreground">
                    <Amount value={confirmedTotal} />
                  </span>
                  {confirmedRowsVisible ? (
                    <ChevronUpIcon className="size-4 text-muted-foreground" />
                  ) : (
                    <ChevronDownIcon className="size-4 text-muted-foreground" />
                  )}
                </button>

                {confirmedRowsVisible ? (
                  <ul className="flex flex-col gap-2">
                    {entries.map((entry) => (
                      <li
                        key={entry.id}
                        className="flex items-center rounded-xl border bg-card shadow-xs"
                      >
                        <button
                          type="button"
                          aria-label={`Izmeni prihod ${entry.name}`}
                          onClick={() => push({ kind: "entry", entry })}
                          className="flex min-w-0 flex-1 items-center gap-3 p-3 text-left"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium text-card-foreground">
                                {entry.name}
                              </span>
                              <Badge variant={entry.is_one_time ? "secondary" : "outline"}>
                                {entry.is_one_time ? "jednokratno" : "redovno"}
                              </Badge>
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                              {personChip(entry.person_id)}
                              {entry.received_on ? (
                                <span className="whitespace-nowrap">
                                  {entry.received_on.slice(8, 10)}.{entry.received_on.slice(5, 7)}.
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <span className="shrink-0 text-sm font-semibold tabular-nums text-card-foreground">
                            <Amount value={entry.amount} />
                          </span>
                          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
                        </button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="mr-2 text-muted-foreground hover:text-destructive"
                          aria-label={`Obriši prihod ${entry.name}`}
                          onClick={() => push({ kind: "delete-entry", entry })}
                        >
                          <TrashIcon />
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ) : pendingSources.length === 0 ? (
              <div className="rounded-xl border border-dashed bg-muted/30 px-4 py-5 text-center">
                <p className="text-sm font-medium text-foreground">
                  Još nema prihoda za ovaj mesec
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Dodaj jednokratni prihod ili podesi redovni prihod.
                </p>
              </div>
            ) : null}

            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => push({ kind: "one-time" })}
            >
              <PlusIcon data-icon="inline-start" />
              Dodaj jednokratni prihod
            </Button>

            <button
              type="button"
              onClick={() => push({ kind: "sources" })}
              className="group flex w-full items-center gap-3 rounded-xl border bg-muted/30 p-3 text-left transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <BanknotesIcon className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-foreground">Redovni prihodi</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {activeSources.length > 0 ? (
                    <>
                      Aktivno: {activeSources.length} · očekivano <Amount value={expectedTotal} />{" "}
                      mesečno
                    </>
                  ) : (
                    "Dodaj prihod koji se ponavlja svakog meseca"
                  )}
                </span>
              </span>
              <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </button>
          </div>
        ) : null}

        {view.kind === "sources" ? (
          <div className="flex flex-col gap-4">
            {incomes.length === 0 ? (
              <div className="rounded-xl border border-dashed bg-muted/30 px-4 py-6 text-center">
                <p className="text-sm font-medium text-foreground">Još nema redovnih prihoda</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Dodaj platu ili drugi prihod koji očekuješ svakog meseca.
                </p>
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {incomes.map((income) => (
                  <li
                    key={income.id}
                    className="flex items-center rounded-xl border bg-card shadow-xs"
                  >
                    <button
                      type="button"
                      aria-label={`Izmeni redovni prihod ${income.name}`}
                      onClick={() => push({ kind: "source", income })}
                      className="flex min-w-0 flex-1 items-center gap-3 p-3 text-left"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold text-card-foreground">
                            {income.name}
                          </span>
                          {!income.active ? <Badge variant="secondary">pauzirano</Badge> : null}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                          {personChip(income.person_id)}
                          <span className="whitespace-nowrap">{income.day_of_month}. u mesecu</span>
                        </div>
                      </div>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-card-foreground">
                        <Amount value={income.amount} />
                      </span>
                      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="mr-2 text-muted-foreground hover:text-destructive"
                      aria-label={`Obriši redovni prihod ${income.name}`}
                      onClick={() => push({ kind: "delete-source", income })}
                    >
                      <TrashIcon />
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            <Button
              type="button"
              className="w-full"
              onClick={() => push({ kind: "source", income: null })}
            >
              <PlusIcon data-icon="inline-start" />
              Novi redovni prihod
            </Button>
          </div>
        ) : null}

        {view.kind === "delete-entry" ? (
          <>
            <p className="text-sm text-muted-foreground">
              Obrisati prihod „{view.entry.name}" od <Amount value={view.entry.amount} />? Ova
              radnja se ne može opozvati.
            </p>
            <ResponsiveDialogFooter>
              <Button variant="outline" onClick={pop} disabled={deleteEntry.isPending}>
                Nazad
              </Button>
              <Button
                variant="destructive"
                disabled={deleteEntry.isPending}
                onClick={() => {
                  void handleDeleteEntry(view.entry);
                }}
              >
                Obriši
              </Button>
            </ResponsiveDialogFooter>
          </>
        ) : null}

        {view.kind === "delete-source" ? (
          <>
            <p className="text-sm text-muted-foreground">
              Obrisati redovni prihod „{view.income.name}"? Već potvrđeni prihodi iz prethodnih
              meseci ostaju sačuvani.
            </p>
            <ResponsiveDialogFooter>
              <Button variant="outline" onClick={pop} disabled={deleteIncome.isPending}>
                Nazad
              </Button>
              <Button
                variant="destructive"
                disabled={deleteIncome.isPending}
                onClick={() => {
                  void handleDeleteSource(view.income);
                }}
              >
                Obriši
              </Button>
            </ResponsiveDialogFooter>
          </>
        ) : null}

        {/* ---------------------------------------------------------------- */}
        {/* FORM screens (swap the body in place, "← Nazad" returns to list)  */}
        {/* ---------------------------------------------------------------- */}
        {view.kind === "confirm" ? (
          <EntryForm
            month={month}
            members={members}
            source={view.source}
            defaultReceivedOn={defaultReceivedOn}
            onDone={back}
          />
        ) : null}

        {view.kind === "entry" ? (
          <EntryForm
            month={month}
            members={members}
            entry={view.entry}
            defaultReceivedOn={defaultReceivedOn}
            onDone={back}
          />
        ) : null}

        {view.kind === "one-time" ? (
          <EntryForm
            month={month}
            members={members}
            defaultReceivedOn={defaultReceivedOn}
            onDone={back}
          />
        ) : null}

        {view.kind === "source" ? (
          <SourceForm income={view.income} members={members} onDone={back} />
        ) : null}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/* ------------------------------------------------------------------------- */
/* Receipt form — confirm a source, edit a receipt, or add a one-off.        */
/* Self-contained (owns its state + mutations), mirroring ShiftSetupForm.    */
/* ------------------------------------------------------------------------- */

function EntryForm({
  month,
  members,
  source,
  entry,
  defaultReceivedOn,
  onDone,
}: {
  month: string;
  members: ReadonlyArray<Profile>;
  /** Confirming this recurring source (name/person inherited, read-only). */
  source?: Income;
  /** Editing this existing receipt. */
  entry?: IncomeEntry;
  defaultReceivedOn: (day: number) => string;
  onDone: () => void;
}) {
  const confirmIncome = useConfirmIncome();
  const addOneTime = useAddOneTimeIncome();
  const updateEntry = useUpdateIncomeEntry();

  // Linked to a recurring source? confirm always is; an edited receipt is iff
  // it carries an income_id. Linked rows keep the source's name/person.
  const linkedIncomeId = source ? source.id : (entry?.income_id ?? null);
  const isLinked = linkedIncomeId != null;
  const linkedName = source?.name ?? entry?.name ?? "";

  const [name, setName] = useState(entry?.name ?? "");
  const [personId, setPersonId] = useState<string | null>(
    source?.person_id ?? entry?.person_id ?? null,
  );
  const [amount, setAmount] = useState(
    source ? String(source.amount) : entry ? String(entry.amount) : "",
  );
  const [receivedOn, setReceivedOn] = useState<string | null>(
    entry?.received_on ?? defaultReceivedOn(source?.day_of_month ?? 1),
  );

  const saving = confirmIncome.isPending || addOneTime.isPending || updateEntry.isPending;

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const amountNum = Number(amount.replace(",", "."));
    if (!(amountNum > 0)) return;
    const received_on = receivedOn || null;
    try {
      if (isLinked && linkedIncomeId) {
        // Recurring confirmation — upsert on (income_id, month), so re-confirming
        // just corrects the amount instead of stacking rows.
        await confirmIncome.mutateAsync({
          income_id: linkedIncomeId,
          person_id: personId,
          name: linkedName,
          amount: amountNum,
          month,
          received_on,
        });
      } else {
        const trimmed = name.trim();
        if (!trimmed) return;
        if (entry) {
          await updateEntry.mutateAsync({
            id: entry.id,
            payload: { name: trimmed, amount: amountNum, received_on, person_id: personId },
          });
        } else {
          await addOneTime.mutateAsync({
            name: trimmed,
            amount: amountNum,
            month,
            received_on,
            person_id: personId,
          });
        }
      }
      onDone();
    } catch {
      /* hook toasts */
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {isLinked ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-sm font-medium text-gray-900 dark:border-emerald-800/40 dark:bg-emerald-900/10 dark:text-gray-100">
          <BanknotesIcon className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span className="truncate">{linkedName}</span>
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="entry-name">Naziv *</Label>
          <Input
            id="entry-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="npr. Bonus, povraćaj, poklon"
            autoFocus
            required
          />
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="entry-amount">Iznos (RSD) *</Label>
          <Input
            id="entry-amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="0"
            autoFocus={isLinked}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="entry-date">Datum</Label>
          <DatePicker id="entry-date" value={receivedOn} onChange={setReceivedOn} />
        </div>
      </div>
      {!isLinked ? (
        <div className="space-y-2">
          <Label htmlFor="entry-person">Član (opciono)</Label>
          <select
            id="entry-person"
            value={personId ?? ""}
            onChange={(e) => setPersonId(e.target.value || null)}
            className={SELECT_CHROME}
          >
            <option value="">Bez člana</option>
            {memberOptions(members)}
          </select>
        </div>
      ) : null}
      <ResponsiveDialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={saving}>
          Odustani
        </Button>
        <Button type="submit" disabled={saving}>
          {isLinked ? "Potvrdi" : entry ? "Sačuvaj" : "Dodaj"}
        </Button>
      </ResponsiveDialogFooter>
    </form>
  );
}

/* ------------------------------------------------------------------------- */
/* Source (recurring template) form — add / edit.                            */
/* ------------------------------------------------------------------------- */

function SourceForm({
  income,
  members,
  onDone,
}: {
  income: Income | null;
  members: ReadonlyArray<Profile>;
  onDone: () => void;
}) {
  const createIncome = useCreateIncome();
  const updateIncome = useUpdateIncome();

  const [name, setName] = useState(income?.name ?? "");
  const [amount, setAmount] = useState(income ? String(income.amount) : "");
  const [dayOfMonth, setDayOfMonth] = useState(income ? String(income.day_of_month) : "1");
  const [personId, setPersonId] = useState<string | null>(income?.person_id ?? null);
  const [active, setActive] = useState(income?.active ?? true);

  const saving = createIncome.isPending || updateIncome.isPending;

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const amountNum = Number(amount.replace(",", "."));
    const day = Math.min(31, Math.max(1, Number(dayOfMonth) || 1));
    if (!name.trim() || !(amountNum > 0)) return;
    const payload = {
      name: name.trim(),
      amount: amountNum,
      day_of_month: day,
      person_id: personId,
      active,
    };
    try {
      if (income) {
        await updateIncome.mutateAsync({ id: income.id, payload });
      } else {
        await createIncome.mutateAsync(payload);
      }
      onDone();
    } catch {
      /* hook toasts */
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="source-name">Naziv *</Label>
        <Input
          id="source-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="npr. Plata"
          autoFocus
          required
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="source-amount">Iznos (RSD) *</Label>
          <Input
            id="source-amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="0"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="source-day">Dan u mesecu *</Label>
          <Input
            id="source-day"
            value={dayOfMonth}
            onChange={(e) => setDayOfMonth(e.target.value)}
            type="number"
            min="1"
            max="31"
            required
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="source-person">Član (opciono)</Label>
        <select
          id="source-person"
          value={personId ?? ""}
          onChange={(e) => setPersonId(e.target.value || null)}
          className={SELECT_CHROME}
        >
          <option value="">Bez člana</option>
          {memberOptions(members)}
        </select>
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
          className="rounded border-gray-300"
        />
        Aktivan
      </label>
      <ResponsiveDialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={saving}>
          Odustani
        </Button>
        <Button type="submit" disabled={saving}>
          {income ? "Sačuvaj" : "Dodaj"}
        </Button>
      </ResponsiveDialogFooter>
    </form>
  );
}
