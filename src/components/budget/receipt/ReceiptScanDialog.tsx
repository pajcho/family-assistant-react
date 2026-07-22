import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowUpTrayIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";

import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DuplicateReceiptError,
  fetchExpenseByReceiptUrl,
  useSaveReceiptExpense,
} from "@/hooks/useExpenses";
import { isSufReceiptUrl, type ParsedReceipt, useReceiptImport } from "@/hooks/useReceiptImport";
import { useProfile } from "@/hooks/useProfile";
import { ReceiptCamera } from "./ReceiptCamera";
import { ReceiptPreview, type ReceiptSavePayload } from "./ReceiptPreview";
import { decodeQrFromFile } from "./receiptQr";

/**
 * Lazy-loaded scanner + import + preview flow for a fiscal receipt. Kept as a
 * dynamic-import chunk (see the budget page) so the camera + zxing-wasm never
 * enter the main bundle. State machine:
 *
 *   capture ──decode──▶ loading ──ok──▶ preview ──save──▶ (close)
 *      ▲                   │                 │
 *      └──── error ────────┘                 └── duplicate ──▶ jump to month
 */

type Mode = "capture" | "loading" | "preview" | "duplicate";

export type ReceiptScanDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Jump the budget view to a YYYY-MM (the duplicate "show it" action). */
  onJumpToMonth?: (yyyymm: string) => void;
};

export default function ReceiptScanDialog({
  open,
  onOpenChange,
  onJumpToMonth,
}: ReceiptScanDialogProps) {
  const { familyId } = useProfile();
  const importReceipt = useReceiptImport();
  const saveReceipt = useSaveReceiptExpense();

  const [mode, setMode] = useState<Mode>("capture");
  const [receipt, setReceipt] = useState<ParsedReceipt | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pasteValue, setPasteValue] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [duplicateMonth, setDuplicateMonth] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Reset everything whenever the dialog closes so the next open starts fresh.
  useEffect(() => {
    if (!open) {
      setMode("capture");
      setReceipt(null);
      setCaptureError(null);
      setSaveError(null);
      setPasteValue("");
      setPasteError(null);
      setUploadError(null);
      setUploadBusy(false);
      setDuplicateMonth(null);
    }
  }, [open]);

  const runImport = async (url: string) => {
    setCaptureError(null);
    setMode("loading");
    // Duplicate pre-check straight against the DB (RLS read) BEFORE invoking
    // the Edge Function: a re-scan of an already-imported receipt shows the
    // "već dodat" dialog instantly and never spends an Edge call. The
    // post-parse check below stays as the backstop (races, failed pre-check).
    if (familyId) {
      try {
        const existing = await fetchExpenseByReceiptUrl(familyId, url);
        if (existing) {
          setDuplicateMonth(existing.spent_on.slice(0, 7));
          setMode("duplicate");
          return;
        }
      } catch {
        // Pre-check failed — proceed with the normal import path.
      }
    }
    importReceipt.mutate(url, {
      onSuccess: async (data) => {
        // Recognize an already-imported receipt right after parsing — before the
        // preview — so the user sees "Račun je već dodat" immediately instead of
        // only after tapping Save. Keyed on the SUF receipt_url (unique index).
        // The save-time unique-violation handler below stays as a backstop
        // (covers a race, or a null familyId / failed pre-check here).
        if (familyId) {
          try {
            const existing = await fetchExpenseByReceiptUrl(familyId, data.receiptUrl);
            if (existing) {
              setDuplicateMonth(existing.spent_on.slice(0, 7));
              setMode("duplicate");
              return;
            }
          } catch {
            // Pre-check failed — fall through to the preview; the DB index still guards.
          }
        }
        setReceipt(data);
        setMode("preview");
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

  const handleSave = (payload: ReceiptSavePayload) => {
    if (!receipt) return;
    setSaveError(null);
    saveReceipt.mutate(
      {
        amount: receipt.totalAmount,
        spent_on: receipt.issuedAt.slice(0, 10),
        merchant: receipt.merchant,
        receipt_url: receipt.receiptUrl,
        category_id: payload.category_id,
        person_id: payload.person_id,
        note: payload.note,
        items: receipt.items,
      },
      {
        onSuccess: (res) => {
          // On a partial item-save failure the hook already warns; don't stack
          // a contradictory success toast on top of it.
          if (res.itemsSaved) toast.success("Račun je sačuvan");
          onOpenChange(false);
        },
        onError: async (err: Error) => {
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
          setSaveError(err.message || "Greška pri čuvanju računa.");
        },
      },
    );
  };

  const title =
    mode === "preview"
      ? "Pregled računa"
      : mode === "duplicate"
        ? "Račun je već dodat"
        : "Skeniraj račun";

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
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
              <div className="flex items-start gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
                <ExclamationTriangleIcon className="mt-0.5 size-4 shrink-0" />
                <span>{captureError}</span>
              </div>
            ) : null}

            <div className="flex items-center gap-3 text-xs text-gray-400">
              <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
              ili
              <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
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
              {pasteError ? (
                <p className="text-xs text-red-600 dark:text-red-400">{pasteError}</p>
              ) : null}
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
              {uploadError ? (
                <p className="text-xs text-red-600 dark:text-red-400">{uploadError}</p>
              ) : null}
            </div>
          </div>
        ) : null}

        {mode === "loading" ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12">
            <span
              className="size-8 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600 dark:border-gray-600 dark:border-t-blue-400"
              aria-hidden="true"
            />
            <p className="text-sm text-gray-600 dark:text-gray-300">Učitavam račun…</p>
          </div>
        ) : null}

        {mode === "preview" && receipt ? (
          <ReceiptPreview
            receipt={receipt}
            saving={saveReceipt.isPending}
            error={saveError}
            onCancel={() => onOpenChange(false)}
            onSave={handleSave}
          />
        ) : null}

        {mode === "duplicate" ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Ovaj račun je već dodat u budžet. Nećemo ga dodati dvaput.
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Zatvori
              </Button>
              {duplicateMonth && onJumpToMonth ? (
                <Button
                  type="button"
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
    </ResponsiveDialog>
  );
}
