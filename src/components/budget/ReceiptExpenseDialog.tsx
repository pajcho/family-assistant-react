import { useEffect, useMemo, useState } from "react";
import {
  AdjustmentsHorizontalIcon,
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  ChevronRightIcon,
  ListBulletIcon,
  ScissorsIcon,
  TagIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { toast } from "sonner";

import {
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  useIsDesktop,
} from "@/components/ui/responsive-dialog";
import { SheetStackHeader, SheetStackViews, useSheetStack } from "@/components/common/SheetStack";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { categoryIcon } from "@/components/budget/categoryIcons";
import { CategoryGridPicker } from "@/components/budget/CategoryGridPicker";
import {
  EXPENSE_LINK_KINDS,
  ExpensePersonSelect,
  expenseLinkValue,
} from "@/components/budget/ExpenseForm";
import { PaymentLinkField, type PaymentLinkValue } from "@/components/payments/PaymentLinkField";
import { PaymentLinkPickerSheet } from "@/components/payments/PaymentLinkPickerSheet";
import { PickerRow } from "@/components/common/PickerRow";
import {
  ReceiptItemsSelect,
  sumLineTotals,
  type SelectableReceiptLine,
} from "@/components/budget/receipt/ReceiptItemsSelect";
import { useExpenseCategories } from "@/hooks/useExpenseCategories";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import {
  ClaimConflictError,
  useDeleteExpense,
  useExpenseItems,
  useReceiptContext,
  useSplitReceiptExpense,
  useUpdateExpense,
} from "@/hooks/useExpenses";
import { RECEIPT_REFRESH_COOLDOWN_SECONDS, useReceiptRefresh } from "@/hooks/useReceiptImport";
import type { Expense, ReceiptItem } from "@/types/database";
import { formatDate } from "@/utils/date";
import { serbianPlural, stavkeLabel } from "@/utils/plural";
import { getDisplayName } from "@/utils/identity";
import { Amount } from "@/components/common/Amount";
import { cn } from "@/lib/cn";

/**
 * Detail + recategorize surface for a scanned-receipt expense. Amount and date
 * are read-only (they come from the fiscal receipt, like auto-payment rows),
 * but category / person / note are editable - the same "recategorize an
 * automatic row" affordance payments get.
 *
 * Split support: when this expense's lines are complete (they sum to its
 * amount), "Podeli račun" opens a sub-view where some lines move onto a NEW
 * expense - amounts adjust on both sides, ledger total unchanged. When the
 * receipt has several expenses (or unclaimed lines), a "Deo računa" block
 * shows the whole-receipt picture with a jump to the sibling parts.
 *
 * Mirrors the "Brzi unos" expense form: on mobile the editable bits collapse
 * into picker rows (Kategorija / Stavke / Više detalja) that open sub-views on
 * the sheet stack; on desktop everything stays inline. The delete confirm is
 * another sub-view ("←" back, dismissal returns to detail).
 */

export type ReceiptExpenseDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expense: Expense | null;
  /** Hide the delete affordance (read-only contexts). Defaults to true. */
  allowDelete?: boolean;
  /**
   * Swap the dialog to another expense of the same receipt (the sibling jump
   * in "Deo računa"). Hosts that can't re-target the dialog omit it - the
   * sibling rows then render non-interactive.
   */
  onOpenExpense?: (expense: Expense) => void;
};

// "link" sits one level under "details" (Detalji → Poveži sa), the same
// nesting the manual expense form uses.
type View = "detail" | "category" | "details" | "items" | "split" | "delete" | "link";

