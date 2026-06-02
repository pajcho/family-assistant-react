import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  AcademicCapIcon,
  ArrowLeftIcon,
  KeyIcon,
  ShieldCheckIcon,
  SwatchIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { UserAvatar } from "@/components/layout/UserAvatar";
import {
  useDeleteFamilyMember,
  useSetMemberAdmin,
  useUpdateMemberName,
  useUpdateProfileColor,
} from "@/hooks/useFamilyMembers";
import { useCreateMemberLogin, useDisableMemberLogin } from "@/hooks/useFamilyLogin";
import { useDeleteSchoolShiftAnchor, useUpsertSchoolShiftAnchor } from "@/hooks/useSchoolShifts";
import { cn } from "@/lib/cn";
import { PROFILE_COLOR_PALETTE, fallbackColorForProfile, getThisWeekStart } from "@/utils/activity";
import { getDisplayName } from "@/utils/identity";
import type { Profile } from "@/types/database";

export type MemberDetailProps = {
  member: Profile;
  /** Whether this member has a school timetable + shifts (an anchor row). */
  isStudent: boolean;
  currentUserId: string | null;
  /** Total admins in the family — guards against demoting / disabling the last. */
  adminCount: number;
  /** Mobile only: render a back button to return to the list. */
  onBack?: () => void;
  /**
   * Creating a login re-keys the member's profile id; the parent reselects the
   * new id so the detail pane doesn't blank out under the old (now-gone) id.
   */
  onMemberReplaced?: (newId: string) => void;
};

/**
 * The detail pane for one family member. Every mutation here is admin-only at
 * the DB level (RLS + the Edge Function); this component is only ever rendered
 * for admins (the tab shows a read-only notice to everyone else).
 */
