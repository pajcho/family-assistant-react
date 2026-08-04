import { useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  ArrowLeftIcon,
  ArrowRightOnRectangleIcon,
  BellIcon,
  BanknotesIcon,
  DevicePhoneMobileIcon,
  GlobeAltIcon,
  PencilSquareIcon,
  Squares2X2Icon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";

import { AppScreen, ScreenHeaderRow } from "@/components/layout/AppScreen";
import { UserAvatar } from "@/components/layout/UserAvatar";
import { CalendarTab } from "@/components/calendar/CalendarTab";
import { CurrenciesCard } from "@/components/family/CurrenciesCard";
import { FamilyTab } from "@/components/family/FamilyTab";
import { AccentRow, ThemeRow } from "@/components/settings/AppearanceSection";
import { NotificationsSection } from "@/components/settings/NotificationsSection";
import { ProfileSection } from "@/components/settings/ProfileSection";
import {
  SettingsFootnote,
  SettingsGroup,
  SettingsGroupTitle,
  SettingsPill,
  SettingsRow,
} from "@/components/settings/SettingsChrome";
import { useAuth } from "@/hooks/useAuth";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { useGoogleCalendar } from "@/hooks/useGoogleCalendar";
import { useEnabledCurrencies } from "@/hooks/useCurrencySettings";
import { useProfile } from "@/hooks/useProfile";
import {
  DEFAULT_NAV_SLOTS,
  NAV_SECTION_MAP,
  normalizeNavSlots,
} from "@/components/layout/navSections";
import { getDisplayName } from "@/utils/identity";
import { serbianPlural } from "@/utils/plural";

/**
 * "Podešavanja" - one hub instead of the old tab strip plus a separate
 * /profile page. The hub is a list of grouped rows; anything with real content
 * behind it opens as a full sub-screen (still the same route, so
 * `?tab=family`, `?tab=calendar` and the Google OAuth `?gcal=` return keep
 * working exactly as before).
 */

export type SettingsSection = "profile" | "family" | "currencies" | "notifications" | "calendar";

const SECTION_TITLES: Record<SettingsSection, string> = {
  profile: "Lični podaci",
  family: "Porodica",
  currencies: "Valute",
  notifications: "Obaveštenja",
  calendar: "Google kalendar",
};

export function SettingsScreen({
  section,
  gcal,
  reason,
  onOpenSection,
  onBack,
  onGcalHandled,
}: {
  section: SettingsSection | null;
  gcal?: "connected" | "error";
  reason?: string;
  onOpenSection: (next: SettingsSection) => void;
  onBack: () => void;
  onGcalHandled: () => void;
}) {
  // The Google OAuth callback bounces back here with a one-shot ?gcal flag.
  // Toast it, then strip the params so a refresh doesn't re-fire the toast.
  // Guard against StrictMode's double effect-invoke in dev: fire once per
  // distinct result, re-arming when the param clears so a later reconnect toasts.
  const handledGcal = useRef<string | null>(null);
  useEffect(() => {
    if (!gcal) {
      handledGcal.current = null;
      return;
    }
    const key = `${gcal}:${reason ?? ""}`;
    if (handledGcal.current === key) return;
    handledGcal.current = key;
    if (gcal === "connected") toast.success("Google kalendar je povezan.");
    else toast.error(`Povezivanje nije uspelo${reason ? ` (${reason})` : ""}.`);
    onGcalHandled();
  }, [gcal, reason, onGcalHandled]);

  if (section) {
    return (
      <AppScreen
        header={
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onBack}
              aria-label="Nazad na podešavanja"
              className="-ml-2 grid size-11 shrink-0 place-items-center rounded-md text-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <ArrowLeftIcon className="size-5" />
            </button>
            <h1 className="truncate text-[23px] leading-tight font-extrabold tracking-tight">
              {SECTION_TITLES[section]}
            </h1>
          </div>
        }
      >
        <div className="space-y-4">
          {section === "profile" ? <ProfileSection /> : null}
          {section === "family" ? <FamilyTab /> : null}
          {section === "currencies" ? <CurrenciesCard /> : null}
          {section === "notifications" ? <NotificationsSection /> : null}
          {section === "calendar" ? <CalendarTab /> : null}
        </div>
      </AppScreen>
    );
  }

  return (
    <AppScreen header={<ScreenHeaderRow title="Podešavanja" />}>
      <SettingsHub onOpenSection={onOpenSection} />
    </AppScreen>
  );
}

