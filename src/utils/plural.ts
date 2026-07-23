/**
 * Serbian paucal agreement helpers.
 *
 * Serbian nouns take three forms depending on the count's last digit(s):
 *   - one  - 1, 21, 101, 201 … (n % 10 === 1, except the 11 teen)
 *   - few  - 2-4, 22-24, 202-204 … (n % 10 ∈ 2..4, except the 12-14 teens)
 *   - many - everything else (0, 5-20, 25-30, 100, 110 …)
 */
export function serbianPlural(
  count: number,
  forms: { one: string; few: string; many: string },
): string {
  const n = Math.abs(count);
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms.one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms.few;
  return forms.many;
}

/** "stavka / stavke / stavki" for a count (1 stavka, 2 stavke, 5 stavki). */
export function stavkeLabel(count: number): string {
  return serbianPlural(count, { one: "stavka", few: "stavke", many: "stavki" });
}
