// Lots 1.2 à 1.4 : schéma, isolation par école, protocole de synchronisation.
import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import {
  createTestDb, TEST_TABLES_SQL, asUser, one, createSchool, addMember, registerDevice,
} from '../helpers/pg';

type Result = { op_id: string; status: string; error?: string; row: Record<string, unknown> | null };

async function apply(db: PGlite, userId: string, deviceId: string, ops: unknown[]) {
  const r = await asUser(db, userId, (tx) =>
    one<{ r: { results: Result[] } }>(tx, 'select public.apply_operations($1, $2) as r', [deviceId, JSON.stringify(ops)]),
  );
  return r.r.results;
}

async function pull(db: PGlite, userId: string, schoolId: string, cursor = 0, limit = 500) {
  const r = await asUser(db, userId, (tx) =>
    one<{ r: { changes: { table: string; row: Record<string, unknown> }[]; cursor: number; has_more: boolean } }>(
      tx, 'select public.pull_changes($1, $2, $3) as r', [schoolId, cursor, limit]),
  );
  return r.r;
}

function upsert(table: string, rowId: string, fields: Record<string, unknown>, clientTime = new Date().toISOString()) {
  return { op_id: randomUUID(), table, row_id: rowId, kind: 'upsert', fields, client_time: clientTime };
}

