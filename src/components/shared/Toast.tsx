/** Toast notification system with slide-in animation */
import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

interface ToastContextType {
  toasts: ToastMessage[];
  addToast: (type: ToastMessage['type'], message: string) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType>({
  toasts: [],
  addToast: () => {},
  removeToast: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

const toastStyles: Record<ToastMessage['type'], { bg: string; border: string; text: string; icon: string }> = {
  success: {
    bg: 'var(--color-success-bg)',
    border: 'var(--color-success-border)',
    text: 'var(--color-status-success)',
    icon: '\u2713',
  },
  error: {
    bg: 'var(--color-danger-bg)',
    border: 'var(--color-danger-border)',
    text: 'var(--color-status-danger)',
    icon: '\u2715',
  },
  info: {
    bg: 'var(--color-info-bg)',
    border: 'var(--color-info-border)',
    text: 'var(--color-info)',
    icon: '\u2139',
  },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((type: ToastMessage['type'], message: string) => {
    const id = Date.now().toString(36);
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Memoize context value to prevent unnecessary re-renders of consumers
  const contextValue = useMemo<ToastContextType>(
    () => ({ toasts, addToast, removeToast }),
    [toasts, addToast, removeToast],
  );

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      {/* Toast container */}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
        {toasts.map((toast) => {
          const style = toastStyles[toast.type];
          return (
            <div
              key={toast.id}
              className="animate-slide-in-right rounded-lg px-4 py-3 text-sm font-medium shadow-lg border cursor-pointer backdrop-blur-sm"
              style={{
                backgroundColor: style.bg,
                borderColor: style.border,
                color: style.text,
                willChange: 'transform, opacity',
                transform: 'translateZ(0)',
              }}
              onClick={() => removeToast(toast.id)}
            >
              <span className="mr-2">{style.icon}</span>
              {toast.message}
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
