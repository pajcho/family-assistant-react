import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  DevicePhoneMobileIcon,
  EyeIcon,
  FaceSmileIcon,
  KeyIcon,
  NoSymbolIcon,
  QrCodeIcon,
} from "@heroicons/react/24/outline";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ResponsiveDialogContent } from "@/components/ui/responsive-dialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import {
  DetailActionList,
  DetailActionRow,
  DetailBadgeRow,
  DetailInfoRow,
  DetailInfoRows,
  DetailInfoText,
  type DetailBadge,
} from "@/components/common/DetailSheet";
import { SheetStackHeader, SheetStackViews, useSheetStack } from "@/components/common/SheetStack";
import { KID_PRIVACY_SENTENCE, deviceCountLabel } from "@/components/family/KidAccessCopy";
import {
  KidAccessDeviceList,
  KidAccessRevokeConfirm,
} from "@/components/family/KidAccessDeviceList";
import { KidAccessInviteView } from "@/components/family/KidAccessInviteView";
import { KidAccessPinForm } from "@/components/family/KidAccessPinForm";
import {
  useDisableKidAccess,
  useEnableKidAccess,
  useKidAccessList,
  useKidDevices,
  useRevokeKidDevice,
  useSetKidPin,
} from "@/hooks/useKidAccess";
import { useProfile } from "@/hooks/useProfile";
import { formatDateTime, formatRelative } from "@/utils/date";
import type { KidDevice, Profile } from "@/types/database";

/**
 * Kid access - the parent's whole control panel for one child's kid
 * mode, rendered inside `MemberDetail` right under "Nalog za prijavu".
 *
 * Only offered to members WITHOUT a real login: a member who signs in with an
 * email already has a full account, and kid mode is the alternative for the
 * ones who never will. Admin-only, like everything else on this pane.
 *
 * Sub-flows (PIN, QR, devices) open as stacked sheets via `useSheetStack`, so
 * a drill-in is a new overlay on top rather than an inline panel that grows
 * the page.
 */

export type KidAccessSectionProps = {
  member: Profile;
  /** Already resolved by MemberDetail - reused verbatim in every message. */
  memberName: string;
};

type View = "enable" | "pin" | "invite" | "devices" | "revoke";

const VIEW_TITLE: Record<View, string> = {
  enable: "Uključi dečiji pristup",
  pin: "Nova PIN šifra",
  invite: "Poveži uređaj",
  devices: "Uređaji",
  revoke: "Ukloni uređaj",
};

