import { ArrowUturnLeftIcon } from "@heroicons/react/24/outline";

import { cn } from "@/lib/cn";

/**
 * "Vrati na sada" pilula - zajednička za sve vremenske navigatore (vremenske
 * trake, redizajn 2.0): Novac i Mesec se vraćaju na tekući mesec, nedeljne
 * trake na danas / ovu sedmicu. Renderuje se SAMO dok je korisnik odlutao od
 * "sada", pa je hrom u mirovanju čist - zato ne nosi sopstveno "hidden" stanje.
 *
 * Vizuelno 28px pilula, ali je dodirna meta uvećana providnim pseudo-elementom
 * (isti trik kao FilterChip) da prst ne mora da cilja.
 */
export function NowPill({
  label,
  onClick,
  className,
  "aria-label": ariaLabel,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel ?? label}
      className={cn(
        "relative flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5",
        "border border-accent/30 bg-accent-soft text-xs font-semibold whitespace-nowrap text-accent-deep",
        "transition-colors after:absolute after:inset-x-0 after:-inset-y-2 after:content-['']",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        className,
      )}
    >
      <ArrowUturnLeftIcon className="size-3 shrink-0" aria-hidden="true" />
      {label}
    </button>
  );
}
