import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { ResponsiveDialog, ResponsiveDialogContent } from "@/components/ui/responsive-dialog";
import { Chip, ChipRow, FieldGroupLabel, FormInput } from "@/components/common/FormControls";
import { SheetStackHeader } from "@/components/common/SheetStack";
import { TaskAllFields, useSelfAssignWhenPrivate } from "@/components/tasks/TaskFields";
import {
  emptyTaskDraft,
  privateDraftDefaults,
  taskDraftToCreateInput,
  type TaskDraft,
} from "@/components/tasks/taskDraft";
import { useProfile } from "@/hooks/useProfile";
import { useCreateTask, useListsWithTasks } from "@/hooks/useTasks";
import { pushRecentListId, readRecentListIds } from "@/lib/recentLists";
import type { ListScope } from "@/types/database";

/**
 * "Dodaj → Zadatak" from anywhere - the same shape as `ExpenseQuickAddFlow`: it
 * owns the mutation and the feedback but never navigates, so the caller's page
 * stays put whether the user saves or backs out.
 *
 * Unlike the on-screen composer this sheet IS the form, so its fields live in it
 * rather than behind four more taps - what the composer keeps behind sub-views is
 * screen space it does not have. Only `Naziv` is required; a task with nothing
 * else set lands in the Inbox, which is exactly what the Inbox exists to catch.
 *
 * Tasks are not visible on most screens, so the success toast carries the way in:
 * one tap opens where it landed, and ignoring it leaves you where you were.
 */
export type TaskQuickAddFlowProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * What the form starts with. The composer hands its half-written task over
   * when you expand it - and clears itself doing so, because the task is now
   * here - so "open the full form" continues the sentence rather than asking
   * you to type it again.
   */
  initialDraft?: TaskDraft;
  /** Preselected list. `null`/undefined = Inbox. */
  initialListId?: string | null;
};

const NO_LIST = "";

/**
 * A blank draft for a given destination: private-by-default outside any list
 * (see `privateDraftDefaults`), plain family-wide inside one - a list already
 * carries an answer about who sees what.
 */
function blankDraft(target: string, viewerId: string | null): TaskDraft {
  return emptyTaskDraft(target === NO_LIST ? privateDraftDefaults(viewerId) : undefined);
}

/**
 * Where the sheet opens.
 *
 * `initialListId` is THREE states, not two: an id means the caller picked one
 * (the composer's handover), `null` means it explicitly means Inbox, and both
 * win outright. Only `undefined` - the global "+", which has no opinion - falls
 * back to the last list this device used, which is what makes "open the app,
 * put milk on the shopping list" a couple of taps instead of a hunt through a
 * ten-entry select. Read fresh every time, so it reflects the add you just made.
 */
function defaultListId(initialListId: string | null | undefined): string {
  if (initialListId !== undefined) return initialListId ?? NO_LIST;
  return readRecentListIds()[0] ?? NO_LIST;
}

