import { create } from "zustand";

export type ToastLevel = "info" | "success" | "danger";

export interface Toast {
  id: number;
  level: ToastLevel;
  message: string;
  /** Optional second line: what to do about it. */
  detail?: string;
}

interface NotifyState {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id">) => number;
  dismiss: (id: number) => void;
  clear: () => void;
}

let nextId = 1;

export const useNotifications = create<NotifyState>((set) => ({
  toasts: [],
  push: (toast) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }));
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

/**
 * The error channel. Never swallow — surface it here. Copy is sentence case, active voice,
 * and says what to do next rather than how we feel about it.
 */
export const notify = {
  info: (message: string, detail?: string) =>
    useNotifications.getState().push({ level: "info", message, ...(detail ? { detail } : {}) }),
  success: (message: string, detail?: string) =>
    useNotifications.getState().push({ level: "success", message, ...(detail ? { detail } : {}) }),
  error: (message: string, detail?: string) =>
    useNotifications.getState().push({ level: "danger", message, ...(detail ? { detail } : {}) }),
};
