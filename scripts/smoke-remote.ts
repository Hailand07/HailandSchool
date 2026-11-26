// Contrôle de bout en bout contre un vrai projet Supabase, avec les modules de l'application.
// Usage :
//   SUPABASE_URL=… SUPABASE_PUBLISHABLE_KEY=… FOUNDER_PHONE="620 00 00 01" FOUNDER_PASSWORD=… npm run smoke:remote
// Crée un membre « comptable » temporaire, le fait travailler, puis lui retire l'accès.
import 'fake-indexeddb/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID, randomInt } from 'node:crypto';
import { signIn, changePassword } from '../src/auth/login';
import { LocalDb } from '../src/sync/db';
import { Clock } from '../src/sync/clock';
import { SyncEngine } from '../src/sync/engine';
import { SupabaseTransport } from '../src/sync/supabase-transport';
import { upsertLocal } from '../src/sync/store';
import { APP_TABLES } from '../src/sync/tables';
import { AccessRevokedError } from '../src/sync/types';

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
const founderPhone = process.env.FOUNDER_PHONE!;
const founderPassword = process.env.FOUNDER_PASSWORD!;
if (!url || !key || !founderPhone || !founderPassword) {
  throw new Error('SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, FOUNDER_PHONE et FOUNDER_PASSWORD sont obligatoires.');
}

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'OK ' : 'ÉCHEC'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

function client(): SupabaseClient {
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function device(c: SupabaseClient, schoolId: string, label: string) {
  const deviceId = randomUUID();
  const { data, error } = await c.rpc('register_device', { p_school: schoolId, p_device_id: deviceId, p_label: label });
  if (error) throw new Error(`register_device : ${error.message}`);
  const db = new LocalDb(`smoke-${deviceId}`, APP_TABLES);
  const clock = new Clock();
  const engine = new SyncEngine(db, new SupabaseTransport(c), { schoolId, deviceId, clock });
  return { deviceId, prefix: (data as { receipt_prefix: string }).receipt_prefix, db, clock, engine };
}

// 1. Connexion du fondateur
const founder = client();
const f = await signIn(founder, founderPhone, founderPassword);
const school = f.schools[0]!;
check('connexion du fondateur par numéro et mot de passe', f.schools.length > 0, `${f.fullName}, ${school.schoolName}`);
check('rôle fondateur reconnu', school.roles.includes('fondateur'));

// 2. Appareil et première synchronisation
const p1 = await device(founder, school.schoolId, 'smoke fondateur');
check('appareil enregistré avec un préfixe de reçu', /^[A-Z]+$/.test(p1.prefix), p1.prefix);
await p1.engine.syncOnce();
check('première synchronisation', (await p1.db.data('schools').count()) === 1);

// 3. Création d'un comptable par la fonction serveur members
const testPhone = `6${String(randomInt(10_000_000, 99_999_999))}`;
const created = await founder.functions.invoke('members', {
  body: { action: 'create', school_id: school.schoolId, full_name: 'Comptable Smoke', phone: testPhone, role: 'comptable' },
});
const tempPassword = (created.data as { temp_password?: string } | null)?.temp_password;
check('fonction members : création d’un comptable', !created.error && Boolean(tempPassword), created.error?.message);

// 4. Le fondateur modifie l'école ; la modification part au serveur
const commune = `Ratoma ${Date.now()}`;
await upsertLocal({ db: p1.db, schoolId: school.schoolId, clock: p1.clock }, 'schools', school.schoolId, { commune });
await p1.engine.syncOnce();
const { data: srv } = await founder.from('schools').select('commune').eq('id', school.schoolId).single();
check('écriture locale envoyée et appliquée sur le serveur', srv?.commune === commune);
check('file vide après synchronisation', (await p1.db.outbox.count()) === 0);
const members = await p1.db.data('memberships').toArray();
check('le nouveau membre arrive sur le téléphone du fondateur', members.some((m) => m.full_name === 'Comptable Smoke'));

// 5. Le comptable se connecte avec son mot de passe provisoire, le change, travaille
const comptable = client();
const c = await signIn(comptable, testPhone, tempPassword!);
check('le mot de passe provisoire impose un changement', c.mustChangePassword);
await changePassword(comptable, `nouveau-${randomUUID().slice(0, 8)}`);
const p2 = await device(comptable, school.schoolId, 'smoke comptable');
check('deuxième appareil, préfixe différent', p2.prefix !== p1.prefix, p2.prefix);
await p2.engine.syncOnce();
await upsertLocal({ db: p2.db, schoolId: school.schoolId, clock: p2.clock }, 'schools', school.schoolId, { commune: 'Matoto' });
await p2.engine.syncOnce();
check('le comptable ne peut pas modifier les paramètres de l’école', (await p2.db.rejected.count()) === 1);
const { data: srv2 } = await founder.from('schools').select('commune').eq('id', school.schoolId).single();
check('le serveur a gardé la valeur du fondateur', srv2?.commune === commune);
check('le téléphone du comptable est revenu à la valeur du serveur', (await p2.db.data('schools').get(school.schoolId))?.commune === commune);

// 6. Sécurité : fonctions d'administration et autre école
const { error: adminErr } = await comptable.rpc('admin_add_member', {
  p_school: school.schoolId, p_user_id: c.user.id, p_full_name: 'x', p_phone: '+224620000009', p_role: 'fondateur',
});
check('un utilisateur connecté ne peut pas appeler admin_add_member', Boolean(adminErr), adminErr?.message);
const { error: pullErr } = await comptable.rpc('pull_changes', { p_school: randomUUID(), p_cursor: 0, p_limit: 10 });
check('lecture d’une école inconnue refusée', Boolean(pullErr), pullErr?.message);
const anon = client();
const { data: anonRows } = await anon.from('schools').select('id');
check('un visiteur non connecté ne voit aucune école', (anonRows ?? []).length === 0);

// 7. Retrait de l'accès : le téléphone du comptable est bloqué
const membershipId = (created.data as { membership_id: string }).membership_id;
const revoked = await founder.functions.invoke('members', {
  body: { action: 'revoke', school_id: school.schoolId, membership_id: membershipId },
});
check('fonction members : retrait de l’accès', !revoked.error, revoked.error?.message);
let blocked = false;
try {
  await p2.engine.syncOnce();
} catch (e) {
  blocked = e instanceof AccessRevokedError;
}
check('le téléphone du comptable est bloqué après le retrait', blocked && p2.engine.getState().status === 'revoked');

console.log(failures === 0 ? '\nTout est conforme.' : `\n${failures} contrôle(s) en échec.`);
process.exit(failures === 0 ? 0 : 1);
