import { useRuntime, useMyRoles, useSyncState } from '../context';
import { Button, Card, Notice, Screen } from '../../ui/kit';
import { ROLE_LABELS } from '../../lib/roles';
import { formatGuineaPhone } from '../../lib/phone';

export function AccountScreen({ onBack, onLock, onSignOut }: { onBack: () => void; onLock: () => void; onSignOut: () => void }) {
  const { session } = useRuntime();
  const roles = useMyRoles();
  const sync = useSyncState();
  return (
    <Screen title="Mon compte" onBack={onBack}>
      <Card>
        <div className="font-medium text-ink">{session.fullName}</div>
        <div className="text-sm text-muted">{formatGuineaPhone(session.phone)}</div>
        <div className="mt-1 text-sm text-muted">{session.schoolName} · {roles.map((r) => ROLE_LABELS[r]).join(', ')}</div>
      </Card>
      <Button variant="secondary" onClick={onLock}>Verrouiller</Button>
      {sync.pending > 0 && (
        <Notice tone="error">
          {sync.pending} opération{sync.pending > 1 ? 's' : ''} pas encore envoyée{sync.pending > 1 ? 's' : ''}. Synchronisez avant de vous déconnecter.
        </Notice>
      )}
      <Button variant="danger" disabled={sync.pending > 0} onClick={onSignOut}>Se déconnecter de ce téléphone</Button>
    </Screen>
  );
}
