import { useEffect, useMemo, useState } from "react";
import {
  AdjustmentsHorizontalIcon,
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  BuildingStorefrontIcon,
  ChevronRightIcon,
  ListBulletIcon,
  PencilIcon,
  PlusIcon,
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
import { ExpensePersonSelect, expenseLinkValue } from "@/components/budget/ExpenseForm";
import { PaymentLinkField, type PaymentLinkValue } from "@/components/payments/PaymentLinkField";
import { PaymentLinkPickerSheet } from "@/components/payments/PaymentLinkPickerSheet";
import { PickerRow } from "@/components/common/PickerRow";
import {
  ReceiptItemsSelect,
  sumLineTotals,
  type SelectableReceiptLine,
} from "@/components/budget/receipt/ReceiptItemsSelect";
import {
  NEW_EXTRA_DRAFT,
  ReceiptExtraFields,
  extraDraftAmount,
  type ExpenseExtraDraft,
} from "@/components/budget/receipt/ReceiptExtraFields";
import { useExpenseCategories } from "@/hooks/useExpenseCategories";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import {
  ClaimConflictError,
  useCreateExpense,
  useDeleteExpense,
  useExpenseExtras,
  useExpenseItems,
  useReceiptContext,
  useSplitReceiptExpense,
  useUpdateExpense,
} from "@/hooks/useExpenses";
import { useMerchantAliases, useSetMerchantAlias } from "@/hooks/useMerchantAliases";
import { RECEIPT_REFRESH_COOLDOWN_SECONDS, useReceiptRefresh } from "@/hooks/useReceiptImport";
import type { Expense, ReceiptItem } from "@/types/database";
import { expenseLabels } from "@/utils/budget";
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
 * amount), splitting the receipt opens a sub-view where some lines move onto a NEW
 * expense - amounts adjust on both sides, ledger total unchanged. When the
 * receipt has several expenses (or unclaimed lines), a receipt-part block
 * shows the whole-receipt picture with a jump to the sibling parts.
 *
 * Extras: money spent with this receipt but missing from it (the cash tip)
 * are separate expenses tied to this one (`parent_expense_id`). They are
 * listed under "Dodatno uz račun" and added, edited or removed in their own
 * sub-view, so the receipt's amount and lines stay the fiscal receipt's.
 *
 * Mirrors the "Brzi unos" expense form: on mobile the editable bits collapse
 * into picker rows (category / items / more details) that open sub-views on
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
   * in the receipt-part block). Hosts that can't re-target the dialog omit it - the
   * sibling rows then render non-interactive.
   */
  onOpenExpense?: (expense: Expense) => void;
};

