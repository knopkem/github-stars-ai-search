interface StatusBannerProps {
  tone: 'success' | 'error' | 'info';
  message: string;
  onDismiss: () => void;
}

export function StatusBanner({ tone, message, onDismiss }: StatusBannerProps) {
  return (
    <div className="status-banner" data-tone={tone}>
      <span>{message}</span>
      <button type="button" className="ghost-button" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}
