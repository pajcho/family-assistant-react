import { useEffect, useState } from "react";
import {
  AdjustmentsHorizontalIcon,
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  ListBulletIcon,
  TagIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { toast } from "sonner";

import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  useIsDesktop,
} from "@/components/ui/responsive-dialog";
import { SheetStackHeader, useSheetStack } from "@/components/common/SheetStack";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { categoryIcon } from "@/components/budget/categoryIcons";
import { CategoryGridPicker } from "@/components/budget/CategoryGridPicker";
import { ExpensePersonSelect } from "@/components/budget/ExpenseForm";
import { PickerRow } from "@/components/common/PickerRow";
import { useExpenseCategories } from "@/hooks/useExpenseCategories";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { useDeleteExpense, useExpenseItems, useUpdateExpense } from "@/hooks/useExpenses";
import { RECEIPT_REFRESH_COOLDOWN_SECONDS, useReceiptRefresh } from "@/hooks/useReceiptImport";
import type { Expense, ExpenseItem } from "@/types/database";
import { serbianPlural, stavkeLabel } from "@/utils/plural";
import { getDisplayName } from "@/utils/identity";
import { Amount } from "@/components/common/Amount";
import { cn } from "@/lib/cn";

/**
 * Detail + recategorize surface for a scanned-receipt expense. Amount and date
 * are read-only (they come from the fiscal receipt, like auto-payment rows),
 * but category / person / note are editable — the same "recategorize an
 * automatic row" affordance payments get.
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
};

type View = "detail" | "category" | "details" | "items" | "delete";

function formatDate(spentOn: string): string {
  const [y, m, d] = spentOn.split("-");
  if (!y || !m || !d) return spentOn;
  return `${d}.${m}.${y}.`;
}

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
  items: ExpenseItem[];
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
            {refreshInfo ? (
              <p className="text-xs text-gray-500 dark:text-gray-400">{refreshInfo}</p>
            ) : null}
          </>
        ) : null}
      </div>
    );
  }
  return (
    <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-700">
      {items.map((it) => (
        <li key={it.id} className="flex items-center gap-2 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1 truncate text-gray-700 dark:text-gray-200">
            {it.name}
          </span>
          {it.quantity != null && it.quantity !== 1 ? (
            <span className="shrink-0 text-xs text-gray-400 tabular-nums">×{it.quantity}</span>
          ) : null}
          <span className="shrink-0 tabular-nums text-gray-900 dark:text-gray-100">
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
}: ReceiptExpenseDialogProps) {
  const { view, atRoot, push, pop, reset, dialogOpen, dialogKey, handleOpenChange } =
    useSheetStack<View>(open, onOpenChange, "detail");
  const isDesktop = useIsDesktop();
  const { categories } = useExpenseCategories();
  const { members } = useFamilyMembers();
  const updateExpense = useUpdateExpense();
  const deleteExpense = useDeleteExpense();
  const refreshItems = useReceiptRefresh();
  const { items, isLoading: itemsLoading } = useExpenseItems(open && expense ? expense.id : null);

  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refreshInfo, setRefreshInfo] = useState<string | null>(null);
  // Local echo of the server-claimed receipt_checked_at: the expense prop is a
  // snapshot from the list, so a refresh attempt in THIS dialog won't update it
  // until the invalidated query lands — the local claim bridges that gap.
  const [localClaimAt, setLocalClaimAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Reset the editable fields whenever a different expense opens.
  useEffect(() => {
    if (expense) {
      reset();
      setCategoryId(expense.category_id);
      setPersonId(expense.person_id);
      setNote(expense.note ?? "");
      setError(null);
      setRefreshInfo(null);
      setLocalClaimAt(null);
      setNow(Date.now());
    }
  }, [expense, reset]);

  // Cooldown countdown for "Osveži stavke" — mirrors the server-enforced claim.
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
        payload: { category_id: categoryId, person_id: personId, note: note.trim() || null },
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Greška pri čuvanju izmena");
    }
  };

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

  const detailParts: string[] = [];
  if (personName) detailParts.push(personName);
  if (note.trim()) detailParts.push("Beleška ✓");
  const detailCount = (personId ? 1 : 0) + (note.trim() ? 1 : 0);

  const stickyFooter =
    !isDesktop && view === "detail" && expense ? (
      <div className="flex items-center justify-between gap-2">
        {allowDelete ? (
          <Button
            type="button"
            variant="ghost"
            className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
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
            onClick={() => onOpenChange(false)}
            disabled={updateExpense.isPending}
          >
            Zatvori
          </Button>
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={updateExpense.isPending}
          >
            {updateExpense.isPending ? "Čuvam…" : "Sačuvaj izmene"}
          </Button>
        </div>
      </div>
    ) : undefined;

  const headerTitle =
    view === "delete"
      ? "Obriši trošak"
      : view === "category"
        ? "Kategorija"
        : view === "details"
          ? "Detalji"
          : view === "items"
            ? "Stavke"
            : expense?.merchant || "Račun";

  return (
    <ResponsiveDialog key={dialogKey} open={dialogOpen} onOpenChange={handleOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md" stickyFooter={stickyFooter}>
        <SheetStackHeader title={headerTitle} onBack={atRoot ? undefined : pop} />

        {!expense ? null : view === "delete" ? (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Obrisati trošak „{expense.merchant || "Račun"}" od <Amount value={expense.amount} />?
              Ova radnja se ne može opozvati.
            </p>
            <ResponsiveDialogFooter>
              <Button variant="outline" onClick={pop} disabled={deleteExpense.isPending}>
                Nazad
              </Button>
              <Button
                variant="destructive"
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
        ) : view === "items" ? (
          itemsInline
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
          </div>
        ) : (
          <div className="space-y-5">
            {/* Amount (read-only) + date. */}
            <div className="text-center">
              <div className="text-4xl font-semibold tabular-nums text-gray-900 dark:text-white">
                <Amount value={expense.amount} />
              </div>
              <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {formatDate(expense.spent_on)}
              </div>
              {expense.receipt_url ? (
                <a
                  href={expense.receipt_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
                >
                  Otvori račun
                  <ArrowTopRightOnSquareIcon className="size-4" />
                </a>
              ) : null}
            </div>

            {isDesktop ? (
              // ——— Desktop: everything inline ———
              <>
                <div className="space-y-2">
                  <Label>Kategorija</Label>
                  <CategoryGridPicker value={categoryId} onChange={setCategoryId} />
                </div>
                <div className="space-y-2">
                  <Label>Stavke</Label>
                  {itemsInline}
                </div>
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
                {error ? (
                  <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
                    {error}
                  </div>
                ) : null}
                <div className="flex items-center justify-between gap-2 pt-1">
                  {allowDelete ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
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
                      onClick={() => onOpenChange(false)}
                      disabled={updateExpense.isPending}
                    >
                      Zatvori
                    </Button>
                    <Button
                      type="button"
                      onClick={() => void handleSave()}
                      disabled={updateExpense.isPending}
                    >
                      {updateExpense.isPending ? "Čuvam…" : "Sačuvaj izmene"}
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              // ——— Mobile: "Brzi unos" picker rows (footer pinned by dialog) ———
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
                <PickerRow
                  title="Više detalja"
                  summary={detailParts.length > 0 ? detailParts.join(" · ") : "Za koga · beleška"}
                  icon={<AdjustmentsHorizontalIcon className="size-4" />}
                  count={detailCount}
                  onClick={() => push("details")}
                />
                {error ? (
                  <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
                    {error}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