export function MemberDetail({
  member,
  isStudent,
  currentUserId,
  adminCount,
  onBack,
  onMemberReplaced,
}: MemberDetailProps) {
  const setMemberAdmin = useSetMemberAdmin();
  const upsertAnchor = useUpsertSchoolShiftAnchor();
  const deleteAnchor = useDeleteSchoolShiftAnchor();
  const deleteMember = useDeleteFamilyMember();
  const disableLogin = useDisableMemberLogin();

  const [createLoginOpen, setCreateLoginOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | "remove" | "student-off">(null);

  const name =
    getDisplayName({ firstName: member.first_name, lastName: member.last_name, email: null }) ||
    "Bez imena";
  const color = member.color ?? fallbackColorForProfile(member.id);

  const isSelf = member.id === currentUserId;
  const isLastAdmin = member.is_admin && adminCount <= 1;

  return (
    <div className="space-y-6">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Svi članovi
        </button>
      ) : null}

      {/* Header */}
      <div className="flex items-center gap-3">
        <span className="relative">
          <UserAvatar
            firstName={member.first_name}
            lastName={member.last_name}
            email={null}
            className="h-12 w-12 text-base"
          />
          <span
            className="absolute -right-0.5 -bottom-0.5 size-4 rounded-full border-2 border-white dark:border-gray-800"
            style={{ backgroundColor: color }}
            aria-hidden="true"
          />
        </span>
        <div className="min-w-0">
          <div className="truncate text-lg font-semibold text-gray-900 dark:text-gray-100">
            {name}
            {isSelf ? (
              <span className="ml-1.5 text-sm font-normal text-gray-400 dark:text-gray-500">
                (ti)
              </span>
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge variant={member.has_login ? "secondary" : "outline"}>
              {member.has_login ? "Nalog" : "Bez naloga"}
            </Badge>
            {member.is_admin ? (
              <Badge>
                <ShieldCheckIcon /> Administrator
              </Badge>
            ) : null}
            {isStudent ? (
              <Badge variant="outline">
                <AcademicCapIcon /> Učenik
              </Badge>
            ) : null}
          </div>
        </div>
      </div>

      <NameEditor member={member} />

      <ColorPicker member={member} />

      {/* Login management */}
      <section className="space-y-2">
        <SectionTitle icon={<KeyIcon className="h-4 w-4" />} title="Nalog za prijavu" />
        {member.has_login ? (
          <div className="space-y-2">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Ovaj član ima svoj nalog i može da se prijavi u aplikaciju.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-900/20"
              disabled={isSelf || isLastAdmin || disableLogin.isPending}
              onClick={() => disableLogin.mutate(member.id)}
            >
              {disableLogin.isPending ? "Gašenje…" : "Ugasi nalog"}
            </Button>
            {isSelf ? (
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Ne možeš ugasiti sopstveni nalog.
              </p>
            ) : isLastAdmin ? (
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Poslednji administrator — dodaj još jednog pre gašenja.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Nema nalog. Napravi mu login da bi mogao sam da se prijavi.
            </p>
            <Button variant="outline" size="sm" onClick={() => setCreateLoginOpen(true)}>
              Napravi nalog
            </Button>
          </div>
        )}
      </section>

      {/* Roles */}
      <section className="space-y-3">
        {member.has_login ? (
          <ToggleRow
            id={`admin-${member.id}`}
            icon={<ShieldCheckIcon className="h-4 w-4" />}
            label="Administrator"
            description="Može da pravi i gasi naloge i da upravlja članovima porodice."
            checked={member.is_admin}
            disabled={isLastAdmin || setMemberAdmin.isPending}
            hint={isLastAdmin ? "Mora postojati bar jedan administrator." : undefined}
            onChange={(next) => setMemberAdmin.mutate({ profileId: member.id, is_admin: next })}
          />
        ) : null}

        <ToggleRow
          id={`student-${member.id}`}
          icon={<AcademicCapIcon className="h-4 w-4" />}
          label="Učenik"
          description="Ima raspored časova i smene — prikazuje se na kalendaru aktivnosti."
          checked={isStudent}
          disabled={upsertAnchor.isPending}
          onChange={(next) => {
            if (next) {
              // Mark as student: a default alternating-morning anchor anchored to
              // this week. The fine-grained rota (alternation, pred-čas, fixed
              // band) stays editable on the Activities page.
              upsertAnchor.mutate({
                person_id: member.id,
                anchor_week_start: getThisWeekStart(),
                anchor_shift: "morning",
                is_alternating: true,
              });
            } else {
              setConfirm("student-off");
            }
          }}
        />
      </section>

      {/* Remove (login-less members only) */}
      {!member.has_login ? (
        <section className="border-t border-gray-100 pt-4 dark:border-gray-700/60">
          <Button
            variant="ghost"
            size="sm"
            className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-900/20"
            onClick={() => setConfirm("remove")}
          >
            <TrashIcon className="mr-1.5 h-4 w-4" />
            Ukloni iz porodice
          </Button>
        </section>
      ) : null}

      <CreateLoginDialog
        open={createLoginOpen}
        onOpenChange={setCreateLoginOpen}
        member={member}
        memberName={name}
        onCreated={onMemberReplaced}
      />

      <ConfirmDialog
        open={confirm === "remove"}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={`Ukloniti ${name}?`}
        message="Član i sve njegove aktivnosti, raspored i smene biće trajno uklonjeni."
        confirmLabel="Ukloni"
        loading={deleteMember.isPending}
        onConfirm={() =>
          deleteMember.mutate(member.id, {
            onSuccess: () => {
              setConfirm(null);
              onBack?.();
            },
          })
        }
      />

      <ConfirmDialog
        open={confirm === "student-off"}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={`Ukloniti raspored za ${name}?`}
        message="Raspored časova ostaje sačuvan, ali podešavanje smene se resetuje i član se više neće prikazivati na kalendaru sa školskim blokovima."
        confirmLabel="Ukloni raspored"
        loading={deleteAnchor.isPending}
        onConfirm={() =>
          deleteAnchor.mutate(member.id, {
            onSuccess: () => setConfirm(null),
          })
        }
      />
    </div>
  );
}

function SectionTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-gray-100">
      <span className="text-gray-400 dark:text-gray-500">{icon}</span>
      {title}
    </h3>
  );
}

type ToggleRowProps = {
  id: string;
  icon: ReactNode;
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  hint?: string;
  onChange: (next: boolean) => void;
};

function ToggleRow({
  id,
  icon,
  label,
  description,
  checked,
  disabled,
  hint,
  onChange,
}: ToggleRowProps) {
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-gray-300 disabled:cursor-not-allowed disabled:opacity-50"
      />
      <label
        htmlFor={id}
        className={cn("min-w-0", disabled ? "cursor-not-allowed" : "cursor-pointer")}
      >
        <span className="flex items-center gap-1.5 text-sm font-medium text-gray-900 dark:text-gray-100">
          <span className="text-gray-400 dark:text-gray-500">{icon}</span>
          {label}
        </span>
        <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">{description}</span>
        {hint ? (
          <span className="mt-0.5 block text-xs text-amber-600 dark:text-amber-400">{hint}</span>
        ) : null}
      </label>
    </div>
  );
}

