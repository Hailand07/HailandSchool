// Moteur de synchronisation (lot 1.6) : envoie la file par lots, reçoit les changements,
// reprend après une coupure sans perte ni doublon.
import type { LocalDb } from './db';
import type { Clock } from './clock';
import {
  AccessRevokedError, NetworkError,
  type ApplyResult, type OutboxEntry, type Row, type Transport,
} from './types';

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error' | 'revoked';

export interface SyncState {
  status: SyncStatus;
  pending: number;
  rejected: number;
  lastSyncAt: string | null;
  error: string | null;
}

export interface SyncOptions {
  batchSize?: number;
  pullLimit?: number;
  /** Intervalle de synchronisation automatique, en millisecondes. */
  intervalMs?: number;
}

const CURSOR_KEY = 'sync_cursor';
const LAST_SYNC_KEY = 'last_sync_at';
const CLOCK_KEY = 'clock_offset_ms';

export class SyncEngine {
  private state: SyncState = { status: 'idle', pending: 0, rejected: 0, lastSyncAt: null, error: null };
  private listeners = new Set<(s: SyncState) => void>();
  private running: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private stopped = true;
  private readonly batchSize: number;
  private readonly pullLimit: number;
  private readonly intervalMs: number;

  constructor(
    private readonly db: LocalDb,
    private readonly transport: Transport,
    private readonly ctx: { schoolId: string; deviceId: string; clock: Clock },
    options: SyncOptions = {},
  ) {
    this.batchSize = options.batchSize ?? 100;
    this.pullLimit = options.pullLimit ?? 500;
    this.intervalMs = options.intervalMs ?? 30_000;
  }

  // ---------- État observable

  getState(): SyncState {
    return this.state;
  }

