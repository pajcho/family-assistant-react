import { useState } from "react";
import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ResponsiveDialogFooter } from "@/components/ui/responsive-dialog";
import {
  KID_PIN_ERROR_TEXT,
  KID_PIN_MAX_LENGTH,
  validateKidPin,
  type KidPinError,
} from "@/components/family/KidAccessCopy";
import { KID_PIN_LENGTHS } from "@/types/kid";

/**
 * "Type the PIN twice" form, shared by first setup and a later PIN change.
 *
 * Built for one hand on a phone: two tall fields with big, widely tracked
 * digits, a numeric keypad (`inputMode`), and everything else - description,
 * error, buttons - stacked in a single column so nothing needs a second thumb.
 * Non-digits are stripped as you type, so the field can never hold something
 * the server would reject.
 *
 * The digits stay VISIBLE on purpose: the parent is choosing a PIN for someone
 * else and has to be able to read it back to them.
 */

const MIN_PIN_LENGTH = Math.min(...KID_PIN_LENGTHS);

export type KidAccessPinFormProps = {
  /** Unique per instance - the two fields need stable, distinct ids. */
  idPrefix: string;
  description: string;
  submitLabel: string;
  pendingLabel: string;
  isPending: boolean;
  onCancel: () => void;
  onSubmit: (pin: string) => void;
};

function onlyDigits(value: string): string {
  return value.replace(/\D/g, "").slice(0, KID_PIN_MAX_LENGTH);
}

const PIN_INPUT_CLASS =
  "h-14 text-center text-2xl font-semibold tracking-[0.35em] indent-[0.35em] tabular-nums";

export function KidAccessPinForm({
  idPrefix,
  description,
  submitLabel,
  pendingLabel,
  isPending,
  onCancel,
  onSubmit,
}: KidAccessPinFormProps) {
  const [pin, setPin] = useState("");
  const [confirmation, setConfirmation] = useState("");
  // Errors stay quiet until the parent has actually tried - shouting "too
  // short" at someone who has typed two of four digits is just noise.
  const [attempted, setAttempted] = useState(false);

  const error = validateKidPin(pin, confirmation);
  // The one exception: a mismatch is worth flagging the moment the second
  // field is as long as the first, before they reach for the button.
  const showMismatchEarly =
    error === "mismatch" && confirmation.length >= pin.length && pin.length >= MIN_PIN_LENGTH;
  const visibleError: KidPinError = attempted || showMismatchEarly ? error : null;

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setAttempted(true);
    if (error) return;
    onSubmit(pin);
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm font-normal text-muted-foreground">{description}</p>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-pin`}>PIN</Label>
          <Input
            id={`${idPrefix}-pin`}
            value={pin}
            onChange={(e) => setPin(onlyDigits(e.target.value))}
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            maxLength={KID_PIN_MAX_LENGTH}
            aria-invalid={visibleError === "format" || visibleError === "weak"}
            className={PIN_INPUT_CLASS}
            autoFocus
          />
          <p className="text-xs font-normal text-muted-foreground">
            {KID_PIN_LENGTHS.join(" ili ")} cifara. Dete ga kuca pri svakoj prijavi - neka bude lako
            za pamćenje, ali ne 1234.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-pin-confirm`}>Ponovi PIN</Label>
          <Input
            id={`${idPrefix}-pin-confirm`}
            value={confirmation}
            onChange={(e) => setConfirmation(onlyDigits(e.target.value))}
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            maxLength={KID_PIN_MAX_LENGTH}
            aria-invalid={visibleError === "mismatch"}
            className={PIN_INPUT_CLASS}
          />
        </div>
      </div>

      {visibleError ? (
        <p role="alert" className="text-sm font-normal text-destructive">
          {KID_PIN_ERROR_TEXT[visibleError]}
        </p>
      ) : null}

      <ResponsiveDialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
          Odustani
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? pendingLabel : submitLabel}
        </Button>
      </ResponsiveDialogFooter>
    </form>
  );
}
