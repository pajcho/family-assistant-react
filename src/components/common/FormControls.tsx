import type { ComponentProps, ComponentType, ReactNode, SVGProps } from "react";

import { cn } from "@/lib/cn";

/**
 * The redesign's shared form vocabulary ("Šljiva"): every entry form is built
 * out of these pieces, so a chip in the expense form and a chip in the payment
 * form are literally the same element. Semantic tokens only, never raw palette
 * classes.
 *
 * Sizing rules baked in on purpose:
 *   - every text input is >=16px so iOS never zooms on focus;
 *   - every tappable control is >=44px tall (`min-h-11`);
 *   - amounts and times are `tabular-nums`, currency is a CODE (RSD), never a
 *     symbol.
 */

/** Section header above a chip row / grid (".gh" in the prototype). */
export function FieldGroupLabel({ children, className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "mt-1 mb-2 flex items-center gap-2 px-0.5 text-[11px] font-bold tracking-[0.08em] text-muted-foreground uppercase",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/** Quiet explanatory line under a field group (".secfoot"). */
export function FieldHint({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("px-0.5 pt-1 text-xs leading-relaxed text-muted-foreground", className)}>
      {children}
    </p>
  );
}

export type ChipProps = Omit<ComponentProps<"button">, "children"> & {
  selected?: boolean;
  children: ReactNode;
  /** Secondary text rendered dimmer on the same line ("Danas pon 5."). */
  hint?: ReactNode;
  /** Stretch to fill its flex/grid track (minute chips, hour grid). */
  grow?: boolean;
};

/**
 * The one chip (".qbtn"). Selection is announced with `aria-pressed`, not
 * colour alone.
 */
export function Chip({ selected = false, children, hint, grow, className, ...props }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md border px-3.5 py-2 text-[13px] font-semibold transition-colors",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none",
        "disabled:pointer-events-none disabled:opacity-50",
        grow && "flex-1",
        selected
          ? "border-accent bg-accent-soft text-accent-deep"
          : "border-border bg-card text-muted-foreground hover:bg-muted",
        className,
      )}
      {...props}
    >
      <span className="truncate">{children}</span>
      {hint ? <span className="text-[11px] font-medium opacity-70">{hint}</span> : null}
    </button>
  );
}

/** Wrapping row of chips (".qrow"). */
export function ChipRow({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-wrap gap-1.5", className)} {...props} />;
}

/** Single-select chip row driven by a value list - the app's radio pattern. */
export function ChipSelect<T extends string | number | null>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; label: string; hint?: string }>;
  ariaLabel?: string;
}) {
  return (
    <ChipRow role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <Chip
          key={String(option.value)}
          selected={value === option.value}
          hint={option.hint}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Chip>
      ))}
    </ChipRow>
  );
}

/** Icon + label tile in the 4-column category grid (".cat"). */
export function Tile({
  icon: Icon,
  iconColor,
  label,
  selected = false,
  onClick,
  ...props
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  iconColor?: string;
  label: string;
  selected?: boolean;
  onClick: () => void;
} & Omit<ComponentProps<"button">, "onClick">) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "flex min-h-11 flex-col items-center gap-1.5 rounded-lg border px-1.5 py-2.5 text-center transition-colors",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none",
        selected
          ? "border-accent bg-accent-soft text-accent-deep"
          : "border-border bg-card text-muted-foreground hover:bg-muted",
      )}
      {...props}
    >
      <Icon className="size-5 shrink-0" style={iconColor ? { color: iconColor } : undefined} />
      <span className="w-full truncate text-[11px] leading-tight font-semibold">{label}</span>
    </button>
  );
}

/** 4-column tile grid (".catgrid"). */
export function TileGrid({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("grid grid-cols-4 gap-1.5", className)} {...props} />;
}

/**
 * Text input in form chrome (".finp"). `text-base` on every breakpoint is
 * deliberate: 16px is the threshold below which iOS Safari zooms the page on
 * focus, and a zoomed sheet is the single worst thing that can happen to a
 * mobile form.
 */
export function FormInput({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "min-h-11 w-full rounded-lg border border-border bg-card px-3.5 py-2.5 text-base font-medium text-foreground transition-colors",
        "placeholder:font-normal placeholder:text-muted-foreground",
        "focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

/** Multi-line sibling of {@link FormInput}. */
export function FormTextarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "min-h-20 w-full rounded-lg border border-border bg-card px-3.5 py-2.5 text-base font-medium text-foreground transition-colors",
        "placeholder:font-normal placeholder:text-muted-foreground",
        "focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The big centred value card at the top of a form (".fbig") - amount, scanned
 * receipt total, picked time. `children` is the value; `footer` carries the
 * conversion line or the currency segment.
 */
export function BigValueCard({
  label,
  children,
  footer,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card p-3.5 text-center shadow-card",
        className,
      )}
    >
      <div className="text-[11px] font-bold tracking-[0.07em] text-muted-foreground uppercase">
        {label}
      </div>
      <div className="mt-1 text-3xl font-extrabold tracking-tight tabular-nums">{children}</div>
      {footer}
    </div>
  );
}

/** Toggle row with an icon, label, optional sub-label and a control (".swrow2"). */
export function ControlRow({
  icon: Icon,
  label,
  description,
  control,
  className,
}: {
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  label: ReactNode;
  description?: ReactNode;
  control: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-11 items-center gap-2.5 rounded-lg border border-border bg-card px-3.5 py-2.5",
        className,
      )}
    >
      {Icon ? (
        <Icon className="size-[17px] shrink-0 text-muted-foreground" aria-hidden="true" />
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{label}</div>
        {description ? (
          <div className="text-[11.5px] leading-snug text-muted-foreground">{description}</div>
        ) : null}
      </div>
      {control}
    </div>
  );
}

/** Pill segmented control - currency codes, small either/or choices (".curseg"). */
export function SegmentedPills<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<T> | ReadonlyArray<{ value: T; label: string }>;
  ariaLabel: string;
  className?: string;
}) {
  const normalized = options.map((option) =>
    typeof option === "string" ? { value: option, label: option } : option,
  ) as ReadonlyArray<{ value: T; label: string }>;
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn("flex justify-center gap-1.5", className)}
    >
      {normalized.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "min-h-9 rounded-full border px-3.5 py-1 text-xs font-bold tracking-wide transition-colors",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            value === option.value
              ? "border-accent bg-accent text-accent-foreground"
              : "border-border text-muted-foreground hover:bg-muted",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
