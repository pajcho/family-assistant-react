import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { formatDate } from "@/utils/date";

/**
 * Move a single payment occurrence to another date. For a recurring payment
 * this records a per-occurrence override (so the rest of the series stays put)
 * with an optional reason; for a one-time payment it just changes the due date
 * (no reason field, nothing to mark "moved").
 */
export type PaymentRescheduleDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paymentName: string;
  /** Current effective date — prefilled. */
  currentDate: string | null;
  /** Show the optional reason field (recurring occurrences keep an override). */
  showReason?: boolean;
  /** Latest selectable date — the next occurrence (don't move past it). */
  maxDate?: string | null;
  /** Date to mark on the calendar (the next occurrence). */
  markedDate?: string | null;
  saving?: boolean;
  onSubmit: (date: string, reason: string | null) => void;
};

export function PaymentRescheduleDialog({
  open,
  onOpenChange,
  paymentName,
  currentDate,
  showReason = false,
  maxDate,
  markedDate,
  saving,
  onSubmit,
}: PaymentRescheduleDialogProps) {
  const [date, setDate] = useState<string | null>(currentDate);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) {
      setDate(currentDate);
      setReason("");
    }
  }, [open, currentDate]);

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Pomeri ratu</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            „{paymentName}" — novi datum dospeća
            {showReason ? " (pomera se samo ova rata)" : ""}.
          </p>
          <div className="space-y-2">
            <Label htmlFor="payment-reschedule-date">Novi datum</Label>
            <DatePicker
              id="payment-reschedule-date"
              value={date}
              onChange={setDate}
              placeholder="Izaberi datum"
              maxDate={maxDate}
              markedDate={markedDate}
            />
            {markedDate && maxDate ? (
              <p className="text-[11px] text-muted-foreground">
                Najkasnije {formatDate(maxDate)} — dan pre sledeće uplate ({formatDate(markedDate)}
                ).
              </p>
            ) : null}
          </div>
          {showReason ? (
            <div className="space-y-2">
              <Label htmlFor="payment-reschedule-reason">Razlog (opciono)</Label>
              <Textarea
                id="payment-reschedule-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="npr. plata kasni ovaj mesec"
                rows={2}
              />
            </div>
          ) : null}
        </div>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Odustani
          </Button>
          <Button
            disabled={saving || !date || date === currentDate}
            onClick={() => {
              if (date) onSubmit(date, reason.trim() || null);
            }}
          >
            Pomeri
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
