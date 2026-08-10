/**
 * "A new version shipped" - the kid shell's version of it.
 *
 * The grown-up app says this with a plain sonner toast (see `usePwaUpdate`).
 * That toast is styled by the main app's tokens and worded for a parent
 * (a refresh-the-app prompt), so inside a child's
 * screen it arrives as a grey rectangle from another app, in language aimed
 * over their head. This is the same event in the shell's own clothes.
 *
 * It renders through the `Toaster` in `__root`, which sits OUTSIDE the kid
 * layout - that works because the `--k-*` variables live on `<html>`, so the
 * card picks up whichever theme the child has chosen. Nothing here reads a
 * main-app token, same rule as the rest of `components/kid`.
 *
 * Two actions rather than one: a card a child cannot get rid of, parked over
 * their screen until they press the one button on it, is a trap. "Kasnije"
 * dismisses it and the next visibility check brings it back.
 *
 * The primary button repeats `KidSheetButton`'s classes instead of importing
 * it, which is the one deliberate duplication here: `usePwaUpdate` is mounted
 * in `__root`, so anything this file reaches lands in the entry bundle that
 * every parent downloads before their first paint. One button's worth of class
 * names is a better trade than `KidSheet` plus `KidUi` riding along.
 */
export function KidUpdateToast({
  onRefresh,
  onDismiss,
}: {
  onRefresh: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="kid-font w-full rounded-[22px] border border-[var(--k-line)] bg-[var(--k-card)] px-4 pt-4 pb-3 text-center shadow-[var(--k-shadow)]">
      <span aria-hidden="true" className="text-[34px] leading-none">
        ✨
      </span>
      <p className="mt-1.5 text-[16px] font-semibold text-[var(--k-ink)]">Stigle su nove stvari!</p>
      <p className="mt-1 text-[13px] leading-relaxed font-normal text-[var(--k-sub)]">
        Osveži da ih vidiš.
      </p>
      <button
        type="button"
        onClick={onRefresh}
        className="mt-3.5 w-full rounded-2xl bg-[var(--k-accent)] px-4 py-3.5 text-[15.5px] font-semibold text-[var(--k-accent-ink)] transition-transform duration-100 active:scale-[0.97]"
      >
        Osveži
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="mt-1.5 w-full px-4 py-2 text-[13.5px] font-semibold text-[var(--k-sub)] transition-transform duration-100 active:scale-[0.97]"
      >
        Kasnije
      </button>
    </div>
  );
}