  subscribe(listener: (s: SyncState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private async setState(patch: Partial<SyncState>): Promise<void> {
    const [pending, rejected] = await Promise.all([this.db.outbox.count(), this.db.rejected.count()]);
    this.state = { ...this.state, pending, rejected, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  async refresh(): Promise<void> {
    const lastSyncAt = (await this.db.getMeta<string>(LAST_SYNC_KEY)) ?? null;
    const offset = await this.db.getMeta<number>(CLOCK_KEY);
    if (typeof offset === 'number') this.ctx.clock.offsetMs = offset;
    await this.setState({ lastSyncAt });
  }

  // ---------- Synchronisation

  /** Une passe complète : envoi de toute la file, puis réception de tous les changements. */
  syncOnce(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.runPass();
        } while (this.again);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async runPass(): Promise<void> {
    await this.setState({ status: 'syncing', error: null });
    try {
      await this.push();
      await this.pull();
      const now = this.ctx.clock.now();
      await this.db.setMeta(LAST_SYNC_KEY, now);
      this.failures = 0;
      await this.setState({ status: 'idle', lastSyncAt: now });
    } catch (e) {
      this.failures++;
      if (e instanceof AccessRevokedError) {
        await this.setState({ status: 'revoked', error: e.message });
        this.stop();
      } else if (e instanceof NetworkError) {
        await this.setState({ status: 'offline', error: null });
      } else {
        await this.setState({ status: 'error', error: e instanceof Error ? e.message : String(e) });
      }
      throw e;
    }
  }

  private async push(): Promise<void> {
    for (;;) {
      const batch = await this.db.outbox.orderBy('seq').limit(this.batchSize).toArray();
      if (batch.length === 0) return;
      const sentAt = Date.now();
      const res = await this.transport.applyOperations(
        this.ctx.deviceId,
        batch.map(({ seq: _seq, ...op }) => op),
      );
      this.observeClock(res.server_time, sentAt);
      const byId = new Map(batch.map((op) => [op.op_id, op]));
      for (const r of res.results) {
        const op = byId.get(r.op_id);
        if (op) await this.settle(op, r);
      }
    }
  }

  /** Retire l'opération de la file et aligne la ligne locale sur la réponse du serveur. */
  private async settle(op: OutboxEntry, r: ApplyResult): Promise<void> {
    const tbl = this.db.data(op.table);
    await this.db.transaction('rw', tbl, this.db.outbox, this.db.rejected, async () => {
      await this.db.outbox.where('op_id').equals(op.op_id).delete();
      if (r.status === 'rejected') {
        const { seq: _seq, ...rest } = op;
        await this.db.rejected.put({ ...rest, error: r.error ?? 'rejected', rejected_at: new Date().toISOString() });
      }
      if (r.row) {
        await this.applyServerRow(op.table, r.row);
      } else if (r.status === 'rejected') {
        const stillPending = await this.db.outbox.where('row_id').equals(op.row_id).count();
        const local = await tbl.get(op.row_id);
        // Ligne créée sur ce téléphone et jamais acceptée : on la retire. Elle reste visible dans « rejetées ».
        if (!stillPending && local && local.server_seq === undefined) await tbl.delete(op.row_id);
      }
    });
  }

  private async pull(): Promise<void> {
    let cursor = (await this.db.getMeta<number>(CURSOR_KEY)) ?? 0;
    for (;;) {
      const sentAt = Date.now();
      const page = await this.transport.pullChanges(this.ctx.schoolId, cursor, this.pullLimit);
      this.observeClock(page.server_time, sentAt);
      const tables = [...new Set(page.changes.map((c) => c.table))]
        .filter((t) => this.db.defs.has(t))
        .map((t) => this.db.data(t));
      await this.db.transaction('rw', [...tables, this.db.outbox, this.db.meta], async () => {
        for (const c of page.changes) {
          if (this.db.defs.has(c.table)) await this.applyServerRow(c.table, c.row);
        }
        await this.db.setMeta(CURSOR_KEY, page.cursor);
      });
      cursor = page.cursor;
      if (!page.has_more) return;
    }
  }

  /**
   * Écrit la version du serveur, sauf les champs encore en attente d'envoi sur ce téléphone :
   * une saisie locale n'est jamais écrasée avant d'avoir été envoyée.
   */
  private async applyServerRow(table: string, row: Row): Promise<void> {
    const tbl = this.db.data(table);
    const local = await tbl.get(row.id);
    if (local?.server_seq !== undefined && row.server_seq !== undefined && local.server_seq > row.server_seq) return;
    const pending = await this.db.outbox.where('row_id').equals(row.id).toArray();
    if (pending.length === 0 || !local) {
      await tbl.put(row);
      return;
    }
    const merged: Row = { ...row };
    const clock = { ...(row.field_clock ?? {}) };
    for (const op of pending) {
      for (const k of Object.keys(op.fields)) {
        merged[k] = local[k];
        clock[k] = op.client_time;
      }
    }
    merged.field_clock = clock;
    await tbl.put(merged);
  }

  private observeClock(serverTime: string, sentAt: number): void {
    this.ctx.clock.observe(serverTime, sentAt, Date.now());
    void this.db.setMeta(CLOCK_KEY, this.ctx.clock.offsetMs);
  }

  // ---------- Synchronisation automatique

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onOnline);
    }
    void this.refresh().then(() => this.tick());
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.debounce) clearTimeout(this.debounce);
    if (typeof window !== 'undefined') window.removeEventListener('online', this.onOnline);
  }

  /** À appeler après chaque écriture locale : synchronise deux secondes plus tard. */
  notifyWrite = (): void => {
    void this.setState({});
    if (this.stopped) return;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.tick(), 2_000);
  };

  private onOnline = (): void => {
    this.failures = 0;
    this.tick();
  };

  private tick(): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.syncOnce()
      .catch(() => undefined)
      .finally(() => {
        if (this.stopped) return;
        // Après un échec : 30 s, 1 min, 2 min… plafonné à 5 min.
        const delay = this.failures === 0
          ? this.intervalMs
          : Math.min(300_000, this.intervalMs * 2 ** Math.min(this.failures - 1, 4));
        this.timer = setTimeout(() => this.tick(), delay);
      });
  }
}
