import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowUpTrayIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";

import {
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SheetStackViews, useSheetStack } from "@/components/common/SheetStack";
import {
  ClaimConflictError,
  DuplicateReceiptError,
  fetchExpenseByReceiptUrl,
  fetchReceiptByUrl,
  useAttachReceiptToExpense,
  useMerchantCategory,
  useSaveReceiptExpense,
  type ReceiptWithClaims,
} from "@/hooks/useExpenses";
import { isSufReceiptUrl, type ParsedReceipt, useReceiptImport } from "@/hooks/useReceiptImport";
import { useProfile } from "@/hooks/useProfile";
import type { Expense, Receipt } from "@/types/database";
import type { PaymentLinkValue } from "@/components/payments/PaymentLinkField";
import { Amount } from "@/components/common/Amount";
import { stavkeLabel } from "@/utils/plural";
import { ReceiptCamera } from "./ReceiptCamera";
import { ReceiptPreview, type ReceiptPreviewView } from "./ReceiptPreview";
import { sumLineTotals, type SelectableReceiptLine } from "./ReceiptItemsSelect";
import { decodeQrFromFile } from "@/lib/qrScan";

/**
 * Lazy-loaded scanner + import + preview flow for a fiscal receipt. Kept as a
 * dynamic-import chunk (see the budget page) so the camera + zxing-wasm never
 * enter the main bundle. State machine:
 *
 *   capture ──decode──▶ loading ──ok──▶ preview ──save──▶ chain ──▶ (close)
 *      ▲                   │                │               │
 *      └──── error ────────┘                │               └─"Dodaj ostatak"─▶ preview
 *                                           └── duplicate ──▶ jump to month
 *
 * Splitting: when the receipt's lines are complete, the preview lets the user
 * UNCHECK lines - the expense saves with just the checked ones (amount = their
 * sum) and the `chain` step offers the remainder as a new expense right away.
 * A re-scan of a partially-claimed receipt takes the FAST PATH: the preview
 * renders from the stored receipt (claimed lines disabled, no Edge call, no
 * rate-limit spend) and only the free lines are selectable.
 *
 * The preview's sub-views (Kategorija / Stavke / Detalji → Poveži sa) live on
 * THIS dialog's sheet stack (see `useSheetStack`), and the preview's field
 * values AND line selection live in this component: dismissing a sub-view
 * (swipe-down, tap outside) returns to the preview instead of throwing away
 * the parsed receipt, and a sub-view opening over the preview can't drop what
 * the user already picked.
 */

type Mode = "capture" | "loading" | "preview" | "duplicate" | "chain";

export type ReceiptScanDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Jump the budget view to a YYYY-MM (the duplicate "show it" action). */
  onJumpToMonth?: (yyyymm: string) => void;
  /**
   * Pre-link the saved expense to an activity/event (the scan started from
   * that context, e.g. "Skeniraj račun" in an activity detail). The preview's
   * "Poveži sa" row starts here and stays editable.
   */
  link?: PaymentLinkValue | null;
  /**
   * ATTACH MODE: instead of creating an expense, hand this scanned receipt to
   * an existing manual one ("Skeniraj račun" while editing it). Only its
   * amount and its items change - the date, category, person, note and link
   * the member already typed are left alone, so the preview drops those
   * fields entirely.
   */
  attachTo?: Expense | null;
};

/** Preview facts for a receipt we already have in the DB (fast path). */
function parsedFromStored(receipt: Receipt): ParsedReceipt {
  return {
    merchant: receipt.merchant,
    companyName: receipt.company_name,
    storeName: receipt.store_name,
    pib: receipt.pib,
    issuedAt: receipt.issued_on,
    totalAmount: receipt.total_amount,
    items: [],
    warnings: [],
    receiptUrl: receipt.receipt_url,
  };
}

/** DB lines + their claimants → the preview's selectable-line shape. */
function linesFromStored(known: ReceiptWithClaims): SelectableReceiptLine[] {
  const categoryByExpense = new Map(known.expenses.map((e) => [e.id, e.category_id]));
  return known.lines.map((line) => ({
    idx: line.idx,
    name: line.name,
    quantity: line.quantity,
    total: line.total,
    claimed: !!line.expense_id,
    claimedCategoryId: line.expense_id ? (categoryByExpense.get(line.expense_id) ?? null) : null,
  }));
}

