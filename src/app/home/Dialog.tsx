import { useEffect, useRef, type ReactNode } from "react";

/** Shared focus containment for home dialogs and the existing settings/help surfaces. */
export function useDialogFocus(onClose: () => void) {
  const root = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const elements = () =>
      [
        ...(root.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
        ) ?? []),
      ].filter((el) => !el.hidden);
    (
      root.current?.querySelector<HTMLElement>("[data-initial-focus]") ??
      elements()[0] ??
      root.current
    )?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close.current();
      }
      if (event.key !== "Tab") return;
      const all = elements();
      if (!all.length) {
        event.preventDefault();
        root.current?.focus();
        return;
      }
      const first = all[0],
        last = all[all.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || !root.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !root.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    root.current?.addEventListener("keydown", key);
    const node = root.current;
    return () => {
      node?.removeEventListener("keydown", key);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return root;
}
export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const root = useDialogFocus(onClose);
  return (
    <div
      className="fixed inset-0 z-modal grid place-items-center bg-black/40 p-4"
      onMouseDown={onClose}
    >
      <div
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-subtle bg-surface p-6 shadow-lg"
      >
        <h2 className="text-lg text-fg">{title}</h2>
        {children}
      </div>
    </div>
  );
}
