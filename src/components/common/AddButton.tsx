import { PlusIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";

/**
 * Unified "add" affordance in a feature page's header.
 *
 * Desktop (lg+) only since the redesign: below `lg` the global "+" in the
 * middle of the bottom bar is the single, always-reachable entry point for
 * adding anything, so a per-page floating button would be a second, competing
 * affordance sitting right next to it.
 */
export type AddButtonProps = {
  /** Button text. */
  label: string;
  onClick: () => void;
};

export function AddButton({ label, onClick }: AddButtonProps) {
  return (
    <Button type="button" onClick={onClick} className="hidden lg:inline-flex">
      <PlusIcon className="mr-2 h-5 w-5" />
      {label}
    </Button>
  );
}
