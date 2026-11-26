// Lot 1.10 — preuve du jalon de l'étape 1 :
// « Deux téléphones hors ligne se synchronisent sans perte ni doublon. »
import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDb, TEST_TABLES_SQL, createSchool, addMember, registerDevice, asUser } from '../helpers/pg';
import { PgTransport } from '../helpers/pg-transport';
import { LocalDb } from '../../src/sync/db';
import { Clock } from '../../src/sync/clock';
import { SyncEngine } from '../../src/sync/engine';
import { insertLocal, upsertLocal, type WriteContext } from '../../src/sync/store';
import { APP_TABLES } from '../../src/sync/tables';
import { AccessRevokedError, NetworkError, type TableDef } from '../../src/sync/types';

const TABLES: TableDef[] = [
  ...APP_TABLES,
  { name: 'test_notes', mode: 'lww' },
  { name: 'test_ledger', mode: 'append_only' },
];

interface Phone {
  db: LocalDb;
  transport: PgTransport;
  engine: SyncEngine;
  ctx: WriteContext;
  clock: Clock;
  deviceId: string;
}

async function makePhone(server: PGlite, userId: string, schoolId: string): Promise<Phone> {
  const { deviceId } = await registerDevice(server, userId, schoolId);
  const db = new LocalDb(`phone-${randomUUID()}`, TABLES);
  const clock = new Clock();
  const transport = new PgTransport(server, userId);
  const engine = new SyncEngine(db, transport, { schoolId, deviceId, clock }, { batchSize: 7, pullLimit: 13 });
  return { db, transport, engine, clock, deviceId, ctx: { db, schoolId, clock } };
}

async function snapshot(db: LocalDb, table: string) {
  const rows = await db.data(table).toArray();
  return rows
    .map(({ id, title, amount, label }) => ({ id, title, amount, label }))
    .sort((x, y) => x.id.localeCompare(y.id));
}

async function serverSnapshot(server: PGlite, userId: string, table: string) {
  const res = await asUser(server, userId, (tx) =>
    tx.query<{ id: string; title?: string; amount: number; label?: string }>(`select * from public.${table}`));
  return res.rows
    .map(({ id, title, amount, label }) => ({ id, title, amount, label }))
    .sort((x, y) => x.id.localeCompare(y.id));
}

