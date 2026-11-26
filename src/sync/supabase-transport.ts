import type { SupabaseClient } from '@supabase/supabase-js';
import {
  NetworkError, classifyServerError,
  type ApplyResponse, type Operation, type PullPage, type Transport,
} from './types';

/** Envoie les opérations aux fonctions SQL apply_operations et pull_changes. */
export class SupabaseTransport implements Transport {
  constructor(private readonly client: SupabaseClient) {}

  async applyOperations(deviceId: string, ops: Operation[]): Promise<ApplyResponse> {
    return this.call<ApplyResponse>('apply_operations', { p_device_id: deviceId, p_ops: ops });
  }

  async pullChanges(schoolId: string, cursor: number, limit: number): Promise<PullPage> {
    return this.call<PullPage>('pull_changes', { p_school: schoolId, p_cursor: cursor, p_limit: limit });
  }

  private async call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new NetworkError();
    let res;
    try {
      res = await this.client.rpc(fn, args);
    } catch {
      throw new NetworkError();
    }
    if (res.error) {
      // Erreur réseau de fetch : pas de code SQL.
      if (!res.error.code && /fetch|network|Failed/i.test(res.error.message)) throw new NetworkError(res.error.message);
      throw classifyServerError(res.error.message);
    }
    return res.data as T;
  }
}