export function KidAccessSection({ member, memberName }: KidAccessSectionProps) {
  const { isAdmin } = useProfile();
  const navigate = useNavigate();
  const { byProfileId, isLoading, isError } = useKidAccessList();
  const access = byProfileId.get(member.id) ?? null;

  // One devices query for the whole section: the status row's count and the
  // drill-in list read the same cache entry.
  const {
    devices,
    isLoading: devicesLoading,
    isError: devicesError,
  } = useKidDevices(access ? member.id : null);

  const [flowRoot, setFlowRoot] = useState<View | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<KidDevice | null>(null);
  const [confirmDisable, setConfirmDisable] = useState(false);

  // Works in BOTH states, and that is the point: the parent deciding whether to
  // turn kid access on is exactly the person who has not seen the child's app.
  const openPreview = () => {
    void navigate({ to: "/kid/preview", search: { child: member.id } });
  };

  const enableAccess = useEnableKidAccess();
  const setKidPin = useSetKidPin();
  const disableAccess = useDisableKidAccess();
  const revokeDevice = useRevokeKidDevice();

  const stack = useSheetStack<View>(
    flowRoot !== null,
    (next) => {
      if (!next) setFlowRoot(null);
    },
    flowRoot ?? "invite",
  );
  const { pop, push } = stack;

  // Everything after the login section is admin-only; MemberDetail is already
  // behind that gate (FamilyTab renders a read-only roster for everyone else),
  // but this section provisions accounts, so it re-checks rather than assumes.
  if (!isAdmin || member.has_login) return null;

  const handleEnable = async (pin: string) => {
    try {
      await enableAccess.mutateAsync({ profileId: member.id, pin });
      toast.success(`Dečiji pristup je uključen za ${memberName}.`);
      // Access without a linked device is inert, so hand the parent the QR
      // instead of dropping them back on the page to find it themselves.
      setFlowRoot("invite");
    } catch {
      // Error toast comes from the hook; keep the form open to retry.
    }
  };

  const handleSetPin = async (pin: string) => {
    try {
      await setKidPin.mutateAsync({ profileId: member.id, pin });
      toast.success("Novi PIN je sačuvan.");
      setFlowRoot(null);
    } catch {
      // Error toast comes from the hook.
    }
  };

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    try {
      await revokeDevice.mutateAsync({ deviceId: revokeTarget.id, profileId: member.id });
      toast.success("Uređaj je uklonjen.");
      setRevokeTarget(null);
      pop();
    } catch {
      // Error toast comes from the hook.
    }
  };

  const lockedUntil =
    access?.locked_until && new Date(access.locked_until).getTime() > Date.now()
      ? access.locked_until
      : null;

  const statusBadge: DetailBadge = !access?.is_enabled
    ? { label: "Isključen", tone: "neutral" }
    : lockedUntil
      ? { label: "Zaključan", tone: "warn" }
      : { label: "Aktivan", tone: "pos" };

  const deviceCount = devices.length;
  const deviceValue = devicesLoading
    ? "Učitavanje…"
    : devicesError
      ? "Nedostupno"
      : deviceCount === 0
        ? "Nijedan"
        : deviceCountLabel(deviceCount);

  return (
    <section className="space-y-2">
      {/* Mirrors MemberDetail's SectionTitle; kept local to avoid an import
          cycle between the pane and the section it renders. */}
      <h3 className="flex items-center gap-1.5 text-[11.5px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
        <FaceSmileIcon className="h-4 w-4" />
        Dečiji pristup
      </h3>

      {isLoading ? (
        <p className="text-sm font-normal text-muted-foreground">Provera dečijeg pristupa…</p>
      ) : isError ? (
        <p className="text-sm font-normal text-muted-foreground">
          Status dečijeg pristupa nije učitan. Osveži stranicu da probaš ponovo.
        </p>
      ) : access ? (
        <div className="space-y-3">
          <DetailInfoRows>
            <DetailInfoRow label="Status">
              <DetailBadgeRow badges={[statusBadge]} />
            </DetailInfoRow>
            <DetailInfoText
              label="Poslednja prijava"
              value={access.last_login_at ? formatDateTime(access.last_login_at) : "Još nije bilo"}
            />
            <DetailInfoText label="Povezani uređaji" value={deviceValue} />
          </DetailInfoRows>

          {lockedUntil ? (
            <p className="rounded-lg bg-warn-soft px-3 py-2 text-[13px] font-normal text-warn">
              Previše pogrešnih PIN-ova. Otključava se {formatRelative(lockedUntil)}, ili odmah čim
              postaviš novi PIN.
            </p>
          ) : null}

          {!devicesLoading && !devicesError && deviceCount === 0 ? (
            <p className="text-[13px] font-normal text-muted-foreground">
              Dok ne povežeš bar jedan uređaj, {memberName} ne može da se prijavi.
            </p>
          ) : null}

          <DetailActionList>
            <DetailActionRow
              icon={QrCodeIcon}
              label="Poveži uređaj"
              description="QR kod za telefon ili tablet deteta"
              tone="primary"
              onClick={() => setFlowRoot("invite")}
            />
            <DetailActionRow
              icon={EyeIcon}
              label="Pogledaj dečiju aplikaciju"
              description={`Otvara ono što ${memberName} vidi, iz tvog naloga`}
              onClick={openPreview}
            />
            <DetailActionRow
              icon={KeyIcon}
              label="Nova PIN šifra"
              description="Menja PIN i skida zaključavanje; uređaji ostaju povezani"
              onClick={() => setFlowRoot("pin")}
            />
            <DetailActionRow
              icon={DevicePhoneMobileIcon}
              label="Uređaji"
              description={
                devicesLoading
                  ? "Učitavanje…"
                  : devicesError
                    ? "Pregled povezanih uređaja"
                    : deviceCount === 0
                      ? "Nijedan uređaj nije povezan"
                      : `Povezano ${deviceCountLabel(deviceCount)}`
              }
              onClick={() => setFlowRoot("devices")}
              chevron
            />
            <DetailActionRow
              icon={NoSymbolIcon}
              label="Isključi pristup"
              description="Odjavljuje dete sa svih uređaja"
              tone="destructive"
              onClick={() => setConfirmDisable(true)}
            />
          </DetailActionList>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm font-normal text-muted-foreground">
            {memberName} dobija svoju, jednostavnu aplikaciju - bez email adrese i lozinke.
            Prijavljuje se PIN-om, i to samo na uređaju koji mu ti povežeš. Ništa ne može da doda,
            izmeni ni obriše.
          </p>
          <p className="rounded-lg bg-muted px-3 py-2 text-[13px] font-normal text-muted-foreground">
            {KID_PRIVACY_SENTENCE}
          </p>
          {/* The preview sits right next to the decision, because this is the
              moment a parent needs it: there is no kid account yet, so there is
              no other way to see what they would be turning on. */}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setFlowRoot("enable")}>
              Uključi pristup
            </Button>
            <Button variant="ghost" size="sm" onClick={openPreview}>
              <EyeIcon className="size-4" aria-hidden="true" />
              Pogledaj dečiju aplikaciju
            </Button>
          </div>
        </div>
      )}

      <SheetStackViews
        stack={stack}
        render={(view, level) => {
          // The root level always renders the view the section just asked for.
          // `useSheetStack` adopts a new root in an effect (one render late),
          // and enabling access hands over to device linking while the flow
          // stays open - both would otherwise show the previous screen.
          const actual = level === 0 ? (flowRoot ?? view) : view;
          return (
            <ResponsiveDialogContent>
              <SheetStackHeader
                title={VIEW_TITLE[actual]}
                onBack={level === 0 ? undefined : pop}
                description={
                  actual === "devices"
                    ? `Uređaji na kojima ${memberName} može da se prijavi.`
                    : undefined
                }
              />
              {actual === "enable" ? (
                <KidAccessPinForm
                  idPrefix={`kid-enable-${member.id}`}
                  description={`Izaberi PIN kojim će se ${memberName} prijavljivati. Zapamti ga - kasnije ga možeš promeniti, ali ne i pročitati.`}
                  submitLabel="Uključi pristup"
                  pendingLabel="Uključivanje…"
                  isPending={enableAccess.isPending}
                  onCancel={() => setFlowRoot(null)}
                  onSubmit={(pin) => {
                    void handleEnable(pin);
                  }}
                />
              ) : actual === "pin" ? (
                <KidAccessPinForm
                  idPrefix={`kid-pin-${member.id}`}
                  description={`Novi PIN za ${memberName}. Povezani uređaji ostaju povezani, ali stari PIN prestaje da važi odmah.`}
                  submitLabel="Sačuvaj PIN"
                  pendingLabel="Čuvanje…"
                  isPending={setKidPin.isPending}
                  onCancel={() => (level === 0 ? setFlowRoot(null) : pop())}
                  onSubmit={(pin) => {
                    void handleSetPin(pin);
                  }}
                />
              ) : actual === "invite" ? (
                <KidAccessInviteView
                  profileId={member.id}
                  memberName={memberName}
                  closeLabel={level === 0 ? "Zatvori" : "Nazad"}
                  onClose={() => (level === 0 ? setFlowRoot(null) : pop())}
                />
              ) : actual === "devices" ? (
                <KidAccessDeviceList
                  devices={devices}
                  isLoading={devicesLoading}
                  isError={devicesError}
                  onLinkDevice={() => push("invite")}
                  onRequestRevoke={(device) => {
                    setRevokeTarget(device);
                    push("revoke");
                  }}
                  onClose={() => setFlowRoot(null)}
                />
              ) : actual === "revoke" && revokeTarget ? (
                <KidAccessRevokeConfirm
                  device={revokeTarget}
                  memberName={memberName}
                  isLastDevice={deviceCount <= 1}
                  isPending={revokeDevice.isPending}
                  onBack={pop}
                  onConfirm={() => {
                    void handleRevoke();
                  }}
                />
              ) : null}
            </ResponsiveDialogContent>
          );
        }}
      />

      <ConfirmDialog
        open={confirmDisable}
        onOpenChange={(open) => {
          if (!open) setConfirmDisable(false);
        }}
        title={`Isključiti dečiji pristup za ${memberName}?`}
        message="Dete se odmah odjavljuje sa svih uređaja, a PIN i sve veze sa uređajima se brišu. Njegove aktivnosti, raspored i ostali podaci ostaju netaknuti - pristup kasnije možeš ponovo uključiti sa novim PIN-om."
        confirmLabel="Isključi pristup"
        loading={disableAccess.isPending}
        onConfirm={() =>
          disableAccess.mutate(member.id, {
            onSuccess: () => {
              setConfirmDisable(false);
              setFlowRoot(null);
              toast.success(`Dečiji pristup je isključen za ${memberName}.`);
            },
          })
        }
      />
    </section>
  );
}
