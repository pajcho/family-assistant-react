/**
 * Helpers that derive a human display string from whatever the user has
 * filled in so far. Profile fields are optional, so each helper degrades
 * gracefully: name → email → "?".
 *
 * The initials helper is deliberately "smart" about emails: if the user
 * hasn't set a name yet, we split the local part on common separators
 * (dot / dash / underscore / plus) so `nikola.pajic@gmail.com` shows as
 * "NP" instead of just "N".
 */

export interface IdentityInput {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

export function getDisplayName({ firstName, lastName, email }: IdentityInput): string {
  const f = clean(firstName);
  const l = clean(lastName);
  if (f && l) return `${f} ${l}`;
  if (f) return f;
  if (l) return l;
  return clean(email);
}

function emailLocalParts(email: string): string[] {
  const local = email.split("@")[0] ?? "";
  // Split on common identity separators. Order doesn't matter — any run
  // of separators collapses to a single boundary.
  return local
    .split(/[._\-+]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function getInitials(input: IdentityInput): string {
  const f = clean(input.firstName);
  const l = clean(input.lastName);
  if (f && l) return (f[0] + l[0]).toUpperCase();
  if (f) return f[0].toUpperCase();
  if (l) return l[0].toUpperCase();

  const email = clean(input.email);
  if (!email) return "?";
  const parts = emailLocalParts(email);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  if (parts.length === 1) {
    return parts[0][0].toUpperCase();
  }
  return email[0]?.toUpperCase() ?? "?";
}

/**
 * SHA-256 of a normalised email — the modern Gravatar identifier.
 * Returns null in environments without WebCrypto (e.g. very old browsers).
 */
export async function gravatarHash(email: string): Promise<string | null> {
  const normalised = email.trim().toLowerCase();
  if (!normalised) return null;
  if (typeof crypto === "undefined" || !crypto.subtle) return null;
  const buffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalised),
  );
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Build a Gravatar URL. `d=404` makes Gravatar return 404 when the email
 * has no registered avatar so we can detect the miss via `<img onError>`
 * and fall back to initials instead of showing the generic placeholder.
 */
export function gravatarUrl(hash: string, size = 80): string {
  return `https://gravatar.com/avatar/${hash}?d=404&s=${size}`;
}
