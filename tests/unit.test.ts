import { describe, it, expect } from 'vitest';
import { formatGuineaPhone, normalizeGuineaPhone, phoneToAuthEmail } from '../src/lib/phone';
import { hashPin, isValidPin, verifyPin } from '../src/auth/pin';

describe('numéros guinéens', () => {
  it.each([
    ['620 00 00 00', '+224620000000'],
    ['+224 620-00-00-00', '+224620000000'],
    ['00224 664 12 34 56', '+224664123456'],
    ['224664123456', '+224664123456'],
    ['300 12 34 56', '+224300123456'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeGuineaPhone(input)).toBe(expected);
  });

  it.each(['62000000', '7200000000', '+33612345678', 'abc', ''])('refuse %s', (input) => {
    expect(normalizeGuineaPhone(input)).toBeNull();
  });

  it('dérive l’identifiant de connexion technique', () => {
    expect(phoneToAuthEmail('+224620000000')).toBe('224620000000@telephone.hailand.invalid');
  });

  it('formate pour l’affichage', () => {
    expect(formatGuineaPhone('+224620000000')).toBe('620 00 00 00');
  });
});

describe('code à 4 chiffres', () => {
  it('accepte le bon code et refuse les autres', async () => {
    const { hash, salt } = await hashPin('2580');
    expect(await verifyPin('2580', hash, salt)).toBe(true);
    expect(await verifyPin('2581', hash, salt)).toBe(false);
  });

  it('ne produit pas deux fois la même empreinte', async () => {
    const a = await hashPin('1234');
    const b = await hashPin('1234');
    expect(a.hash).not.toBe(b.hash);
  });

  it('exige exactement 4 chiffres', () => {
    expect(isValidPin('1234')).toBe(true);
    expect(isValidPin('123')).toBe(false);
    expect(isValidPin('12a4')).toBe(false);
  });
});
