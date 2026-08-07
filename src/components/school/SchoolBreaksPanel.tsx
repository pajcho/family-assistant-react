import { PlusIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import type { Profile, SchoolBreak } from "@/types/database";
import { monthNameOfNumber } from "@/utils/budget";
import { getDisplayName } from "@/utils/identity";
import { fallbackColorForProfile } from "@/utils/activity";

/**
 * The raspusti list inside the Aktivnosti "Opcije" sheet.
 *
 * Without it the timetable is a bare weekly pattern and keeps rendering all
 * summer. Each row is one break; tapping it opens the editor one level up the
 * sheet stack.
 */

/** "21. jun - 31. avgust". No year: a raspust repeats every year. */
export function formatBreakRange(brk: SchoolBreak): string {
  const from = `${brk.start_day}. ${monthNameOfNumber(brk.start_month).toLowerCase()}`;
  const to = `${brk.end_day}. ${monthNameOfNumber(brk.end_month).toLowerCase()}`;
  return `${from} - ${to}`;
}

function personName(person: Profile): string {
  return (
    getDisplayName({ firstName: person.first_name, lastName: person.last_name, email: null }) ||
    "Bez imena"
  );
}

export type SchoolBreaksPanelProps = {
  breaks: ReadonlyArray<SchoolBreak>;
  memberIdsByBreak: ReadonlyMap<string, ReadonlySet<string>>;
  /** Children with a timetable - used to name a break's scope. */
  students: ReadonlyArray<Profile>;
  onAdd: () => void;
  onEdit: (breakId: string) => void;
};

export function SchoolBreaksPanel({
  breaks,
  memberIdsByBreak,
  students,
  onAdd,
  onEdit,
}: SchoolBreaksPanelProps) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        U ove dane se raspored časova ne prikazuje. Godina se ne unosi - raspust važi svake godine.
      </p>

      {breaks.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
          Još nema raspusta. Dodaj letnji i raspored nestaje preko celog leta.
        </p>
      ) : (
        <ul className="space-y-2">
          {breaks.map((brk) => {
            const memberIds = memberIdsByBreak.get(brk.id);
            const named = memberIds
              ? students.filter((s) => memberIds.has(s.id))
              : ([] as Profile[]);
            return (
              <li key={brk.id}>
                <button
                  type="button"
                  onClick={() => onEdit(brk.id)}
                  className="flex min-h-11 w-full flex-col items-start gap-0.5 rounded-md border border-border px-2.5 py-2 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <span className="w-full truncate text-sm font-semibold text-foreground">
                    {brk.name}
                  </span>
                  <span className="flex w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs font-normal text-muted-foreground">
                    <span>{formatBreakRange(brk)}</span>
                    <span aria-hidden="true">·</span>
                    {named.length === 0 ? (
                      <span>sva deca</span>
                    ) : (
                      named.map((person) => (
                        <span key={person.id} className="inline-flex items-center gap-1">
                          <span
                            className="inline-block size-2 rounded-full"
                            style={{
                              backgroundColor: person.color ?? fallbackColorForProfile(person.id),
                            }}
                            aria-hidden="true"
                          />
                          {personName(person)}
                        </span>
                      ))
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Button type="button" variant="outline" className="w-full justify-start" onClick={onAdd}>
        <PlusIcon className="mr-2 h-4 w-4" />
        Dodaj raspust
      </Button>
    </div>
  );
}
