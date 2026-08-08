import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";

import { KID_PIN_LENGTHS, isValidKidPin } from "@/types/kid";

/**
 * The PIN keypad - the only text entry in the whole kid shell.
 *
 * A real keypad instead of a text field, for three reasons: the targets can be
 * finger-sized (68px), a child never sees a keyboard cover half the screen, and
 * there is no autocomplete, autocorrect or password manager to fight. A PIN is
 * 4 or 6 digits, so six slots are shown with the last two dimmed until they are
 * needed.
 *
 * Physical keyboards still work (digits, Backspace, Enter) - it is the same
 * screen on a laptop.
 */

const MAX_PIN_LENGTH = Math.max(...KID_PIN_LENGTHS);
const MIN_PIN_LENGTH = Math.min(...KID_PIN_LENGTHS);

const KEYS: readonly string[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

export function KidPinPad({
  value,
  onChange,
  onSubmit,
  disabled = false,
  submitLabel = "Uđi 🚀",
  busy = false,
}: {
  value: string;
  /**
   * The state setter itself, not a plain callback: a child mashing the keypad
   * can land two taps in one React batch, and `onChange(value + digit)` would
   * then drop one because both reads saw the same stale `value`.
   */
  onChange: Dispatch<SetStateAction<string>>;
  onSubmit: () => void;
  disabled?: boolean;
  submitLabel?: string;
  busy?: boolean;
}) {
  const canSubmit = !disabled && !busy && isValidKidPin(value);

  function press(digit: string) {
    if (disabled || busy) return;
    onChange((prev) => (prev.length >= MAX_PIN_LENGTH ? prev : prev + digit));
  }

  function backspace() {
    if (disabled || busy) return;
    onChange((prev) => prev.slice(0, -1));
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (disabled || busy) return;
      if (event.key === "Backspace") {
        event.preventDefault();
        onChange((prev) => prev.slice(0, -1));
        return;
      }
      if (event.key === "Enter") {
        if (isValidKidPin(value)) onSubmit();
        return;
      }
      if (/^\d$/.test(event.key)) {
        onChange((prev) => (prev.length >= MAX_PIN_LENGTH ? prev : prev + event.key));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [value, onChange, onSubmit, disabled, busy]);

  return (
    <div className="w-full max-w-[300px]">
      {/* Slots. `aria-label` carries the count so a screen reader hears
          progress without the digits ever being spoken aloud. */}
      <div
        role="status"
        aria-label={`Uneto ${value.length} od ${MIN_PIN_LENGTH} ili ${MAX_PIN_LENGTH} brojeva`}
        className="flex justify-center gap-2.5"
      >
        {Array.from({ length: MAX_PIN_LENGTH }, (_, index) => {
          const filled = index < value.length;
          const optional = index >= MIN_PIN_LENGTH;
          return (
            <span
              key={index}
              aria-hidden="true"
              className={`size-3.5 rounded-full border-2 border-white transition-colors ${
                filled ? "bg-white" : "bg-transparent"
              } ${optional && !filled ? "opacity-40" : ""}`}
            />
          );
        })}
      </div>
      <p className="mt-2 text-center text-[12px] font-normal text-white/85">
        Tvoj PIN - 4 ili 6 brojeva
      </p>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {KEYS.map((key) => (
          <PinKey key={key} label={key} onPress={() => press(key)} disabled={disabled || busy} />
        ))}
        <span aria-hidden="true" />
        <PinKey label="0" onPress={() => press("0")} disabled={disabled || busy} />
        <PinKey
          label="⌫"
          ariaLabel="Obriši poslednji broj"
          onPress={backspace}
          disabled={disabled || busy || value.length === 0}
          muted
        />
      </div>

      <button
        type="button"
        onClick={onSubmit}
        disabled={!canSubmit}
        className="mt-3 w-full rounded-[18px] bg-white px-4 py-3.5 text-[17px] font-bold text-[var(--k-accent-strong)] shadow-[0_10px_24px_-10px_rgb(0_0_0/0.35)] transition-transform duration-100 not-disabled:active:scale-[0.96] disabled:opacity-55"
      >
        {busy ? "Samo trenutak..." : submitLabel}
      </button>
    </div>
  );
}

function PinKey({
  label,
  ariaLabel,
  onPress,
  disabled,
  muted = false,
}: {
  label: string;
  ariaLabel?: string;
  onPress: () => void;
  disabled: boolean;
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      aria-label={ariaLabel ?? label}
      className={`kid-on-gradient h-[60px] rounded-[20px] text-[25px] font-semibold text-white transition-transform duration-100 not-disabled:active:scale-[0.93] disabled:opacity-40 sm:h-[68px] sm:text-[26px] ${
        muted ? "bg-white/10" : "bg-white/20"
      }`}
    >
      {label}
    </button>
  );
}