describe('deux téléphones hors ligne (jalon de l’étape 1)', () => {
  let server: PGlite;
  let schoolId: string;
  let founderId: string;
  let comptableId: string;

  beforeEach(async () => {
    server = await createTestDb(TEST_TABLES_SQL);
    ({ schoolId, founderId } = await createSchool(server, 'Groupe scolaire Test', '+224620000100'));
    comptableId = await addMember(server, schoolId, '+224620000101', 'comptable');
  });

  it('convergent vers le même état, sans perte ni doublon, malgré une coupure en plein envoi', async () => {
    const p1 = await makePhone(server, founderId, schoolId);
    const p2 = await makePhone(server, comptableId, schoolId);

    // Une note partagée existe avant la coupure, connue des deux téléphones.
    const noteId = randomUUID();
    await upsertLocal(p1.ctx, 'test_notes', noteId, { title: 'Grille 2026-2027', amount: 0 });
    await p1.engine.syncOnce();
    await p2.engine.syncOnce();
    expect(await p2.db.data('test_notes').get(noteId)).toMatchObject({ title: 'Grille 2026-2027' });

    // Coupure : les deux téléphones travaillent sans réseau.
    p1.transport.online = false;
    p2.transport.online = false;

    for (let i = 0; i < 40; i++) await insertLocal(p1.ctx, 'test_ledger', { amount: 10_000 + i, label: `P1-${i}` });
    for (let i = 0; i < 35; i++) await insertLocal(p2.ctx, 'test_ledger', { amount: 20_000 + i, label: `P2-${i}` });

    // Modifications concurrentes de la même note : champs différents, puis même champ.
    p1.clock.offsetMs = 0;
    await upsertLocal(p1.ctx, 'test_notes', noteId, { amount: 150_000 });
    p2.clock.offsetMs = 60_000; // écrit « plus tard »
    await upsertLocal(p2.ctx, 'test_notes', noteId, { title: 'Grille corrigée' });
    p1.clock.offsetMs = 30_000;
    await upsertLocal(p1.ctx, 'test_notes', noteId, { title: 'Grille P1' });

    await expect(p1.engine.syncOnce()).rejects.toBeInstanceOf(NetworkError);
    expect(p1.engine.getState().status).toBe('offline');
    expect(await p1.db.outbox.count()).toBe(42);

    // Retour du réseau, mais la réponse du premier lot de P1 se perd après traitement par le serveur.
    p1.transport.online = true;
    p2.transport.online = true;
    p1.transport.loseNextResponses = 1;
    await expect(p1.engine.syncOnce()).rejects.toBeInstanceOf(NetworkError);
    await p1.engine.syncOnce(); // renvoi du lot perdu : opérations reconnues comme déjà reçues
    await p2.engine.syncOnce();
    await p1.engine.syncOnce();

    // Plus rien en attente, rien de rejeté.
    for (const p of [p1, p2]) {
      expect(await p.db.outbox.count()).toBe(0);
      expect(await p.db.rejected.count()).toBe(0);
      expect(p.engine.getState()).toMatchObject({ status: 'idle', pending: 0 });
    }

    // Aucune perte, aucun doublon : 75 paiements exactement, partout identiques.
    const server75 = await serverSnapshot(server, founderId, 'test_ledger');
    expect(server75).toHaveLength(75);
    expect(new Set(server75.map((r) => r.label)).size).toBe(75);
    expect(await snapshot(p1.db, 'test_ledger')).toEqual(server75);
    expect(await snapshot(p2.db, 'test_ledger')).toEqual(server75);

    // Note : amount vient de P1 (seul à l'avoir changé), title de P2 (écrit le plus tard).
    const notes = await serverSnapshot(server, founderId, 'test_notes');
    expect(notes).toEqual([{ id: noteId, title: 'Grille corrigée', amount: 150_000, label: undefined }]);
    expect(await snapshot(p1.db, 'test_notes')).toEqual(notes);
    expect(await snapshot(p2.db, 'test_notes')).toEqual(notes);
  });

  it("ne remplace jamais une saisie locale pas encore envoyée par la version du serveur", async () => {
    const p1 = await makePhone(server, founderId, schoolId);
    const p2 = await makePhone(server, comptableId, schoolId);
    const noteId = randomUUID();
    await upsertLocal(p1.ctx, 'test_notes', noteId, { title: 'A', amount: 1 });
    await p1.engine.syncOnce();
    await p2.engine.syncOnce();

    // P2 modifie amount hors ligne ; P1 modifie title et synchronise.
    p2.transport.online = false;
    await upsertLocal(p2.ctx, 'test_notes', noteId, { amount: 99 });
    await upsertLocal(p1.ctx, 'test_notes', noteId, { title: 'B' });
    await p1.engine.syncOnce();

    // P2 reçoit le changement de title sans perdre son amount en attente.
    p2.transport.online = true;
    await p2.engine['pull']();
    expect(await p2.db.data('test_notes').get(noteId)).toMatchObject({ title: 'B', amount: 99 });
    await p2.engine.syncOnce();
    await p1.engine.syncOnce();
    expect(await p1.db.data('test_notes').get(noteId)).toMatchObject({ title: 'B', amount: 99 });
  });

  it("met de côté une opération refusée et retire la ligne jamais acceptée", async () => {
    const teacherId = await addMember(server, schoolId, '+224620000102', 'enseignant');
    const p = await makePhone(server, teacherId, schoolId);
    const row = await insertLocal(p.ctx, 'test_ledger', { amount: 5_000, label: 'interdit' });
    await p.engine.syncOnce();
    expect(await p.db.outbox.count()).toBe(0);
    const rejected = await p.db.rejected.toArray();
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ row_id: row.id, fields: { label: 'interdit' } });
    expect(await p.db.data('test_ledger').get(row.id)).toBeUndefined();
    expect(p.engine.getState().rejected).toBe(1);
  });

  it("signale la révocation de l'appareil", async () => {
    const p = await makePhone(server, comptableId, schoolId);
    await asUser(server, founderId, (tx) => tx.query('select public.revoke_device($1)', [p.deviceId]));
    await insertLocal(p.ctx, 'test_ledger', { amount: 1_000, label: 'après révocation' });
    await expect(p.engine.syncOnce()).rejects.toBeInstanceOf(AccessRevokedError);
    expect(p.engine.getState().status).toBe('revoked');
  });

  it('corrige les heures d’écriture d’un téléphone dont l’horloge est fausse', () => {
    const clock = new Clock();
    const serverNow = Date.parse('2026-11-26T10:00:00Z');
    const phoneNow = serverNow - 3 * 3600_000; // téléphone en retard de 3 heures
    clock.observe(new Date(serverNow).toISOString(), phoneNow - 200, phoneNow + 200);
    expect(clock.offsetMs).toBe(3 * 3600_000);
  });
});
