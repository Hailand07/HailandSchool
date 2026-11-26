import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useRuntime } from '../context';
import { Button, Card, Field, Notice, Screen } from '../../ui/kit';
import { ROLE_LABELS, STAFF_ROLES, isRole, type Role } from '../../lib/roles';
import { formatGuineaPhone, normalizeGuineaPhone } from '../../lib/phone';
import { createMember, MembersError, revokeDevice, revokeMember } from '../members-api';

function errorText(e: unknown) {
  return e instanceof MembersError ? e.message : 'Action impossible. Réessayez.';
}

function formatDate(iso: unknown): string {
  if (typeof iso !== 'string') return 'jamais';
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

export function UsersScreen({ onBack }: { onBack: () => void }) {
  const { db, session } = useRuntime();
  const members = useLiveQuery(() => db.data('memberships').toArray(), [db]) ?? [];
  const devices = useLiveQuery(() => db.data('devices').toArray(), [db]) ?? [];
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; phone: string; password: string | null } | null>(null);

  const active = members.filter((m) => m.status === 'active').sort((a, b) => String(a.full_name).localeCompare(String(b.full_name)));
  const nameOf = (userId: unknown) => members.find((m) => m.user_id === userId)?.full_name ?? 'Inconnu';

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <Screen title="Utilisateurs et téléphones" onBack={onBack}>
      {error && <Notice tone="error">{error}</Notice>}
      {created && (
        <Notice tone="success">
          {created.name} peut se connecter avec le {formatGuineaPhone(created.phone)}
          {created.password ? <> et le mot de passe provisoire <b className="font-mono">{created.password}</b>. Notez-le : il ne sera plus affiché.</> : ' et son mot de passe habituel.'}
        </Notice>
      )}

      {adding ? (
        <AddMemberForm
          onCancel={() => setAdding(false)}
          onSubmit={(input) =>
            act(async () => {
              const r = await createMember({ schoolId: session.schoolId, ...input });
              setCreated({ name: input.fullName, phone: input.phone, password: r.temp_password });
              setAdding(false);
            })
          }
        />
      ) : (
        <Button onClick={() => { setCreated(null); setAdding(true); }}>Ajouter une personne</Button>
      )}

      <h2 className="mt-2 font-semibold text-ink">Membres</h2>
      {active.map((m) => (
        <Card key={m.id} className="flex items-center justify-between gap-2">
          <div>
            <div className="font-medium text-ink">{String(m.full_name)}</div>
            <div className="text-sm text-muted">
              {isRole(m.role) ? ROLE_LABELS[m.role] : String(m.role)} · {formatGuineaPhone(String(m.phone))}
            </div>
          </div>
          {m.user_id !== session.userId && (
            <Button variant="danger" className="min-h-10 text-sm"
              onClick={() => confirm(`Retirer l'accès de ${m.full_name} ?`) && act(() => revokeMember(session.schoolId, m.id))}>
              Retirer
            </Button>
          )}
        </Card>
      ))}

      <h2 className="mt-2 font-semibold text-ink">Téléphones</h2>
      {devices.sort((a, b) => String(a.receipt_prefix).localeCompare(String(b.receipt_prefix))).map((d) => (
        <Card key={d.id} className="flex items-center justify-between gap-2">
          <div>
            <div className="font-medium text-ink">Caisse {String(d.receipt_prefix)} · {String(nameOf(d.user_id))}</div>
            <div className="text-sm text-muted">
              {d.revoked_at ? 'Révoqué' : `Dernière synchronisation : ${formatDate(d.last_sync_at)}`}
            </div>
          </div>
          {!d.revoked_at && d.id !== session.deviceId && (
            <Button variant="danger" className="min-h-10 text-sm"
              onClick={() => confirm('Révoquer ce téléphone ? Ses données locales seront effacées à sa prochaine connexion.') && act(() => revokeDevice(d.id))}>
              Révoquer
            </Button>
          )}
        </Card>
      ))}
    </Screen>
  );
}

function AddMemberForm({ onSubmit, onCancel }: {
  onSubmit: (input: { fullName: string; phone: string; role: Role }) => Promise<void>;
  onCancel: () => void;
}) {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<Role>('comptable');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const normalized = normalizeGuineaPhone(phone);
    if (!normalized) return setError('Numéro invalide. Exemple : 620 00 00 00.');
    setBusy(true);
    await onSubmit({ fullName: fullName.trim(), phone: normalized, role });
    setBusy(false);
  }

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Nom complet" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        <Field label="Téléphone" inputMode="tel" placeholder="620 00 00 00" value={phone} onChange={(e) => setPhone(e.target.value)} required />
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-ink">Rôle</span>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}
            className="min-h-12 rounded-xl border border-line bg-surface px-3 text-base text-ink">
            {STAFF_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </label>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex gap-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={onCancel}>Annuler</Button>
          <Button type="submit" className="flex-1" disabled={busy}>{busy ? 'Création…' : 'Créer'}</Button>
        </div>
      </form>
    </Card>
  );
}