export function TaskQuickAddFlow({
  open,
  onOpenChange,
  initialDraft,
  initialListId,
}: TaskQuickAddFlowProps) {
  const navigate = useNavigate();
  const createTask = useCreateTask();
  const listsQuery = useListsWithTasks();
  const viewerId = useProfile().profile?.id ?? null;

  // Seeded twice over, because this sheet is opened in two ways. The composer
  // mounts it ALREADY open, so its handover has to arrive with the first state;
  // the global "Dodaj" keeps one mounted and flips `open`, which the effect
  // below catches. Only one of the two ever fires for a given opening.
  const [draft, setDraft] = useState<TaskDraft>(() =>
    initialDraft ? { ...initialDraft } : blankDraft(defaultListId(initialListId), viewerId),
  );
  const [listId, setListId] = useState<string>(() => defaultListId(initialListId));
  const [error, setError] = useState<string | null>(null);
  useSelfAssignWhenPrivate(setDraft);

  const lists = listsQuery.data;
  const listOptions = useMemo(
    () => [
      { value: NO_LIST, label: "Bez liste (Inbox)" },
      ...[...(lists ?? [])]
        .sort((a, b) => a.name.localeCompare(b.name, "sr"))
        .map((list) => ({ value: list.id, label: list.name })),
    ],
    [lists],
  );
  const scopeById = useMemo(
    () => new Map((lists ?? []).map((list) => [list.id, list.scope])),
    [lists],
  );

  // Null = no list, which is the only case where the task answers for its own
  // visibility. A picked list whose row has not arrived yet reads as family:
  // the switch is out of play either way, and that is the commoner list.
  const listScope: ListScope | null =
    listId === NO_LIST ? null : (scopeById.get(listId) ?? "family");

  // The three most recent lists that still exist, plus the Inbox. Empty until
  // this device has actually opened one, so a first run shows only the select.
  const quickPicks = useMemo(() => {
    if (!lists) return [];
    const byId = new Map(lists.map((list) => [list.id, list]));
    const recent = readRecentListIds()
      .map((id) => byId.get(id))
      .filter((list) => list !== undefined)
      .slice(0, 3)
      .map((list) => ({ value: list.id, label: list.name }));
    return recent.length > 0 ? [...recent, { value: NO_LIST, label: "Inbox" }] : [];
  }, [lists]);

  const reset = () => {
    const target = defaultListId(initialListId);
    setDraft(blankDraft(target, viewerId));
    setListId(target);
    setError(null);
  };

  /**
   * Picking a list hands visibility over to it, so the private switch goes off
   * and (for a personal list, where nobody else can see the task anyway) the
   * assignees go with it. Coming back to Inbox restores the listless default,
   * unless there is a hand-picked assignee it would trample.
   */
  const handleListChange = (next: string) => {
    setListId(next);
    setDraft((s) => {
      if (next === NO_LIST) {
        return s.assigneeIds.length > 0 ? s : { ...s, ...privateDraftDefaults(viewerId) };
      }
      const personal = (scopeById.get(next) ?? "family") === "personal";
      return { ...s, onlyMe: false, assigneeIds: personal ? [] : s.assigneeIds };
    });
  };

  // Re-seed on the way IN for a sheet that was already mounted and closed - the
  // draft to start from is whatever the caller holds at the moment it opens,
  // not what it held when this component first rendered.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current) {
      const target = defaultListId(initialListId);
      setDraft(initialDraft ? { ...initialDraft } : blankDraft(target, viewerId));
      setListId(target);
      setError(null);
    }
    wasOpen.current = open;
  }, [open, initialDraft, initialListId, viewerId]);

  // The remembered list may have been deleted since it was remembered. Once the
  // lists are actually in, a selection that is not among them falls back to the
  // Inbox rather than leaving the select pointing at a row that is gone.
  useEffect(() => {
    if (!lists || listId === NO_LIST) return;
    if (!lists.some((list) => list.id === listId)) setListId(NO_LIST);
  }, [lists, listId]);

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
    if (!next) reset();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = draft.name.trim();
    if (!name) return;
    setError(null);
    const target = listId === NO_LIST ? null : listId;
    try {
      await createTask.mutateAsync(taskDraftToCreateInput({ ...draft, name }, target));
      // "I used this list" - the other of exactly two places that record it, so
      // the next "+ -> Zadatak" opens here and the grid puts it on top. The
      // Inbox is deliberately NOT recorded: "no list" is not a list, and storing
      // it would make the next open preselect nothing while looking remembered.
      if (target) pushRecentListId(target);
      onOpenChange(false);
      reset();
      toast.success("Zadatak je dodat.", {
        action: {
          label: "Otvori",
          onClick: () => {
            if (target) {
              void navigate({ to: "/tasks/$listId", params: { listId: target } });
              return;
            }
            void navigate({ to: "/tasks/inbox" });
          },
        },
      });
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Greška pri dodavanju zadatka");
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={handleOpenChange}>
      <ResponsiveDialogContent
        className="sm:max-w-md"
        stickyFooter={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Odustani
            </Button>
            <Button
              type="submit"
              form="task-quick-add"
              disabled={createTask.isPending || !draft.name.trim()}
            >
              Dodaj zadatak
            </Button>
          </div>
        }
      >
        <SheetStackHeader title="Novi zadatak" />
        {error ? (
          <div
            role="alert"
            className="mb-4 rounded-lg bg-neg-soft p-3 text-sm font-normal text-neg"
          >
            {error}
          </div>
        ) : null}
        <form
          id="task-quick-add"
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          <div>
            <FieldGroupLabel>
              <label htmlFor="task-quick-name">Naziv *</label>
            </FieldGroupLabel>
            {/* No autoFocus - it would pop the iOS keyboard before the drawer has
                finished sliding in. */}
            <FormInput
              id="task-quick-name"
              value={draft.name}
              onChange={(e) => setDraft((s) => ({ ...s, name: e.target.value }))}
              placeholder="npr. Zvati servis za kotao"
              required
            />
          </div>

          <div>
            <FieldGroupLabel>
              <label htmlFor="task-quick-list">Lista</label>
            </FieldGroupLabel>
            {/* The lists you actually use, one tap each, above the full set.
                A ten-entry native select is two taps and a scroll for the one
                list somebody adds to every day. Inbox closes the row so "no
                list" stays just as cheap. */}
            {quickPicks.length > 0 ? (
              <ChipRow className="mb-2">
                {quickPicks.map((pick) => (
                  <Chip
                    key={pick.value}
                    selected={listId === pick.value}
                    onClick={() => handleListChange(pick.value)}
                  >
                    {pick.label}
                  </Chip>
                ))}
              </ChipRow>
            ) : null}
            <NativeSelect
              id="task-quick-list"
              value={listId}
              onChange={handleListChange}
              options={listOptions}
              parse={(raw) => raw}
            />
          </div>

          <TaskAllFields draft={draft} setDraft={setDraft} listScope={listScope} />
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
