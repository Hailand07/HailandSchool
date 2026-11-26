import { useCallback, useEffect, useState } from 'react';
import { supabase, supabaseConfigured } from './supabase';
import {
  ChangePasswordScreen, ChooseSchoolScreen, LoginScreen, PinSetupScreen, PinUnlockScreen,
} from './auth/screens';
import { LoginError, openSchool, type SchoolChoice, type SignInResult } from './auth/login';
import { hashPin, MAX_PIN_ATTEMPTS, verifyPin } from './auth/pin';
import {
  clearSession, forgetDevice, getSession, saveSession, type DeviceSession,
} from './device/device-store';
import { createRuntime, type Runtime } from './app/runtime';
import { RuntimeContext } from './app/context';
import { AppShell } from './app/AppShell';
import { Notice, Screen } from './ui/kit';

type Phase =
  | { kind: 'loading' }
  | { kind: 'login'; notice?: string }
  | { kind: 'password'; result: SignInResult }
  | { kind: 'choose'; result: SignInResult }
  | { kind: 'pin-setup'; session: DeviceSession }
  | { kind: 'locked'; session: DeviceSession }
  | { kind: 'ready'; runtime: Runtime };

export function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getSession().then((s) => {
      if (!s) setPhase({ kind: 'login' });
      else if (!s.pinHash) setPhase({ kind: 'pin-setup', session: s });
      else setPhase({ kind: 'locked', session: s });
    });
  }, []);

  const start = useCallback((session: DeviceSession) => {
    const runtime = createRuntime(session);
    runtime.engine.start();
    setPhase({ kind: 'ready', runtime });
  }, []);

  // Appareil révoqué ou accès retiré : on efface les données locales.
  useEffect(() => {
    if (phase.kind !== 'ready') return;
    const { engine, db } = phase.runtime;
    return engine.subscribe((s) => {
      if (s.status !== 'revoked') return;
      engine.stop();
      void (async () => {
        await db.delete();
        await forgetDevice();
        await supabase.auth.signOut();
        setPhase({ kind: 'login', notice: "L'accès de ce téléphone a été retiré. Ses données locales ont été effacées." });
      })();
    });
  }, [phase]);

  async function openChosen(result: SignInResult, school: SchoolChoice) {
    setError(null);
    try {
      const session = await openSchool(supabase, result, school);
      await saveSession(session);
      setPhase({ kind: 'pin-setup', session });
    } catch (e) {
      setError(e instanceof LoginError ? e.message : 'Une erreur est survenue. Réessayez.');
      setPhase({ kind: 'login' });
    }
  }

  function afterSignIn(result: SignInResult) {
    if (result.mustChangePassword) return setPhase({ kind: 'password', result });
    if (result.schools.length === 1) return void openChosen(result, result.schools[0]!);
    setPhase({ kind: 'choose', result });
  }

  async function backToPassword(session: DeviceSession, notice: string) {
    await saveSession({ ...session, pinHash: undefined, pinSalt: undefined, failedPinAttempts: 0 });
    await supabase.auth.signOut();
    setPhase({ kind: 'login', notice });
  }

  if (!supabaseConfigured) {
    return (
      <Screen title="Configuration manquante">
        <Notice tone="error">
          Renseignez VITE_SUPABASE_URL et VITE_SUPABASE_PUBLISHABLE_KEY dans le fichier .env (voir .env.example).
        </Notice>
      </Screen>
    );
  }

  switch (phase.kind) {
    case 'loading':
      return <Screen><p className="mt-16 text-center text-muted">Ouverture…</p></Screen>;
    case 'login':
      return <LoginScreen notice={error ?? phase.notice} onSignedIn={afterSignIn} />;
    case 'password':
      return <ChangePasswordScreen onDone={() => afterSignIn({ ...phase.result, mustChangePassword: false })} />;
    case 'choose':
      return <ChooseSchoolScreen schools={phase.result.schools} onChoose={(s) => void openChosen(phase.result, s)} />;
    case 'pin-setup':
      return (
        <PinSetupScreen
          onPin={async (pin) => {
            const { hash, salt } = await hashPin(pin);
            const session = { ...phase.session, pinHash: hash, pinSalt: salt, failedPinAttempts: 0 };
            await saveSession(session);
            start(session);
          }}
        />
      );
    case 'locked': {
      const s = phase.session;
      return (
        <PinUnlockScreen
          name={s.fullName}
          school={s.schoolName}
          attemptsLeft={MAX_PIN_ATTEMPTS - s.failedPinAttempts - 1}
          onForgot={() => void backToPassword(s, 'Reconnectez-vous avec votre mot de passe pour choisir un nouveau code.')}
          onPin={async (pin) => {
            if (await verifyPin(pin, s.pinHash!, s.pinSalt!)) {
              const session = { ...s, failedPinAttempts: 0 };
              await saveSession(session);
              start(session);
              return true;
            }
            const session = { ...s, failedPinAttempts: s.failedPinAttempts + 1 };
            if (session.failedPinAttempts >= MAX_PIN_ATTEMPTS) {
              await backToPassword(session, 'Trop de codes incorrects. Reconnectez-vous avec votre mot de passe.');
            } else {
              await saveSession(session);
              setPhase({ kind: 'locked', session });
            }
            return false;
          }}
        />
      );
    }
    case 'ready':
      return (
        <RuntimeContext.Provider value={phase.runtime}>
          <AppShell
            onLock={() => {
              phase.runtime.engine.stop();
              setPhase({ kind: 'locked', session: phase.runtime.session });
            }}
            onSignOut={() => {
              const { engine, db } = phase.runtime;
              engine.stop();
              void (async () => {
                await db.delete();
                await clearSession();
                await supabase.auth.signOut();
                setPhase({ kind: 'login' });
              })();
            }}
          />
        </RuntimeContext.Provider>
      );
  }
}
