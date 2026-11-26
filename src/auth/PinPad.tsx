import { useEffect, useState } from 'react';

/** Pavé numérique à grosses touches, utilisable d'une main. */
export function PinPad({ onComplete, disabled, resetKey }: { onComplete: (pin: string) => void; disabled?: boolean; resetKey?: number }) {
  const [pin, setPin] = useState('');
  useEffect(() => setPin(''), [resetKey]);

  function press(d: string) {
    if (disabled || pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 4) onComplete(next);
  }

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="flex gap-4" aria-label={`${pin.length} chiffres saisis sur 4`}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`h-4 w-4 rounded-full ${i < pin.length ? 'bg-brand' : 'border-2 border-line'}`} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k, i) =>
          k === '' ? (
            <span key={i} />
          ) : (
            <button
              key={i}
              disabled={disabled}
              onClick={() => (k === '⌫' ? setPin(pin.slice(0, -1)) : press(k))}
              className="h-16 w-20 rounded-2xl bg-surface-2 text-2xl font-medium text-ink active:bg-line disabled:opacity-50"
              aria-label={k === '⌫' ? 'Effacer' : k}
            >
              {k}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
