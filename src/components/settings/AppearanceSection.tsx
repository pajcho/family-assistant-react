import { ComputerDesktopIcon, MoonIcon, SunIcon, SwatchIcon } from "@heroicons/react/24/outline";
import { CheckIcon } from "@heroicons/react/24/solid";

import { cn } from "@/lib/cn";
import { ACCENT_OPTIONS, useAccent, type AccentKey } from "@/hooks/useAccent";
import { useTheme, type ThemeMode } from "@/hooks/useTheme";

/**
 * "Izgled" + "Boja aplikacije" - the two rows of the Aplikacija group that
 * carry their control inline instead of pushing to a sub-screen.
 *
 * The accent is per user and applies everywhere INSIDE the app; the brand
 * outside it (login mark, PWA icon, splash) stays blue on purpose, which the
 * hint under the picker says out loud.
 */

const THEME_OPTIONS: ReadonlyArray<{ value: ThemeMode; label: string; icon: typeof SunIcon }> = [
  { value: "light", label: "Svetla", icon: SunIcon },
  { value: "dark", label: "Tamna", icon: MoonIcon },
  { value: "auto", label: "Auto", icon: ComputerDesktopIcon },
];

export function ThemeRow() {
  const { mode, setMode } = useTheme();

  return (
    <div className="flex min-h-[52px] flex-wrap items-center gap-x-[11px] gap-y-2 border-b border-border px-[13px] py-3 last:border-b-0">
      <span className="grid size-[34px] shrink-0 place-items-center rounded-[11px] bg-accent-soft text-accent-deep">
        <MoonIcon className="size-[17px]" />
      </span>
      <span className="flex-1 text-[14.5px] font-bold">Izgled</span>
      <div
        role="radiogroup"
        aria-label="Tema"
        className="flex gap-0.5 rounded-md border border-border bg-background p-[3px]"
      >
        {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            onClick={() => setMode(value)}
            className={cn(
              "flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-[13px] font-bold transition-colors",
              mode === value ? "bg-accent-soft text-accent-deep" : "text-muted-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AccentRow() {
  const { accent, setAccent } = useAccent();

  return (
    <div className="border-b border-border px-[13px] py-3 last:border-b-0">
      <div className="flex items-center gap-[11px]">
        <span className="grid size-[34px] shrink-0 place-items-center rounded-[11px] bg-accent-soft text-accent-deep">
          <SwatchIcon className="size-[17px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14.5px] font-bold">Boja aplikacije</span>
          <span className="mt-px block text-xs font-semibold text-muted-foreground">
            Lični akcenat - važi samo za tebe, na svim uređajima.
          </span>
        </span>
      </div>
      <div
        role="radiogroup"
        aria-label="Boja aplikacije"
        className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4"
      >
        {ACCENT_OPTIONS.map((option) => (
          <AccentSwatch
            key={option.key}
            optionKey={option.key}
            label={option.label}
            swatch={option.swatch}
            selected={accent === option.key}
            onSelect={() => setAccent(option.key)}
          />
        ))}
      </div>
      <p className="mt-2.5 text-xs font-semibold text-muted-foreground">
        Prijava i ikonica aplikacije ostaju plavi.
      </p>
    </div>
  );
}

function AccentSwatch({
  optionKey,
  label,
  swatch,
  selected,
  onSelect,
}: {
  optionKey: AccentKey;
  label: string;
  swatch: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      data-accent-option={optionKey}
      className={cn(
        "flex min-h-11 items-center gap-2 rounded-md border px-2.5 py-2 text-[13px] font-bold transition-colors",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        selected ? "border-accent bg-accent-soft text-accent-deep" : "border-border",
      )}
    >
      <span
        className="grid size-5 shrink-0 place-items-center rounded-full"
        style={{ backgroundColor: swatch }}
        aria-hidden="true"
      >
        {selected ? <CheckIcon className="size-3.5 text-white" /> : null}
      </span>
      {label}
    </button>
  );
}
