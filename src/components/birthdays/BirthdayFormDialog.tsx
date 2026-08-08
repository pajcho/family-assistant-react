import { useEffect, useMemo, useState } from "react";

import type { Birthday } from "@/types/database";
import {
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { SheetStackHeader, SheetStackViews, useSheetStack } from "@/components/common/SheetStack";
import { FieldGroupLabel, FieldHint, FormInput } from "@/components/common/FormControls";
import { SwitchRow } from "@/components/common/SwitchRow";
import { BirthdayForm, type BirthdayFormPayload } from "@/components/birthdays/BirthdayForm";
import {
  useBirthdayVisibility,
  useBirthdayVisibilityChildren,
  useSaveBirthdayVisibility,
} from "@/hooks/useBirthdayVisibility";
import { getDisplayName } from "@/utils/identity";

/**
 * Wraps `BirthdayForm` in a `ResponsiveDialog` so the create / edit flow
 * renders as a centered modal on desktop and a bottom sheet (with drag
 * handle) on mobile - the visual pattern carried over from the original Nuxt
 * app.
 *
 * The dialog uses the birthday id as a remount key on the form so switching
 * between "add" and "edit" cleanly resets the controlled inputs even when the
 * dialog stays mounted.
 *
 * It also owns the "Vidljivo deci" draft and its sub-view (a NEW sheet level
 * over the form, per the app's sub-modal convention) - state has to live above
 * the form for the same reason it does in `EventFormDialog`: the sub-view
 * opens over the form, and neither may lose what the other holds.
 *
 * The write is threaded in AFTER the caller's own save. Every surface owns the
 * birthday mutation itself and most of them fire it without handing the result
 * back, so the row's id is generated HERE on create and travels in the payload
 * into `insert()`; see `useSaveBirthdayVisibility` for how a write that
 * overtakes its birthday is retried.
 */
export type BirthdayFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  birthday: Birthday | null;
  /** Optional inline error from the parent (e.g. "Greška pri ažuriranju..."). */
  error?: string | null;
  saving?: boolean;
  /** Awaited when it returns a promise, so the visibility write can follow it. */
  onSubmit: (payload: BirthdayFormPayload) => void | Promise<unknown>;
};

type View = "form" | "visibility";

/** person_id → note draft. Presence in the record IS "this child sees it". */
type VisibilityDraft = Record<string, string>;

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return !!value && typeof (value as { then?: unknown }).then === "function";
}

