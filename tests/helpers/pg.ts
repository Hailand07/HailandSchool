// Banc de test PostgreSQL : PGlite (PostgreSQL 17 en WebAssembly) + imitation du schéma auth de Supabase.
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../supabase/migrations', import.meta.url));

const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, phone text);
create function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
-- Droits par défaut d'un projet Supabase : tout nouvel objet de public est ouvert à anon et authenticated.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

export type Tx = Transaction;

export async function createTestDb(extraSql = ''): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  if (extraSql) await db.exec(extraSql);
  return db;
}

/** Exécute fn dans une transaction, avec le rôle et l'identité d'un utilisateur connecté. */
export async function asUser<T>(db: PGlite, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec('set local role authenticated');
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    return fn(tx);
  });
}

export async function asService<T>(db: PGlite, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec('set local role service_role');
    return fn(tx);
  });
}

export async function one<T = Record<string, unknown>>(tx: Tx | PGlite, sql: string, params: unknown[] = []): Promise<T> {
  const res = await tx.query<T>(sql, params);
  return res.rows[0] as T;
}

/** Crée un utilisateur auth et renvoie son id. */
export async function createAuthUser(db: PGlite, phone: string): Promise<string> {
  const id = randomUUID();
  await db.query('insert into auth.users (id, phone) values ($1, $2)', [id, phone]);
  return id;
}

/** Crée une école avec son fondateur. */
export async function createSchool(db: PGlite, name: string, founderPhone: string) {
  const founderId = await createAuthUser(db, founderPhone);
  const { school_id } = await asService(db, (tx) =>
    one<{ school_id: string }>(
      tx,
      'select public.admin_create_school($1, $2, $3, $4, $5) as school_id',
      [`Groupe ${name}`, name, founderId, `Fondateur ${name}`, founderPhone],
    ),
  );
  return { schoolId: school_id, founderId };
}

export async function addMember(db: PGlite, schoolId: string, phone: string, role: string) {
  const userId = await createAuthUser(db, phone);
  await asService(db, (tx) =>
    tx.query('select public.admin_add_member($1, $2, $3, $4, $5)', [schoolId, userId, `Membre ${phone}`, phone, role]),
  );
  return userId;
}

export async function registerDevice(db: PGlite, userId: string, schoolId: string, label = 'test') {
  const deviceId = randomUUID();
  const row = await asUser(db, userId, (tx) =>
    one<{ d: { receipt_prefix: string } }>(tx, 'select public.register_device($1, $2, $3) as d', [schoolId, deviceId, label]),
  );
  return { deviceId, receiptPrefix: row.d.receipt_prefix };
}

/** Tables de test synchronisées, absentes des migrations de production. */
export const TEST_TABLES_SQL = `
create table public.test_notes (
  id uuid primary key,
  school_id uuid not null references public.schools (id),
  title text not null,
  amount integer not null default 0
);
select public.make_synced('test_notes', 'lww', array['title', 'amount', 'deleted_at']);
create policy test_notes_select on public.test_notes for select to authenticated using (public.is_member(school_id));
create policy test_notes_insert on public.test_notes for insert to authenticated
  with check (public.has_role(school_id, array['fondateur', 'comptable']));
create policy test_notes_update on public.test_notes for update to authenticated
  using (public.has_role(school_id, array['fondateur', 'comptable']))
  with check (public.has_role(school_id, array['fondateur', 'comptable']));

create table public.test_ledger (
  id uuid primary key,
  school_id uuid not null references public.schools (id),
  amount integer not null check (amount > 0),
  label text not null
);
select public.make_synced('test_ledger', 'append_only', array['amount', 'label']);
create policy test_ledger_select on public.test_ledger for select to authenticated using (public.is_member(school_id));
create policy test_ledger_insert on public.test_ledger for insert to authenticated
  with check (public.has_role(school_id, array['fondateur', 'comptable']));
`;
