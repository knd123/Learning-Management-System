import clsx from 'clsx';
import { AlertCircle, CheckCircle2, Loader2, X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { Link, type LinkProps } from 'react-router';

export { clsx as cn };

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'sun';
type Size = 'sm' | 'md' | 'lg';

const variants: Record<Variant, string> = {
  primary: 'bg-brand-700 text-white hover:bg-brand-800 shadow-sm',
  secondary: 'bg-white text-ink border border-sand-300 hover:bg-sand-50',
  ghost: 'text-brand-700 hover:bg-brand-50',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  sun: 'bg-sun text-ink hover:brightness-95 shadow-sm',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-5 text-base gap-2',
};

const buttonBase = 'inline-flex items-center justify-center rounded-xl font-semibold transition disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap';

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }) {
  return (
    <button className={clsx(buttonBase, variants[variant], sizes[size], className)} disabled={loading || props.disabled} {...props}>
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function ButtonLink({ variant = 'primary', size = 'md', className, ...props }: LinkProps & { variant?: Variant; size?: Size }) {
  return <Link className={clsx(buttonBase, variants[variant], sizes[size], className)} {...props} />;
}

export function ExternalButton({ variant = 'primary', size = 'md', className, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: Variant; size?: Size }) {
  return <a target="_blank" rel="noopener noreferrer" className={clsx(buttonBase, variants[variant], sizes[size], className)} {...props} />;
}

export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={clsx('rounded-2xl border border-sand-200 bg-white p-5 shadow-[0_1px_2px_rgba(31,42,42,0.04)]', className)} {...props}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={clsx('mb-3 flex items-center justify-between gap-3', className)}>
      <h2 className="text-base font-semibold text-ink">{children}</h2>
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { to: string; label: string } }) {
  return (
    <div className="mb-6">
      {back && (
        <Link to={back.to} className="mb-2 inline-block text-sm font-medium text-brand-700 hover:underline">
          ← {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">{title}</h1>
          {subtitle && <p className="mt-1 text-ink-soft">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

type Tone = 'gray' | 'green' | 'amber' | 'red' | 'blue' | 'brand';
const tones: Record<Tone, string> = {
  gray: 'bg-sand-100 text-ink-soft',
  green: 'bg-emerald-50 text-emerald-800',
  amber: 'bg-amber-50 text-amber-800',
  red: 'bg-red-50 text-red-700',
  blue: 'bg-sky-50 text-sky-800',
  brand: 'bg-brand-50 text-brand-800',
};

export function Badge({ tone = 'gray', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={clsx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold', tones[tone], className)}>{children}</span>;
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: (id: string) => ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={clsx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      {children(id)}
      {hint && <p className="text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}

const control = 'rounded-xl border border-sand-300 bg-white px-3 text-sm text-ink placeholder:text-ink-muted focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:bg-sand-50';

/** Controls fill their container unless the caller gives them a width (w-32, max-w-xs…). */
const width = (className?: string) => (/(^|\s)w-/.test(className || '') ? '' : 'w-full');

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx(control, width(className), 'h-10', className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx(control, width(className), 'min-h-24 py-2 leading-relaxed', className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={clsx(control, width(className), 'h-10 pr-8', className)} {...props} />;
}

export function Checkbox({ label, checked, onChange, hint }: { label: ReactNode; checked: boolean; onChange(v: boolean): void; hint?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 text-sm">
      <input type="checkbox" className="mt-0.5 size-4 accent-brand-700" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="font-medium text-ink">{label}</span>
        {hint && <span className="block text-xs text-ink-muted">{hint}</span>}
      </span>
    </label>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('size-5 animate-spin text-brand-600', className)} aria-label="Loading" />;
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-ink-soft">
      <Spinner /> {label}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="flex-1">{message}</div>
      {onRetry && (
        <button className="font-semibold underline" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Notice({ tone = 'amber', icon, children }: { tone?: 'amber' | 'blue' | 'green'; icon?: ReactNode; children: ReactNode }) {
  const styles = { amber: 'border-amber-200 bg-amber-50 text-amber-900', blue: 'border-sky-200 bg-sky-50 text-sky-900', green: 'border-emerald-200 bg-emerald-50 text-emerald-900' };
  return <div className={clsx('flex items-start gap-3 rounded-xl border p-4 text-sm', styles[tone])}>{icon}<div className="flex-1">{children}</div></div>;
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-sand-300 bg-sand-50/60 px-6 py-10 text-center">
      {icon && <div className="mb-3 text-brand-600">{icon}</div>}
      <p className="font-semibold text-ink">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-ink-soft">{children}</div>}
    </div>
  );
}

export function StatTile({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <Card className="p-4">
      <p className="text-sm text-ink-soft">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-ink">{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
    </Card>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<{ id: NoInfer<T>; label: string; count?: number }>; value: T; onChange: (id: T) => void }) {
  return (
    <div role="tablist" className="mb-5 flex gap-1 overflow-x-auto border-b border-sand-200">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={clsx(
            '-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold transition',
            value === t.id ? 'border-brand-700 text-brand-800' : 'border-transparent text-ink-soft hover:text-ink',
          )}
        >
          {t.label}
          {t.count !== undefined && t.count > 0 && <span className="rounded-full bg-amber-100 px-1.5 text-xs text-amber-900">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose(): void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={clsx('m-auto w-[calc(100%-2rem)] rounded-2xl bg-white p-0 text-ink shadow-2xl backdrop:bg-ink/40', wide ? 'max-w-3xl' : 'max-w-lg')}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-center justify-between border-b border-sand-200 px-5 py-4">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button onClick={onClose} className="rounded-lg p-1 text-ink-soft hover:bg-sand-100" aria-label="Close">
              <X className="size-5" />
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}

interface Toast {
  id: number;
  message: string;
  tone: 'success' | 'error';
}

const ToastContext = createContext<(message: string, tone?: Toast['tone']) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, tone: Toast['tone'] = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={clsx('pointer-events-auto flex max-w-md items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium shadow-lg', t.tone === 'success' ? 'bg-ink text-white' : 'bg-red-600 text-white')}>
            {t.tone === 'success' ? <CheckCircle2 className="size-4" /> : <AlertCircle className="size-4" />}
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-sand-200 bg-white">
      <table className="w-full min-w-[640px] text-left text-sm [&_td]:px-4 [&_td]:py-3 [&_th]:px-4 [&_th]:py-3 [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-ink-muted [&_thead]:border-b [&_thead]:border-sand-200 [&_tbody_tr]:border-b [&_tbody_tr]:border-sand-100 [&_tbody_tr:last-child]:border-0">
        {children}
      </table>
    </div>
  );
}
