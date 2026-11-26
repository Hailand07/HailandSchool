import type { Role } from '../../lib/roles';

export type ScreenId = 'home' | 'users' | 'sync' | 'account';

interface Tile {
  label: string;
  roles: Role[];
  /** Écran disponible, ou étape du plan qui l'apportera. */
  target: ScreenId | { step: number };
}

// L'ordre suit les priorités du MVP : l'argent d'abord, puis les bulletins.
const TILES: Tile[] = [
  { label: 'Tableau de bord', roles: ['fondateur', 'direction'], target: { step: 5 } },
  { label: 'Caisse', roles: ['fondateur', 'comptable'], target: { step: 3 } },
  { label: 'Impayés', roles: ['fondateur', 'comptable', 'direction'], target: { step: 3 } },
  { label: 'En règle ou non', roles: ['surveillant'], target: { step: 3 } },
  { label: 'Élèves', roles: ['fondateur', 'direction', 'secretariat', 'comptable'], target: { step: 2 } },
  { label: 'Saisie des notes', roles: ['enseignant', 'direction'], target: { step: 4 } },
  { label: 'Bulletins', roles: ['direction'], target: { step: 4 } },
  { label: "Paramètres de l'école", roles: ['fondateur', 'direction'], target: { step: 2 } },
  { label: 'Utilisateurs et téléphones', roles: ['fondateur'], target: 'users' },
];

export function HomeScreen({ roles, onOpen }: { roles: Role[]; onOpen: (s: ScreenId) => void }) {
  const tiles = TILES.filter((t) => t.roles.some((r) => roles.includes(r)));
  return (
    <div className="grid grid-cols-2 gap-3">
      {tiles.map((t) => {
        const ready = typeof t.target === 'string';
        return (
          <button
            key={t.label}
            disabled={!ready}
            onClick={() => ready && onOpen(t.target as ScreenId)}
            className="flex min-h-24 flex-col justify-between rounded-2xl border border-line bg-surface p-3 text-left active:bg-surface-2 disabled:opacity-60"
          >
            <span className="font-medium text-ink">{t.label}</span>
            {!ready && <span className="text-xs text-muted">Bientôt</span>}
          </button>
        );
      })}
    </div>
  );
}
