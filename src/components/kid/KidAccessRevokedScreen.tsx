import { KidAuthScreen } from "@/components/kid/KidAuthScreen";
import type { KidAccessRevokedReason } from "@/types/kid";

/**
 * "Tvoja aplikacija je na pauzi" - what a child sees the moment their access
 * ends, instead of being dumped on the login screen with no explanation.
 *
 * A child who is suddenly signed out has done nothing wrong, and at that age
 * an unexplained login screen reads as "it broke, and probably because of me".
 * So the copy: names what happened in one line, says what to do (ask a parent),
 * promises nothing of theirs was lost, and never blames them. The way onward is
 * a button rather than a redirect, so nothing happens until they are ready.
 *
 * The two reasons are genuinely different situations and are worded as such:
 *
 *   - `device_unknown` - a parent unlinked THIS device. It cannot come back
 *     without a new QR code, and `useKidAccessCheck` has already dropped this
 *     device's saved entry, so the login screen behind it will be the
 *     never-linked one.
 *   - `access_disabled` - a parent switched the whole thing off, for everyone.
 *     Reversible from their side alone, and the saved entry deliberately
 *     survives, so the child gets straight back in with their PIN when it
 *     returns.
 *
 * Same gradient frame as every other pre-session kid screen. The card inside is
 * drawn with the kid theme tokens (`--k-card` / `--k-ink` / `--k-sub`) and the
 * per-theme danger pair for the status pill, so it reads on all five themes -
 * including Svemir, where soft/ink are a dark plum and a pale pink rather than
 * the light themes' pink and deep red.
 */

interface Copy {
  emoji: string;
  title: string;
  subtitle: string;
  pill: string;
  body: string;
  hint: string;
}

const COPY: Record<KidAccessRevokedReason, Copy> = {
  device_unknown: {
    emoji: "📱",
    title: "Ovaj uređaj više nije povezan",
    subtitle: "ali sve tvoje je i dalje tu",
    pill: "Veza je prekinuta",
    body: "Neko od tvojih odraslih je odvezao ovaj telefon ili tablet. Zato aplikacija ne može više da ti pokaže tvoj dan.",
    hint: "Zamoli mamu ili tatu za novi QR kod - skeniraš ga i odmah se vraćaš.",
  },
  access_disabled: {
    emoji: "⏸️",
    title: "Tvoja aplikacija je na pauzi",
    subtitle: "samo za sada",
    pill: "Pristup je isključen",
    body: "Mama ili tata su privremeno isključili tvoju aplikaciju. Ništa nije obrisano - tvoje aktivnosti i raspored te čekaju.",
    hint: "Pitaj ih da je opet uključe, pa se prijavljuješ svojim PIN-om, kao i uvek.",
  },
};

export function KidAccessRevokedScreen({
  reason,
  onContinue,
}: {
  reason: KidAccessRevokedReason;
  onContinue: () => void;
}) {
  const copy = COPY[reason];

  return (
    <KidAuthScreen
      emoji={copy.emoji}
      title={copy.title}
      subtitle={copy.subtitle}
      footer="Nisi ništa pogrešio - ovo podešavaju odrasli 💛"
    >
      <div
        className="mt-5 w-full rounded-[22px] bg-[var(--k-card)] px-5 py-5 text-center"
        style={{ boxShadow: "var(--k-shadow)" }}
      >
        <span className="inline-block rounded-full bg-[var(--k-danger-soft)] px-3 py-1 text-[12px] font-semibold text-[var(--k-danger-ink)]">
          {copy.pill}
        </span>
        <p className="mt-3 text-[14px] leading-relaxed font-normal text-[var(--k-ink)]">
          {copy.body}
        </p>
        <p className="mt-2 text-[13px] leading-relaxed font-normal text-[var(--k-sub)]">
          {copy.hint}
        </p>
      </div>

      <button
        type="button"
        onClick={onContinue}
        className="kid-on-gradient mt-5 w-full rounded-[18px] bg-white px-4 py-3.5 text-[16.5px] font-bold text-[var(--k-accent-strong)] shadow-lg transition-transform duration-100 active:scale-[0.96]"
      >
        Idi na prijavu
      </button>
    </KidAuthScreen>
  );
}
