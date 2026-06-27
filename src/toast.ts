import { create } from "zustand";

export interface Toast {
  id: number;
  title: string;
  message: string;
  color: string;
  icon: string;
  /** Optional action button (e.g. "Show line"). */
  action?: { label: string; onClick: () => void };
}

interface ToastState {
  toasts: Toast[];
  show: (t: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
}

let counter = 0;

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  show: (t) => {
    const id = ++counter;
    // Auto-dismiss after a few seconds (longer when there's an action to click);
    // keep at most 3 on screen.
    setTimeout(() => useToasts.getState().dismiss(id), t.action ? 9000 : 4200);
    set((s) => ({ toasts: [...s.toasts.slice(-2), { ...t, id }] }));
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));
