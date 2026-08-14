import { KID_PIN_LENGTHS, isValidKidPin } from "@/types/kid";
import { pluralSr } from "@/utils/plural";

/**
 * Pure copy + validation helpers for the parent-side kid access UI. Kept out
 * of the components so the wording (Serbian plurals in particular) can be
 * unit-tested without dragging Supabase into the test.
 */

/**
 * The paucal rule lives in `@/utils/plural` (`21 minut`, `11 minuta`,
 * `3 minuta`); re-exported so this module stays the one import site for the
 * kid-access copy.
 */
export { pluralSr };

/** The device count, declined - used in the status row and the drill-in. */
export function deviceCountLabel(count: number): string {
  return `${count} ${pluralSr(count, "uređaj", "uređaja", "uređaja")}`;
}

/**
 * Live countdown under the QR code. Minutes while there is more than a minute
 * left, then seconds - a parent who is mid-scan wants to know it is about to
 * die, not that it "still has 1 minute".
 */
export function inviteValidityLabel(secondsLeft: number): string {
  if (secondsLeft <= 0) return "Link je istekao";
  if (secondsLeft < 60) {
    return `Važi još ${secondsLeft} ${pluralSr(secondsLeft, "sekundu", "sekunde", "sekundi")}`;
  }
  const minutes = Math.ceil(secondsLeft / 60);
  return `Važi još ${minutes} ${pluralSr(minutes, "minut", "minuta", "minuta")}`;
}

/**
 * PINs a child (or anyone else) would guess first. Mirrors the server-side
 * check in the `kid-access` function - this copy only exists so the parent
 * finds out before the round trip.
 */
export function isWeakKidPin(pin: string): boolean {
  if (/^(\d)\1*$/.test(pin)) return true;
  return pin === "1234" || pin === "123456";
}

/** Named "format" rather than "length" so `KID_PIN_ERROR_TEXT.format` cannot
 * be misread as an array's `.length`. */
export type KidPinError = "format" | "weak" | "mismatch" | null;

/**
 * Validates the "enter it twice" PIN form. Returns the FIRST problem, so the
 * parent fixes one thing at a time instead of reading a list.
 */
export function validateKidPin(pin: string, confirmation: string): KidPinError {
  if (!isValidKidPin(pin)) return "format";
  if (isWeakKidPin(pin)) return "weak";
  if (pin !== confirmation) return "mismatch";
  return null;
}

const PIN_LENGTHS_LABEL = KID_PIN_LENGTHS.join(" ili ");

export const KID_PIN_ERROR_TEXT: Record<Exclude<KidPinError, null>, string> = {
  format: `PIN mora imati ${PIN_LENGTHS_LABEL} cifara - samo brojeve.`,
  weak: "Ovaj PIN se previše lako pogađa. Izbegni iste cifre i redom (1234).",
  mismatch: "PIN-ovi se ne poklapaju.",
};

/** Longest PIN we accept - the input's `maxLength`. */
export const KID_PIN_MAX_LENGTH = Math.max(...KID_PIN_LENGTHS);

/**
 * The privacy model in one sentence, shown where a parent decides whether to
 * turn this on at all.
 *
 * It must stay TRUE, which is why chores are named here: a child sees the tasks
 * assigned to them and may tick those off (through `kid_complete_task`, the only
 * write a kid session can make against a task). Everything the sentence still
 * rules out is ruled out by RLS, not by a screen: money and lists have no kid
 * SELECT policy at all, and a task with no assignee - the whole shopping list -
 * is invisible to a child for the same reason somebody else's chore is.
 */
export const KID_PRIVACY_SENTENCE =
  "Dete vidi svoje aktivnosti, događaje, školski raspored, članove porodice i zadatke koje mu dodelite (i može da ih označi kao završene), a novac, liste i tuđe obaveze ne vidi nikada.";
