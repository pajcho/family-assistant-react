import { Kbd } from "@/components/common/Kbd";
import { SheetStackHeader } from "@/components/common/SheetStack";
import { NAV_SECTIONS } from "@/components/layout/navSections";
import { ResponsiveDialog, ResponsiveDialogContent } from "@/components/ui/responsive-dialog";
import { actionShortcuts, navShortcutKeys } from "@/lib/shortcuts";

/**
 * The `?` sheet - the whole keyboard map on one screen.
 *
 * Linear ships the same thing, and for the same reason: a shortcut nobody can
 * find is a shortcut nobody uses. It is also the fallback for keyboard layouts
 * where `?` is awkward to reach, since Podešavanja links here too.
 */
export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <SheetStackHeader
          title="Prečice na tastaturi"
          description={'Kretanje se kuca kao „G pa slovo" - isto na Mac-u i na Windows-u.'}
        />
        <div className="space-y-5">
          <Group title="Kretanje">
            {NAV_SECTIONS.map((section) => (
              <Row key={section.key} keys={navShortcutKeys(section.key)} label={section.label} />
            ))}
          </Group>
          <Group title="Radnje">
            {actionShortcuts().map((row) => (
              <Row key={row.label} keys={row.keys} label={row.label} />
            ))}
          </Group>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 px-[3px] text-[11.5px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
        {title}
      </h3>
      <div className="rounded-xl border border-border bg-card">{children}</div>
    </section>
  );
}

function Row({ keys, label }: { keys: readonly string[]; label: string }) {
  return (
    <div className="flex min-h-11 items-center gap-3 border-b border-border px-[13px] py-2 last:border-b-0">
      <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{label}</span>
      <Kbd keys={keys} />
    </div>
  );
}
