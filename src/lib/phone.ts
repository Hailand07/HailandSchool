// Numéros guinéens : 9 chiffres, mobiles en 6, fixes en 3 (indicatif +224).

export function normalizeGuineaPhone(input: string): string | null {
  let d = input.replace(/[\s.\-()]/g, '');
  if (d.startsWith('+224')) d = d.slice(4);
  else if (d.startsWith('00224')) d = d.slice(5);
  else if (d.startsWith('224') && d.length === 12) d = d.slice(3);
  if (!/^[36][0-9]{8}$/.test(d)) return null;
  return `+224${d}`;
}

/** +224620000000 → 620 00 00 00 */
export function formatGuineaPhone(e164: string): string {
  const d = e164.replace(/^\+224/, '');
  if (d.length !== 9) return e164;
  return `${d.slice(0, 3)} ${d.slice(3, 5)} ${d.slice(5, 7)} ${d.slice(7, 9)}`;
}
