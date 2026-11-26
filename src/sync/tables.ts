import type { TableDef } from './types';

/**
 * Tables synchronisées sur le téléphone. Doit rester aligné avec public.sync_tables.
 * Chaque étape du plan ajoute ses tables ici et incrémente LOCAL_SCHEMA_VERSION.
 */
export const APP_TABLES: TableDef[] = [
  { name: 'schools', mode: 'lww' },
  { name: 'memberships', mode: 'lww', indexes: ['user_id', 'role'] },
  { name: 'devices', mode: 'lww', indexes: ['user_id'] },
];

export const LOCAL_SCHEMA_VERSION = 1;
