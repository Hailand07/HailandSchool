import { createContext, useContext, useEffect, useState } from 'react';
import type { Runtime } from './runtime';
import type { SyncState } from '../sync/engine';
import { useLiveQuery } from 'dexie-react-hooks';
import { isRole, type Role } from '../lib/roles';

export const RuntimeContext = createContext<Runtime | null>(null);

export function useRuntime(): Runtime {
  const rt = useContext(RuntimeContext);
  if (!rt) throw new Error('useRuntime hors de RuntimeContext');
  return rt;
}

export function useSyncState(): SyncState {
  const { engine } = useRuntime();
  const [state, setState] = useState(engine.getState());
  useEffect(() => engine.subscribe(setState), [engine]);
  return state;
}

/** Rôles actuels de l'utilisateur, d'après les adhésions synchronisées (à défaut, celles de la connexion). */
export function useMyRoles(): Role[] {
  const { db, session } = useRuntime();
  const roles = useLiveQuery(async () => {
    const rows = await db.data('memberships').where('user_id').equals(session.userId).toArray();
    return rows.filter((m) => m.status === 'active').map((m) => m.role).filter(isRole);
  }, [db, session.userId]);
  return roles && roles.length > 0 ? roles : session.roles;
}