/** Read-only "N stavki" list, shared by the inline (desktop) + sub-view (mobile). */
function ItemsList({
  items,
  itemsLoading,
  receiptUrl,
  refreshDisabled,
  refreshPending,
  cooldownLabel,
  cooldownActive,
  refreshInfo,
  onRefresh,
}: {
  items: ReceiptItem[];
  itemsLoading: boolean;
  receiptUrl: string | null;
  refreshDisabled: boolean;
  refreshPending: boolean;
  cooldownLabel: string;
  cooldownActive: boolean;
  refreshInfo: string | null;
  onRefresh: () => void;
}) {
  if (itemsLoading) {
    return <p className="text-sm text-muted-foreground">Učitavam stavke…</p>;
  }
  if (items.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Nema prepoznatih stavki.</p>
        {receiptUrl ? (
          <>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={refreshDisabled}
              onClick={onRefresh}
            >
              <ArrowPathIcon className={cn("size-4", refreshPending && "animate-spin")} />
              {refreshPending
                ? "Proveravam račun…"
                : cooldownActive
                  ? `Osveži stavke (${cooldownLabel})`
                  : "Osveži stavke"}
            </Button>
            {refreshInfo ? <p className="text-xs text-muted-foreground">{refreshInfo}</p> : null}
          </>
        ) : null}
      </div>
    );
  }
  return (
    <ul className="rounded-2xl border border-border bg-card px-3 shadow-card">
      {items.map((it) => (
        <li
          key={it.id}
          className="flex items-center gap-2.5 border-b border-border py-2.5 last:border-b-0"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-normal text-foreground">
              {it.name}
            </span>
            {it.quantity != null && it.quantity !== 1 ? (
              <span className="block text-[11px] text-muted-foreground tabular-nums">
                ×{it.quantity}
              </span>
            ) : null}
          </span>
          <span className="shrink-0 text-[13.5px] font-bold text-foreground tabular-nums">
            <Amount value={it.total} />
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ReceiptExpenseDialog({
  open,
  onOpenChange,
  expense,
  allowDelete = true,
  onOpenExpense,
}: ReceiptExpenseDialogProps) {
  const stack = useSheetStack<View>(open, onOpenChange, "detail");
  const { push, pop, reset } = stack;
  const isDesktop = useIsDesktop();
  const { categories } = useExpenseCategories();
  const { members } = useFamilyMembers();
  const updateExpense = useUpdateExpense();
  const deleteExpense = useDeleteExpense();
  const refreshItems = useReceiptRefresh();
  const splitExpense = useSplitReceiptExpense();
  const { items, isLoading: itemsLoading } = useExpenseItems(open && expense ? expense.id : null);
  // Whole-receipt picture (all lines + sibling expenses) - powers "Deo
  // računa" and the split guardrails. Lazy like the items.
  const { context: receiptContext } = useReceiptContext(
    open && expense ? expense.receipt_id : null,
  );

  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [link, setLink] = useState<PaymentLinkValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshInfo, setRefreshInfo] = useState<string | null>(null);
  const [splitSelected, setSplitSelected] = useState<ReadonlySet<number>>(new Set());
  const [splitCategoryId, setSplitCategoryId] = useState<string | null>(null);
  const [splitError, setSplitError] = useState<string | null>(null);
  // Local echo of the server-claimed receipt_checked_at: the expense prop is a
  // snapshot from the list, so a refresh attempt in THIS dialog won't update it
  // until the invalidated query lands - the local claim bridges that gap.
  const [localClaimAt, setLocalClaimAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Reset the editable fields whenever a different expense opens.
  useEffect(() => {
    if (expense) {
      reset();
      setCategoryId(expense.category_id);
      setPersonId(expense.person_id);
      setNote(expense.note ?? "");
      setLink(expenseLinkValue(expense));
      setError(null);
      setRefreshInfo(null);
      setSplitSelected(new Set());
      setSplitCategoryId(null);
      setSplitError(null);
      setLocalClaimAt(null);
      setNow(Date.now());
    }
  }, [expense, reset]);

  // Cooldown countdown for "Osveži stavke" - mirrors the server-enforced claim.
  const checkedAt = expense?.receipt_checked_at ? Date.parse(expense.receipt_checked_at) : null;
  const claimAt = Math.max(checkedAt ?? 0, localClaimAt ?? 0) || null;
  const cooldownRemainingMs =
    claimAt != null ? Math.max(0, claimAt + RECEIPT_REFRESH_COOLDOWN_SECONDS * 1000 - now) : 0;
  const cooldownActive = cooldownRemainingMs > 0;

  useEffect(() => {
    if (!open || !cooldownActive) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open, cooldownActive]);

  const countdownLabel = (() => {
    const total = Math.ceil(cooldownRemainingMs / 1000);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  })();

  const handleRefreshItems = () => {
    if (!expense) return;
    setRefreshInfo(null);
    refreshItems.mutate(expense, {
      onSuccess: (res) => {
        if (res.status === "added") {
          const verb = serbianPlural(res.count, {
            one: "Dodata je",
            few: "Dodate su",
            many: "Dodato je",
          });
          toast.success(`${verb} ${res.count} ${stavkeLabel(res.count)}`);
        } else {
          setRefreshInfo(
            "Prodavac još nije poslao sadržaj računa poreskoj upravi. Pokušaj kasnije.",
          );
          setLocalClaimAt(Date.now());
        }
      },
      onError: (err) => {
        setRefreshInfo(err.message || "Greška pri osvežavanju stavki.");
        setLocalClaimAt(Date.now());
      },
    });
  };

  const handleSave = async () => {
    if (!expense) return;
    setError(null);
    try {
      await updateExpense.mutateAsync({
        id: expense.id,
        payload: {
          category_id: categoryId,
          person_id: personId,
          note: note.trim() || null,
          activity_id: link?.kind === "activity" ? link.id : null,
          event_id: link?.kind === "event" ? link.id : null,
        },
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Greška pri čuvanju izmena");
    }
  };

  // --- Split ("Podeli račun") ---
  // Only when carving by lines keeps the ledger exact: at least two lines,
  // and their totals sum to precisely this expense's amount.
  const splitLines: SelectableReceiptLine[] = useMemo(
    () =>
      items.map((it) => ({ idx: it.idx, name: it.name, quantity: it.quantity, total: it.total })),
    [items],
  );
  const splitEligible = useMemo(() => {
    if (!expense?.receipt_id || items.length < 2) return false;
    const cents = items.reduce((sum, it) => sum + Math.round(it.total * 100), 0);
    return cents === Math.round(expense.amount * 100);
  }, [expense, items]);
  const splitSum = useMemo(
    () => sumLineTotals(splitLines, splitSelected),
    [splitLines, splitSelected],
  );
  const splitValid = splitSelected.size > 0 && splitSelected.size < splitLines.length;

  const handleSplit = () => {
    if (!expense || !splitValid) return;
    setSplitError(null);
    splitExpense.mutate(
      {
        expenseId: expense.id,
        claimIdxs: [...splitSelected].sort((a, b) => a - b),
        category_id: splitCategoryId,
        person_id: null,
        note: null,
      },
      {
        onSuccess: () => {
          toast.success("Račun je podeljen na dva troška");
          onOpenChange(false);
        },
        onError: (err) => {
          setSplitError(
            err instanceof ClaimConflictError
              ? err.message
              : err.message || "Greška pri deljenju računa.",
          );
        },
      },
    );
  };

  // --- "Deo računa" (whole-receipt picture) ---
  const siblings = useMemo(
    () => (receiptContext?.expenses ?? []).filter((e) => e.id !== expense?.id),
    [receiptContext, expense],
  );
  const totalLineCount = receiptContext?.lines.length ?? 0;
  const showPartInfo =
    !!receiptContext &&
    (siblings.length > 0 || (totalLineCount > 0 && items.length < totalLineCount));

  const handleDelete = async () => {
    if (!expense) return;
    try {
      await deleteExpense.mutateAsync(expense.id);
      onOpenChange(false);
    } catch {
      // Toast surfaced by the hook; stay here so the user can retry.
    }
  };

  const selectedCategory = categoryId ? categories.find((c) => c.id === categoryId) : null;
  const selectedPerson = personId ? members.find((m) => m.id === personId) : null;
  const personName = selectedPerson
    ? getDisplayName({
        firstName: selectedPerson.first_name,
        lastName: selectedPerson.last_name,
        email: null,
      }) || "Bez imena"
    : null;

  const itemsInline = (
    <ItemsList
      items={items}
      itemsLoading={itemsLoading}
      receiptUrl={expense?.receipt_url ?? null}
      refreshDisabled={refreshItems.isPending || cooldownActive}
      refreshPending={refreshItems.isPending}
      cooldownLabel={countdownLabel}
      cooldownActive={cooldownActive}
      refreshInfo={refreshInfo}
      onRefresh={handleRefreshItems}
    />
  );

  // "This is one part of a bigger receipt": the whole-receipt line + the
  // sibling parts (tappable when the host can re-target the dialog) + any
  // still-unclaimed remainder.
  const freeLineCount = receiptContext
    ? receiptContext.lines.filter((l) => !l.expense_id).length
    : 0;
  const partInfoBlock =
    showPartInfo && receiptContext ? (
      <div className="space-y-2 rounded-2xl bg-accent-soft p-3">
        <p className="text-xs font-semibold text-accent-deep">
          Deo računa · {items.length} od {totalLineCount} {stavkeLabel(totalLineCount)} · ceo račun{" "}
          <Amount value={receiptContext.receipt.total_amount} />
        </p>
        {siblings.length > 0 ? (
          <ul className="space-y-1">
            {siblings.map((sibling) => {
              const category = sibling.category_id
                ? categories.find((c) => c.id === sibling.category_id)
                : null;
              const Icon = categoryIcon(category?.icon);
              // Categories carry their own colour; the fallback follows the tokens.
              const color = category?.color ?? null;
              const inner = (
                <>
                  <span
                    className="flex size-7 shrink-0 items-center justify-center rounded-[10px]"
                    style={{ backgroundColor: color ? `${color}22` : "var(--muted)" }}
                  >
                    <Icon
                      className="size-3.5"
                      style={{ color: color ?? "var(--muted-foreground)" }}
                    />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-left font-normal text-foreground">
                    {category?.name ?? "Bez kategorije"}
                    {sibling.note?.trim() ? ` · ${sibling.note.trim()}` : ""}
                  </span>
                  <span className="shrink-0 font-bold text-foreground tabular-nums">
                    <Amount value={sibling.amount} />
                  </span>
                </>
              );
              return (
                <li key={sibling.id}>
                  {onOpenExpense ? (
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-sm transition-colors hover:bg-card/70"
                      onClick={() => onOpenExpense(sibling)}
                    >
                      {inner}
                      <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    </button>
                  ) : (
                    <div className="flex w-full items-center gap-2 px-1.5 py-1.5 text-sm">
                      {inner}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}
        {freeLineCount > 0 ? (
          <p className="text-xs text-muted-foreground">
            {freeLineCount} {stavkeLabel(freeLineCount)} sa računa još nije dodato - skeniraj račun
            ponovo da ih dodaš.
          </p>
        ) : null}
      </div>
    ) : null;

  const detailParts: string[] = [];
  if (personName) detailParts.push(personName);
  if (note.trim()) detailParts.push("Beleška ✓");
  if (link) detailParts.push("Povezano ✓");
  const detailCount = (personId ? 1 : 0) + (note.trim() ? 1 : 0) + (link ? 1 : 0);

  const stickyFooterFor = (view: View) =>
    !isDesktop && view === "detail" && expense ? (
      <div className="flex items-center justify-between gap-2">
        {allowDelete ? (
          <Button
            type="button"
            variant="ghost"
            className="rounded-[15px] font-semibold text-neg hover:bg-neg-soft hover:text-neg"
            disabled={updateExpense.isPending}
            onClick={() => push("delete")}
          >
            <TrashIcon className="size-4" />
            Obriši
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="rounded-[15px] border-border bg-card font-semibold text-muted-foreground"
            onClick={() => onOpenChange(false)}
            disabled={updateExpense.isPending}
          >
            Zatvori
          </Button>
          <Button
            type="button"
            className="rounded-[15px] font-semibold"
            onClick={() => void handleSave()}
            disabled={updateExpense.isPending}
          >
            {updateExpense.isPending ? "Čuvam…" : "Sačuvaj izmene"}
          </Button>
        </div>
      </div>
    ) : undefined;

  const titleFor = (view: View) =>
    view === "delete"
      ? "Obriši trošak"
      : view === "category"
        ? "Kategorija"
        : view === "details"
          ? "Detalji"
          : view === "items"
            ? "Stavke"
            : view === "split"
              ? "Podeli račun"
              : view === "link"
                ? "Poveži sa"
                : expense?.merchant || "Račun";

  return (
    <SheetStackViews
      stack={stack}
      render={(view, level) => (
        <ResponsiveDialogContent className="sm:max-w-md" stickyFooter={stickyFooterFor(view)}>
          <SheetStackHeader title={titleFor(view)} onBack={level === 0 ? undefined : pop} />

          {!expense ? null : view === "delete" ? (
            <>
              <p className="text-sm text-muted-foreground">
                Obrisati trošak „{expense.merchant || "Račun"}" od <Amount value={expense.amount} />
                ? Ova radnja se ne može opozvati.
              </p>
              <ResponsiveDialogFooter>
                <Button
                  variant="outline"
                  className="h-auto rounded-[15px] border-border bg-card py-[13px] text-[15px] font-bold text-muted-foreground"
                  onClick={pop}
                  disabled={deleteExpense.isPending}
                >
                  Nazad
                </Button>
                <Button
                  variant="destructive"
                  className="h-auto rounded-[15px] py-[13px] text-[15px] font-bold"
                  onClick={() => {
                    void handleDelete();
                  }}
                  disabled={deleteExpense.isPending}
                >
                  Obriši
                </Button>
              </ResponsiveDialogFooter>
            </>
          ) : view === "category" ? (
            <CategoryGridPicker
              value={categoryId}
              onChange={(id) => {
                setCategoryId(id);
                pop();
              }}
            />
          ) : view === "split" ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Izaberi stavke koje prelaze na novi trošak. Iznosi se preračunavaju sami - zbir oba
                dela ostaje tačno ceo račun.
              </p>
              <ReceiptItemsSelect
                lines={splitLines}
                selected={splitSelected}
                onToggle={(idx) => {
                  setSplitSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(idx)) next.delete(idx);
                    else next.add(idx);
                    return next;
                  });
                }}
                onSetAll={(select) => {
                  // "All" would empty the original - cap at all-but-one.
                  setSplitSelected(
                    select ? new Set(splitLines.slice(0, -1).map((l) => l.idx)) : new Set(),
                  );
                }}
                disabled={splitExpense.isPending}
              />
              <div className="rounded-xl bg-muted px-3 py-2.5 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    Novi trošak ({splitSelected.size} {stavkeLabel(splitSelected.size)})
                  </span>
                  <span className="font-bold text-foreground tabular-nums">
                    <Amount value={splitSum} />
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-muted-foreground">Ostaje na ovom trošku</span>
                  <span className="font-bold text-foreground tabular-nums">
                    <Amount value={(expense ? expense.amount : 0) - splitSum} />
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Kategorija novog troška</Label>
                <CategoryGridPicker value={splitCategoryId} onChange={setSplitCategoryId} />
              </div>
              {splitError ? (
                <div className="rounded-xl bg-neg-soft p-3 text-sm font-normal text-neg">
                  {splitError}
                </div>
              ) : null}
              <ResponsiveDialogFooter>
                <Button
                  variant="outline"
                  className="h-auto rounded-[15px] border-border bg-card py-[13px] text-[15px] font-bold text-muted-foreground"
                  onClick={pop}
                  disabled={splitExpense.isPending}
                >
                  Nazad
                </Button>
                <Button
                  className="h-auto rounded-[15px] py-[13px] text-[15px] font-bold"
                  onClick={handleSplit}
                  disabled={!splitValid || splitExpense.isPending}
                >
                  {splitExpense.isPending ? "Delim…" : "Podeli"}
                </Button>
              </ResponsiveDialogFooter>
            </div>
          ) : view === "items" ? (
            itemsInline
          ) : view === "link" ? (
            <PaymentLinkPickerSheet
              value={link}
              onChange={setLink}
              onDone={pop}
              kinds={EXPENSE_LINK_KINDS}
            />
          ) : view === "details" ? (
            <div className="space-y-4">
              <ExpensePersonSelect value={personId} onChange={setPersonId} />
              <div className="space-y-2">
                <Label htmlFor="receipt-detail-note">Beleška</Label>
                <Input
                  id="receipt-detail-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="npr. nedeljna kupovina"
                />
              </div>
              <PaymentLinkField
                value={link}
                onChange={setLink}
                kinds={EXPENSE_LINK_KINDS}
                // Mobile-only sub-view: full-sheet picker instead of a popover.
                onOpenPicker={() => push("link")}
              />
            </div>
          ) : (
            <div className="space-y-5">
              {/* Amount (read-only) + date. */}
              <div className="text-center">
                <div className="text-[34px] font-bold tracking-[-0.03em] text-foreground tabular-nums">
                  <Amount value={expense.amount} />
                </div>
                <div className="mt-1 text-[13px] text-muted-foreground">
                  {formatDate(expense.spent_on)}
                </div>
                {expense.receipt_url ? (
                  <a
                    href={expense.receipt_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-accent-deep hover:underline"
                  >
                    Otvori račun
                    <ArrowTopRightOnSquareIcon className="size-4" />
                  </a>
                ) : null}
              </div>

              {isDesktop ? (
                // --- Desktop: everything inline ---
                <>
                  <div className="space-y-2">
                    <Label>Kategorija</Label>
                    <CategoryGridPicker value={categoryId} onChange={setCategoryId} />
                  </div>
                  <div className="space-y-2">
                    <Label>Stavke</Label>
                    {itemsInline}
                    {splitEligible ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full"
                        onClick={() => push("split")}
                      >
                        <ScissorsIcon className="size-4" />
                        Podeli račun
                      </Button>
                    ) : null}
                  </div>
                  {partInfoBlock}
                  <ExpensePersonSelect value={personId} onChange={setPersonId} />
                  <div className="space-y-2">
                    <Label htmlFor="receipt-detail-note-d">Beleška</Label>
                    <Input
                      id="receipt-detail-note-d"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="npr. nedeljna kupovina"
                    />
                  </div>
                  <PaymentLinkField value={link} onChange={setLink} kinds={EXPENSE_LINK_KINDS} />
                  {error ? (
                    <div className="rounded-xl bg-neg-soft p-3 text-sm font-normal text-neg">
                      {error}
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between gap-2 pt-1">
                    {allowDelete ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className="rounded-[15px] font-semibold text-neg hover:bg-neg-soft hover:text-neg"
                        disabled={updateExpense.isPending}
                        onClick={() => push("delete")}
                      >
                        <TrashIcon className="size-4" />
                        Obriši
                      </Button>
                    ) : (
                      <span />
                    )}
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-[15px] border-border bg-card font-semibold text-muted-foreground"
                        onClick={() => onOpenChange(false)}
                        disabled={updateExpense.isPending}
                      >
                        Zatvori
                      </Button>
                      <Button
                        type="button"
                        className="rounded-[15px] font-semibold"
                        onClick={() => void handleSave()}
                        disabled={updateExpense.isPending}
                      >
                        {updateExpense.isPending ? "Čuvam…" : "Sačuvaj izmene"}
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                // --- Mobile: "Brzi unos" picker rows (footer pinned by dialog) ---
                <div className="space-y-2">
                  <PickerRow
                    title="Kategorija"
                    summary={selectedCategory ? selectedCategory.name : "Bez kategorije"}
                    icon={
                      selectedCategory ? (
                        (() => {
                          const Icon = categoryIcon(selectedCategory.icon);
                          return (
                            <Icon className="size-4" style={{ color: selectedCategory.color }} />
                          );
                        })()
                      ) : (
                        <TagIcon className="size-4" />
                      )
                    }
                    onClick={() => push("category")}
                  />
                  <PickerRow
                    title="Stavke"
                    summary={
                      itemsLoading
                        ? "Učitavam…"
                        : items.length > 0
                          ? `${items.length} ${stavkeLabel(items.length)}`
                          : "Nema stavki"
                    }
                    icon={<ListBulletIcon className="size-4" />}
                    onClick={() => push("items")}
                  />
                  {splitEligible ? (
                    <PickerRow
                      title="Podeli račun"
                      summary="Deo stavki kao poseban trošak"
                      icon={<ScissorsIcon className="size-4" />}
                      onClick={() => push("split")}
                    />
                  ) : null}
                  <PickerRow
                    title="Više detalja"
                    summary={detailParts.length > 0 ? detailParts.join(" · ") : "Za koga · beleška"}
                    icon={<AdjustmentsHorizontalIcon className="size-4" />}
                    count={detailCount}
                    onClick={() => push("details")}
                  />
                  {partInfoBlock}
                  {error ? (
                    <div className="rounded-xl bg-neg-soft p-3 text-sm font-normal text-neg">
                      {error}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </ResponsiveDialogContent>
      )}
    />
  );
}