export default function ReceiptScanDialog({
  open,
  onOpenChange,
  onJumpToMonth,
  link: seedLink,
  attachTo,
}: ReceiptScanDialogProps) {
  const { familyId } = useProfile();
  const importReceipt = useReceiptImport();
  const saveReceipt = useSaveReceiptExpense();
  const attachReceipt = useAttachReceiptToExpense();
  const attachMode = !!attachTo;
  const saving = saveReceipt.isPending || attachReceipt.isPending;

  const [mode, setMode] = useState<Mode>("capture");
  const [receipt, setReceipt] = useState<ParsedReceipt | null>(null);
  const [lines, setLines] = useState<SelectableReceiptLine[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  // Preview built from the stored receipt (fast path / chain): the save RPC
  // must not re-send lines it already has.
  const [dbSourced, setDbSourced] = useState(false);
  const [chainInfo, setChainInfo] = useState<{ count: number; sum: number } | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pasteValue, setPasteValue] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [duplicateMonth, setDuplicateMonth] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // The preview's sub-views ride this dialog's sheet stack, so a drawer
  // dismissal inside "Stavke"/"Kategorija"/"Detalji" pops back to the preview
  // (the parsed receipt survives); only a dismissal at the root closes the flow.
  const stack = useSheetStack<ReceiptPreviewView>(open, onOpenChange, "main");
  const { push, pop, reset } = stack;

  // The preview's field values - owned here so a sub-view opening on top (and
  // the preview remounting behind it) can't drop them.
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [link, setLink] = useState<PaymentLinkValue | null>(seedLink ?? null);
  // Read the seed through a ref so the resets below depend only on what
  // actually triggers them - an inline-constructed `link` prop is a new object
  // every render and would otherwise wipe a pick mid-flow.
  const seedLinkRef = useRef(seedLink ?? null);
  seedLinkRef.current = seedLink ?? null;
  const categoryTouched = useRef(false);
  const merchantCategory = useMerchantCategory(receipt?.merchant ?? null);

  // Preselect the remembered category once, unless the user already picked one
  // (or the flow decided against it - partial adds and chain remainders start
  // blank on purpose: the leftover part is usually a DIFFERENT category).
  useEffect(() => {
    if (categoryTouched.current) return;
    if (merchantCategory.data) setCategoryId(merchantCategory.data);
  }, [merchantCategory.data]);

  // Reset everything whenever the dialog closes so the next open starts fresh.
  // (The sheet stack rearms itself on the next open - see useSheetStack.)
  useEffect(() => {
    if (!open) {
      setMode("capture");
      setReceipt(null);
      setLines([]);
      setSelected(new Set());
      setDbSourced(false);
      setChainInfo(null);
      setCaptureError(null);
      setSaveError(null);
      setPasteValue("");
      setPasteError(null);
      setUploadError(null);
      setUploadBusy(false);
      setDuplicateMonth(null);
      setCategoryId(null);
      setPersonId(null);
      setNote("");
      setLink(seedLinkRef.current);
      categoryTouched.current = false;
    }
  }, [open]);

  // Leaving the preview (e.g. a save that hits the duplicate guard) discards
  // any sub-view still on the stack - the next mode renders from the root.
  useEffect(() => {
    if (mode !== "preview") reset();
  }, [mode, reset]);

  // Per-line selection is on only when the lines are complete AND consistent
  // (they sum exactly to the receipt total) - the invariant that makes the
  // parts always add up to the receipt with no rounding drift.
  const selectable = useMemo(() => {
    if (!receipt || lines.length === 0) return false;
    const totalCents = lines.reduce((sum, line) => sum + Math.round(line.total * 100), 0);
    return totalCents === Math.round(receipt.totalAmount * 100);
  }, [receipt, lines]);

  const selectedSum = useMemo(() => sumLineTotals(lines, selected), [lines, selected]);
  const partial = useMemo(() => lines.some((line) => line.claimed), [lines]);

  const openPreview = (
    parsed: ParsedReceipt,
    newLines: SelectableReceiptLine[],
    fromDb: boolean,
  ) => {
    // Compute eligibility against the incoming values (state lands next render).
    const totalCents = newLines.reduce((sum, line) => sum + Math.round(line.total * 100), 0);
    const eligible = newLines.length > 0 && totalCents === Math.round(parsed.totalAmount * 100);
    const hasClaims = newLines.some((line) => line.claimed);
    if (hasClaims) categoryTouched.current = true;
    setReceipt(parsed);
    setLines(newLines);
    setSelected(new Set(eligible ? newLines.filter((l) => !l.claimed).map((l) => l.idx) : []));
    setDbSourced(fromDb);
    setSaveError(null);
    setMode("preview");
  };

  const runImport = async (url: string) => {
    setCaptureError(null);
    setMode("loading");
    // FAST PATH straight from the DB (RLS read), before spending an Edge call:
    // a receipt we already stored renders its preview from receipt_items -
    // free lines selectable, claimed ones disabled. Fully claimed → the
    // "već dodat" dialog. The save RPC stays the backstop for races.
    if (familyId) {
      try {
        const known = await fetchReceiptByUrl(url);
        if (known) {
          const free = known.lines.filter((line) => !line.expense_id);
          const hasClaims = free.length < known.lines.length || known.expenses.length > 0;
          const storedCents = known.lines.reduce(
            (sum, line) => sum + Math.round(line.total * 100),
            0,
          );
          const sumOk = storedCents === Math.round(known.receipt.total_amount * 100);

          if (hasClaims && free.length > 0 && sumOk) {
            openPreview(parsedFromStored(known.receipt), linesFromStored(known), true);
            return;
          }
          if (hasClaims) {
            setDuplicateMonth(known.expenses[0]?.spent_on.slice(0, 7) ?? null);
            setMode("duplicate");
            return;
          }
          if (known.lines.length > 0) {
            // Orphan (its expenses were deleted): re-claimable as-is, no Edge call.
            openPreview(parsedFromStored(known.receipt), linesFromStored(known), true);
            return;
          }
          // Orphan without lines - fall through to a fresh parse (better data).
        } else {
          // Straggler guard: an expense saved by a pre-receipts client holds
          // this URL without a receipts row.
          const existing = await fetchExpenseByReceiptUrl(familyId, url);
          if (existing) {
            setDuplicateMonth(existing.spent_on.slice(0, 7));
            setMode("duplicate");
            return;
          }
        }
      } catch {
        // Fast path failed - proceed with the normal import path.
      }
    }
    importReceipt.mutate(url, {
      onSuccess: (data) => {
        openPreview(
          data,
          data.items.map((it, idx) => ({
            idx,
            name: it.name,
            quantity: it.quantity,
            total: it.total,
          })),
          false,
        );
      },
      onError: (err: Error) => {
        setCaptureError(err.message || "Nismo mogli da učitamo račun.");
        setMode("capture");
      },
    });
  };

  const handlePaste = () => {
    const value = pasteValue.trim();
    if (!isSufReceiptUrl(value)) {
      setPasteError("Nalepi ispravan link sa suf.purs.gov.rs.");
      return;
    }
    setPasteError(null);
    void runImport(value);
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setUploadError(null);
    setUploadBusy(true);
    try {
      const decoded = await decodeQrFromFile(file);
      if (!decoded || !isSufReceiptUrl(decoded)) {
        setUploadError("Nismo našli QR kod fiskalnog računa na slici.");
        return;
      }
      await runImport(decoded);
    } catch {
      setUploadError("Nismo mogli da pročitamo sliku.");
    } finally {
      setUploadBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // A lost claim race rolled the save back: re-read the claims so the preview
  // shows who took what, and drop the stolen lines from the selection.
  const refreshClaims = async () => {
    if (!receipt) return;
    try {
      const known = await fetchReceiptByUrl(receipt.receiptUrl);
      if (!known) return;
      const fresh = linesFromStored(known);
      setLines(fresh);
      setSelected(
        (prev) =>
          new Set([...prev].filter((idx) => fresh.some((l) => l.idx === idx && !l.claimed))),
      );
      setDbSourced(true);
      if (fresh.length > 0 && fresh.every((l) => l.claimed)) {
        setDuplicateMonth(known.expenses[0]?.spent_on.slice(0, 7) ?? null);
        setMode("duplicate");
      }
    } catch {
      // Keep the stale view; the save RPC still guards the retry.
    }
  };

  // The two save errors that aren't just "show the message": a receipt that
  // is already fully claimed jumps to the duplicate arm, a lost claim race
  // re-reads the claims so the user can retry against the truth.
  const handleSaveError = async (err: Error) => {
    if (err instanceof DuplicateReceiptError) {
      let month: string | null = null;
      if (familyId) {
        const existing = await fetchExpenseByReceiptUrl(familyId, err.receiptUrl);
        month = existing?.spent_on.slice(0, 7) ?? null;
      }
      setDuplicateMonth(month);
      setMode("duplicate");
      return;
    }
    if (err instanceof ClaimConflictError) {
      await refreshClaims();
      setSaveError(err.message);
      return;
    }
    setSaveError(err.message || "Greška pri čuvanju računa.");
  };

  // Attach mode: the receipt lands on the expense that is already there. No
  // chain step - the leftover lines stay free on the receipt and a later scan
  // still offers them, but the member came here to fix ONE row.
  const handleAttach = () => {
    if (!receipt || !attachTo) return;
    setSaveError(null);
    attachReceipt.mutate(
      {
        expenseId: attachTo.id,
        merchant: receipt.merchant,
        receipt_url: receipt.receiptUrl,
        total_amount: receipt.totalAmount,
        issued_on: receipt.issuedAt.slice(0, 10),
        pib: receipt.pib,
        company_name: receipt.companyName,
        store_name: receipt.storeName,
        // The RPC already stores this receipt's lines on the fast path.
        items: dbSourced ? [] : receipt.items,
        claim_idxs: selectable ? [...selected].sort((a, b) => a - b) : null,
      },
      {
        onSuccess: () => {
          toast.success("Račun je povezan sa troškom");
          onOpenChange(false);
        },
        onError: (err: Error) => void handleSaveError(err),
      },
    );
  };

  const handleSave = () => {
    if (attachMode) {
      handleAttach();
      return;
    }
    if (!receipt) return;
    setSaveError(null);
    const claimIdxs = selectable ? [...selected].sort((a, b) => a - b) : null;
    const amount = selectable ? Math.round(selectedSum * 100) / 100 : receipt.totalAmount;
    saveReceipt.mutate(
      {
        amount,
        spent_on: receipt.issuedAt.slice(0, 10),
        merchant: receipt.merchant,
        receipt_url: receipt.receiptUrl,
        total_amount: receipt.totalAmount,
        pib: receipt.pib,
        company_name: receipt.companyName,
        store_name: receipt.storeName,
        category_id: categoryId,
        person_id: personId,
        note: note.trim() || null,
        activity_id: link?.kind === "activity" ? link.id : null,
        event_id: link?.kind === "event" ? link.id : null,
        // The RPC already stores this receipt's lines on the fast path.
        items: dbSourced ? [] : receipt.items,
        claim_idxs: claimIdxs,
      },
      {
        onSuccess: () => {
          toast.success("Trošak je sačuvan");
          const remaining = selectable
            ? lines.filter((l) => !l.claimed && !selected.has(l.idx))
            : [];
          if (remaining.length === 0) {
            onOpenChange(false);
            return;
          }
          // Offer the leftover lines as a new expense right away - the user
          // is holding the receipt NOW. Mark the just-saved lines as claimed
          // by the category they went under.
          setLines((prev) =>
            prev.map((l) =>
              selected.has(l.idx) ? { ...l, claimed: true, claimedCategoryId: categoryId } : l,
            ),
          );
          setChainInfo({
            count: remaining.length,
            sum: sumLineTotals(remaining, new Set(remaining.map((r) => r.idx))),
          });
          setDbSourced(true);
          setMode("chain");
        },
        onError: (err: Error) => void handleSaveError(err),
      },
    );
  };

  // "Dodaj ostatak kao novi trošak": same receipt, remaining free lines
  // preselected, fresh category/person/note (the remainder is a different
  // bucket by definition - that's why it's being split). The link falls back
  // to the seed: a scan started from an activity is still about that activity,
  // a manual pick was about the part just saved.
  const handleChainContinue = () => {
    setSelected(new Set(lines.filter((l) => !l.claimed).map((l) => l.idx)));
    setCategoryId(null);
    categoryTouched.current = true;
    setPersonId(null);
    setNote("");
    setLink(seedLinkRef.current);
    setSaveError(null);
    setChainInfo(null);
    setMode("preview");
  };

  const title =
    mode === "preview"
      ? "Pregled računa"
      : mode === "duplicate"
        ? "Račun je već dodat"
        : mode === "chain"
          ? "Sačuvano"
          : attachMode
            ? "Poveži račun"
            : "Skeniraj račun";

  return (
    <SheetStackViews
      stack={stack}
      render={(view) => (
        <ResponsiveDialogContent className="sm:max-w-md">
          {/* Preview renders its own header (it drives its own sub-view stack);
            every other mode gets the plain dialog header here. */}
          {mode !== "preview" ? (
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
              <ResponsiveDialogDescription className="sr-only">
                Skeniraj QR kod fiskalnog računa da uvezeš trošak.
              </ResponsiveDialogDescription>
            </ResponsiveDialogHeader>
          ) : null}

          {mode === "capture" ? (
            <div className="space-y-4">
              {/* Only mount the camera while open, so closing releases it. */}
              {open ? <ReceiptCamera onDecode={runImport} /> : null}

              {captureError ? (
                <div className="flex items-start gap-2 rounded-xl bg-neg-soft p-3 text-sm font-normal text-neg">
                  <ExclamationTriangleIcon className="mt-0.5 size-4 shrink-0" />
                  <span>{captureError}</span>
                </div>
              ) : null}

              <div className="flex items-center gap-3 text-xs font-semibold text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                ili
                <span className="h-px flex-1 bg-border" />
              </div>

              {/* Paste link fallback. */}
              <div className="space-y-2">
                <Label htmlFor="receipt-url">Nalepi link sa računa</Label>
                <div className="flex gap-2">
                  <Input
                    id="receipt-url"
                    value={pasteValue}
                    onChange={(e) => {
                      setPasteValue(e.target.value);
                      if (pasteError) setPasteError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handlePaste();
                      }
                    }}
                    inputMode="url"
                    placeholder="https://suf.purs.gov.rs/v/?vl=…"
                    aria-invalid={!!pasteError}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handlePaste}
                    disabled={!pasteValue.trim()}
                  >
                    Učitaj
                  </Button>
                </div>
                {pasteError ? <p className="text-xs font-normal text-neg">{pasteError}</p> : null}
              </div>

              {/* Upload image fallback. */}
              <div className="space-y-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void handleFile(e.target.files?.[0])}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={uploadBusy}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ArrowUpTrayIcon className="size-4" />
                  {uploadBusy ? "Čitam sliku…" : "Otpremi sliku"}
                </Button>
                {uploadError ? <p className="text-xs font-normal text-neg">{uploadError}</p> : null}
              </div>
            </div>
          ) : null}

          {mode === "loading" ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12">
              <span
                className="size-8 animate-spin rounded-full border-2 border-border border-t-accent"
                aria-hidden="true"
              />
              <p className="text-sm text-muted-foreground">Učitavam račun…</p>
            </div>
          ) : null}

          {mode === "preview" && receipt ? (
            <ReceiptPreview
              receipt={receipt}
              lines={lines}
              selectable={selectable}
              selected={selected}
              onToggleLine={(idx) => {
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (next.has(idx)) next.delete(idx);
                  else next.add(idx);
                  return next;
                });
              }}
              onSetAllLines={(select) => {
                setSelected(
                  select ? new Set(lines.filter((l) => !l.claimed).map((l) => l.idx)) : new Set(),
                );
              }}
              selectedSum={selectedSum}
              partial={partial}
              attachMode={attachMode}
              saving={saving}
              error={saveError}
              view={view}
              onOpenView={push}
              onBack={pop}
              categoryId={categoryId}
              onCategoryChange={(id) => {
                categoryTouched.current = true;
                setCategoryId(id);
              }}
              personId={personId}
              onPersonChange={setPersonId}
              note={note}
              onNoteChange={setNote}
              link={link}
              onLinkChange={setLink}
              onCancel={() => onOpenChange(false)}
              onSave={handleSave}
            />
          ) : null}

          {mode === "chain" && chainInfo ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Trošak je sačuvan. Na računu je preostalo još {chainInfo.count}{" "}
                {stavkeLabel(chainInfo.count)} (<Amount value={chainInfo.sum} />) - želiš li da ih
                dodaš kao poseban trošak, npr. u drugoj kategoriji?
              </p>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto rounded-[15px] border-border bg-card py-[13px] text-[15px] font-bold text-muted-foreground"
                  onClick={() => onOpenChange(false)}
                >
                  Završi
                </Button>
                <Button
                  type="button"
                  className="h-auto rounded-[15px] py-[13px] text-[15px] font-bold"
                  onClick={handleChainContinue}
                >
                  Dodaj ostatak kao novi trošak
                </Button>
              </div>
            </div>
          ) : null}

          {mode === "duplicate" ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Ovaj račun je već dodat u budžet. Nećemo ga dodati dvaput.
              </p>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto rounded-[15px] border-border bg-card py-[13px] text-[15px] font-bold text-muted-foreground"
                  onClick={() => onOpenChange(false)}
                >
                  Zatvori
                </Button>
                {duplicateMonth && onJumpToMonth ? (
                  <Button
                    type="button"
                    className="h-auto rounded-[15px] py-[13px] text-[15px] font-bold"
                    onClick={() => {
                      onJumpToMonth(duplicateMonth);
                      onOpenChange(false);
                    }}
                  >
                    Prikaži u budžetu
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </ResponsiveDialogContent>
      )}
    />
  );
}
