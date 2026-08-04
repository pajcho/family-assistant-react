/**
 * Time-of-day greeting for the Danas header.
 *
 * Deliberately WITHOUT the user's name: Serbian would need the vocative
 * ("Miloše", not "Miloš") and a wrong declension reads worse than no name at
 * all - the same call the empty states already make.
 */
export function greetingFor(date: Date): string {
  const hour = date.getHours();
  if (hour < 5) return "Dobro veče";
  if (hour < 12) return "Dobro jutro";
  if (hour < 18) return "Dobar dan";
  return "Dobro veče";
}
