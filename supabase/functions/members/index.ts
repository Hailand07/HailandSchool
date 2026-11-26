// Fonction serveur « members » (lot 1.8) : le fondateur crée ou retire un membre de son école.
// Seule cette fonction détient la clé de service ; elle vérifie d'abord que l'appelant est fondateur.
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const STAFF_ROLES = ['fondateur', 'direction', 'comptable', 'secretariat', 'enseignant', 'surveillant'];
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

function normalizeGuineaPhone(input: string): string | null {
  let d = String(input ?? '').replace(/[\s.\-()]/g, '');
  if (d.startsWith('+224')) d = d.slice(4);
  else if (d.startsWith('00224')) d = d.slice(5);
  else if (d.startsWith('224') && d.length === 12) d = d.slice(3);
  return /^[36][0-9]{8}$/.test(d) ? `+224${d}` : null;
}

/** Mot de passe provisoire lisible à voix haute : pas de 0/O, 1/l/I. */
function tempPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply(405, { error: 'Méthode non autorisée.' });

  const auth = req.headers.get('Authorization');
  if (!auth) return reply(401, { error: 'Connexion requise.' });
  const asCaller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
  const { data: who } = await asCaller.auth.getUser();
  if (!who.user) return reply(401, { error: 'Connexion requise.' });

  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: 'Requête illisible.' });
  }

  const { data: isFounder } = await asCaller.rpc('has_role', { p_school: body.school_id, p_roles: ['fondateur'] });
  if (isFounder !== true) return reply(403, { error: "Seul le fondateur de l'école peut gérer les membres." });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  if (body.action === 'create') {
    const phone = normalizeGuineaPhone(body.phone);
    const fullName = String(body.full_name ?? '').trim();
    if (!phone) return reply(400, { error: 'Numéro invalide.' });
    if (!fullName) return reply(400, { error: 'Nom obligatoire.' });
    if (!STAFF_ROLES.includes(body.role)) return reply(400, { error: 'Rôle invalide.' });

    const { data: existing } = await admin.from('profiles').select('id').eq('phone', phone).maybeSingle();
    let userId = existing?.id as string | undefined;
    let password: string | null = null;
    if (!userId) {
      password = tempPassword();
      // Connexion par courriel technique dérivé du numéro (HYP-11), même règle que src/lib/phone.ts.
      const { data, error } = await admin.auth.admin.createUser({
        email: `${phone.replace(/^\+/, '')}@telephone.hailand.invalid`, password, email_confirm: true,
        user_metadata: { full_name: fullName, phone, must_change_password: true },
      });
      if (error || !data.user) {
        return reply(409, { error: 'Ce numéro a déjà un compte incomplet. Contactez le support Hailand.' });
      }
      userId = data.user.id;
    }

    const { data: membershipId, error } = await admin.rpc('admin_add_member', {
      p_school: body.school_id, p_user_id: userId, p_full_name: fullName, p_phone: phone, p_role: body.role,
    });
    if (error) return reply(500, { error: "Création de l'accès impossible." });
    return reply(200, { membership_id: membershipId, temp_password: password });
  }

  if (body.action === 'revoke') {
    const { data: m } = await admin.from('memberships').select('id, school_id, user_id, role')
      .eq('id', body.membership_id).maybeSingle();
    if (!m || m.school_id !== body.school_id) return reply(404, { error: 'Membre introuvable.' });
    if (m.user_id === who.user.id) return reply(400, { error: 'Vous ne pouvez pas retirer votre propre accès.' });
    const { error } = await admin.rpc('admin_set_membership_status', { p_membership: m.id, p_status: 'revoked' });
    if (error) return reply(500, { error: 'Retrait impossible.' });
    return reply(200, { ok: true });
  }

  return reply(400, { error: 'Action inconnue.' });
});
