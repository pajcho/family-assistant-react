import { PlusIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";

/**
 * Unified "add" affordance, used in every feature page's header. Renders as a
 * labelled button in the header on desktop (lg+) and as a floating action
 * button in the bottom-right corner below lg (where the bottom nav lives -
 * tablets included). Place it where the header button should go - the FAB is
 * `fixed`, so its position in the DOM doesn't matter.
 */
export type AddButtonProps = {
  /** Button text on desktop; also the FAB's aria-label. */
  label: string;
  onClick: () => void;
};

export function AddButton({ label, onClick }: AddButtonProps) {
  return (
    <>
      {/* Desktop (lg+): labelled header button. */}
      <Button type="button" onClick={onClick} className="hidden lg:inline-flex">
        <PlusIcon className="mr-2 h-5 w-5" />
        {label}
      </Button>

      {/* Below lg: floating action button, clearing the bottom nav. */}
      <Button
        type="button"
        onClick={onClick}
        size="icon-lg"
        aria-label={label}
        className="fixed right-4 bottom-24 z-30 size-14 rounded-full shadow-lg lg:hidden"
      >
        <PlusIcon className="size-6" />
      </Button>
    </>
  );
}