export function BirthdayFormDialog({
  open,
  onOpenChange,
  birthday,
  error,
  saving = false,
  onSubmit,
}: BirthdayFormDialogProps) {
  const title = birthday ? "Izmeni rođendan" : "Dodaj rođendan";
  const stack = useSheetStack<View>(open, onOpenChange, "form");
  const { push, pop, reset: resetStack } = stack;

  const { children, hasKidMode } = useBirthdayVisibilityChildren();
  const { byBirthday } = useBirthdayVisibility();
  const saveVisibility = useSaveBirthdayVisibility();
  const [draft, setDraft] = useState<VisibilityDraft>({});

  // Serialized (and key-sorted) so the effect reseeds when the stored rows
  // finish loading, but not on every fresh Map identity.
  const storedSeed = useMemo(() => {
    const stored = birthday ? (byBirthday.get(birthday.id) ?? []) : [];
    return JSON.stringify(
      stored
        .map((entry) => [entry.personId, entry.note ?? ""])
        .sort((a, b) => a[0].localeCompare(b[0])),
    );
  }, [byBirthday, birthday]);

  useEffect(() => {
    if (!open) return;
    setDraft(Object.fromEntries(JSON.parse(storedSeed) as [string, string][]));
    resetStack();
  }, [open, birthday?.id, storedSeed, resetStack]);

  // Roster order everywhere: the summary must not reshuffle as rows are toggled.
  const selectedChildren = children.filter((child) => child.id in draft);
  const selectedNames = selectedChildren.map(
    (child) =>
      getDisplayName({ firstName: child.first_name, lastName: child.last_name, email: null }) ||
      "Bez imena",
  );

  const setVisible = (personId: string, visible: boolean) => {
    setDraft((current) => {
      if (!visible) {
        const { [personId]: _removed, ...rest } = current;
        return rest;
      }
      return { ...current, [personId]: current[personId] ?? "" };
    });
  };

  const handleSubmit = (payload: BirthdayFormPayload) => {
    // Create needs the id up front - `birthday_visibility` has a foreign key
    // to a row that does not exist yet, and no caller hands the created
    // birthday back to us.
    const birthdayId = birthday?.id ?? crypto.randomUUID();
    const settled = onSubmit(birthday ? payload : { ...payload, id: birthdayId });
    // Nothing to write, and nothing to wipe: a family without kid mode never
    // sees the picker, so its draft can only be empty.
    if (!hasKidMode) return;

    const entries = children
      .filter((child) => child.id in draft)
      .map((child) => ({ personId: child.id, note: draft[child.id] }));

    void (async () => {
      if (isThenable(settled)) {
        try {
          await settled;
        } catch {
          // The caller already toasts and shows its own inline error.
        }
      }
      try {
        await saveVisibility.mutateAsync({ birthdayId, entries });
      } catch {
        // The mutation hook toasts; the birthday itself is already saved.
      }
    })();
  };

  return (
    <SheetStackViews
      stack={stack}
      render={(view) => (
        <ResponsiveDialogContent className="sm:max-w-md">
          {view === "form" ? (
            <>
              <ResponsiveDialogHeader>
                <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
              </ResponsiveDialogHeader>
              {error && (
                <div className="mb-4 rounded-lg bg-neg-soft p-3 text-sm font-normal text-neg">
                  {error}
                </div>
              )}
              <BirthdayForm
                // Remount on swap between add (null) and a specific birthday so
                // the controlled state in BirthdayForm is fully reset for the
                // new context.
                key={birthday?.id ?? "new"}
                birthday={birthday}
                saving={saving}
                visibility={
                  hasKidMode
                    ? { names: selectedNames, onOpen: () => push("visibility") }
                    : undefined
                }
                onSubmit={handleSubmit}
                onCancel={() => onOpenChange(false)}
              />
            </>
          ) : (
            <>
              <SheetStackHeader title="Vidljivo deci" onBack={pop} />
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Rođendani su deci skriveni dok ih ne uključiš. Uključeno dete vidi ime, datum i
                  tvoju napomenu u svojoj aplikaciji.
                </p>
                {children.map((child) => {
                  const name =
                    getDisplayName({
                      firstName: child.first_name,
                      lastName: child.last_name,
                      email: null,
                    }) || "Bez imena";
                  const visible = child.id in draft;
                  return (
                    <div key={child.id} className="space-y-1.5">
                      <SwitchRow
                        title={name}
                        description={
                          visible ? "Vidi ovaj rođendan" : "Ne vidi ovaj rođendan (podrazumevano)"
                        }
                        checked={visible}
                        onChange={(next) => setVisible(child.id, next)}
                      />
                      {visible ? (
                        <div className="pl-3.5">
                          <FieldGroupLabel className="mt-0">
                            <label htmlFor={`birthday-note-${child.id}`}>Napomena za dete</label>
                          </FieldGroupLabel>
                          <FormInput
                            id={`birthday-note-${child.id}`}
                            value={draft[child.id] ?? ""}
                            onChange={(e) =>
                              setDraft((current) => ({ ...current, [child.id]: e.target.value }))
                            }
                            placeholder="npr. pozovi baku i čestitaj joj"
                          />
                          <FieldHint>{name} ovo čita u svojoj aplikaciji.</FieldHint>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </ResponsiveDialogContent>
      )}
    />
  );
}
