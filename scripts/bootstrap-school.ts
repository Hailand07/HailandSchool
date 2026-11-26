// Amorçage d'une école par l'équipe Hailand (parcours 5, lot 1.8).
// Usage :
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run bootstrap-school -- \
//     --organisation "Groupe scolaire Exemple" --ecole "GS Exemple Matoto" \
//     --fondateur "Mamadou Diallo" --telephone "620 00 00 00"
import { createClient } from '@supabase/supabase-js';
import { parseArgs } from 'node:util';
import { randomInt } from 'node:crypto';
import { normalizeGuineaPhone } from '../src/lib/phone';

const { values } = parseArgs({
  options: {
    organisation: { type: 'string' },
    ecole: { type: 'string' },
    fondateur: { type: 'string' },
    telephone: { type: 'string' },
  },
});

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont obligatoires.');
for (const k of ['organisation', 'ecole', 'fondateur', 'telephone'] as const) {
  if (!values[k]) throw new Error(`--${k} est obligatoire.`);
}
const phone = normalizeGuineaPhone(values.telephone!);
if (!phone) throw new Error('Numéro de téléphone guinéen invalide.');

const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
const password = Array.from({ length: 10 }, () => alphabet[randomInt(alphabet.length)]).join('');

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const { data: created, error: userError } = await admin.auth.admin.createUser({
  phone, password, phone_confirm: true,
  user_metadata: { full_name: values.fondateur, must_change_password: true },
});
if (userError || !created.user) throw new Error(`Création du compte impossible : ${userError?.message}`);

const { data: schoolId, error } = await admin.rpc('admin_create_school', {
  p_organization_name: values.organisation,
  p_school_name: values.ecole,
  p_founder_id: created.user.id,
  p_founder_name: values.fondateur,
  p_founder_phone: phone,
});
if (error) throw new Error(`Création de l'école impossible : ${error.message}`);

console.log(`École créée : ${values.ecole} (${schoolId})`);
console.log(`Fondateur : ${values.fondateur}, ${phone}`);
console.log(`Mot de passe provisoire : ${password} (à changer à la première connexion)`);
