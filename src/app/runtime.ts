// Tout ce qui vit le temps d'une session ouverte : base locale, horloge, moteur de synchronisation.
import { LocalDb } from '../sync/db';
import { Clock } from '../sync/clock';
import { SyncEngine } from '../sync/engine';
import { SupabaseTransport } from '../sync/supabase-transport';
import { APP_TABLES, LOCAL_SCHEMA_VERSION } from '../sync/tables';
import type { WriteContext } from '../sync/store';
import { schoolDbName, type DeviceSession } from '../device/device-store';
import { supabase } from '../supabase';

export interface Runtime {
  session: DeviceSession;
  db: LocalDb;
  clock: Clock;
  engine: SyncEngine;
  write: WriteContext;
}

export function createRuntime(session: DeviceSession): Runtime {
  const db = new LocalDb(schoolDbName(session.schoolId), APP_TABLES, LOCAL_SCHEMA_VERSION);
  const clock = new Clock();
  const engine = new SyncEngine(db, new SupabaseTransport(supabase), {
    schoolId: session.schoolId,
    deviceId: session.deviceId,
    clock,
  });
  return { session, db, clock, engine, write: { db, schoolId: session.schoolId, clock, onWrite: engine.notifyWrite } };
}
