import { DevicePhoneMobileIcon, QrCodeIcon, TrashIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { ResponsiveDialogFooter } from "@/components/ui/responsive-dialog";
import { formatDate, formatRelative } from "@/utils/date";
import type { KidDevice } from "@/types/database";

/**
 * The "Uređaji" drill-in: every device a parent has linked for one child, and
 * the only way to take one back. A device row IS a live session - the token in
 * its localStorage is what lets that phone sign in - so revoking is described
 * in those terms rather than as "deleting a record".
 *
 * The confirm step spells out the one consequence a parent cannot guess: all of
 * a child's devices share a single account, so removing one signs the child out
 * of ALL of them (see `endKidSessions` in the `kid-access` function). The others
 * come back with just a PIN.
 */

export type KidAccessDeviceListProps = {
  devices: ReadonlyArray<KidDevice>;
  isLoading: boolean;
  isError: boolean;
  onLinkDevice: () => void;
  onRequestRevoke: (device: KidDevice) => void;
  onClose: () => void;
};

export function KidAccessDeviceList({
  devices,
  isLoading,
  isError,
  onLinkDevice,
  onRequestRevoke,
  onClose,
}: KidAccessDeviceListProps) {
  return (
    <div className="space-y-4">
      {isLoading ? (
        <p className="py-6 text-center text-sm font-normal text-muted-foreground">
          Učitavanje uređaja…
        </p>
      ) : isError ? (
        <p className="py-6 text-center text-sm font-normal text-muted-foreground">
          Lista uređaja nije učitana. Zatvori ovaj prozor i pokušaj ponovo.
        </p>
      ) : devices.length === 0 ? (
        <div className="space-y-3 py-2 text-center">
          <DevicePhoneMobileIcon
            className="mx-auto size-8 text-muted-foreground"
            aria-hidden="true"
          />
          <p className="text-sm font-normal text-muted-foreground">
            Nijedan uređaj još nije povezan. Dok ne povežeš bar jedan, dete ne može da se prijavi.
          </p>
          <Button onClick={onLinkDevice}>
            <QrCodeIcon className="size-4" />
            Poveži uređaj
          </Button>
        </div>
      ) : (
        <ul className="space-y-2">
          {devices.map((device) => (
            <li
              key={device.id}
              className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5"
            >
              <DevicePhoneMobileIcon
                className="size-5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-foreground">
                  {device.label?.trim() || "Nepoznat uređaj"}
                </div>
                <div className="text-xs font-normal text-muted-foreground">
                  Povezan {formatDate(device.created_at)}
                  {" · "}
                  {device.last_seen_at
                    ? `poslednja prijava ${formatRelative(device.last_seen_at)}`
                    : "još se nije prijavilo"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onRequestRevoke(device)}
                aria-label={`Ukloni uređaj ${device.label?.trim() || "Nepoznat uređaj"}`}
                className="grid size-11 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-neg-soft hover:text-neg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <TrashIcon className="size-[18px]" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <ResponsiveDialogFooter>
        <Button variant="outline" className="w-full sm:w-auto" onClick={onClose}>
          Zatvori
        </Button>
      </ResponsiveDialogFooter>
    </div>
  );
}

export type KidAccessRevokeConfirmProps = {
  device: KidDevice;
  memberName: string;
  /** Revoking the last one leaves the child unable to sign in at all. */
  isLastDevice: boolean;
  isPending: boolean;
  onBack: () => void;
  onConfirm: () => void;
};

export function KidAccessRevokeConfirm({
  device,
  memberName,
  isLastDevice,
  isPending,
  onBack,
  onConfirm,
}: KidAccessRevokeConfirmProps) {
  const label = device.label?.trim() || "Nepoznat uređaj";
  return (
    <div className="space-y-4">
      <p className="text-sm font-normal text-muted-foreground">
        Sa uređaja „{label}" više nije moguća prijava. Ako {memberName} opet koristi taj uređaj,
        povezuješ ga novim QR kodom.
      </p>
      {/* The child has ONE kid account behind all their devices, so ending the
          session ends it everywhere - a parent who is only taking one phone
          away must not be surprised by the tablet asking for a PIN. */}
      <p className="rounded-lg bg-muted px-3 py-2 text-[13px] font-normal text-muted-foreground">
        {memberName} se pri tome odjavljuje sa svih svojih uređaja - dečiji nalog je jedan za sve.
        Na ostalim povezanim uređajima se vraća odmah, samo svojim PIN-om, bez novog QR koda.
      </p>
      {isLastDevice ? (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-[13px] font-normal text-warn">
          Ovo je jedini povezani uređaj - {memberName} neće moći da se prijavi dok ne povežeš novi.
        </p>
      ) : null}
      <ResponsiveDialogFooter>
        <Button variant="outline" onClick={onBack} disabled={isPending}>
          Nazad
        </Button>
        <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
          {isPending ? "Uklanjanje…" : "Ukloni uređaj"}
        </Button>
      </ResponsiveDialogFooter>
    </div>
  );
}
