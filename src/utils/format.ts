/** RSD amount with symbol */
export function formatAmount(amount: number): string {
  return `${Number(amount).toLocaleString("sr-Latn-RS")} RSD`;
}
