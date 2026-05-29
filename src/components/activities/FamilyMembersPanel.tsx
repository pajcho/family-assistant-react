import * as React from "react";
import { PlusIcon, TrashIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/cn";
import {
  useCreateFamilyMember,
  useDeleteFamilyMember,
  useUpdateProfileColor,
} from "@/hooks/useFamilyMembers";
import type { Profile } from "@/types/database";
import { PROFILE_COLOR_PALETTE, fallbackColorForProfile } from "@/utils/activity";
import { getDisplayName } from "@/utils/identity";

export type FamilyMembersPanelProps = {
  members: ReadonlyArray<Profile>;
};

/**
 * "Porodica" body — per-member colors + add/remove household members.
 * Headerless so it renders inside the options sheet (or a dialog).
 */
export function FamilyMembersPanel({ members }: FamilyMembersPanelProps) {
  const updateColor = useUpdateProfileColor();
  const deleteMember = useDeleteFamilyMember();

  const handleDelete = (member: Profile) => {
    const name =
      getDisplayName({ firstName: member.first_name, lastName: member.last_name, email: null }) ||
      "ovog člana";
    if (!window.confirm(`Obrisati ${name} iz porodice? Sve njegove aktivnosti će biti uklonjene.`))
      return;
    deleteMember.mutate(member.id);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Dodaj članove porodice, postavi boju, ili ih ukloni.
      </p>
      <ul className="space-y-3">
        {members.map((person) => {
          const name =
            getDisplayName({
              firstName: person.first_name,
              lastName: person.last_name,
              email: null,
            }) || "Bez imena";
          const currentColor = person.color ?? fallbackColorForProfile(person.id);
          // Hide the trash for any profile with its own Supabase login — the
          // matching RLS policy refuses to delete them anyway.
          const canDelete = person.has_login === false;
          return (
            <li key={person.id} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span
                  className="inline-block size-3 rounded-full"
                  style={{ backgroundColor: currentColor }}
                  aria-hidden="true"
                />
                <span className="flex-1 truncate text-sm font-medium">{name}</span>
                {person.color == null ? (
                  <span className="text-[10px] text-muted-foreground">(auto)</span>
                ) : null}
                {canDelete ? (
                  <button
                    type="button"
                    aria-label={`Obriši ${name}`}
                    onClick={() => handleDelete(person)}
                    disabled={deleteMember.isPending}
                    className="rounded-md p-1 text-muted-foreground hover:bg-gray-100 hover:text-red-600 dark:hover:bg-gray-800"
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {PROFILE_COLOR_PALETTE.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => updateColor.mutate({ profileId: person.id, color })}
                    aria-label={`Postavi ${name} na ${color}`}
                    style={{ backgroundColor: color }}
                    className={cn(
                      "size-6 rounded-full border-2 transition-transform hover:scale-110",
                      person.color === color
                        ? "border-gray-900 dark:border-white"
                        : "border-transparent",
                    )}
                  />
                ))}
              </div>
            </li>
          );
        })}
      </ul>
      <AddMemberForm />
    </div>
  );
}

/** Collapsible "+ Dodaj člana" form. Collapsed to a button until clicked. */
function AddMemberForm() {
  const [open, setOpen] = React.useState(false);
  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const createMember = useCreateFamilyMember();

  const reset = () => {
    setFirstName("");
    setLastName("");
    setOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const first = firstName.trim();
    const last = lastName.trim();
    if (!first && !last) return;
    try {
      await createMember.mutateAsync({
        first_name: first || null,
        last_name: last || null,
        color: null,
      });
      reset();
    } catch {
      // Toast surfaced by the hook's onError; keep the form open to retry.
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-gray-300 px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-gray-50 hover:text-gray-900 dark:border-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-100"
      >
        <PlusIcon className="h-4 w-4" />
        Dodaj člana
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-2 rounded-md border border-gray-200 p-3 dark:border-gray-700"
    >
      <div className="space-y-1.5">
        <Label htmlFor="new-first-name">Ime</Label>
        <Input
          id="new-first-name"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          placeholder="npr. Marko"
          autoFocus
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="new-last-name">Prezime</Label>
        <Input
          id="new-last-name"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          placeholder="opciono"
        />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Novi član nema svoj nalog — služi samo da mu se dodeljuju aktivnosti i smene.
      </p>
      <div className="flex justify-end gap-2 pt-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={reset}
          disabled={createMember.isPending}
        >
          Otkaži
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={createMember.isPending || (!firstName.trim() && !lastName.trim())}
        >
          {createMember.isPending ? "Čuva…" : "Dodaj"}
        </Button>
      </div>
    </form>
  );
}
