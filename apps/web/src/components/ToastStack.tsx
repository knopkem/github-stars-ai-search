import { useEffect } from 'react';
import { CheckCircle2, Info, X } from 'lucide-react';

export interface ToastNotification {
  id: number;
  tone: 'success' | 'info';
  message: string;
}

interface ToastStackProps {
  toasts: ToastNotification[];
  onDismiss: (id: number) => void;
}

function ToastItem({ toast, onDismiss }: { toast: ToastNotification; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      onDismiss(toast.id);
    }, 4_500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [onDismiss, toast.id]);

  const Icon = toast.tone === 'success' ? CheckCircle2 : Info;

  return (
    <div
      className={`pointer-events-auto flex items-start gap-3 rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur-xl animate-fade-in-up ${
        toast.tone === 'success'
          ? 'border-accent-green/35 bg-[rgba(6,30,23,0.94)]'
          : 'border-accent-blue/35 bg-[rgba(11,20,36,0.95)]'
      }`}
      role="status"
    >
      <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${toast.tone === 'success' ? 'text-accent-green' : 'text-accent-cyan'}`} />
      <div className="min-w-0 flex-1 text-sm text-text-primary">
        {toast.message}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="rounded-full p-1 text-text-muted transition-colors hover:text-text-primary"
        aria-label="Dismiss notification"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed right-6 top-24 z-[70] flex w-[min(24rem,calc(100%-3rem))] flex-col gap-3" aria-live="polite">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
