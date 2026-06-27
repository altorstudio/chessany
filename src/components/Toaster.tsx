import { useToasts } from "../toast";

/** Bottom-center transient notifications (move classifications, etc.). */
export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);

  return (
    <div className="toaster">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <span className="toast-icon" style={{ background: t.color }}>{t.icon}</span>
          <div className="toast-body">
            <div className="toast-title" style={{ color: t.color }}>{t.title}</div>
            <div className="toast-message">{t.message}</div>
            {t.action && (
              <button
                className="toast-action"
                onClick={() => { t.action!.onClick(); dismiss(t.id); }}
              >
                {t.action.label}
              </button>
            )}
          </div>
          <button className="toast-close" onClick={() => dismiss(t.id)} aria-label="Dismiss">✕</button>
        </div>
      ))}
    </div>
  );
}
