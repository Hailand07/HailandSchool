// Transport de test : appelle les vraies fonctions SQL dans PGlite, avec l'identité d'un utilisateur.
// Simule l'absence de réseau et la perte de réponse après traitement par le serveur.
import type { PGlite } from '@electric-sql/pglite';
import {
  NetworkError, classifyServerError,
  type ApplyResponse, type Operation, type PullPage, type Transport,
} from '../../src/sync/types';
import { asUser, one } from './pg';

export class PgTransport implements Transport {
  online = true;
  /** Nombre de réponses à « perdre » après que le serveur a appliqué les opérations. */
  loseNextResponses = 0;
  calls = 0;

  constructor(private readonly db: PGlite, private readonly userId: string) {}

  async applyOperations(deviceId: string, ops: Operation[]): Promise<ApplyResponse> {
    const r = await this.run<{ r: ApplyResponse }>('select public.apply_operations($1, $2) as r', [deviceId, JSON.stringify(ops)]);
    if (this.loseNextResponses > 0) {
      this.loseNextResponses--;
      throw new NetworkError('réponse perdue');
    }
    return r.r;
  }

  async pullChanges(schoolId: string, cursor: number, limit: number): Promise<PullPage> {
    const r = await this.run<{ r: PullPage }>('select public.pull_changes($1, $2, $3) as r', [schoolId, cursor, limit]);
    return r.r;
  }

  private async run<T>(sql: string, params: unknown[]): Promise<T> {
    this.calls++;
    if (!this.online) throw new NetworkError();
    try {
      return await asUser(this.db, this.userId, (tx) => one<T>(tx, sql, params));
    } catch (e) {
      throw classifyServerError(e instanceof Error ? e.message : String(e));
    }
  }
}
