import { useSyncState } from './context';

/** Indicateur permanent : l'utilisateur sait toujours si ses saisies sont parties au serveur. */
export function SyncIndicator({ onClick }: { onClick?: () => void }) {
  const s = useSyncState();
  let dot = 'bg-brand';
  let text = 'Tout est synchronisé';
  if (s.status === 'syncing') {
    dot = 'bg-warn animate-pulse';
    text = 'Synchronisation…';
  } else if (s.pending > 0) {
    dot = 'bg-warn';
    text = `${s.pending} opération${s.pending > 1 ? 's' : ''} en attente`;
  }
  if (s.status === 'offline') text = s.pending > 0 ? `Hors ligne · ${s.pending} en attente` : 'Hors ligne';
  if (s.status === 'error') {
    dot = 'bg-danger';
    text = 'Erreur de synchronisation';
  }
  if (s.rejected > 0) {
    dot = 'bg-danger';
    text += ` · ${s.rejected} refusée${s.rejected > 1 ? 's' : ''}`;
  }
  return (
    <button onClick={onClick} className="flex items-center gap-2 rounded-full bg-surface-2 px-3 py-1 text-xs text-ink">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {text}
    </button>
  );
}
