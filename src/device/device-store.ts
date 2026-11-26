// Ce que l'appareil retient entre deux ouvertures : son identifiant et la session de l'utilisateur.
import Dexie, { type Table } from 'dexie';
import type { Role } from '../lib/roles';
import { uuid } from '../lib/uuid';

export interface DeviceSession {
  userId: string;
  phone: string;
  fullName: string;
  schoolId: string;
  schoolName: string;
  roles: Role[];
  deviceId: string;
  receiptPrefix: string;
  pinHash?: string;
  pinSalt?: string;
  failedPinAttempts: number;
}

class DeviceDb extends Dexie {
  kv!: Table<{ key: string; value: unknown }, string>;
  constructor() {
    super('hailand-device');
    this.version(1).stores({ kv: '&key' });
  }
}

const db = new DeviceDb();

export async function getDeviceId(): Promise<string> {
  const existing = (await db.kv.get('device_id'))?.value as string | undefined;
  if (existing) return existing;
  const id = uuid();
  await db.kv.put({ key: 'device_id', value: id });
  return id;
}

export async function getSession(): Promise<DeviceSession | null> {
  return ((await db.kv.get('session'))?.value as DeviceSession | undefined) ?? null;
}

export async function saveSession(session: DeviceSession): Promise<void> {
  await db.kv.put({ key: 'session', value: session });
}

export async function clearSession(): Promise<void> {
  await db.kv.delete('session');
}

/** Appareil révoqué : on oublie aussi son identifiant, il devra être réenregistré. */
export async function forgetDevice(): Promise<void> {
  await db.kv.clear();
}

export function schoolDbName(schoolId: string): string {
  return `hailand-school-${schoolId}`;
}