// "link" sits one level under "details" (details -> link to), the same
// nesting the manual expense form uses.
type View =
  | "detail"
  | "category"
  | "details"
  | "items"
  | "split"
  | "delete"
  | "link"
  | "extra"
  | "merchant";

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
  const { aliasFor } = useMerchantAliases();
  const setMerchantAlias = useSetMerchantAlias();
  const createExpense = useCreateExpense();
  const { extras } = useExpenseExtras(open && expense ? expense.id : null);
  const { items, isLoading: itemsLoading } = useExpenseItems(open && expense ? expense.id : null);
  // Whole-receipt picture (all lines + sibling expenses) - powers "Deo
  // block and the split guardrails. Lazy like the items.
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
  // The extra open in the "extra" sub-view: null while adding a new one.
  const [editingExtra, setEditingExtra] = useState<Expense | null>(null);
  const [extraDraft, setExtraDraft] = useState<ExpenseExtraDraft>(NEW_EXTRA_DRAFT);
  const [extraError, setExtraError] = useState<string | null>(null);
  const [merchantDraft, setMerchantDraft] = useState("");
  // Local echo of the server-claimed receipt_checked_at: the expense prop is a
  // snapshot from the list, so a refresh attempt in THIS dialog won't update it
  // until the invalidated query lands - the local claim bridges that gap.
  const [localClaimAt, setLocalClaimAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Reset the editable fields whenever a different expense opens. Adjusted
  // during render instead of in an effect; starts unset so an expense passed
  // at mount is seeded too.
  const [seededFor, setSeededFor] = useState<{ expense: typeof expense } | null>(null);
  if (!seededFor || seededFor.expense !== expense) {
    setSeededFor({ expense });
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
      setEditingExtra(null);
      setExtraDraft(NEW_EXTRA_DRAFT);
      setExtraError(null);
      setLocalClaimAt(null);
    }
  }

  // Restart the cooldown clock for the newly opened expense. Reading the wall
  // clock is impure, so this part cannot move into the render-time reset above.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- syncs with the wall clock (Date.now()), which is impure and cannot run during render
    if (expense) setNow(Date.now());
  }, [expense]);

  // Cooldown countdown for the refresh-items action - mirrors the server-enforced claim.
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
          birthday_id: link?.kind === "birthday" ? link.id : null,
        },
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Greška pri čuvanju izmena");
    }
  };

  // --- Split the receipt ---
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

  // --- Receipt part (whole-receipt picture) ---
  const siblings = useMemo(
    () => (receiptContext?.expenses ?? []).filter((e) => e.id !== expense?.id),
    [receiptContext, expense],
  );
  const totalLineCount = receiptContext?.lines.length ?? 0;
  const showPartInfo =
    !!receiptContext &&
    (siblings.length > 0 || (totalLineCount > 0 && items.length < totalLineCount));

  // --- Extras (a tip left next to the receipt) ---
  const extrasSum = extras.reduce((sum, e) => sum + Math.round(e.amount * 100), 0) / 100;
  const extraAmount = extraDraftAmount(extraDraft);
  const extraSaving = createExpense.isPending || updateExpense.isPending || deleteExpense.isPending;

  const openExtra = (target: Expense | null) => {
    setEditingExtra(target);
    setExtraDraft(
      target ? { amount: String(target.amount), note: target.note ?? "" } : NEW_EXTRA_DRAFT,
    );
    setExtraError(null);
    push("extra");
  };

  const handleSaveExtra = async () => {
    if (!expense || extraAmount == null) return;
    setExtraError(null);
    const note = extraDraft.note.trim() || null;
    try {
      if (editingExtra) {
        await updateExpense.mutateAsync({
          id: editingExtra.id,
          payload: { amount: extraAmount, note },
        });
      } else {
        // Date, category, person and link come from this receipt (DB trigger).
        await createExpense.mutateAsync({
          amount: extraAmount,
          spent_on: expense.spent_on,
          note,
          parent_expense_id: expense.id,
        });
      }
      pop();
    } catch (err) {
      setExtraError(err instanceof Error && err.message ? err.message : "Greška pri čuvanju");
    }
  };

  const handleDeleteExtra = async () => {
    if (!editingExtra) return;
    try {
      await deleteExpense.mutateAsync(editingExtra.id);
      pop();
    } catch {
      // Toast surfaced by the hook; stay here so the user can retry.
    }
  };

  const extrasBlock = (
    <div className="space-y-2">
      {extras.length > 0 ? (
        <>
          <Label>Dodatno uz račun</Label>
          <ul className="rounded-2xl border border-border bg-card px-1.5 shadow-card">
            {extras.map((extra) => (
              <li key={extra.id} className="border-b border-border last:border-b-0">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-lg px-1.5 py-2.5 text-left text-[13.5px] transition-colors hover:bg-muted/60"
                  onClick={() => openExtra(extra)}
                >
                  <span className="min-w-0 flex-1 truncate font-normal text-foreground">
                    {extra.note?.trim() || "Dodatak"}
                  </span>
                  <span className="shrink-0 font-bold text-foreground tabular-nums">
                    <Amount value={extra.amount} />
                  </span>
                  <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <button
        type="button"
        onClick={() => openExtra(null)}
        className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-border px-3 py-2.5 text-[13.5px] font-semibold text-muted-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <PlusIcon className="size-4" />
        {extras.length > 0 ? "Dodaj još" : "Bakšiš ili trošak van računa"}
      </button>
    </div>
  );

  const handleDelete = async () => {
    if (!expense) return;
    try {
      await deleteExpense.mutateAsync(expense.id);
      onOpenChange(false);
    } catch {
      // Toast surfaced by the hook; stay here so the user can retry.
    }
  };

  // --- Merchant friendly name (family-wide, saved on its own) ---
  const merchantAlias = aliasFor(expense?.merchant);
  const labels = expense ? expenseLabels(expense, { merchantAlias }) : null;

  const openMerchantRename = () => {
    setMerchantDraft(merchantAlias ?? "");
    push("merchant");
  };

  const saveMerchantAlias = async (displayName: string) => {
    if (!expense?.merchant) return;
    try {
      await setMerchantAlias.mutateAsync({ merchant: expense.merchant, displayName });
      const name = displayName.trim();
      toast.success(
        name && name !== expense.merchant
          ? "Naziv prodavnice je sačuvan"
          : "Vraćen naziv sa računa",
      );
      pop();
    } catch {
      // Toast surfaced by the hook; stay here so the user can retry.
    }
  };

  // The store this receipt is from: the family's name for it (if any) with the
  // receipt's own name in small print, and the way into renaming it.
  const merchantRow = expense?.merchant ? (
    <button
      type="button"
      onClick={openMerchantRename}
      className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card px-3.5 py-3 text-left shadow-card transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-accent-soft text-accent-deep">
        <BuildingStorefrontIcon className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-semibold text-foreground">
          {merchantAlias ?? expense.merchant}
        </span>
        <span className="block truncate text-[12px] font-normal text-muted-foreground">
          {merchantAlias ? `Na računu: ${expense.merchant}` : "Naziv sa fiskalnog računa"}
        </span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold text-accent-deep">
        <PencilIcon className="size-3.5" />
        {merchantAlias ? "Izmeni" : "Preimenuj"}
      </span>
    </button>
  ) : null;

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
              : view === "extra"
                ? editingExtra
                  ? "Izmeni dodatak"
                  : "Dodatno uz račun"
                : view === "link"
                  ? "Poveži sa"
                  : view === "merchant"
                    ? "Naziv prodavnice"
                    : (labels?.title ?? "Račun");

  return (
    <SheetStackViews
      stack={stack}
      render={(view, level) => (
        <ResponsiveDialogContent className="sm:max-w-md" stickyFooter={stickyFooterFor(view)}>
          <SheetStackHeader title={titleFor(view)} onBack={level === 0 ? undefined : pop} />

          {!expense ? null : view === "delete" ? (
            <>
              <p className="text-sm text-muted-foreground">
                Obrisati trošak „{labels?.title}" od <Amount value={expense.amount} />?
                {extras.length > 0
                  ? ` Briše se i ono što je dodato uz račun (${extras
                      .map((e) => e.note?.trim() || "dodatak")
                      .join(", ")}).`
                  : ""}{" "}
                Ova radnja se ne može opozvati.
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
          ) : view === "extra" ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Novac potrošen uz ovaj račun koji nije na njemu, npr. bakšiš ostavljen u kešu. Čuva
                se kao poseban trošak sa istim datumom i kategorijom.
              </p>
              <ReceiptExtraFields
                idPrefix="receipt-detail-extra"
                draft={extraDraft}
                onChange={setExtraDraft}
                baseAmount={expense.amount}
                disabled={extraSaving}
              />
              {extraError ? (
                <div className="rounded-xl bg-neg-soft p-3 text-sm font-normal text-neg">
                  {extraError}
                </div>
              ) : null}
              <ResponsiveDialogFooter>
                {editingExtra ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-auto rounded-[15px] py-[13px] text-[15px] font-bold text-neg hover:bg-neg-soft hover:text-neg sm:mr-auto"
                    onClick={() => void handleDeleteExtra()}
                    disabled={extraSaving}
                  >
                    <TrashIcon className="size-4" />
                    Obriši
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  className="h-auto rounded-[15px] border-border bg-card py-[13px] text-[15px] font-bold text-muted-foreground"
                  onClick={pop}
                  disabled={extraSaving}
                >
                  Nazad
                </Button>
                <Button
                  className="h-auto rounded-[15px] py-[13px] text-[15px] font-bold"
                  onClick={() => void handleSaveExtra()}
                  disabled={extraAmount == null || extraSaving}
                >
                  {extraSaving ? "Čuvam…" : "Sačuvaj"}
                </Button>
              </ResponsiveDialogFooter>
            </div>
          ) : view === "merchant" ? (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void saveMerchantAlias(merchantDraft);
              }}
            >
              <div className="rounded-xl bg-muted px-3 py-2.5">
                <div className="text-[11px] font-bold tracking-[0.07em] text-muted-foreground uppercase">
                  Naziv sa računa
                </div>
                <div className="mt-0.5 text-sm font-semibold break-words text-foreground">
                  {expense.merchant}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="merchant-alias">Tvoj naziv</Label>
                <Input
                  id="merchant-alias"
                  value={merchantDraft}
                  onChange={(e) => setMerchantDraft(e.target.value)}
                  placeholder="npr. Market kod škole"
                  maxLength={80}
                  autoComplete="off"
                  disabled={setMerchantAlias.isPending}
                />
                <p className="text-xs text-muted-foreground">
                  Važi za sve račune iz ove prodavnice, i ranije i ubuduće. Naziv sa računa ostaje
                  vidljiv sitnim slovima.
                </p>
              </div>
              {merchantAlias ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full font-semibold text-muted-foreground"
                  disabled={setMerchantAlias.isPending}
                  onClick={() => void saveMerchantAlias("")}
                >
                  <ArrowPathIcon className="size-4" />
                  Vrati naziv sa računa
                </Button>
              ) : null}
              <ResponsiveDialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto rounded-[15px] border-border bg-card py-[13px] text-[15px] font-bold text-muted-foreground"
                  onClick={pop}
                  disabled={setMerchantAlias.isPending}
                >
                  Nazad
                </Button>
                <Button
                  type="submit"
                  className="h-auto rounded-[15px] py-[13px] text-[15px] font-bold"
                  disabled={setMerchantAlias.isPending || merchantDraft.trim() === ""}
                >
                  {setMerchantAlias.isPending ? "Čuvam…" : "Sačuvaj"}
                </Button>
              </ResponsiveDialogFooter>
            </form>
          ) : view === "items" ? (
            itemsInline
          ) : view === "link" ? (
            <PaymentLinkPickerSheet value={link} onChange={setLink} onDone={pop} />
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
                {extras.length > 0 ? (
                  <div className="mt-1 text-[13px] text-muted-foreground">
                    + {extras.length === 1 ? extras[0].note?.trim() || "dodatak" : "dodatno"}{" "}
                    <Amount value={extrasSum} /> ·{" "}
                    <span className="font-semibold text-foreground">
                      ukupno <Amount value={Math.round((expense.amount + extrasSum) * 100) / 100} />
                    </span>
                  </div>
                ) : null}
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

              {merchantRow}

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
                  {extrasBlock}
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
                  <PaymentLinkField value={link} onChange={setLink} />
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
                  <div className="pt-3">{extrasBlock}</div>
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
