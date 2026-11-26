// Protocole de synchronisation partagé entre le téléphone et le serveur (lot 1.4).

export type SyncMode = 'lww' | 'append_only';

export interface TableDef {
  name: string;
  mode: SyncMode;
  /** Index Dexie supplémentaires, en plus de id, school_id et server_seq. */
  indexes?: string[];
}

export type Row = Record<string, unknown> & {
  id: string;
  school_id: string;
  server_seq?: number;
  field_clock?: Record<string, string>;
};

export interface Operation {
  op_id: string;
  table: string;
  row_id: string;
  kind: 'upsert' | 'insert';
  fields: Record<string, unknown>;
  /** Heure de l'écriture, corrigée du décalage avec l'horloge du serveur. */
  client_time: string;
}

export interface OutboxEntry extends Operation {
  seq?: number;
}

export interface RejectedEntry extends Operation {
  error: string;
  rejected_at: string;
}

export interface ApplyResult {
  op_id: string;
  status: 'applied' | 'duplicate' | 'rejected';
  error?: string | null;
  row: Row | null;
}

export interface ApplyResponse {
  results: ApplyResult[];
  server_time: string;
}

export interface PullPage {
  changes: { table: string; row: Row }[];
  cursor: number;
  has_more: boolean;
  server_time: string;
}

export interface Transport {
  applyOperations(deviceId: string, ops: Operation[]): Promise<ApplyResponse>;
  pullChanges(schoolId: string, cursor: number, limit: number): Promise<PullPage>;
}

/** Réseau absent ou réponse perdue : on réessaiera plus tard, sans rien perdre. */
export class NetworkError extends Error {
  constructor(message = 'network_unavailable') {
    super(message);
    this.name = 'NetworkError';
  }
}

/** Appareil révoqué ou adhésion retirée : l'appareil doit être vidé et l'utilisateur déconnecté. */
export class AccessRevokedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccessRevokedError';
  }
}

export const REVOCATION_CODES = ['device_revoked', 'membership_revoked', 'device_unknown', 'not_member'];

export function classifyServerError(message: string): Error {
  return REVOCATION_CODES.some((c) => message.includes(c)) ? new AccessRevokedError(message) : new Error(message);
}
