// Gestion des membres (lot 1.8) : passe par la fonction serveur « members », seule à détenir la clé de service.
import { supabase } from '../supabase';
import type { Role } from '../lib/roles';

export class MembersError extends Error {}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  if (!navigator.onLine) throw new MembersError('Cette action demande du réseau.');
  const { data, error } = await supabase.functions.invoke('members', { body });
  if (error) {
    let msg = 'Action impossible. Réessayez.';
    try {
      const ctx = (error as { context?: Response }).context;
      const payload = ctx ? await ctx.json() : null;
      if (payload?.error) msg = payload.error;
    } catch {
      /* réponse illisible */
    }
    throw new MembersError(msg);
  }
  return data as T;
}

export function createMember(input: { schoolId: string; fullName: string; phone: string; role: Role }) {
  return invoke<{ membership_id: string; temp_password: string | null }>({
    action: 'create', school_id: input.schoolId, full_name: input.fullName, phone: input.phone, role: input.role,
  });
}

export function revokeMember(schoolId: string, membershipId: string) {
  return invoke<{ ok: true }>({ action: 'revoke', school_id: schoolId, membership_id: membershipId });
}

export async function revokeDevice(deviceId: string): Promise<void> {
  if (!navigator.onLine) throw new MembersError('Cette action demande du réseau.');
  const { error } = await supabase.rpc('revoke_device', { p_device_id: deviceId });
  if (error) throw new MembersError('Révocation impossible. Réessayez.');
}
