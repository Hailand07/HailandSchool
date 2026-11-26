import Dexie, { type Table } from 'dexie';
import type { OutboxEntry, RejectedEntry, Row, TableDef } from './types';

export interface MetaEntry {
  key: string;
  value: unknown;
}

/** Base locale d'un appareil : copie des données de l'école, file d'opérations, réglages. */
export class LocalDb extends Dexie {
  outbox!: Table<OutboxEntry, number>;
  rejected!: Table<RejectedEntry, string>;
  meta!: Table<MetaEntry, string>;
  readonly defs: Map<string, TableDef>;

  constructor(name: string, tables: TableDef[], version = 1) {
    super(name);
    this.defs = new Map(tables.map((t) => [t.name, t]));
    const stores: Record<string, string> = {
      outbox: '++seq, &op_id, row_id',
      rejected: '&op_id, table',
      meta: '&key',
    };
    for (const t of tables) {
      stores[t.name] = ['id', 'school_id', 'server_seq', ...(t.indexes ?? [])].join(', ');
    }
    this.version(version).stores(stores);
  }

  data(name: string): Table<Row, string> {
    if (!this.defs.has(name)) throw new Error(`Table non synchronisée : ${name}`);
    return this.table(name);
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await this.meta.get(key))?.value as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.meta.put({ key, value });
  }
}
