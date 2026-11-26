import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

export function Screen({ title, children, onBack }: { title?: string; children: ReactNode; onBack?: () => void }) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col gap-4 px-4 py-6">
      {(title || onBack) && (
        <div className="flex items-center gap-2">
          {onBack && (
            <button onClick={onBack} className="-ml-2 rounded-lg px-2 py-1 text-2xl text-muted" aria-label="Retour">
              ‹
            </button>
          )}
          {title && <h1 className="text-xl font-semibold text-ink">{title}</h1>}
        </div>
      )}
      {children}
    </div>
  );
}

type Variant = 'primary' | 'secondary' | 'danger';

export function Button({ variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const styles: Record<Variant, string> = {
    primary: 'bg-brand text-white active:bg-brand-strong disabled:opacity-50',
    secondary: 'bg-surface-2 text-ink active:bg-line disabled:opacity-50',
    danger: 'bg-danger-soft text-danger active:opacity-80 disabled:opacity-50',
  };
  return <button {...props} className={`min-h-12 rounded-xl px-4 text-base font-medium ${styles[variant]} ${className}`} />;
}

export function Field({ label, hint, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium text-ink">{label}</span>
      <input
        {...props}
        className="min-h-12 rounded-xl border border-line bg-surface px-3 text-base text-ink outline-none focus:border-brand"
      />
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error' | 'success'; children: ReactNode }) {
  const styles = {
    info: 'bg-surface-2 text-ink',
    error: 'bg-danger-soft text-danger',
    success: 'bg-brand-soft text-brand-strong',
  };
  return <div className={`rounded-xl px-3 py-2 text-sm ${styles[tone]}`}>{children}</div>;
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-line bg-surface p-4 ${className}`}>{children}</div>;
}