describe('socle serveur', () => {
  let db: PGlite;
  let a: { schoolId: string; founderId: string };
  let b: { schoolId: string; founderId: string };

  beforeEach(async () => {
    db = await createTestDb(TEST_TABLES_SQL);
    a = await createSchool(db, 'École A', '+224620000001');
    b = await createSchool(db, 'École B', '+224620000002');
  });

  describe('isolation par école (lot 1.3)', () => {
    it("un fondateur ne voit que son école, ses membres et son organisation", async () => {
      const seen = await asUser(db, a.founderId, async (tx) => ({
        schools: (await tx.query<{ id: string }>('select id from public.schools')).rows.map((r) => r.id),
        members: (await tx.query('select 1 from public.memberships')).rows.length,
        orgs: (await tx.query('select 1 from public.organizations')).rows.length,
      }));
      expect(seen.schools).toEqual([a.schoolId]);
      expect(seen.members).toBe(1);
      expect(seen.orgs).toBe(1);
    });

    it("une écriture visant une autre école est refusée et ne laisse aucune trace", async () => {
      const { deviceId } = await registerDevice(db, a.founderId, a.schoolId);
      // Le fondateur de B crée une note dans B.
      const devB = await registerDevice(db, b.founderId, b.schoolId);
      const noteB = randomUUID();
      await apply(db, b.founderId, devB.deviceId, [upsert('test_notes', noteB, { title: 'B' })]);

      // A tente de modifier la note de B en connaissant son identifiant.
      const [res] = await apply(db, a.founderId, deviceId, [upsert('test_notes', noteB, { title: 'piraté' })]);
      expect(res!.status).toBe('rejected');
      expect(res!.row).toBeNull();
      const stored = await asUser(db, b.founderId, (tx) => one<{ title: string }>(tx, 'select title from public.test_notes where id = $1', [noteB]));
      expect(stored.title).toBe('B');
    });

    it("un client ne peut pas modifier directement une colonne protégée", async () => {
      await expect(
        asUser(db, a.founderId, (tx) => tx.query('update public.schools set next_device_index = 99 where id = $1', [a.schoolId])),
      ).rejects.toThrow(/permission denied/);
    });

    it("un client ne peut ni lire ni appeler les fonctions d'administration", async () => {
      await expect(
        asUser(db, a.founderId, (tx) =>
          tx.query('select public.admin_add_member($1, $2, $3, $4, $5)', [a.schoolId, a.founderId, 'x', '+224620000009', 'fondateur'])),
      ).rejects.toThrow(/permission denied/);
    });

    it("un rôle sans droit d'écriture voit son opération refusée", async () => {
      const teacher = await addMember(db, a.schoolId, '+224620000010', 'enseignant');
      const { deviceId } = await registerDevice(db, teacher, a.schoolId);
      const [res] = await apply(db, teacher, deviceId, [upsert('test_notes', randomUUID(), { title: 'x' })]);
      expect(res!.status).toBe('rejected');
      expect(res!.error).toMatch(/row-level security/);
    });
  });

  describe('appareils et préfixes de reçu (lot 1.4)', () => {
    it('attribue A, B, C… par école, et renvoie le même préfixe au réenregistrement', async () => {
      const comptable = await addMember(db, a.schoolId, '+224620000011', 'comptable');
      const d1 = await registerDevice(db, a.founderId, a.schoolId);
      const d2 = await registerDevice(db, comptable, a.schoolId);
      const dB = await registerDevice(db, b.founderId, b.schoolId);
      expect([d1.receiptPrefix, d2.receiptPrefix, dB.receiptPrefix]).toEqual(['A', 'B', 'A']);

      const again = await asUser(db, comptable, (tx) =>
        one<{ d: { receipt_prefix: string } }>(tx, 'select public.register_device($1, $2) as d', [a.schoolId, d2.deviceId]));
      expect(again.d.receipt_prefix).toBe('B');
    });

    it('calcule les préfixes au-delà de Z', async () => {
      const r = await one<{ p: string[] }>(db, 'select array[public.device_prefix(0), public.device_prefix(25), public.device_prefix(26), public.device_prefix(701), public.device_prefix(702)] as p');
      expect(r.p).toEqual(['A', 'Z', 'AA', 'ZZ', 'AAA']);
    });

    it("un appareil révoqué ne peut plus envoyer d'opérations", async () => {
      const comptable = await addMember(db, a.schoolId, '+224620000012', 'comptable');
      const { deviceId } = await registerDevice(db, comptable, a.schoolId);
      await asUser(db, a.founderId, (tx) => tx.query('select public.revoke_device($1)', [deviceId]));
      await expect(apply(db, comptable, deviceId, [])).rejects.toThrow(/device_revoked/);
    });

    it("seul le fondateur peut révoquer un appareil", async () => {
      const comptable = await addMember(db, a.schoolId, '+224620000013', 'comptable');
      const { deviceId } = await registerDevice(db, a.founderId, a.schoolId);
      await expect(asUser(db, comptable, (tx) => tx.query('select public.revoke_device($1)', [deviceId]))).rejects.toThrow(/forbidden/);
    });
  });

  describe('application des opérations (lot 1.4)', () => {
    it('une opération renvoyée deux fois ne produit aucun effet en double', async () => {
      const { deviceId } = await registerDevice(db, a.founderId, a.schoolId);
      const op = { op_id: randomUUID(), table: 'test_ledger', row_id: randomUUID(), kind: 'insert', fields: { amount: 500000, label: 'Scolarité' } };
      const [first] = await apply(db, a.founderId, deviceId, [op]);
      const [second] = await apply(db, a.founderId, deviceId, [op]);
      expect(first!.status).toBe('applied');
      expect(second!.status).toBe('duplicate');
      const n = await asUser(db, a.founderId, (tx) => one<{ n: number }>(tx, 'select count(*)::int as n from public.test_ledger'));
      expect(n.n).toBe(1);
    });

    it('une table en ajout seul refuse toute modification', async () => {
      const { deviceId } = await registerDevice(db, a.founderId, a.schoolId);
      const id = randomUUID();
      await apply(db, a.founderId, deviceId, [{ op_id: randomUUID(), table: 'test_ledger', row_id: id, kind: 'insert', fields: { amount: 1000, label: 'x' } }]);
      const [asUpsert] = await apply(db, a.founderId, deviceId, [upsert('test_ledger', id, { amount: 1 })]);
      const [reinsert] = await apply(db, a.founderId, deviceId, [{ op_id: randomUUID(), table: 'test_ledger', row_id: id, kind: 'insert', fields: { amount: 1, label: 'y' } }]);
      expect(asUpsert!.status).toBe('rejected');
      expect(reinsert!.error).toMatch(/already_exists/);
      await expect(asUser(db, a.founderId, (tx) => tx.query('update public.test_ledger set amount = 1'))).rejects.toThrow(/permission denied/);
    });

    it('dernière écriture gagnante, champ par champ', async () => {
      const { deviceId } = await registerDevice(db, a.founderId, a.schoolId);
      const id = randomUUID();
      const t = (s: number) => new Date(Date.UTC(2026, 10, 26, 8, 0, s)).toISOString();
      await apply(db, a.founderId, deviceId, [upsert('test_notes', id, { title: 'v1', amount: 1 }, t(0))]);
      // Écriture tardive sur title, puis écriture plus ancienne sur title et amount arrivée après.
      await apply(db, a.founderId, deviceId, [upsert('test_notes', id, { title: 'récent' }, t(30))]);
      const [res] = await apply(db, a.founderId, deviceId, [upsert('test_notes', id, { title: 'ancien', amount: 2 }, t(10))]);
      expect(res!.status).toBe('applied');
      expect(res!.row).toMatchObject({ title: 'récent', amount: 2 });
    });

    it("refuse une colonne hors de la liste blanche", async () => {
      const { deviceId } = await registerDevice(db, a.founderId, a.schoolId);
      const [res] = await apply(db, a.founderId, deviceId, [upsert('test_notes', randomUUID(), { title: 'x', server_seq: 1 })]);
      expect(res!.error).toMatch(/column_not_writable: server_seq/);
    });

    it("refuse une table en lecture seule pour les clients", async () => {
      const { deviceId } = await registerDevice(db, a.founderId, a.schoolId);
      const [res] = await apply(db, a.founderId, deviceId, [upsert('memberships', randomUUID(), { role: 'fondateur' })]);
      expect(res!.error).toMatch(/table_not_writable/);
    });

    it("la direction peut modifier les paramètres de l'école, pas le comptable", async () => {
      const direction = await addMember(db, a.schoolId, '+224620000014', 'direction');
      const comptable = await addMember(db, a.schoolId, '+224620000015', 'comptable');
      const dDir = await registerDevice(db, direction, a.schoolId);
      const dCpt = await registerDevice(db, comptable, a.schoolId);
      const [ok] = await apply(db, direction, dDir.deviceId, [upsert('schools', a.schoolId, { commune: 'Ratoma' })]);
      const [ko] = await apply(db, comptable, dCpt.deviceId, [upsert('schools', a.schoolId, { commune: 'Matoto' })]);
      expect(ok!.row).toMatchObject({ commune: 'Ratoma' });
      expect(ko!.status).toBe('rejected');
    });

    it("trace chaque écriture dans le journal d'audit, lisible par le fondateur seul", async () => {
      const comptable = await addMember(db, a.schoolId, '+224620000016', 'comptable');
      const { deviceId } = await registerDevice(db, comptable, a.schoolId);
      const id = randomUUID();
      await apply(db, comptable, deviceId, [upsert('test_notes', id, { title: 'x' })]);
      const audit = await asUser(db, a.founderId, (tx) =>
        one<{ user_id: string; device_id: string; action: string }>(tx, "select user_id, device_id, action from public.audit_log where row_id = $1", [id]));
      expect(audit).toMatchObject({ user_id: comptable, device_id: deviceId, action: 'insert' });
      const seenByComptable = await asUser(db, comptable, (tx) => tx.query('select 1 from public.audit_log'));
      expect(seenByComptable.rows).toHaveLength(0);
    });

    it("une horloge de téléphone très en avance ne gagne pas pour toujours", async () => {
      const { deviceId } = await registerDevice(db, a.founderId, a.schoolId);
      const id = randomUUID();
      await apply(db, a.founderId, deviceId, [upsert('test_notes', id, { title: 'futur' }, '2099-01-01T00:00:00Z')]);
      const [res] = await apply(db, a.founderId, deviceId, [upsert('test_notes', id, { title: 'maintenant' }, new Date(Date.now() + 10 * 60_000).toISOString())]);
      expect(res!.row).toMatchObject({ title: 'maintenant' });
    });
  });

  describe('lecture des changements (lot 1.4)', () => {
    it("renvoie les changements dans l'ordre, par pages, sans ceux d'une autre école", async () => {
      const { deviceId } = await registerDevice(db, a.founderId, a.schoolId);
      const devB = await registerDevice(db, b.founderId, b.schoolId);
      const ops = Array.from({ length: 5 }, (_, i) => upsert('test_notes', randomUUID(), { title: `n${i}` }));
      await apply(db, a.founderId, deviceId, ops);
      await apply(db, b.founderId, devB.deviceId, [upsert('test_notes', randomUUID(), { title: 'secret B' })]);

      const titles: string[] = [];
      let cursor = 0;
      for (;;) {
        const page = await pull(db, a.founderId, a.schoolId, cursor, 2);
        for (const c of page.changes) if (c.table === 'test_notes') titles.push(c.row.title as string);
        expect(page.cursor).toBeGreaterThanOrEqual(cursor);
        cursor = page.cursor;
        if (!page.has_more) break;
      }
      expect(titles).toEqual(['n0', 'n1', 'n2', 'n3', 'n4']);
    });

    it("refuse la lecture d'une école dont on n'est pas membre", async () => {
      await expect(pull(db, a.founderId, b.schoolId)).rejects.toThrow(/not_member/);
    });
  });
});

describe('droits par défaut de Supabase', () => {
  it("anon et authenticated n'ont accès à aucune fonction d'administration ni table interne", async () => {
    const db = await createTestDb(TEST_TABLES_SQL);
    const res = await db.query<{ obj: string; role: string }>(`
      select p.proname as obj, r.rolname as role
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      cross join pg_roles r
      where n.nspname = 'public' and r.rolname in ('anon', 'authenticated')
        and (p.proname like 'admin\\_%' or p.proname in ('make_synced', 'sync_touch', 'audit_row'))
        and has_function_privilege(r.oid, p.oid, 'execute')
      union all
      select c.relname, r.rolname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join pg_roles r
      where n.nspname = 'public' and c.relkind in ('r', 'S') and r.rolname = 'anon'
        and (has_table_privilege(r.oid, c.oid, 'select') or has_table_privilege(r.oid, c.oid, 'insert')
          or (c.relkind = 'S' and has_sequence_privilege(r.oid, c.oid, 'usage')))`);
    expect(res.rows).toEqual([]);
  });
});
