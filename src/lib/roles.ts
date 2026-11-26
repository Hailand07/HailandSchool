export const ROLES = [
  'fondateur', 'direction', 'comptable', 'secretariat', 'enseignant', 'surveillant', 'parent', 'eleve',
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  fondateur: 'Fondateur',
  direction: 'Direction',
  comptable: 'Comptable',
  secretariat: 'Secrétariat',
  enseignant: 'Enseignant',
  surveillant: 'Surveillant',
  parent: 'Parent',
  eleve: 'Élève',
};

/** Rôles du personnel que le fondateur peut créer depuis l'application (MVP : pas de parents ni d'élèves). */
export const STAFF_ROLES: Role[] = ['fondateur', 'direction', 'comptable', 'secretariat', 'enseignant', 'surveillant'];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
