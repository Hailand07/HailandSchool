// Écritures locales (lot 1.5) : chaque écriture modifie la base locale ET ajoute une opération
// à la file, dans la même transaction. Rien n'est jamais écrit hors de cette voie.
import type { LocalDb } from './db';
import type { Row } from './types';
import type { Clock } from './clock';
import { uuid } from '../lib/uuid';

export interface WriteContext {
  db: LocalDb;
  schoolId: string;
  clock: Clock;
  /** Prévient le moteur de synchronisation qu'une opération attend. */
  onWrite?: () => void;
}

/** Crée ou modifie une ligne d'une table « dernière écriture gagnante ». */
export async function upsertLocal(
  ctx: WriteContext,
  table: string,
  id: string,
  fields: Record<string, unknown>,
): Promise<Row> {
  const def = ctx.db.defs.get(table);
  if (def?.mode !== 'lww') throw new Error(`upsertLocal : ${table} n'est pas une table lww`);
  if (Object.keys(fields).length === 0) throw new Error('upsertLocal : aucun champ');
  const now = ctx.clock.now();
  const tbl = ctx.db.data(table);

  const row = await ctx.db.transaction('rw', tbl, ctx.db.outbox, async () => {
    const existing = await tbl.get(id);
    const clock = { ...(existing?.field_clock ?? {}) };
    for (const k of Object.keys(fields)) clock[k] = now;
    const next: Row = { ...(existing ?? { id, school_id: ctx.schoolId }), ...fields, field_clock: clock };
    await tbl.put(next);
    await ctx.db.outbox.add({ op_id: uuid(), table, row_id: id, kind: 'upsert', fields, client_time: now });
    return next;
  });
  ctx.onWrite?.();
  return row;
}

/** Ajoute une ligne à une table en ajout seul (paiements, etc.). */
export async function insertLocal(
  ctx: WriteContext,
  table: string,
  fields: Record<string, unknown>,
  id: string = uuid(),
): Promise<Row> {
  const def = ctx.db.defs.get(table);
  if (def?.mode !== 'append_only') throw new Error(`insertLocal : ${table} n'est pas une table en ajout seul`);
  const now = ctx.clock.now();
  const tbl = ctx.db.data(table);

  const row = await ctx.db.transaction('rw', tbl, ctx.db.outbox, async () => {
    if (await tbl.get(id)) throw new Error(`insertLocal : ${table}/${id} existe déjà`);
    const next: Row = { ...fields, id, school_id: ctx.schoolId, created_at: now };
    await tbl.put(next);
    await ctx.db.outbox.add({ op_id: uuid(), table, row_id: id, kind: 'insert', fields, client_time: now });
    return next;
  });
  ctx.onWrite?.();
  return row;
}

export async function pendingCount(db: LocalDb): Promise<number> {
  return db.outbox.count();
}
