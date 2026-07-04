import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ToastType = "success" | "error" | "info";

export interface ToastItem {
  id: string;
  text: string;
  type: ToastType;
}

// ── Context ───────────────────────────────────────────────────────────────────

interface ToastContextValue {
  toast: (text: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

// ── Provider ──────────────────────────────────────────────────────────────────

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timerRefs = useRef<Map<string, number>>(new Map());

  const remove = useCallback((id: string) => {
    setToasts((p) => p.filter((t) => t.id !== id));
    timerRefs.current.delete(id);
  }, []);

  const toast = useCallback(
    (text: string, type: ToastType = "info") => {
      const id = `${Date.now()}-${Math.random()}`;
      setToasts((p) => [...p.slice(-4), { id, text, type }]);
      const timer = window.setTimeout(() => remove(id), 4200);
      timerRefs.current.set(id, timer);
    },
    [remove]
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="toast-stack" role="region" aria-label="Notifications" aria-live="polite">
        {toasts.map((t) => (
          <ToastItem key={t.id} item={t} onDismiss={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
};

// ── Single toast ──────────────────────────────────────────────────────────────

const ICONS: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle2 size={15} />,
  error:   <AlertTriangle size={15} />,
  info:    <Info size={15} />,
};

const ToastItem: React.FC<{ item: ToastItem; onDismiss: () => void }> = ({ item, onDismiss }) => (
  <div className={`toast toast--${item.type}`} role="alert">
    <span className="toast-icon">{ICONS[item.type]}</span>
    <span className="toast-text">{item.text}</span>
    <button className="toast-close" onClick={onDismiss} aria-label="Dismiss">
      <X size={13} />
    </button>
  </div>
);
