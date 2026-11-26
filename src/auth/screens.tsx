import { useState } from 'react';
import { Button, Field, Notice, Screen } from '../ui/kit';
import { PinPad } from './PinPad';
import { supabase } from '../supabase';
import { changePassword, LoginError, signIn, type SchoolChoice, type SignInResult } from './login';
import { ROLE_LABELS } from '../lib/roles';

function message(e: unknown): string {
  return e instanceof LoginError ? e.message : 'Une erreur est survenue. Réessayez.';
}

export function LoginScreen({ onSignedIn, notice }: { onSignedIn: (r: SignInResult) => void; notice?: string }) {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await signIn(supabase, phone, password));
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <div className="mt-8 mb-4">
        <div className="text-3xl font-bold text-brand">Hailand School</div>
        <p className="mt-1 text-muted">La caisse et les notes de l'école, même sans réseau.</p>
      </div>
      {notice && <Notice>{notice}</Notice>}
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Numéro de téléphone" inputMode="tel" autoComplete="tel" placeholder="620 00 00 00"
          value={phone} onChange={(e) => setPhone(e.target.value)} required />
        <Field label="Mot de passe" type="password" autoComplete="current-password"
          value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" disabled={busy}>{busy ? 'Connexion…' : 'Se connecter'}</Button>
      </form>
      <p className="text-sm text-muted">
        La première connexion demande du réseau. Ensuite, l'application s'ouvre avec votre code, sans réseau.
      </p>
    </Screen>
  );
}

export function ChooseSchoolScreen({ schools, onChoose }: { schools: SchoolChoice[]; onChoose: (s: SchoolChoice) => void }) {
  return (
    <Screen title="Choisissez l'école">
      {schools.map((s) => (
        <Button key={s.schoolId} variant="secondary" className="text-left" onClick={() => onChoose(s)}>
          <div>{s.schoolName}</div>
          <div className="text-sm text-muted">{s.roles.map((r) => ROLE_LABELS[r]).join(', ')}</div>
        </Button>
      ))}
    </Screen>
  );
}

export function ChangePasswordScreen({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError('Les deux mots de passe sont différents.');
    setBusy(true);
    setError(null);
    try {
      await changePassword(supabase, password);
      onDone();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Nouveau mot de passe">
      <Notice>Le mot de passe donné par le fondateur est provisoire. Choisissez le vôtre.</Notice>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Nouveau mot de passe" type="password" autoComplete="new-password" minLength={8}
          hint="Au moins 8 caractères." value={password} onChange={(e) => setPassword(e.target.value)} required />
        <Field label="Confirmer" type="password" autoComplete="new-password"
          value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" disabled={busy}>Enregistrer</Button>
      </form>
    </Screen>
  );
}

export function PinSetupScreen({ onPin }: { onPin: (pin: string) => Promise<void> }) {
  const [first, setFirst] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);

  async function complete(pin: string) {
    if (first === null) {
      setFirst(pin);
      setError(null);
      setResetKey((k) => k + 1);
    } else if (pin !== first) {
      setFirst(null);
      setError('Les deux codes sont différents. Recommencez.');
      setResetKey((k) => k + 1);
    } else {
      await onPin(pin);
    }
  }

  return (
    <Screen title={first === null ? 'Choisissez votre code' : 'Confirmez votre code'}>
      <p className="text-muted">Ce code à 4 chiffres ouvre l'application sur ce téléphone, même sans réseau.</p>
      {error && <Notice tone="error">{error}</Notice>}
      <PinPad onComplete={complete} resetKey={resetKey} />
    </Screen>
  );
}

export function PinUnlockScreen({
  name, school, attemptsLeft, onPin, onForgot,
}: { name: string; school: string; attemptsLeft: number; onPin: (pin: string) => Promise<boolean>; onForgot: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  async function complete(pin: string) {
    setBusy(true);
    const ok = await onPin(pin);
    setBusy(false);
    if (!ok) {
      setError('Code incorrect.');
      setResetKey((k) => k + 1);
    }
  }

  return (
    <Screen>
      <div className="mt-8 text-center">
        <div className="text-lg font-semibold text-ink">{name}</div>
        <div className="text-muted">{school}</div>
      </div>
      {error && <Notice tone="error">{error} Il reste {attemptsLeft} essai{attemptsLeft > 1 ? 's' : ''}.</Notice>}
      <PinPad onComplete={complete} disabled={busy} resetKey={resetKey} />
      <button className="mt-4 text-sm text-muted underline" onClick={onForgot}>Code oublié</button>
    </Screen>
  );
}
