import { useLiveQuery } from 'dexie-react-hooks';
import { useRuntime, useSyncState } from '../context';
import { Button, Card, Notice, Screen } from '../../ui/kit';

/** Détail de la synchronisation : opérations en attente et opérations refusées par le serveur. */
export function SyncScreen({ onBack }: { onBack: () => void }) {
  const { db, engine, session } = useRuntime();
  const state = useSyncState();
  const rejected = useLiveQuery(() => db.rejected.toArray(), [db]) ?? [];

  return (
    <Screen title="Synchronisation" onBack={onBack}>
      <Card>
        <div className="text-sm text-muted">Téléphone</div>
        <div className="font-medium text-ink">Caisse {session.receiptPrefix}</div>
        <div className="mt-2 text-sm text-muted">Dernière synchronisation</div>
        <div className="font-medium text-ink">
          {state.lastSyncAt ? new Date(state.lastSyncAt).toLocaleString('fr-FR') : 'Jamais'}
        </div>
        <div className="mt-2 text-sm text-muted">En attente d'envoi</div>
        <div className="font-medium text-ink">{state.pending}</div>
      </Card>
      {state.status === 'offline' && <Notice>Pas de réseau. Vos saisies sont enregistrées sur le téléphone et partiront dès le retour du réseau.</Notice>}
      {state.error && <Notice tone="error">{state.error}</Notice>}
      <Button onClick={() => void engine.syncOnce().catch(() => undefined)} disabled={state.status === 'syncing'}>
        Synchroniser maintenant
      </Button>
      {rejected.length > 0 && (
        <>
          <h2 className="mt-2 font-semibold text-ink">Opérations refusées par le serveur</h2>
          <p className="text-sm text-muted">Elles n'ont pas été enregistrées. Montrez cet écran au fondateur ou au support.</p>
          {rejected.map((r) => (
            <Card key={r.op_id}>
              <div className="text-sm font-medium text-ink">{r.table} · {new Date(r.client_time).toLocaleString('fr-FR')}</div>
              <div className="text-xs text-danger">{r.error}</div>
              <pre className="mt-1 overflow-x-auto text-xs text-muted">{JSON.stringify(r.fields, null, 1)}</pre>
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}
