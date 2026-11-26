// Code à 4 chiffres : ouvre l'application sur l'appareil, sans réseau (HYP-11).
// Il ne quitte jamais le téléphone ; seul son empreinte PBKDF2 y est stockée.

const ITERATIONS = 150_000;
export const MAX_PIN_ATTEMPTS = 5;

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export function isValidPin(pin: string): boolean {
  return /^[0-9]{4}$/.test(pin);
}

export async function hashPin(pin: string, saltB64?: string): Promise<{ hash: string; salt: string }> {
  const salt = saltB64 ? fromB64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: ITERATIONS },
    key,
    256,
  );
  return { hash: toB64(new Uint8Array(bits)), salt: toB64(salt) };
}

export async function verifyPin(pin: string, hash: string, salt: string): Promise<boolean> {
  const computed = await hashPin(pin, salt);
  // Comparaison à durée constante.
  if (computed.hash.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= computed.hash.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}
