/**
 * Native <select> with the app's Input-matching chrome and a custom caret.
 * Extracted from PaymentForm so the Brzi unos sub-sheets can reuse it;
 * ActivityForm still carries its own copy (migrates with its own redesign).
 */

/** Tailwind chrome that matches `<Input>` - shared by the native selects. */
export const SELECT_CHROME =
  "h-9 w-full min-w-0 cursor-pointer appearance-none rounded-md border border-input bg-transparent pr-9 pl-3 text-base shadow-xs outline-none transition-[color,box-shadow] md:text-sm dark:bg-input/30 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50";

export function NativeSelect<T extends string | number>({
  id,
  value,
  onChange,
  options,
  disabled,
  parse,
}: {
  id?: string;
  value: T;
  onChange: (next: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
  disabled?: boolean;
  parse: (raw: string) => T;
}) {
  return (
    <div className="relative">
      <select
        id={id}
        value={String(value)}
        onChange={(e) => onChange(parse(e.target.value))}
        disabled={disabled}
        className={SELECT_CHROME}
      >
        {options.map((opt) => (
          <option key={String(opt.value)} value={String(opt.value)}>
            {opt.label}
          </option>
        ))}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground opacity-60"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  );
}
