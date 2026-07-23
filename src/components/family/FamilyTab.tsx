import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CurrenciesCard } from "@/components/family/CurrenciesCard";
import { MemberList } from "@/components/family/MemberList";
import { MemberDetail } from "@/components/family/MemberDetail";
import { AddMemberDialog } from "@/components/family/AddMemberDialog";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { useProfile, useRenameFamily } from "@/hooks/useProfile";
import { useSchoolShiftAnchors } from "@/hooks/useSchoolShifts";
import { useIsWide } from "@/hooks/useIsWide";
import { getDisplayName } from "@/utils/identity";

/**
 * "Porodica" settings tab - manage the household: members, colors, who is a
 * student (timetable + shifts), and per-member logins (create / disable /
 * admin). Master-detail like the Lists page, but selection is local state
 * since this lives inside a tab rather than its own route.
 *
 * Admin-only for mutations (enforced in RLS + the Edge Function). Non-admins
 * see a read-only roster.
 */
export function FamilyTab() {
  const isWide = useIsWide();
  const { members, isLoading } = useFamilyMembers();
  const { profile, isAdmin } = useProfile();
  const { byPersonId: anchorsByPersonId } = useSchoolShiftAnchors();

  const currentUserId = profile?.id ?? null;

  // Parents (with a login) first, then alphabetical. Stable order keeps the
  // selected row from jumping around as data refetches.
  const sortedMembers = useMemo(() => {
    return [...members].sort((a, b) => {
      const la = a.has_login ? 0 : 1;
      const lb = b.has_login ? 0 : 1;
      if (la !== lb) return la - lb;
      const na = getDisplayName({ firstName: a.first_name, lastName: a.last_name, email: null });
      const nb = getDisplayName({ firstName: b.first_name, lastName: b.last_name, email: null });
      return na.localeCompare(nb, "sr");
    });
  }, [members]);

  const studentIds = useMemo(() => new Set(anchorsByPersonId.keys()), [anchorsByPersonId]);
  const adminCount = useMemo(() => members.filter((m) => m.is_admin).length, [members]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  // Desktop: keep a member selected so the detail pane is never empty. Prefer
  // the current user; otherwise the first row.
  useEffect(() => {
    if (!isWide || selectedId || sortedMembers.length === 0) return;
    const preferred =
      currentUserId && sortedMembers.some((m) => m.id === currentUserId)
        ? currentUserId
        : sortedMembers[0].id;
    setSelectedId(preferred);
  }, [isWide, selectedId, sortedMembers, currentUserId]);

  const selected = sortedMembers.find((m) => m.id === selectedId) ?? null;

  if (isLoading) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">Učitavanje…</p>;
  }

  // ── Non-admins: read-only roster ──
  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <FamilyNameCard canManage={false} />
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          Samo administrator porodice može da menja članove, naloge i boje.
        </div>
        <MemberList
          members={sortedMembers}
          selectedId={null}
          onSelect={() => {}}
          studentIds={studentIds}
          currentUserId={currentUserId}
          canManage={false}
          onAdd={() => {}}
        />
        <CurrenciesCard />
      </div>
    );
  }

  const list = (
    <MemberList
      members={sortedMembers}
      selectedId={selectedId}
      onSelect={setSelectedId}
      studentIds={studentIds}
      currentUserId={currentUserId}
      canManage
      onAdd={() => setAddOpen(true)}
    />
  );

  const detail = selected ? (
    <MemberDetail
      key={selected.id}
      member={selected}
      isStudent={studentIds.has(selected.id)}
      currentUserId={currentUserId}
      adminCount={adminCount}
      onBack={isWide ? undefined : () => setSelectedId(null)}
      onMemberReplaced={(newId) => setSelectedId(newId)}
    />
  ) : null;

  return (
    <div className="space-y-6">
      <FamilyNameCard canManage />

      {isWide ? (
        <div className="flex items-start gap-4">
          <div className="w-72 shrink-0">{list}</div>
          <div className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
            {detail ?? (
              <p className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">
                Izaberi člana sa liste.
              </p>
            )}
          </div>
        </div>
      ) : selected ? (
        <div className="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
          {detail}
        </div>
      ) : (
        list
      )}

      <CurrenciesCard />

      <AddMemberDialog open={addOpen} onOpenChange={setAddOpen} onCreated={setSelectedId} />
    </div>
  );
}

function FamilyNameCard({ canManage }: { canManage: boolean }) {
  const { familyName } = useProfile();
  const rename = useRenameFamily();
  const [name, setName] = useState(familyName ?? "");

  useEffect(() => {
    setName(familyName ?? "");
  }, [familyName]);

  const dirty = name.trim().length > 0 && (familyName ?? "") !== name.trim();

  if (!canManage) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Porodica</CardTitle>
          <CardDescription>{familyName ?? "-"}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Porodica</CardTitle>
        <CardDescription>Naziv porodice prikazan u meniju aplikacije.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (dirty) rename.mutate(name, { onSuccess: () => toast.success("Sačuvano") });
          }}
          className="flex items-end gap-3"
        >
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="family-name">Naziv</Label>
            <Input id="family-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <Button type="submit" disabled={!dirty || rename.isPending}>
            {rename.isPending ? "Čuva…" : "Sačuvaj"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
