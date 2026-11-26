// Connexion en ligne (lot 1.7) : téléphone + mot de passe, choix de l'école, enregistrement de l'appareil.
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { normalizeGuineaPhone, phoneToAuthEmail } from '../lib/phone';
import { isRole, type Role } from '../lib/roles';
import { getDeviceId, type DeviceSession } from '../device/device-store';

export interface SchoolChoice {
  schoolId: string;
  schoolName: string;
  roles: Role[];
}

export interface SignInResult {
  user: User;
  fullName: string;
  phone: string;
  schools: SchoolChoice[];
  mustChangePassword: boolean;
}

export class LoginError extends Error {}

export async function signIn(client: SupabaseClient, phoneInput: string, password: string): Promise<SignInResult> {
  const phone = normalizeGuineaPhone(phoneInput);
  if (!phone) throw new LoginError('Numéro invalide. Exemple : 620 00 00 00.');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new LoginError('La première connexion demande du réseau. Réessayez quand le téléphone est connecté.');
  }
  const { data, error } = await client.auth.signInWithPassword({ email: phoneToAuthEmail(phone), password });
  if (error || !data.user) throw new LoginError('Numéro ou mot de passe incorrect.');
  const user = data.user;

  const [{ data: profile }, { data: rows, error: mErr }] = await Promise.all([
    client.from('profiles').select('full_name').eq('id', user.id).maybeSingle(),
    client.from('memberships').select('school_id, role, schools(name)').eq('user_id', user.id).eq('status', 'active'),
  ]);
  if (mErr) throw new LoginError('Impossible de lire vos écoles. Réessayez.');

  const bySchool = new Map<string, SchoolChoice>();
  for (const r of (rows ?? []) as unknown as { school_id: string; role: string; schools: { name: string } | null }[]) {
    if (!isRole(r.role)) continue;
    const entry = bySchool.get(r.school_id) ?? { schoolId: r.school_id, schoolName: r.schools?.name ?? 'École', roles: [] };
    entry.roles.push(r.role);
    bySchool.set(r.school_id, entry);
  }
  if (bySchool.size === 0) {
    await client.auth.signOut();
    throw new LoginError("Ce compte n'est rattaché à aucune école active. Contactez le fondateur de l'école.");
  }

  return {
    user,
    phone,
    fullName: (profile as { full_name?: string } | null)?.full_name ?? phone,
    schools: [...bySchool.values()],
    mustChangePassword: user.user_metadata?.must_change_password === true,
  };
}

export async function changePassword(client: SupabaseClient, password: string): Promise<void> {
  if (password.length < 8) throw new LoginError('Le mot de passe doit contenir au moins 8 caractères.');
  const { error } = await client.auth.updateUser({ password, data: { must_change_password: false } });
  if (error) throw new LoginError('Changement impossible. Vérifiez le réseau et réessayez.');
}

/** Enregistre l'appareil pour l'école choisie et prépare la session locale (sans code pour l'instant). */
export async function openSchool(client: SupabaseClient, signInResult: SignInResult, school: SchoolChoice): Promise<DeviceSession> {
  const deviceId = await getDeviceId();
  const label = typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 120) : '';
  const { data, error } = await client.rpc('register_device', { p_school: school.schoolId, p_device_id: deviceId, p_label: label });
  if (error) {
    if (error.message.includes('device_revoked')) throw new LoginError('Cet appareil a été révoqué par le fondateur.');
    throw new LoginError("Impossible d'enregistrer ce téléphone. Réessayez.");
  }
  return {
    userId: signInResult.user.id,
    phone: signInResult.phone,
    fullName: signInResult.fullName,
    schoolId: school.schoolId,
    schoolName: school.schoolName,
    roles: school.roles,
    deviceId,
    receiptPrefix: (data as { receipt_prefix: string }).receipt_prefix,
    failedPinAttempts: 0,
  };
}
