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
import { KidAccessSection } from "@/components/family/KidAccessSection";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { MemberAvatarPicker } from "@/components/family/MemberAvatarPicker";
import {
  useDeleteFamilyMember,
  useSetMemberAdmin,
  useUpdateMemberName,
  useUpdateProfileColor,
} from "@/hooks/useFamilyMembers";
import { useCreateMemberLogin, useDisableMemberLogin } from "@/hooks/useFamilyLogin";
import { useDeleteSchoolShiftAnchor, useUpsertSchoolShiftAnchor } from "@/hooks/useSchoolShifts";
import { cn } from "@/lib/cn";
import { PROFILE_COLOR_PALETTE, getThisWeekStart } from "@/utils/activity";
import { getDisplayName } from "@/utils/identity";
import type { Profile } from "@/types/database";

export type MemberDetailProps = {
  member: Profile;
  /** Whether this member has a school timetable + shifts (an anchor row). */
  isStudent: boolean;
  currentUserId: string | null;
  /** Total admins in the family - guards against demoting / disabling the last. */
  adminCount: number;
  /** Mobile only: render a back button to return to the list. */
  onBack?: () => void;
  /**
   * Creating a login re-keys the member's profile id; the parent reselects the
   * new id so the detail pane doesn't blank out under the old (now-gone) id.
   */
  onMemberReplaced?: (newId: string) => void;
};

/** Status pill sizing shared by the role badges in the header. */
const PILL = "rounded-full px-2 py-[3px] text-[10.5px] font-bold";

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

  const isSelf = member.id === currentUserId;
  const isLastAdmin = member.is_admin && adminCount <= 1;

  return (
    <div className="space-y-6">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="-mx-1 flex min-h-11 items-center gap-1 px-1 text-sm font-normal text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Svi članovi
        </button>
      ) : null}

      {/* Header */}
      <div className="flex items-center gap-3">
        {/* The member's own tile, drawn exactly as the list draws it - colour
            and all. It used to be the generic blue account avatar with a colour
            dot pinned to its corner, which made the one screen ABOUT this
            member the only one not showing them. */}
        <MemberAvatar member={member} size="lg" />
        <div className="min-w-0">
          <div className="truncate text-lg font-semibold text-foreground">
            {name}
            {isSelf ? (
              <span className="ml-1.5 text-sm font-normal text-muted-foreground">(ti)</span>
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge
              variant={member.has_login ? "secondary" : "outline"}
              className={cn(
                PILL,
                member.has_login ? "bg-pos-soft text-pos" : "text-muted-foreground",
              )}
            >
              {member.has_login ? "Nalog" : "Bez naloga"}
            </Badge>
            {member.is_admin ? (
              <Badge className={cn(PILL, "bg-accent-soft text-accent-deep")}>
                <ShieldCheckIcon /> Administrator
              </Badge>
            ) : null}
            {isStudent ? (
              <Badge
                variant="outline"
                className={cn(PILL, "border-transparent bg-info-soft text-info")}
              >
                <AcademicCapIcon /> Učenik
              </Badge>
            ) : null}
          </div>
        </div>
      </div>

      <NameEditor member={member} />

      <ColorPicker member={member} />

      <MemberAvatarPicker member={member} memberName={name} />

      {/* Login management */}
      <section className="space-y-2">
        <SectionTitle icon={<KeyIcon className="h-4 w-4" />} title="Nalog za prijavu" />
        {member.has_login ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Ovaj član ima svoj nalog i može da se prijavi u aplikaciju.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:bg-neg-soft hover:text-destructive"
              disabled={isSelf || isLastAdmin || disableLogin.isPending}
              onClick={() => disableLogin.mutate(member.id)}
            >
              {disableLogin.isPending ? "Gašenje…" : "Ugasi nalog"}
            </Button>
            {isSelf ? (
              <p className="text-xs text-muted-foreground">Ne možeš ugasiti sopstveni nalog.</p>
            ) : isLastAdmin ? (
              <p className="text-xs text-muted-foreground">
                Poslednji administrator - dodaj još jednog pre gašenja.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Nema nalog. Napravi mu login da bi mogao sam da se prijavi.
            </p>
            <Button variant="outline" size="sm" onClick={() => setCreateLoginOpen(true)}>
              Napravi nalog
            </Button>
          </div>
        )}
      </section>

      {/* Kid mode - only for members who will never have a login of their own;
          the section renders nothing for anyone else. */}
      {!member.has_login ? <KidAccessSection member={member} memberName={name} /> : null}

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
          description="Ima raspored časova i smene - prikazuje se na kalendaru aktivnosti."
          checked={isStudent}
          disabled={upsertAnchor.isPending}
          onChange={(next) => {
            if (next) {
              // Mark as student: a default alternating-morning anchor anchored to
              // this week. The fine-grained rota (alternation, the early afternoon band, fixed
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
        <section className="border-t border-border pt-4">
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:bg-neg-soft hover:text-destructive"
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
    <h3 className="flex items-center gap-1.5 text-[11.5px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
      {icon}
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
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-accent disabled:cursor-not-allowed disabled:opacity-50"
      />
      <label
        htmlFor={id}
        className={cn("min-w-0", disabled ? "cursor-not-allowed" : "cursor-pointer")}
      >
        <span className="flex items-center gap-1.5 text-[14.5px] font-semibold text-foreground">
          <span className="text-muted-foreground">{icon}</span>
          {label}
        </span>
        <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
          {description}
        </span>
        {hint ? <span className="mt-0.5 block text-xs font-normal text-warn">{hint}</span> : null}
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
      {/* Swatches only. A colour is a colour - naming the eight of them gave
          the UI sentences ("izabrana boja: borovnica") that carried nothing the
          swatch itself doesn't already say. */}
      <div className="flex flex-wrap gap-0.5" role="radiogroup" aria-label="Boja člana">
        {PROFILE_COLOR_PALETTE.map((c, i) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={member.color === c}
            aria-label={`Boja ${i + 1}`}
            onClick={() => updateColor.mutate({ profileId: member.id, color: c })}
            className={cn(
              "grid size-11 place-items-center rounded-full border-2 transition-transform hover:scale-110",
              member.color === c ? "border-foreground" : "border-transparent",
            )}
          >
            <span
              className="size-8 rounded-full"
              style={{ backgroundColor: c }}
              aria-hidden="true"
            />
          </button>
        ))}
      </div>
      {member.color == null ? (
        <p className="text-xs font-normal text-muted-foreground">Trenutno automatska boja.</p>
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
            <p className="text-xs text-muted-foreground">Najmanje 6 karaktera.</p>
          </div>
          <ResponsiveDialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createLogin.isPending}
            >
              Odustani
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
