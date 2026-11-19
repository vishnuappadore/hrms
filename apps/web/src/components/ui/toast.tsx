"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

interface ToastContextValue {
  showToast: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DISMISS_AFTER_MS = 3000;

/**
 * Mount once near the root of a layout that should support toasts — e.g. `DashboardShell`, which
 * doesn't unmount on client-side navigation within that route group, so a toast shown right before
 * a `router.replace(...)` survives the redirect instead of vanishing with the page that triggered it.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);

  const showToast = useCallback((message: string) => {
    setToast({ id: Date.now(), message });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const handle = setTimeout(() => setToast(null), DISMISS_AFTER_MS);
    return () => clearTimeout(handle);
  }, [toast]);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* `justify-end` is flexbox-logical — mirrors correctly in RTL on its own (reads as
       * bottom-right in LTR, bottom-left in RTL), no physical right-/left- utility needed. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-end px-4">
        {toast && (
          <div
            key={toast.id}
            role="status"
            aria-live="polite"
            className="pointer-events-auto rounded-lg bg-foreground px-4 py-2.5 text-sm font-medium text-background shadow-lg transition-opacity duration-300"
          >
            {toast.message}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
