import { useState } from 'react';
import { useMyRoles, useRuntime } from './context';
import { SyncIndicator } from './SyncIndicator';
import { HomeScreen, type ScreenId } from './screens/HomeScreen';
import { UsersScreen } from './screens/UsersScreen';
import { SyncScreen } from './screens/SyncScreen';
import { AccountScreen } from './screens/AccountScreen';
import { Screen } from '../ui/kit';

export function AppShell({ onLock, onSignOut }: { onLock: () => void; onSignOut: () => void }) {
  const { session } = useRuntime();
  const roles = useMyRoles();
  const [screen, setScreen] = useState<ScreenId>('home');
  const home = () => setScreen('home');

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-line bg-surface px-4 py-2">
        <button onClick={() => setScreen('account')} className="min-w-0 text-left">
          <div className="truncate text-sm font-semibold text-ink">{session.schoolName}</div>
          <div className="truncate text-xs text-muted">{session.fullName}</div>
        </button>
        <SyncIndicator onClick={() => setScreen('sync')} />
      </header>
      <main className="flex-1">
        {screen === 'home' && (
          <Screen>
            <HomeScreen roles={roles} onOpen={setScreen} />
          </Screen>
        )}
        {screen === 'users' && <UsersScreen onBack={home} />}
        {screen === 'sync' && <SyncScreen onBack={home} />}
        {screen === 'account' && <AccountScreen onBack={home} onLock={onLock} onSignOut={onSignOut} />}
      </main>
    </div>
  );
}
