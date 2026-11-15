import type { ChangeEvent, ClipboardEvent } from "react";

import { editAmountInput, formatAmountInput } from "@/utils/currency";

/**
 * Props for a money input that shows its amount grouped ("1.234,56") while the
 * form keeps the raw value ("1234,56", what `parseDecimal` reads). Spread them
 * onto any `<input>`; `value` and `onChange` speak the raw value.
 *
 * The grouping dots are display only: copying or cutting puts the number on
 * the clipboard without them, and a pasted amount is read in whichever
 * convention it was written ({@link editAmountInput} owns the rules).
 *
 * Each edit writes the formatted text and caret to the element straight away,
 * so React's re-render finds the DOM already matching and leaves the caret
 * where the member was typing. No React state of its own, so it can be called
 * inline in JSX.
 */
export function amountInputProps(value: string, onChange: (value: string) => void) {
  const display = formatAmountInput(value);

  const apply = (
    input: HTMLInputElement,
    start: number,
    end: number,
    inserted: string,
    inputType?: string,
  ) => {
    const next = editAmountInput(display, start, end, inserted, inputType);
    input.value = next.display;
    input.setSelectionRange(next.caret, next.caret);
    if (next.value !== value) onChange(next.value);
  };

  const copySelection = (e: ClipboardEvent<HTMLInputElement>) => {
    const { selectionStart: start, selectionEnd: end } = e.currentTarget;
    if (start == null || end == null || start === end) return null;
    e.preventDefault();
    e.clipboardData.setData("text/plain", display.slice(start, end).replace(/\./g, ""));
    return { start, end };
  };

  return {
    value: display,
    inputMode: "decimal" as const,
    autoComplete: "off",
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      const input = e.currentTarget;
      const next = input.value;
      const caret = input.selectionEnd ?? next.length;
      // Recover the edit from the text around the caret: what follows the
      // caret is untouched, what precedes it differs from the old text only
      // in the part that was just typed over.
      const kept = Math.min(next.length - caret, display.length);
      if (next.slice(next.length - kept) !== display.slice(display.length - kept)) {
        apply(input, 0, display.length, next);
        return;
      }
      const end = display.length - kept;
      let start = 0;
      while (start < Math.min(caret, end) && display[start] === next[start]) start++;
      const inputType = (e.nativeEvent as InputEvent).inputType;
      apply(input, start, end, next.slice(start, caret), inputType);
    },
    onPaste: (e: ClipboardEvent<HTMLInputElement>) => {
      const input = e.currentTarget;
      e.preventDefault();
      const text = e.clipboardData.getData("text/plain");
      apply(input, input.selectionStart ?? 0, input.selectionEnd ?? 0, text, "insertFromPaste");
    },
    onCopy: (e: ClipboardEvent<HTMLInputElement>) => {
      copySelection(e);
    },
    onCut: (e: ClipboardEvent<HTMLInputElement>) => {
      const range = copySelection(e);
      if (range) apply(e.currentTarget, range.start, range.end, "", "deleteByCut");
    },
  };
}