function NameEditor({ member }: { member: Profile }) {
  const updateName = useUpdateMemberName();
  const [firstName, setFirstName] = useState(member.first_name ?? "");
  const [lastName, setLastName] = useState(member.last_name ?? "");

  // Resync when the selected member changes or the row updates upstream.
  useEffect(() => {
    setFirstName(member.first_name ?? "");
    setLastName(member.last_name ?? "");
  }, [member.id, member.first_name, member.last_name]);

  const dirty =
    (member.first_name ?? "") !== firstName.trim() || (member.last_name ?? "") !== lastName.trim();

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    updateName.mutate(
      {
        profileId: member.id,
        first_name: firstName.trim() || null,
        last_name: lastName.trim() || null,
      },
      { onSuccess: () => toast.success("Sačuvano") },
    );
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`fn-${member.id}`}>Ime</Label>
          <Input
            id={`fn-${member.id}`}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="Ime"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`ln-${member.id}`}>Prezime</Label>
          <Input
            id={`ln-${member.id}`}
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="opciono"
          />
        </div>
      </div>
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={!dirty || updateName.isPending}>
          {updateName.isPending ? "Čuva…" : "Sačuvaj"}
        </Button>
      </div>
    </form>
  );
}

function ColorPicker({ member }: { member: Profile }) {
  const updateColor = useUpdateProfileColor();
  return (
    <section className="space-y-2">
      <SectionTitle icon={<SwatchIcon className="h-4 w-4" />} title="Boja" />
      <div className="flex flex-wrap gap-1.5">
        {PROFILE_COLOR_PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Boja ${c}`}
            onClick={() => updateColor.mutate({ profileId: member.id, color: c })}
            style={{ backgroundColor: c }}
            className={cn(
              "size-7 rounded-full border-2 transition-transform hover:scale-110",
              member.color === c ? "border-gray-900 dark:border-white" : "border-transparent",
            )}
          />
        ))}
      </div>
      {member.color == null ? (
        <p className="text-xs text-gray-400 dark:text-gray-500">Trenutno automatska boja.</p>
      ) : null}
    </section>
  );
}

type CreateLoginDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: Profile;
  memberName: string;
  /** Called with the member's new (re-keyed) id once the login is created. */
  onCreated?: (newId: string) => void;
};

function CreateLoginDialog({
  open,
  onOpenChange,
  member,
  memberName,
  onCreated,
}: CreateLoginDialogProps) {
  const createLogin = useCreateMemberLogin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (open) {
      setEmail("");
      setPassword("");
    }
  }, [open]);

  const valid = email.trim().length > 3 && password.length >= 6;

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    try {
      const newId = await createLogin.mutateAsync({ profileId: member.id, email, password });
      toast.success(`Nalog napravljen za ${memberName}.`);
      onOpenChange(false);
      if (newId) onCreated?.(newId);
    } catch {
      // Error toast is surfaced by the hook; keep the dialog open to retry.
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Napravi nalog</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {memberName} će se prijavljivati ovim email-om i lozinkom. Lozinku kasnije može sam da
            promeni.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-login-email">Email</Label>
            <Input
              id="new-login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
              placeholder="ime@primer.com"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-login-password">Lozinka</Label>
            <Input
              id="new-login-password"
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
              placeholder="bar 6 karaktera"
              required
            />
            <p className="text-xs text-gray-500 dark:text-gray-400">Najmanje 6 karaktera.</p>
          </div>
          <ResponsiveDialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createLogin.isPending}
            >
              Otkaži
            </Button>
            <Button type="submit" disabled={!valid || createLogin.isPending}>
              {createLogin.isPending ? "Pravljenje…" : "Napravi nalog"}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
