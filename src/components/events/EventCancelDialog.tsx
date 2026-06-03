import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import type { Event } from "@/types/database";

/**
 * Confirmation before canceling an event, with an OPTIONAL free-text reason.
 * Canceling is a soft delete (sets `canceled_at` + `cancel_reason`) — the
 * event leaves the dashboard but stays for the calendar. The same shape will
 * back payment cancellation in Phase 2.
 */
export type EventCancelDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: Event | null;
  saving?: boolean;
  onConfirm: (reason: string | null) => void;
};

export function EventCancelDialog({
  open,
  onOpenChange,
  event,
  saving,
  onConfirm,
}: EventCancelDialogProps) {
  const [reason, setReason] = useState("");

  // Start blank each time the dialog opens for a (possibly different) event.
  useEffect(() => {
    if (open) setReason("");
  }, [open, event?.id]);

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Otkaži događaj</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Otkazati „{event?.name ?? ""}"? Neće se prikazivati na kontrolnoj tabli, ali ostaje u
            kalendaru. Možeš ga kasnije vratiti.
          </p>
          <div className="space-y-2">
            <Label htmlFor="cancel-reason">Razlog (opciono)</Label>
            <Textarea
              id="cancel-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="npr. otkazano zbog kiše"
              rows={3}
            />
          </div>
        </div>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Odustani
          </Button>
          <Button
            variant="destructive"
            disabled={saving}
            onClick={() => onConfirm(reason.trim() || null)}
          >
            Otkaži događaj
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
