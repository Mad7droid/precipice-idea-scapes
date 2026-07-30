import { useEffect } from "react";
import { useNotifications, type Toast } from "@/core/notify";

const AUTO_DISMISS_MS = 6000;

/**
 * The single place errors surface. Nothing in the app swallows a failure; it comes here.
 */
export function ToastHost() {
  const toasts = useNotifications((s) => s.toasts);

  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-toast flex flex-col gap-2">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>
  );
}

function ToastCard({ toast }: { toast: Toast }) {
  const dismiss = useNotifications((s) => s.dismiss);

  useEffect(() => {
    // Errors stay until dismissed; there is usually something to do about them.
    if (toast.level === "danger") return;
    const timer = setTimeout(() => dismiss(toast.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast.id, toast.level, dismiss]);

  return (
    <div
      role="status"
      className="animate-ribbon-line pointer-events-auto flex max-w-[420px] items-start gap-3 rounded-md border border-subtle bg-raised px-3 py-2 shadow-md"
    >
      <span
        aria-hidden
        className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
        style={{
          background:
            toast.level === "danger"
              ? "var(--danger)"
              : toast.level === "success"
                ? "var(--success)"
                : "var(--info)",
        }}
      />
      <div className="min-w-0">
        <p className="text-fg">{toast.message}</p>
        {toast.detail && <p className="mt-0.5 text-xs text-fg-secondary">{toast.detail}</p>}
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => dismiss(toast.id)}
        className="ml-1 shrink-0 rounded-sm px-1 text-fg-tertiary transition-colors duration-instant ease-out hover:text-fg"
      >
        ✕
      </button>
    </div>
  );
}