function SettingsHub({ onOpenSection }: { onOpenSection: (next: SettingsSection) => void }) {
  const { user, signOut } = useAuth();
  const { profile, family, isAdmin } = useProfile();
  const { members } = useFamilyMembers();
  const { enabled } = useEnabledCurrencies();
  const { connections } = useGoogleCalendar();

  const identity = {
    firstName: profile?.first_name ?? null,
    lastName: profile?.last_name ?? null,
    email: user?.email ?? null,
  };
  const displayName = getDisplayName(identity);

  const memberCount = members.length;
  const memberLabel = serbianPlural(memberCount, {
    one: "član",
    few: "člana",
    many: "članova",
  });

  // Slots the bottom bar currently shows (Danas and Meni are fixed, so only
  // the two free ones are listed here).
  const slots = normalizeNavSlots(profile?.nav_slots);
  const slotLabels = (slots.length > 0 ? slots : DEFAULT_NAV_SLOTS)
    .map((key) => NAV_SECTION_MAP[key].label)
    .join(" · ");

  const needsReauth = connections.some((c) => c.needs_reauth);

  return (
    <div className="pb-2">
      <div className="flex items-center gap-[11px] rounded-xl border border-border bg-card px-[13px] py-3 shadow-card">
        <UserAvatar {...identity} className="size-14 text-lg" gravatarSize={160} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[17px] leading-tight font-extrabold tracking-[-0.01em]">
            {displayName}
          </div>
          <div className="mt-0.5 truncate text-[12.5px] font-semibold text-muted-foreground">
            {[user?.email, family?.name, isAdmin ? "Administrator" : null]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onOpenSection("profile")}
          aria-label="Uredi lične podatke"
          className="grid size-11 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <PencilSquareIcon className="size-5" />
        </button>
      </div>

      <SettingsGroupTitle>Porodica</SettingsGroupTitle>
      <SettingsGroup>
        <SettingsRow
          icon={UserGroupIcon}
          label="Porodica i članovi"
          hint="uloge, boje, nalozi"
          value={memberCount > 0 ? `${memberCount} ${memberLabel}` : undefined}
          onClick={() => onOpenSection("family")}
        />
        <SettingsRow
          icon={BanknotesIcon}
          tone="pos"
          label="Valute"
          hint="RSD je osnovna - uvek uključena"
          value={enabled.join(" · ")}
          onClick={() => onOpenSection("currencies")}
        />
      </SettingsGroup>

      <SettingsGroupTitle>Obaveštenja</SettingsGroupTitle>
      <SettingsGroup>
        <SettingsRow
          icon={BellIcon}
          tone="warn"
          label="Obaveštenja i pregledi"
          hint="push na ovom uređaju, jutarnji i večernji pregled, aktivne sesije"
          onClick={() => onOpenSection("notifications")}
        />
      </SettingsGroup>

      <SettingsGroupTitle>Kalendar</SettingsGroupTitle>
      <SettingsGroup>
        <SettingsRow
          icon={GlobeAltIcon}
          tone="info"
          label="Google kalendar"
          hint="jednosmerno, samo za čitanje"
          value={
            needsReauth ? (
              <SettingsPill tone="warn">zahteva pažnju</SettingsPill>
            ) : connections.length > 0 ? (
              <SettingsPill tone="pos">Povezano</SettingsPill>
            ) : (
              "Nije povezano"
            )
          }
          onClick={() => onOpenSection("calendar")}
        />
      </SettingsGroup>

      <SettingsGroupTitle>Aplikacija</SettingsGroupTitle>
      <SettingsGroup>
        <ThemeRow />
        <AccentRow />
        <SettingsRow
          icon={Squares2X2Icon}
          label="Donja traka"
          hint="Danas i Meni su uvek u traci · 2 slobodna mesta"
          value={slotLabels}
        />
        <SettingsRow
          icon={DevicePhoneMobileIcon}
          tone="muted"
          label="O aplikaciji"
          hint="Porodični asistent - nove verzije stižu same, uz obaveštenje."
        />
      </SettingsGroup>
      <SettingsFootnote>
        Traku menjaš u meniju: dugme Meni u donjoj traci, pa „Uredi traku".
      </SettingsFootnote>

      <div className="mt-4">
        <SettingsGroup>
          <SettingsRow
            icon={ArrowRightOnRectangleIcon}
            danger
            center
            label="Odjavi se"
            onClick={() => void signOut()}
          />
        </SettingsGroup>
      </div>
    </div>
  );
}
